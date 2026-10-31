import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'
import { beginTutorial, endTutorial, inTutorial, publicTutorial, setTutorialStep, skipCarried, toggleSkipVote, votesNeeded } from './tutorial.js'

// A game as the helper sees it: players by id, connected while they have a socket.
const room = (hostless, ...ids) => ({ hostless, players: new Map(ids.map((id) => [id, { id, socketId: `s-${id}` }])) })

describe('the tutorial helper', () => {
  test('starts on the first step and only moves to declared steps', () => {
    const game = room(true, 'a')
    beginTutorial(game, ['pick', 'buzz', 'done'])
    assert.equal(inTutorial(game), true)
    assert.equal(publicTutorial(game).step, 'pick')
    assert.equal(setTutorialStep(game, 'buzz'), true)
    assert.equal(setTutorialStep(game, 'nonsense'), false)
    assert.equal(publicTutorial(game).step, 'buzz')
    assert.throws(() => beginTutorial(room(true), []))
  })
  test('ends once, and says so', () => {
    const game = room(true, 'a')
    beginTutorial(game, ['pick'])
    assert.equal(endTutorial(game), true)
    assert.equal(endTutorial(game), false)
    assert.equal(publicTutorial(game), null)
  })
  test('a strict majority of connected players is needed', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(votesNeeded), [1, 2, 2, 3, 3, 4])
  })
  test('hostless votes skip at a strict majority, and a second tap takes a vote back', () => {
    const game = room(true, 'a', 'b', 'c', 'd', 'e')
    beginTutorial(game, ['pick'])
    assert.equal(toggleSkipVote(game, 'a'), false)
    assert.equal(toggleSkipVote(game, 'b'), false)
    assert.deepEqual(publicTutorial(game), { step: 'pick', steps: ['pick'], votes: ['a', 'b'], connected: 5, needed: 3 })
    assert.equal(toggleSkipVote(game, 'b'), false, 'b takes it back')
    assert.deepEqual(publicTutorial(game).votes, ['a'])
    toggleSkipVote(game, 'b')
    assert.equal(toggleSkipVote(game, 'c'), true, '3 of 5 skips')
  })
  test('only connected players count, and a player dropping out can carry the vote', () => {
    const game = room(true, 'a', 'b', 'c', 'd')
    beginTutorial(game, ['pick'])
    toggleSkipVote(game, 'a'); toggleSkipVote(game, 'b')
    assert.equal(skipCarried(game), false, '2 of 4 is not a majority')
    game.players.get('a').socketId = null
    assert.deepEqual(publicTutorial(game).votes, ['b'], 'an away player’s vote doesn’t count')
    assert.equal(skipCarried(game), false, '1 of 3')
    game.players.get('a').socketId = 's-a'
    assert.deepEqual(publicTutorial(game).votes, ['a', 'b'], 'a’s vote comes back with a')
    game.players.get('c').socketId = null
    assert.equal(skipCarried(game), true, '2 of 3 once c drops out')
  })
  test('hosted games have no votes; unknown players can’t vote', () => {
    const hosted = room(false, 'a')
    beginTutorial(hosted, ['pick'])
    assert.equal(toggleSkipVote(hosted, 'a'), false)
    assert.deepEqual(publicTutorial(hosted).votes, [])
    const hostless = room(true, 'a')
    beginTutorial(hostless, ['pick'])
    assert.equal(toggleSkipVote(hostless, 'stranger'), false)
    assert.equal(toggleSkipVote(room(true, 'a'), 'a'), false, 'no tutorial, no vote')
  })
})

// End to end on the real server: Jeoparty's practice round, played from socket clients as phones and the TV would.
const PORT = 40000 + Math.floor(Math.random() * 20000)
const SERVER_URL = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let server
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => { if (String(data).includes('listening')) resolve() })
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
})
after(() => server?.kill())
const sockets = []
const connect = () => new Promise((resolve) => {
  const socket = io(SERVER_URL, { transports: ['websocket'], forceNew: true })
  socket.state = null
  socket.on('game:update', (game) => { socket.state = game })
  socket.on('connect', () => resolve(socket))
  sockets.push(socket)
})
after(() => sockets.forEach((socket) => socket.close()))
const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve))
async function until(socket, check, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (socket.state && check(socket.state)) return socket.state; await sleep(20) }
  throw new Error('timed out waiting for the game')
}
// Nothing should happen: give the server a moment, then look.
const settle = () => sleep(250)

// A started Jeoparty game with the practice round on. Returns the TV (host) socket and each player's socket by id.
async function practice({ hostless, names = ['Ana', 'Ben'] }) {
  const host = await connect()
  const created = await ask(host, 'host:create', { boards: [[{ name: 'Real', questions: [{ question: 'Real clue', answer: 'Real', value: 200 }, { question: 'Second', answer: 'Two', value: 400 }] }]], hostless, tutorial: true })
  const code = created.code, players = {}
  for (const name of names) { const socket = await connect(), joined = await ask(socket, 'player:join', { code, name }); players[joined.playerId] = socket }
  host.emit('host:action', { code, action: 'start' })
  const state = await until(host, (s) => s.status === 'playing' && s.tutorial)
  return { host, code, players, ids: Object.keys(players), state }
}

describe('Jeoparty’s practice round', { concurrency: true }, () => {
  test('without the option, a game starts straight into round one', async () => {
    const host = await connect()
    const { code } = await ask(host, 'host:create', { boards: [[{ name: 'Real', questions: [{ question: 'Q', answer: 'A', value: 200 }] }]] })
    const ana = await connect(); await ask(ana, 'player:join', { code, name: 'Ana' })
    host.emit('host:action', { code, action: 'start' })
    const state = await until(host, (s) => s.status === 'playing')
    assert.equal(state.tutorial, null)
    assert.equal(state.board[0].name, 'Real')
  })

  test('hosted: the practice board plays, nothing scores, players can’t skip and the host can', async () => {
    const { host, code, players, ids, state } = await practice({ hostless: false })
    assert.equal(state.tutorial.step, 'pick')
    assert.equal(state.board[0].name, 'Practice round')
    // Players get no skip in a hosted game, whichever event they try.
    for (const id of ids) { players[id].emit('tutorial:vote', { code, playerId: id }); players[id].emit('tutorial:skip', { code }) }
    await settle()
    assert.ok(host.state.tutorial, 'still in the practice round')
    assert.deepEqual(host.state.tutorial.votes, [])

    host.emit('host:action', { code, action: 'select', payload: { categoryIndex: 0, questionIndex: 0 } })
    await until(host, (s) => s.tutorial.step === 'read')
    host.emit('host:action', { code, action: 'buzzer', payload: { open: true } })
    await until(host, (s) => s.tutorial.step === 'buzz')
    players[ids[0]].emit('player:buzz', { code, playerId: ids[0] })
    await until(host, (s) => s.tutorial.step === 'answer' && s.answeringPlayerId === ids[0])
    host.emit('host:action', { code, action: 'score', payload: { playerId: ids[0], amount: 200 } })
    const revealed = await until(host, (s) => s.tutorial.step === 'reveal')
    assert.ok(revealed.players.every((player) => player.score === 0), 'a right answer in practice scores nothing')
    assert.equal(revealed.turnPlayerId, ids[0], 'but it still wins the next pick')

    host.emit('tutorial:skip', { code })
    const real = await until(host, (s) => !s.tutorial)
    assert.equal(real.board[0].name, 'Real', 'round one’s board')
    assert.equal(real.activeQuestion, null)
    assert.ok(real.players.every((player) => player.score === 0))
  })

  test('hosted: the host controller can skip too, and a skip after the end does nothing', async () => {
    const { code, host } = await practice({ hostless: false })
    const controller = await connect()
    await ask(controller, 'host:join', { code })
    controller.emit('tutorial:skip', { code })
    await until(host, (s) => !s.tutorial)
    controller.emit('tutorial:skip', { code })
    await settle()
    assert.equal(host.state.board[0].name, 'Real')
  })

  test('hostless: phones vote, the TV shows the count, and a strict majority skips', async () => {
    const { host, code, players, ids } = await practice({ hostless: true, names: ['Ana', 'Ben', 'Cy'] })
    host.emit('tutorial:skip', { code })
    await settle()
    assert.ok(host.state.tutorial, 'the TV can’t skip a hostless game')
    // A vote counts only from the voter's own phone.
    players[ids[1]].emit('tutorial:vote', { code, playerId: ids[0] })
    await settle()
    assert.deepEqual(host.state.tutorial.votes, [])
    players[ids[0]].emit('tutorial:vote', { code, playerId: ids[0] })
    const one = await until(host, (s) => s.tutorial?.votes.length === 1)
    assert.equal(one.tutorial.connected, 3)
    assert.equal(one.tutorial.needed, 2)
    players[ids[0]].emit('tutorial:vote', { code, playerId: ids[0] })
    await until(host, (s) => s.tutorial?.votes.length === 0)
    players[ids[0]].emit('tutorial:vote', { code, playerId: ids[0] })
    players[ids[2]].emit('tutorial:vote', { code, playerId: ids[2] })
    const real = await until(host, (s) => s.status === 'playing' && !s.tutorial)
    assert.equal(real.board[0].name, 'Real')
  })

  test('hostless: a voter’s rival dropping out carries the vote', async () => {
    const { host, code, players, ids } = await practice({ hostless: true })
    players[ids[0]].emit('tutorial:vote', { code, playerId: ids[0] })
    await until(host, (s) => s.tutorial?.votes.length === 1)
    assert.ok(host.state.tutorial, '1 of 2 is not a majority')
    players[ids[1]].disconnect()
    await until(host, (s) => !s.tutorial)
  })

  test('hostless: the practice clue plays for real but scores nothing, and the game starts after the last clue', async () => {
    const { host, code, players, ids, state } = await practice({ hostless: true })
    const turn = state.turnPlayerId, other = ids.find((id) => id !== turn)
    players[turn].emit('player:select', { code, playerId: turn, categoryIndex: 0, questionIndex: 0 })
    await until(host, (s) => s.tutorial.step === 'read')
    await until(host, (s) => s.tutorial.step === 'buzz', 14000)
    players[other].emit('player:buzz', { code, playerId: other })
    await until(host, (s) => s.tutorial.step === 'answer')
    players[other].emit('player:answer', { code, playerId: other, response: 'What is Mars?' })
    const right = await until(host, (s) => s.tutorial.step === 'reveal')
    assert.equal(right.lastEvent.type, 'correct')
    assert.ok(right.players.every((player) => player.score === 0))
    // The Daily Double: the player who got it right picks and wagers.
    await until(host, (s) => s.tutorial.step === 'pick', 8000)
    players[other].emit('player:select', { code, playerId: other, categoryIndex: 0, questionIndex: 1 })
    await until(host, (s) => s.tutorial.step === 'wager')
    players[other].emit('player:dailyWager', { code, playerId: other, wager: 400 })
    await until(host, (s) => s.tutorial.step === 'buzz', 14000)
    players[other].emit('player:buzz', { code, playerId: other })
    await until(host, (s) => s.tutorial.step === 'answer')
    players[other].emit('player:answer', { code, playerId: other, response: 'the Atlantic' })
    const wrong = await until(host, (s) => s.tutorial.step === 'reveal')
    assert.ok(wrong.players.every((player) => player.score === 0), 'a wrong Daily Double loses nothing either')
    await until(host, (s) => s.tutorial?.step === 'done', 8000)
    const real = await until(host, (s) => !s.tutorial, 12000)
    assert.equal(real.board[0].name, 'Real')
  })
})
