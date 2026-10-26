// Builds the Spin & Solve "Fan Database" pack (public/data/puzzles-fans.json) from answers collected from
// https://wheeloffortuneanswer.com/, a player-maintained list of answers from the official Wheel of Fortune
// game. See CREDITS.md.
//
//   node scripts/build-fan-puzzles.mjs <collected.json>
//
// <collected.json> is { source, collected: "YYYY-MM-DD", categories: [{ slug, category, rows: [answer, …] }] }:
// the first column of the table on each of the site's category pages. The site turns away scripted downloads,
// so it was collected from the pages in a browser.
//
// Every answer has to work as a puzzle on our board, so the build keeps only answers that:
// - use letters and the board's punctuation (a colon only in titles, where it's part of the name);
// - aren't followed by a note (" – Around The House", "Living Things: …", "*");
// - fit the board, have at least 5 letters, and follow their category's rule (Same Letter, Same Name,
//   Before & After);
// - aren't already in the Game Night pack (src/wheel/puzzles.json) or earlier in this pack.
// Categories whose answers are other people's words (song lyrics, movie quotes, quotations, slogans) were
// never collected, and Headline is left out: it's real news, some of it about real tragedies.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizePuzzle, puzzleProblem, letterCounts } from '../server/wheelBoard.js'

const LEAVE_OUT = new Set(['headline', 'song-lyrics', 'movie-quotes', 'quotation', 'slogan'])
// The site's categories, as we show them.
const NAMES = {
  'before-and-after': 'Before & After', 'book-title': 'Book Title', 'food-and-drink': 'Food & Drink', 'fun-and-games': 'Fun & Games',
  'husband-and-wife': 'Husband & Wife', 'song-artist': 'Song & Artist', 'star-and-role': 'Star & Role', 'title-and-author': 'Title & Author',
  'what-are-you-doing': 'What Are You Doing?', 'what-are-you-wearing': 'What Are You Wearing?', 'where-are-we-going': 'Where Are We Going?',
  'the-50s': 'The 50s', 'the-60s': 'The 60s', 'the-70s': 'The 70s', 'the-80s': 'The 80s', 'the-90s': 'The 90s',
}
// Categories where a colon is part of the answer (a title with a subtitle).
const TITLES = new Set(['book-title', 'classic-movie', 'classic-tv', 'movie-title', 'song-title', 'title', 'title-and-author', 'tv-show-title', 'song-artist', 'show-biz', 'rock-on'])
const MIN_LETTERS = 5

const [collectedPath] = process.argv.slice(2)
if (!collectedPath) { console.error('Usage: node scripts/build-fan-puzzles.mjs <collected.json>'); process.exit(1) }
const collected = JSON.parse(readFileSync(collectedPath, 'utf8'))
const ours = JSON.parse(readFileSync(fileURLToPath(new URL('../src/wheel/puzzles.json', import.meta.url)), 'utf8'))
const seen = new Set([...Object.values(ours.main), ...Object.values(ours.bonus)].flat().map(normalizePuzzle))

// Tidies an answer the way the board will show it, or returns why it can't be a puzzle.
function tidy(raw, slug) {
  let text = String(raw).replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  if (/ - |\*|…|\.\.\./.test(text)) return { why: 'a note after the answer' }
  if (text.includes(':') && !TITLES.has(slug)) return { why: 'a note after the answer' }
  if (/\d/.test(text)) return { why: 'digits' }
  // Same Name puzzles join the two halves with "&" on our board.
  if (slug === 'same-name' && !text.includes('&')) text = text.replace(/ And /i, ' & ')
  const clean = normalizePuzzle(text)
  const problem = puzzleProblem(clean)
  if (problem) return { why: problem.startsWith('only letters') ? 'other characters' : problem.includes('longer than') || problem.includes('fit') ? 'doesn’t fit the board' : problem }
  const letters = Object.values(letterCounts(clean)).reduce((a, b) => a + b, 0)
  if (letters < MIN_LETTERS) return { why: `fewer than ${MIN_LETTERS} letters` }
  if (slug === 'same-letter' && new Set(clean.replace(/[^A-Z ]/g, '').split(' ').filter(Boolean).map((word) => word[0])).size !== 1) return { why: 'not all the same letter' }
  if (slug === 'same-name' && !clean.includes(' & ')) return { why: 'no "&" between the names' }
  // Two phrases sharing a word take at least three words (hyphenated parts count: "SQUEAKY-CLEAN FREAK").
  if (slug === 'before-and-after' && clean.split(/[ -]+/).filter(Boolean).length < 3) return { why: 'Before & After with fewer than three words' }
  return { text, clean }
}

const main = {}, dropped = {}
let kept = 0, total = 0
for (const { slug, category, rows } of collected.categories) {
  if (LEAVE_OUT.has(slug)) { dropped['category left out'] = (dropped['category left out'] || 0) + rows.length; total += rows.length; continue }
  const name = NAMES[slug] || category
  for (const raw of rows) {
    total++
    const { text, clean, why } = tidy(raw, slug)
    const reason = why || (seen.has(clean) ? 'duplicate' : null)
    if (reason) { dropped[reason] = (dropped[reason] || 0) + 1; continue }
    seen.add(clean)
    ;(main[name] ||= []).push(text)
    kept++
  }
}

const out = fileURLToPath(new URL('../public/data/puzzles-fans.json', import.meta.url))
writeFileSync(out, JSON.stringify({ source: collected.source, collected: collected.collected, main }))
console.log(`Kept ${kept.toLocaleString()} of ${total.toLocaleString()} answers in ${Object.keys(main).length} categories.`)
console.log('Dropped:', Object.entries(dropped).sort((a, b) => b[1] - a[1]).map(([why, n]) => `${why} ${n.toLocaleString()}`).join(', '))
console.log(Object.entries(main).map(([name, list]) => `${name} ${list.length}`).join(', '))
