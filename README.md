# ClaimLens

An open-source research and verification desk for journalists. Type a topic, optionally add your
own documents, and ClaimLens collects global news coverage, academic research and published
fact-checks, then rates the key claims as **corroborated / contested / misleading / unverified**,
each linked to its sources. Interface in **English, German and Urdu**. Runs entirely on free APIs.

## Features

- **Claim check:** claim-like sentences from news, research and your documents, matched against all other sources, with the reason for every rating shown.
- **Your documents:** drop up to 5 PDF, DOCX or TXT files (press releases, reports, transcripts). They are parsed in the browser and their claims are checked against outside evidence.
- **Interactive news explorer:** click a week, a country, a story thread or a language to filter coverage; switch between cards and list.
- **PDF brief:** one click downloads a newsroom-style research memo (claim table, open questions, leads, source list, methodology) in the selected language.

## How it works

| Step | What happens |
|---|---|
| Collect | `api/sources.py` queries free, open APIs in parallel: GDELT (world news), OpenAlex (research), Wikipedia in EN/DE/UR (background), Google Fact Check Tools (optional free key). No scraping. |
| Number | Every source gets an ID: `A` article, `R` research, `F` fact-check, `D` your document. |
| Match | `api/analyze.py` extracts claim-like sentences and compares them with every other source by shared key terms. No generative AI, so nothing is invented. |
| Rate | Published fact-check verdict → that rating. Debunking language in related sources → contested. Research plus independent outlets → corroborated. Otherwise → unverified. |

Stack: React 18 + Vite, Python serverless functions on Vercel (standard library only), pdf.js and mammoth for document parsing, html2pdf for the brief.

## Optional environment variables

| Name | Adds | Where to get it (free) |
|---|---|---|
| `GOOGLE_FACTCHECK_API_KEY` | Published fact-checks | Google Cloud console → enable "Fact Check Tools API" → create API key |
| `GUARDIAN_API_KEY` | Guardian articles | open-platform.theguardian.com/access |

Without them the app still works with GDELT, OpenAlex, Wikipedia and your documents.

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
abstracts, documents and fact-check verdicts, not from reading full articles. GDELT allows one
request per 5 seconds per IP, so news can briefly be empty under load. Scanned PDFs (images
without text) cannot be read.
