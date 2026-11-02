import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

// Only the host's screens can run a game: host:create hands the TV a host key, and host:join (the way the TV
// reconnects and the controller opens) refuses a screen without it. End to end on the real server.
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
  socket.state = null; socket.events = []
  socket.on('game:update', (game) => { socket.state = game })
  socket.onAny((event, data) => socket.events.push([event, data]))
  socket.on('connect', () => resolve(socket))
  sockets.push(socket)
})
after(() => sockets.forEach((socket) => socket.close()))
const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve))
const settle = () => sleep(250)
async function until(socket, check, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (socket.state && check(socket.state)) return socket.state; await sleep(20) }
  throw new Error('timed out waiting for the game')
}

const BOARD = { boards: [[{ name: 'Test', questions: [{ question: 'Clue', answer: 'Secret answer', value: 200 }] }]] }
async function hostedGame(config = BOARD) {
  const tv = await connect(), created = await ask(tv, 'host:create', config)
  const phone = await connect(), joined = await ask(phone, 'player:join', { code: created.code, name: 'Ana' })
  return { tv, phone, playerId: joined.playerId, ...created }
}

describe('the host key', { concurrency: true }, () => {
  test('host:create gives the TV a long random key, and it never goes out in the game state', async () => {
    const one = await hostedGame(), two = await hostedGame()
    assert.match(one.hostToken, /^[\w-]{24}$/)
    assert.notEqual(one.hostToken, two.hostToken)
    one.tv.emit('host:action', { code: one.code, action: 'start' })
    await settle()
    for (const [, data] of [...one.phone.events, ...one.tv.events]) assert.ok(!JSON.stringify(data ?? null).includes(one.hostToken), 'no event carries the key')
  })

  test('a phone with only the room code can’t become the controller or the TV', async () => {
    const { code, phone, playerId, tv, hostToken } = await hostedGame()
    const intruder = await connect()
    for (const attempt of [{ code }, { code, display: true }, { code, hostToken: 'guess' }, { code, hostToken: hostToken.slice(0, -1) }, { code, hostToken: { length: 24 } }]) {
      const reply = await ask(intruder, 'host:join', attempt)
      assert.equal(reply.ok, false); assert.equal(reply.denied, true); assert.equal(reply.game, undefined, 'and no game state')
    }
    // Refused, so its host actions do nothing: no score change, no start, no closing the room.
    intruder.emit('host:action', { code, action: 'adjustScore', payload: { playerId, amount: 5000 } })
    intruder.emit('host:action', { code, action: 'start' })
    assert.equal((await ask(intruder, 'host:close', { code })).ok, false)
    await settle()
    assert.equal(tv.state?.status ?? 'lobby', 'lobby')
    assert.deepEqual(tv.state.players.map((player) => player.score), [0])
    // The player phone trying the same thing is refused too.
    assert.equal((await ask(phone, 'host:join', { code })).denied, true)
    // And the real host still runs the game.
    tv.emit('host:action', { code, action: 'adjustScore', payload: { playerId, amount: 300 } })
    await until(tv, (s) => s.players[0].score === 300)
  })

  test('with the key, the controller opens, can act, and the TV can reconnect', async () => {
    const { code, tv, playerId, hostToken } = await hostedGame()
    const controller = await connect()
    const reply = await ask(controller, 'host:join', { code: code.toLowerCase(), hostToken })
    assert.equal(reply.ok, true); assert.equal(reply.game.code, code)
    controller.emit('host:action', { code, action: 'adjustScore', payload: { playerId, amount: 400 } })
    await until(tv, (s) => s.players[0].score === 400)
    // A reloaded TV tab is a new socket: it gets back in with the same key.
    tv.close()
    const newTv = await connect()
    assert.equal((await ask(newTv, 'host:join', { code, display: true, hostToken })).ok, true)
    assert.equal((await ask(newTv, 'host:close', { code })).ok, true)
  })

  test('Jeoparty’s replay keeps the key', async () => {
    const { code, tv, hostToken } = await hostedGame()
    tv.emit('host:action', { code, action: 'replay' })
    await settle()
    const controller = await connect()
    assert.equal((await ask(controller, 'host:join', { code, hostToken })).ok, true)
  })

  test('every game needs the key, not just Jeoparty', async () => {
    const { code, hostToken } = await hostedGame({ game: 'wheel', hostless: false, puzzles: [{ category: 'Phrase', text: 'Hello world' }] })
    const intruder = await connect()
    assert.equal((await ask(intruder, 'host:join', { code })).denied, true)
    // Nothing secret reaches it either (the controller gets the puzzle's solution).
    await settle()
    assert.ok(!intruder.events.some(([event]) => event === 'wheel:solution'))
    assert.equal((await ask(intruder, 'host:join', { code, hostToken })).ok, true)
  })

  test('an unknown code still says the game wasn’t found', async () => {
    const reply = await ask(await connect(), 'host:join', { code: 'NOPE00', hostToken: 'x' })
    assert.deepEqual(reply, { ok: false, closed: false, error: 'Game not found' })
  })
})
