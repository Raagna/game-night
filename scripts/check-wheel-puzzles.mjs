// Checks the Spin & Solve puzzle pack (src/wheel/puzzles.json): every puzzle fits the board, uses only
// allowed characters, appears once across both pools and follows its category's rule. Gifts and trips
// need a name and a sensible value. Prints a count per category; exits with 1 if anything is wrong.
//
//   npm run check:puzzles
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { puzzleProblem, normalizePuzzle, letterCounts } from '../server/wheelBoard.js'

const file = fileURLToPath(new URL('../src/wheel/puzzles.json', import.meta.url))
const pack = JSON.parse(readFileSync(file, 'utf8'))
const CATEGORIES = ['Phrase', 'Thing', 'Things', 'Place', 'Places', 'On the Map', 'Landmark', 'Person', 'Proper Name', 'Character',
  'Food & Drink', 'Around the House', 'Living Thing', 'Living Things', 'Event', 'Fun & Games', 'Occupation', 'What Are You Doing?',
  'Before & After', 'Rhyme Time', 'Same Name', 'Same Letter', 'Title']
const BONUS_GIVEN = 'RSTLNE'
const errors = [], warnings = [], seen = new Map()

// A rule for each category that can be checked mechanically. Returns a problem, or null.
const RULES = {
  // "&" and other punctuation aren't words ("WITCHES WIZARDS & WARLOCKS").
  'Same Letter': (text) => new Set(text.replace(/[^A-Z ]/g, '').split(' ').filter(Boolean).map((word) => word[0])).size === 1 ? null : 'every word must start with the same letter',
  'Same Name': (text) => text.includes(' & ') ? null : 'needs " & " between the two names',
  // Hyphenated parts count: "SQUEAKY-CLEAN FREAK" is squeaky clean + clean freak.
  'Before & After': (text) => text.split(/[ -]+/).filter(Boolean).length >= 3 ? null : 'needs at least three words',
}

// anyCategory: the pack keeps its source's category names. quiet: no warnings about easy puzzles.
function checkPool(pool, name, { bonus = false, anyCategory = false, quiet = false } = {}) {
  if (!pool || typeof pool !== 'object' || Array.isArray(pool)) { errors.push(`"${name}" must be an object of category: [puzzles]`); return }
  for (const [category, puzzles] of Object.entries(pool)) {
    if (anyCategory ? !category.trim() || category.length > 30 : !CATEGORIES.includes(category)) errors.push(`${name}: unknown category "${category}"`)
    if (!Array.isArray(puzzles)) { errors.push(`${name} / ${category}: must be a list`); continue }
    for (const raw of puzzles) {
      const where = `${name} / ${category}: "${raw}"`
      if (typeof raw !== 'string') { errors.push(`${where}: not a string`); continue }
      const text = normalizePuzzle(raw), problem = puzzleProblem(text)
      if (problem) { errors.push(`${where}: ${problem}`); continue }
      if (seen.has(text)) errors.push(`${where}: duplicate (also in ${seen.get(text)})`)
      else seen.set(text, `${name} / ${category}`)
      const ruleProblem = RULES[category]?.(text)
      if (ruleProblem) errors.push(`${where}: ${ruleProblem}`)
      const counts = letterCounts(text), letters = Object.values(counts).reduce((a, b) => a + b, 0)
      if (bonus) {
        const words = text.split(' ').length
        if (words < 2 || words > 3) errors.push(`${where}: bonus puzzles are 2 or 3 words`)
        const given = [...BONUS_GIVEN].reduce((sum, letter) => sum + (counts[letter] || 0), 0)
        if (given / letters > 0.6) warnings.push(`${where}: R S T L N E already show ${Math.round((given / letters) * 100)}% of it`)
      } else if (letters < 8 && !quiet) warnings.push(`${where}: only ${letters} letters, may be too easy`)
    }
  }
}

function checkPrizes(list, name) {
  if (!Array.isArray(list) || !list.length) { errors.push(`"${name}" must be a non-empty list of [name, value]`); return }
  for (const prize of list) {
    const [label, value] = Array.isArray(prize) ? prize : []
    if (typeof label !== 'string' || !label.trim() || label.length > 40) errors.push(`${name}: bad name in ${JSON.stringify(prize)}`)
    if (!Number.isInteger(value) || value < 500 || value > 25000) errors.push(`${name}: value must be a whole number from 500 to 25,000 in ${JSON.stringify(prize)}`)
  }
}

checkPool(pack.main, 'main')
checkPool(pack.bonus, 'bonus', { bonus: true })
checkPrizes(pack.gifts, 'gifts')
checkPrizes(pack.trips, 'trips')
// The Fan Database (public/data/puzzles-fans.json, built by scripts/build-fan-puzzles.mjs): its puzzles have
// to fit, follow the category rules and not repeat ours either, but it keeps the site's category names.
const fansFile = fileURLToPath(new URL('../public/data/puzzles-fans.json', import.meta.url))
let fans = null
try { fans = JSON.parse(readFileSync(fansFile, 'utf8')) } catch {}
if (fans) checkPool(fans.main, 'fans', { anyCategory: true, quiet: true })

for (const [name, pool] of [['main', pack.main], ['bonus', pack.bonus], ...(fans ? [['fans', fans.main]] : [])]) {
  const counts = Object.entries(pool || {}).map(([category, puzzles]) => `${category} ${puzzles.length}`)
  const total = Object.values(pool || {}).reduce((sum, puzzles) => sum + puzzles.length, 0)
  console.log(`${name}: ${total} puzzles (${counts.join(', ')})`)
}
console.log(`gifts: ${pack.gifts?.length ?? 0}, trips: ${pack.trips?.length ?? 0}`)
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n  ${warnings.join('\n  ')}`)
if (errors.length) { console.log(`\n${errors.length} error(s):\n  ${errors.join('\n  ')}`); process.exit(1) }
console.log('\nAll puzzles OK.')
