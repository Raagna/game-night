import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTongueGames, TONGUE_TIMES } from './tongue.js'

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
