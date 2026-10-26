import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWheelGames, buildWheel, VOWEL_COST, SOLVE_MINIMUM, SLOTS_PER_WEDGE } from './wheel.js'

// A game server without sockets or real timers: scheduled clocks run when a test calls fire(), and spins
// land where the test says.
function harness() {
  const games = new Map(), timers = {}, sockets = new Map(), rooms = new Map(), sent = []
  let randoms = []
  const io = { sockets: { sockets, adapter: { rooms } } }
  const api = createWheelGames({
    io, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
    random: () => (randoms.length ? randoms.shift() : 0.5),
  })
  const h = {
    api, games, timers, sockets, rooms, sent,
    fire: (name = 'wheel') => { const timer = timers[name]; assert.ok(timer, `no ${name} clock running`); delete timers[name]; timer.fn() },
    // A phone action, sent on that player's own connection.
    act: (game, playerId, name, payload = {}) => {
      const handlers = new Map(), player = game.players.get(playerId)
      api.register({ id: player.socketId, on: (event, fn) => handlers.set(event, fn) })
      handlers.get(`wheel:${name}`)({ code: game.code, playerId, ...payload })
    },
    // Spin, and stop the wheel on this wedge.
    spinTo: (game, playerId, wedge) => {
      randoms = [(wedge * SLOTS_PER_WEDGE + 1) / (24 * SLOTS_PER_WEDGE), 0.5]
      h.act(game, playerId, 'spin', { power: 0.8 })
      assert.equal(game.round.phase, 'spinning')
      h.fire()
    },
  }
  return h
}
function newGame(h, { puzzles = [{ category: 'Phrase', text: 'Hello world' }], players = 2, start = true, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { puzzles, ...config })
  h.games.set(game.code, game)
  for (const [id, name] of [['p1', 'Ann'], ['p2', 'Bo'], ['p3', 'Cy']].slice(0, players)) {
    const player = { id, name, score: 0, socketId: `s-${id}` }
    game.players.set(id, player); h.api.playerJoined(game, player)
  }
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
// Wedge positions on the round-1 wheel.
const CASH_600 = 1, BANKRUPT = 7, LOSE_TURN = 16, TOP = 0
const visibleLetters = (game) => game.round.board.flat().filter((cell) => cell?.letter && cell.ch).map((cell) => cell.ch).join('')

test('every round has 24 wedges with the show’s top value, two Bankrupts and one Lose a Turn', () => {
  ;[1, 2, 3, 4, 5].forEach((n, i) => {
    const wheel = buildWheel(n)
    assert.equal(wheel.length, 24)
    assert.equal(wheel[TOP].value, [2500, 3500, 3500, 5000, 5000][i])
    assert.equal(wheel.filter((w) => w.kind === 'bankrupt').length, 2)
    assert.equal(wheel.filter((w) => w.kind === 'loseTurn').length, 1)
  })
  assert.deepEqual(buildWheel(1)[CASH_600], { kind: 'cash', value: 600 })
  assert.equal(buildWheel(1)[BANKRUPT].kind, 'bankrupt')
  assert.equal(buildWheel(1)[LOSE_TURN].kind, 'loseTurn')
})

test('starting gives contestant 1 the first turn with the decide clock running', () => {
  const h = harness(), game = newGame(h)
  assert.equal(game.status, 'playing')
  assert.equal(game.round.phase, 'turn')
  assert.equal(game.round.control, 0)
  assert.equal(game.round.actorId, 'p1')
  assert.ok(h.timers.wheel)
})

test('a consonant on a cash wedge pays the value for every time it appears', () => {
  const h = harness(), game = newGame(h)
  h.spinTo(game, 'p1', CASH_600)
  assert.equal(game.round.phase, 'consonant')
  assert.equal(game.round.value, 600)
  h.act(game, 'p1', 'consonant', { letter: 'l' })
  assert.equal(game.contestants[0].roundBank, 1800)
  assert.equal(game.round.phase, 'turn')
  assert.equal(game.round.control, 0)
  assert.equal(visibleLetters(h.api.publicGame(game)), 'LLL')
})

test('only the player in control can act', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p2', 'spin')
  assert.equal(game.round.phase, 'turn')
  h.act(game, 'p1', 'consonant', { letter: 'L' })
  assert.equal(game.round.called.length, 0, 'no consonant without a spin')
})

test('a letter not in the puzzle passes control, and can’t be called again', () => {
  const h = harness(), game = newGame(h)
  h.spinTo(game, 'p1', CASH_600)
  h.act(game, 'p1', 'consonant', { letter: 'Z' })
  assert.equal(game.round.control, 1)
  assert.deepEqual(h.api.publicGame(game).round.misses, ['Z'])
  h.spinTo(game, 'p2', CASH_600)
  h.act(game, 'p2', 'consonant', { letter: 'Z' })
  assert.equal(game.round.phase, 'consonant', 'a called letter is ignored')
})

test('Bankrupt empties the round bank and Lose a Turn passes control', () => {
  const h = harness(), game = newGame(h)
  h.spinTo(game, 'p1', CASH_600)
  h.act(game, 'p1', 'consonant', { letter: 'L' })
  h.spinTo(game, 'p1', BANKRUPT)
  assert.equal(game.contestants[0].roundBank, 0)
  assert.equal(game.round.control, 1)
  h.spinTo(game, 'p2', LOSE_TURN)
  assert.equal(game.round.control, 0)
})

test('buying a vowel costs $250 and needs the money', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p1', 'buyVowel', { letter: 'O' })
  assert.deepEqual(game.round.called, [], 'no vowel with an empty bank')
  h.spinTo(game, 'p1', CASH_600)
  h.act(game, 'p1', 'consonant', { letter: 'L' })
  h.act(game, 'p1', 'buyVowel', { letter: 'O' })
  assert.equal(game.contestants[0].roundBank, 1800 - VOWEL_COST)
  assert.equal(game.round.control, 0, 'a vowel in the puzzle keeps the turn')
  h.act(game, 'p1', 'buyVowel', { letter: 'A' })
  assert.equal(game.contestants[0].roundBank, 1800 - 2 * VOWEL_COST)
  assert.equal(game.round.control, 1, 'a vowel that isn’t there passes control')
})

test('a fill-in-the-blanks solve banks the round, at least $1,000, and wipes everyone else’s bank', () => {
  const h = harness(), game = newGame(h)
  h.spinTo(game, 'p1', CASH_600)
  h.act(game, 'p1', 'consonant', { letter: 'Z' })
  h.spinTo(game, 'p2', CASH_600)
  h.act(game, 'p2', 'consonant', { letter: 'L' })
  h.act(game, 'p2', 'solveStart')
  assert.equal(game.round.phase, 'solving')
  // HELLO WORLD with the L's showing: the blanks are H E O W O R D.
  h.act(game, 'p2', 'solve', { guess: 'heoword' })
  assert.equal(game.round.phase, 'roundEnd')
  assert.equal(game.round.winner, 1)
  assert.equal(game.contestants[1].total, 1800)
  assert.ok(game.contestants.every((c) => c.roundBank === 0))
  assert.equal(h.api.publicGame(game).round.solution, 'HELLO WORLD')
})

test('solving for less than $1,000 is raised to $1,000', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p1', 'solveStart')
  h.act(game, 'p1', 'solve', { guess: 'HELLOWORLD' })
  assert.equal(game.contestants[0].total, SOLVE_MINIMUM)
})

test('a wrong solve shows the attempt and passes control', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p1', 'solveStart')
  h.act(game, 'p1', 'solve', { guess: 'HELLOWORDS' })
  assert.equal(game.round.control, 1)
  assert.equal(game.round.phase, 'turn')
  assert.deepEqual({ ...game.round.lastSolve, playerId: undefined }, { playerId: undefined, contestant: 0, text: 'HELLO WORDS', correct: false })
})

test('the last letter showing solves the puzzle for whoever called it', () => {
  const h = harness(), game = newGame(h, { puzzles: [{ category: 'Thing', text: 'Bob' }] })
  h.spinTo(game, 'p1', CASH_600)
  h.act(game, 'p1', 'consonant', { letter: 'B' })
  h.act(game, 'p1', 'buyVowel', { letter: 'O' })
  assert.equal(game.round.phase, 'roundEnd')
  assert.equal(game.round.winner, 0)
  assert.equal(game.contestants[0].total, SOLVE_MINIMUM)
})

test('no spinning once every consonant is showing', () => {
  const h = harness(), game = newGame(h, { puzzles: [{ category: 'Thing', text: 'Bob ate' }] })
  for (const letter of ['B', 'T']) {
    h.spinTo(game, game.round.actorId, CASH_600)
    h.act(game, game.round.actorId, 'consonant', { letter })
  }
  const { round } = h.api.publicGame(game)
  assert.equal(round.consonantsLeft, false)
  assert.equal(round.vowelsLeft, true)
  h.act(game, game.round.actorId, 'spin')
  assert.equal(game.round.phase, 'turn')
})

test('the board never carries hidden letters or the answer while the round is on', () => {
  const h = harness(), game = newGame(h)
  const sent = JSON.stringify(h.api.publicGame(game))
  assert.ok(!sent.includes('HELLO'))
  assert.ok(!/"ch":"[A-Z]"/.test(sent))
  assert.equal(h.api.publicGame(game).round.blanks, 10)
})

test('running out of time passes control; the host can pause and resume the clock', () => {
  const h = harness(), game = newGame(h)
  h.fire()
  assert.equal(game.round.control, 1)
  assert.equal(game.lastEvent.type, 'control')
  h.api.hostAction(game, 'pause', {})
  assert.equal(game.round.deadline, null)
  assert.ok(game.round.pausedMs > 0)
  assert.equal(h.timers.wheel, undefined)
  h.api.hostAction(game, 'resume', {})
  assert.ok(game.round.deadline)
  assert.ok(h.timers.wheel)
})

test('relaxed pace doubles the decide clock', () => {
  const h = harness(), game = newGame(h, { pace: 'relaxed' })
  assert.equal(h.timers.wheel.ms, 20000)
})

test('the host judges a spoken solve', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p1', 'solveStart')
  h.api.hostAction(game, 'judgeSolve', { correct: true })
  assert.equal(game.round.winner, 0)
})

test('without a host, rounds move on by themselves and the game ends after the last', () => {
  const h = harness(), game = newGame(h, { hostless: true, puzzles: [{ category: 'Thing', text: 'Bob' }, { category: 'Thing', text: 'Tea set' }] })
  h.act(game, 'p1', 'solveStart')
  h.act(game, 'p1', 'solve', { guess: 'BOB' })
  h.fire()
  assert.equal(game.segmentIndex, 1)
  assert.equal(game.round.control, 1, 'round 2 starts with contestant 2')
  h.api.hostAction(game, 'revealPuzzle', {})
  h.fire()
  assert.equal(game.status, 'complete')
  assert.deepEqual(game.contestants.map((c) => c.total), [SOLVE_MINIMUM, 0])
})

test('a player leaving on their turn passes control; kicking in the lobby removes their podium', () => {
  const h = harness(), game = newGame(h, { players: 3 })
  game.players.get('p1').socketId = null
  h.api.playerLeft(game, 'p1')
  assert.equal(game.round.control, 1)

  const h2 = harness(), lobby = newGame(h2, { players: 3, start: false })
  h2.api.hostAction(lobby, 'kickPlayer', { playerId: 'p2' })
  assert.deepEqual(lobby.contestants.map((c) => c.name), ['Ann', 'Cy'])
  assert.equal(lobby.players.get('p3').contestant, 1)
})

test('only host controllers get the answer, never the TV, and never without a host', () => {
  const h = harness(), game = newGame(h, { start: false })
  const got = []
  const socket = (id, controller) => ({ id, data: { controllerGame: controller ? game.code : undefined }, emit: (name, data) => got.push([id, name, data]) })
  for (const s of [socket('tv', true), socket('ctrl', true), socket('phone', false)]) h.sockets.set(s.id, s)
  h.rooms.set(game.code, new Set(['tv', 'ctrl', 'phone']))
  game.hostSocketId = 'tv'
  h.api.hostAction(game, 'start', {})
  assert.deepEqual(got, [['ctrl', 'wheel:solution', { code: game.code, category: 'Phrase', text: 'HELLO WORLD' }]])
  got.length = 0
  h.api.hostJoined(game, h.sockets.get('tv'))
  assert.equal(got.length, 0)

  const h3 = harness(), hostless = newGame(h3, { hostless: true, start: false })
  h3.sockets.set('ctrl', { id: 'ctrl', data: { controllerGame: hostless.code }, emit: () => got.push('leak') })
  h3.rooms.set(hostless.code, new Set(['ctrl']))
  h3.api.hostAction(hostless, 'start', {})
  assert.equal(got.length, 0)
})

test('bad puzzles are dropped, and a game needs at least one', () => {
  const h = harness()
  const game = h.api.makeGame('X', { puzzles: [{ category: 'Phrase', text: 'Route 66' }, { category: 'Thing', text: 'Paper clip' }] })
  assert.equal(game.segments.length, 1)
  assert.throws(() => h.api.makeGame('Y', { puzzles: [{ text: 'Route 66' }] }), /at least one puzzle/)
})
