import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createPriceGames, POINTS, SHOWCASE_BOTH, PRICE_TIMES, PRICE_PRACTICE_TIMES, PRICE_TUTORIAL_STEPS, formatPrice } from './price.js'
import { registerTutorial, publicTutorial, inTutorial } from './tutorial.js'

// A game server without sockets or real timers: scheduled clocks run when a test calls fire().
function harness(randoms = []) {
  const games = new Map(), timers = {}, sockets = new Map(), rooms = new Map(), secrets = []
  const io = { sockets: { sockets, adapter: { rooms } } }
  let queue = [...randoms]
  const api = createPriceGames({
    io, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
    random: () => (queue.length ? queue.shift() : 0.5),
  })
  return {
    api, games, timers, secrets,
    fire: (name = 'price') => { const timer = timers[name]; assert.ok(timer, `no ${name} clock running`); delete timers[name]; timer.fn() },
    act: (game, playerId, payload) => {
      const handlers = new Map(), player = game.players.get(playerId)
      api.register({ id: player.socketId, on: (event, fn) => handlers.set(event, fn) })
      let reply
      handlers.get('price:answer')({ code: game.code, playerId, ...payload }, (result) => { reply = result })
      return reply
    },
    controller: (game) => {
      const socket = { id: 'ctrl', data: { controllerGame: game.code }, emit: (event, data) => secrets.push({ event, data }) }
      sockets.set(socket.id, socket); rooms.set(game.code, new Set([socket.id]))
    },
  }
}
const item = (id, dollars, extra = {}) => ({ id, name: `Product ${id}`, brand: 'Brand', size: '12 oz', cents: Math.round(dollars * 100), image: 'https://images.openfoodfacts.org/images/products/1.jpg', ...extra })
const SHOWCASES = [[item('s1', 1000), item('s2', 500)], [item('t1', 2000), item('t2', 300)]]
function newGame(h, segments, { players = 3, start = true, showcases = SHOWCASES, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { segments, showcases, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) game.players.set(`p${i}`, { id: `p${i}`, name: `Player ${i}`, score: 0, socketId: `s${i}` })
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
const score = (game, id) => game.players.get(id).score

test('a game needs a round, and two players to start', () => {
  const h = harness()
  assert.throws(() => h.api.makeGame('X', { segments: [] }))
  assert.throws(() => h.api.makeGame('X', { segments: [{ type: 'bid', item: { name: 'Free thing', cents: 0 } }] }))
  const game = newGame(h, [{ type: 'bid', item: item('a', 4.99) }], { players: 1 })
  assert.equal(game.status, 'lobby')
})

test('closest bid without going over wins, an exact bid earns the bonus, and prices stay hidden until the reveal', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 4.99) }])
  assert.equal(h.api.publicGame(game).round.item.cents, undefined)
  h.act(game, 'p0', { cents: 450 })
  h.act(game, 'p1', { cents: 499 })
  assert.equal(game.round.phase, 'answer')
  h.act(game, 'p2', { cents: 600 })
  assert.equal(game.round.phase, 'reveal')
  assert.deepEqual(game.round.results.winners, ['p1'])
  assert.equal(score(game, 'p1'), POINTS.bid + POINTS.exact)
  assert.equal(score(game, 'p0'), 0)
  assert.equal(h.api.publicGame(game).round.item.cents, 499)
})

test('when everyone goes over, everyone bids again under the lowest bid', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 3) }], { players: 2 })
  h.act(game, 'p0', { cents: 500 }); h.act(game, 'p1', { cents: 400 })
  assert.equal(game.round.phase, 'answer')
  assert.equal(game.round.below, 400)
  assert.equal(h.act(game, 'p0', { cents: 450 }).ok, false)
  h.act(game, 'p0', { cents: 350 }); h.act(game, 'p1', { cents: 380 })
  assert.equal(game.round.rebids, 2)
  assert.equal(game.round.below, 350)
  h.act(game, 'p0', { cents: 299 }); h.act(game, 'p1', { cents: 200 })
  assert.deepEqual(game.round.results.winners, ['p0'])
})

test('the bids that all went over stay on show while everyone bids again', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 3) }], { players: 2 })
  h.act(game, 'p0', { cents: 500 }); h.act(game, 'p1', { cents: 400 })
  assert.deepEqual(h.api.publicGame(game).round.overBids, { p0: 500, p1: 400 })
  assert.equal(h.api.publicGame(game).round.bids, null, 'the new bids stay secret')
})

test('answer clocks leave time to play on a phone, Higher or Lower most of all', () => {
  for (const key of ['bidMs', 'priciestMs', 'orderMs', 'groceryMs', 'showcaseMs']) assert.ok(PRICE_TIMES[key] >= 20000, key)
  assert.ok(PRICE_TIMES.higherLowerMs >= 60000, 'five calls need at least a minute')
  assert.ok(PRICE_TIMES.revealMs >= 12000, 'time to read who got what')
  const h = harness(), items = [1, 2, 3, 4, 5].map((n) => item(`h${n}`, n))
  const game = newGame(h, [{ type: 'higherLower', items }], { players: 2, hostless: true })
  assert.equal(h.timers.price.ms, PRICE_TIMES.higherLowerMs)
  const left = game.round.deadline - Date.now()
  assert.ok(left > PRICE_TIMES.higherLowerMs - 1000 && left <= PRICE_TIMES.higherLowerMs)
  h.act(game, 'p0', { calls: Array(5).fill('higher') }); h.act(game, 'p1', { calls: Array(5).fill('lower') })
  assert.equal(h.timers.price.ms, PRICE_TIMES.revealMs)
})

test('a game is set in the US or Canada, and prices show in that country’s dollars', () => {
  const h = harness()
  assert.equal(newGame(h, [{ type: 'bid', item: item('a', 3) }], { start: false }).country, 'US', 'the US by default')
  assert.equal(newGame(h, [{ type: 'bid', item: item('a', 3) }], { start: false, country: 'XX' }).country, 'US')
  const game = newGame(h, [{ type: 'bid', item: item('a', 3) }], { players: 2, country: 'CA' })
  assert.equal(h.api.publicGame(game).country, 'CA')
  h.act(game, 'p0', { cents: 500 }); h.act(game, 'p1', { cents: 400 })
  assert.match(h.act(game, 'p0', { cents: 450 }).error, /CA\$4\.00/)
  h.api.hostAction(game, 'endGame', {})
  h.api.hostAction(game, 'replay', { segments: [{ type: 'bid', item: item('b', 2) }], showcases: SHOWCASES, country: 'US' })
  assert.equal(game.country, 'CA', 'a replay stays in the same country')
  assert.equal(game.segments[0].item.id, 'b')
})

test('prices are formatted in the game’s dollars', () => {
  assert.equal(formatPrice(499), 'US$4.99')
  assert.equal(formatPrice(499, 'CA'), 'CA$4.99')
  assert.equal(formatPrice(129900, 'CA'), 'CA$1,299')
  assert.equal(formatPrice(null), '')
})

test('higher or lower scores each right call, plus a bonus for all five', () => {
  // random(): direction then size for each of the five wrong prices — up, down, up, down, up.
  const h = harness([0.1, 0, 0.9, 0, 0.1, 0, 0.9, 0, 0.1, 0])
  const items = [1, 2, 3, 4, 5].map((n) => item(`h${n}`, n))
  const game = newGame(h, [{ type: 'higherLower', items }], { players: 2 })
  const round = h.api.publicGame(game).round
  assert.equal(round.items[0].shownCents, 109)
  assert.equal(round.items[1].shownCents, 169)
  const truth = ['lower', 'higher', 'lower', 'higher', 'lower']
  assert.equal(h.act(game, 'p0', { calls: ['higher'] }).ok, false, 'every call is needed')
  h.act(game, 'p0', { calls: truth })
  h.act(game, 'p1', { calls: ['higher', 'higher', 'higher', 'higher', 'higher'] })
  assert.equal(score(game, 'p0'), 5 * POINTS.higherLower + POINTS.higherLowerSweep)
  assert.equal(score(game, 'p1'), 2 * POINTS.higherLower)
})

test('pick the priciest runs its sets one after another', () => {
  const h = harness()
  const sets = [[item('a', 1), item('b', 9), item('c', 3)], [item('d', 5), item('e', 2), item('f', 4)]]
  const game = newGame(h, [{ type: 'priciest', sets }], { players: 2, hostless: true })
  h.act(game, 'p0', { pick: 'b' }); h.act(game, 'p1', { pick: 'a' })
  assert.equal(game.round.phase, 'reveal')
  assert.equal(h.timers.price.ms, PRICE_TIMES.priciestRevealMs)
  h.fire()
  assert.equal(game.round.set, 1)
  assert.equal(game.round.phase, 'answer')
  assert.equal(h.api.publicGame(game).round.items[0].cents, undefined)
  h.act(game, 'p0', { pick: 'd' }); h.act(game, 'p1', { pick: 'd' })
  assert.equal(score(game, 'p0'), 2 * POINTS.priciest)
  assert.equal(score(game, 'p1'), POINTS.priciest)
})

test('price order scores each product in its place, plus a bonus for a perfect order', () => {
  const h = harness(), items = [item('w', 4), item('x', 1), item('y', 3), item('z', 2)]
  const game = newGame(h, [{ type: 'order', items }], { players: 2 })
  h.act(game, 'p0', { order: ['x', 'z', 'y', 'w'] })
  h.act(game, 'p1', { order: ['x', 'y', 'z', 'w'] })
  assert.equal(score(game, 'p0'), 4 * POINTS.order + POINTS.orderSweep)
  assert.equal(score(game, 'p1'), 2 * POINTS.order)
})

test('the grocery run goes to the cart closest to the budget without going over', () => {
  const h = harness(), items = [item('a', 4.5), item('b', 6), item('c', 9.25), item('d', 2)]
  const game = newGame(h, [{ type: 'grocery', items, budget: 1500 }])
  h.act(game, 'p0', { cart: ['a', 'c'] }) // 13.75
  h.act(game, 'p1', { cart: ['b', 'c'] }) // 15.25: over
  h.act(game, 'p2', { cart: ['a', 'b', 'd'] }) // 12.50
  assert.deepEqual(game.round.results.winners, ['p0'])
  assert.equal(score(game, 'p0'), POINTS.grocery)
})

test('the showcase goes to the top two; everyone else predicts the winner', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 5) }], { hostless: true })
  h.act(game, 'p0', { cents: 100 }); h.act(game, 'p1', { cents: 499 }); h.act(game, 'p2', { cents: 300 })
  h.fire() // past the reveal
  assert.equal(game.round.type, 'showcase')
  const [first, second] = game.round.contestants, [watcher] = ['p0', 'p1', 'p2'].filter((id) => !game.round.contestants.includes(id))
  assert.equal(first, 'p1', 'the leader is first')
  assert.equal(h.act(game, watcher, { cents: 1000 }).ok, false, 'non-contestants predict rather than bid')
  h.act(game, watcher, { winner: first })
  h.act(game, first, { cents: 150000 - SHOWCASE_BOTH + 1 }) // within the margin of its $1,500 showcase
  h.act(game, second, { cents: 160000 }) // $2,300 showcase: $700 under
  assert.deepEqual(game.round.results.winners, [first])
  assert.equal(game.round.results.both, true)
  assert.equal(score(game, first), POINTS.bid + POINTS.showcase + POINTS.showcaseBoth)
  assert.equal(score(game, watcher), POINTS.prediction)
  h.fire()
  assert.equal(game.status, 'complete')
})

test('hosted reveals wait for the host, who sees the real prices', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 5) }, { type: 'bid', item: item('b', 7) }], { players: 2, showcases: null })
  h.controller(game)
  h.api.hostAction(game, 'next', {}) // ends bidding early
  assert.equal(game.round.phase, 'reveal')
  assert.equal(h.timers.price, undefined)
  h.api.hostAction(game, 'next', {})
  assert.equal(game.index, 1)
  assert.equal(h.secrets.at(-1).data.prices.b, 700)
  h.api.hostAction(game, 'next', {}); h.api.hostAction(game, 'next', {})
  assert.equal(game.status, 'complete', 'no showcase pack: the game ends after the last round')
})

test('a player who leaves isn’t waited for', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 5) }])
  h.act(game, 'p0', { cents: 100 }); h.act(game, 'p1', { cents: 200 })
  game.players.get('p2').socketId = null
  h.api.playerLeft(game, 'p2')
  assert.equal(game.round.phase, 'reveal')
})

test('only Open Food Facts photos are kept', () => {
  const h = harness(), game = newGame(h, [{ type: 'bid', item: item('a', 5, { image: 'https://evil.example/x.jpg' }) }], { start: false })
  assert.equal(game.segments[0].item.image, '')
})

// ---------- Practice round (the tutorial) ----------
describe('the practice round', () => {
  const PRACTICE = { bid: item('pb', 3.49), higherLower: item('ph', 5.99) }
  const SEGMENTS = [{ type: 'bid', item: item('a', 4.99) }, { type: 'bid', item: item('b', 2.5) }]
  const practiceGame = (h, config = {}) => newGame(h, SEGMENTS, { tutorial: true, practice: PRACTICE, ...config })
  // The skip events as server/index.js wires them, on fake sockets.
  const skipEvents = (h, socket) => {
    const handlers = new Map()
    registerTutorial({ data: {}, ...socket, on: (event, fn) => handlers.set(event, fn) }, { games: h.games, emitGame: () => {}, end: h.api.endTutorial })
    return handlers
  }
  // The step the screens see (publicGame reads it off the practice state).
  const step = (h, game) => { h.api.publicGame(game); return publicTutorial(game)?.step }

  test('starts from the lobby when the setup asks for it, on the practice products, not round one’s', () => {
    const h = harness(), game = practiceGame(h)
    assert.equal(inTutorial(game), true)
    assert.equal(game.status, 'playing')
    assert.equal(game.round.type, 'bid')
    assert.equal(game.round.item.id, 'pb')
    assert.equal(h.timers.price.ms, PRICE_PRACTICE_TIMES.bidMs)
    assert.ok(PRICE_PRACTICE_TIMES.bidMs < PRICE_TIMES.bidMs)
    assert.deepEqual(publicTutorial(game).steps, PRICE_TUTORIAL_STEPS)
    assert.equal(step(h, game), 'bid')
    assert.equal(h.api.publicGame(game).round.item.cents, undefined, 'the price stays hidden in practice too')
  })
  test('no practice without the option, without practice products, or on a replay', () => {
    const h = harness()
    assert.equal(inTutorial(newGame(h, SEGMENTS)), false)
    assert.equal(inTutorial(newGame(h, SEGMENTS, { tutorial: true })), false, 'no practice products sent')
    const game = practiceGame(h)
    h.api.endTutorial(game)
    h.api.hostAction(game, 'endGame', {})
    h.api.hostAction(game, 'replay', {})
    h.api.hostAction(game, 'start', {})
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.item.id, 'a')
  })
  test('walks through a bid, its reveal, one higher-or-lower call and its breakdown, and nothing scores', () => {
    const h = harness([0.1, 0.1]), game = practiceGame(h, { hostless: true })
    h.act(game, 'p0', { cents: 300 }); h.act(game, 'p1', { cents: 349 }); h.act(game, 'p2', { cents: 900 })
    assert.equal(step(h, game), 'bidReveal')
    assert.deepEqual(game.round.results.winners, ['p1'], 'the reveal still shows who was closest')
    assert.equal(h.api.publicGame(game).round.bids.p1, 349)
    assert.equal(h.timers.price.ms, PRICE_PRACTICE_TIMES.revealMs)
    h.fire()
    assert.equal(step(h, game), 'call')
    assert.equal(game.round.type, 'higherLower')
    assert.equal(game.round.items.length, 1, 'one call, not five')
    assert.equal(h.act(game, 'p0', { calls: [] }).ok, false)
    // The tag is above the real price (a random draw under 0.5 goes up), so the real price is lower.
    assert.ok(game.round.shownCents[0] > PRACTICE.higherLower.cents)
    h.act(game, 'p0', { calls: ['lower'] }); h.act(game, 'p1', { calls: ['higher'] }); h.act(game, 'p2', { calls: ['lower'] })
    assert.equal(step(h, game), 'callReveal')
    assert.deepEqual(game.round.results.truth, ['lower'])
    assert.deepEqual(h.api.publicGame(game).round.results.calls.p1, ['higher'])
    for (const id of ['p0', 'p1', 'p2']) assert.equal(score(game, id), 0)
    assert.deepEqual(game.round.awards, {})
    h.fire()
    assert.equal(step(h, game), 'done')
    assert.equal(h.api.publicGame(game).practice.done, true)
    assert.equal(h.timers.price.ms, PRICE_PRACTICE_TIMES.endMs, 'without a host, round one starts by itself')
    h.fire()
    assert.equal(inTutorial(game), false)
    assert.equal(game.practice, null)
    assert.equal(h.api.publicGame(game).practice, null)
    assert.equal(game.index, 0)
    assert.equal(game.round.item.id, 'a', 'round one is the first real round')
    assert.equal(h.timers.price.ms, PRICE_TIMES.bidMs, 'real clocks again')
  })
  test('everyone over in practice bids again, as in the real game', () => {
    const h = harness(), game = practiceGame(h)
    h.act(game, 'p0', { cents: 500 }); h.act(game, 'p1', { cents: 400 }); h.act(game, 'p2', { cents: 600 })
    assert.equal(step(h, game), 'bid')
    assert.equal(game.round.below, 400)
  })
  test('with a host, the host moves the reveals along and starts round one', () => {
    const h = harness(), game = practiceGame(h)
    h.api.hostAction(game, 'next', {})
    assert.equal(step(h, game), 'bidReveal')
    assert.equal(h.timers.price, undefined, 'hosted reveals wait for the host')
    h.api.hostAction(game, 'next', {}); h.api.hostAction(game, 'next', {})
    assert.equal(step(h, game), 'callReveal')
    h.api.hostAction(game, 'next', {})
    assert.equal(step(h, game), 'done')
    assert.equal(game.round.deadline, null)
    h.api.hostAction(game, 'next', {})
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.item.id, 'a')
  })
  test('scores go back to 0 for round one, and the practice can’t end the game', () => {
    const h = harness(), game = practiceGame(h)
    h.api.hostAction(game, 'adjustScore', { playerId: 'p0', amount: 300 })
    h.api.hostAction(game, 'endGame', {})
    assert.equal(game.status, 'playing')
    h.api.hostAction(game, 'skip', {})
    assert.equal(inTutorial(game), false, 'skipping a round skips the practice')
    assert.equal(score(game, 'p0'), 0)
    assert.equal(game.round.item.id, 'a')
  })
  test('with a host, only the TV or the host controller can skip it, straight into round one', () => {
    const h = harness(), game = practiceGame(h)
    game.hostSocketId = 'tv'
    h.act(game, 'p0', { cents: 100 })
    skipEvents(h, { id: 's0' }).get('tutorial:skip')({ code: game.code })
    assert.equal(inTutorial(game), true, 'a phone can’t skip a hosted practice')
    skipEvents(h, { id: 's0' }).get('tutorial:vote')({ code: game.code, playerId: 'p0' })
    assert.equal(inTutorial(game), true, 'and there’s no vote with a host')
    skipEvents(h, { id: 'ctrl', data: { controllerGame: game.code } }).get('tutorial:skip')({ code: game.code })
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.item.id, 'a')
    assert.equal(game.round.phase, 'answer')
    assert.deepEqual(game.round.answers, {}, 'the practice bid doesn’t carry over')
    h.api.endTutorial(game)
    assert.equal(game.round.item.id, 'a', 'a second end does nothing')
  })
  test('without a host, a strict majority of connected players skips it', () => {
    const h = harness(), game = practiceGame(h, { hostless: true, players: 4 })
    const vote = (id, socketId = game.players.get(id).socketId) => skipEvents(h, { id: socketId }).get('tutorial:vote')({ code: game.code, playerId: id })
    skipEvents(h, { id: 'tv' }).get('tutorial:skip')({ code: game.code })
    assert.equal(inTutorial(game), true, 'no host skip in a hostless game')
    vote('p0'); vote('p1', 's3')
    assert.deepEqual(publicTutorial(game).votes, ['p0'], 'a vote from someone else’s phone doesn’t count')
    vote('p1')
    assert.equal(inTutorial(game), true, '2 of 4 isn’t a majority')
    vote('p1')
    assert.deepEqual(publicTutorial(game).votes, ['p0'], 'a second tap takes it back')
    vote('p1'); vote('p2')
    assert.equal(inTutorial(game), false, '3 of 4 skips')
    assert.equal(game.round.item.id, 'a')
    for (const id of ['p0', 'p1', 'p2', 'p3']) assert.equal(score(game, id), 0)
  })
  test('without a host, a kick can carry the vote', () => {
    const h = harness(), game = practiceGame(h, { hostless: true, players: 3 })
    skipEvents(h, { id: 's0' }).get('tutorial:vote')({ code: game.code, playerId: 'p0' })
    assert.equal(inTutorial(game), true, '1 of 3')
    h.api.hostAction(game, 'kickPlayer', { playerId: 'p2' })
    assert.equal(inTutorial(game), true, '1 of 2 still isn’t a majority')
    h.api.hostAction(game, 'kickPlayer', { playerId: 'p1' })
    assert.equal(inTutorial(game), false, '1 of 1')
  })
})
