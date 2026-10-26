// Spin & Solve puzzle board: 4 rows of 12 / 14 / 14 / 12 tiles, the short rows indented by one tile.
//
// The board is a 4 × 14 grid. The corner cells of the short rows don't exist, and every other cell
// is either an unused tile (null) or a puzzle character. Words never break across rows. A puzzle uses
// as few rows as it can, sits in the middle of the board, and each of its lines is centred. Short rows
// are offset by one, so centring in them lines up with centring in the long rows.
export const ROW_WIDTHS = [12, 14, 14, 12]
export const COLUMNS = 14
export const VOWELS = 'AEIOU'
export const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ'
// Shown on the board from the start; everything else is a letter to guess. The colon is for titles
// ("ACE VENTURA: PET DETECTIVE").
export const PUNCTUATION = "'-&?!.,:"
const ALLOWED = /^[A-Z'\-&?!.,:]+( [A-Z'\-&?!.,:]+)*$/
// The rows a puzzle of n lines may use, best first.
const ROW_SETS = { 1: [[1], [2]], 2: [[1, 2]], 3: [[0, 1, 2], [1, 2, 3]], 4: [[0, 1, 2, 3]] }
const offset = (row) => (COLUMNS - ROW_WIDTHS[row]) / 2

export const isLetter = (ch) => ch >= 'A' && ch <= 'Z'
export const isVowel = (ch) => VOWELS.includes(ch)
export const exists = (row, column) => column >= offset(row) && column < COLUMNS - offset(row)

// Upper case, straight apostrophes, single spaces.
export function normalizePuzzle(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ').trim().toUpperCase()
}

// Every way to cut the words into `lines` consecutive groups, as arrays of line strings.
function* splits(words, lines) {
  if (lines === 1) { yield [words.join(' ')]; return }
  for (let take = 1; take <= words.length - lines + 1; take++)
    for (const rest of splits(words.slice(take), lines - 1)) yield [words.slice(0, take).join(' '), ...rest]
}

// The rows used and the line on each, or null if the puzzle can't fit.
function bestFit(words) {
  for (let lines = 1; lines <= 4 && lines <= words.length; lines++) {
    let best = null
    for (const rows of ROW_SETS[lines]) for (const text of splits(words, lines)) {
      if (text.some((line, i) => line.length > ROW_WIDTHS[rows[i]])) continue
      // Even lines read best: the cost is how far each line falls short of the longest.
      const longest = Math.max(...text.map((line) => line.length))
      const cost = text.reduce((sum, line) => sum + (longest - line.length) ** 2, 0)
      if (!best || cost < best.cost) best = { rows, text, cost }
    }
    if (best) return best
  }
  return null
}

// Why a puzzle can't be used, or null if it's fine.
export function puzzleProblem(text) {
  const clean = normalizePuzzle(text)
  if (!clean) return 'empty'
  if (!ALLOWED.test(clean)) return `only letters, spaces and ${PUNCTUATION} are allowed`
  if (![...clean].some(isLetter)) return 'no letters to guess'
  const long = clean.split(' ').find((word) => word.length > COLUMNS)
  if (long) return `"${long}" is longer than ${COLUMNS} tiles`
  if (!bestFit(clean.split(' '))) return 'does not fit on the board'
  return null
}

// { rows: 4 × 14 of null | { ch, letter } } for a puzzle, or null if it doesn't fit.
export function layoutPuzzle(text) {
  const clean = normalizePuzzle(text)
  if (puzzleProblem(clean)) return null
  const fit = bestFit(clean.split(' '))
  const rows = ROW_WIDTHS.map(() => Array(COLUMNS).fill(null))
  fit.rows.forEach((row, i) => {
    const line = fit.text[i], start = offset(row) + Math.floor((ROW_WIDTHS[row] - line.length) / 2)
    ;[...line].forEach((ch, j) => { if (ch !== ' ') rows[row][start + j] = { ch, letter: isLetter(ch) } })
  })
  return { rows }
}

// How many times each letter appears: { A: 2, … }.
export function letterCounts(text) {
  const counts = {}
  for (const ch of normalizePuzzle(text)) if (isLetter(ch)) counts[ch] = (counts[ch] || 0) + 1
  return counts
}
