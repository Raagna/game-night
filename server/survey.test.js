import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSurveyGames, PRACTICE_STEPS, PRACTICE_SURVEY } from './survey.js'
import { registerTutorial } from './tutorial.js'

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

describe('the practice round', () => {
  // The step the coach shows, as the screens get it (publicGame keeps it in step with the round).
  const step = (h, game) => { h.api.publicGame(game); return game.tutorial?.step ?? null }
  // A player's phone: its Survey Says! events, sent on that player's own connection.
  function phone(h, game, playerId) {
    const handlers = new Map()
    h.api.register({ id: game.players.get(playerId).socketId, on: (name, fn) => handlers.set(name, fn) })
    return (name, payload = {}) => handlers.get(`survey:${name}`)({ code: game.code, playerId, ...payload })
  }
  // The skip events as server/index.js wires them, on a connection: the TV's or controller's skip, or a phone's vote.
  function skipEvents(h, socketId, data = {}) {
    const handlers = new Map()
    registerTutorial({ id: socketId, data, on: (name, fn) => handlers.set(name, fn) }, { games: h.games, emitGame: () => {}, end: h.api.endTutorial })
    return { skip: (game) => handlers.get('tutorial:skip')({ code: game.code }), vote: (game, playerId) => handlers.get('tutorial:vote')({ code: game.code, playerId }) }
  }
  const practiceGame = (h, config = {}) => newGame(h, TEAMS, { tutorial: true, ...config })
  // Round one, fresh: the first real question, scores at 0, and each team's first player facing off.
  function assertRoundOne(h, game) {
    assert.equal(game.tutorial, null)
    assert.equal(game.practice, null)
    assert.equal(game.status, 'playing')
    assert.equal(game.roundIndex, 0)
    assert.equal(game.round.phase, 'faceoffRead')
    assert.equal(game.round.bank, 0)
    assert.deepEqual(game.teams.map((team) => team.score), [0, 0])
    assert.deepEqual(game.round.faceoff.playerIds, ['a0', 'b0'])
    assert.equal(h.api.publicGame(game).round.question, SURVEY.question)
  }

  test('without the option, the game starts straight into round one', () => {
    const h = harness(), game = newGame(h, TEAMS)
    assert.equal(game.tutorial, undefined)
    assert.equal(h.api.publicGame(game).round.question, SURVEY.question)
  })
  test('with it, the game starts on the practice question at the face-off step', () => {
    const h = harness(), game = practiceGame(h)
    assert.deepEqual(game.tutorial.steps, PRACTICE_STEPS)
    assert.equal(step(h, game), 'faceoff')
    const pub = h.api.publicGame(game)
    assert.equal(pub.round.question, PRACTICE_SURVEY.question)
    assert.equal(pub.multiplier, 1)
    assert.equal(pub.strikesToSteal, 1)
  })
  test('without a host: buzz, face-off answers, play, a guess, a strike and a steal, scoring nothing; then round one', () => {
    const h = harness(), game = practiceGame(h, { hostless: true })
    const [a0, b0, a1, a2, b1] = ['a0', 'b0', 'a1', 'a2', 'b1'].map((id) => phone(h, game, id))
    h.fire() // the question has been read
    assert.equal(step(h, game), 'faceoff')
    a0('buzz')
    assert.equal(step(h, game), 'answer')
    a0('guess', { guess: 'pigs' }) // on the board, but not the top answer: the rival gets a go
    assert.equal(game.round.faceoff.answeringId, 'b0')
    assert.equal(step(h, game), 'answer')
    b0('guess', { guess: 'a dinosaur' })
    assert.equal(step(h, game), 'choose')
    assert.equal(game.round.chooserId, 'a0')
    a0('choose', { play: true })
    assert.equal(step(h, game), 'guess')
    assert.equal(game.round.guesserId, 'a1')
    a1('guess', { guess: 'cows' })
    assert.equal(step(h, game), 'guess')
    assert.equal(game.round.bank, 21 + 34)
    a2('guess', { guess: 'tractor' }) // one strike is enough in practice
    assert.equal(game.round.strikes, 1)
    assert.equal(step(h, game), 'steal')
    assert.equal(game.round.stealTeam, 1)
    b1('guess', { guess: 'horse' })
    assert.equal(step(h, game), 'done')
    assert.equal(game.round.winner, 1)
    assert.equal(game.round.awarded, 21 + 34 + 14)
    assert.deepEqual(game.teams.map((team) => team.score), [0, 0], 'nothing scores')
    h.fire() // the pause after the round
    assertRoundOne(h, game)
  })
  test('in practice, two face-off misses go to the coin toss', () => {
    const h = harness(), game = practiceGame(h)
    h.fire()
    host(h, game, 'buzz', { playerId: 'a0' })
    host(h, game, 'strike')
    assert.equal(step(h, game), 'answer')
    host(h, game, 'strike')
    assert.equal(step(h, game), 'choose')
  })
  test('with a host: the host rules, can’t end the game from the practice, and Next question starts round one', () => {
    const h = harness(), game = practiceGame(h)
    h.fire()
    host(h, game, 'buzz', { playerId: 'b0' })
    host(h, game, 'reveal', { index: 0 })
    assert.equal(step(h, game), 'choose')
    host(h, game, 'choose', { play: false })
    assert.equal(game.round.control, 0, 'passed to the other team')
    host(h, game, 'reveal', { index: 1 })
    host(h, game, 'strike')
    assert.equal(step(h, game), 'steal')
    host(h, game, 'strike') // the steal misses: the team in control wins the round, for nothing
    assert.equal(step(h, game), 'done')
    assert.equal(game.round.winner, 0)
    assert.deepEqual(game.teams.map((team) => team.score), [0, 0])
    host(h, game, 'endGame')
    assert.equal(game.status, 'playing', 'End game is refused in the practice')
    assert.ok(game.tutorial)
    host(h, game, 'nextRound')
    assertRoundOne(h, game)
  })
  test('with a host: only the TV or the host controller can skip, and a second skip does nothing', () => {
    const h = harness(), game = practiceGame(h)
    game.hostSocketId = 'tv'
    host(h, game, 'adjustScore', { team: 0, amount: 50 })
    h.fire()
    host(h, game, 'buzz', { playerId: 'a0' })
    skipEvents(h, 's-a1').skip(game)
    skipEvents(h, 's-a1').vote(game, 'a1')
    assert.equal(step(h, game), 'answer', 'a phone can’t skip a hosted practice')
    skipEvents(h, 'controller', { controllerGame: game.code }).skip(game)
    assertRoundOne(h, game)
    const round = game.round
    skipEvents(h, 'tv').skip(game)
    assert.equal(game.round, round, 'already in round one')
  })
  test('without a host: a strict majority of connected players skips, and only their own phones can vote', () => {
    const h = harness(), game = practiceGame(h, { hostless: true })
    host(h, game, 'adjustScore', { team: 1, amount: 30 })
    game.hostSocketId = 'tv'
    skipEvents(h, 'tv').skip(game)
    assert.ok(game.tutorial, 'no host to skip')
    skipEvents(h, 's-a0').vote(game, 'a1')
    assert.deepEqual(game.tutorial.votes, [], 'a vote from someone else’s phone')
    for (const id of ['a0', 'a1', 'b0']) skipEvents(h, `s-${id}`).vote(game, id)
    assert.ok(game.tutorial, '3 of 6 is not a majority')
    skipEvents(h, 's-b1').vote(game, 'b1')
    assertRoundOne(h, game)
  })
  test('a replay skips the practice', () => {
    const h = harness(), game = practiceGame(h)
    h.fire(); host(h, game, 'buzz', { playerId: 'a0' }); host(h, game, 'reveal', { index: 0 }); host(h, game, 'choose', { play: true })
    for (let i = 0; i < 7; i++) host(h, game, 'reveal', { index: game.round.revealed.indexOf(false) })
    assert.equal(step(h, game), 'done', 'the board cleared, so no steal')
    host(h, game, 'nextRound')
    host(h, game, 'replay', {})
    assert.equal(game.status, 'lobby')
    host(h, game, 'start')
    assert.equal(game.tutorial, null)
    assert.equal(h.api.publicGame(game).round.question, SURVEY.question)
  })
})
