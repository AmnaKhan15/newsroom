import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react'

// Validated reference palette (dataviz skill): fixed categorical order, light and dark steps.
const PALETTE = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835',
  },
}

function useDark() {
  const q = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(!!q?.matches)
  useEffect(() => {
    if (!q) return
    const on = (e) => setDark(e.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [q])
  return dark
}

function useWidth(ref) {
  const [w, setW] = useState(640)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function niceTicks(lo, hi, count = 5) {
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const start = Math.floor(lo / step) * step
  const ticks = []
  // keep stepping until the top tick covers the maximum, so no mark leaves the plot
  for (let v = start; ticks.length < 50; v += step) {
    ticks.push(+v.toFixed(10))
    if (v >= hi - 1e-9) break
  }
  return ticks
}

export function makeFormat(locale, percent) {
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const sfx = percent ? '%' : ''
  return { axis: (v) => compact.format(v) + sfx, full: (v) => (v == null ? '–' : full.format(v) + sfx) }
}

function wrap(text, max) {
  const words = String(text).split(' ')
  const lines = ['']
  words.forEach((w) => {
    if ((lines[lines.length - 1] + ' ' + w).trim().length > max && lines[lines.length - 1]) lines.push(w)
    else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim()
  })
  return lines.slice(0, 2)
}

// result: { series:[{name, points:[[x,y]]}], ordered }
export const Chart = forwardRef(function Chart({ result, title, source, locale, percent, xLabel, yLabel, height = 380 }, svgRef) {
  const box = useRef(null)
  const width = useWidth(box)
  const dark = useDark()
  const pal = dark ? PALETTE.dark : PALETTE.light
  const [hover, setHover] = useState(null)
  const fmt = useMemo(() => makeFormat(locale, percent), [locale, percent])
  const kind = result.ordered ? 'line' : 'bar'
  const series = result.series
  const multi = series.length > 1

  const titleLines = wrap(title || '', Math.floor(width / 10))
  const top = 18 + titleLines.length * 24 + (multi ? 42 : 14)
  const bottom = 46

  let body = null
  let tooltip = null

  if (kind === 'line') {
    const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => (a > b ? 1 : -1))
    const ys = series.flatMap((s) => s.points.map((p) => p[1])).filter((v) => v != null)
    const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys))
    const lo = ticks[0]
    const hi = ticks[ticks.length - 1]
    const left = 14 + Math.max(...ticks.map((t) => fmt.axis(t).length)) * 7.2
    const endLabel = multi && series.length <= 4 ? Math.min(140, Math.max(...series.map((s) => String(s.name).length)) * 7 + 14) : 0
    const right = 16 + endLabel
    const iw = width - left - right
    const ih = height - top - bottom
    const X = (i) => left + (xs.length === 1 ? iw / 2 : (i / (xs.length - 1)) * iw)
    const Y = (v) => top + ih - ((v - lo) / (hi - lo)) * ih
    const xi = new Map(xs.map((x, i) => [x, i]))
    const every = Math.ceil(xs.length / Math.max(2, Math.floor(iw / 70)))
    // End labels: start at each line's last value, then push apart so none overlap
    const ends = series
      .map((s, si) => {
        const pts = s.points.filter((p) => p[1] != null)
        const last = pts[pts.length - 1]
        return last && { si, name: s.name, x: X(xi.get(last[0])) + 8, y: Y(last[1]) + 4 }
      })
      .filter(Boolean)
      .sort((a, b) => a.y - b.y)
    ends.forEach((e, i) => {
      if (i && e.y - ends[i - 1].y < 15) e.y = ends[i - 1].y + 15
    })
    body = (
      <g>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + iw} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? pal.axis : pal.grid} strokeWidth="1" />
            <text x={left - 8} y={Y(t) + 4} textAnchor="end" fontSize="12" fill={pal.muted}>{fmt.axis(t)}</text>
          </g>
        ))}
        {xs.map((x, i) => i % every === 0 && (
          <text key={x} x={X(i)} y={top + ih + 20} textAnchor="middle" fontSize="12" fill={pal.muted}>{String(x)}</text>
        ))}
        {series.map((s, si) => {
          const pts = s.points.filter((p) => p[1] != null)
          const d = pts.map((p, j) => `${j ? 'L' : 'M'}${X(xi.get(p[0])).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')
          return <path key={s.name} d={d} fill="none" stroke={pal.series[si]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        })}
        {endLabel > 0 &&
          ends.map((e) => (
            <text key={e.name} x={e.x} y={e.y} fontSize="12" fill={pal.ink2}>{String(e.name).slice(0, 18)}</text>
          ))}
        {hover != null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={top} y2={top + ih} stroke={pal.axis} strokeWidth="1" />
            {series.map((s, si) => {
              const p = s.points.find((q) => q[0] === xs[hover])
              return p && p[1] != null ? <circle key={s.name} cx={X(hover)} cy={Y(p[1])} r="4.5" fill={pal.series[si]} stroke={pal.surface} strokeWidth="2" /> : null
            })}
          </g>
        )}
        <rect
          x={left} y={top} width={iw} height={ih} fill="transparent"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const i = Math.round(((e.clientX - r.left) / r.width) * (xs.length - 1))
            setHover(Math.max(0, Math.min(xs.length - 1, i)))
          }}
          onMouseLeave={() => setHover(null)}
        />
      </g>
    )
    if (hover != null) {
      const rows = series
        .map((s, si) => ({ name: s.name, c: pal.series[si], v: s.points.find((q) => q[0] === xs[hover])?.[1] }))
        .filter((r) => r.v != null)
        .sort((a, b) => b.v - a.v)
      tooltip = { x: X(hover), y: top, head: String(xs[hover]), rows }
    }
  } else {
    const cats = series[0].points.map((p) => p[0]).slice(0, 20)
    const vals = series.flatMap((s) => s.points.filter((p) => cats.includes(p[0])).map((p) => p[1] || 0))
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals))
    const lo = ticks[0]
    const hi = ticks[ticks.length - 1]
    const left = Math.min(width * 0.38, 16 + Math.max(...cats.map((c) => String(c).length)) * 7)
    const right = 24
    const band = multi ? Math.max(30, series.length * 12 + 12) : 30
    const ih = cats.length * band
    const h = top + ih + bottom
    const iw = width - left - right
    const Xv = (v) => left + ((v - lo) / (hi - lo)) * iw
    const bh = multi ? (band - 12) / series.length - 2 : 16
    body = (
      <g>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={Xv(t)} x2={Xv(t)} y1={top} y2={top + ih} stroke={t === 0 ? pal.axis : pal.grid} strokeWidth="1" />
            <text x={Xv(t)} y={top + ih + 20} textAnchor="middle" fontSize="12" fill={pal.muted}>{fmt.axis(t)}</text>
          </g>
        ))}
        {cats.map((c, ci) => {
          const y0 = top + ci * band + 6
          return (
            <g key={String(c)} onMouseEnter={() => setHover(ci)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={top + ci * band} width={width} height={band} fill={hover === ci ? pal.grid : 'transparent'} opacity="0.45" />
              <text x={left - 8} y={y0 + (band - 12) / 2 + 4} textAnchor="end" fontSize="12.5" fill={pal.ink2}>
                {String(c).length > 26 ? String(c).slice(0, 25) + '…' : String(c)}
              </text>
              {series.map((s, si) => {
                const v = s.points.find((p) => p[0] === c)?.[1]
                if (v == null) return null
                const x0 = Xv(Math.min(0, v))
                const w = Math.max(1, Math.abs(Xv(v) - Xv(0)))
                const y = y0 + si * (bh + 2)
                const r = Math.min(4, w / 2, bh / 2)
                // rounded only at the data end, square at the baseline
                const d = v >= 0
                  ? `M${x0},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${bh - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`
                  : `M${x0 + w},${y}h-${w - r}a${r},${r} 0 0 0 -${r},${r}v${bh - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${w - r}z`
                return <path key={s.name} d={d} fill={pal.series[si]} />
              })}
            </g>
          )
        })}
      </g>
    )
    height = h
    if (hover != null) {
      const c = cats[hover]
      tooltip = {
        x: left + iw * 0.6, y: top + hover * band + band, head: String(c),
        rows: series.map((s, si) => ({ name: multi ? s.name : yLabel, c: pal.series[si], v: s.points.find((p) => p[0] === c)?.[1] })),
      }
    }
  }

  return (
    <div className="chart-box" ref={box}>
      <svg ref={svgRef} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg" style={{ background: pal.surface, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <rect width={width} height={height} fill={pal.surface} />
        {titleLines.map((l, i) => (
          <text key={i} x="16" y={30 + i * 24} fontSize="18" fontWeight="700" fill={pal.ink}>{l}</text>
        ))}
        {multi && (
          <g transform={`translate(16, ${18 + titleLines.length * 24 + 10})`}>
            {series.reduce((acc, s, si) => {
              const x = acc.x
              acc.items.push(
                <g key={s.name} transform={`translate(${x},0)`}>
                  <rect width="12" height="12" rx="3" fill={pal.series[si]} />
                  <text x="18" y="10.5" fontSize="12.5" fill={pal.ink2}>{String(s.name).slice(0, 22)}</text>
                </g>,
              )
              acc.x += 30 + Math.min(22, String(s.name).length) * 7
              return acc
            }, { x: 0, items: [] }).items}
          </g>
        )}
        {body}
        {xLabel && kind === 'line' && <text x={width - 16} y={height - 26} textAnchor="end" fontSize="11.5" fill={pal.muted}>{xLabel}</text>}
        <text x="16" y={height - 10} fontSize="11.5" fill={pal.muted}>{source}</text>
      </svg>
      {tooltip && (
        <div className="chart-tip" style={{ left: Math.min(tooltip.x + 12, width - 200), top: tooltip.y }}>
          <b>{tooltip.head}</b>
          {tooltip.rows.map((r) => (
            <div key={r.name} className="tip-row">
              <span className="tip-key" style={{ background: r.c }} />
              <span className="tip-name">{r.name}</span>
              <span className="tip-val">{fmt.full(r.v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export function downloadSVG(svg, name) {
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
  save(blob, name + '.svg')
}

export function downloadPNG(svg, name) {
  const xml = new XMLSerializer().serializeToString(svg)
  const img = new Image()
  const w = svg.width.baseVal.value
  const h = svg.height.baseVal.value
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = w * 2
    c.height = h * 2
    const ctx = c.getContext('2d')
    ctx.scale(2, 2)
    ctx.drawImage(img, 0, 0)
    c.toBlob((b) => save(b, name + '.png'))
  }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
}

export function save(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
