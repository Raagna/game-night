import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHerringGames, HERRING_TIMES, LAB, labTarget } from './herring.js'
import { CATEGORIES, dealCards, dealRoles, factsInPlay, tally, DEFAULT_ROLES } from './herringCase.js'

// A seeded random, so each test deals the same case every run.
function seeded(seed = 7) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 } }

// A game server without sockets or real timers: scheduled clocks run when a test calls fire(), and the clock is a
// number the test moves on.
function harness({ seed = 7 } = {}) {
  const games = new Map(), timers = {}, clock = { t: 1_000_000 }
  const io = { sockets: { sockets: new Map(), adapter: { rooms: new Map() } } }
  const api = createHerringGames({
    io, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
    random: seeded(seed), now: () => clock.t,
  })
  const h = {
    api, games, timers, clock,
    fire: () => { const timer = timers.herring; assert.ok(timer, 'no clock running'); delete timers.herring; timer.fn() },
    // A phone action on that player's own connection; returns the server's reply.
    act: (game, playerId, action, payload = {}) => {
      const handlers = new Map(), player = game.players.get(playerId)
      api.register({ id: player.socketId, data: {}, on: (event, fn) => handlers.set(event, fn) })
      let reply
      handlers.get('herring:act')({ code: game.code, playerId, action, payload }, (r) => { reply = r })
      return reply
    },
    me: (game, playerId) => api.privateView(game, playerId),
  }
  return h
}
function newGame(h, { players = 6, start = true, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { hostless: true, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) {
    const player = { id: `p${i}`, name: `Guest ${i}`, score: 0, socketId: `s${i}` }
    game.players.set(player.id, player); h.api.playerJoined(game, player)
  }
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
const ids = (game) => [...game.players.keys()]
const withRole = (game, role) => ids(game).find((id) => game.case.roles[id] === role)
const innocents = (game) => ids(game).filter((id) => !['killer', 'accomplice'].includes(game.case.roles[id]))
// Everyone free taps a hunch (at someone other than themselves); `extra` adds role actions for some players.
function passNight(h, game, extra = {}) {
  const free = ids(game).filter((id) => (game.fates[id] || 'alive') === 'alive')
  for (const id of free) {
    const hunch = free.find((other) => other !== id && other !== extra[id]?.target) || free.find((other) => other !== id)
    h.act(game, id, 'night', { hunch, ...(extra[id] || {}) })
  }
}

test('the deal: every fact in play is shared, the crime is the killer’s card, no innocent has all three', () => {
  for (let seed = 1; seed < 60; seed++) {
    const players = 5 + (seed % 8), list = Array.from({ length: players }, (_, i) => `p${i}`)
    const { values, crime, cards } = dealCards(list, 'p2', seeded(seed))
    assert.deepEqual(cards.p2, crime)
    const ledger = tally(values, cards)
    for (const category of CATEGORIES) {
      assert.equal(values[category].length, factsInPlay(players))
      assert.ok(ledger[category].every(({ count }) => count >= 1), 'every fact in play is on a card')
      assert.ok(ledger[category].find(({ value }) => value === crime[category]).count >= 2, 'the crime’s facts are shared')
    }
    assert.ok(list.every((id) => id === 'p2' || CATEGORIES.some((category) => cards[id][category] !== crime[category])))
  }
})

test('roles grow with the party and respect the host’s choices', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => `p${i}`)
  const count = (roles) => Object.values(roles).reduce((all, role) => ({ ...all, [role]: (all[role] || 0) + 1 }), {})
  assert.deepEqual(count(dealRoles(list(5), DEFAULT_ROLES, seeded(3))), { killer: 1, forensics: 1, witness: 1, detective: 2 })
  const eight = count(dealRoles(list(8), DEFAULT_ROLES, seeded(3)))
  assert.equal(eight.accomplice, 1); assert.equal(eight.officer, 1); assert.equal(eight.coroner, 1); assert.equal(eight.reporter, 1)
  assert.equal(count(dealRoles(list(8), { ...DEFAULT_ROLES, accomplice: false }, seeded(3))).accomplice, undefined)
  assert.equal(count(dealRoles(list(12), { ...DEFAULT_ROLES, rookie: true }, seeded(3))).rookie, 1)
})

test('a game needs five guests, and nobody new can join once the case is dealt', () => {
  const h = harness()
  const small = newGame(h, { players: 4 })
  assert.equal(small.status, 'lobby')
  const game = newGame(h, { players: 5 })
  assert.equal(game.status, 'playing')
  assert.equal(game.phase, 'night')
  assert.equal(h.api.maxPlayers(game), 5)
})

test('roles and cards never reach the public view until the game is over', () => {
  const h = harness(), game = newGame(h)
  const json = JSON.stringify(h.api.publicGame(game))
  for (const [id, role] of Object.entries(game.case.roles)) assert.ok(!json.includes(`"${id}":"${role}"`), 'nobody’s role')
  assert.ok(!json.includes(JSON.stringify(game.case.cards[withRole(game, 'killer')])), 'not the killer’s card')
  assert.deepEqual(h.api.publicGame(game).pinned, {})
  assert.equal(h.api.publicGame(game).reveal, null)
  // Each phone sees its own role and card, and only the killer's side sees the crime.
  const killer = withRole(game, 'killer'), witness = withRole(game, 'witness')
  assert.equal(h.me(game, killer).role, 'killer')
  assert.deepEqual(h.me(game, killer).crime, game.case.crime)
  assert.equal(h.me(game, witness).crime, null)
  const seen = h.me(game, witness).notes[0]
  assert.equal(seen.type, 'witness'); assert.equal(seen.value, game.case.crime[seen.category])
})

test('night one: no kill; the night ends once every free guest has tapped a hunch', () => {
  const h = harness(), game = newGame(h)
  const killer = withRole(game, 'killer'), victim = innocents(game)[0]
  assert.equal(h.me(game, killer).night.kind, 'case')
  assert.equal(h.act(game, killer, 'night', { target: victim, hunch: victim }).ok, false, 'no kill on night one')
  passNight(h, game)
  assert.equal(game.phase, 'morning')
  assert.equal(game.morning.first, true)
  assert.equal(game.morning.victimId, null)
  assert.deepEqual(Object.values(game.fates), [])
})

test('night two: the killer’s target dies and their real card is pinned up', () => {
  const h = harness(), game = newGame(h)
  passNight(h, game); h.fire(); h.fire() // morning → investigation → verdict (nobody was accused)
  assert.equal(game.phase, 'verdict'); assert.equal(game.trial.verdict.none, true)
  h.fire()
  assert.equal(game.day, 2); assert.equal(game.phase, 'night')
  const killer = withRole(game, 'killer'), victim = innocents(game).find((id) => game.case.roles[id] === 'detective')
  assert.equal(h.me(game, killer).night.kind, 'kill')
  passNight(h, game, { [killer]: { target: victim } })
  assert.equal(game.phase, 'morning')
  assert.equal(game.fates[victim], 'dead')
  assert.equal(game.morning.victimId, victim)
  assert.equal(game.morning.room, game.case.cards[victim].room)
  assert.deepEqual(h.api.publicGame(game).pinned[victim], game.case.cards[victim])
})

test('the Officer foils an attack, and a foiled attack pins up a free clue', () => {
  const h = harness({ seed: 11 }), game = newGame(h, { players: 7 })
  passNight(h, game); h.fire(); h.fire(); h.fire()
  const killer = withRole(game, 'killer'), officer = withRole(game, 'officer')
  const victim = innocents(game).find((id) => id !== officer)
  passNight(h, game, { [killer]: { target: victim }, [officer]: { target: victim } })
  assert.equal(game.fates[victim], undefined)
  assert.equal(game.morning.foiled, true)
  assert.ok(game.morning.clue)
  assert.equal(game.morning.clue.value, game.case.crime[game.morning.clue.category])
  // The Officer can't guard the same guest two nights running.
  h.fire(); h.fire(); h.fire()
  assert.equal(h.act(game, officer, 'night', { target: victim }).ok, false)
})

test('Forensics learns a true fact about the guest they inspect', () => {
  const h = harness(), game = newGame(h)
  const forensics = withRole(game, 'forensics'), target = ids(game).find((id) => id !== forensics)
  passNight(h, game, { [forensics]: { target } })
  const note = h.me(game, forensics).notes.at(-1)
  assert.equal(note.type, 'inspect'); assert.equal(note.targetId, target)
  assert.equal(note.value, game.case.cards[target][note.category])
})

test('statements: in-play facts only, changes are counted, and only in the investigation', () => {
  const h = harness(), game = newGame(h)
  const guest = ids(game)[0], card = game.case.cards[guest]
  assert.equal(h.act(game, guest, 'statement', card).ok, false, 'not at night')
  passNight(h, game); h.fire()
  assert.equal(game.phase, 'investigate')
  assert.equal(h.act(game, guest, 'statement', { ...card, room: 'nowhere' }).ok, false)
  assert.equal(h.act(game, guest, 'statement', card).ok, true)
  assert.equal(game.statements[guest].changes, 0)
  const other = game.case.values.room.find((room) => room !== card.room)
  assert.equal(h.act(game, guest, 'statement', { ...card, room: other }).ok, true)
  assert.equal(game.statements[guest].changes, 1)
  assert.equal(h.api.publicGame(game).statements[guest].room, other)
})

test('the lab: right answers fill the bar, quick or wrong ones don’t, and a full bar pins a clue next morning', () => {
  const h = harness(), game = newGame(h)
  passNight(h, game); h.fire()
  const guest = ids(game)[0], killer = withRole(game, 'killer')
  assert.equal(game.lab.target, labTarget(6))
  const answer = (task) => (task.type === 'print' ? task.answer : task.answer)
  const work = (id) => { h.clock.t += LAB.minSolveMs; const task = game.tasks[id]; return h.act(game, id, 'solve', { taskId: task.id, answer: answer(task) }) }
  // Too quick to be a person.
  const fast = game.tasks[guest]
  assert.equal(h.act(game, guest, 'solve', { taskId: fast.id, answer: answer(fast) }).right, false)
  // Wrong.
  h.clock.t += LAB.minSolveMs
  const wrong = game.tasks[guest]
  assert.equal(h.act(game, guest, 'solve', { taskId: wrong.id, answer: wrong.type === 'print' ? (wrong.answer + 1) % 4 : [] }).right, false)
  assert.equal(game.lab.count, 0)
  for (let i = 0; i < 3; i++) assert.equal(work(guest).right, true)
  assert.equal(game.lab.count, 3)
  // The killer can contaminate once a day.
  assert.equal(h.act(game, guest, 'contaminate').ok, false)
  assert.equal(h.act(game, killer, 'contaminate').ok, true)
  assert.equal(game.lab.count, 0)
  assert.equal(h.act(game, killer, 'contaminate').ok, false)
  while (game.lab.count < game.lab.target) work(ids(game)[game.lab.count % 6])
  assert.equal(game.lab.solved, true)
  h.fire(); h.fire() // verdict → night 2
  passNight(h, game)
  const clue = game.morning.clue
  assert.ok(clue); assert.equal(clue.value, game.case.crime[clue.category])
  assert.equal(h.api.publicGame(game).clues.length, 1)
})

test('the trial: two accusations put a guest on the stand, and more than half the living voting Jail jails them', () => {
  const h = harness(), game = newGame(h)
  passNight(h, game); h.fire()
  const [a, b, c] = innocents(game)
  h.act(game, a, 'accuse', { targetId: c }); h.act(game, b, 'accuse', { targetId: c })
  h.fire()
  assert.equal(game.phase, 'defense'); assert.equal(game.trial.accusedId, c)
  h.fire()
  assert.equal(game.phase, 'vote')
  const voters = ids(game)
  voters.slice(0, 3).forEach((id) => h.act(game, id, 'vote', { choice: 'jail' }))
  voters.slice(3).forEach((id) => h.act(game, id, 'vote', { choice: 'release' }))
  assert.equal(game.phase, 'verdict')
  assert.equal(game.trial.verdict.jailed, false, '3 of 6 is not more than half')
  assert.ok(h.api.publicGame(game).trial.votes, 'votes are public at the verdict')
})

test('jailing the killer: Last Words naming the Witness steals the win, a wrong guess loses it', () => {
  for (const guessWitness of [true, false]) {
    const h = harness(), game = newGame(h)
    passNight(h, game); h.fire()
    const killer = withRole(game, 'killer'), [a, b] = innocents(game)
    h.act(game, a, 'accuse', { targetId: killer }); h.act(game, b, 'accuse', { targetId: killer })
    h.fire(); h.fire()
    ids(game).forEach((id) => h.act(game, id, 'vote', { choice: 'jail' }))
    assert.equal(game.trial.verdict.wasKiller, true)
    h.fire()
    assert.equal(game.phase, 'lastWords')
    const guess = guessWitness ? withRole(game, 'witness') : withRole(game, 'forensics')
    assert.equal(h.act(game, a, 'lastWords', { guessId: guess }).ok, false, 'only the killer speaks')
    h.act(game, killer, 'lastWords', { guessId: guess })
    assert.equal(game.status, 'complete')
    assert.equal(game.outcome.winner, guessWitness ? 'killer' : 'detectives')
    assert.ok(h.api.publicGame(game).reveal.roles)
  }
})

test('ghosts keep one ghost vote, and the killer wins at parity', () => {
  const h = harness(), game = newGame(h, { players: 5 })
  const killer = withRole(game, 'killer')
  passNight(h, game); h.fire()
  // Day 1: jail an innocent.
  const [a, b, c] = innocents(game)
  h.act(game, a, 'accuse', { targetId: c }); h.act(game, b, 'accuse', { targetId: c })
  h.fire(); h.fire()
  ids(game).forEach((id) => h.act(game, id, 'vote', { choice: 'jail' }))
  assert.equal(game.fates[c], 'jailed')
  h.fire()
  // Night 2: a kill leaves 3 free (killer + 2).
  passNight(h, game, { [killer]: { target: a } })
  assert.equal(game.status, 'playing')
  h.fire()
  h.act(game, killer, 'accuse', { targetId: b }); h.act(game, innocents(game).find((id) => ![a, b, c].includes(id)), 'accuse', { targetId: b })
  h.fire(); h.fire()
  // The jailed guest still has a ghost vote, once.
  assert.equal(h.act(game, c, 'vote', { choice: 'release' }).ok, true)
  assert.equal(game.ghostVotesUsed[c], true)
  ids(game).filter((id) => (game.fates[id] || 'alive') === 'alive').forEach((id) => h.act(game, id, 'vote', { choice: 'jail' }))
  h.fire()
  assert.equal(game.status, 'complete')
  assert.equal(game.outcome.winner, 'killer'); assert.equal(game.outcome.reason, 'parity')
})

test('the case goes cold after day five', () => {
  const h = harness(), game = newGame(h, { players: 8, roles: { officer: false, accomplice: false, coroner: false, reporter: false, informant: false } })
  for (let day = 1; day <= 5; day++) {
    assert.equal(game.day, day)
    passNight(h, game); h.fire(); h.fire()
    if (day < 5) h.fire()
  }
  h.fire()
  assert.equal(game.outcome?.reason, 'cold'); assert.equal(game.outcome.winner, 'killer')
})

test('the Tabloid Reporter gets the scoop when jailed, and the game goes on', () => {
  const h = harness({ seed: 5 }), game = newGame(h, { players: 8 })
  const reporter = withRole(game, 'reporter')
  passNight(h, game); h.fire()
  const [a, b] = innocents(game).filter((id) => id !== reporter)
  h.act(game, a, 'accuse', { targetId: reporter }); h.act(game, b, 'accuse', { targetId: reporter })
  h.fire(); h.fire()
  ids(game).forEach((id) => h.act(game, id, 'vote', { choice: 'jail' }))
  assert.equal(game.trial.verdict.scoop, true)
  h.fire()
  assert.equal(game.status, 'playing'); assert.equal(game.scoopId, reporter)
})

test('a frame swaps the next fact clue for one of the framed guest’s facts', () => {
  const h = harness(), game = newGame(h)
  const killer = withRole(game, 'killer'), framed = innocents(game)[0]
  passNight(h, game, { [killer]: { frame: framed } })
  assert.equal(game.frameUsed, true)
  h.fire()
  game.labDone = true; h.fire(); h.fire()
  passNight(h, game)
  const clue = game.clues[0]
  assert.equal(clue.framed, true)
  assert.equal(clue.value, game.case.cards[framed][clue.category])
  assert.notEqual(clue.value, game.case.crime[clue.category])
  assert.equal(h.api.publicGame(game).clues[0].framed, undefined, 'the TV can’t tell')
})

test('a hosted game waits for the storyteller at the morning and the verdict, and the grimoire is controller-only', () => {
  const h = harness(), game = newGame(h, { hostless: false })
  passNight(h, game)
  assert.equal(game.phase, 'morning'); assert.equal(game.deadline, null); assert.equal(h.timers.herring, undefined)
  h.api.hostAction(game, 'next', {})
  assert.equal(game.phase, 'investigate'); assert.ok(game.deadline)
  let reply
  const handlers = new Map()
  h.api.register({ id: 'tv', data: { controllerGame: game.code }, on: (event, fn) => handlers.set(event, fn) })
  game.hostSocketId = 'tv'
  handlers.get('herring:grimoire')({ code: game.code }, (r) => { reply = r })
  assert.equal(reply.ok, false, 'not on the TV')
  const controller = new Map()
  h.api.register({ id: 'ctrl', data: { controllerGame: game.code }, on: (event, fn) => controller.set(event, fn) })
  controller.get('herring:grimoire')({ code: game.code }, (r) => { reply = r })
  assert.equal(reply.ok, true); assert.deepEqual(reply.roles, game.case.roles)
})

test('a killer who leaves hands the detectives the win', () => {
  const h = harness(), game = newGame(h)
  h.api.hostAction(game, 'kickPlayer', { playerId: withRole(game, 'killer') })
  assert.equal(game.outcome.winner, 'detectives'); assert.equal(game.outcome.reason, 'fled')
})

test('phases run on the clock', () => {
  const h = harness(), game = newGame(h)
  assert.equal(h.timers.herring.ms, HERRING_TIMES.nightMs)
  h.fire()
  assert.equal(game.phase, 'morning')
  assert.equal(h.timers.herring.ms, HERRING_TIMES.morningMs)
  h.fire()
  assert.equal(h.timers.herring.ms, 180000)
})
