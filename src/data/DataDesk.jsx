import React, { useMemo, useRef, useState } from 'react'
import { AGGS, clean, parseFile, parseText, profile, runQuery, toCSV } from './engine.js'
import { Chart, downloadPNG, downloadSVG, makeFormat, save } from './Chart.jsx'
import { embedUrl } from './embed.jsx'
import { COUNTRIES, DD, INDICATORS } from './i18n.js'

const OPS = { text: ['=', '!=', 'contains'], date: ['=', '!=', 'contains'], number: ['>', '<', '=', '!='], year: ['=', '>', '<', '!='] }
const isNum = (c) => c.type === 'number'

function defaultQuery(columns, data) {
  const uniq = (c) => new Set(data.map((o) => o[c.key]).filter((v) => v != null)).size
  const time = columns.find((c) => c.type === 'year' || c.type === 'date')
  const metric = columns.find(isNum)
  const cats = columns.filter((c) => c.type === 'text')
  const q = { filters: [], groupBy: '', seriesBy: '', agg: metric ? 'sum' : 'count', metric: metric?.key || '' }
  if (time) {
    q.groupBy = time.key
    q.seriesBy = cats.find((c) => uniq(c) >= 2 && uniq(c) <= 6)?.key || ''
  } else {
    q.groupBy = cats.find((c) => uniq(c) >= 2 && uniq(c) <= 40)?.key || cats[0]?.key || ''
  }
  if (metric && (metric.percent || time)) q.agg = 'mean'
  return q
}

export function DataDesk({ lang, locale }) {
  const t = DD[lang]
  const [tab, setTab] = useState('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [ds, setDs] = useState(null) // { name, columns, data, log, rawRows }
  const [q, setQ] = useState(null)
  const [title, setTitle] = useState('')
  const [source, setSource] = useState('')

  function load(rows, meta) {
    const r = clean(rows)
    if (!r.columns.length || !r.data.length) {
      setError(t.err.empty)
      return
    }
    setError(null)
    setDs({ ...r, name: meta.name })
    const dq = meta.query || defaultQuery(r.columns, r.data)
    setQ(dq)
    setTitle(meta.title || '')
    setSource(meta.source || '')
    setTimeout(() => document.getElementById('dd-report')?.scrollIntoView({ behavior: 'smooth' }), 80)
  }

  async function guarded(fn) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message && t.err[e.message] ? t.err[e.message] : e.message || t.err.parse)
    }
    setBusy(false)
  }

  return (
    <>
      <section className="hero dd-hero">
        <div className="wrap hero-inner">
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.title}</h1>
          <p className="lede">{t.sub}</p>
          <Importer t={t} tab={tab} setTab={setTab} busy={busy} guarded={guarded} load={load} lang={lang} />
          {error && <div className="notice error">{error}</div>}
        </div>
      </section>
      {ds && q && (
        <main className="wrap dd-main">
          <CleaningReport t={t} ds={ds} />
          <Profile t={t} ds={ds} locale={locale} />
          <Workbench t={t} ds={ds} q={q} setQ={setQ} locale={locale} title={title} setTitle={setTitle} source={source} setSource={setSource} />
          <DataTable t={t} ds={ds} locale={locale} />
        </main>
      )}
    </>
  )
}

function Importer({ t, tab, setTab, busy, guarded, load, lang }) {
  const input = useRef(null)
  const [paste, setPaste] = useState('')
  const [url, setUrl] = useState('')
  const [tables, setTables] = useState(null)
  const [ind, setInd] = useState(INDICATORS[3])
  const [countries, setCountries] = useState(['PAK', 'DEU', 'IND', 'BGD'])
  const [from, setFrom] = useState(2000)
  const [to, setTo] = useState(2023)

  const onFile = (file) =>
    file &&
    guarded(async () => {
      const { rows } = await parseFile(file)
      load(rows, { name: file.name, source: file.name })
    })

  const findTables = () =>
    guarded(async () => {
      setTables(null)
      const res = await fetch('/api/table?url=' + encodeURIComponent(url.trim()))
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'net')
      setTables(body.tables)
    })

  const loadWB = () =>
    guarded(async () => {
      const api = `https://api.worldbank.org/v2/country/${countries.join(';')}/indicator/${ind}?format=json&per_page=2000&date=${from}:${to}`
      const res = await fetch(api).catch(() => null)
      if (!res?.ok) throw new Error('net')
      const [, rows] = await res.json()
      if (!rows?.length) throw new Error('wb')
      const label = t.indicators[ind]
      const table = [['Country', 'ISO3', 'Year', label], ...rows.map((r) => [r.country.value, r.countryiso3code, r.date, r.value == null ? '' : String(r.value)])]
      load(table, { name: `World Bank ${ind}`, source: `World Bank Open Data (${ind})`, title: label })
    })

  return (
    <div className="importer card">
      <div className="imp-tabs" role="tablist">
        {Object.entries(t.tabs).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="imp-body">
        {tab === 'file' && (
          <div
            className="dropzone big"
            onClick={() => input.current.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              onFile(e.dataTransfer.files[0])
            }}
            role="button"
            tabIndex={0}
          >
            <span className="dz-icon">⬆</span>
            <span>{t.fileDrop}</span>
            <input ref={input} type="file" hidden accept=".csv,.tsv,.txt,.xlsx,.xls,.ods,.json" onChange={(e) => onFile(e.target.files[0])} />
          </div>
        )}
        {tab === 'paste' && (
          <div className="imp-col">
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t.pastePh} rows={6} dir="auto" />
            <button className="btn" disabled={!paste.trim() || busy} onClick={() => guarded(async () => load(parseText(paste), { name: 'Pasted data', source: '' }))}>
              {t.pasteBtn}
            </button>
          </div>
        )}
        {tab === 'web' && (
          <div className="imp-col">
            <div className="imp-row">
              <input className="text-in" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.webPh} dir="ltr" onKeyDown={(e) => e.key === 'Enter' && url && findTables()} />
              <button className="btn" disabled={!/^https?:\/\/.+/.test(url.trim()) || busy} onClick={findTables}>
                {busy ? t.loading : t.webBtn}
              </button>
            </div>
            <p className="muted small">{t.webHint}</p>
            {tables && (
              <div className="table-pick">
                <span className="small">{t.webPick}</span>
                {tables.map((tb, i) => (
                  <button key={i} className="pick" onClick={() => load(tb.rows, { name: tb.caption || new URL(url).hostname, source: new URL(url).hostname })}>
                    <b dir="auto">{tb.caption || `Table ${i + 1}`}</b>
                    <span className="muted small" dir="ltr">{tb.size} · {tb.rows[0].slice(0, 4).join(' · ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'wb' && (
          <div className="imp-col">
            <div className="imp-grid">
              <label>
                <span>{t.wbIndicator}</span>
                <select value={ind} onChange={(e) => setInd(e.target.value)}>
                  {INDICATORS.map((id) => (
                    <option key={id} value={id}>{t.indicators[id]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t.wbFrom}</span>
                <input type="number" min="1960" max="2025" value={from} onChange={(e) => setFrom(+e.target.value)} />
              </label>
              <label>
                <span>{t.wbTo}</span>
                <input type="number" min="1960" max="2025" value={to} onChange={(e) => setTo(+e.target.value)} />
              </label>
            </div>
            <span className="small">{t.wbCountries}</span>
            <div className="facet-chips" dir="ltr">
              {COUNTRIES.map(([iso, name]) => {
                const on = countries.includes(iso)
                return (
                  <button
                    key={iso}
                    className={'fchip' + (on ? ' sel' : '')}
                    disabled={!on && countries.length >= 6}
                    onClick={() => setCountries(on ? countries.filter((c) => c !== iso) : [...countries, iso])}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
            <div className="imp-row">
              <button className="btn" disabled={!countries.length || from > to || busy} onClick={loadWB}>
                {busy ? t.loading : t.wbBtn}
              </button>
              <span className="muted small">{t.wbHint}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CleaningReport({ t, ds }) {
  return (
    <section className="block" id="dd-report">
      <div className="section-head">
        <h2>{t.clean}</h2>
        <p className="muted">
          <span dir="ltr">{ds.name}</span> · {t.cleanSub(ds.rawRows, ds.data.length, ds.columns.length)}
        </p>
      </div>
      <div className="card clean-log">
        {ds.log.length === 0 && <p className="muted">{t.logNone}</p>}
        {ds.log.map((l) => (
          <div key={l.code} className={'log-row' + (l.code === 'unparsable' ? ' warn' : '')}>
            <span className="log-icon">{l.code === 'unparsable' ? '!' : '✓'}</span>
            <span>{t.log[l.code](l.n, l)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Profile({ t, ds, locale }) {
  const prof = useMemo(() => profile(ds.columns, ds.data), [ds])
  const f = makeFormat(locale, false)
  return (
    <section className="block">
      <div className="section-head">
        <h2>{t.columns}</h2>
      </div>
      <div className="profile-grid">
        {prof.map((p) => (
          <div className="card prof" key={p.key}>
            <div className="prof-head">
              <b dir="auto">{p.name}</b>
              <span className={'type-badge ' + p.type}>{t.types[p.type]}</span>
            </div>
            <div className="prof-meta">
              <span>{Math.round((p.filled / ds.data.length) * 100)}% {t.filled}</span>
              <span>{f.full(p.unique)} {t.unique}</span>
            </div>
            {p.spark && (
              <>
                <svg className="spark" viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
                  {p.spark.map((v, i) => {
                    const m = Math.max(...p.spark) || 1
                    const h = Math.max(v ? 2 : 0, (v / m) * 26)
                    return <rect key={i} x={i * 10 + 1} y={28 - h} width="8" height={h} rx="1.5" />
                  })}
                </svg>
                <div className="prof-stats" dir="ltr">
                  <span>{t.min} {f.axis(p.min)}</span>
                  <span>{t.mean} {f.axis(p.mean)}</span>
                  <span>{t.max} {f.axis(p.max)}</span>
                </div>
              </>
            )}
            {p.top && (
              <ul className="prof-top">
                {p.top.map(([v, n]) => (
                  <li key={v}>
                    <span dir="auto">{v}</span>
                    <b>{n}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function Workbench({ t, ds, q, setQ, locale, title, setTitle, source, setSource }) {
  const svgRef = useRef(null)
  const [view, setView] = useState('chart')
  const [toast, setToast] = useState(null)
  const { columns, data } = ds
  const result = useMemo(() => runQuery(columns, data, q), [columns, data, q])
  const set = (patch) => setQ({ ...q, ...patch })
  const metricCol = columns.find((c) => c.key === q.metric)
  const xCol = columns.find((c) => c.key === q.groupBy)
  const yLabel = q.agg === 'count' ? t.aggs.count : `${t.aggs[q.agg]} · ${metricCol?.name || ''}`
  const percent = !!metricCol?.percent && !['count', 'sum'].includes(q.agg)
  const fmt = makeFormat(locale, percent)
  const headline = title || `${yLabel}${xCol ? ` · ${xCol.name}` : ''}`
  const fileBase = (title || ds.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chart'
  const topValues = (key) => [...new Set(data.map((o) => o[key]).filter((v) => v != null))].slice(0, 50)

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  async function copyEmbed() {
    const u = embedUrl({ result, title: headline, source: source ? `${t.source}: ${source}` : '', percent, locale, yLabel, xLabel: xCol?.name })
    if (!u) return flash(t.tooBig)
    const code = `<iframe src="${u}" width="100%" height="460" style="border:0" title="${headline.replace(/"/g, '&quot;')}" loading="lazy"></iframe>`
    try {
      await navigator.clipboard.writeText(code)
      flash(t.copied)
    } catch {
      window.prompt(t.exp.embed, code)
    }
  }

  function resultCSV() {
    if (result.kind !== 'grouped') return save(new Blob([toCSV(columns, result.rows)], { type: 'text/csv' }), fileBase + '.csv')
    const xs = [...new Set(result.series.flatMap((s) => s.points.map((p) => p[0])))]
    const cols = [{ key: 'x', name: xCol.name }, ...result.series.map((s, i) => ({ key: 's' + i, name: result.series.length > 1 ? String(s.name) : yLabel }))]
    const rows = xs.map((x) => Object.fromEntries([['x', x], ...result.series.map((s, i) => ['s' + i, s.points.find((p) => p[0] === x)?.[1] ?? ''])]))
    save(new Blob([toCSV(cols, rows)], { type: 'text/csv' }), fileBase + '.csv')
  }

  return (
    <section className="block">
      <div className="section-head">
        <h2>{t.ask}</h2>
      </div>
      <div className="card query">
        <div className="q-filters">
          <span className="q-label">{t.filters}</span>
          {q.filters.map((f, i) => {
            const col = columns.find((c) => c.key === f.col) || columns[0]
            const upd = (patch) => set({ filters: q.filters.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div className="q-filter" key={i}>
                <select value={f.col} onChange={(e) => upd({ col: e.target.value, op: OPS[columns.find((c) => c.key === e.target.value).type][0], value: '' })}>
                  {columns.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </select>
                <select value={f.op} onChange={(e) => upd({ op: e.target.value })}>
                  {OPS[col.type].map((o) => (
                    <option key={o} value={o}>{t.ops[o]}</option>
                  ))}
                </select>
                <input list={`dl-${i}`} value={f.value} onChange={(e) => upd({ value: e.target.value })} placeholder={t.value} dir="auto" />
                <datalist id={`dl-${i}`}>
                  {topValues(f.col).map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                <button className="x-btn" aria-label="Remove filter" onClick={() => set({ filters: q.filters.filter((_, j) => j !== i) })}>×</button>
              </div>
            )
          })}
          <button className="link-btn" onClick={() => set({ filters: [...q.filters, { col: columns[0].key, op: OPS[columns[0].type][0], value: '' }] })}>
            {t.addFilter}
          </button>
        </div>
        <div className="q-row">
          <label>
            <span>{t.groupBy}</span>
            <select value={q.groupBy} onChange={(e) => set({ groupBy: e.target.value, seriesBy: e.target.value === q.seriesBy ? '' : q.seriesBy })}>
              <option value="">{t.none}</option>
              {columns.filter((c) => c.type !== 'number').map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.splitBy}</span>
            <select value={q.seriesBy} onChange={(e) => set({ seriesBy: e.target.value })} disabled={!q.groupBy}>
              <option value="">{t.none}</option>
              {columns.filter((c) => c.type === 'text' && c.key !== q.groupBy).map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.measure}</span>
            <select value={q.agg} onChange={(e) => set({ agg: e.target.value })}>
              {AGGS.filter((a) => a === 'count' || columns.some(isNum)).map((a) => (
                <option key={a} value={a}>{t.aggs[a]}</option>
              ))}
            </select>
          </label>
          {q.agg !== 'count' && (
            <label>
              <span>{t.of}</span>
              <select value={q.metric} onChange={(e) => set({ metric: e.target.value })}>
                {columns.filter(isNum).map((c) => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="card chart-card">
        <div className="chart-meta">
          <label className="grow">
            <span>{t.headline}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.headlinePh} dir="auto" />
          </label>
          <label>
            <span>{t.source}</span>
            <input value={source} onChange={(e) => setSource(e.target.value)} dir="auto" />
          </label>
          <div className="view-toggle">
            <button className={view === 'chart' ? 'active' : ''} onClick={() => setView('chart')}>{t.view.chart}</button>
            <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>{t.view.table}</button>
          </div>
        </div>

        {result.kind !== 'grouped' || !result.series.length ? (
          <p className="muted">{t.noChart}</p>
        ) : view === 'chart' ? (
          <div dir="ltr">
            <Chart ref={svgRef} result={result} title={headline} source={source ? `${t.source}: ${source}` : ''} locale={locale} percent={percent} yLabel={yLabel} xLabel={xCol?.name} />
          </div>
        ) : (
          <ResultTable result={result} xName={xCol?.name} yLabel={yLabel} fmt={fmt} />
        )}
        {result.dropped > 0 && <p className="muted small">{t.dropped(result.dropped)}</p>}

        <div className="export-row">
          <button className="btn ghost" disabled={view !== 'chart' || result.kind !== 'grouped'} onClick={() => downloadPNG(svgRef.current, fileBase)}>⬇ {t.exp.png}</button>
          <button className="btn ghost" disabled={view !== 'chart' || result.kind !== 'grouped'} onClick={() => downloadSVG(svgRef.current, fileBase)}>⬇ {t.exp.svg}</button>
          <button className="btn ghost" onClick={resultCSV}>⬇ {t.exp.csv}</button>
          <button className="btn ghost" onClick={() => save(new Blob([toCSV(columns, data)], { type: 'text/csv' }), 'cleaned-' + fileBase + '.csv')}>⬇ {t.exp.clean}</button>
          <button className="btn" disabled={result.kind !== 'grouped'} onClick={copyEmbed}>&lt;/&gt; {t.exp.embed}</button>
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    </section>
  )
}

function ResultTable({ result, xName, yLabel, fmt }) {
  const xs = [...new Set(result.series.flatMap((s) => s.points.map((p) => p[0])))]
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>{xName}</th>
            {result.series.map((s) => (
              <th key={s.name} className="num">{result.series.length > 1 ? s.name : yLabel}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xs.map((x) => (
            <tr key={x}>
              <td dir="auto">{String(x)}</td>
              {result.series.map((s) => (
                <td key={s.name} className="num">{fmt.full(s.points.find((p) => p[0] === x)?.[1])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DataTable({ t, ds, locale }) {
  const [page, setPage] = useState(0)
  const [term, setTerm] = useState('')
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const rows = term ? ds.data.filter((o) => Object.values(o).some((v) => v != null && String(v).toLowerCase().includes(term.toLowerCase()))) : ds.data
  const per = 15
  const pages = Math.max(1, Math.ceil(rows.length / per))
  const shown = rows.slice(page * per, page * per + per)
  return (
    <section className="block">
      <div className="section-head">
        <h2>{t.data}</h2>
        <p className="muted">{t.rows(rows.length)}</p>
      </div>
      <div className="card">
        <input className="news-search" value={term} onChange={(e) => { setTerm(e.target.value); setPage(0) }} placeholder={t.search} dir="auto" />
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {ds.columns.map((c) => (
                  <th key={c.key} className={c.type === 'number' ? 'num' : ''}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((o, i) => (
                <tr key={i}>
                  {ds.columns.map((c) => (
                    <td key={c.key} className={(c.type === 'number' ? 'num' : '') + (o[c.key] == null ? ' null' : '')} dir="auto">
                      {o[c.key] == null ? '–' : c.type === 'number' ? nf.format(o[c.key]) : String(o[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="pager">
            <button className="btn ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>{t.prev}</button>
            <span className="muted small">{page + 1} / {pages}</span>
            <button className="btn ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t.next}</button>
          </div>
        )}
      </div>
    </section>
  )
}
