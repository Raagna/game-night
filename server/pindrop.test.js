import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createPinDropGames, haversineKm, roundScore, formatDistance, defaultUnit, dealClues, wrapLng,
  PINDROP_PACKS, PINDROP_TIMERS, DEFAULT_TIMER, PINDROP_TIMES, PINDROP_PRACTICE_TIMES, PINDROP_TUTORIAL_STEPS, MAX_POINTS, CLOSEST_BONUS, PLACE_DIFFICULTIES,
} from './pindrop.js'
import { registerTutorial, publicTutorial, inTutorial } from './tutorial.js'

const PLACES = JSON.parse(readFileSync(new URL('../src/pindrop/places.json', import.meta.url), 'utf8')).places

// A game server without sockets or real timers: scheduled clocks run when a test calls fire().
function harness() {
  const games = new Map(), timers = {}, sockets = new Map(), rooms = new Map(), secrets = []
  const io = { sockets: { sockets, adapter: { rooms } } }
  const api = createPinDropGames({
    io, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
  })
  return {
    api, games, timers, secrets,
    fire: (name = 'pindrop') => { const timer = timers[name]; assert.ok(timer, `no ${name} clock running`); delete timers[name]; timer.fn() },
    // A pin from a phone: by default the player's own socket.
    pin: (game, playerId, payload, socketId = game.players.get(playerId)?.socketId) => {
      const handlers = new Map()
      api.register({ id: socketId, on: (event, fn) => handlers.set(event, fn) })
      let reply
      handlers.get('pindrop:pin')({ code: game.code, playerId, ...payload }, (result) => { reply = result })
      return reply
    },
    controller: (game) => {
      const socket = { id: 'ctrl', data: { controllerGame: game.code }, emit: (event, data) => secrets.push({ event, data }) }
      sockets.set(socket.id, socket); rooms.set(game.code, new Set([socket.id]))
    },
  }
}
const PARIS = { lat: 48.8566, lng: 2.3522 }, LONDON = { lat: 51.5074, lng: -0.1278 }, NYC = { lat: 40.7128, lng: -74.006 }
const clue = (id, spot, extra = {}) => ({ id, clue: `Clue ${id}`, answer: `Answer ${id}`, difficulty: 'easy', ...spot, ...extra })
const CLUES = [clue('a', PARIS), clue('b', LONDON), clue('c', NYC)]
function newGame(h, { players = 3, start = true, clues = CLUES, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { clues, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) {
    const player = { id: `p${i}`, name: `Player ${i}`, score: 0, socketId: `s${i}` }
    game.players.set(player.id, player); h.api.playerJoined(game, player)
  }
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
const score = (game, id) => game.players.get(id).score
// A point `km` north of a spot (a degree of latitude is about 111.2 km).
const north = (spot, km) => ({ lat: spot.lat + km / 111.195, lng: spot.lng })

// ---------- Distance and scoring ----------
describe('distance and scoring', () => {
  test('haversine distances match known great-circle distances', () => {
    assert.equal(haversineKm(PARIS, PARIS), 0)
    assert.ok(Math.abs(haversineKm(PARIS, LONDON) - 344) < 3, 'Paris–London is about 344 km')
    assert.ok(Math.abs(haversineKm(LONDON, NYC) - 5570) < 15, 'London–New York is about 5,570 km')
    assert.ok(Math.abs(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }) - 20015) < 5, 'half way round the equator')
    // Across the date line it's the short way round.
    assert.ok(haversineKm({ lat: -8.5, lng: 179.5 }, { lat: -8.5, lng: -179.5 }) < 120)
    assert.equal(wrapLng(190), -170)
    assert.equal(wrapLng(-190), 170)
  })
  test('a pin on the spot scores full marks, and the points fall off smoothly with distance', () => {
    for (const pack of Object.keys(PINDROP_PACKS)) {
      assert.equal(roundScore(0, pack), MAX_POINTS)
      assert.equal(roundScore(PINDROP_PACKS[pack].perfectKm, pack), MAX_POINTS, 'within the perfect radius')
      // Kilometre by kilometre, the score never rises and never drops by more than the curve's steepest slope.
      const steepest = Math.ceil(MAX_POINTS / PINDROP_PACKS[pack].scaleKm) + 1
      let last = MAX_POINTS
      for (let km = 1; km <= 20000; km++) {
        const points = roundScore(km, pack)
        assert.ok(points <= last && points >= 0, `${pack} never goes up or below zero (${km} km)`)
        assert.ok(last - points <= steepest, `${pack} has no cliff at ${km} km`)
        last = points
      }
    }
    assert.equal(roundScore(NaN), 0)
  })
  test('the falloff is tuned per pack: a miss that’s close on the world map is poor inside the USA', () => {
    assert.ok(roundScore(200, 'world') > 850, 'a 200 km miss is a fine world guess')
    assert.ok(roundScore(200, 'usa') < 600, 'but not inside the USA')
    assert.ok(roundScore(200, 'canada') < 700)
    assert.ok(roundScore(1000, 'world') > 400 && roundScore(1000, 'world') < 600)
    assert.ok(roundScore(1000, 'usa') < 100, 'a state away scores little in the USA')
    // Nobody gets near-full marks for a pin a few hundred km out in a one-country pack.
    assert.ok(roundScore(100, 'usa') < 800)
  })
  test('distances show in km or miles', () => {
    assert.equal(formatDistance(1240.4, 'km'), '1,240 km')
    assert.equal(formatDistance(1609.344, 'mi'), '1,000 mi')
    assert.equal(formatDistance(8.44, 'km'), '8.4 km')
    assert.equal(formatDistance(0, 'mi'), '0 mi')
    assert.equal(formatDistance(NaN), '')
  })
})

// ---------- Setup: pack, difficulty, unit and clock ----------
describe('setup choices', () => {
  test('the unit defaults to miles for the USA and km elsewhere, and can be changed', () => {
    assert.equal(defaultUnit('usa'), 'mi')
    assert.equal(defaultUnit('world'), 'km')
    assert.equal(defaultUnit('canada'), 'km')
    const h = harness()
    assert.equal(newGame(h, { start: false, pack: 'usa' }).config.unit, 'mi')
    assert.equal(newGame(h, { start: false, pack: 'usa', unit: 'km' }).config.unit, 'km')
    assert.equal(newGame(h, { start: false, pack: 'world', unit: 'mi' }).config.unit, 'mi')
    assert.equal(newGame(h, { start: false, unit: 'furlongs' }).config.unit, 'km')
    assert.equal(newGame(h, { start: false, pack: 'mars' }).config.pack, 'world')
    assert.equal(h.api.publicGame(newGame(h, { start: false, pack: 'canada' })).unit, 'km')
  })
  test('the clock is one of the offered lengths, 45 seconds unless the setup picks another', () => {
    const h = harness()
    assert.equal(DEFAULT_TIMER, 45)
    assert.ok(PINDROP_TIMERS.every((s) => s >= 30), 'every clock is generous')
    assert.equal(newGame(h, { start: false }).config.answerMs, 45000)
    assert.equal(newGame(h, { start: false, timer: 90 }).config.answerMs, 90000)
    assert.equal(newGame(h, { start: false, timer: 2 }).config.answerMs, 45000, 'a made-up clock falls back')
  })
  test('a game needs a clue with a real spot on the map', () => {
    const h = harness()
    assert.throws(() => h.api.makeGame('X', { clues: [] }))
    assert.throws(() => h.api.makeGame('X', { clues: [clue('x', { lat: 95, lng: 0 })] }), 'off the map')
    assert.throws(() => h.api.makeGame('X', { clues: [clue('x', { lat: 'north', lng: 0 })] }))
    assert.equal(h.api.makeGame('X', { clues: [clue('x', { lat: 10, lng: 0 }), clue('y', { lat: 10, lng: 999 })] }).clues.length, 1)
  })
  test('dealing keeps to the pack and the round count, with a practice clue the game doesn’t use', () => {
    for (const pack of Object.keys(PINDROP_PACKS)) for (const rounds of [5, 8, 12]) for (const difficulty of ['easy', 'mixed', 'hard']) {
      const { clues, practice } = dealClues(PLACES, { pack, difficulty, rounds })
      assert.equal(clues.length, rounds, `${pack} ${difficulty} ${rounds}`)
      assert.ok(clues.every((place) => place.pack === pack))
      assert.equal(new Set(clues.map((place) => place.id)).size, rounds, 'no place twice')
      assert.equal(practice.pack, pack)
      assert.ok(!clues.some((place) => place.id === practice.id))
    }
  })
  test('easy deals easy places, hard deals hard ones, and mixed warms up from easy to hard', () => {
    const level = (place) => PLACE_DIFFICULTIES.indexOf(place.difficulty)
    assert.ok(dealClues(PLACES, { pack: 'world', difficulty: 'easy', rounds: 12 }).clues.every((place) => place.difficulty === 'easy'))
    assert.ok(dealClues(PLACES, { pack: 'world', difficulty: 'hard', rounds: 12 }).clues.every((place) => place.difficulty === 'hard'))
    const mixed = dealClues(PLACES, { pack: 'world', difficulty: 'mixed', rounds: 12 }).clues
    assert.deepEqual(['easy', 'medium', 'hard'].map((d) => mixed.filter((place) => place.difficulty === d).length), [4, 4, 4])
    assert.ok(mixed.every((place, i) => i === 0 || level(mixed[i - 1]) <= level(place)), 'easiest first')
    assert.deepEqual(['easy', 'medium', 'hard'].map((d) => dealClues(PLACES, { pack: 'usa', rounds: 5 }).clues.filter((place) => place.difficulty === d).length), [2, 2, 1])
    // A pack with fewer easy places than rounds tops up with medium ones rather than dealing short.
    const few = [...Array(3)].map((_, i) => ({ id: `e${i}`, pack: 'canada', difficulty: 'easy' })).concat([...Array(6)].map((_, i) => ({ id: `m${i}`, pack: 'canada', difficulty: 'medium' })))
    const topped = dealClues(few, { pack: 'canada', difficulty: 'easy', rounds: 5 }).clues
    assert.equal(topped.length, 5)
    assert.equal(topped.filter((place) => place.difficulty === 'easy').length, 3)
    assert.equal(dealClues(few, { pack: 'canada', difficulty: 'easy', rounds: 5 }).practice.difficulty, 'medium')
  })
  test('places this browser has played come last', () => {
    const usa = PLACES.filter((place) => place.pack === 'usa' && place.difficulty === 'hard')
    const played = new Set(usa.slice(0, usa.length - 5).map((place) => place.id))
    const { clues } = dealClues(PLACES, { pack: 'usa', difficulty: 'hard', rounds: 5 }, Math.random, played)
    assert.ok(clues.every((place) => !played.has(place.id)))
  })
})

// ---------- The clue data ----------
describe('the clue data', () => {
  test('every place has an id, a pack, a difficulty, a clue, an answer and a spot on the map', () => {
    for (const place of PLACES) {
      assert.match(place.id, /^[wuc]-[a-z0-9-]+$/, place.id)
      assert.ok(Object.hasOwn(PINDROP_PACKS, place.pack), `${place.id} pack`)
      assert.ok(PLACE_DIFFICULTIES.includes(place.difficulty), `${place.id} difficulty`)
      assert.ok(place.clue.length >= 10 && place.clue.length <= 240, `${place.id} clue`)
      assert.ok(place.answer.length >= 3 && place.answer.length <= 100, `${place.id} answer`)
      assert.ok(Number.isFinite(place.lat) && Math.abs(place.lat) <= 85, `${place.id} lat`)
      assert.ok(Number.isFinite(place.lng) && Math.abs(place.lng) <= 180, `${place.id} lng`)
    }
  })
  test('no duplicates: ids, clues and spots are all different', () => {
    assert.equal(new Set(PLACES.map((place) => place.id)).size, PLACES.length)
    assert.equal(new Set(PLACES.map((place) => place.clue)).size, PLACES.length)
    for (const pack of Object.keys(PINDROP_PACKS)) {
      const inPack = PLACES.filter((place) => place.pack === pack)
      for (let i = 0; i < inPack.length; i++) for (let j = i + 1; j < inPack.length; j++)
        assert.ok(haversineKm(inPack[i], inPack[j]) > 2, `${inPack[i].id} and ${inPack[j].id} are the same spot`)
    }
  })
  test('the USA and Canada packs stay inside their country’s map', () => {
    const inBox = (place, [[s, w], [n, e]], margin) => place.lat > s - margin && place.lat < n + margin && place.lng > w - margin && place.lng < e + margin
    // The USA's view is the lower 48; Alaska and Hawaii are a pan away.
    for (const place of PLACES.filter((p) => p.pack === 'usa')) assert.ok(inBox(place, PINDROP_PACKS.usa.view, 0.5) || place.lng < -125, place.id)
    for (const place of PLACES.filter((p) => p.pack === 'canada')) assert.ok(inBox(place, PINDROP_PACKS.canada.view, 13), place.id)
  })
  test('each pack is big enough for its longest game and a practice clue', () => {
    const count = (pack, difficulty) => PLACES.filter((place) => place.pack === pack && (!difficulty || place.difficulty === difficulty)).length
    assert.ok(count('world') >= 110 && count('usa') >= 40 && count('canada') >= 30)
    for (const pack of Object.keys(PINDROP_PACKS)) for (const level of PLACE_DIFFICULTIES) assert.ok(count(pack, level) >= 8, `${pack} ${level}`)
  })
})

// ---------- Pins, locking in and the clock ----------
describe('pins and the clock', () => {
  test('the clue shows, but the answer stays hidden until the reveal', () => {
    const h = harness(), game = newGame(h)
    const round = h.api.publicGame(game).round
    assert.equal(round.clue.clue, 'Clue a')
    assert.equal(round.clue.answer, undefined)
    assert.equal(round.clue.lat, undefined)
    assert.equal(round.phase, 'answer')
  })
  test('a pin can move until it’s locked in; the TV sees who placed and who locked, not where', () => {
    const h = harness(), game = newGame(h)
    assert.equal(h.pin(game, 'p0', { lat: 10, lng: 10 }).ok, true)
    assert.equal(h.pin(game, 'p0', { lat: 48, lng: 2 }).ok, true, 'moved')
    assert.equal(h.pin(game, 'p0', { lock: true }).ok, true)
    assert.equal(h.pin(game, 'p0', { lat: 0, lng: 0 }).ok, false, 'locked pins stay put')
    assert.deepEqual(game.round.pins.p0, { lat: 48, lng: 2, locked: true })
    assert.equal(h.pin(game, 'p1', { lock: true }).ok, false, 'nothing to lock yet')
    const round = h.api.publicGame(game).round
    assert.deepEqual(round.placed, ['p0'])
    assert.deepEqual(round.locked, ['p0'])
    assert.equal(JSON.stringify(round).includes('"lat"'), false, 'no pin positions before the reveal')
  })
  test('nonsense pins are refused', () => {
    const h = harness(), game = newGame(h)
    assert.equal(h.pin(game, 'p0', { lat: 'x', lng: 2 }).ok, false)
    assert.equal(h.pin(game, 'p0', { lat: 89, lng: 2 }).ok, false)
    assert.equal(h.pin(game, 'p0', {}).ok, false)
    assert.equal(h.pin(game, 'p0', { lat: 10, lng: 370 }).ok, true)
    assert.equal(game.round.pins.p0.lng, 10, 'longitude wraps round')
  })
  test('the round reveals as soon as everyone has locked in', () => {
    const h = harness(), game = newGame(h)
    h.pin(game, 'p0', { ...PARIS, lock: true })
    h.pin(game, 'p1', { ...LONDON, lock: true })
    assert.equal(game.round.phase, 'answer')
    h.pin(game, 'p2', { ...NYC, lock: true })
    assert.equal(game.round.phase, 'reveal')
  })
  test('the clock runs for the chosen time, and pins placed but not locked still count when it runs out', () => {
    const h = harness(), game = newGame(h, { timer: 60 })
    assert.equal(h.timers.pindrop.ms, 60000)
    const left = game.round.deadline - Date.now()
    assert.ok(left > 59000 && left <= 60000)
    h.pin(game, 'p0', { ...north(PARIS, 100), lock: true })
    h.pin(game, 'p1', north(PARIS, 300)) // placed, never locked
    h.fire()
    assert.equal(game.round.phase, 'reveal')
    const { pins } = game.round.results
    assert.equal(pins.p1.locked, false)
    assert.ok(pins.p1.points > 0, 'the unlocked pin scores')
    assert.equal(pins.p2, undefined, 'no pin, no points')
    assert.equal(score(game, 'p2'), 0)
    assert.equal(h.pin(game, 'p2', PARIS).ok, false, 'too late')
  })
  test('scores follow the distance, and the closest pin earns the bonus', () => {
    const h = harness(), game = newGame(h)
    h.pin(game, 'p0', { ...north(PARIS, 100), lock: true })
    h.pin(game, 'p1', { ...north(PARIS, 600), lock: true })
    h.pin(game, 'p2', { ...north(PARIS, 2000), lock: true })
    const { pins, closest } = game.round.results
    assert.ok(Math.abs(pins.p0.km - 100) < 1)
    assert.deepEqual(closest, ['p0'])
    assert.equal(pins.p0.bonus, CLOSEST_BONUS)
    assert.equal(pins.p1.bonus, 0)
    assert.equal(score(game, 'p0'), roundScore(pins.p0.km, 'world') + CLOSEST_BONUS)
    assert.equal(score(game, 'p1'), roundScore(pins.p1.km, 'world'))
    assert.ok(score(game, 'p1') > score(game, 'p2'))
    const history = h.api.publicGame(game).history
    assert.equal(history.length, 1, 'the round goes in the per-round breakdown')
    assert.equal(history[0].clue.answer, 'Answer a')
    assert.equal(history[0].pins.p2.points, pins.p2.points)
  })
  test('tied closest pins share the bonus; a lone pin gets none', () => {
    const h = harness(), game = newGame(h)
    h.pin(game, 'p0', { ...north(PARIS, 50), lock: true })
    h.pin(game, 'p1', { ...north(PARIS, 50), lock: true })
    h.pin(game, 'p2', { ...north(PARIS, 900), lock: true })
    assert.deepEqual(game.round.results.closest.sort(), ['p0', 'p1'])
    const h2 = harness(), one = newGame(h2, { players: 1 })
    h2.pin(one, 'p0', { ...PARIS, lock: true })
    assert.deepEqual(one.round.results.closest, [])
    assert.equal(score(one, 'p0'), MAX_POINTS)
  })
  test('a player who leaves isn’t waited for', () => {
    const h = harness(), game = newGame(h)
    h.pin(game, 'p0', { ...PARIS, lock: true }); h.pin(game, 'p1', { ...PARIS, lock: true })
    game.players.get('p2').socketId = null
    h.api.playerLeft(game, 'p2')
    assert.equal(game.round.phase, 'reveal')
  })
  test('each player gets their own pin colour', () => {
    const h = harness(), game = newGame(h, { players: 4, start: false })
    assert.deepEqual([...game.players.values()].map((p) => p.color), [0, 1, 2, 3])
    game.players.delete('p1')
    const late = { id: 'p9', name: 'Late', score: 0, socketId: 's9' }
    game.players.set(late.id, late); h.api.playerJoined(game, late)
    assert.equal(late.color, 1, 'the free colour')
  })
})

// ---------- Who controls what ----------
describe('hosted and hostless games', () => {
  test('players only ever place their own pin', () => {
    const h = harness(), game = newGame(h)
    assert.equal(h.pin(game, 'p1', PARIS, 's0').ok, false, 'not from someone else’s phone')
    assert.equal(game.round.pins.p1, undefined)
    assert.equal(h.pin(game, 'p1', PARIS, 'tv').ok, false, 'not from the TV')
  })
  test('with a host, reveals and rounds wait for the host, who sees the answer early', () => {
    const h = harness(), game = newGame(h, { players: 2 })
    h.controller(game)
    h.api.hostAction(game, 'next', {}) // reveal now
    assert.equal(game.round.phase, 'reveal')
    assert.equal(h.timers.pindrop, undefined, 'the reveal waits for the host')
    h.api.hostAction(game, 'next', {})
    assert.equal(game.index, 1)
    assert.equal(game.round.phase, 'answer')
    assert.equal(h.secrets.at(-1).event, 'pindrop:secret')
    assert.equal(h.secrets.at(-1).data.answer, 'Answer b')
    h.api.hostAction(game, 'next', {}); h.api.hostAction(game, 'next', {})
    h.api.hostAction(game, 'next', {}); h.api.hostAction(game, 'next', {})
    assert.equal(game.status, 'complete')
    assert.equal(game.history.length, 3)
  })
  test('without a host, the game runs itself to the end, and nobody gets the answer early', () => {
    const h = harness(), game = newGame(h, { players: 2, hostless: true })
    h.controller(game)
    h.fire() // time's up
    assert.equal(game.round.phase, 'reveal')
    assert.equal(h.timers.pindrop.ms, PINDROP_TIMES.revealMs)
    h.fire()
    assert.equal(game.index, 1)
    h.fire(); h.fire(); h.fire(); h.fire()
    assert.equal(game.status, 'complete')
    assert.equal(h.secrets.length, 0)
  })
  test('the lobby needs a player to start; replay deals new clues and keeps the setup', () => {
    const h = harness(), game = newGame(h, { players: 0, pack: 'usa', timer: 30 })
    assert.equal(game.status, 'lobby')
    const p = { id: 'p0', name: 'Solo', score: 0, socketId: 's0' }; game.players.set('p0', p); h.api.playerJoined(game, p)
    h.api.hostAction(game, 'start', {})
    h.pin(game, 'p0', { ...PARIS, lock: true })
    h.api.hostAction(game, 'endGame', {})
    assert.equal(game.status, 'complete')
    h.api.hostAction(game, 'replay', { clues: [clue('z', LONDON)] })
    assert.equal(game.status, 'lobby')
    assert.equal(score(game, 'p0'), 0)
    assert.equal(game.clues[0].id, 'z')
    assert.equal(game.config.pack, 'usa')
    assert.equal(game.config.unit, 'mi')
    assert.equal(game.config.answerMs, 30000)
    assert.deepEqual(game.history, [])
  })
})

// ---------- Practice round (the tutorial) ----------
describe('the practice round', () => {
  const PRACTICE = clue('practice', LONDON)
  const practiceGame = (h, config = {}) => newGame(h, { tutorial: true, practice: PRACTICE, ...config })
  const skipEvents = (h, socket) => {
    const handlers = new Map()
    registerTutorial({ data: {}, ...socket, on: (event, fn) => handlers.set(event, fn) }, { games: h.games, emitGame: () => {}, end: h.api.endTutorial })
    return handlers
  }
  const step = (h, game) => { h.api.publicGame(game); return publicTutorial(game)?.step }

  test('starts from the lobby on the practice clue, with a longer clock', () => {
    const h = harness(), game = practiceGame(h)
    assert.equal(inTutorial(game), true)
    assert.equal(game.round.clue.id, 'practice')
    assert.equal(h.timers.pindrop.ms, PINDROP_PRACTICE_TIMES.answerMs)
    assert.deepEqual(publicTutorial(game).steps, PINDROP_TUTORIAL_STEPS)
    assert.equal(step(h, game), 'drop')
    assert.equal(h.api.publicGame(game).round.clue.answer, undefined, 'the answer stays hidden in practice too')
  })
  test('no practice without the option, without a practice clue, or on a replay', () => {
    const h = harness()
    assert.equal(inTutorial(newGame(h)), false)
    assert.equal(inTutorial(newGame(h, { tutorial: true })), false)
    const game = practiceGame(h)
    h.api.endTutorial(game)
    h.api.hostAction(game, 'endGame', {})
    h.api.hostAction(game, 'replay', {})
    h.api.hostAction(game, 'start', {})
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.clue.id, 'a')
  })
  test('without a host: drop, reveal, wrap up, then round one, and nothing scores', () => {
    const h = harness(), game = practiceGame(h, { hostless: true })
    h.pin(game, 'p0', { ...LONDON, lock: true }); h.pin(game, 'p1', { ...PARIS, lock: true }); h.pin(game, 'p2', { ...NYC, lock: true })
    assert.equal(step(h, game), 'reveal')
    assert.deepEqual(game.round.results.closest, ['p0'], 'the reveal still shows who was closest')
    for (const id of ['p0', 'p1', 'p2']) assert.equal(score(game, id), 0)
    assert.deepEqual(game.history, [], 'the practice isn’t in the breakdown')
    assert.equal(h.timers.pindrop.ms, PINDROP_PRACTICE_TIMES.revealMs)
    h.fire()
    assert.equal(step(h, game), 'done')
    assert.equal(h.timers.pindrop.ms, PINDROP_PRACTICE_TIMES.endMs)
    h.fire()
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.clue.id, 'a')
    assert.equal(h.timers.pindrop.ms, DEFAULT_TIMER * 1000, 'the real clock again')
  })
  test('with a host, the host moves it along and starts round one', () => {
    const h = harness(), game = practiceGame(h)
    h.api.hostAction(game, 'next', {})
    assert.equal(step(h, game), 'reveal')
    assert.equal(h.timers.pindrop, undefined)
    h.api.hostAction(game, 'next', {})
    assert.equal(step(h, game), 'done')
    assert.equal(game.round.deadline, null)
    h.api.hostAction(game, 'next', {})
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.clue.id, 'a')
  })
  test('with a host, only the TV or the host controller can skip it', () => {
    const h = harness(), game = practiceGame(h)
    game.hostSocketId = 'tv'
    h.pin(game, 'p0', LONDON)
    skipEvents(h, { id: 's0' }).get('tutorial:skip')({ code: game.code })
    assert.equal(inTutorial(game), true, 'a phone can’t skip a hosted practice')
    skipEvents(h, { id: 's0' }).get('tutorial:vote')({ code: game.code, playerId: 'p0' })
    assert.equal(inTutorial(game), true, 'and there’s no vote with a host')
    h.api.hostAction(game, 'adjustScore', { playerId: 'p0', amount: 300 })
    skipEvents(h, { id: 'tv' }).get('tutorial:skip')({ code: game.code })
    assert.equal(inTutorial(game), false)
    assert.equal(game.round.clue.id, 'a')
    assert.deepEqual(game.round.pins, {}, 'the practice pin doesn’t carry over')
    assert.equal(score(game, 'p0'), 0, 'scores start at 0')
    h.api.endTutorial(game)
    assert.equal(game.round.clue.id, 'a', 'a second end does nothing')
  })
  test('without a host, a strict majority of connected players skips it', () => {
    const h = harness(), game = practiceGame(h, { hostless: true, players: 4 })
    const vote = (id, socketId = game.players.get(id).socketId) => skipEvents(h, { id: socketId }).get('tutorial:vote')({ code: game.code, playerId: id })
    skipEvents(h, { id: 'tv' }).get('tutorial:skip')({ code: game.code })
    assert.equal(inTutorial(game), true, 'no host skip in a hostless game')
    vote('p0'); vote('p1')
    assert.equal(inTutorial(game), true, '2 of 4 isn’t a majority')
    vote('p1')
    assert.deepEqual(publicTutorial(game).votes, ['p0'], 'a second tap takes it back')
    vote('p1'); vote('p2')
    assert.equal(inTutorial(game), false, '3 of 4 skips')
    assert.equal(game.round.clue.id, 'a')
  })
  test('without a host, a kick can carry the vote', () => {
    const h = harness(), game = practiceGame(h, { hostless: true, players: 3 })
    skipEvents(h, { id: 's0' }).get('tutorial:vote')({ code: game.code, playerId: 'p0' })
    h.api.hostAction(game, 'kickPlayer', { playerId: 'p2' })
    assert.equal(inTutorial(game), true, '1 of 2 isn’t a majority')
    h.api.hostAction(game, 'kickPlayer', { playerId: 'p1' })
    assert.equal(inTutorial(game), false, '1 of 1')
  })
})
