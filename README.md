# Newsroom

An open-source research and verification desk for journalists. Type a topic, optionally add your
own documents, and Newsroom collects global news coverage, academic research and background
sources, then labels the key claims as **has evidence / disputed / not confirmed**,
each linked to its sources. Interface in **English, German and Urdu**. Runs entirely on free APIs.

## Features

- **Claim check:** claim-like sentences from news, research and your documents, matched against all other sources, with the reason for every rating shown.
- **Your documents:** drop up to 5 PDF, DOCX or TXT files (press releases, reports, transcripts). They are parsed in the browser and their claims are checked against outside evidence.
- **Interactive news explorer:** click a week, a country, a story thread or a language to filter coverage; switch between cards and list.
- **PDF brief:** one click downloads a newsroom-style research memo (claim table, open questions, leads, source list, methodology) in the selected language.

### Data Desk (data journalism infrastructure)

Many stories are hidden in messy public registries and statistics. The Data Desk turns them into something a reporter can query and publish:

- **Import** a CSV, Excel or JSON file, pasted rows, every table on a public web page (`api/table.py`), or World Bank Open Data (no key).
- **Automatic cleaning with an audit log:** skips title and footnote lines, repeated headers and empty rows; reads `1,234`, `1.234,5`, `Rs. 14.7 mn`, `(1,200)`, `−0.12%`; unifies date formats; marks `n/a`/`-` as missing; merges spelling variants; removes duplicates. Every fix is listed, so the method can be explained to readers.
- **Column profiles:** type, completeness, distinct values, range and distribution.
- **Query builder:** filter, group, split into series, and count / sum / average / median / min / max.
- **Interactive charts:** line charts for time, bar charts for categories, tooltips, a table view, colour-blind-safe palette.
- **Publish:** download PNG, SVG or CSV, or copy an `<iframe>` embed code. The embed carries its data in the link, so it needs no server or database.

## How it works

| Step | What happens |
|---|---|
| Collect | `api/sources.py` queries free, open APIs in parallel: GDELT (world news), OpenAlex (research), Wikipedia in EN/DE/UR (background). No scraping. |
| Number | Every source gets an ID: `A` article, `R` research, `D` your document. |
| Match | `api/analyze.py` extracts claim-like sentences and compares them with every other source by shared key terms. No generative AI, so nothing is invented. |
| Rate | Debunking language in related sources → contested. Research plus independent outlets → corroborated. Otherwise → unverified. |

Stack: React 18 + Vite, Python serverless functions on Vercel (standard library only), pdf.js and mammoth for document parsing, html2pdf for the brief, PapaParse and SheetJS for data import, hand-built SVG charts.

## Optional environment variable

| Name | Adds | Where to get it (free) |
|---|---|---|
| `GUARDIAN_API_KEY` | Guardian articles | open-platform.theguardian.com/access |

Without it the app works fully with GDELT, OpenAlex, Wikipedia and your documents.

## Run locally

```bash
npm install
python dev_server.py      # API on :8787
npm run dev               # site on :5173
```

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Limits

Ratings are leads, not conclusions: they come from matching key terms between headlines,
abstracts and documents, not from reading full articles. GDELT allows one
request per 5 seconds per IP, so news can briefly be empty under load. Scanned PDFs (images
without text) cannot be read.
