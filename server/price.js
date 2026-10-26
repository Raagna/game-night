// Price Check — a price-guessing game in the style of a TV pricing show, played on real shop prices.
//
// A game is a run of segments, then a showcase finale:
// - Closest Bid: everyone bids secretly on one product; closest without going over wins (an exact bid earns a
//   bonus). If everybody goes over, everyone bids again, lower than the lowest bid so far.
// - Higher or Lower: five products, each with a wrong price; say whether the real price is higher or lower.
// - Pick the Priciest: three sets of three products; pick the most expensive in each.
// - Price Order: put four products in order, cheapest first.
// - Grocery Run: fill a cart as close to the budget as you can without going over.
// - Showcase: the top two players each bid on their own bundle of big-ticket items; closest without going over
//   wins, and within SHOWCASE_BOTH of your own price wins both. Everyone else predicts who'll win.
// Everybody plays every segment on their phone at once. Scores are points, so a $3 jar and a $3,000 trip count
// the same.
//
// Hosted and hostless games play the same way on the phones. With a host, the controller sees the real prices
// and moves the reveals along; without one, the reveals move on by themselves.

export const PRICE_TIMES = { bidMs: 25000, higherLowerMs: 40000, priciestMs: 15000, priciestRevealMs: 5000, orderMs: 40000, groceryMs: 50000, showcaseMs: 60000, revealMs: 9000, showcaseRevealMs: 14000 }
export const POINTS = { bid: 500, exact: 500, higherLower: 100, higherLowerSweep: 200, priciest: 200, order: 100, orderSweep: 200, grocery: 400, showcase: 1500, showcaseBoth: 1500, prediction: 300 }
// Within this much of your own showcase's price (without going over) wins both showcases.
export const SHOWCASE_BOTH = 25000
const MAX_REBIDS = 2
const MAX_PLAYERS = 8
const MAX_SEGMENTS = 12
const TYPES = ['bid', 'higherLower', 'priciest', 'order', 'grocery']
const COUNTS = { higherLower: 5, order: 4, grocery: 6 }

const text = (value, max) => String(value ?? '').trim().slice(0, max)
const cents = (value) => Math.max(0, Math.min(1e9, Math.round(Number(value) || 0)))
const IMAGE_HOST = 'https://images.openfoodfacts.org/'
function cleanItem(raw, i) {
  const image = text(raw?.image, 300)
  return {
    id: text(raw?.id, 40) || `i${i}`, name: text(raw?.name, 100), brand: text(raw?.brand, 40), size: text(raw?.size, 30),
    cents: cents(raw?.cents), receipts: Math.max(0, Math.trunc(Number(raw?.receipts) || 0)), month: text(raw?.month, 7),
    image: image.startsWith(IMAGE_HOST) ? image : '',
  }
}
const goodItems = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).map(cleanItem).filter((item) => item.name && item.cents > 0)
function cleanSegment(raw) {
  const type = TYPES.includes(raw?.type) ? raw.type : null
  if (type === 'bid') { const [item] = goodItems([raw.item], 1); return item && { type, item } }
  if (type === 'priciest') {
    const sets = (Array.isArray(raw.sets) ? raw.sets : []).slice(0, 3).map((set) => goodItems(set, 3)).filter((set) => set.length === 3 && new Set(set.map((i) => i.cents)).size === 3)
    return sets.length && { type, sets }
  }
  if (type) {
    const items = goodItems(raw.items, COUNTS[type])
    if (items.length < (type === 'grocery' ? 3 : COUNTS[type])) return null
    if (type === 'order' && new Set(items.map((i) => i.cents)).size !== items.length) return null
    const segment = { type, items }
    if (type === 'grocery') segment.budget = Math.max(100, cents(raw.budget))
    return segment
  }
  return null
}
function cleanConfig(config) {
  const segments = (Array.isArray(config?.segments) ? config.segments : []).slice(0, MAX_SEGMENTS).map(cleanSegment).filter(Boolean)
  if (!segments.length) throw new Error('A game needs at least one round.')
  const showcases = (Array.isArray(config?.showcases) ? config.showcases : []).slice(0, 2).map((bundle) => goodItems(bundle, 4)).filter((bundle) => bundle.length)
  return { segments, showcases: showcases.length === 2 ? showcases : null, hostless: !!config?.hostless }
}
const total = (items) => items.reduce((sum, item) => sum + item.cents, 0)
// Closest without going over: the ids whose value is highest but not above the target (ties share it).
function closestUnder(entries, target) {
  const under = entries.filter(([, value]) => value <= target)
  if (!under.length) return []
  const best = Math.max(...under.map(([, value]) => value))
  return under.filter(([, value]) => value === best).map(([id]) => id)
}

export function createPriceGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave, random = Math.random }) {
  const priceGame = (code) => { const game = games.get(code); return game?.kind === 'price' ? game : undefined }
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const connected = (game) => [...game.players.values()].filter((player) => player.socketId)
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: Date.now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return { kind: 'price', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config, segments: config.segments, showcases: config.showcases, index: 0, round: null, lastEvent: null }
  }
  function playerJoined() {}

  // ---------- What the screens see ----------
  // Real prices stay hidden until the reveal; the host controller gets them separately (sendSecret).
  const shown = (item, reveal) => ({ id: item.id, name: item.name, brand: item.brand, size: item.size, image: item.image, month: item.month, receipts: item.receipts, ...(reveal ? { cents: item.cents } : {}) })
  function publicRound(game) {
    const round = game.round, reveal = round.phase === 'reveal' || game.status === 'complete'
    const base = { type: round.type, phase: round.phase, deadline: round.deadline, answered: Object.keys(round.answers), awards: reveal ? round.awards : null, results: reveal ? round.results : null }
    if (round.type === 'bid') return { ...base, item: shown(round.item, reveal), rebids: round.rebids, below: round.below, bids: reveal ? round.answers : null }
    if (round.type === 'higherLower') return { ...base, items: round.items.map((item, i) => ({ ...shown(item, reveal), shownCents: round.shownCents[i] })) }
    if (round.type === 'priciest') {
      const setRevealed = round.phase === 'reveal'
      return { ...base, set: round.set, setCount: round.sets.length, items: round.sets[round.set].map((item) => shown(item, setRevealed)), answered: Object.keys(round.answers[round.set] || {}), results: setRevealed ? round.results : null, picks: setRevealed ? round.answers[round.set] || {} : null }
    }
    if (round.type === 'order') return { ...base, items: round.items.map((item) => shown(item, reveal)) }
    if (round.type === 'grocery') return { ...base, budget: round.budget, items: round.items.map((item) => shown(item, reveal)) }
    if (round.type === 'showcase') {
      return { ...base, contestants: round.contestants, bundles: round.bundles.map((bundle) => bundle.map((item) => shown(item, reveal))), totals: reveal ? round.bundles.map(total) : null, bids: reveal ? round.bids : null, predictions: reveal ? round.answers : null, bidIn: Object.keys(round.bids) }
    }
    return base
  }
  function publicGame(game) {
    return {
      kind: 'price', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      index: game.index, segmentCount: game.segments.length, hasShowcase: !!game.showcases, segmentTypes: game.segments.map((segment) => segment.type),
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      round: game.round && publicRound(game), serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // The real prices for host controllers only: never the phones or the TV.
  function sendSecret(game, only = null) {
    const round = game.round
    if (game.hostless || !round) return
    const items = round.type === 'bid' ? [round.item] : round.type === 'priciest' ? round.sets[round.set] : round.type === 'showcase' ? round.bundles.flat() : round.items
    const secret = { code: game.code, index: game.index, prices: Object.fromEntries(items.map((item) => [item.id, item.cents])), totals: round.type === 'showcase' ? round.bundles.map(total) : null }
    const sockets = only ? [only] : [...(io.sockets.adapter.rooms.get(game.code) || [])].map((id) => io.sockets.sockets.get(id))
    for (const socket of sockets) if (socket?.data.controllerGame === game.code && socket.id !== game.hostSocketId) socket.emit('price:secret', secret)
  }
  const hostJoined = (game, socket) => sendSecret(game, socket)

  // ---------- Phases and clocks ----------
  const ANSWER_MS = { bid: 'bidMs', higherLower: 'higherLowerMs', priciest: 'priciestMs', order: 'orderMs', grocery: 'groceryMs', showcase: 'showcaseMs' }
  function setPhase(game, phase) {
    const round = game.round
    round.phase = phase
    const ms = phase === 'answer' ? PRICE_TIMES[ANSWER_MS[round.type]]
      : phase === 'reveal' && round.type === 'priciest' && round.set < round.sets.length - 1 ? PRICE_TIMES.priciestRevealMs
      : phase === 'reveal' && game.hostless ? (round.type === 'showcase' ? PRICE_TIMES.showcaseRevealMs : PRICE_TIMES.revealMs) : null
    round.deadline = ms ? Date.now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'price', ms, () => { if (game.round === round && round.phase === phase && game.status === 'playing') { advance(game); emitGame(game) } })
  }
  // The clock ran out, the host tapped Next, or everyone answered.
  function advance(game) {
    const round = game.round
    if (round.phase === 'answer') score(game)
    else if (round.type === 'priciest' && round.set < round.sets.length - 1) { round.set++; setPhase(game, 'answer'); event(game, 'question'); sendSecret(game) }
    else nextSegment(game)
  }
  function startSegment(game) {
    const segment = game.segments[game.index]
    game.round = { type: segment.type, phase: 'answer', deadline: null, answers: {}, awards: null, results: null }
    const round = game.round
    if (segment.type === 'bid') Object.assign(round, { item: segment.item, rebids: 0, below: null })
    if (segment.type === 'higherLower') {
      // Each wrong price is 15–45% off the real one, randomly above or below.
      round.items = segment.items
      // Rounded to end in 9, like a shelf price; never landing on the real price.
      round.shownCents = segment.items.map((item) => {
        const up = random() < 0.5, off = 0.15 + random() * 0.3, raw = item.cents * (up ? 1 + off : 1 - off)
        const shelf = Math.max(9, Math.round(raw / 10) * 10 - 1)
        return shelf === item.cents ? shelf + (up ? 10 : -10) : shelf
      })
    }
    if (segment.type === 'priciest') Object.assign(round, { sets: segment.sets, set: 0, answers: segment.sets.map(() => ({})), points: {} })
    if (segment.type === 'order' || segment.type === 'grocery') round.items = segment.items
    if (segment.type === 'grocery') round.budget = segment.budget
    event(game, 'segment', { round: segment.type })
    setPhase(game, 'answer')
    sendSecret(game)
  }
  function startShowcase(game) {
    const ranked = connected(game).map((player) => [player, random()]).sort((a, b) => b[0].score - a[0].score || a[1] - b[1]).map(([player]) => player)
    if (!game.showcases || ranked.length < 2) return finish(game)
    game.round = { type: 'showcase', phase: 'answer', deadline: null, contestants: [ranked[0].id, ranked[1].id], bundles: game.showcases, bids: {}, answers: {}, awards: null, results: null }
    event(game, 'segment', { round: 'showcase' })
    setPhase(game, 'answer')
    sendSecret(game)
  }
  function nextSegment(game) {
    if (game.round?.type === 'showcase') return finish(game)
    if (game.index < game.segments.length - 1) { game.index++; return startSegment(game) }
    game.index = game.segments.length
    startShowcase(game)
  }
  function finish(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.round) game.round.deadline = null
    event(game, 'complete')
  }

  // Who still has to answer. Everyone answers everything, except in the showcase, where the two contestants bid
  // and everyone else predicts.
  function waitingOn(game) {
    const round = game.round, live = connected(game)
    if (round.type === 'showcase') return live.filter((p) => (round.contestants.includes(p.id) ? round.bids[p.id] == null : round.answers[p.id] == null))
    const answers = round.type === 'priciest' ? round.answers[round.set] : round.answers
    return live.filter((p) => answers[p.id] == null)
  }
  const checkDone = (game) => { if (game.round?.phase === 'answer' && connected(game).length && !waitingOn(game).length) score(game) }

  // ---------- Answers ----------
  function answer(game, playerId, payload) {
    const round = game.round
    if (game.status !== 'playing' || round?.phase !== 'answer') return { ok: false, error: 'Time’s up for this one.' }
    const ids = (list) => (Array.isArray(list) ? list : []).map(String)
    if (round.type === 'bid') {
      const bid = cents(payload.cents)
      if (!(bid > 0)) return { ok: false, error: 'Enter a bid.' }
      if (round.below != null && bid >= round.below) return { ok: false, error: `Everyone went over last time — bid under $${(round.below / 100).toFixed(2)}.` }
      round.answers[playerId] = bid
    } else if (round.type === 'higherLower') {
      const calls = (Array.isArray(payload.calls) ? payload.calls : []).slice(0, round.items.length)
      if (calls.length !== round.items.length || !calls.every((call) => call === 'higher' || call === 'lower')) return { ok: false, error: 'Call every price higher or lower.' }
      round.answers[playerId] = calls
    } else if (round.type === 'priciest') {
      const pick = String(payload.pick)
      if (!round.sets[round.set].some((item) => item.id === pick)) return { ok: false, error: 'Pick one.' }
      round.answers[round.set][playerId] = pick
    } else if (round.type === 'order') {
      const order = ids(payload.order)
      if (order.length !== round.items.length || new Set(order).size !== order.length || !order.every((id) => round.items.some((item) => item.id === id))) return { ok: false, error: 'Put every product in order.' }
      round.answers[playerId] = order
    } else if (round.type === 'grocery') {
      const cart = [...new Set(ids(payload.cart))].filter((id) => round.items.some((item) => item.id === id))
      if (!cart.length) return { ok: false, error: 'Put something in your cart.' }
      round.answers[playerId] = cart
    } else if (round.type === 'showcase') {
      if (round.contestants.includes(playerId)) {
        const bid = cents(payload.cents)
        if (!(bid > 0)) return { ok: false, error: 'Enter a bid.' }
        round.bids[playerId] = bid
      } else {
        if (!round.contestants.includes(String(payload.winner))) return { ok: false, error: 'Pick who’ll win.' }
        round.answers[playerId] = String(payload.winner)
      }
    }
    event(game, 'answered', { playerId })
    checkDone(game)
    return { ok: true }
  }

  // ---------- Scoring ----------
  function award(game, playerId, points, why) {
    const round = game.round, player = game.players.get(playerId)
    if (!player || !points) return
    player.score += points
    const entry = (round.awards[playerId] ||= { points: 0, why: [] })
    entry.points += points
    entry.why.push(why)
  }
  function score(game) {
    const round = game.round
    round.awards ||= {}
    if (round.type === 'bid') {
      const bids = Object.entries(round.answers), price = round.item.cents
      // Everybody over: bid again, lower than the lowest bid so far (a couple of times at most).
      if (bids.length && bids.every(([, bid]) => bid > price) && round.rebids < MAX_REBIDS) {
        round.below = Math.min(...bids.map(([, bid]) => bid))
        round.rebids++
        round.answers = {}
        event(game, 'allOver', { below: round.below })
        setPhase(game, 'answer')
        return
      }
      const winners = closestUnder(bids, price)
      for (const id of winners) { award(game, id, POINTS.bid, 'closest'); if (round.answers[id] === price) award(game, id, POINTS.exact, 'exact') }
      round.results = { winners, exact: winners.some((id) => round.answers[id] === price) }
    } else if (round.type === 'higherLower') {
      const truth = round.items.map((item, i) => (item.cents > round.shownCents[i] ? 'higher' : 'lower'))
      for (const [id, calls] of Object.entries(round.answers)) {
        const right = calls.filter((call, i) => call === truth[i]).length
        award(game, id, right * POINTS.higherLower, `${right} right`)
        if (right === truth.length) award(game, id, POINTS.higherLowerSweep, 'all five')
      }
      round.results = { truth, calls: round.answers }
    } else if (round.type === 'priciest') {
      const set = round.sets[round.set], top = set.reduce((a, b) => (b.cents > a.cents ? b : a))
      const right = Object.entries(round.answers[round.set]).filter(([, pick]) => pick === top.id).map(([id]) => id)
      for (const id of right) award(game, id, POINTS.priciest, 'priciest')
      round.results = { priciest: top.id, right }
    } else if (round.type === 'order') {
      const truth = [...round.items].sort((a, b) => a.cents - b.cents).map((item) => item.id), placed = {}
      for (const [id, order] of Object.entries(round.answers)) {
        const right = order.filter((itemId, i) => itemId === truth[i]).length
        placed[id] = right
        award(game, id, right * POINTS.order, `${right} in place`)
        if (right === truth.length) award(game, id, POINTS.orderSweep, 'perfect order')
      }
      round.results = { truth, placed, orders: round.answers }
    } else if (round.type === 'grocery') {
      const price = Object.fromEntries(round.items.map((item) => [item.id, item.cents]))
      const totals = Object.fromEntries(Object.entries(round.answers).map(([id, cart]) => [id, cart.reduce((sum, itemId) => sum + price[itemId], 0)]))
      const winners = closestUnder(Object.entries(totals), round.budget)
      for (const id of winners) award(game, id, POINTS.grocery, 'closest cart')
      round.results = { totals, winners, carts: round.answers }
    } else if (round.type === 'showcase') {
      const totals = round.bundles.map(total)
      const diffs = round.contestants.map((id, i) => { const bid = round.bids[id]; return bid != null && bid <= totals[i] ? totals[i] - bid : null })
      const best = Math.min(...diffs.filter((d) => d != null))
      const winners = round.contestants.filter((id, i) => diffs[i] != null && diffs[i] === best)
      for (const id of winners) {
        award(game, id, POINTS.showcase, 'showcase')
        if (best <= SHOWCASE_BOTH) award(game, id, POINTS.showcaseBoth, 'won both')
      }
      for (const [id, pick] of Object.entries(round.answers)) if (winners.includes(pick)) award(game, id, POINTS.prediction, 'called it')
      round.results = { winners, diffs, both: winners.length > 0 && best <= SHOWCASE_BOTH }
    }
    event(game, 'reveal', { round: round.type })
    setPhase(game, 'reveal')
    sendSecret(game)
  }

  // ---------- Players coming and going ----------
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    if (game.status === 'playing') checkDone(game)
    emitGame(game)
  }

  function hostAction(game, action, payload) {
    const round = game.round, playing = game.status === 'playing' && round
    if (action === 'start' && game.status === 'lobby' && connected(game).length >= 2) { game.status = 'playing'; game.index = 0; startSegment(game) }
    if (action === 'next' && playing) advance(game)
    if (action === 'skip' && playing) nextSegment(game)
    if (action === 'endGame' && game.status === 'playing') finish(game)
    if (action === 'adjustScore') { const player = game.players.get(payload.playerId), amount = Math.trunc(Number(payload.amount)); if (player && Number.isFinite(amount)) player.score += amount }
    if (action === 'renamePlayer') { const player = game.players.get(payload.playerId), name = text(payload.name, 20); if (player && name) player.name = name }
    if (action === 'kickPlayer') {
      const player = game.players.get(payload.playerId)
      if (player) {
        cancelLeave(game.code, player.id)
        const socket = io.sockets.sockets.get(player.socketId)
        socket?.leave(game.code); socket?.emit('player:kicked')
        game.players.delete(player.id)
        if (game.status === 'playing') checkDone(game)
      }
    }
    if (action === 'replay') {
      let config = game.config
      try { if (payload.segments) config = cleanConfig({ ...payload, hostless: game.hostless }) } catch {}
      clearGameTimers(game)
      Object.assign(game, { status: 'lobby', config, segments: config.segments, showcases: config.showcases, index: 0, round: null, lastEvent: null })
      for (const player of game.players.values()) player.score = 0
    }
    emitGame(game)
  }

  function register(socket) {
    socket.on('price:answer', ({ code, playerId, ...payload } = {}, ack) => {
      const game = priceGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false, error: 'You’re not in this game.' })
      const result = answer(game, playerId, payload)
      ack?.(result)
      if (result.ok) emitGame(game)
    })
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, hostJoined, register }
}
