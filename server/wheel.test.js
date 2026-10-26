import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWheelGames, buildWheel, VOWEL_COST, SOLVE_MINIMUM, SLOTS_PER_WEDGE, CONSOLATION, SPEED_UP_BONUS, TIEBREAK_VALUE, WHEEL_TIMES, BONUS_ENVELOPES, MILLION_PRIZE } from './wheel.js'

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
    // The next numbers the game's random() will return (0.5 after that).
    randoms: (list) => { randoms = [...list] },
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
  assert.equal(game.winner, 0)
  // Bo solved nothing, so gets the $1,000 for playing, after the winner was decided.
  assert.deepEqual(game.contestants.map((c) => c.total), [SOLVE_MINIMUM, CONSOLATION])
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

// ---------- Game lengths, toss-ups, the speed-up, tiebreakers ----------
const tossup = (text, value = 1000) => ({ type: 'tossup', value, category: 'Phrase', text })
const round = (text) => ({ type: 'round', category: 'Phrase', text })

test('setup’s order of play is kept, the last main round is the final round, and main rounds are numbered', () => {
  const h = harness()
  const game = newGame(h, { start: false, segments: [tossup('Bob'), tossup('Tea set', 2000), round('Hello world'), round('Paper clip'), tossup('Big deal', 3000), round('Red rose')] })
  assert.deepEqual(game.segments.map((s) => [s.type, s.n ?? s.value]), [['tossup', 1000], ['tossup', 2000], ['round', 1], ['round', 2], ['tossup', 3000], ['final', 3]])
})

test('a toss-up turns one tile at a time; the first to buzz gets one try', () => {
  const h = harness(), game = newGame(h, { segments: [tossup('Hello world'), round('Paper clip')] })
  assert.equal(game.round.phase, 'tossupReveal')
  assert.equal(h.api.publicGame(game).round.blanks, 10)
  h.fire(); h.fire()
  // Tiles turn one at a time, not every copy of a letter.
  assert.equal(h.api.publicGame(game).round.blanks, 8)
  h.act(game, 'p2', 'solve', { guess: 'X' })
  assert.equal(game.round.phase, 'tossupReveal', 'no solving without buzzing in')
  h.act(game, 'p2', 'buzz')
  assert.equal(game.round.phase, 'tossupSolve')
  assert.equal(game.round.actorId, 'p2')
  h.act(game, 'p2', 'solve', { guess: 'LLOWORLD' })
  assert.equal(game.round.phase, 'roundEnd')
  assert.equal(game.contestants[1].total, 1000)
  h.api.hostAction(game, 'nextSegment', {})
  assert.equal(game.round.control, 1, 'the toss-up winner starts the next round')
})

test('a wrong toss-up solve locks that contestant out and the tiles keep coming', () => {
  const h = harness(), game = newGame(h, { segments: [tossup('Hello world'), round('Paper clip')] })
  h.act(game, 'p1', 'buzz')
  h.act(game, 'p1', 'solve', { guess: 'AAAAAAAAAA' })
  assert.equal(game.round.phase, 'tossupReveal')
  assert.deepEqual(game.round.lockedOut, [0])
  h.act(game, 'p1', 'buzz')
  assert.equal(game.round.phase, 'tossupReveal', 'a locked-out contestant can’t buzz again')
  h.act(game, 'p2', 'buzz')
  h.fire()
  // Bo ran out of time too: with everyone locked out, nobody wins it.
  assert.equal(game.round.phase, 'roundEnd')
  assert.equal(game.round.winner, null)
  assert.ok(game.contestants.every((c) => c.total === 0))
})

test('a toss-up nobody buzzes on ends with one letter left', () => {
  const h = harness(), game = newGame(h, { segments: [tossup('Bob ate'), round('Paper clip')] })
  for (let i = 0; i < 5; i++) h.fire()
  assert.equal(h.api.publicGame(game).round.blanks, 1)
  assert.equal(h.timers.wheel.ms, WHEEL_TIMES.tossupLastMs, 'a few last seconds to buzz in')
  h.fire()
  assert.equal(game.round.phase, 'roundEnd')
  assert.equal(game.round.winner, null)
})

test('the speed-up: the final spin sets consonants at its value + $1,000, respinning anything else', () => {
  const h = harness(), game = newGame(h, { speedUp: 'start', segments: [round('Hello world')] })
  assert.equal(game.round.phase, 'finalSpin')
  assert.equal(game.round.actorId, 'p1')
  // Lands on Bankrupt first: that doesn't count, and the wheel goes again by itself.
  h.spinTo(game, 'p1', BANKRUPT)
  assert.equal(game.round.phase, 'spinning')
  assert.equal(game.contestants[0].roundBank, 0)
  h.fire()
  // The second spin lands on the $800 wedge (where the harness's default number puts it).
  assert.equal(game.round.phase, 'speedLetter')
  assert.equal(game.round.speedUp.value, 800 + SPEED_UP_BONUS)
})

test('speed-up turns: a letter that’s there gives a few seconds to solve, vowels are free, misses pass', () => {
  const h = harness(), game = newGame(h, { speedUp: 'start', segments: [round('Hello world')] })
  h.spinTo(game, 'p1', CASH_600)
  assert.equal(game.round.value, 600 + SPEED_UP_BONUS)
  h.act(game, 'p1', 'letter', { letter: 'O' })
  assert.equal(game.contestants[0].roundBank, 0, 'vowels are free and worth nothing')
  assert.equal(game.round.phase, 'speedSolve')
  assert.equal(h.timers.wheel.ms, WHEEL_TIMES.quickSolveMs)
  h.act(game, 'p1', 'solve', { guess: 'XXXXXXXX' })
  assert.equal(game.round.phase, 'speedSolve', 'wrong tries are allowed until time runs out')
  assert.equal(game.round.control, 0)
  h.fire()
  assert.equal(game.round.phase, 'speedLetter')
  assert.equal(game.round.control, 1)
  h.act(game, 'p2', 'letter', { letter: 'Z' })
  assert.equal(game.round.control, 0)
  h.act(game, 'p1', 'letter', { letter: 'L' })
  assert.equal(game.contestants[0].roundBank, 3 * (600 + SPEED_UP_BONUS))
  h.act(game, 'p1', 'solve', { guess: 'HEWRD' })
  assert.equal(game.round.winner, 0)
  assert.equal(game.contestants[0].total, 3 * 1600)
})

test('the speed-up starts two minutes into the final round, at the next turn, or when the host says', () => {
  const h = harness(), game = newGame(h, { segments: [round('Hello world')] })
  assert.equal(game.round.phase, 'turn')
  game.round.speedUpAt = Date.now() - 1
  h.spinTo(game, 'p1', CASH_600)
  assert.equal(game.round.phase, 'consonant', 'the spin already under way is played out')
  h.act(game, 'p1', 'consonant', { letter: 'L' })
  assert.equal(game.round.phase, 'finalSpin')
  assert.equal(game.contestants[0].roundBank, 1800, 'money already won stays')

  const h2 = harness(), hosted = newGame(h2, { segments: [round('Hello world')] })
  h2.api.hostAction(hosted, 'speedUp', {})
  assert.equal(hosted.round.phase, 'finalSpin')
})

test('pausing holds back the speed-up', () => {
  const h = harness(), game = newGame(h, { segments: [round('Hello world')] })
  h.api.hostAction(game, 'pause', {})
  assert.ok(game.round.speedUpLeft > WHEEL_TIMES.speedUpAfterMs - 1000)
  game.round.speedUpLeft = 0
  h.api.hostAction(game, 'resume', {})
  h.fire()
  assert.equal(game.round.phase, 'finalSpin')
})

test('a tie for the lead is played off with a toss-up between the tied contestants only', () => {
  const h = harness()
  const game = newGame(h, { players: 3, hostless: true, segments: [round('Bob')], spares: [{ category: 'Thing', text: 'Paper clip' }] })
  for (const i of [0, 1]) Object.assign(game.contestants[i], { total: 4000, solvedAny: true })
  h.api.hostAction(game, 'revealPuzzle', {})
  h.fire()
  assert.equal(game.status, 'playing')
  assert.equal(game.round.type, 'tiebreak')
  assert.deepEqual(game.round.eligible, [0, 1])
  h.act(game, 'p3', 'buzz')
  assert.equal(game.round.phase, 'tossupReveal', 'Cy isn’t in the tie')
  h.act(game, 'p2', 'buzz')
  h.act(game, 'p2', 'solve', { guess: 'PAPERCLIP' })
  h.fire()
  assert.equal(game.status, 'complete')
  assert.equal(game.winner, 1)
  assert.equal(game.contestants[1].total, 4000 + TIEBREAK_VALUE)
  assert.equal(game.contestants[0].consolation, 0, 'only contestants who solved nothing get the $1,000')
  assert.equal(game.contestants[2].total, CONSOLATION)
})

test('with no spare puzzle left, a tie stands', () => {
  const h = harness(), game = newGame(h, { hostless: true, segments: [round('Bob')] })
  game.contestants.forEach((c) => { c.total = 2000; c.solvedAny = true })
  h.api.hostAction(game, 'revealPuzzle', {})
  h.fire()
  assert.equal(game.status, 'complete')
  assert.equal(game.winner, null)
})

// ---------- The bonus round ----------
const BONUS = [{ category: 'Thing', text: 'Glass jar' }, { category: 'Phrase', text: 'Big deal' }, { category: 'Place', text: 'Fox den' }]
// Ann solves the only round, so she wins and plays the bonus round.
function bonusGame(h, extra = {}) {
  const game = newGame(h, { segments: [round('Bob')], bonus: BONUS, ...extra })
  h.act(game, 'p1', 'solveStart')
  h.act(game, 'p1', 'solve', { guess: 'BOB' })
  if (game.hostless) h.fire(); else h.api.hostAction(game, 'nextSegment', {})
  return game
}
const envelopeAt = (h, game, index) => {
  h.randoms([(index * SLOTS_PER_WEDGE + 1) / (24 * SLOTS_PER_WEDGE), 0.5])
  h.act(game, 'p1', 'bonusSpin', { power: 0.7 })
  h.fire()
}

test('the winner plays the bonus round: pick a category, spin for an envelope, RSTLNE, three consonants and a vowel, solve', () => {
  const h = harness(), game = bonusGame(h)
  assert.equal(game.status, 'bonus')
  let view = h.api.publicGame(game).bonus
  assert.deepEqual([view.contestant, view.playerId, view.phase], [0, 'p1', 'pick'])
  assert.deepEqual(view.categories, ['Thing', 'Phrase', 'Place'])
  assert.equal(view.board, null)
  h.act(game, 'p2', 'bonusPick', { index: 0 })
  assert.equal(game.bonus.phase, 'pick', 'only the winner picks')
  h.act(game, 'p1', 'bonusPick', { index: 1 })
  assert.equal(game.bonus.phase, 'spin')
  assert.equal(h.api.publicGame(game).bonus.board, null, 'the puzzle stays hidden until the envelope is picked')
  // Unshuffled envelopes (the harness's random numbers are all equal), so envelope 0 holds $100,000.
  envelopeAt(h, game, 0)
  view = h.api.publicGame(game).bonus
  assert.equal(view.phase, 'given')
  assert.equal(view.envelope, 0)
  assert.equal(view.prize, null, 'the envelope stays sealed')
  // BIG DEAL with R S T L N E showing: the blanks are B I G D A.
  assert.equal(view.blanks, 5)
  h.fire()
  assert.equal(game.bonus.phase, 'letters')
  h.act(game, 'p1', 'bonusLetters', { consonants: ['B', 'G'], vowel: 'A' })
  h.act(game, 'p1', 'bonusLetters', { consonants: ['B', 'G', 'T'], vowel: 'A' })
  h.act(game, 'p1', 'bonusLetters', { consonants: ['B', 'G', 'D'], vowel: 'E' })
  assert.equal(game.bonus.phase, 'letters', 'two consonants, a given one, or a given vowel are all refused')
  h.act(game, 'p1', 'bonusLetters', { consonants: ['B', 'G', 'D'], vowel: 'A' })
  assert.equal(game.bonus.phase, 'lighting')
  assert.equal(h.api.publicGame(game).bonus.blanks, 1)
  h.fire()
  assert.equal(game.bonus.phase, 'solve')
  assert.equal(h.timers.wheel.ms, WHEEL_TIMES.quickSolveMs)
  h.act(game, 'p1', 'bonusSolve', { guess: 'O' })
  assert.equal(game.bonus.phase, 'solve', 'wrong tries are allowed until time runs out')
  h.act(game, 'p1', 'bonusSolve', { guess: 'I' })
  view = h.api.publicGame(game).bonus
  assert.equal(view.phase, 'envelope')
  assert.equal(view.solved, true)
  assert.equal(view.prize, 100000)
  assert.equal(view.solution, 'BIG DEAL')
  assert.equal(game.contestants[0].total, SOLVE_MINIMUM + 100000)
  assert.equal(h.timers.wheel, undefined, 'with a host, the host moves on to the final scores')
  h.api.hostAction(game, 'finishBonus', {})
  assert.equal(game.status, 'complete')
})

test('running out of time in the bonus round: the game picks and spins for them, no letters, and the envelope is opened anyway', () => {
  const h = harness(), game = bonusGame(h, { hostless: true })
  h.fire()
  assert.equal(game.bonus.phase, 'spin')
  h.fire()
  assert.equal(game.bonus.phase, 'spinning')
  h.fire(); h.fire()
  assert.equal(game.bonus.phase, 'letters')
  h.fire()
  assert.deepEqual(game.bonus.picked, [])
  h.fire(); h.fire()
  assert.equal(game.bonus.phase, 'envelope')
  assert.equal(game.bonus.solved, false)
  assert.ok(BONUS_ENVELOPES.includes(h.api.publicGame(game).bonus.prize))
  assert.equal(game.contestants[0].total, SOLVE_MINIMUM, 'no money without solving')
  h.fire()
  assert.equal(game.status, 'complete', 'without a host, the final scores follow by themselves')
})

test('the host can judge a bonus solve said out loud', () => {
  const h = harness(), game = bonusGame(h)
  h.act(game, 'p1', 'bonusPick', { index: 2 })
  envelopeAt(h, game, 1)
  h.fire()
  // FOX DEN: with N and E given, these show every letter, so there's no pause to light them up.
  h.act(game, 'p1', 'bonusLetters', { consonants: ['F', 'X', 'D'], vowel: 'O' })
  assert.equal(game.bonus.phase, 'solve')
  h.api.hostAction(game, 'judgeSolve', { correct: true })
  assert.equal(game.bonus.solved, true)
  assert.equal(game.contestants[0].total, SOLVE_MINIMUM + BONUS_ENVELOPES[1])
})

test('the Million Dollar wedge swaps the $100,000 envelope for $1,000,000; the Wild Card adds a fourth consonant', () => {
  const h = harness(), game = newGame(h, { segments: [round('Bob')], bonus: BONUS })
  Object.assign(game.contestants[0], { million: true, wildCard: true })
  h.act(game, 'p1', 'solveStart')
  h.act(game, 'p1', 'solve', { guess: 'BOB' })
  h.api.hostAction(game, 'nextSegment', {})
  assert.ok(game.bonus.envelopes.includes(MILLION_PRIZE) && !game.bonus.envelopes.includes(100000))
  h.act(game, 'p1', 'bonusPick', { index: 1 })
  envelopeAt(h, game, 0)
  h.fire()
  h.act(game, 'p1', 'bonusLetters', { consonants: ['B', 'G', 'D'], vowel: 'A' })
  assert.equal(game.bonus.phase, 'letters', 'with the Wild Card it takes four consonants')
  h.act(game, 'p1', 'bonusLetters', { consonants: ['B', 'G', 'D', 'C'], vowel: 'I' })
  assert.equal(game.bonus.phase, 'lighting')
  assert.deepEqual(game.bonus.picked, ['B', 'G', 'D', 'C', 'I'])
})

test('no bonus round when the host ends the game early, when the lead is tied, or without bonus puzzles', () => {
  const h = harness(), early = newGame(h, { segments: [round('Bob')], bonus: BONUS })
  h.api.hostAction(early, 'endGame', {})
  assert.equal(early.status, 'complete')

  const h2 = harness(), tied = newGame(h2, { segments: [round('Bob')], bonus: BONUS })
  tied.contestants.forEach((c) => { c.total = 3000; c.solvedAny = true })
  h2.api.hostAction(tied, 'revealPuzzle', {})
  h2.api.hostAction(tied, 'nextSegment', {})
  assert.equal(tied.status, 'complete')
  assert.equal(tied.bonus, null)

  const h3 = harness(), plain = newGame(h3, { segments: [round('Bob')] })
  h3.act(plain, 'p1', 'solveStart')
  h3.act(plain, 'p1', 'solve', { guess: 'BOB' })
  h3.api.hostAction(plain, 'nextSegment', {})
  assert.equal(plain.status, 'complete')
})

test('the host controller is sent the bonus answer once a category is picked', () => {
  const h = harness(), game = bonusGame(h)
  const got = []
  h.sockets.set('ctrl', { id: 'ctrl', data: { controllerGame: game.code }, emit: (name, data) => got.push(data.text) })
  h.rooms.set(game.code, new Set(['ctrl']))
  h.act(game, 'p1', 'bonusPick', { index: 0 })
  assert.deepEqual(got, ['GLASS JAR'])
})
