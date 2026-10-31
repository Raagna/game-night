import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTongueGames, TONGUE_TIMES, PRACTICE } from './tongue.js'
import { registerTutorial, publicTutorial, inTutorial } from './tutorial.js'

// A game server without sockets or real timers: scheduled clocks run when a test calls fire().
function harness() {
  const games = new Map(), timers = {}, sockets = new Map(), rooms = new Map()
  const io = { sockets: { sockets, adapter: { rooms } } }
  const api = createTongueGames({
    io, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
    random: () => 0,
  })
  const handlersFor = (socket) => { const handlers = new Map(); api.register({ ...socket, on: (event, fn) => handlers.set(event, fn) }); return handlers }
  return {
    api, games, timers,
    fire: () => { const timer = timers.tongue; assert.ok(timer, 'no clock running'); delete timers.tongue; timer.fn() },
    // A phone event on that player's own connection; returns the acknowledgement.
    act: (game, playerId, event, payload = {}) => {
      const player = game.players.get(playerId)
      let reply
      handlersFor({ id: player.socketId, data: {} }).get(`tongue:${event}`)({ code: game.code, playerId, ...payload }, (result) => { reply = result })
      return reply
    },
    controllerPeek: (game) => { let reply; handlersFor({ id: 'ctrl', data: { controllerGame: game.code } }).get('tongue:peek')({ code: game.code }, (r) => { reply = r }); return reply },
  }
}
// The word pool as setup sends it: already shuffled, from whichever categories the host picked.
const WORDS = ['Banana', 'Mango', 'Kiwi', 'Lemon', 'Cherry', 'Grapes', 'Peach', 'Tennis', 'Golf', 'Hockey', 'Boxing', 'Rugby', 'Skiing', 'Polo', 'Rain', 'Snow']
function newGame(h, { players = 4, start = true, words = WORDS, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { words, rounds: 3, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) {
    const player = { id: `p${i}`, name: `Player ${i}`, score: 0, socketId: `s${i}` }
    game.players.set(player.id, player); h.api.playerJoined(game, player)
  }
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
const teamOf = (game, id) => game.teams.find((t) => t.id === id)

test('a game needs enough words for a turn, and repeats are dropped', () => {
  const h = harness()
  assert.throws(() => h.api.makeGame('X', { words: ['One', 'Two', 'Three'] }))
  assert.throws(() => h.api.makeGame('X', { words: ['Kiwi', 'kiwi', 'KIWI', 'Lime', 'Plum', 'Fig', 'Date'] }), 'only five different words')
})

test('players pair up in join order, and an odd player joins the last team at the start', () => {
  const h = harness(), game = newGame(h, { players: 5, start: false })
  assert.deepEqual(game.teams.map((t) => t.members), [['p0', 'p1'], ['p2', 'p3'], ['p4']])
  h.api.hostAction(game, 'start', {})
  assert.deepEqual(game.teams.map((t) => t.members), [['p0', 'p1'], ['p2', 'p3', 'p4']])
})

test('the clue-giver starts the clock when ready, or it starts by itself', () => {
  const h = harness(), game = newGame(h)
  assert.equal(game.turn.phase, 'ready')
  assert.equal(game.turn.clueGiverId, 'p0')
  assert.equal(h.timers.tongue.ms, TONGUE_TIMES.readyMs)
  h.act(game, 'p1', 'start')
  assert.equal(game.turn.phase, 'ready', 'only the clue-giver starts it')
  h.act(game, 'p0', 'start')
  assert.equal(game.turn.phase, 'play')
  assert.equal(h.timers.tongue.ms, TONGUE_TIMES.playMs)
  h.fire(); h.api.hostAction(game, 'next', {}) // time's up; next team
  assert.equal(game.turn.phase, 'ready')
  h.fire()
  assert.equal(game.turn.phase, 'play', 'nobody tapped Start: the clock starts anyway')
})

test('turns deal seven words in pool order, with no category, and no word twice until the pool runs out', () => {
  const h = harness(), game = newGame(h, { hostless: true })
  h.act(game, 'p0', 'start')
  assert.deepEqual(game.turn.words.map((w) => w.text), WORDS.slice(0, 7))
  assert.equal(h.api.publicGame(game).turn.category, undefined)
  h.fire(); h.fire() // time's up, results
  h.act(game, 'p2', 'start')
  assert.deepEqual(game.turn.words.map((w) => w.text), WORDS.slice(7, 14))
  h.fire(); h.fire()
  h.fire() // round two: nobody starts, the clock does
  assert.deepEqual(game.turn.words.map((w) => w.text), [...WORDS.slice(14), ...WORDS.slice(0, 5)], 'the pool starts over')
})

test('the word only goes to the clue-giver and the host controller, never the game state', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p0', 'start')
  assert.equal(h.act(game, 'p0', 'peek').word, 'Banana')
  assert.equal(h.act(game, 'p1', 'peek').ok, false)
  assert.equal(h.controllerPeek(game).word, 'Banana')
  assert.ok(!JSON.stringify(h.api.publicGame(game)).includes('Banana'))
})

test('typed guesses are checked; passes go to the back; fouls are thrown out', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p0', 'start')
  assert.equal(h.act(game, 'p1', 'guess', { guess: 'apple' }).correct, false)
  assert.equal(h.act(game, 'p1', 'guess', { guess: 'a banana' }).correct, true)
  assert.equal(h.act(game, 'p0', 'guess', { guess: 'mango' }).ok, false, 'the clue-giver can’t guess')
  h.act(game, 'p0', 'word', { action: 'pass' }) // Mango to the back
  assert.equal(h.act(game, 'p0', 'peek').word, 'Kiwi')
  h.act(game, 'p0', 'word', { action: 'foul' }) // Kiwi out
  h.act(game, 'p0', 'word', { action: 'got' }) // not allowed when typing
  assert.equal(game.turn.points, 1)
  h.fire()
  assert.equal(teamOf(game, 't1').score, 1)
  assert.deepEqual(game.turn.words.map((w) => w.status), ['got', 'passed', 'foul', 'missed', 'missed', 'missed', 'missed'])
})

test('clearing all seven banks a point for every second left', () => {
  const h = harness(), game = newGame(h, { guessing: 'aloud', hostless: true })
  h.act(game, 'p0', 'start')
  game.turn.deadline = Date.now() + 20000
  for (let i = 0; i < 7; i++) h.act(game, 'p0', 'word', { action: 'got' })
  assert.equal(game.turn.phase, 'done')
  assert.equal(game.turn.points, 7)
  assert.ok(game.turn.bonus >= 19 && game.turn.bonus <= 20)
  assert.equal(teamOf(game, 't1').score, 7 + game.turn.bonus)
})

test('partners swap every round, and in the last round the team chooses', () => {
  const h = harness(), game = newGame(h, { hostless: true })
  const playTurn = () => { h.fire(); h.fire(); h.fire() } // ready, play, done
  assert.equal(game.turn.clueGiverId, 'p0')
  playTurn()
  assert.equal(game.turn.teamId, 't2')
  assert.equal(game.turn.clueGiverId, 'p2')
  playTurn()
  assert.equal(game.roundIndex, 1)
  assert.equal(game.turn.clueGiverId, 'p1', 'roles swap in round two')
  playTurn(); playTurn()
  assert.equal(game.roundIndex, 2)
  assert.equal(game.turn.phase, 'choose')
  h.act(game, 'p1', 'choose')
  assert.equal(game.turn.clueGiverId, 'p1')
  assert.equal(game.turn.phase, 'ready')
})

test('the game ends after the last round', () => {
  const h = harness(), game = newGame(h, { players: 2, hostless: true })
  for (let round = 0; round < 3; round++) {
    if (game.turn.phase === 'choose') h.fire()
    h.fire(); h.fire(); h.fire()
  }
  assert.equal(game.status, 'complete')
})

test('a clue-giver who leaves hands over to a teammate', () => {
  const h = harness(), game = newGame(h, { players: 5 })
  h.act(game, 'p0', 'start')
  h.fire(); h.api.hostAction(game, 'next', {}) // team 2 (p2, p3, p4)
  assert.equal(game.turn.clueGiverId, 'p2')
  game.players.get('p2').socketId = null
  h.api.playerLeft(game, 'p2')
  assert.equal(game.turn.clueGiverId, 'p3')
})

test('in the lobby the host can move players between teams', () => {
  const h = harness(), game = newGame(h, { start: false })
  h.api.hostAction(game, 'movePlayer', { playerId: 'p1', teamId: 't2' })
  assert.deepEqual(game.teams.map((t) => t.members), [['p0'], ['p2', 'p3', 'p1']])
  h.api.hostAction(game, 'movePlayer', { playerId: 'p3', teamId: 't1' })
  assert.deepEqual(game.teams.map((t) => t.members), [['p0', 'p3'], ['p2', 'p1']])
})

// ---------- Practice round (the tutorial) ----------
// The skip events as server/index.js registers them for every socket, ending the practice with the mode's own
// endTutorial. `socketId` is the sender: 'host' is the TV in these tests, s0, s1… the players' phones.
function tutorialEvent(h, game, socketId, event, payload = {}) {
  const handlers = new Map()
  registerTutorial({ id: socketId, data: {}, on: (name, fn) => handlers.set(name, fn) }, { games: h.games, emitGame: () => {}, end: h.api.endTutorial })
  handlers.get(event)({ code: game.code, ...payload })
}
const practiceGame = (h, options = {}) => { const game = newGame(h, { tutorial: true, ...options }); game.hostSocketId = 'host'; return game }
// The step the screens see: the mode's publicGame works it out, and server/index.js adds publicTutorial to it.
const stepOf = (h, game) => { h.api.publicGame(game); return publicTutorial(game)?.step }
const allZero = (game) => game.teams.every((team) => team.score === 0)

test('with the practice option, the first team plays a short practice turn with the partners swapped', () => {
  const h = harness(), game = practiceGame(h)
  assert.ok(inTutorial(game))
  assert.equal(game.status, 'playing')
  assert.equal(stepOf(h, game), 'ready')
  assert.equal(game.turn.teamId, 't1')
  assert.equal(game.turn.clueGiverId, 'p1', 'the partner who guesses first in round one gives the practice clues')
  assert.equal(h.timers.tongue.ms, PRACTICE.times.readyMs)
  const turn = h.api.publicGame(game).turn
  assert.equal(turn.size, 3); assert.equal(turn.seconds, 25)
  assert.ok(!inTutorial(newGame(harness())), 'no practice without the option')
})

test('the practice walks through clue, got, pass and foul on easy words, and nothing scores', () => {
  const h = harness(), game = practiceGame(h)
  h.act(game, 'p1', 'start')
  assert.equal(stepOf(h, game), 'clue')
  assert.equal(h.timers.tongue.ms, PRACTICE.times.playMs)
  assert.equal(h.act(game, 'p1', 'peek').word, 'Pizza', 'the clue-giver sees the practice word')
  assert.equal(h.act(game, 'p0', 'peek').ok, false, 'the guesser doesn’t')
  assert.equal(h.act(game, 'p0', 'guess', { guess: 'pizza' }).correct, true)
  assert.equal(stepOf(h, game), 'got')
  h.act(game, 'p1', 'word', { action: 'pass' })
  assert.equal(stepOf(h, game), 'pass')
  h.act(game, 'p1', 'word', { action: 'foul' })
  assert.equal(stepOf(h, game), 'foul')
  h.act(game, 'p0', 'guess', { guess: 'snowman' })
  assert.equal(game.turn.phase, 'done')
  assert.equal(stepOf(h, game), 'done')
  assert.deepEqual(game.turn.words.map((w) => [w.text, w.status]), [['Pizza', 'got'], ['Snowman', 'got'], ['Birthday', 'foul']])
  assert.equal(game.turn.points, 2, 'the result shows what it would have scored')
  assert.ok(allZero(game))
  assert.equal(game.dealt, 0, 'the game’s word pool is untouched')
  // Skipping the practice's turn isn't a way out of it.
  h.api.hostAction(game, 'skipTurn', {})
  assert.ok(inTutorial(game))
})

test('a practice turn that clears every word shows its bonus but still scores nothing', () => {
  const h = harness(), game = practiceGame(h, { guessing: 'aloud', hostless: true })
  h.act(game, 'p1', 'start')
  for (let i = 0; i < 3; i++) h.act(game, 'p1', 'word', { action: 'got' })
  assert.equal(game.turn.phase, 'done')
  assert.ok(game.turn.bonus > 0)
  assert.ok(allZero(game))
})

test('a hosted practice ends when the host moves on, into round one at 0', () => {
  const h = harness(), game = practiceGame(h)
  h.act(game, 'p1', 'start')
  h.fire() // the practice clock runs out
  assert.equal(game.turn.phase, 'done')
  assert.equal(h.timers.tongue, undefined, 'the host starts the game')
  game.teams[0].score = 3 // a host adjustment during the practice
  h.api.hostAction(game, 'next', {})
  assert.ok(!inTutorial(game))
  assert.equal(publicTutorial(game), null)
  assert.equal(game.roundIndex, 0)
  assert.equal(game.turn.teamId, 't1')
  assert.equal(game.turn.clueGiverId, 'p0', 'partners swap for round one')
  assert.equal(game.turn.phase, 'ready')
  assert.equal(h.timers.tongue.ms, TONGUE_TIMES.readyMs, 'the real clocks are back')
  assert.equal(h.api.publicGame(game).turn.size, 7)
  assert.ok(allZero(game))
  h.act(game, 'p0', 'start')
  assert.deepEqual(game.turn.words.map((w) => w.text), WORDS.slice(0, 7), 'round one deals from the top of the pool')
})

test('a hostless practice moves on by itself into round one', () => {
  const h = harness(), game = practiceGame(h, { hostless: true })
  h.fire() // nobody taps Start: the practice clock starts anyway
  assert.equal(game.turn.phase, 'play')
  h.fire() // time's up
  assert.equal(game.turn.phase, 'done')
  assert.equal(h.timers.tongue.ms, PRACTICE.times.doneMs)
  h.fire()
  assert.ok(!inTutorial(game))
  assert.equal(game.turn.teamId, 't1')
  assert.equal(game.turn.clueGiverId, 'p0')
  assert.ok(allZero(game))
})

test('the host can skip the practice; players can’t, and the skip can’t run twice', () => {
  const h = harness(), game = practiceGame(h)
  h.act(game, 'p1', 'start')
  tutorialEvent(h, game, 's1', 'tutorial:skip')
  assert.ok(inTutorial(game), 'a phone can’t skip a hosted practice')
  tutorialEvent(h, game, 's1', 'tutorial:vote', { playerId: 'p1' })
  assert.ok(inTutorial(game), 'and there’s no vote with a host')
  tutorialEvent(h, game, 'host', 'tutorial:skip')
  assert.ok(!inTutorial(game))
  assert.equal(game.turn.phase, 'ready')
  assert.equal(game.turn.clueGiverId, 'p0')
  const turn = game.turn
  h.api.endTutorial(game)
  assert.equal(game.turn, turn, 'a second end does nothing')
})

test('without a host, a majority of the connected players skips the practice', () => {
  const h = harness(), game = practiceGame(h, { players: 5, hostless: true })
  tutorialEvent(h, game, 'host', 'tutorial:skip')
  assert.ok(inTutorial(game), 'no host skip without a host')
  tutorialEvent(h, game, 's0', 'tutorial:vote', { playerId: 'p0' })
  tutorialEvent(h, game, 's3', 'tutorial:vote', { playerId: 'p3' })
  assert.deepEqual(publicTutorial(game), { step: 'ready', steps: ['ready', 'clue', 'got', 'pass', 'foul', 'done'], votes: ['p0', 'p3'], connected: 5, needed: 3 })
  tutorialEvent(h, game, 's3', 'tutorial:vote', { playerId: 'p3' })
  assert.deepEqual(publicTutorial(game).votes, ['p0'], 'a second tap takes the vote back')
  tutorialEvent(h, game, 's2', 'tutorial:vote', { playerId: 'p3' })
  assert.deepEqual(publicTutorial(game).votes, ['p0'], 'only from their own phone')
  tutorialEvent(h, game, 's3', 'tutorial:vote', { playerId: 'p3' })
  tutorialEvent(h, game, 's4', 'tutorial:vote', { playerId: 'p4' })
  assert.ok(!inTutorial(game))
  assert.equal(game.turn.teamId, 't1')
  assert.deepEqual(game.order, ['t1', 't2'])
  assert.ok(allZero(game))
})

test('the practice team losing a player goes on to round one, and play again has no practice', () => {
  const h = harness(), game = practiceGame(h)
  game.players.get('p1').socketId = null
  h.api.playerLeft(game, 'p1')
  assert.ok(!inTutorial(game))
  assert.equal(game.turn.teamId, 't2', 'round one starts with the team that can play')
  h.api.hostAction(game, 'endGame', {})
  h.api.hostAction(game, 'replay', {})
  game.players.get('p1').socketId = 's1'
  h.api.hostAction(game, 'start', {})
  assert.ok(!inTutorial(game), 'play again goes straight to round one')
  assert.equal(game.turn.clueGiverId, 'p0')
})
