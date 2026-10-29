# Architecture

How Newsroom's code fits together, for developers who want to run, change or extend it.

## Overview

```
Browser (React + Vite)                         Vercel Python functions (stdlib only)
──────────────────────                         ─────────────────────────────────────
Investigate view ── GET  /api/sources?q= ───▶  sources.py ──▶ news RSS feeds, GDELT, OpenAlex, Wikipedia
  · parses user files (pdf.js, mammoth)
                  ── POST /api/analyze ─────▶  analyze.py ──▶ fetches full article text
  · renders claims, news explorer, PDF report      (claim engine, no external AI)

Data Desk view    ── GET  /api/table?url= ──▶  table.py   ──▶ public web page / CSV
                  ── GET  /api/indicators ──▶  indicators.py ─▶ World Bank indicator list
  · parses files, cleans, queries, charts
  · World Bank API called directly from the browser (CORS allowed)
```

There is **no database and no server-side state**. Every request is independent.

## API

### `GET /api/sources?q=<topic>`

Collects evidence in parallel (one thread per source) and numbers it.

```jsonc
{
  "topic": "microplastics health",
  "articles":  [{ "id": "A1", "title": "…", "url": "…", "domain": "…", "date": "2026-10-01",
                  "country": "Pakistan", "language": "English", "image": "…" }],
  "papers":    [{ "id": "R1", "title": "…", "year": 2025, "url": "…", "venue": "…",
                  "cites": 120, "authors": ["…"], "abstract": "…" }],
  "background": { "en": { "title": "…", "extract": "…", "url": "…" }, "de": { … }, "ur": { … } },
  "news_feeds": { "gdelt": 0, "rss": 11, "feeds_ok": 27, "feeds_tried": 29 },
  "errors":    { "gdelt": "HTTP Error 429: Too Many Requests" }   // per-source, never fatal
}
```

- **News RSS feeds** (`FEEDS` in `sources.py`): 29 public feeds fetched in parallel (16 workers, 6 s each, 8 s total). RSS 2.0, RSS 1.0/RDF and Atom are parsed namespace-agnostically; items match when their title and description contain the topic's word stems (all of them for 1–2 words, all but one for longer topics).
- **GDELT** allows one request per 5 seconds per IP and often refuses Vercel's shared servers, so it gets one 10-second attempt. When it answers, its first 25 results are listed before the feed items.
- News items are merged and de-duplicated by link and by normalised headline.
- Responses carry `Cache-Control: s-maxage=900`, or 60 s when a source failed, so a temporary refusal is retried soon.
- `GUARDIAN_API_KEY` (optional) adds Guardian articles, merged and de-duplicated by URL.

### `POST /api/analyze`

Body: the `/api/sources` response plus `documents: [{ id: "D1", name, text }]`.

```jsonc
{
  "checks": { "articles": 18, "origins": 9, "fulltext_ok": 11, "fulltext_tried": 16, "wire": 3 },
  "claims": [{
    "claim": "Microplastics linked to heart disease",
    "source_id": "A3", "kind": "A",
    "status": "disputed",                       // disputed | mixed | supported | unverified
    "basis": { "basis": "contradicted", "papers": 0, "outlets": 0, "copies": 0, "docs": 0,
               "contra": 1, "contra_papers": 1, "agree": 0, "hedged": false,
               "quote": { "id": "R2", "text": "…found no association…", "stance": "contra" } },
    "support_ids": [], "contra_ids": ["R2"], "source_ids": ["A3", "R2"]
  }],
  "known":   [{ "text": "…", "id": "R1" }],
  "unknown": [{ "text": "…", "id": "R4" }],
  "key_terms": [{ "term": "drinking water", "count": 5 }],
  "documents": [{ "id": "D1", "name": "…", "words": 820, "claims": 3, "corroborated": 1,
                  "top_terms": ["…"], "not_in_coverage": ["…"] }],
  "story_angles": [{ "type": "research_gap", "id": "R1", "title": "…", "cites": 210 }]
}
```

The front end turns `basis` and `story_angles` into sentences in the chosen language, so the API stays language-neutral.

### `GET /api/table?url=<public page or CSV>`

Returns every `<table>` on the page (largest first, up to 8, 5,000 rows each), or the rows of a CSV link.

```jsonc
{ "url": "…", "tables": [{ "caption": "…", "size": "239 × 6", "rows": [["Country", "Population"], …] }] }
```

### `GET /api/indicators`

All World Development Indicators (about 1,500), trimmed to code, English name and first topic, sorted by name.

```jsonc
{ "count": 1498, "items": [["SI.POV.DDAY", "Poverty headcount ratio at $3.00 a day (2021 PPP) (% of population)", "Poverty"], …] }
```

- About 150 KB instead of the World Bank's 1.5 MB (which includes long descriptions).
- `Cache-Control: s-maxage=86400`, so Vercel serves it from the edge for a day.
- The browser loads it only when the search box is first used, and falls back to the World Bank API directly if this endpoint fails.

## The claim engine (`api/analyze.py`)

| Function | Job |
|---|---|
| `fetch_bodies` | Downloads up to 16 article pages in parallel (8 threads, 6 s each, 10 s total), keeps `<p>` text outside nav/header/footer/aside, drops results under 400 characters (paywalls). |
| `independent_origins` | Union-find over articles: same domain, headline concept overlap ≥ 0.6, body 5-gram overlap ≥ 0.25, or same wire service with similar headline → one origin. |
| `keyset` / `concepts_of` | Tokenises, removes stop words, stems, maps words to synonym groups (`SYNONYMS`), and adds the root of *micro-/nano-* words. |
| `extract_claims` | Picks up to 8 claim sentences (max 4 from files, 4 headlines, 3 abstracts) scored by IDF weight; skips meta and “more research needed” sentences; removes near-duplicates. |
| `evidence` | For each other source, finds the sentence with the most shared concepts (≥ 2, or 3 for files, and ≥ 25 % of the claim's concepts) and compares negation (`negated`) and debunking words to set the stance. |
| `judge` | Turns stances into a status and a `basis` (rules in [METHODOLOGY.md](METHODOLOGY.md)). |
| `story_angles`, `document_report`, `key_terms` | Leads, per-file summary, topics for the news explorer. |

Everything is deterministic: the same input gives the same output, which makes the rules easy to test.

## Front end

| File | Responsibility |
|---|---|
| `src/main.jsx` | Renders the app, or only a chart when the URL starts with `#embed=` |
| `src/App.jsx` | Header, view switch (`#data` hash), Investigate flow, results, claim cards |
| `src/NewsExplorer.jsx` | Timeline, country bars, topic/language chips, cards/list; every chart is also a filter |
| `src/Report.jsx` | Off-screen A4 report (700 px wide) captured to PDF by html2pdf, with page numbers |
| `src/docs.js` | File parsing in the browser: pdf.js (first 80 pages), mammoth for DOCX, text/HTML |
| `src/i18n.js`, `src/data/i18n.js` | All text in English, German and Urdu; sentences that need numbers are functions |
| `src/data/engine.js` | Pure functions: `parseText`, `parseFile`, `clean` (with log), `profile`, `runQuery`, `toCSV` |
| `src/data/Chart.jsx` | Responsive SVG line/bar charts, tooltips, wrapping legend, PNG/SVG export |
| `src/data/embed.jsx` | Encodes chart data, title and source into a base64url `#embed=` link (≤ 12,000 characters) |

## Design decisions

| Decision | Why |
|---|---|
| No database | Nothing to store: results are computed per request, files stay in the browser, and embeds carry their own data. It's cheaper, simpler and more private. |
| Rule-based engine, no generative AI | Every label must be explainable and reproducible, and must never invent facts or sources. |
| Parse files in the browser | Large files never hit the server's upload limit, and only extracted text leaves the device. |
| Python standard library only | No dependencies to install or patch on the server; fast cold starts on Vercel. |
| Hand-built SVG charts | Small bundle, full control over accessibility, export and right-to-left layout. |
| World Bank called from the browser | Its API allows cross-origin requests, so no server proxy is needed. |

## Security

- **Server-side fetches** (`table.py`, `analyze.py`) accept only `http`/`https` URLs whose host resolves to **public** IP addresses. Localhost, private ranges and cloud metadata addresses are refused, and the check runs again on every redirect.
- Size limits: 4 MB for table pages, 1.5 MB for articles; timeouts of 6–12 s.
- No secrets in the repository. The optional `GUARDIAN_API_KEY` is read from the environment.
- Dependencies are pinned to exact versions; `npm audit` reports 0 known vulnerabilities at the time of writing.

## Local development

`dev_server.py` imports each `api/*.py` handler and serves it on port 8787, mimicking Vercel's Python runtime. Vite proxies `/api` there (`vite.config.js`). Restart `dev_server.py` after changing Python files.

## Extending

- **Add a language:** add an entry to `LANGS` and a full block to `T` in `src/i18n.js` and to `DD` in `src/data/i18n.js`. Set `dir: 'rtl'` for right-to-left scripts.
- **Add a popular World Bank suggestion:** add its code to `INDICATORS` and a translated name to each `indicators` map in `src/data/i18n.js`. These only appear as suggestions in the empty search box; every indicator is reachable by searching.
- **Improve indicator search:** add everyday words and their World Bank terms to `SEARCH_ALIASES` in `src/data/DataDesk.jsx`.
- **Add synonyms:** add a space-separated group to `SYNONYMS` in `api/analyze.py`.
- **Add a negation or wire service:** extend `NEGATION` or `WIRE` in `api/analyze.py`.
