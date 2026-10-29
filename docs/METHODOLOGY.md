# Methodology

This page explains, in plain language, how Newsroom checks claims and cleans data, and where it can go wrong. It is written for journalists and editors who want to know whether they can trust a result.

**Short version:** Newsroom gives *hints*, not verdicts. Every label shows its reason and its sources, so a journalist can check it in a minute.

---

## Part 1: Checking claims (Investigate)

### Step 1: Collect

For a topic such as “microplastics health”, Newsroom asks four free, public sources at the same time:

| Source | What we get |
|---|---|
| GDELT | Up to 45 news articles from the last 3 months, from many countries and languages |
| OpenAlex | 8 research papers, with title, authors, journal, citation count and summary (abstract) |
| Wikipedia | A short neutral summary, in English, German or Urdu when available |
| Your files | Up to 5 PDF, Word or text files you add |

### Step 2: Read more than the headline

Headlines are short and often exaggerate. Newsroom downloads the **full text** of up to 16 of the most relevant articles, keeping only the main paragraphs (not menus, adverts or comments). If a site blocks this or shows a paywall, only the headline is used.

For research papers, Newsroom reads the abstract (up to 2,000 characters), not the full paper.

### Step 3: Give every source a code

| Code | Meaning |
|---|---|
| `A12` | News article number 12 |
| `R3` | Research paper number 3 |
| `D1` | Your first file |

Every claim, label and line in the PDF report points back to these codes, so nothing is untraceable.

### Step 4: Find the claims

A claim is a sentence that says something definite and checkable. Newsroom looks for sentences with:

- cause and effect: *causes, leads to, linked to, harms, prevents*
- findings: *found, shows, reveals, confirms*
- change: *increases, falls, doubles*
- numbers and percentages

It skips sentences about the paper itself (“this review aims to…”) and sentences that only say more research is needed. Those go into **What is still unknown** instead.

Claims come from headlines, research summaries and your files. Full article texts are used only as evidence.

### Step 5: Match by meaning, not exact words

Two sources can say the same thing with different words. Newsroom groups words with the same meaning, for example:

| These count as the same idea |
|---|
| harm, damage, hurt, injure, impair |
| heart, cardiac, cardiovascular, coronary |
| lung, pulmonary, respiratory |
| death, mortality, fatal, kill |
| increase, rise, surge, higher |
| flood, flooding, inundation |
| *microplastics* and *plastic particles* |

So “Microplastics **harm** the **heart**” and “Plastic particles **damage cardiac** tissue” are recognised as the same claim.

For each source, Newsroom finds the **one sentence closest in meaning** to the claim. Only that sentence is used to decide whether the source agrees.

### Step 6: Agree or say the opposite?

Sharing words is not agreeing. A study saying *“we found **no link** between microplastics and heart disease”* uses the same words as the claim but means the opposite.

Newsroom checks the matching sentence for words such as *no, not, never, did not find, no association, unlikely, myth, false, unproven, debunked*. If the sentence and the claim point in different directions, the source counts **against** the claim. Phrases like “not only” or “no doubt” are ignored, because they don't negate anything.

### Step 7: Count independent sources, not outlets

Five newspapers printing the same press release is still one source. Newsroom treats articles as **one origin** when they:

- come from the same website,
- have nearly the same headline,
- share long passages of identical text, or
- are the same wire story (Reuters, AP, AFP, dpa, PTI, APP, ANI, Bloomberg, Xinhua, Anadolu…).

### Step 8: Give a label

| Label | Rule |
|---|---|
| **Disputed** | At least one source says the opposite, and none support it. |
| **Mixed evidence** | Some sources support it and some say the opposite. |
| **Has evidence** | At least one research paper supports it, or at least 3 independent news origins from at least 2 countries do. |
| **Not confirmed** | Nothing else supports it, or the support is only copies of one story (shown as “they repeat the same story”). |

Each claim card shows:

- the **reason** in one sentence,
- an **example sentence** from the most important source (the opposing one, if there is one),
- **Supports** and **Says the opposite** source lists, each linking to the original.

### Worked examples

| Claim | Evidence | Label |
|---|---|---|
| “Microplastics linked to heart disease” | A study: “we found **no association** between microplastic exposure and heart disease” | **Disputed** |
| “Microplastics raise risk of heart attack” | Study 1: higher risk. Study 2: “**no increased risk**” | **Mixed evidence** |
| “Microplastics harm the heart” | “Plastic particles damage cardiac tissue” (news) + a research paper | **Has evidence** |
| “Microplastics cause cancer in 90% of adults” | The same headline on 5 websites, nothing else | **Not confirmed**, because they repeat the same story |

### Story ideas

Newsroom also suggests what to look into next:

- **Research gap:** a highly cited paper that the news hardly mentions.
- **Unsupported claim:** a claim in the news with no research behind it.
- **One-sided coverage:** most articles come from one country.
- **Your files vs the news:** topics in your documents that no article mentions.

---

## Part 2: Cleaning data (Data Desk)

Public data is often messy. Newsroom cleans it in a fixed order and **lists every change**, so the method can be described in an article (“we removed 3 duplicate rows…”).

| Step | Example | What Newsroom does |
|---|---|---|
| Empty rows and stray spaces | `"  Punjab "` | Removes them |
| Title lines above the table | “Table 4: Relief payments 2024” | Finds the real header row and skips what is above it |
| Notes and sources below | “Source: Ministry of…” | Removes lines with only one filled cell |
| Repeated header rows | A header row in the middle of the data | Removes it |
| Column names | Blank, duplicate or with footnote marks like `Status[1]` | Fixes them |
| Placeholders | `n/a`, `-`, `..`, `k.A.` | Marks them as missing, never as zero |
| Footnote marks in cells | `1,240*`, `980[2]` | Strips the mark |
| Written numbers | `1,240` · `1.234,5` · `Rs. 14.7 mn` · `(1,200)` · `−0.12%` | Turns them into real numbers (−1200, 14,700,000 …) |
| Dates | `Jan 2024`, `15/02/2024`, `2024-03-01` | Turns them into one format, `YYYY-MM-DD` |
| Spelling variants | `Punjab`, `punjab`, `PUNJAB` | Uses the most common spelling for all |
| Duplicate rows | Two identical rows | Keeps one |

Cells in a number column that can't be read are **left empty and counted** in the report, never guessed.

**Dates:** in `03/04/2024` the day is read first (3 April), as is usual in Pakistan and Germany. Check the tidy table if your source uses the US format.

---

## What Newsroom cannot do

- **Understand meaning like a person.** Word groups and negation rules catch many cases, not all. Sarcasm, irony, quotes of other people's claims and complex sentences can be misread.
- **Read everything.** Paywalled or blocked sites give only headlines; research is judged from abstracts.
- **Judge source quality.** A small blog and a major newspaper both count as one news origin. A research paper counts more than news, but paper quality is not assessed.
- **See beyond 3 months of news,** or beyond what GDELT and OpenAlex index.
- **Replace reporting.** Calling sources, reading documents in full and using editorial judgement are still the journalist's job.

## Why no generative AI?

Generative AI can write fluent summaries, but it can also invent facts and sources, and it is hard to explain why it reached a conclusion. For a verification tool, **being able to explain every label** matters more than sounding smart. Every rule in Newsroom is written down here and in the code (`api/analyze.py`), and can be inspected, tested and improved.
