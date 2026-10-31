import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFibGames, multipliers, displayAnswer, POINTS, FIB_TIMES, PRACTICE_CHOICES } from './fib.js'
import { registerTutorial, publicTutorial, inTutorial } from './tutorial.js'

// A game server without sockets or real timers: scheduled clocks run when a test calls fire().
function harness() {
  const games = new Map(), timers = {}, sockets = new Map(), rooms = new Map(), secrets = []
  const io = { sockets: { sockets, adapter: { rooms } } }
  const api = createFibGames({
    io, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
    random: () => 0.5,
  })
  const h = {
    api, games, timers, sockets, rooms, secrets,
    fire: (name = 'fib') => { const timer = timers[name]; assert.ok(timer, `no ${name} clock running`); delete timers[name]; timer.fn() },
    // A phone action, sent on that player's own connection; returns what the server acknowledged.
    act: (game, playerId, name, payload = {}) => {
      const handlers = new Map(), player = game.players.get(playerId)
      api.register({ id: player.socketId, on: (event, fn) => handlers.set(event, fn) })
      let reply
      handlers.get(`fib:${name}`)({ code: game.code, playerId, ...payload }, (result) => { reply = result })
      return reply
    },
    // A host controller in the game's room, collecting the secrets sent to it.
    controller: (game) => {
      const socket = { id: 'ctrl', data: { controllerGame: game.code }, emit: (event, data) => secrets.push({ event, data }) }
      sockets.set(socket.id, socket); rooms.set(game.code, new Set([...(rooms.get(game.code) || []), socket.id]))
      return socket
    },
  }
  return h
}
const clue = (category, question, answer, decoys = []) => ({ category, question, answer, decoys })
const PROMPTS = [
  { choices: [clue('RULERS', 'In 1762 she overthrew her husband to become empress of Russia', 'Catherine (the Great)', ['a lion', 'Wenceslas', 'sultan', 'Albania']), clue('WARS', 'Dutch for "farmer"', 'the Boers')] },
  { choices: [clue('ROCKS', 'The black glass produced by volcanoes', 'obsidian', ['white', 'garnet'])] },
]
function newGame(h, { players = 3, start = true, prompts = PROMPTS, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { prompts, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) {
    const player = { id: `p${i}`, name: `Player ${i}`, score: 0, socketId: `s${i}` }
    game.players.set(player.id, player); h.api.playerJoined(game, player)
  }
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
const writeAll = (h, game, fibs) => fibs.forEach((fib, i) => assert.ok(h.act(game, `p${i}`, 'write', { fib })?.ok, `p${i}'s fib`))
const optionText = (game, text) => game.round.options.find((option) => option.text === text)

test('points double in the second half and triple on the final clue', () => {
  assert.deepEqual(multipliers(5), [1, 1, 2, 2, 3])
  assert.deepEqual(multipliers(7), [1, 1, 1, 2, 2, 2, 3])
  assert.deepEqual(multipliers(2), [1, 3])
  assert.deepEqual(multipliers(1), [1])
})

test('the fact is shown without optional parts or quote marks', () => {
  assert.equal(displayAnswer('Catherine (the Great)'), 'Catherine')
  assert.equal(displayAnswer('"Hamlet"'), 'Hamlet')
  assert.equal(displayAnswer('(Frank) Sinatra'), 'Sinatra')
  assert.equal(displayAnswer('(Maine)'), 'Maine')
})

test('a game needs two connected players to start and a clue to play', () => {
  const h = harness()
  assert.throws(() => h.api.makeGame('X', { prompts: [] }))
  const game = newGame(h, { players: 1 })
  assert.equal(game.status, 'lobby')
})

test('the chooser picks a category, and only the chooser can', () => {
  const h = harness(), game = newGame(h)
  assert.equal(game.round.phase, 'pick')
  assert.equal(game.round.chooserId, 'p0')
  h.act(game, 'p1', 'pick', { choice: 1 })
  assert.equal(game.round.phase, 'pick')
  h.act(game, 'p0', 'pick', { choice: 1 })
  assert.equal(game.round.phase, 'write')
  assert.equal(game.round.clue.category, 'WARS')
  assert.equal(h.timers.fib.ms, FIB_TIMES.writeMs)
})

test('a clue with one choice skips the pick, and nobody picking in time picks for them', () => {
  const h = harness(), game = newGame(h)
  h.fire()
  assert.equal(game.round.phase, 'write')
  const two = newGame(harness(), { prompts: [PROMPTS[1]] })
  assert.equal(two.round.phase, 'write')
})

test('the real answer and copies of other fibs are turned away', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p0', 'pick', { choice: 0 })
  const fact = h.act(game, 'p0', 'write', { fib: 'catherine the great' })
  assert.equal(fact.ok, false); assert.equal(fact.fact, true)
  assert.equal(h.act(game, 'p0', 'write', { fib: 'Elizabeth' }).ok, true)
  assert.equal(h.act(game, 'p0', 'write', { fib: 'Anne' }).ok, false, 'one fib each')
  assert.equal(h.act(game, 'p1', 'write', { fib: 'Elizabth' }).ok, false, 'a near copy')
  assert.equal(h.act(game, 'p1', 'write', { fib: '' }).ok, false)
})

test('voting starts once everyone has written, with house fibs topping up the choices', () => {
  const h = harness(), game = newGame(h, { players: 2 })
  h.act(game, 'p0', 'pick', { choice: 0 })
  writeAll(h, game, ['Elizabeth', 'Anne'])
  assert.equal(game.round.phase, 'vote')
  const texts = game.round.options.map((option) => option.text)
  assert.equal(texts.length, 4)
  assert.ok(texts.includes('Catherine') && texts.includes('Elizabeth') && texts.includes('Anne'))
  assert.equal(game.round.options.filter((option) => option.house).length, 1)
  // The phones can't tell which choice is which until the reveal.
  const pub = h.api.publicGame(game).round
  assert.ok(pub.options.every((option) => option.fact === undefined && option.authors === undefined))
})

test('finding the fact and fooling players score, after the reveal, times the round multiplier', () => {
  const h = harness(), game = newGame(h, { hostless: true })
  h.act(game, 'p0', 'pick', { choice: 0 })
  writeAll(h, game, ['Elizabeth', 'Anne', 'Victoria'])
  const fact = optionText(game, 'Catherine'), anne = optionText(game, 'Anne'), elizabeth = optionText(game, 'Elizabeth')
  h.act(game, 'p0', 'vote', { optionId: elizabeth.id })
  assert.equal(game.round.votes.p0, undefined, 'no voting for your own fib')
  h.act(game, 'p0', 'vote', { optionId: anne.id })
  h.act(game, 'p1', 'vote', { optionId: elizabeth.id })
  h.act(game, 'p2', 'vote', { optionId: fact.id })
  assert.equal(game.round.phase, 'reveal')
  // Least popular fooling fib first (a tie keeps the board order), the fact last; unpicked fibs aren't revealed.
  assert.equal(game.round.reveal.at(-1), fact.id)
  assert.deepEqual(new Set(game.round.reveal.slice(0, 2)), new Set([anne.id, elizabeth.id]))
  assert.equal(game.players.get('p1').score, 0, 'scores wait for the scores screen')
  assert.equal(h.api.publicGame(game).round.options.filter((option) => option.authors).length, 1)
  h.fire(); h.fire()
  assert.equal(game.round.phase, 'reveal')
  h.fire()
  assert.equal(game.round.phase, 'scores')
  assert.equal(game.players.get('p0').score, POINTS.fooled)
  assert.equal(game.players.get('p1').score, POINTS.fooled)
  assert.equal(game.players.get('p2').score, POINTS.fact)
  assert.deepEqual(game.round.awards.p1.fooledIds, ['p0'])
})

test('hostless games move through the reveal and scores on their own; hosted games wait for the host', () => {
  const h = harness(), game = newGame(h, { hostless: true, players: 2 })
  h.act(game, 'p0', 'pick', { choice: 0 })
  writeAll(h, game, ['Elizabeth', 'Anne'])
  h.fire() // voting time runs out with nobody voting
  assert.equal(game.round.phase, 'reveal')
  h.fire()
  assert.equal(game.round.phase, 'scores')
  h.fire()
  assert.equal(game.index, 1)
  assert.equal(game.round.phase, 'write')

  const hosted = harness(), other = newGame(hosted, { players: 2 })
  hosted.act(other, 'p0', 'pick', { choice: 0 })
  writeAll(hosted, other, ['Elizabeth', 'Anne'])
  hosted.fire()
  assert.equal(other.round.phase, 'reveal')
  assert.equal(hosted.timers.fib, undefined)
  hosted.api.hostAction(other, 'next', {})
  assert.equal(other.round.phase, 'scores')
  assert.equal(hosted.timers.fib, undefined)
  hosted.api.hostAction(other, 'next', {})
  assert.equal(other.index, 1)
})

test('the last clue ends the game', () => {
  const h = harness(), game = newGame(h, { prompts: [PROMPTS[1]], players: 2, hostless: true })
  writeAll(h, game, ['basalt', 'quartz'])
  h.fire(); h.fire(); h.fire()
  assert.equal(game.status, 'complete')
})

test('the host sees the fact and the fibs, and can throw one out', () => {
  const h = harness(), game = newGame(h)
  h.controller(game)
  h.act(game, 'p0', 'pick', { choice: 0 })
  assert.equal(h.secrets.at(-1).data.fact, 'Catherine (the Great)')
  h.act(game, 'p0', 'write', { fib: 'Rude word' })
  assert.deepEqual(h.secrets.at(-1).data.fibs, [{ playerId: 'p0', text: 'Rude word' }])
  h.api.hostAction(game, 'removeFib', { playerId: 'p0' })
  assert.deepEqual(h.api.publicGame(game).round.removed, ['p0'])
  assert.equal(h.act(game, 'p0', 'write', { fib: 'Elizabeth' }).ok, true, 'they can write another')
  h.act(game, 'p1', 'write', { fib: 'Anne' }); h.act(game, 'p2', 'write', { fib: 'Victoria' })
  const anne = optionText(game, 'Anne')
  h.act(game, 'p0', 'vote', { optionId: anne.id })
  h.api.hostAction(game, 'removeFib', { playerId: 'p1' })
  assert.equal(optionText(game, 'Anne'), undefined)
  assert.equal(game.round.votes.p0, undefined, 'their voter votes again')
})

test('hostless games keep the fact away from every screen until the reveal', () => {
  const h = harness(), game = newGame(h, { hostless: true })
  h.controller(game)
  h.act(game, 'p0', 'pick', { choice: 0 })
  assert.equal(h.secrets.length, 0)
  assert.ok(!JSON.stringify(h.api.publicGame(game)).includes('Catherine'))
})

test('a player who leaves while writing or voting isn’t waited for', () => {
  const h = harness(), game = newGame(h)
  h.act(game, 'p0', 'pick', { choice: 0 })
  h.act(game, 'p0', 'write', { fib: 'Elizabeth' }); h.act(game, 'p1', 'write', { fib: 'Anne' })
  game.players.get('p2').socketId = null
  h.api.playerLeft(game, 'p2')
  assert.equal(game.round.phase, 'vote')
  h.act(game, 'p0', 'vote', { optionId: optionText(game, 'Anne').id })
  game.players.get('p1').socketId = null
  h.api.playerLeft(game, 'p1')
  assert.equal(game.round.phase, 'reveal')
})

test('play again resets the scores and deals new clues', () => {
  const h = harness(), game = newGame(h)
  game.players.get('p0').score = 2500
  h.api.hostAction(game, 'replay', { prompts: [PROMPTS[1]] })
  assert.equal(game.status, 'lobby')
  assert.equal(game.prompts.length, 1)
  assert.equal(game.players.get('p0').score, 0)
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
const allZero = (game) => [...game.players.values()].every((player) => player.score === 0)

test('with the practice option, the game starts on a practice clue with easy categories', () => {
  const h = harness(), game = practiceGame(h)
  assert.ok(inTutorial(game))
  assert.equal(game.status, 'playing')
  assert.equal(stepOf(h, game), 'pick')
  assert.deepEqual(h.api.publicGame(game).round.categories, PRACTICE_CHOICES.map((clue) => clue.category))
  assert.equal(game.round.chooserId, 'p0')
  assert.ok(!inTutorial(newGame(harness())), 'no practice without the option')
})

test('the practice walks through pick, write, vote, reveal and the scores, and nothing scores', () => {
  const h = harness(), game = practiceGame(h)
  h.controller(game)
  h.act(game, 'p0', 'pick', { choice: 0 })
  assert.equal(stepOf(h, game), 'write')
  assert.equal(game.round.clue.answer, 'Mars')
  assert.equal(h.secrets.at(-1).data.index, -1, 'the practice secret is never taken for the first real clue’s')
  assert.equal(h.act(game, 'p0', 'write', { fib: 'mars' }).fact, true, 'the real answer is still turned away')
  writeAll(h, game, ['Venus', 'Pluto', 'The Moon'])
  assert.equal(stepOf(h, game), 'vote')
  const fact = optionText(game, 'Mars'), pluto = optionText(game, 'Pluto')
  h.act(game, 'p0', 'vote', { optionId: pluto.id })
  h.act(game, 'p1', 'vote', { optionId: fact.id })
  h.act(game, 'p2', 'vote', { optionId: fact.id })
  assert.equal(stepOf(h, game), 'reveal')
  h.api.hostAction(game, 'next', {})
  h.api.hostAction(game, 'next', {})
  assert.equal(game.round.phase, 'scores')
  assert.equal(stepOf(h, game), 'done')
  // The scores screen shows what they would have won, but nobody's score moves.
  assert.equal(game.round.awards.p1.points, POINTS.fooled + POINTS.fact)
  assert.equal(game.round.awards.p2.points, POINTS.fact)
  assert.ok(allZero(game))
  // Skipping the practice's clue isn't a way out of it.
  h.api.hostAction(game, 'skipClue', {})
  assert.ok(inTutorial(game))
})

test('a hosted practice ends when the host moves on from its scores, into the first real clue at 0', () => {
  const h = harness(), game = practiceGame(h, { players: 2 })
  h.act(game, 'p0', 'pick', { choice: 1 })
  writeAll(h, game, ['lime', 'pea'])
  h.fire() // voting runs out with nobody voting, so the reveal goes straight to the fact
  h.api.hostAction(game, 'next', {})
  assert.equal(game.round.phase, 'scores')
  assert.equal(h.timers.fib, undefined, 'the host starts the game')
  game.players.get('p0').score = 500 // a host adjustment during the practice
  h.api.hostAction(game, 'next', {})
  assert.ok(!inTutorial(game))
  assert.equal(publicTutorial(game), null)
  assert.equal(game.index, 0)
  assert.equal(game.round.phase, 'pick')
  assert.deepEqual(h.api.publicGame(game).round.categories, ['RULERS', 'WARS'])
  assert.equal(game.round.chooserId, 'p1', 'the next player picks the first real clue')
  assert.ok(allZero(game))
})

test('a hostless practice moves on by itself into the first real clue', () => {
  const h = harness(), game = practiceGame(h, { players: 2, hostless: true })
  h.fire() // nobody picks in time
  assert.equal(game.round.phase, 'write')
  writeAll(h, game, ['Venus', 'Pluto'])
  h.fire() // voting
  h.fire() // the fact
  assert.equal(game.round.phase, 'scores')
  assert.equal(h.timers.fib.ms, FIB_TIMES.scoresMs)
  h.fire()
  assert.ok(!inTutorial(game))
  assert.equal(game.index, 0)
  assert.equal(game.round.choices[0].category, 'RULERS')
  assert.ok(allZero(game))
})

test('the host can skip the practice; players can’t, and the skip can’t run twice', () => {
  const h = harness(), game = practiceGame(h)
  h.act(game, 'p0', 'pick', { choice: 0 })
  h.act(game, 'p0', 'write', { fib: 'Venus' })
  tutorialEvent(h, game, 's1', 'tutorial:skip')
  assert.ok(inTutorial(game), 'a phone can’t skip a hosted practice')
  tutorialEvent(h, game, 's1', 'tutorial:vote', { playerId: 'p1' })
  assert.ok(inTutorial(game), 'and there’s no vote with a host')
  tutorialEvent(h, game, 'host', 'tutorial:skip')
  assert.ok(!inTutorial(game))
  assert.equal(game.round.phase, 'pick')
  assert.equal(game.round.choices[0].category, 'RULERS')
  const round = game.round
  h.api.endTutorial(game)
  assert.equal(game.round, round, 'a second end does nothing')
})

test('without a host, a majority of the connected players skips the practice', () => {
  const h = harness(), game = practiceGame(h, { players: 4, hostless: true })
  tutorialEvent(h, game, 'host', 'tutorial:skip')
  assert.ok(inTutorial(game), 'no host skip without a host')
  tutorialEvent(h, game, 's0', 'tutorial:vote', { playerId: 'p0' })
  tutorialEvent(h, game, 's1', 'tutorial:vote', { playerId: 'p1' })
  assert.ok(inTutorial(game), '2 of 4 isn’t a majority')
  assert.deepEqual(publicTutorial(game), { step: 'pick', steps: ['pick', 'write', 'vote', 'reveal', 'done'], votes: ['p0', 'p1'], connected: 4, needed: 3 })
  tutorialEvent(h, game, 's1', 'tutorial:vote', { playerId: 'p1' })
  assert.deepEqual(publicTutorial(game).votes, ['p0'], 'a second tap takes the vote back')
  tutorialEvent(h, game, 's2', 'tutorial:vote', { playerId: 'p1' })
  assert.deepEqual(publicTutorial(game).votes, ['p0'], 'only from their own phone')
  tutorialEvent(h, game, 's1', 'tutorial:vote', { playerId: 'p1' })
  tutorialEvent(h, game, 's2', 'tutorial:vote', { playerId: 'p2' })
  assert.ok(!inTutorial(game))
  assert.equal(game.round.choices[0].category, 'RULERS')
  assert.ok(allZero(game))
})

test('kicking a player can carry the vote to skip, and play again has no practice', () => {
  const h = harness(), game = practiceGame(h, { players: 3, hostless: true })
  tutorialEvent(h, game, 's0', 'tutorial:vote', { playerId: 'p0' })
  h.api.hostAction(game, 'kickPlayer', { playerId: 'p2' })
  assert.ok(inTutorial(game), '1 of 2 isn’t a majority')
  tutorialEvent(h, game, 's1', 'tutorial:vote', { playerId: 'p1' })
  assert.ok(!inTutorial(game))
  const h2 = harness(), other = practiceGame(h2, { players: 3, hostless: true })
  tutorialEvent(h2, other, 's0', 'tutorial:vote', { playerId: 'p0' })
  other.players.get('p1').socketId = null
  h2.api.hostAction(other, 'kickPlayer', { playerId: 'p2' })
  assert.ok(!inTutorial(other), 'with the others gone, 1 of 1 carries it')
  h.api.hostAction(game, 'endGame', {})
  h.api.hostAction(game, 'replay', {})
  h.api.hostAction(game, 'start', {})
  assert.ok(!inTutorial(game), 'play again goes straight to the real clues')
  assert.equal(game.round.choices[0].category, 'RULERS')
})
