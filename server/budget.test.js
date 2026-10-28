import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'
import { createBudgetGames, standings, BUDGET_TIMES, COUNT_LIMIT } from './budget.js'

// A game server without sockets or real timers: scheduled clocks run when a test calls fire(), and the clock only
// moves when a test moves it.
function harness() {
  const games = new Map(), timers = {}, clock = { now: 1_000_000 }
  const api = createBudgetGames({
    io: { sockets: { sockets: new Map() } }, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
    now: () => clock.now,
  })
  const handlersFor = (socket) => { const handlers = new Map(); api.register({ ...socket, on: (event, fn) => handlers.set(event, fn) }); return handlers }
  const h = {
    api, games, timers, clock,
    fire: () => { const timer = timers.budget; assert.ok(timer, 'no clock running'); delete timers.budget; timer.fn() },
    tick: (ms = 1000) => { clock.now += ms },
    // A phone event on that player's own connection (or, with socketId, someone else's).
    phone: (game, playerId, action, payload = {}, socketId = game.players.get(playerId).socketId) =>
      handlersFor({ id: socketId, data: {} }).get('budget:act')({ code: game.code, playerId, action, payload }),
    card: (game, playerId) => { let reply; handlersFor({ id: game.players.get(playerId).socketId, data: {} }).get('budget:card')({ code: game.code, playerId }, (r) => { reply = r }); return reply },
    controllerCard: (game) => { let reply; handlersFor({ id: 'ctrl', data: { controllerGame: game.code } }).get('budget:card')({ code: game.code }, (r) => { reply = r }); return reply },
    host: (game, action, payload = {}) => api.hostAction(game, action, payload),
    tag: (game) => api.rulingTurn(game),
  }
  return h
}
const WORDS = ['Banana', 'Mango', 'Kiwi', 'Lemon', 'Cherry', 'Tennis', 'Golf', 'Hockey', 'Boxing', 'Rugby', 'Rain', 'Snow', 'Hail', 'Fog', 'Wind', 'Piano', 'Drum', 'Harp', 'Flute', 'Tuba']
// Players join in order p0..p(n-1) and fill the teams evenly: p0, p2, ... on Team 1 and p1, p3, ... on Team 2.
function newGame(h, { players = 4, start = true, words = WORDS, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { words, hostless: true, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) {
    const player = { id: `p${i}`, name: `Player ${i}`, score: 0, socketId: `s${i}` }
    game.players.set(player.id, player); h.api.playerJoined(game, player)
  }
  if (start) h.host(game, 'start')
  return game
}
const [T1, T2] = ['t1', 't2']
// Look at the card, then bid: the given bids in turn (team ids), and let the shot clock run out.
function toPlay(h, game, bids = []) {
  h.fire() // the look ends; bidding opens
  for (const [teamId, amount] of bids) h.phone(game, game.turn.givers[teamId], 'bid', { amount })
  if (game.turn.phase === 'bid') h.fire()
  assert.equal(game.turn.phase, 'play')
}
const giverOf = (game, teamId) => game.turn.givers[teamId]

describe('setting up', () => {
  test('a game needs two cards of words, and repeats are dropped', () => {
    const h = harness()
    assert.throws(() => h.api.makeGame('X', { words: WORDS.slice(0, 9) }))
    assert.throws(() => h.api.makeGame('X', { words: [...WORDS.slice(0, 9), 'banana'] }), 'only nine different words')
    assert.equal(h.api.makeGame('X', { words: WORDS }).config.cardsToWin, 10, 'first to 10 cards by default')
    assert.equal(h.api.makeGame('X', { words: WORDS, cardsToWin: 6 }).config.cardsToWin, 10, 'only 5, 7 or 10')
  })
  test('players fill the two teams evenly, and the game needs two on each', () => {
    const h = harness(), game = newGame(h, { players: 3, start: false })
    assert.deepEqual(game.teams.map((t) => t.members), [['p0', 'p2'], ['p1']])
    h.host(game, 'start')
    assert.equal(game.status, 'lobby', 'Team 2 has one player')
    h.api.hostAction(game, 'movePlayer', { playerId: 'p2', teamId: T2 })
    h.host(game, 'start')
    assert.equal(game.status, 'lobby', 'now Team 1 has one')
    const p3 = { id: 'p3', name: 'Player 3', score: 0, socketId: 's3' }
    game.players.set('p3', p3); h.api.playerJoined(game, p3)
    h.host(game, 'start')
    assert.equal(game.status, 'playing')
  })
  test('a player can switch teams from their phone in the lobby, but not once the game is on', () => {
    const h = harness(), game = newGame(h, { start: false })
    let handlers; h.api.register({ id: 's0', data: {}, on: (event, fn) => { if (event === 'budget:team') handlers = fn } })
    handlers({ code: game.code, playerId: 'p0', teamId: T2 })
    assert.deepEqual(game.teams.map((t) => t.members), [['p2'], ['p1', 'p3', 'p0']])
    h.host(game, 'movePlayer', { playerId: 'p0', teamId: T1 }); h.host(game, 'start')
    handlers({ code: game.code, playerId: 'p0', teamId: T2 })
    assert.ok(game.teams[0].members.includes('p0'))
  })
})

describe('bidding', () => {
  test('both clue-givers look at the card first, then the bidding opens on a shot clock', () => {
    const h = harness(), game = newGame(h)
    assert.equal(game.turn.phase, 'peek')
    assert.deepEqual(game.turn.givers, { t1: 'p0', t2: 'p1' })
    assert.equal(h.timers.budget.ms, BUDGET_TIMES.peekMs)
    h.phone(game, 'p1', 'bid', { amount: 20 })
    assert.equal(game.turn.bid, null, 'no bids while they look')
    h.fire()
    assert.equal(game.turn.phase, 'bid')
    assert.equal(h.timers.budget.ms, BUDGET_TIMES.bidMs)
  })
  test('each bid must be lower, from 25 down to 1, and not against your own team', () => {
    const h = harness(), game = newGame(h)
    h.fire()
    h.phone(game, 'p1', 'bid', { amount: 26 })
    assert.equal(game.turn.bid, null, 'over 25')
    h.phone(game, 'p1', 'bid', { amount: 0 })
    assert.equal(game.turn.bid, null, 'under 1')
    h.phone(game, 'p1', 'bid', { amount: 25 })
    assert.deepEqual(game.turn.bid, { teamId: T2, amount: 25 })
    h.phone(game, 'p1', 'bid', { amount: 20 })
    assert.equal(game.turn.bid.amount, 25, 'the leading team can’t undercut itself')
    h.phone(game, 'p0', 'bid', { amount: 25 })
    assert.equal(game.turn.bid.teamId, T2, 'a bid has to be lower')
    h.phone(game, 'p0', 'bid', { amount: 18 })
    h.phone(game, 'p1', 'bid', { amount: 15 })
    assert.deepEqual(game.turn.bid, { teamId: T2, amount: 15 })
    h.phone(game, 'p2', 'bid', { amount: 10 })
    assert.equal(game.turn.bid.amount, 15, 'only the clue-givers bid')
  })
  test('every bid restarts the shot clock; when it runs out, the lowest bid plays for that many words', () => {
    const h = harness(), game = newGame(h)
    h.fire()
    h.phone(game, 'p0', 'bid', { amount: 22 })
    delete h.timers.budget
    h.phone(game, 'p1', 'bid', { amount: 19 })
    assert.equal(h.timers.budget?.ms, BUDGET_TIMES.bidMs, 'a new shot clock')
    h.fire()
    assert.equal(game.turn.phase, 'play')
    assert.equal(game.turn.control, T2)
    assert.equal(game.turn.budget, 19)
    assert.equal(game.turn.clueGiverId, 'p1')
    assert.equal(game.turn.judgeId, 'p0', 'the other clue-giver judges')
    assert.equal(h.timers.budget.ms, BUDGET_TIMES.playMs)
  })
  test('a bid of 1 ends the bidding at once', () => {
    const h = harness(), game = newGame(h)
    h.fire()
    h.phone(game, 'p1', 'bid', { amount: 1 })
    assert.equal(game.turn.phase, 'play')
    assert.equal(game.turn.budget, 1)
  })
  test('with no bids, the starting team plays at 25, and the starting team alternates card to card', () => {
    const h = harness(), game = newGame(h)
    assert.equal(game.turn.starterId, T1)
    toPlay(h, game)
    assert.equal(game.turn.control, T1)
    assert.equal(game.turn.budget, 25)
    h.phone(game, game.turn.judgeId, 'nono')
    h.fire() // the result screen ends
    assert.equal(game.turn.number, 2)
    assert.equal(game.turn.starterId, T2)
    toPlay(h, game)
    assert.equal(game.turn.control, T2)
  })
  test('clue-givers move along their team each card', () => {
    const h = harness(), game = newGame(h)
    assert.deepEqual(game.turn.givers, { t1: 'p0', t2: 'p1' })
    toPlay(h, game); h.phone(game, game.turn.judgeId, 'nono'); h.fire()
    assert.deepEqual(game.turn.givers, { t1: 'p2', t2: 'p3' })
    toPlay(h, game); h.phone(game, game.turn.judgeId, 'nono'); h.fire()
    assert.deepEqual(game.turn.givers, { t1: 'p0', t2: 'p1' })
  })
  test('both clue-givers passing draws a new card; one alone doesn’t', () => {
    const h = harness(), game = newGame(h)
    const first = h.card(game, 'p0').words
    h.phone(game, 'p0', 'pass')
    assert.deepEqual(game.turn.passes, [T1])
    assert.equal(game.turn.phase, 'peek')
    h.fire()
    h.phone(game, 'p1', 'pass')
    assert.equal(game.turn.phase, 'peek', 'a fresh look at the new card')
    assert.deepEqual(game.turn.passes, [])
    assert.notDeepEqual(h.card(game, 'p0').words, first)
    assert.deepEqual(game.turn.givers, { t1: 'p0', t2: 'p1' })
    assert.equal(game.turn.starterId, T1)
    assert.equal(game.turn.number, 1, 'still the first card of the game')
  })
  test('bidding takes back your own pass', () => {
    const h = harness(), game = newGame(h)
    h.fire()
    h.phone(game, 'p0', 'pass')
    h.phone(game, 'p0', 'bid', { amount: 20 })
    assert.deepEqual(game.turn.passes, [])
    h.phone(game, 'p1', 'pass')
    assert.equal(game.turn.phase, 'bid', 'only one team wants a new card')
  })
})

describe('playing a card', () => {
  test('the judge counts words and can undo; the exact budget is fine, one past it hands over a steal', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game, [[T2, 3]])
    for (let i = 0; i < 3; i++) { h.tick(200); h.phone(game, 'p0', 'countWord') }
    assert.equal(game.turn.used, 3)
    h.phone(game, 'p0', 'uncount')
    assert.equal(game.turn.used, 2)
    h.tick(200); h.phone(game, 'p0', 'countWord')
    assert.equal(game.turn.phase, 'play', 'exactly on budget')
    h.tick(200); h.phone(game, 'p0', 'countWord')
    assert.equal(game.turn.phase, 'steal')
    assert.equal(game.turn.stealTeamId, T1)
    assert.equal(h.timers.budget.ms, BUDGET_TIMES.stealMs)
  })
  test('+1 is never treated as a double tap, but taps beyond a sane rate are dropped', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game)
    h.phone(game, 'p1', 'countWord'); h.phone(game, 'p1', 'countWord')
    assert.equal(game.turn.used, 2, 'two quick taps are two words')
    for (let i = 0; i < 20; i++) h.phone(game, 'p1', 'countWord')
    assert.equal(game.turn.used, COUNT_LIMIT.taps, 'no more than the limit in one second')
    h.tick(COUNT_LIMIT.perMs)
    h.phone(game, 'p1', 'countWord')
    assert.equal(game.turn.used, COUNT_LIMIT.taps + 1)
  })
  test('clearing all five wins the card and banks the words left in the budget', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game, [[T1, 19]])
    for (let i = 0; i < 14; i++) { h.tick(150); h.phone(game, 'p1', 'countWord') }
    for (let i = 0; i < 5; i++) h.phone(game, 'p0', 'mark', { index: i })
    assert.equal(game.turn.phase, 'done')
    assert.deepEqual(game.turn.result, { winnerId: T1, reason: 'cleared', bonus: 5, failReason: null })
    assert.equal(game.teams[0].cards, 1)
    assert.equal(game.teams[0].bonus, 5)
    assert.equal(h.api.publicGame(game).turn.slots.every(Boolean), true, 'the whole card shows once it’s over')
  })
  test('the judge can dispute a marked word', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game)
    h.phone(game, 'p0', 'mark', { index: 2 })
    assert.equal(game.turn.words[2].status, 'got')
    h.phone(game, 'p1', 'unmark', { index: 2 })
    assert.equal(game.turn.words[2].status, 'waiting')
  })
  test('a no-no forfeits the card to the judge’s team, with no steal', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game, [[T1, 12]])
    h.phone(game, 'p0', 'mark', { index: 0 })
    h.phone(game, 'p1', 'nono')
    assert.equal(game.turn.phase, 'done')
    assert.deepEqual(game.turn.result, { winnerId: T2, reason: 'nono', bonus: 0, failReason: null })
    assert.equal(game.teams[1].cards, 1)
  })
  test('running out of time hands over a steal', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game)
    h.fire()
    assert.equal(game.turn.phase, 'steal')
    assert.equal(game.turn.failReason, 'time')
  })
})

describe('the steal', () => {
  function toSteal(h, game) {
    toPlay(h, game, [[T1, 2]])
    h.phone(game, 'p0', 'mark', { index: 0 }); h.phone(game, 'p0', 'mark', { index: 1 })
    for (let i = 0; i < 3; i++) { h.tick(200); h.phone(game, 'p1', 'countWord') }
    assert.equal(game.turn.phase, 'steal')
  }
  test('saying every word left steals the card', () => {
    const h = harness(), game = newGame(h)
    toSteal(h, game)
    for (const i of [2, 3, 4]) h.phone(game, 'p0', 'mark', { index: i })
    assert.deepEqual(game.turn.result, { winnerId: T2, reason: 'stolen', bonus: 0, failReason: 'budget' })
    assert.equal(game.teams[1].cards, 1)
    assert.deepEqual(game.turn.words.map((w) => w.status), ['got', 'got', 'stolen', 'stolen', 'stolen'])
  })
  test('missing any of them voids the card: nobody gets it', () => {
    const h = harness(), game = newGame(h)
    toSteal(h, game)
    h.phone(game, 'p0', 'mark', { index: 2 })
    h.fire()
    assert.deepEqual(game.turn.result, { winnerId: null, reason: 'stealMissed', bonus: 0, failReason: 'budget' })
    assert.deepEqual(game.teams.map((t) => t.cards), [0, 0])
    assert.deepEqual(game.turn.words.map((w) => w.status), ['got', 'got', 'stolen', 'missed', 'missed'])
  })
  test('without a host the losing clue-giver confirms steal words; nobody else can', () => {
    const h = harness(), game = newGame(h)
    toSteal(h, game)
    h.phone(game, 'p1', 'mark', { index: 2 })
    h.phone(game, 'p3', 'mark', { index: 2 })
    assert.equal(game.turn.words[2].status, 'waiting', 'not the judge, not the stealing team')
    h.phone(game, 'p0', 'mark', { index: 2 })
    assert.equal(game.turn.words[2].status, 'stolen')
  })
  test('with a host, only the host confirms steal words', () => {
    const h = harness(), game = newGame(h, { hostless: false })
    toSteal(h, game)
    h.phone(game, 'p0', 'mark', { index: 2 })
    assert.equal(game.turn.words[2].status, 'waiting')
    h.host(game, 'mark', { index: 2 })
    assert.equal(game.turn.words[2].status, 'stolen')
  })
})

describe('winning', () => {
  function winCard(h, game, teamId) {
    toPlay(h, game, [[teamId, 10]])
    for (let i = 0; i < 6; i++) { h.tick(150); h.phone(game, game.turn.judgeId, 'countWord') }
    for (let i = 0; i < 5; i++) h.phone(game, game.turn.clueGiverId, 'mark', { index: i })
    assert.equal(game.turn.result.winnerId, teamId)
    h.fire()
  }
  test('the first team to the target number of cards wins', () => {
    const h = harness(), game = newGame(h, { cardsToWin: 5 })
    for (let i = 0; i < 4; i++) winCard(h, game, T2)
    assert.equal(game.status, 'playing')
    winCard(h, game, T2)
    assert.equal(game.status, 'complete')
    assert.equal(game.teams[1].cards, 5)
    assert.equal(game.teams[1].bonus, 20)
  })
  test('in points mode a card is 10 and a saved word 1', () => {
    const h = harness(), game = newGame(h, { cardsToWin: 5, scoring: 'points' })
    assert.equal(h.api.publicGame(game).target, 50)
    for (let i = 0; i < 4; i++) winCard(h, game, T1)
    assert.equal(h.api.publicGame(game).teams[0].points, 56)
    assert.equal(game.status, 'complete', '4 cards and 16 saved words passes 50')
  })
  test('standings break a tie on cards with saved words', () => {
    const teams = [{ id: 'a', cards: 3, bonus: 2, points: 32 }, { id: 'b', cards: 3, bonus: 7, points: 37 }, { id: 'c', cards: 4, bonus: 0, points: 40 }]
    assert.deepEqual(standings(teams, 'cards').map((t) => t.id), ['c', 'b', 'a'])
    assert.deepEqual(standings([teams[0], teams[1]], 'cards').map((t) => t.id), ['b', 'a'])
    assert.deepEqual(standings(teams, 'points').map((t) => t.id), ['c', 'b', 'a'])
  })
  test('the host can give a finished card to the other team, or to nobody', () => {
    const h = harness(), game = newGame(h, { hostless: false })
    toPlay(h, game, [[T1, 10]])
    for (let i = 0; i < 5; i++) h.phone(game, 'p0', 'mark', { index: i })
    assert.deepEqual([game.teams[0].cards, game.teams[0].bonus], [1, 10])
    h.host(game, 'award', { teamId: T2 })
    assert.deepEqual(game.teams.map((t) => [t.cards, t.bonus]), [[0, 0], [1, 0]])
    h.host(game, 'award', { teamId: null })
    assert.deepEqual(game.teams.map((t) => t.cards), [0, 0])
    assert.equal(h.timers.budget, undefined, 'with a host, the result stays up until Next')
  })
})

describe('who can see and do what', () => {
  test('the card goes to both clue-givers while bidding, then the clue-giver, the judge and the host', () => {
    const h = harness(), game = newGame(h, { hostless: false })
    assert.equal(h.card(game, 'p0').ok, true)
    assert.equal(h.card(game, 'p1').ok, true)
    assert.equal(h.card(game, 'p2').ok, false, 'a guesser never sees it')
    assert.equal(h.controllerCard(game).words.length, 5)
    const pub = JSON.stringify(h.api.publicGame(game))
    for (const word of h.card(game, 'p0').words) assert.ok(!pub.includes(word), `${word} isn’t in the public state`)
    toPlay(h, game)
    assert.equal(h.card(game, 'p0').ok, true)
    assert.equal(h.card(game, 'p1').ok, true)
    assert.equal(h.card(game, 'p3').ok, false)
    h.phone(game, 'p0', 'mark', { index: 1 })
    assert.deepEqual(h.api.publicGame(game).turn.slots, [null, game.turn.words[1].text, null, null, null], 'a guessed word shows on the TV')
  })
  test('only the judge counts or calls a no-no, and only the clue-giver marks', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game) // Team 1 plays: p0 clues, p1 judges
    for (const id of ['p0', 'p2', 'p3']) { h.phone(game, id, 'countWord'); h.phone(game, id, 'nono') }
    assert.equal(game.turn.used, 0)
    assert.equal(game.turn.phase, 'play')
    for (const id of ['p1', 'p2', 'p3']) h.phone(game, id, 'mark', { index: 0 })
    assert.equal(game.turn.words[0].status, 'waiting')
  })
  test('a phone can only act for its own player', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game)
    h.phone(game, 'p1', 'countWord', {}, 's3')
    assert.equal(game.turn.used, 0)
    game.players.get('p1').socketId = null
    h.phone(game, 'p1', 'countWord', {}, null)
    assert.equal(game.turn.used, 0, 'nor for a player who’s dropped out')
  })
  test('a tap tagged for an earlier card or phase is ignored', () => {
    const h = harness(), game = newGame(h)
    h.fire()
    const bidding = h.tag(game)
    h.phone(game, 'p1', 'bid', { amount: 9, turn: bidding })
    h.fire()
    const playing = h.tag(game)
    h.phone(game, 'p1', 'bid', { amount: 5, turn: bidding })
    assert.equal(game.turn.budget, 9)
    h.phone(game, 'p0', 'countWord', { turn: playing }) // Team 2 plays, so Team 1's clue-giver judges
    assert.equal(game.turn.used, 1)
    h.phone(game, 'p0', 'nono', { turn: playing })
    assert.equal(game.teams[0].cards, 1)
    h.fire()
    toPlay(h, game) // card 2: Team 2 starts and plays, and p2 judges
    h.phone(game, 'p2', 'nono', { turn: playing })
    assert.equal(game.turn.phase, 'play', 'a no-no tagged for the last card doesn’t land on this one')
    h.phone(game, 'p2', 'nono', { turn: h.tag(game) })
    assert.equal(game.teams[0].cards, 2)
  })
  test('a double tap on a phone counts once', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game)
    h.phone(game, 'p1', 'countWord'); h.phone(game, 'p1', 'countWord'); h.phone(game, 'p1', 'countWord')
    h.phone(game, 'p1', 'uncount'); h.phone(game, 'p1', 'uncount')
    assert.equal(game.turn.used, 2, 'one undo')
  })
  test('a clue-giver who leaves hands the job to a teammate', () => {
    const h = harness(), game = newGame(h)
    toPlay(h, game)
    game.players.get('p1').socketId = null
    h.api.playerLeft(game, 'p1')
    assert.equal(game.turn.judgeId, 'p3')
    h.phone(game, 'p3', 'countWord')
    assert.equal(game.turn.used, 1)
  })
})

// End to end on the real server: the host controller's taps go through server/index.js, with its double-tap rule
// and the published ruling tag.
describe('on the real server', () => {
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
  async function until(socket, check, ms = 15000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (socket.state && check(socket.state)) return socket.state; await sleep(20) }
    throw new Error('timed out waiting for the game')
  }

  test('the host’s +1 always counts, a stale one doesn’t, and the TV never gets the card', async () => {
    const tv = await connect()
    const made = await ask(tv, 'host:create', { game: 'budget', words: WORDS })
    assert.ok(made.ok, made.error)
    const phones = []
    for (const name of ['Ana', 'Ben', 'Cy', 'Di']) {
      const phone = await connect()
      phones.push({ phone, joined: await ask(phone, 'player:join', { code: made.code, name }) })
    }
    tv.emit('host:action', { code: made.code, action: 'start', payload: {} })
    let game = await until(tv, (g) => g.turn?.phase === 'peek')
    const [ana, ben] = phones
    const card = await ask(ana.phone, 'budget:card', { code: made.code, playerId: ana.joined.playerId })
    assert.equal(card.words.length, 5)
    game = await until(tv, (g) => g.turn?.phase === 'bid')
    ben.phone.emit('budget:act', { code: made.code, playerId: ben.joined.playerId, action: 'bid', payload: { amount: 1, turn: game.rulingTurn } })
    game = await until(tv, (g) => g.turn?.phase === 'play')
    assert.equal(game.turn.budget, 1)
    const tag = game.rulingTurn
    tv.emit('host:action', { code: made.code, action: 'countWord', payload: { turn: tag } })
    tv.emit('host:action', { code: made.code, action: 'countWord', payload: { turn: tag } })
    game = await until(tv, (g) => g.turn.phase === 'steal')
    assert.equal(game.turn.used, 2, 'two taps from the host are two words, even back to back')
    tv.emit('host:action', { code: made.code, action: 'countWord', payload: { turn: tag } })
    tv.emit('host:action', { code: made.code, action: 'uncount', payload: { turn: tag } })
    await sleep(150)
    assert.equal(tv.state.turn.used, 2, 'taps tagged for the play phase don’t land in the steal')
    const everything = JSON.stringify(tv.state)
    for (const word of card.words.filter((_, i) => !tv.state.turn.slots[i])) assert.ok(!everything.includes(word), `${word} stayed off the TV`)
  })
})
