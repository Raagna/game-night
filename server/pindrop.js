// Pin Drop — a map game. Each round the TV and every phone show a clue for a place somewhere on Earth ("The world's
// tallest waterfall", "The city where the Titanic was built"). Everyone drops a pin on the map on their phone, can
// drag or re-tap it, and locks it in. The reveal flies the TV's map to the real spot and shows every pin with a line
// to it: the closer the pin, the more points (up to MAX_POINTS, falling off smoothly with distance), plus a small
// bonus for the closest pin.
//
// A game is played on one pack (the world, the USA or Canada). The falloff is tuned per pack, so a round inside one
// country doesn't hand everyone nearly full marks. Distances are always worked out in km here; the screens show them
// in km or miles (the game's unit).
//
// The setup deals the clues (dealClues, below, from src/pindrop/places.json) and sends them with the config, as Price
// Check does with its products. The server keeps each clue's answer to itself until the reveal; a host controller
// gets it early (sendSecret), never the TV or the phones.
//
// Hosted and hostless games play the same on the phones. With a host, the host's screens move the game on (reveal,
// next round); without one, it moves on by itself. Players only ever place their own pin.
//
// Practice round (the tutorial; see docs/tutorial.md): before round one, the setup can ask for one easy practice clue
// from the game's pack, played through the real round code with nothing scoring: drop and lock a pin, see the reveal,
// then round one. The coach text is PINDROP_COACH in src/pindrop/PinDrop.jsx.
import { beginTutorial, setTutorialStep, endTutorial as leaveTutorial, inTutorial, skipCarried } from './tutorial.js'

// ---------- Packs, scoring and distances ----------
// perfectKm: a pin this close scores full marks. scaleKm: how fast the points fall off past that (1000 × e^(−d/scale)),
// sized to the pack's map: a 300 km miss is a fine guess on the world map and a poor one inside the USA.
export const PINDROP_PACKS = {
  world: { name: 'World', perfectKm: 25, scaleKm: 1500, view: [[-50, -165], [70, 175]] },
  usa: { name: 'USA', perfectKm: 8, scaleKm: 350, view: [[24.5, -125], [49.5, -66.5]] },
  canada: { name: 'Canada', perfectKm: 8, scaleKm: 450, view: [[42, -141], [70, -52]] },
}
export const PINDROP_ROUNDS = [5, 8, 12]
// Seconds to place a pin. Generous by default: finding a place on a phone map takes a moment.
export const PINDROP_TIMERS = [30, 45, 60, 90]
export const DEFAULT_TIMER = 45
export const PINDROP_DIFFICULTIES = ['easy', 'mixed', 'hard']
export const PLACE_DIFFICULTIES = ['easy', 'medium', 'hard']
export const MAX_POINTS = 1000
export const CLOSEST_BONUS = 100
// Without a host, each reveal stays up this long before the next round.
export const PINDROP_TIMES = { revealMs: 18000 }
// The practice round's clocks: a minute to find the place, time to read the reveal and the coach, then round one.
export const PINDROP_PRACTICE_TIMES = { answerMs: 60000, revealMs: 22000, endMs: 9000 }
export const PINDROP_TUTORIAL_STEPS = ['drop', 'reveal', 'done']
const MAX_PLAYERS = 10
const MAX_CLUES = 15
// Ten push-pin colours. A pin always carries its player's name too, so colour is never the only cue.
export const PIN_COLORS = 10

const packOf = (value) => (Object.hasOwn(PINDROP_PACKS, value) ? value : 'world')
export const defaultUnit = (pack) => (pack === 'usa' ? 'mi' : 'km')
const unitOf = (value, pack) => (value === 'km' || value === 'mi' ? value : defaultUnit(pack))
export const KM_PER_MILE = 1.609344
const EARTH_KM = 6371.0088
const rad = (deg) => (deg * Math.PI) / 180

// Great-circle distance in km between two { lat, lng } points.
export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}
// Points for a pin `km` away on this pack: full marks within perfectKm, then a smooth exponential falloff.
export function roundScore(km, pack = 'world') {
  if (!Number.isFinite(km)) return 0
  const { perfectKm, scaleKm } = PINDROP_PACKS[packOf(pack)]
  return Math.round(MAX_POINTS * Math.exp(-Math.max(0, km - perfectKm) / scaleKm))
}
// "8.4 km", "1,240 mi": one decimal under 10, whole numbers above.
export function formatDistance(km, unit = 'km') {
  if (!Number.isFinite(km)) return ''
  const value = unit === 'mi' ? km / KM_PER_MILE : km
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${shown.toLocaleString('en-US')} ${unit === 'mi' ? 'mi' : 'km'}`
}
// Longitudes wrap: 190° is -170°.
export const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180

// ---------- Dealing a game's clues ----------
// From the pack's places: `rounds` clues for the difficulty, places this browser hasn't played first, plus one easy
// practice clue the game doesn't use. Easy deals easy places (then medium if the pack runs short), hard deals hard
// (then medium), and mixed deals about a third of each, easiest first, so the game warms up.
export function dealClues(places, { pack = 'world', difficulty = 'mixed', rounds = 8 } = {}, random = Math.random, played = new Set()) {
  const inPack = places.filter((place) => place.pack === packOf(pack))
  const shuffled = inPack.map((place) => [random(), place]).sort((a, b) => a[0] - b[0]).map(([, place]) => place)
  const order = shuffled.sort((a, b) => played.has(a.id) - played.has(b.id))
  const taken = new Set()
  const take = (count, levels) => {
    const picks = []
    for (const level of levels) for (const place of order) {
      if (picks.length >= count) break
      if (place.difficulty === level && !taken.has(place.id)) { picks.push(place); taken.add(place.id) }
    }
    return picks
  }
  const n = Math.max(1, Math.min(MAX_CLUES, Math.trunc(rounds) || 8))
  let clues
  if (difficulty === 'easy') clues = take(n, ['easy', 'medium', 'hard'])
  else if (difficulty === 'hard') clues = take(n, ['hard', 'medium', 'easy'])
  else {
    const hard = Math.floor(n / 3), easy = Math.ceil((n - hard) / 2), medium = n - hard - easy
    clues = [...take(easy, ['easy']), ...take(medium, ['medium']), ...take(hard, ['hard'])]
    clues.push(...take(n - clues.length, ['medium', 'easy', 'hard']))
    const rank = (place) => PLACE_DIFFICULTIES.indexOf(place.difficulty)
    clues.sort((a, b) => rank(a) - rank(b))
  }
  const [practice] = take(1, ['easy', 'medium', 'hard'])
  return { clues, practice: practice || null }
}

// ---------- Config from the setup ----------
const text = (value, max) => String(value ?? '').trim().slice(0, max)
function cleanClue(raw, i) {
  const lat = Number(raw?.lat), lng = Number(raw?.lng)
  const clue = {
    id: text(raw?.id, 60) || `c${i}`, clue: text(raw?.clue, 240), answer: text(raw?.answer, 100),
    lat, lng: Number.isFinite(lng) ? wrapLng(lng) : lng, difficulty: PLACE_DIFFICULTIES.includes(raw?.difficulty) ? raw.difficulty : 'medium',
  }
  // The map can't show the poles (it stops near 85°), so neither can a clue.
  const ok = clue.clue && clue.answer && Number.isFinite(lat) && Math.abs(lat) <= 85 && Number.isFinite(lng) && Math.abs(lng) <= 180
  return ok ? clue : null
}
function cleanConfig(config) {
  const clues = (Array.isArray(config?.clues) ? config.clues : []).slice(0, MAX_CLUES).map(cleanClue).filter(Boolean)
  if (!clues.length) throw new Error('A game needs at least one clue.')
  const pack = packOf(config?.pack), timer = Number(config?.timer)
  const practice = config?.practice ? cleanClue(config.practice, 'practice') : null
  return {
    clues, pack, unit: unitOf(config?.unit, pack), difficulty: PINDROP_DIFFICULTIES.includes(config?.difficulty) ? config.difficulty : 'mixed',
    answerMs: (PINDROP_TIMERS.includes(timer) ? timer : DEFAULT_TIMER) * 1000,
    hostless: !!config?.hostless, tutorial: !!config?.tutorial && !!practice, practice,
  }
}

export function createPinDropGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave }) {
  const pinGame = (code) => { const game = games.get(code); return game?.kind === 'pindrop' ? game : undefined }
  const connected = (game) => [...game.players.values()].filter((player) => player.socketId)
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: Date.now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return { kind: 'pindrop', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config, clues: config.clues, index: 0, round: null, history: [], tutorial: null, practice: null, lastEvent: null }
  }
  // Each player gets the lowest pin colour nobody in the room has.
  function playerJoined(game, player) {
    const used = new Set([...game.players.values()].filter((other) => other !== player).map((other) => other.color))
    let color = 0
    while (used.has(color) && color < PIN_COLORS - 1) color++
    player.color = color
  }

  // ---------- What the screens see ----------
  // The answer (its name and where it is) stays off every screen until the reveal, and nobody sees another
  // player's pin before it either: only who has placed one and who has locked in.
  const shownClue = (clue, reveal) => ({ id: clue.id, clue: clue.clue, difficulty: clue.difficulty, ...(reveal ? { answer: clue.answer, lat: clue.lat, lng: clue.lng } : {}) })
  function publicRound(game) {
    const round = game.round, reveal = round.phase === 'reveal'
    const pins = Object.entries(round.pins)
    return {
      phase: round.phase, deadline: round.deadline, clue: shownClue(round.clue, reveal),
      placed: pins.map(([id]) => id), locked: pins.filter(([, pin]) => pin.locked).map(([id]) => id),
      results: reveal ? round.results : null,
    }
  }
  function publicGame(game) {
    if (inTutorial(game)) setTutorialStep(game, practiceStep(game))
    const { pack, unit, difficulty, answerMs } = game.config
    return {
      kind: 'pindrop', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      pack, unit, difficulty, answerMs, index: game.index, roundCount: game.clues.length,
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      round: game.round && publicRound(game), history: game.history,
      practice: game.practice ? { done: game.practice.done } : null, serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // The answer for host controllers only, as soon as a round starts: never the phones or the TV.
  function sendSecret(game, only = null) {
    const round = game.round
    if (game.hostless || !round) return
    const secret = { code: game.code, clueId: round.clue.id, answer: round.clue.answer, lat: round.clue.lat, lng: round.clue.lng }
    const sockets = only ? [only] : [...(io.sockets.adapter.rooms.get(game.code) || [])].map((id) => io.sockets.sockets.get(id))
    for (const socket of sockets) if (socket?.data.controllerGame === game.code && socket.id !== game.hostSocketId) socket.emit('pindrop:secret', secret)
  }
  const hostJoined = (game, socket) => sendSecret(game, socket)

  // ---------- Rounds and clocks ----------
  function setPhase(game, phase) {
    const round = game.round, practice = inTutorial(game)
    round.phase = phase
    const ms = phase === 'answer' ? (practice ? PINDROP_PRACTICE_TIMES.answerMs : game.config.answerMs)
      : game.hostless ? (practice ? PINDROP_PRACTICE_TIMES.revealMs : PINDROP_TIMES.revealMs) : null
    round.deadline = ms ? Date.now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'pindrop', ms, () => { if (game.round === round && round.phase === phase && game.status === 'playing') { advance(game); emitGame(game) } })
  }
  function startRound(game, clue = game.clues[game.index]) {
    game.round = { clue, phase: 'answer', deadline: null, pins: {}, results: null }
    event(game, 'round', { index: game.index })
    setPhase(game, 'answer')
    sendSecret(game)
  }
  // The clock ran out, the host tapped Next, or everyone locked in.
  function advance(game) {
    if (game.round.phase === 'answer') reveal(game)
    else nextRound(game)
  }
  function nextRound(game) {
    if (inTutorial(game)) return nextPractice(game)
    if (game.index < game.clues.length - 1) { game.index++; return startRound(game) }
    finish(game)
  }
  function finish(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.round) game.round.deadline = null
    event(game, 'complete')
  }

  // ---------- Practice round ----------
  function beginPractice(game) {
    beginTutorial(game, PINDROP_TUTORIAL_STEPS)
    game.practice = { done: false }
    startRound(game, game.config.practice)
  }
  // The step is read off the practice round's state, so the coach always matches the screen.
  function practiceStep(game) {
    const practice = game.practice, round = game.round
    if (!practice || !round || practice.done) return 'done'
    return round.phase === 'answer' ? 'drop' : 'reveal'
  }
  // After the practice reveal: the coach wraps up over the reveal, and without a host round one starts shortly after.
  function nextPractice(game) {
    const practice = game.practice
    if (practice.done) return endTutorial(game)
    practice.done = true
    clearGameTimers(game)
    game.round.deadline = game.hostless ? Date.now() + PINDROP_PRACTICE_TIMES.endMs : null
    if (game.hostless) schedule(game, 'pindrop', PINDROP_PRACTICE_TIMES.endMs, () => endTutorial(game))
    event(game, 'practiceDone')
  }
  // Out of the practice (played through, skipped by the host, or voted down) into round one, with scores at 0.
  function endTutorial(game) {
    if (!leaveTutorial(game)) return
    clearGameTimers(game)
    game.practice = null
    for (const player of game.players.values()) player.score = 0
    game.index = 0
    game.history = []
    startRound(game)
    emitGame(game)
  }

  // ---------- Pins ----------
  // A player's pin: placed (or moved) with lat/lng, and locked with lock: true. A locked pin can't move. When the
  // clock runs out, pins that were placed but not locked still count.
  function pin(game, playerId, payload) {
    const round = game.round
    if (game.status !== 'playing' || round?.phase !== 'answer') return { ok: false, error: 'Time’s up for this one.' }
    const mine = round.pins[playerId]
    if (mine?.locked) return { ok: false, error: 'Your pin is locked in.' }
    const lat = Number(payload.lat), lng = Number(payload.lng), hasPoint = payload.lat != null && payload.lng != null
    if (hasPoint) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85.06 || Math.abs(lng) > 100000) return { ok: false, error: 'Drop your pin on the map.' }
      round.pins[playerId] = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(wrapLng(lng) * 1e5) / 1e5, locked: false }
    }
    if (payload.lock) {
      if (!round.pins[playerId]) return { ok: false, error: 'Drop your pin on the map first.' }
      round.pins[playerId].locked = true
      event(game, 'locked', { playerId })
      checkDone(game)
    } else if (!hasPoint) return { ok: false, error: 'Drop your pin on the map.' }
    else if (!mine) event(game, 'placed', { playerId })
    return { ok: true }
  }
  // Everyone still here has locked in: reveal straight away.
  function checkDone(game) {
    const round = game.round, live = connected(game)
    if (round?.phase === 'answer' && live.length && live.every((player) => round.pins[player.id]?.locked)) reveal(game)
  }

  // ---------- Scoring ----------
  // Every point goes through here. Nothing scores in the practice round.
  function award(game, playerId, points) {
    const player = game.players.get(playerId)
    if (player && points && !inTutorial(game)) player.score += points
  }
  function reveal(game) {
    const round = game.round, pack = game.config.pack
    const pins = {}
    for (const [id, spot] of Object.entries(round.pins)) {
      if (!game.players.has(id)) continue
      const km = haversineKm(spot, round.clue)
      pins[id] = { lat: spot.lat, lng: spot.lng, locked: spot.locked, km: Math.round(km * 10) / 10, points: roundScore(km, pack), bonus: 0 }
    }
    // The closest pin (ties share it) earns the bonus, when there's more than one pin to beat.
    const entries = Object.entries(pins), best = Math.min(...entries.map(([, p]) => p.km))
    const closest = entries.length > 1 ? entries.filter(([, p]) => p.km === best).map(([id]) => id) : []
    for (const id of closest) pins[id].bonus = CLOSEST_BONUS
    for (const [id, p] of entries) award(game, id, p.points + p.bonus)
    round.results = { pins, closest }
    if (!inTutorial(game)) game.history.push({ index: game.index, clue: shownClue(round.clue, true), pins, closest })
    event(game, 'reveal')
    setPhase(game, 'reveal')
  }

  // ---------- Players coming and going ----------
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    if (game.status === 'playing') checkDone(game)
    emitGame(game)
  }

  function hostAction(game, action, payload) {
    const playing = game.status === 'playing' && game.round
    if (action === 'start' && game.status === 'lobby' && connected(game).length >= 1) {
      game.status = 'playing'; game.index = 0; game.history = []
      if (game.config.tutorial) beginPractice(game); else startRound(game)
    }
    if (action === 'next' && playing) advance(game)
    // Skipping a round during the practice skips the practice (endTutorial sends the game out itself).
    if (action === 'skip' && playing) { if (inTutorial(game)) return endTutorial(game); nextRound(game) }
    if (action === 'endGame' && game.status === 'playing' && !inTutorial(game)) finish(game)
    if (action === 'adjustScore') { const player = game.players.get(payload.playerId), amount = Math.trunc(Number(payload.amount)); if (player && Number.isFinite(amount)) player.score += amount }
    if (action === 'renamePlayer') { const player = game.players.get(payload.playerId), name = text(payload.name, 20); if (player && name) player.name = name }
    if (action === 'kickPlayer') {
      const player = game.players.get(payload.playerId)
      if (player) {
        cancelLeave(game.code, player.id)
        const socket = io.sockets.sockets.get(player.socketId)
        socket?.leave(game.code); socket?.emit('player:kicked')
        game.players.delete(player.id)
        if (game.round) delete game.round.pins[player.id]
        if (game.status === 'playing') checkDone(game)
        // One fewer player can carry a vote to skip the practice.
        if (skipCarried(game)) return endTutorial(game)
      }
    }
    if (action === 'replay') {
      let config = game.config
      // A replay keeps the pack, unit, difficulty and clock; the setup's screen deals new clues from the same pack.
      try { if (payload.clues) config = cleanConfig({ ...config, clues: payload.clues, timer: config.answerMs / 1000, practice: null }) } catch {}
      // No practice round on a replay.
      config = { ...config, tutorial: false }
      clearGameTimers(game)
      Object.assign(game, { status: 'lobby', config, clues: config.clues, index: 0, round: null, history: [], lastEvent: null, tutorial: null, practice: null })
      for (const player of game.players.values()) player.score = 0
    }
    emitGame(game)
  }

  function register(socket) {
    socket.on('pindrop:pin', ({ code, playerId, ...payload } = {}, ack) => {
      const game = pinGame(code), player = game?.players.get(playerId)
      // Only from the player's own phone.
      if (!player?.socketId || player.socketId !== socket.id) return ack?.({ ok: false, error: 'You’re not in this game.' })
      const result = pin(game, playerId, payload)
      ack?.(result)
      if (result.ok) emitGame(game)
    })
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, hostJoined, register, endTutorial }
}
