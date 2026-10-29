// Parses uploaded documents in the browser, so files never leave the user's device
// except as extracted plain text sent to the analysis API.
export const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.html,.htm'
export const MAX_FILES = 5
export const MAX_BYTES = 15 * 1024 * 1024

async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const pages = []
  for (let i = 1; i <= Math.min(pdf.numPages, 80); i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((it) => it.str).join(' '))
  }
  return { text: pages.join('\n'), pages: pdf.numPages }
}

async function docxText(buf) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
  return { text: value }
}

export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (file.size > MAX_BYTES) throw new Error('too_big')
  let out
  if (ext === 'pdf') out = await pdfText(await file.arrayBuffer())
  else if (ext === 'docx') out = await docxText(await file.arrayBuffer())
  else if (['txt', 'md', 'csv'].includes(ext)) out = { text: await file.text() }
  else if (['html', 'htm'].includes(ext)) {
    const doc = new DOMParser().parseFromString(await file.text(), 'text/html')
    out = { text: doc.body?.innerText || '' }
  } else throw new Error('unsupported')
  const text = out.text.replace(/\s+/g, ' ').trim()
  if (text.length < 40) throw new Error('empty')
  return { name: file.name, text, words: text.split(' ').length, pages: out.pages }
}
