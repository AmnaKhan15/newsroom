# Newsroom

**A free, open-source research and verification desk for journalists, in English, German and Urdu.**

**Live site: [newsroom-seven-phi.vercel.app](https://newsroom-seven-phi.vercel.app)**

Newsroom has two parts:

- **Investigate:** type a topic and, if you like, add your own files. Newsroom gathers world news, research papers and background facts, finds the main claims and shows which ones have evidence behind them, which are disputed, and which are not confirmed. Every label explains why and links to its sources.
- **Data Desk:** bring in a messy table (a spreadsheet, a table from a government website, or World Bank statistics). Newsroom tidies it, lists every change it made, lets you ask questions and turns the answer into a chart you can download or embed in an article.

It needs **no API keys, no paid AI and no database**. Nothing a user searches for or uploads is stored.

> Built by Amna Khan as a work sample showing how software engineering can support journalism, not replace it.

---

## Contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [How the claim check works](#how-the-claim-check-works)
- [Data sources](#data-sources)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Run it locally](#run-it-locally)
- [Deploy to Vercel](#deploy-to-vercel)
- [Privacy and safety](#privacy-and-safety)
- [Limits](#limits)
- [Further documentation](#further-documentation)
- [Licence](#licence)

---

## Why this exists

False information spreads faster than newsrooms can check it, and many important stories are hidden inside messy public data. Newsroom gives a reporter a fast first pass:

1. What is being said about a topic, where and by whom?
2. Which claims have evidence, and which do not?
3. What do the numbers actually show?

It is a **research assistant, not an editor**. Results are hints for a journalist to check, never final verdicts.

## Features

### Investigate

| Feature | What it does |
|---|---|
| Topic search | Collects up to 45 news articles (the latest stories from 29 news feeds, plus up to 3 months of world coverage from GDELT when it answers), 8 research papers and a Wikipedia summary. |
| Your files | Add up to 5 PDF, Word or text files (press releases, reports, interview notes). Their claims are checked against everything else. |
| Claim check | Each main claim gets a label: **Has evidence**, **Disputed**, **Mixed evidence** or **Not confirmed**, with the reason, an example sentence, and separate lists of sources that support it and sources that say the opposite. |
| Explore the news | A timeline, a country chart, topics and languages. Click any of them to filter the articles; switch between cards and a list. |
| Story ideas | Points out research the news ignores, claims with no research behind them, coverage dominated by one country, and topics in your files that the news does not mention. |
| PDF report | One click downloads a newsroom-style research memo in the chosen language: claim table, open questions, story ideas, numbered source list and methodology. |

### Data Desk

| Feature | What it does |
|---|---|
| Import | Upload CSV, Excel (XLSX) or JSON; paste rows; pull every table from a public web page; or load World Bank statistics for up to 6 countries. |
| World Bank search | One search box for all ~1,500 World Bank measures, with popular ones suggested when it is empty. Everyday words work: “girls school” finds *Children out of school, primary, female*, “toilets” finds *basic sanitation services*. |
| Tidy, with a log | Skips title and footnote lines, repeated headers and empty rows; reads numbers such as `1,240`, `1.234,5`, `Rs. 14.7 mn`, `(1,200)`, `−0.12%`; turns different date formats into one; marks `n/a` and `-` as missing; fixes different spellings of the same name; removes duplicate rows. Every change is listed. |
| Columns | Shows each column's type, how complete it is, how many different values it has, its range and a small distribution chart. |
| Ask the data | Filter, group, compare by a second column, and show count, total, average, middle value, lowest or highest. |
| Charts | Line charts for time, bar charts for categories, hover tooltips, a table view and a colour-blind-safe palette. |
| Share | Download PNG, SVG or CSV, or copy an `<iframe>` code to embed the chart in any article. The chart's data travels inside the link, so no server or database is needed. |

### Everywhere

- **Three languages:** English, German and Urdu, including right-to-left layout for Urdu.
- **Works on phones and tablets.**
- **Light and dark mode** follow the device setting.

## How the claim check works

Newsroom uses **transparent rules instead of generative AI**, so it never invents text and every label can be explained.

1. **Collect** news, research, background and your files.
2. **Read more than headlines:** downloads the full text of the most relevant news articles where the site allows it.
3. **Label sources:** `A` = news article, `R` = research paper, `D` = your file.
4. **Find claims:** sentences that make a definite statement (causes, numbers, “found”, “linked to”…).
5. **Match by meaning, not exact words:** “harm” ≈ “damage”, “heart” ≈ “cardiac”, “microplastics” ≈ “plastic particles”.
6. **Check direction:** a source saying “no link” or “did not find” counts *against* the claim, not for it.
7. **Count independent sources:** copies of the same story and shared wire reports (Reuters, AP, AFP, PTI, APP…) count once, because repetition is not proof.
8. **Label:**

| Label | When |
|---|---|
| **Disputed** | Only sources that say the opposite were found. |
| **Mixed evidence** | Some sources support it and some say the opposite. |
| **Has evidence** | A research paper supports it, or several independent news reports from more than one country do. |
| **Not confirmed** | Nothing else supports it yet, or it is only repeated copies of one story. |

The full method, with examples and limits, is in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Data sources

All free and open; none needs a key.

| Source | Used for |
|---|---|
| Public news RSS feeds | Latest stories from DW, BBC, BBC Urdu, Dawn, The Express Tribune, The Guardian, The New York Times, Al Jazeera, NPR, Tagesschau, CBC, ABC Australia, Euronews and more, searched for the topic and linked to the originals |
| [GDELT](https://www.gdeltproject.org/) | World news coverage, last 3 months (often unavailable from shared cloud servers, see Limits) |
| [OpenAlex](https://openalex.org/) | Research papers and abstracts |
| [Wikipedia](https://www.wikipedia.org/) | Background summaries in English, German and Urdu |
| [World Bank Open Data](https://data.worldbank.org/) | Country statistics in the Data Desk |
| Public web pages | Tables imported by the user in the Data Desk |

Optional: set `GUARDIAN_API_KEY` (free from [The Guardian Open Platform](https://open-platform.theguardian.com/access/)) to add Guardian articles.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 6, plain CSS (no UI framework) |
| Backend | Python 3.12 serverless functions on Vercel, **standard library only** |
| Documents | pdf.js (PDF), mammoth (Word), read in the browser |
| Data import | PapaParse (CSV), SheetJS (Excel) |
| Charts | Hand-built SVG with a validated colour-blind-safe palette |
| PDF report | html2pdf.js |

## Project structure

```
newsroom/
├── api/                    Python serverless functions (Vercel)
│   ├── sources.py          GET  /api/sources?q=…   collect news, research, background
│   ├── analyze.py          POST /api/analyze       claim check engine
│   ├── table.py            GET  /api/table?url=…   extract tables from a public web page
│   └── indicators.py       GET  /api/indicators    list of all World Bank indicators (cached)
├── src/
│   ├── App.jsx             Investigate view, layout, header, language switch
│   ├── NewsExplorer.jsx    interactive news filters and cards
│   ├── Report.jsx          PDF research report
│   ├── docs.js             PDF / Word / text parsing in the browser
│   ├── i18n.js             Investigate text in EN / DE / UR
│   ├── styles.css          all styles, light and dark, responsive
│   └── data/               Data Desk
│       ├── DataDesk.jsx    import, cleaning report, columns, query, chart, table
│       ├── engine.js       parsing, cleaning, profiling, querying
│       ├── Chart.jsx       SVG line and bar charts, PNG/SVG export
│       ├── embed.jsx       embeddable chart links
│       └── i18n.js         Data Desk text in EN / DE / UR
├── docs/                   methodology and architecture
├── dev_server.py           runs the Python API locally
├── vercel.json             function settings
└── index.html
```

More detail for developers: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run it locally

Requirements: **Node.js 18+** and **Python 3.10+**.

```bash
git clone https://github.com/AmnaKhan15/newsroom.git
cd newsroom
npm install
```

Start the API and the website in two terminals:

```bash
python dev_server.py
```

```bash
npm run dev
```

Open http://localhost:5173. The website forwards `/api/*` to the Python server on port 8787.

## Deploy to Vercel

The project is ready for Vercel as is: Vite builds the website and every file in `api/` becomes a Python function.

The live site is connected to this repository: **every push to `main` deploys automatically** to [newsroom-seven-phi.vercel.app](https://newsroom-seven-phi.vercel.app). To run your own copy:

```bash
npm i -g vercel
vercel login
vercel --prod
```

Or import the GitHub repository at [vercel.com/new](https://vercel.com/new) and press **Deploy**. No environment variables are required.

## Privacy and safety

- **No database, no accounts, no tracking.** Searches and files are not stored.
- **Your files stay in your browser.** Only the extracted text is sent to the claim check, and it is not kept.
- **Safe fetching:** the server only downloads from public internet addresses. Local, private and cloud-internal addresses are refused, also after redirects, with size and time limits.
- **No secrets in the code.** The only optional key is read from an environment variable.

## Limits

- Labels are **automatic hints, not verdicts.** Matching by meaning catches many cases but not all; always open the sources.
- Some news sites block automatic reading or use paywalls; then only the headline is used.
- Research is judged from abstracts, not full papers.
- News feeds only contain each outlet's latest stories (usually the last few days), so niche or older topics may find little news.
- GDELT allows one request every 5 seconds per internet address and often refuses shared cloud servers such as Vercel's, so on the live site news usually comes from the feeds alone.
- Scanned PDFs (pictures of text) cannot be read.
- In dates like `03/04/2024`, the day is read first (3 April), as in Pakistan and Germany.

## Further documentation

- [docs/METHODOLOGY.md](docs/METHODOLOGY.md): how claims are checked and how data is cleaned, in plain language, for journalists and editors.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the code fits together, the API, and design decisions, for developers.

## Licence

[MIT](LICENSE) © 2026 Amna Khan
