import React, { useMemo, useState } from 'react'

const WEEK = 7 * 864e5

// Interactive coverage view: every chart doubles as a filter for the article list.
export function NewsExplorer({ t, locale, articles, countries, terms }) {
  const [week, setWeek] = useState(null)
  const [country, setCountry] = useState(null)
  const [term, setTerm] = useState(null)
  const [language, setLanguage] = useState(null)
  const [text, setText] = useState('')
  const [view, setView] = useState('cards')
  const [all, setAll] = useState(false)

  const { weeks, weekOf } = useMemo(() => {
    const dated = articles.filter((a) => a.date)
    if (!dated.length) return { weeks: [], weekOf: {} }
    const start = new Date(dated.map((a) => a.date).sort()[0])
    start.setDate(start.getDate() - start.getDay())
    const weekOf = {}
    dated.forEach((a) => (weekOf[a.id] = Math.floor((new Date(a.date) - start) / WEEK)))
    const n = Math.max(...Object.values(weekOf)) + 1
    const counts = Array(n).fill(0)
    Object.values(weekOf).forEach((i) => counts[i]++)
    return { weeks: counts.map((count, i) => ({ date: new Date(start.getTime() + i * WEEK), count })), weekOf }
  }, [articles])

  const langs = useMemo(() => {
    const c = {}
    articles.forEach((a) => a.language && (c[a.language] = (c[a.language] || 0) + 1))
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [articles])

  const filtered = articles.filter(
    (a) =>
      (week === null || weekOf[a.id] === week) &&
      (!country || a.country === country) &&
      (!language || a.language === language) &&
      (!term || a.title.toLowerCase().includes(term)) &&
      (!text || (a.title + ' ' + a.domain).toLowerCase().includes(text.toLowerCase())),
  )
  const active = week !== null || country || term || language || text
  const shown = all ? filtered : filtered.slice(0, 12)
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const fmtLong = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })

  function clear() {
    setWeek(null)
    setCountry(null)
    setTerm(null)
    setLanguage(null)
    setText('')
  }

  if (!articles.length) return null
  const maxW = Math.max(1, ...weeks.map((w) => w.count))
  const maxC = countries[0]?.[1] || 1

  return (
    <div className="explorer">
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">{t.timeline}</h3>
          <div className="timeline" dir="ltr">
            <div className="tl-bars">
              {weeks.map((w, i) => (
                <button
                  key={i}
                  className={'tl-col' + (week === i ? ' sel' : '') + (week !== null && week !== i ? ' dim' : '')}
                  onClick={() => setWeek(week === i ? null : i)}
                  disabled={!w.count}
                  title={`${fmt.format(w.date)}: ${w.count}`}
                >
                  <span className="tl-n">{w.count || ''}</span>
                  <span className="tl-bar" style={{ height: `${Math.max((w.count / maxW) * 100, w.count ? 6 : 2)}%` }} />
                </button>
              ))}
            </div>
            {weeks.length > 0 && (
              <div className="tl-axis">
                <span>{fmt.format(weeks[0].date)}</span>
                <span>{fmt.format(weeks[weeks.length - 1].date)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">{t.topCountries}</h3>
          <div className="bars">
            {countries.slice(0, 7).map(([name, n]) => (
              <button
                key={name}
                className={'bar-row' + (country === name ? ' sel' : '') + (country && country !== name ? ' dim' : '')}
                onClick={() => setCountry(country === name ? null : name)}
              >
                <span className="bar-name" dir="ltr">{name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(n / maxC) * 100}%` }} />
                </span>
                <span className="bar-n">{n}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {terms.length > 0 && (
        <div className="facet">
          <span className="facet-label">{t.threads}</span>
          <div className="facet-chips" dir="ltr">
            {terms.map(({ term: w, count }) => (
              <button key={w} className={'fchip' + (term === w ? ' sel' : '')} onClick={() => setTerm(term === w ? null : w)}>
                {w} <b>{count}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      {langs.length > 1 && (
        <div className="facet">
          <span className="facet-label">{t.languages}</span>
          <div className="facet-chips" dir="ltr">
            {langs.map(([l, n]) => (
              <button key={l} className={'fchip' + (language === l ? ' sel' : '')} onClick={() => setLanguage(language === l ? null : l)}>
                {l} <b>{n}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="news-toolbar">
        <input className="news-search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t.filterNews} dir="auto" />
        <span className="muted small">{t.showing(filtered.length, articles.length)}</span>
        {active && (
          <button className="link-btn" onClick={clear}>
            {t.clear}
          </button>
        )}
        <div className="view-toggle">
          <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>
            {t.cards}
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            {t.list}
          </button>
        </div>
      </div>

      {filtered.length === 0 && <p className="muted">{t.noMatch}</p>}

      {view === 'cards' ? (
        <div className="news-grid">
          {shown.map((a) => (
            <a className="news-card" key={a.id} href={a.url} target="_blank" rel="noreferrer">
              <div className="news-img">
                {a.image ? <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} /> : null}
                <span className="news-domain">{a.domain}</span>
              </div>
              <div className="news-body">
                <span className="news-title" dir="auto">{a.title}</span>
                <span className="muted small" dir="ltr">
                  <span className="sid">{a.id}</span> {a.country || '—'} · {a.date ? fmtLong.format(new Date(a.date)) : ''}
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="card articles">
          {shown.map((a) => (
            <a className="article" key={a.id} href={a.url} target="_blank" rel="noreferrer">
              <span className="sid">{a.id}</span>
              <div className="article-body">
                <span className="article-title" dir="auto">{a.title}</span>
                <span className="muted small" dir="ltr">
                  {a.domain} · {a.country || '—'} · {a.date ? fmtLong.format(new Date(a.date)) : ''}
                  {a.language && a.language !== 'English' ? ` · ${a.language}` : ''}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
      {filtered.length > 12 && (
        <button className="link-btn more" onClick={() => setAll(!all)}>
          {all ? t.showLess : `${t.showAll} (${filtered.length})`}
        </button>
      )}
    </div>
  )
}
