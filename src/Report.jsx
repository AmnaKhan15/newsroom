import React from 'react'

// A newsroom research memo, rendered off-screen and captured to PDF.
// Rendered as HTML (not drawn with jsPDF text) so Urdu shaping and RTL come out right.
export function Report({ t, lang, locale, topic, sources, analysis, documents, countries, counts, bg, index }) {
  const p = t.pdf
  const today = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const cited = new Set(analysis.claims.flatMap((c) => c.source_ids))
  const articles = sources.articles.filter((a, i) => cited.has(a.id) || i < 12)
  const nf = new Intl.NumberFormat(locale)

  return (
    <div className="rp" dir={lang === 'ur' ? 'rtl' : 'ltr'} lang={lang}>
      <div className="rp-mast">
        <span className="rp-brand">CLAIMLENS · {p.kind.toUpperCase()}</span>
        <span className="rp-review">{p.review}</span>
      </div>
      <div className="rp-slug">
        <span>
          {p.topic}: <b dir="auto">{topic.toUpperCase()}</b>
        </span>
        <span>
          {p.date}: {today}
        </span>
        <span>{p.prepared}</span>
      </div>

      <h1 className="rp-h1" dir="auto">{topic}</h1>
      <p className="rp-lede">
        {t.brief(topic, sources.articles.length, countries.length, sources.papers.length, documents.length)}{' '}
        {t.tally(counts.supported, counts.disputed + counts.misleading, counts.unverified)}
      </p>

      <div className="rp-glance avoid">
        <div><b>{nf.format(sources.articles.length)}</b>{t.statArticles}</div>
        <div><b>{nf.format(countries.length)}</b>{t.statCountries}</div>
        <div><b>{nf.format(sources.papers.length)}</b>{t.statPapers}</div>
        <div><b>{nf.format(sources.factchecks.length)}</b>{t.statFactchecks}</div>
        {documents.length > 0 && <div><b>{documents.length}</b>{t.statDocs}</div>}
      </div>

      {bg?.extract && (
        <div className="avoid">
          <h2 className="rp-h2">{t.background}</h2>
          <p className="rp-p" dir="auto">
            {bg.extract} <i>(Wikipedia: {bg.title})</i>
          </p>
        </div>
      )}

      <h2 className="rp-h2">{p.claimTable}</h2>
      <table className="rp-table">
        <thead>
          <tr>
            {p.th.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {analysis.claims.map((c, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td dir="auto">
                “{c.claim}”<br />
                <small>
                  {t.origin[c.kind]} · {c.source_id}
                </small>
              </td>
              <td>
                <span className={'rp-status ' + c.status}>{t.status[c.status]}</span>
              </td>
              <td>{t.basis[c.basis.basis](c.basis)}</td>
              <td dir="ltr">{c.source_ids.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(analysis.known.length > 0 || analysis.unknown.length > 0) && (
        <div className="rp-two avoid">
          <div>
            <h2 className="rp-h2">{t.known}</h2>
            <ul className="rp-ul">
              {analysis.known.map((k, i) => (
                <li key={i} dir="auto">
                  {k.text} [{k.id}]
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="rp-h2">{t.unknown}</h2>
            <ul className="rp-ul">
              {analysis.unknown.map((k, i) => (
                <li key={i} dir="auto">
                  {k.text} [{k.id}]
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="avoid">
        <h2 className="rp-h2">{t.angles}</h2>
        <ol className="rp-ul">
          {analysis.story_angles.map((a, i) => (
            <li key={i}>{t.angle[a.type](a)}</li>
          ))}
        </ol>
      </div>

      {analysis.documents.length > 0 && (
        <div className="avoid">
          <h2 className="rp-h2">{p.docs}</h2>
          <ul className="rp-ul">
            {analysis.documents.map((d) => (
              <li key={d.id}>
                <b>{d.id}</b> <span dir="ltr">{d.name}</span> · {d.words} {t.words} · {t.docLine(d.claims, d.corroborated)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {countries.length > 0 && (
        <div className="avoid">
          <h2 className="rp-h2">{t.topCountries}</h2>
          <p className="rp-p" dir="ltr">
            {countries.slice(0, 8).map(([c, n]) => `${c} (${n})`).join(' · ')}
          </p>
        </div>
      )}

      <h2 className="rp-h2">{p.sources}</h2>
      <ol className="rp-sources" dir="ltr">
        {articles.map((a) => (
          <li key={a.id}>
            <b>{a.id}</b> {a.title}. <i>{a.domain}</i>, {a.date}. <span className="rp-url">{a.url}</span>
          </li>
        ))}
        {sources.papers.map((r) => (
          <li key={r.id}>
            <b>{r.id}</b> {r.authors.join(', ')} ({r.year}). {r.title}. <i>{r.venue}</i>. <span className="rp-url">{r.url}</span>
          </li>
        ))}
        {sources.factchecks.map((f) => (
          <li key={f.id}>
            <b>{f.id}</b> {f.publisher}: “{f.claim}” rated {f.rating}. <span className="rp-url">{f.url}</span>
          </li>
        ))}
        {documents.map((d) => (
          <li key={d.id}>
            <b>{d.id}</b> {index[d.id]?.title}
          </li>
        ))}
      </ol>

      <div className="rp-method avoid">
        <b>{p.method}.</b> {t.methodText}
      </div>
    </div>
  )
}

export async function downloadReport(el, topic) {
  const html2pdf = (await import('html2pdf.js')).default
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief'
  await html2pdf()
    .set({
      margin: [12, 12, 14, 12],
      filename: `claimlens-brief-${slug}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'li', '.avoid'] },
    })
    .from(el)
    .toPdf()
    .get('pdf')
    .then((pdf) => {
      const n = pdf.internal.getNumberOfPages()
      const w = pdf.internal.pageSize.getWidth()
      const h = pdf.internal.pageSize.getHeight()
      for (let i = 1; i <= n; i++) {
        pdf.setPage(i)
        pdf.setFontSize(8)
        pdf.setTextColor(140)
        pdf.text(`ClaimLens  ·  ${i} / ${n}`, w - 12, h - 6, { align: 'right' })
      }
    })
    .save()
}
