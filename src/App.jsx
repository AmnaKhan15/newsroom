import React, { useEffect, useMemo, useRef, useState } from 'react'
import { LANGS, T } from './i18n.js'
import { ACCEPT, MAX_FILES, parseFile } from './docs.js'
import { NewsExplorer } from './NewsExplorer.jsx'
import { Report, downloadReport } from './Report.jsx'
import { DataDesk } from './data/DataDesk.jsx'
import { DD } from './data/i18n.js'

const STATUS_ICON = { supported: '✓', disputed: '✕', mixed: '±', unverified: '?' }
const STATUSES = ['disputed', 'mixed', 'supported', 'unverified']

function readLang() {
  try {
    return localStorage.getItem('newsroom-lang') || 'en'
  } catch {
    return 'en'
  }
}

export default function App() {
  const [lang, setLang] = useState(readLang)
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState([])
  const [phase, setPhase] = useState('idle') // idle | sources | analysis | done
  const [step, setStep] = useState(0)
  const [result, setResult] = useState(null) // { sources, analysis, documents }
  const [error, setError] = useState(null)
  const [view, setView] = useState(() => (location.hash === '#data' ? 'data' : 'investigate'))

  function go(v) {
    setView(v)
    history.replaceState(null, '', v === 'data' ? '#data' : location.pathname)
    window.scrollTo({ top: 0 })
  }

  const t = T[lang]
  const meta = LANGS.find((l) => l.code === lang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = meta.dir
    try {
      localStorage.setItem('newsroom-lang', lang)
    } catch {}
  }, [lang, meta])

  useEffect(() => {
    if (phase !== 'sources') return
    setStep(0)
    const id = setInterval(() => setStep((s) => Math.min(s + 1, 1)), 2500)
    return () => clearInterval(id)
  }, [phase])

  async function addFiles(fileList) {
    const files = [...fileList].slice(0, Math.max(MAX_FILES - docs.length, 0))
    const fresh = files.map((f) => ({ key: f.name + f.size + Math.random(), name: f.name, status: 'reading' }))
    setDocs((d) => [...d, ...fresh])
    await Promise.all(
      files.map(async (file, i) => {
        let patch
        try {
          patch = { status: 'ok', ...(await parseFile(file)) }
        } catch (e) {
          patch = { status: 'error', error: e.message }
        }
        setDocs((d) => d.map((x) => (x.key === fresh[i].key ? { ...x, ...patch } : x)))
      }),
    )
  }

  async function investigate(topic) {
    const q = topic.trim()
    const busyNow = phase === 'sources' || phase === 'analysis'
    if (q.length < 3 || busyNow || docs.some((d) => d.status === 'reading')) return
    const documents = docs
      .filter((d) => d.status === 'ok')
      .map((d, i) => ({ id: `D${i + 1}`, name: d.name, text: d.text, words: d.words }))
    setQuery(q)
    setError(null)
    setResult(null)
    setPhase('sources')
    try {
      const res = await fetch('/api/sources?q=' + encodeURIComponent(q))
      const sources = await res.json()
      if (!res.ok) throw new Error(sources.error)
      if (!sources.articles.length && !sources.papers.length && !documents.length) {
        setError(t.nothing)
        setPhase('idle')
        return
      }
      setStep(documents.length ? 2 : 3)
      setPhase('analysis')
      const ar = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...sources, documents }),
      })
      const analysis = await ar.json()
      if (!ar.ok) throw new Error(analysis.error)
      setResult({ sources, analysis, documents })
      setPhase('done')
      setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }), 60)
    } catch {
      setError(t.errorSources)
      setPhase('idle')
    }
  }

  const busy = phase === 'sources' || phase === 'analysis'
  const reading = docs.some((d) => d.status === 'reading')

  return (
    <div className="page">
      <header className="nav">
        <div className="wrap nav-inner">
          <a className="logo" href="#top" aria-label="Newsroom home">
            <Logo />
            <span>Newsroom</span>
          </a>
          <div className="view-tabs" role="tablist">
            {['investigate', 'data'].map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'active' : ''} onClick={() => go(v)}>
                {DD[lang].nav[v]}
              </button>
            ))}
          </div>
          <nav className="nav-links">
            {view === 'investigate' && result && <a href="#news">{t.navNews}</a>}
            {view === 'investigate' && <a href="#how">{t.navHow}</a>}
            {view === 'investigate' && <a href="#why">{t.navWhy}</a>}
          </nav>
          <div className="lang-switch" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button key={l.code} className={l.code === lang ? 'active' : ''} onClick={() => setLang(l.code)} aria-pressed={l.code === lang}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view === 'data' ? (
        <DataDesk lang={lang} locale={meta.locale} />
      ) : (
      <>
      <section className="hero" id="top">
        <div className="wrap hero-inner">
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.heroTitle}</h1>
          <p className="lede">{t.heroSub}</p>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault()
              investigate(query)
            }}
          >
            <SearchIcon />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.placeholder} aria-label={t.search} dir="auto" />
            <button type="submit" disabled={busy || reading || query.trim().length < 3}>
              {busy ? <span className="spinner" /> : t.search}
            </button>
          </form>
          <DocDrop t={t} docs={docs} onAdd={addFiles} onRemove={(key) => setDocs((d) => d.filter((x) => x.key !== key))} disabled={busy} />
          <div className="chips">
            <span className="chips-label">{t.examples}:</span>
            {t.exampleTopics.map((ex) => (
              <button key={ex} className="chip" onClick={() => investigate(ex)} disabled={busy || reading} dir="ltr">
                {ex}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="wrap" id="results">
        {busy && <Progress steps={t.steps} step={step} skipDocs={!docs.some((d) => d.status === 'ok')} />}
        {error && <div className="notice error">{error}</div>}
        {result && <Results t={t} lang={lang} locale={meta.locale} topic={query} {...result} />}
      </main>

      <section className="how" id="how">
        <div className="wrap">
          <h2>{t.howTitle}</h2>
          <div className="how-grid">
            {t.how.map(([title, text], i) => (
              <div className="how-card" key={title}>
                <span className="how-num">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="why" id="why">
        <div className="wrap why-inner">
          <div>
            <h2>{t.whyTitle}</h2>
            <p>{t.why}</p>
          </div>
          <div className="method">
            <h3>{t.method}</h3>
            <p>{t.methodText}</p>
          </div>
        </div>
      </section>
      </>
      )}

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>
            <strong>Newsroom</strong> · {t.builtBy}
          </span>
          <span className="muted" dir="ltr">
            GDELT · OpenAlex · Wikipedia · World Bank Open Data
          </span>
        </div>
      </footer>
    </div>
  )
}

function DocDrop({ t, docs, onAdd, onRemove, disabled }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)
  const full = docs.length >= MAX_FILES
  return (
    <div className="docdrop">
      <div
        className={'dropzone' + (over ? ' over' : '') + (full || disabled ? ' off' : '')}
        onClick={() => !full && !disabled && input.current.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (!full && !disabled) onAdd(e.dataTransfer.files)
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
      >
        <UploadIcon />
        <div>
          <strong>
            {t.docsTitle} <span className="muted">({t.docsOptional})</span>
          </strong>
          <span className="drop-sub">{full ? t.docErr.max : t.docsDrop}</span>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            onAdd(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {docs.length === 0 && <p className="drop-hint">{t.docsHint}</p>}
      {docs.length > 0 && (
        <div className="doc-pills">
          {docs.map((d) => (
            <span key={d.key} className={'doc-pill ' + d.status} title={d.status === 'error' ? t.docErr[d.error] || t.docErr.failed : d.name}>
              <FileIcon />
              <span className="doc-name" dir="ltr">{d.name}</span>
              <span className="doc-meta">
                {d.status === 'reading' && t.reading}
                {d.status === 'ok' && `${d.words.toLocaleString()} ${t.words}${d.pages ? ` · ${d.pages} ${t.pages}` : ''}`}
                {d.status === 'error' && (t.docErr[d.error] || t.docErr.failed)}
              </span>
              <button type="button" aria-label={t.remove} onClick={() => onRemove(d.key)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Progress({ steps, step, skipDocs }) {
  return (
    <div className="progress card">
      {steps.map((s, i) => {
        const skipped = skipDocs && i === 2
        const cls = skipped ? 'skipped' : i < step ? 'done' : i === step ? 'active' : ''
        return (
          <div key={s} className={'p-step ' + cls}>
            <span className="p-dot">{i < step && !skipped ? '✓' : i + 1}</span>
            <span>{s}</span>
          </div>
        )
      })}
    </div>
  )
}

function Results({ t, lang, locale, topic, sources, analysis, documents }) {
  const [filter, setFilter] = useState('all')
  const [pdfBusy, setPdfBusy] = useState(false)
  const reportRef = useRef(null)

  const index = useMemo(() => {
    const m = {}
    sources.articles.forEach((a) => (m[a.id] = { url: a.url, title: a.title, sub: a.domain }))
    sources.papers.forEach((r) => (m[r.id] = { url: r.url, title: r.title, sub: r.venue || r.year }))
    documents.forEach((d) => (m[d.id] = { url: null, title: d.name, sub: d.name }))
    return m
  }, [sources, documents])

  const countries = useMemo(() => {
    const c = {}
    sources.articles.forEach((a) => a.country && (c[a.country] = (c[a.country] || 0) + 1))
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [sources])

  const counts = useMemo(() => {
    const c = { supported: 0, disputed: 0, mixed: 0, unverified: 0 }
    analysis.claims.forEach((x) => c[x.status]++)
    return c
  }, [analysis])

  const nf = new Intl.NumberFormat(locale)
  const bg = sources.background && (sources.background[lang] || sources.background.en)
  const claims = filter === 'all' ? analysis.claims : analysis.claims.filter((c) => c.status === filter)

  async function onDownload() {
    setPdfBusy(true)
    try {
      await downloadReport(reportRef.current, topic)
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="results">
      <div className={'stats' + (documents.length ? '' : ' three')}>
        <Stat n={nf.format(sources.articles.length)} label={t.statArticles} />
        <Stat n={nf.format(countries.length)} label={t.statCountries} />
        <Stat n={nf.format(sources.papers.length)} label={t.statPapers} />
        {documents.length > 0 && <Stat n={nf.format(documents.length)} label={t.statDocs} />}
      </div>

      {sources.errors?.gdelt && !sources.articles.length && <div className="notice info">{t.noNews}</div>}

      <article className="card briefing">
        <div className="briefing-top">
          <span className="label">{t.briefing}</span>
          <span className="ai-badge">{t.engineBadge}</span>
          <button className="pdf-btn" onClick={onDownload} disabled={pdfBusy}>
            {pdfBusy ? <span className="spinner" /> : <DownloadIcon />} {pdfBusy ? t.preparing : t.download}
          </button>
        </div>
        <h2 className="serif" dir="auto">{topic}</h2>
        <p className="summary">
          {t.brief(topic, nf.format(sources.articles.length), nf.format(countries.length), nf.format(sources.papers.length), documents.length)}{' '}
          {t.tally(counts.supported, counts.disputed, counts.mixed, counts.unverified)}
        </p>
        <div className="tally-bar" aria-hidden="true">
          {STATUSES.map((s) => counts[s] > 0 && <span key={s} className={s} style={{ flex: counts[s] }} />)}
        </div>
        {analysis.checks && <p className="checks-line">{t.checks(analysis.checks)}</p>}
        {bg?.extract && (
          <p className="bg-text" dir="auto">
            {bg.extract}{' '}
            <a href={bg.url} target="_blank" rel="noreferrer">
              ({t.background}: Wikipedia ↗)
            </a>
          </p>
        )}
        {(analysis.known.length > 0 || analysis.unknown.length > 0) && (
          <div className="ku">
            <div className="ku-col known">
              <h3>{t.known}</h3>
              <ul>
                {analysis.known.map((k, i) => (
                  <li key={i} dir="auto">
                    {k.text} <SourceChip id={k.id} src={index[k.id]} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="ku-col unknown">
              <h3>{t.unknown}</h3>
              <ul>
                {analysis.unknown.map((k, i) => (
                  <li key={i} dir="auto">
                    {k.text} <SourceChip id={k.id} src={index[k.id]} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </article>

      <section className="block">
        <SectionHead title={t.claims} sub={t.claimsSub} />
        <div className="claim-filter" role="group" aria-label={t.filterClaims}>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            {t.all} <b>{analysis.claims.length}</b>
          </button>
          {STATUSES.map(
            (s) =>
              counts[s] > 0 && (
                <button key={s} className={(filter === s ? 'active ' : '') + s} onClick={() => setFilter(s)}>
                  {STATUS_ICON[s]} {t.status[s]} <b>{counts[s]}</b>
                </button>
              ),
          )}
        </div>
        <div className="claims">
          {claims.map((c, i) => (
            <div className={'claim ' + c.status} key={c.claim + i}>
              <div className="claim-head">
                <span className={'status ' + c.status}>
                  <b>{STATUS_ICON[c.status]}</b> {t.status[c.status]}
                </span>
                <span className="origin">
                  {t.origin[c.kind]} · {c.source_id}
                </span>
              </div>
              <p className="claim-text" dir="auto">“{c.claim}”</p>
              <p className="claim-why">{t.basis[c.basis.basis](c.basis)}</p>
              {c.basis.quote && (
                <blockquote className={'claim-quote ' + c.basis.quote.stance} dir="auto">
                  <span className="q-label">{c.basis.quote.stance === 'contra' ? t.opposite : t.supports}:</span> “{c.basis.quote.text}”{' '}
                  <SourceChip id={c.basis.quote.id} src={index[c.basis.quote.id]} />
                </blockquote>
              )}
              <div className="chip-groups">
                <div className="src-chips">
                  <span className="chip-label">{t.from}</span>
                  <SourceChip id={c.source_id} src={index[c.source_id]} />
                </div>
                {c.support_ids.length > 0 && (
                  <div className="src-chips">
                    <span className="chip-label agree">✓ {t.supports}</span>
                    {c.support_ids.map((id) => (
                      <SourceChip key={id} id={id} src={index[id]} />
                    ))}
                  </div>
                )}
                {c.contra_ids.length > 0 && (
                  <div className="src-chips">
                    <span className="chip-label contra">✕ {t.opposite}</span>
                    {c.contra_ids.map((id) => (
                      <SourceChip key={id} id={id} src={index[id]} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {analysis.documents.length > 0 && (
        <section className="block">
          <SectionHead title={t.docsReport} />
          <div className="papers">
            {analysis.documents.map((d) => (
              <div className="card doc-card" key={d.id}>
                <div className="paper-meta">
                  <span className="sid D">{d.id}</span>
                  <span dir="ltr">{d.name}</span>
                  <span>
                    {d.words.toLocaleString()} {t.words}
                  </span>
                </div>
                <p className="doc-line">{t.docLine(d.claims, d.corroborated)}</p>
                <div className="term-row" dir="ltr">
                  {d.top_terms.map((w) => (
                    <span key={w} className="term">{w}</span>
                  ))}
                </div>
                {d.not_in_coverage.length > 0 && (
                  <p className="muted small">
                    {t.notInCoverage}: <span dir="ltr">{d.not_in_coverage.join(', ')}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {sources.articles.length > 0 && (
        <section className="block" id="news">
          <SectionHead title={t.newsTitle} sub={t.newsSub} />
          <NewsExplorer t={t} locale={locale} articles={sources.articles} countries={countries} terms={analysis.key_terms} />
        </section>
      )}

      <section className="block">
        <SectionHead title={t.angles} />
        <div className="angles">
          {analysis.story_angles.map((a, i) => (
            <div className="angle" key={i}>
              <span>{i + 1}</span>
              <p>{t.angle[a.type](a)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <SectionHead title={t.research} sub={t.researchSub} />
        <div className="papers">
          {sources.papers.map((p) => (
            <a className="paper card" key={p.id} href={p.url} target="_blank" rel="noreferrer" dir="ltr">
              <div className="paper-meta">
                <span className="sid">{p.id}</span>
                <span>{p.year}</span>
                {p.venue && <span className="venue">{p.venue}</span>}
              </div>
              <h4>{p.title}</h4>
              {p.authors.length > 0 && <p className="muted small">{p.authors.join(', ')}</p>}
              <span className="cites">
                {nf.format(p.cites)} {t.cited}
              </span>
            </a>
          ))}
        </div>
      </section>

      <div className="report-host" aria-hidden="true">
        <div ref={reportRef}>
          <Report t={t} lang={lang} locale={locale} topic={topic} sources={sources} analysis={analysis} documents={documents} countries={countries} counts={counts} bg={bg} index={index} />
        </div>
      </div>
    </div>
  )
}

function SectionHead({ title, sub }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {sub && <p className="muted">{sub}</p>}
    </div>
  )
}

function Stat({ n, label }) {
  return (
    <div className="stat card">
      <span className="stat-n">{n}</span>
      <span className="stat-l">{label}</span>
    </div>
  )
}

function SourceChip({ id, src }) {
  if (!src) return null
  const body = (
    <>
      <b>{id}</b>
      <span>{src.sub}</span>
    </>
  )
  return src.url ? (
    <a className={'src-chip ' + id[0]} href={src.url} target="_blank" rel="noreferrer" title={src.title}>
      {body}
    </a>
  ) : (
    <span className={'src-chip ' + id[0]} title={src.title}>
      {body}
    </span>
  )
}

function Logo() {
  return (
    // A newspaper page (the news) with a verification badge (the claim check)
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2.5" y="4" width="21" height="23" rx="3.5" fill="currentColor" opacity="0.12" />
      <rect x="2.5" y="4" width="21" height="23" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <rect x="6.5" y="8" width="13" height="3.6" rx="1.2" fill="currentColor" />
      <path d="M6.5 15.5h6M6.5 19h6M6.5 22.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="14.5" y="14.8" width="5" height="4.6" rx="1" fill="currentColor" opacity="0.55" />
      <circle cx="24" cy="23.5" r="7" fill="var(--green)" stroke="var(--bg)" strokeWidth="2.4" />
      <path d="M20.9 23.6l2.2 2.2 4-4.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
    </svg>
  )
}
