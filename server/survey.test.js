import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSurveyGames } from './survey.js'

// Survey Says! without sockets or real timers: the read-the-question pause runs when a test calls fire().
function harness() {
  const games = new Map(), timers = {}
  const api = createSurveyGames({
    io: { sockets: { sockets: new Map() } }, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
  })
  return { api, games, timers, fire: () => { const timer = timers.survey; assert.ok(timer, 'no clock running'); delete timers.survey; timer.fn() } }
}
const SURVEY = { question: 'Name something in a kitchen.', answers: ['Fridge', 'Oven', 'Sink', 'Toaster', 'Kettle', 'Spoon', 'Plate', 'Mug'].map((text, i) => ({ text, points: 40 - i * 4 })) }
// A hosted game with these teams: { a: ['a0', 'a1', 'a2'], b: [...] }, players joining in that order.
function newGame(h, teams, config = {}) {
  const game = h.api.makeGame('ABCDEF', { surveys: [SURVEY, SURVEY, SURVEY], ...config })
  h.games.set(game.code, game)
  ;[teams.a, teams.b].forEach((ids, team) => ids.forEach((id) => game.players.set(id, { id, name: id, score: 0, team, socketId: `s-${id}` })))
  h.api.hostAction(game, 'start', {})
  return game
}
const host = (h, game, action, payload = {}) => h.api.hostAction(game, action, payload)
// The face-off: both players step up, `winner` buzzes and hits the top answer, and their team chooses.
function faceoff(h, game, { winner = 0, play = true } = {}) {
  h.fire() // the question has been read
  const round = game.round
  host(h, game, 'buzz', { playerId: round.faceoff.playerIds[winner] })
  host(h, game, 'reveal', { index: 0 })
  assert.equal(round.phase, 'choose')
  host(h, game, 'choose', { play })
}
// Whoever answers next, then a strike (or, with hit, an answer), for as many turns as asked.
function guessOrder(h, game, turns, { hit = false } = {}) {
  const order = []
  for (let i = 0; i < turns; i++) {
    order.push(game.round.guesserId)
    if (hit) host(h, game, 'reveal', { index: game.round.revealed.indexOf(false) })
    else host(h, game, 'strike')
  }
  return order
}
const TEAMS = { a: ['a0', 'a1', 'a2'], b: ['b0', 'b1', 'b2'] }

describe('after the face-off, the turns start with the next teammate', () => {
  test('Play: the face-off player’s teammates go first, and the face-off player comes round last', () => {
    const h = harness(), game = newGame(h, TEAMS)
    assert.deepEqual(game.round.faceoff.playerIds, ['a0', 'b0'])
    faceoff(h, game, { winner: 0, play: true })
    assert.deepEqual(guessOrder(h, game, 5, { hit: true }), ['a1', 'a2', 'a0', 'a1', 'a2'])
  })
  test('Pass: the other team starts after its own face-off player', () => {
    const h = harness(), game = newGame(h, TEAMS)
    faceoff(h, game, { winner: 0, play: false })
    assert.equal(game.round.control, 1)
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['b1', 'b2', 'b0'])
  })
  test('the other team winning the face-off works the same way', () => {
    const h = harness(), game = newGame(h, TEAMS)
    faceoff(h, game, { winner: 1, play: true })
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['b1', 'b2', 'b0'])
  })
  test('strikes move the turn on in the same order', () => {
    const h = harness(), game = newGame(h, TEAMS)
    faceoff(h, game)
    assert.deepEqual(guessOrder(h, game, 3), ['a1', 'a2', 'a0'])
    assert.equal(game.round.phase, 'steal')
  })
  test('a team of one: the face-off player answers every time', () => {
    const h = harness(), game = newGame(h, { a: ['a0'], b: ['b0', 'b1'] })
    faceoff(h, game)
    assert.deepEqual(guessOrder(h, game, 2, { hit: true }), ['a0', 'a0'])
  })
  test('the next round, the next players face off, and the turns follow on from them', () => {
    const h = harness(), game = newGame(h, TEAMS)
    faceoff(h, game)
    guessOrder(h, game, 3)
    host(h, game, 'strike') // the steal misses
    host(h, game, 'nextRound')
    assert.deepEqual(game.round.faceoff.playerIds, ['a1', 'b1'])
    faceoff(h, game, { winner: 1 })
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['b2', 'b0', 'b1'])
    host(h, game, 'skipRound'); host(h, game, 'nextRound')
    assert.deepEqual(game.round.faceoff.playerIds, ['a2', 'b2'])
    faceoff(h, game, { winner: 0 })
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['a0', 'a1', 'a2'])
  })
  test('uneven teams: everyone still gets a face-off in turn', () => {
    const h = harness(), game = newGame(h, { a: ['a0', 'a1'], b: ['b0', 'b1', 'b2'] })
    const seen = []
    for (let i = 0; i < 3; i++) {
      seen.push(game.round.faceoff.playerIds)
      host(h, game, 'skipRound'); host(h, game, 'nextRound')
    }
    assert.deepEqual(seen, [['a0', 'b0'], ['a1', 'b1'], ['a0', 'b2']])
  })
})

describe('edge cases', () => {
  test('a face-off player who has dropped out: the turns start with the next teammate who’s here', () => {
    const h = harness(), game = newGame(h, TEAMS)
    h.fire()
    host(h, game, 'buzz', { playerId: 'a0' })
    host(h, game, 'reveal', { index: 0 })
    game.players.get('a1').socketId = null // a1 drops (still within the reconnect grace period)
    host(h, game, 'choose', { play: true })
    assert.deepEqual(guessOrder(h, game, 2, { hit: true }), ['a2', 'a0'])
  })
  test('the face-off player themselves dropping out still starts with the teammate after them', () => {
    const h = harness(), game = newGame(h, TEAMS)
    h.fire()
    host(h, game, 'buzz', { playerId: 'a0' })
    host(h, game, 'reveal', { index: 0 })
    game.players.get('a0').socketId = null
    host(h, game, 'choose', { play: true })
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['a1', 'a2', 'a1'])
  })
  test('a coin toss after too many face-off misses hands the turns over the same way', () => {
    const h = harness(), game = newGame(h, TEAMS)
    h.fire()
    host(h, game, 'buzz', { playerId: 'a0' })
    for (let i = 0; i < 6; i++) host(h, game, 'strike')
    assert.equal(game.round.phase, 'choose')
    const team = game.round.control
    host(h, game, 'choose', { play: true })
    const prefix = team === 0 ? 'a' : 'b'
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), [`${prefix}1`, `${prefix}2`, `${prefix}0`])
  })
  test('undoing Play and choosing Pass starts the other team after its face-off player', () => {
    const h = harness(), game = newGame(h, TEAMS)
    faceoff(h, game, { play: true })
    assert.equal(game.round.guesserId, 'a1')
    host(h, game, 'undo')
    assert.equal(game.round.phase, 'choose')
    host(h, game, 'choose', { play: false })
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['b1', 'b2', 'b0'])
  })
  test('a round with only one team here (no face-off) starts with the player picked for it', () => {
    const h = harness(), game = newGame(h, TEAMS)
    host(h, game, 'skipRound')
    for (const id of TEAMS.b) game.players.get(id).socketId = null
    host(h, game, 'nextRound')
    assert.equal(game.round.phase, 'guessing')
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['a1', 'a2', 'a0'])
  })
  test('without a host, the same order holds', () => {
    const h = harness(), game = newGame(h, TEAMS, { hostless: true })
    h.fire()
    host(h, game, 'buzz', { playerId: 'b0' })
    host(h, game, 'reveal', { index: 0 })
    host(h, game, 'choose', { play: true })
    assert.deepEqual(guessOrder(h, game, 3, { hit: true }), ['b1', 'b2', 'b0'])
  })
})
