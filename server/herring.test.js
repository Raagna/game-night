import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHerringGames, HERRING_TIMES, LAB, labTarget, PRACTICE_STEPS, PRACTICE_NPC, PRACTICE_MS } from './herring.js'
import { CATEGORIES, dealCards, dealRoles, factsInPlay, tally, DEFAULT_ROLES, MAX_PLAYERS } from './herringCase.js'
import { registerTutorial } from './tutorial.js'

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

// ---------- The practice case (the tutorial) ----------
const NPC = PRACTICE_NPC.id
// The coach's step, as the screens get it.
const stepOf = (h, game) => { h.api.publicGame(game); return game.tutorial?.step ?? null }
const practiceGame = (h, config = {}) => newGame(h, { tutorial: true, ...config })
// The skip events, wired up as server/index.js does: `socketId` is the screen sending them.
function skipEvents(h, socketId, data = {}) {
  const handlers = new Map()
  registerTutorial({ id: socketId, data, on: (event, fn) => handlers.set(event, fn) }, { games: h.games, emitGame: () => {}, end: h.api.endTutorial })
  return { skip: (game) => handlers.get('tutorial:skip')({ code: game.code }), vote: (game, playerId) => handlers.get('tutorial:vote')({ code: game.code, playerId }) }
}
// One lab task, solved at a human pace.
function labWork(h, game, id) { h.clock.t += LAB.minSolveMs; const task = game.tasks[id]; return h.act(game, id, 'solve', { taskId: task.id, answer: task.answer }) }
// Nothing from the practice is left on the table, and the real case has been dealt to the players.
function assertRealCase(h, game) {
  assert.equal(game.tutorial, null)
  assert.equal(game.practice, null)
  assert.equal(game.config.tutorial, false, 'a later start or replay has no practice')
  assert.equal(game.status, 'playing'); assert.equal(game.phase, 'night'); assert.equal(game.day, 1)
  assert.equal(game.case.practice, undefined)
  assert.ok(!(NPC in game.case.roles) && !(NPC in game.case.names), 'Mr. Kipper is gone')
  assert.ok(ids(game).includes(game.case.killerId), 'a real guest is the killer')
  assert.deepEqual(Object.keys(game.case.roles).sort(), ids(game).sort())
  assert.deepEqual(game.statements, {}); assert.deepEqual(game.clues, []); assert.deepEqual(game.fates, {}); assert.deepEqual(game.accusations, {})
  assert.deepEqual(game.ghostVotesUsed, {})
  assert.equal(game.lab, null); assert.equal(game.labDone, false); assert.equal(game.trial, null); assert.equal(game.morning, null); assert.equal(game.hunchBoard, null)
  const pub = h.api.publicGame(game)
  assert.equal(pub.practice, null)
  assert.ok(pub.players.every((player) => !player.npc))
  for (const id of ids(game)) assert.equal(h.me(game, id).practice, false)
}

test('the practice case: made-up cards, everyone a Detective and Mr. Kipper the killer; no real role is dealt', () => {
  const h = harness(), game = practiceGame(h)
  assert.equal(game.status, 'playing'); assert.equal(game.phase, 'alibi')
  assert.equal(stepOf(h, game), 'card')
  assert.deepEqual(game.tutorial.steps, PRACTICE_STEPS)
  assert.equal(game.case.practice, true); assert.equal(game.case.killerId, NPC)
  for (const id of ids(game)) {
    const me = h.me(game, id)
    assert.equal(me.practice, true); assert.equal(me.role, 'detective'); assert.equal(me.crime, null); assert.equal(me.partnerId, null)
    assert.notEqual(me.card.room, game.case.crime.room, 'only Mr. Kipper was in the room of the crime')
  }
  // The TV sees Mr. Kipper at the table, but never his role.
  const pub = h.api.publicGame(game)
  assert.deepEqual(pub.players.filter((player) => player.npc).map((player) => player.name), [PRACTICE_NPC.name])
  assert.ok(!JSON.stringify(pub).includes(`"${NPC}":"killer"`)); assert.equal(pub.reveal, null)
  // Nobody new is locked out during the practice.
  assert.equal(h.api.maxPlayers(game), MAX_PLAYERS)
  // Nothing leaves a hostless practice early but the players' vote.
  h.api.hostAction(game, 'endGame', {}); h.api.hostAction(game, 'next', {})
  assert.equal(game.status, 'playing'); assert.equal(game.phase, 'alibi')
})

test('the practice walks through every step, with nothing scoring, then deals the real case', () => {
  const h = harness(), game = practiceGame(h), seen = []
  const note = () => { const step = stepOf(h, game); if (step && seen.at(-1) !== step) seen.push(step) }
  note()
  // Reading the card: the night starts once everyone has.
  ids(game).forEach((id) => { assert.equal(h.act(game, id, 'ready').ok, true); note() })
  assert.equal(h.act(game, ids(game)[0], 'ready').ok, false, 'only in the alibi step')
  assert.equal(game.phase, 'night'); assert.equal(h.me(game, ids(game)[0]).night.kind, 'none')
  assert.equal(h.timers.herring.ms, PRACTICE_MS.night)
  passNight(h, game); note()
  // The morning: the victim, and a clue pinned up at once: the killer was in the Wine Cellar.
  assert.equal(game.phase, 'morning'); assert.equal(game.morning.first, true); assert.deepEqual(game.fates, {})
  assert.equal(game.morning.clue.value, 'cellar')
  h.fire(); note()
  // Statements: Mr. Kipper's lie is already on the board; once everyone has filed, the Library is over-claimed.
  assert.equal(game.phase, 'investigate'); assert.equal(game.practice.stage, 'statement')
  assert.equal(game.statements[NPC].room, 'library')
  ids(game).forEach((id) => h.act(game, id, 'statement', game.case.cards[id]))
  note()
  assert.equal(game.practice.stage, 'lie')
  const library = h.api.publicGame(game).ledger.room.find((row) => row.value === 'library').count
  assert.equal(Object.values(game.statements).filter((said) => said.room === 'library').length, library + 1)
  h.fire(); note()
  // The lab: one task each fills the bar.
  assert.equal(game.practice.stage, 'lab'); assert.equal(game.lab.target, 6)
  ids(game).forEach((id) => { assert.equal(labWork(h, game, id).right, true); note() })
  assert.equal(game.lab.solved, true)
  // Accusations: once everyone has accused, the most-accused stands trial.
  assert.equal(game.practice.stage, 'accuse')
  ids(game).forEach((id) => { h.act(game, id, 'accuse', { targetId: NPC }); note() })
  assert.equal(game.phase, 'defense'); assert.equal(game.trial.accusedId, NPC)
  h.fire(); note()
  ids(game).forEach((id) => h.act(game, id, 'vote', { choice: 'jail' })); note()
  assert.equal(game.phase, 'verdict'); assert.equal(game.trial.verdict.jailed, true); assert.equal(game.trial.verdict.wasKiller, true)
  assert.equal(game.status, 'playing', 'jailing the practice killer doesn’t end the game')
  assert.deepEqual(seen, PRACTICE_STEPS)
  assert.ok([...game.players.values()].every((player) => player.score === 0))
  // Without a storyteller, the real case starts by itself after the verdict.
  assert.equal(h.timers.herring.ms, PRACTICE_MS.verdict)
  h.fire()
  assertRealCase(h, game)
  assert.equal(stepOf(h, game), null)
  // The lab finished in the practice, but the real first morning has no clue.
  passNight(h, game)
  assert.equal(game.morning.clue, null)
})

test('the practice keeps short: every step has a clock, and all of it runs in under four minutes', () => {
  const h = harness(), game = practiceGame(h)
  let total = 0
  while (game.tutorial) { assert.ok(h.timers.herring, `a clock on ${game.phase}`); total += h.timers.herring.ms; h.fire() }
  assert.ok(total <= 4 * 60000, `${total} ms`)
  assertRealCase(h, game)
})

test('nobody accused twice: Mr. Kipper stands trial anyway', () => {
  const h = harness(), game = practiceGame(h)
  while (game.phase !== 'defense') h.fire()
  assert.equal(game.trial.accusedId, NPC)
})

test('a hosted practice: the storyteller paces it, and skipping deals the real case', () => {
  const h = harness(), game = practiceGame(h, { hostless: false })
  game.hostSocketId = 'tv'
  // The storyteller moves the alibi step on; the morning waits for them.
  h.api.hostAction(game, 'next', {})
  assert.equal(game.phase, 'night')
  passNight(h, game)
  assert.equal(game.phase, 'morning'); assert.equal(h.timers.herring, undefined)
  h.api.hostAction(game, 'next', {})
  assert.equal(stepOf(h, game), 'statement')
  // The grimoire shows the practice case.
  const book = h.api.grimoire(game)
  assert.equal(book.practice, true); assert.equal(book.roles[NPC], 'killer')
  // Players can't skip a hosted practice; the TV (or the controller) can.
  const phone = skipEvents(h, 's0'), tv = skipEvents(h, 'tv')
  phone.vote(game, 'p0'); phone.skip(game)
  assert.ok(game.tutorial)
  tv.skip(game)
  assertRealCase(h, game)
  // A second skip (one racing the end) does nothing.
  const cards = JSON.stringify(game.case.cards)
  tv.skip(game); h.api.endTutorial(game)
  assert.equal(JSON.stringify(game.case.cards), cards)
})

test('a hosted practice ends on the storyteller’s Next at the verdict', () => {
  const h = harness(), game = practiceGame(h, { hostless: false })
  while (game.phase !== 'verdict') { if (h.timers.herring) h.fire(); else h.api.hostAction(game, 'next', {}) }
  assert.equal(stepOf(h, game), 'done'); assert.equal(h.timers.herring, undefined, 'the verdict waits for the storyteller')
  h.api.hostAction(game, 'next', {})
  assertRealCase(h, game)
})

test('a hostless practice skips once a strict majority of connected players vote', () => {
  const h = harness(), game = practiceGame(h)
  // Get some practice onto the table first: statements, the lab, a clue.
  ids(game).forEach((id) => h.act(game, id, 'ready')); passNight(h, game); h.fire()
  ids(game).forEach((id) => h.act(game, id, 'statement', game.case.cards[id])); h.fire()
  ids(game).forEach((id) => labWork(h, game, id))
  assert.equal(game.labDone, true)
  // The TV can't skip a hostless practice, and a phone only votes for its own player.
  skipEvents(h, 'tv').skip(game)
  const phones = ids(game).map((id, i) => [id, skipEvents(h, `s${i}`)])
  phones[1][1].vote(game, phones[0][0])
  assert.ok(game.tutorial); assert.deepEqual(game.tutorial.votes, [])
  // A second tap takes a vote back.
  phones[0][1].vote(game, phones[0][0]); phones[0][1].vote(game, phones[0][0])
  assert.deepEqual(game.tutorial.votes, [])
  // 6 at the table: it takes 4.
  phones.slice(0, 3).forEach(([id, phone]) => phone.vote(game, id))
  assert.ok(game.tutorial, '3 of 6 is not a majority')
  phones[3][1].vote(game, phones[3][0])
  assertRealCase(h, game)
  passNight(h, game)
  assert.equal(game.morning.clue, null, 'the practice lab’s work doesn’t carry over')
})

test('after the practice: newcomers are dealt in, leavers are not, and too few guests go back to the lobby', () => {
  const h = harness(), game = practiceGame(h)
  // A guest arrives mid-practice: they watch, and get a real card when the case starts.
  game.players.set('late', { id: 'late', name: 'Late Guest', score: 0, socketId: 'sl' })
  assert.deepEqual(h.me(game, 'late'), { lobby: true })
  // A guest leaves for good mid-practice.
  game.players.get('p5').socketId = null
  h.api.playerLeft(game, 'p5')
  assert.ok(!game.players.has('p5'))
  while (game.tutorial) h.fire()
  assertRealCase(h, game)
  assert.ok(game.case.roles.late); assert.ok(!game.case.roles.p5)

  const h2 = harness(), small = practiceGame(h2, { players: 5, hostless: false })
  small.hostSocketId = 'tv'
  h2.api.hostAction(small, 'kickPlayer', { playerId: 'p4' })
  assert.ok(small.tutorial, 'the practice goes on')
  skipEvents(h2, 'tv').skip(small)
  assert.equal(small.status, 'lobby'); assert.equal(small.case, null); assert.equal(small.tutorial, null)
  // Once a fifth guest is back, Start goes straight to the real case.
  small.players.set('p9', { id: 'p9', name: 'Guest 9', score: 0, socketId: 's9' })
  h2.api.hostAction(small, 'start', {})
  assertRealCase(h2, small)
})

test('the practice is off unless the setup asks for it, and a replay never has one', () => {
  const h = harness(), game = newGame(h)
  assert.ok(!game.tutorial); assert.equal(game.phase, 'night')
  const h3 = harness(), replayed = practiceGame(h3, { hostless: false })
  replayed.hostSocketId = 'tv'; skipEvents(h3, 'tv').skip(replayed)
  h3.api.hostAction(replayed, 'endGame', {})
  h3.api.hostAction(replayed, 'replay', {})
  assert.equal(replayed.status, 'lobby')
  h3.api.hostAction(replayed, 'start', {})
  assert.ok(!replayed.tutorial); assert.equal(replayed.phase, 'night')
})
