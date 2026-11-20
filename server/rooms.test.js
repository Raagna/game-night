import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

// Abandoned rooms close on their own: a room with no socket event naming it for ROOM_IDLE_MS is closed with reason
// 'idle', the same way Back to settings closes it with reason 'host'. The server runs with short times here.
const PORT = 40000 + Math.floor(Math.random() * 20000)
const SERVER_URL = `http://localhost:${PORT}`
const IDLE_MS = 800, SWEEP_MS = 100
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let server
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), ROOM_IDLE_MS: String(IDLE_MS), ROOM_SWEEP_MS: String(SWEEP_MS) }, stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => { if (String(data).includes('listening')) resolve() })
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
})
after(() => server?.kill())
const sockets = []
const connect = () => new Promise((resolve) => {
  const socket = io(SERVER_URL, { transports: ['websocket'], forceNew: true })
  socket.closed = null
  socket.on('game:closed', (info) => { socket.closed = info })
  socket.on('connect', () => resolve(socket))
  sockets.push(socket)
})
after(() => sockets.forEach((socket) => socket.close()))
const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve))

const BOARD = { boards: [[{ name: 'Test', questions: [{ question: 'Clue', answer: 'Answer', value: 200 }] }]] }
async function room() {
  const tv = await connect(), created = await ask(tv, 'host:create', BOARD)
  const phone = await connect(), joined = await ask(phone, 'player:join', { code: created.code, name: 'Ana' })
  assert.ok(created.ok && joined.ok)
  return { tv, phone, playerId: joined.playerId, ...created }
}

describe('idle rooms', { concurrency: true }, () => {
  test('a room nobody plays in is closed, and everyone in it is told it was for being idle', async () => {
    const { tv, phone, code, hostToken } = await room()
    await sleep(IDLE_MS + 4 * SWEEP_MS)
    assert.deepEqual(tv.closed, { code, reason: 'idle' })
    assert.deepEqual(phone.closed, { code, reason: 'idle' })
    const late = await connect()
    const rejoin = await ask(late, 'player:join', { code, name: 'Bo' })
    assert.equal(rejoin.ok, false); assert.equal(rejoin.closed, true); assert.equal(rejoin.reason, 'idle')
    assert.match(rejoin.error, /without play/)
    const host = await ask(late, 'host:join', { code, hostToken })
    assert.equal(host.ok, false); assert.equal(host.reason, 'idle')
  })

  test('any event naming the room keeps it open, from a phone or a host screen', async () => {
    const { tv, phone, code, playerId, hostToken } = await room()
    const end = Date.now() + IDLE_MS * 2
    for (let i = 0; Date.now() < end; i++) {
      if (i % 2) phone.emit('player:skip', { code, playerId }); else await ask(tv, 'host:join', { code, display: true, hostToken })
      await sleep(IDLE_MS / 4)
    }
    assert.equal(tv.closed, null)
    assert.equal((await ask(tv, 'host:join', { code, display: true, hostToken })).ok, true)
  })

  test('Back to settings still closes the room with reason "host"', async () => {
    const { tv, phone, code } = await room()
    assert.equal((await ask(tv, 'host:close', { code })).ok, true)
    await sleep(100)
    assert.deepEqual(phone.closed, { code, reason: 'host' })
    const again = await ask(await connect(), 'player:join', { code, name: 'Bo' })
    assert.equal(again.reason, 'host'); assert.match(again.error, /host closed/)
  })
})

describe('codes, player IDs and /lan', { concurrency: true }, () => {
  test('room codes are six characters with no 0, O, 1 or I', async () => {
    const tv = await connect()
    for (let i = 0; i < 40; i++) {
      const { code } = await ask(tv, 'host:create', BOARD)
      assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/)
      await ask(tv, 'host:close', { code })
    }
  })
  test('player IDs are random UUIDs, and a phone rejoins with its own', async () => {
    const { code, playerId } = await room()
    assert.match(playerId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const again = await ask(await connect(), 'player:join', { code, returningPlayerId: playerId })
    assert.equal(again.ok, true); assert.equal(again.playerId, playerId)
  })
  test('/lan answers on a home server', async () => {
    const reply = await (await fetch(`${SERVER_URL}/lan`)).json()
    assert.ok(Array.isArray(reply.addresses))
  })
})

test('/lan is off on the hosted server (RENDER set)', async () => {
  const port = PORT + 1
  const hosted = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], { env: { ...process.env, PORT: String(port), RENDER: 'true' }, stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    await new Promise((resolve, reject) => {
      hosted.stdout.on('data', (data) => { if (String(data).includes('listening')) resolve() })
      hosted.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
    })
    const response = await fetch(`http://localhost:${port}/lan`)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { addresses: [] })
  } finally { hosted.kill() }
})
