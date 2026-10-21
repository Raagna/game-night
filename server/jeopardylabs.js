// Import a public JeopardyLabs board (https://jeopardylabs.com/play/<name>) into the custom-board format.
// Board pages are server-rendered: every clue cell carries its row, column, category, points, clue and response.

const MAX_SIZE = 6
const ALLOWED_HOSTS = new Set(['jeopardylabs.com', 'www.jeopardylabs.com'])

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–', deg: '°', eacute: 'é' }
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}
const toText = (html) => decodeEntities(String(html || '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<\/(p|div|li)>/gi, ' ')
  .replace(/<[^>]*>/g, ''))
  .replace(/\s+/g, ' ')
  .trim()
// JeopardyLabs responses are usually written as questions ("What is the water cycle?"); keep just the answer.
const cleanResponse = (text) => text.replace(/^(what|who|where|when|which)\s*('s|\s(is|are|was|were))\s+(.+?)\s*\??$/i, '$4').trim()

export function jeopardyLabsUrl(input) {
  let url
  const text = String(input || '').trim()
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null
  const match = url.pathname.match(/^\/(?:play|print|edit|compile)\/([a-z0-9-]+)\/?$/i)
  return match ? `https://jeopardylabs.com/play/${match[1].toLowerCase()}` : null
}

export function parseJeopardyLabs(html) {
  const title = toText((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s*Jeopardy Template\s*$/i, '') || 'Imported board'
  const cellPattern = /data-row="(\d+)"\s+data-col="(\d+)"\s*>\s*<div class="cell points"\s*>\s*<div class="cell-inner"[^>]*?data-category="([^"]*)"[^>]*>([\s\S]*?)<\/div>\s*<div class="front answer"[^>]*>([\s\S]*?)<\/div>\s*<div class="back question"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g
  const columns = new Map()
  let pictureClues = 0
  for (const [, row, col, category, points, clueHtml, responseHtml] of html.matchAll(cellPattern)) {
    const clue = toText(clueHtml), answer = cleanResponse(toText(responseHtml))
    if (!clue && /<img/i.test(clueHtml)) pictureClues++
    const column = columns.get(+col) || { name: toText(category), cells: [] }
    column.cells.push({ row: +row, value: parseInt(toText(points).replace(/[^0-9]/g, ''), 10) || 0, question: clue, answer })
    columns.set(+col, column)
  }
  if (!columns.size) throw new Error('No clues were found on that page. Make sure it is a public JeopardyLabs game link.')
  const allColumns = [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([, column]) => column)
  const rowCount = Math.max(...allColumns.map((column) => column.cells.length))
  const categories = allColumns.slice(0, MAX_SIZE).map((column) => ({
    name: column.name || 'Category',
    clues: column.cells.sort((a, b) => a.row - b.row).slice(0, MAX_SIZE).map(({ value, question, answer }) => ({ value, question, answer })),
  }))
  return {
    title,
    rounds: [{ name: 'Jeopardy!', categories }],
    notes: {
      trimmedCategories: Math.max(0, allColumns.length - MAX_SIZE),
      trimmedRows: Math.max(0, rowCount - MAX_SIZE),
      pictureClues,
    },
  }
}

export async function importJeopardyLabs(input) {
  const url = jeopardyLabsUrl(input)
  if (!url) throw new Error('Paste a JeopardyLabs game link, like https://jeopardylabs.com/play/your-game')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'JeopardyParty board import' } })
  if (response.status === 404) throw new Error('That JeopardyLabs game was not found. Check the link.')
  if (!response.ok) throw new Error(`JeopardyLabs answered with an error (${response.status}). Try again in a moment.`)
  const html = await response.text()
  if (html.length > 3_000_000) throw new Error('That page is too large to import.')
  return parseJeopardyLabs(html)
}
