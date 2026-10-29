// Data engine for the Data Desk: parse messy tables, clean them with a
// logged, reversible-in-spirit pipeline, profile columns and run queries.
// Pure functions, no UI, so every step can be explained to a reader.
import Papa from 'papaparse'

const NULL_TOKENS = new Set(['', 'n/a', 'na', 'n.a.', 'nan', '-', '–', '—', '..', '...', 'null', 'none', '#n/a', '?', 'not available', 'k.a.', 'keine angabe'])
const FOOTNOTE = /\s*(\[[^\]]{1,6}\]|\*+|†|‡)\s*$/

// ---------- parsing ----------

export function parseText(text) {
  const { data } = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: false })
  return data
}

export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
    return { rows, sheet: wb.SheetNames[0], sheets: wb.SheetNames.length }
  }
  const text = await file.text()
  if (ext === 'json') return { rows: jsonToRows(JSON.parse(text)) }
  return { rows: parseText(text) }
}

export function jsonToRows(json) {
  const list = Array.isArray(json) ? json : Object.values(json).find(Array.isArray) || []
  const objs = list.filter((o) => o && typeof o === 'object' && !Array.isArray(o))
  if (!objs.length) return Array.isArray(list[0]) ? list : []
  const keys = [...new Set(objs.flatMap(Object.keys))]
  return [keys, ...objs.map((o) => keys.map((k) => (o[k] == null ? '' : typeof o[k] === 'object' ? JSON.stringify(o[k]) : String(o[k]))))]
}

// ---------- value parsing ----------

const SCALE = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mio: 1e6, million: 1e6, bn: 1e9, b: 1e9, billion: 1e9, mrd: 1e9, crore: 1e7, lakh: 1e5 }

// Returns { value, percent, currency } or null when the cell is not a number.
export function parseNumber(raw) {
  // typographic minus (U+2212) and dashes are common in published tables
  let s = String(raw).trim().replace(/^[−–‒]/, '-')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  const currency = /^[$€£¥₹]|^(rs\.?|pkr|usd|eur)\s?/i.test(s) || /\s?(€|\$|pkr|usd|eur)$/i.test(s)
  s = s.replace(/^[$€£¥₹]|^(rs\.?|pkr|usd|eur)\s?/i, '').replace(/\s?(€|\$|pkr|usd|eur)$/i, '')
  const percent = /%$/.test(s)
  s = s.replace(/%$/, '').trim()
  let mult = 1
  const sm = s.match(/^([+-]?[\d.,\s']+)\s*([a-z]+)\.?$/i)
  if (sm && SCALE[sm[2].toLowerCase()]) {
    mult = SCALE[sm[2].toLowerCase()]
    s = sm[1]
  }
  s = s.replace(/[\s'  ]/g, '')
  if (!/^[+-]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // Both present: whichever comes last is the decimal mark (1,234.5 vs 1.234,5)
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma > -1) {
    const groups = s.split(',')
    // "1,234,567" is grouping; "3,5" is a German decimal
    s = groups.length > 2 || groups[groups.length - 1].length === 3 ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '') // "1.234.567" German grouping
  }
  const v = Number(s)
  if (!Number.isFinite(v)) return null
  return { value: (neg ? -v : v) * mult, percent, currency }
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, mär: 3, mai: 5, okt: 10, dez: 12 }

// Returns an ISO date string (yyyy-mm-dd) or null.
export function parseDate(raw) {
  const s = String(raw).trim()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/) // dd.mm.yyyy or dd/mm/yyyy
  if (m) return +m[2] > 12 ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1])
  m = s.match(/^([a-zä]{3})[a-zä]*\.?\s+(\d{4})$/i) // "Jan 2024", "März 2024"
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[2], MONTHS[m[1].toLowerCase()], 1)
  m = s.match(/^(\d{1,2})\s+([a-zä]{3})[a-zä]*\.?\s+(\d{4})$/i) // "5 March 2024"
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  return null
}

function iso(y, mo, d) {
  if (y < 1800 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ---------- cleaning ----------

const nonEmpty = (r) => r.filter((c) => String(c ?? '').trim() !== '').length

function looksLikeHeader(row) {
  const filled = row.filter((c) => String(c).trim())
  if (filled.length < 2) return false
  const numeric = filled.filter((c) => parseNumber(c) && !/^(19|20)\d{2}$/.test(String(c).trim()))
  return numeric.length / filled.length < 0.5
}

function slugName(name, i) {
  const n = String(name).replace(FOOTNOTE, '').replace(/\s+/g, ' ').trim()
  return n || `Column ${i + 1}`
}

// rows: array of arrays (raw). Returns { columns, data, log }.
export function clean(rawRows) {
  const log = []
  const note = (code, n, extra = {}) => n && log.push({ code, n, ...extra })

  // 1. trim cells, collapse inner whitespace, drop empty rows
  let changedWs = 0
  let rows = rawRows.map((r) =>
    (Array.isArray(r) ? r : [r]).map((c) => {
      const s = String(c ?? '')
      const t = s.replace(/[ \s]+/g, ' ').trim()
      if (t !== s) changedWs++
      return t
    }),
  )
  const before = rows.length
  rows = rows.filter((r) => nonEmpty(r) > 0)
  note('empty_rows', before - rows.length)
  note('whitespace', changedWs)
  if (!rows.length) return { columns: [], data: [], log }

  // 2. find the header: skip title lines above the real table
  const width = Math.max(...rows.map((r) => r.length))
  let h = rows.slice(0, 15).findIndex((r) => nonEmpty(r) >= Math.max(2, Math.ceil(width * 0.5)) && looksLikeHeader(r))
  if (h < 0) h = 0
  note('title_rows', h)
  const header = rows[h]
  let body = rows.slice(h + 1)

  // 3. drop notes/source lines (a single filled cell) and repeated header rows
  const hKey = header.join('|').toLowerCase()
  const b2 = body.filter((r) => nonEmpty(r) > 1 || width === 1)
  note('note_rows', body.length - b2.length)
  const b3 = b2.filter((r) => r.join('|').toLowerCase() !== hKey)
  note('repeat_headers', b2.length - b3.length)
  body = b3

  // 4. headers: name blanks, strip footnotes, de-duplicate
  let renamed = 0
  const seen = {}
  let names = Array.from({ length: width }, (_, i) => {
    let n = slugName(header[i] ?? '', i)
    if (n !== String(header[i] ?? '').trim()) renamed++
    const k = n.toLowerCase()
    seen[k] = (seen[k] || 0) + 1
    if (seen[k] > 1) {
      n = `${n} (${seen[k]})`
      renamed++
    }
    return n
  })
  note('headers', renamed)

  // 5. null tokens and footnote markers in cells
  let nulls = 0
  let footnotes = 0
  body = body.map((r) =>
    names.map((_, i) => {
      let v = r[i] ?? ''
      if (FOOTNOTE.test(v) && v.replace(FOOTNOTE, '')) {
        v = v.replace(FOOTNOTE, '')
        footnotes++
      }
      if (NULL_TOKENS.has(v.toLowerCase())) {
        if (v !== '') nulls++
        return null
      }
      return v
    }),
  )
  note('null_tokens', nulls)
  note('footnotes', footnotes)

  // 6. drop columns that are entirely empty
  const keep = names.map((_, i) => body.some((r) => r[i] != null))
  note('empty_cols', keep.filter((k) => !k).length)
  names = names.filter((_, i) => keep[i])
  body = body.map((r) => r.filter((_, i) => keep[i]))

  // 7. infer types and convert
  const columns = names.map((name, i) => {
    const vals = body.map((r) => r[i]).filter((v) => v != null)
    const nums = vals.map(parseNumber)
    const numShare = vals.length ? nums.filter(Boolean).length / vals.length : 0
    const years = vals.every((v) => /^(1[89]|20)\d{2}$/.test(v))
    const dates = vals.map(parseDate)
    const dateShare = vals.length ? dates.filter(Boolean).length / vals.length : 0
    let type = 'text'
    if (vals.length && years) type = 'year'
    else if (numShare >= 0.8) type = 'number'
    else if (dateShare >= 0.8) type = 'date'
    const col = { key: `c${i}`, name, type }
    if (type === 'number') {
      col.percent = nums.filter((n) => n?.percent).length > vals.length / 2
      col.currency = nums.filter((n) => n?.currency).length > vals.length / 2
    }
    return col
  })

  let converted = 0
  let unparsable = 0
  let datesFixed = 0
  let data = body.map((r) => {
    const o = {}
    columns.forEach((c, i) => {
      const v = r[i]
      if (v == null) o[c.key] = null
      else if (c.type === 'number') {
        const n = parseNumber(v)
        if (n) {
          if (String(n.value) !== v) converted++
          o[c.key] = n.value
        } else {
          unparsable++
          o[c.key] = null
        }
      } else if (c.type === 'year') o[c.key] = Number(v)
      else if (c.type === 'date') {
        const d = parseDate(v)
        if (d && d !== v) datesFixed++
        o[c.key] = d
      } else o[c.key] = v
    })
    return o
  })
  note('numbers', converted, { cols: columns.filter((c) => c.type === 'number').map((c) => c.name) })
  note('unparsable', unparsable)
  note('dates', datesFixed)

  // 8. merge spelling variants in text categories ("Punjab", "punjab ", "PUNJAB")
  let merged = 0
  columns
    .filter((c) => c.type === 'text')
    .forEach((c) => {
      const groups = {}
      data.forEach((o) => {
        const v = o[c.key]
        if (v == null) return
        const k = v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
        groups[k] = groups[k] || {}
        groups[k][v] = (groups[k][v] || 0) + 1
      })
      const canon = {}
      Object.values(groups).forEach((g) => {
        const forms = Object.entries(g).sort((a, b) => b[1] - a[1])
        if (forms.length > 1) forms.slice(1).forEach(([f]) => (canon[f] = forms[0][0]))
      })
      data.forEach((o) => {
        if (o[c.key] != null && canon[o[c.key]]) {
          o[c.key] = canon[o[c.key]]
          merged++
        }
      })
    })
  note('variants', merged)

  // 9. exact duplicate rows
  const keys = new Set()
  const deduped = data.filter((o) => {
    const k = JSON.stringify(o)
    if (keys.has(k)) return false
    keys.add(k)
    return true
  })
  note('duplicates', data.length - deduped.length)
  data = deduped

  return { columns, data, log, rawRows: rawRows.length }
}

// ---------- profiling ----------

export function profile(columns, data) {
  return columns.map((c) => {
    const vals = data.map((o) => o[c.key]).filter((v) => v != null)
    const p = { ...c, filled: vals.length, missing: data.length - vals.length, unique: new Set(vals).size }
    if (c.type === 'number' || c.type === 'year') {
      const s = [...vals].sort((a, b) => a - b)
      p.min = s[0]
      p.max = s[s.length - 1]
      p.mean = s.reduce((a, b) => a + b, 0) / (s.length || 1)
      p.median = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
      p.spark = histogram(s, 12)
    } else {
      const counts = {}
      vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1))
      p.top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
    }
    return p
  })
}

function histogram(sorted, bins) {
  if (!sorted.length) return []
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  const out = Array(bins).fill(0)
  sorted.forEach((v) => out[hi === lo ? 0 : Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]++)
  return out
}

// ---------- querying ----------

export const AGGS = ['count', 'sum', 'mean', 'median', 'min', 'max']

function aggregate(values, agg) {
  const v = values.filter((x) => x != null)
  if (agg === 'count') return values.length
  if (!v.length) return null
  if (agg === 'sum') return v.reduce((a, b) => a + b, 0)
  if (agg === 'mean') return v.reduce((a, b) => a + b, 0) / v.length
  if (agg === 'min') return Math.min(...v)
  if (agg === 'max') return Math.max(...v)
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export function matches(o, f, columns) {
  const col = columns.find((c) => c.key === f.col)
  if (!col || f.value === '' || f.value == null) return true
  const v = o[f.col]
  if (v == null) return false
  if (col.type === 'text' || col.type === 'date') {
    const a = String(v).toLowerCase()
    const b = String(f.value).toLowerCase()
    if (f.op === 'contains') return a.includes(b)
    if (f.op === '!=') return a !== b
    return a === b
  }
  const n = parseNumber(f.value)?.value
  if (n == null) return true
  if (f.op === '>') return v > n
  if (f.op === '<') return v < n
  if (f.op === '!=') return v !== n
  return v === n
}

// q: { filters, groupBy, seriesBy, agg, metric, sort, limit }
// Returns { kind: 'rows' } for plain filtering or { kind: 'grouped', series, x } for charts.
export function runQuery(columns, data, q) {
  const rows = data.filter((o) => (q.filters || []).every((f) => matches(o, f, columns)))
  if (!q.groupBy) return { kind: 'rows', rows }
  const xCol = columns.find((c) => c.key === q.groupBy)
  const sCol = q.seriesBy ? columns.find((c) => c.key === q.seriesBy) : null
  const groups = new Map()
  rows.forEach((o) => {
    let x = o[q.groupBy]
    if (x == null) return
    if (xCol.type === 'date') x = x.slice(0, 7) // bucket dates by month
    const s = sCol ? o[sCol.key] ?? '—' : '_'
    if (!groups.has(s)) groups.set(s, new Map())
    const g = groups.get(s)
    if (!g.has(x)) g.set(x, [])
    g.get(x).push(q.agg === 'count' ? 1 : o[q.metric])
  })
  let series = [...groups.entries()].map(([name, g]) => ({
    name,
    points: [...g.entries()].map(([x, vals]) => [x, aggregate(vals, q.agg)]),
  }))
  const ordered = xCol.type === 'year' || xCol.type === 'date' || xCol.type === 'number'
  series.forEach((s) => {
    if (ordered) s.points.sort((a, b) => (a[0] > b[0] ? 1 : -1))
    else s.points.sort((a, b) => (q.sort === 'asc' ? a[1] - b[1] : b[1] - a[1]))
    s.total = s.points.reduce((a, p) => a + (p[1] || 0), 0)
  })
  // Keep the largest series; color follows the entity, so order is by total, not by rank later
  series.sort((a, b) => b.total - a.total)
  const dropped = Math.max(0, series.length - 6)
  series = series.slice(0, 6)
  if (!ordered && series.length === 1 && q.limit) series[0].points = series[0].points.slice(0, q.limit)
  return { kind: 'grouped', series, ordered, xType: xCol.type, rows, dropped }
}

export function toCSV(columns, data) {
  return Papa.unparse({ fields: columns.map((c) => c.name), data: data.map((o) => columns.map((c) => o[c.key] ?? '')) })
}
