import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'
import { isRepeatTap, repeatHostTap, TAP_MS } from './taps.js'

describe('a host double tap counts once', () => {
  test('the same ruling twice within the window is a repeat', () => {
    const game = {}
    assert.equal(repeatHostTap(game, 'strike', {}, 1000), false)
    assert.equal(repeatHostTap(game, 'strike', {}, 1150), true)
    assert.equal(repeatHostTap(game, 'strike', undefined, 1300), true, 'no details is the same as empty details')
  })
  test('the same ruling again after the window counts', () => {
    const game = {}
    repeatHostTap(game, 'got', {}, 1000)
    assert.equal(repeatHostTap(game, 'got', {}, 1000 + TAP_MS), false)
  })
  test('a different ruling, or the same one about something else, counts', () => {
    const game = {}
    repeatHostTap(game, 'reveal', { index: 2 }, 1000)
    assert.equal(repeatHostTap(game, 'reveal', { index: 3 }, 1100), false)
    assert.equal(repeatHostTap(game, 'strike', {}, 1200), false)
  })
  test('score adjustments and renames always go through', () => {
    const game = {}
    for (const action of ['adjustScore', 'renamePlayer', 'renameTeam']) {
      repeatHostTap(game, action, { playerId: 'p', amount: 100 }, 1000)
      assert.equal(isRepeatTap(game.lastHostTap, action, { playerId: 'p', amount: 100 }, 1010), false)
    }
  })
})

// End to end on the real server: a hosted Survey Says! face-off, judged from the host controller.
const PORT = 40000 + Math.floor(Math.random() * 20000)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let server
const sockets = []
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url))], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => { if (String(data).includes('listening')) resolve() })
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
})
after(() => { sockets.forEach((socket) => socket.close()); server?.kill() })
const connect = () => new Promise((resolve) => {
  const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true })
  socket.state = null
  socket.on('game:update', (game) => { socket.state = game })
  socket.on('connect', () => resolve(socket))
  sockets.push(socket)
})
const ask = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve))
async function until(socket, check, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (socket.state && check(socket.state)) return socket.state; await sleep(20) }
  throw new Error('timed out waiting for the game')
}
// A hosted Survey Says! game at its first face-off, with Ana (team 1) answering.
async function faceoff() {
  const host = await connect()
  const survey = { id: 't1', question: 'Name a fruit.', answers: [{ text: 'Apple', points: 40 }, { text: 'Banana', points: 30 }, { text: 'Orange', points: 20 }] }
  const { code } = await ask(host, 'host:create', { game: 'survey', surveys: [survey, { ...survey, id: 't2' }, { ...survey, id: 't3' }], hostless: false })
  const ids = []
  for (const name of ['Ana', 'Ben']) ids.push((await ask(await connect(), 'player:join', { code, name })).playerId)
  host.emit('host:action', { code, action: 'start' })
  await until(host, (s) => s.round?.phase === 'faceoff', 6000)
  host.emit('host:action', { code, action: 'buzz', payload: { playerId: ids[0] } })
  await until(host, (s) => s.round.phase === 'faceoffAnswer')
  return { host, code, ids }
}

describe('on the server', { concurrency: true }, () => {
  test('Strike tapped twice in a row counts as one miss', async () => {
    const { host, code, ids } = await faceoff()
    host.emit('host:action', { code, action: 'strike', payload: {} })
    host.emit('host:action', { code, action: 'strike', payload: {} })
    await sleep(400)
    assert.equal(host.state.round.faceoff.misses, 1)
    assert.equal(host.state.round.faceoff.answeringId, ids[1], 'Ben answers next')
  })
  test('two Strikes a second apart are two misses', async () => {
    const { host, code } = await faceoff()
    host.emit('host:action', { code, action: 'strike', payload: {} })
    await sleep(TAP_MS + 300)
    host.emit('host:action', { code, action: 'strike', payload: {} })
    await sleep(300)
    assert.equal(host.state.round.faceoff.misses, 2)
  })
  test('an answer tapped twice is revealed once, not revealed and then struck as a repeat', async () => {
    const { host, code } = await faceoff()
    host.emit('host:action', { code, action: 'reveal', payload: { index: 1 } })
    host.emit('host:action', { code, action: 'reveal', payload: { index: 1 } })
    await sleep(400)
    assert.equal(host.state.round.lastGuess.result, 'hit')
    assert.equal(host.state.round.faceoff.misses, 0)
  })
})
