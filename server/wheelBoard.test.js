import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutPuzzle, puzzleProblem, normalizePuzzle, letterCounts, exists, COLUMNS } from './wheelBoard.js'

// The board as text, one string per row: '.' for a missing corner, '_' for an unused tile.
const draw = (text) => layoutPuzzle(text).rows.map((row, r) => row.map((cell, c) => (!exists(r, c) ? '.' : cell ? cell.ch : '_')).join(''))

test('a short puzzle sits centred on the second row', () => {
  assert.deepEqual(draw('Ice cream'), [
    '.____________.',
    '__ICE_CREAM___',
    '______________',
    '.____________.',
  ])
})

test('two lines use the middle rows and split evenly', () => {
  assert.deepEqual(draw('A penny for your thoughts'), [
    '.____________.',
    '_A_PENNY_FOR__',
    'YOUR_THOUGHTS_',
    '.____________.',
  ])
})

test('a long puzzle uses all four rows', () => {
  const rows = draw("Don't count your chickens before they hatch")
  assert.ok(rows.every((row) => /[A-Z]/.test(row)))
  assert.equal(rows.join(' ').replace(/[._ ]+/g, ' ').trim(), "DON'T COUNT YOUR CHICKENS BEFORE THEY HATCH")
})

test('lines of the short rows stay inside them', () => {
  const { rows } = layoutPuzzle('Twelve chars plus fourteen chars here and twelve too')
  for (const r of [0, 3]) { assert.equal(rows[r][0], null); assert.equal(rows[r][COLUMNS - 1], null) }
})

test('punctuation is not a letter', () => {
  const cells = layoutPuzzle("Rock 'n' roll & blues!").rows.flat().filter(Boolean)
  assert.deepEqual(cells.filter((cell) => !cell.letter).map((cell) => cell.ch), ["'", "'", '&', '!'])
})

test('problems are explained', () => {
  assert.equal(puzzleProblem('Hello there'), null)
  assert.equal(puzzleProblem('Ace Ventura: Pet Detective'), null, 'a colon shows on the board, for titles')
  assert.match(puzzleProblem('Route 66'), /only letters/)
  assert.match(puzzleProblem('Supercalifragilistic'), /longer than 14/)
  assert.match(puzzleProblem('one two three four five six seven eight nine ten eleven twelve thirteen'), /does not fit/)
  assert.equal(layoutPuzzle('Route 66'), null)
})

test('normalizing and counting letters', () => {
  assert.equal(normalizePuzzle('  Crème   brûlée’s  '), "CREME BRULEE'S")
  assert.deepEqual(letterCounts('Tutti frutti'), { T: 5, U: 2, I: 2, F: 1, R: 1 })
})
