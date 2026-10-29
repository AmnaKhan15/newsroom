import React from 'react'
import { Chart } from './Chart.jsx'

// The whole chart (aggregated data, title, source) travels in the URL hash, so an
// embedded widget needs no server or database and can be pasted into any CMS.
const MAX_LEN = 12000

function b64url(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function embedUrl({ result, title, source, percent, locale, yLabel, xLabel }) {
  const spec = {
    v: 1, t: title, s: source, p: percent ? 1 : 0, l: locale, y: yLabel, x: xLabel, o: result.ordered ? 1 : 0,
    d: result.series.map((s) => ({ n: s.name, pts: s.points.slice(0, 120) })),
  }
  const hash = b64url(JSON.stringify(spec))
  if (hash.length > MAX_LEN) return null
  return `${location.origin}${location.pathname}#embed=${hash}`
}

export function readEmbed() {
  const m = location.hash.match(/^#embed=(.+)$/)
  if (!m) return null
  try {
    return JSON.parse(unb64url(m[1]))
  } catch {
    return { error: true }
  }
}

export function EmbedView({ spec }) {
  if (spec.error) return <p style={{ padding: 16, fontFamily: 'system-ui' }}>This chart link is damaged.</p>
  const result = { ordered: !!spec.o, series: spec.d.map((s) => ({ name: s.n, points: s.pts })) }
  return (
    <div className="embed-page">
      <Chart result={result} title={spec.t} source={spec.s} locale={spec.l} percent={!!spec.p} yLabel={spec.y} xLabel={spec.x} />
      <a className="embed-credit" href={location.origin} target="_blank" rel="noreferrer">
        Made with Newsroom
      </a>
    </div>
  )
}
