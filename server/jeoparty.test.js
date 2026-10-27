import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

// Jeoparty's rules live in server/index.js with the socket server, so these tests run the real server on a spare
// port and play it from socket clients, the way phones and the host screen do. A hostless Daily Double waits the
// real 10 seconds before its buzzer opens, so the slow tests run side by side.
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
const scoreOf = (state, playerId) => state.players.find((player) => player.id === playerId).score

// A started game with two players, Ana and Ben. `clues` is one category; on the first board one clue is always a
// Daily Double. Returns the host socket, each player's socket by id, and whose turn it is.
async function setup({ hostless = true, clues = [{ question: 'Capital of France?', answer: 'Paris', value: 2000 }], final = null } = {}) {
  const host = await connect()
  const created = await ask(host, 'host:create', { boards: [[{ name: 'Test', questions: clues }]], hostless, final })
  const code = created.code, players = {}
  for (const name of ['Ana', 'Ben']) {
    const socket = await connect(), joined = await ask(socket, 'player:join', { code, name })
    players[joined.playerId] = socket
  }
  host.emit('host:action', { code, action: 'start' })
  const state = await until(host, (s) => s.status === 'playing' && s.turnPlayerId)
  const turn = state.turnPlayerId, other = Object.keys(players).find((id) => id !== turn)
  return { host, code, players, turn, other, me: players[turn] }
}
// The Daily Double is picked (by the player whose turn it is, or by the host in a hosted game) and they lock in a wager.
async function dailyDouble(game, wager) {
  const { code, turn, me, host } = game
  const state = await until(me, (s) => s.board), index = state.board[0].questions.findIndex((q) => q.dailyDouble)
  if (state.hostless) me.emit('player:select', { code, playerId: turn, categoryIndex: 0, questionIndex: index })
  else host.emit('host:action', { code, action: 'select', payload: { categoryIndex: 0, questionIndex: index } })
  await until(me, (s) => s.activeQuestion?.dailyPlayerId === turn)
  me.emit('player:dailyWager', { code, playerId: turn, wager })
  return until(me, (s) => s.activeQuestion?.dailyReady)
}
// Hostless: wait for the Daily Double buzzer, buzz in, and send one response.
async function answerDailyDouble(game, response) {
  const { code, turn, me } = game
  await until(me, (s) => s.buzzerOpen, 14000)
  me.emit('player:buzz', { code, playerId: turn })
  await until(me, (s) => s.answeringPlayerId === turn)
  me.emit('player:answer', { code, playerId: turn, response })
}
// Everything a phone could send about a clue, 50 times over.
function spam(game, response) {
  const { code, turn, me } = game
  for (let i = 0; i < 50; i++) {
    me.emit('player:answer', { code, playerId: turn, response })
    me.emit('player:buzz', { code, playerId: turn })
    me.emit('player:dailyWager', { code, playerId: turn, wager: 2000 })
  }
}

describe('a Daily Double scores once, however often a phone submits', { concurrency: true }, () => {
  test('50 submits after a wrong answer lose the wager once', async () => {
    const game = await setup()
    await dailyDouble(game, 1000)
    await answerDailyDouble(game, 'London')
    spam(game, 'London')
    await sleep(800)
    assert.equal(scoreOf(game.me.state, game.turn), -1000)
    assert.equal(game.me.state.answeringPlayerId, null, 'nobody is answering while the answer is shown')
    // And once the clue is closed, more submits still change nothing.
    await until(game.me, (s) => !s.activeQuestion, 8000)
    spam(game, 'Paris')
    await sleep(500)
    assert.equal(scoreOf(game.me.state, game.turn), -1000)
  })
  test('50 submits after a right answer win the wager once', async () => {
    const game = await setup()
    await dailyDouble(game, 1000)
    await answerDailyDouble(game, 'Paris')
    spam(game, 'Paris')
    await sleep(800)
    assert.equal(scoreOf(game.me.state, game.turn), 1000)
  })
  test('submits from the other player, or sent under the answering player’s id from another phone, are ignored', async () => {
    const game = await setup()
    await dailyDouble(game, 1000)
    const { code, turn, other, players, me } = game
    await until(me, (s) => s.buzzerOpen, 14000)
    me.emit('player:buzz', { code, playerId: turn })
    await until(me, (s) => s.answeringPlayerId === turn)
    for (let i = 0; i < 20; i++) {
      players[other].emit('player:answer', { code, playerId: other, response: 'Paris' })
      players[other].emit('player:answer', { code, playerId: turn, response: 'London' })
    }
    await sleep(500)
    assert.equal(scoreOf(me.state, turn), 0)
    assert.equal(scoreOf(me.state, other), 0)
    assert.equal(me.state.answeringPlayerId, turn, 'still waiting on the real answer')
  })
})

describe('wagers', () => {
  for (const [sent, locked] of [['abc', 5], [-500, 5], [1e9, 2000], [3.7, 5], [1234.9, 1234], [null, 5]]) {
    test(`a wager of ${JSON.stringify(sent)} locks in as $${locked}`, async () => {
      const game = await setup()
      const state = await dailyDouble(game, sent)
      assert.equal(state.activeQuestion.dailyWager, locked)
    })
  }
  test('a wager can’t be changed once it’s locked', async () => {
    const game = await setup()
    await dailyDouble(game, 300)
    game.me.emit('player:dailyWager', { code: game.code, playerId: game.turn, wager: 2000 })
    await sleep(300)
    assert.equal(game.me.state.activeQuestion.dailyWager, 300)
  })
})

describe('the host’s Correct / Incorrect counts once', { concurrency: true }, () => {
  test('a Daily Double judged Incorrect 50 times loses the wager once', async () => {
    const game = await setup({ hostless: false })
    await dailyDouble(game, 800)
    const { host, code, turn, me } = game
    host.emit('host:action', { code, action: 'buzzer', payload: { open: true } })
    await until(me, (s) => s.buzzerOpen)
    me.emit('player:buzz', { code, playerId: turn })
    await until(host, (s) => s.answeringPlayerId === turn)
    for (let i = 0; i < 50; i++) host.emit('host:action', { code, action: 'score', payload: { playerId: turn, amount: -99999 } })
    await sleep(500)
    assert.equal(scoreOf(host.state, turn), -800, 'the locked wager, once, whatever amount the tap sent')
  })
  test('a regular clue judged Correct 50 times scores its value once', async () => {
    const clues = Array.from({ length: 4 }, (_, i) => ({ question: `Q${i}?`, answer: `A${i}`, value: 200 * (i + 1) }))
    const game = await setup({ hostless: false, clues })
    const { host, code, turn, me } = game
    const index = (await until(host, (s) => s.board)).board[0].questions.findIndex((q) => !q.dailyDouble)
    host.emit('host:action', { code, action: 'select', payload: { categoryIndex: 0, questionIndex: index } })
    await until(host, (s) => s.activeQuestion)
    host.emit('host:action', { code, action: 'buzzer', payload: { open: true } })
    await until(me, (s) => s.buzzerOpen)
    me.emit('player:buzz', { code, playerId: turn })
    await until(host, (s) => s.answeringPlayerId === turn)
    for (let i = 0; i < 50; i++) host.emit('host:action', { code, action: 'score', payload: { playerId: turn, amount: 100000 } })
    await sleep(500)
    assert.equal(scoreOf(host.state, turn), clues[index].value)
  })
  test('Final Jeoparty judged 50 times applies the wager once', async () => {
    const final = { category: 'Final', question: 'Largest planet?', answer: 'Jupiter' }
    const game = await setup({ hostless: false, final })
    const { host, code, turn, me } = game
    host.emit('host:action', { code, action: 'adjustScore', payload: { playerId: turn, amount: 3000 } })
    await until(host, (s) => scoreOf(s, turn) === 3000)
    host.emit('host:action', { code, action: 'final' })
    await until(me, (s) => s.status === 'final')
    const reply = await ask(me, 'player:finalSubmit', { code, playerId: turn, wager: 1000, response: 'Jupiter' })
    assert.equal(reply.ok, true)
    const again = await ask(me, 'player:finalSubmit', { code, playerId: turn, wager: 3000, response: 'Saturn' })
    assert.equal(again.ok, false, 'one Final response per player')
    host.emit('host:action', { code, action: 'finalStop' })
    await until(host, (s) => s.finalTimeUp)
    for (let i = 0; i < 50; i++) host.emit('host:action', { code, action: 'score', payload: { playerId: turn, amount: 1 } })
    await sleep(500)
    assert.equal(scoreOf(host.state, turn), 4000)
  })
})

test('a submit to a clue that isn’t open changes nothing', async () => {
  const game = await setup()
  const { code, turn, me } = game
  // No clue picked yet: nothing to answer.
  for (let i = 0; i < 20; i++) { me.emit('player:answer', { code, playerId: turn, response: 'Paris' }); me.emit('player:buzz', { code, playerId: turn }) }
  await sleep(400)
  assert.equal(scoreOf(me.state, turn), 0)
  // Daily Double picked but no wager yet: the buzzer is closed, so answers and buzzes are ignored too.
  const index = (await until(me, (s) => s.board)).board[0].questions.findIndex((q) => q.dailyDouble)
  me.emit('player:select', { code, playerId: turn, categoryIndex: 0, questionIndex: index })
  await until(me, (s) => s.activeQuestion)
  for (let i = 0; i < 20; i++) { me.emit('player:answer', { code, playerId: turn, response: 'Paris' }); me.emit('player:buzz', { code, playerId: turn }) }
  await sleep(400)
  assert.equal(scoreOf(me.state, turn), 0)
  assert.equal(me.state.answeringPlayerId, null)
})
