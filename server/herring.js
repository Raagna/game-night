// Red Herring — a detective social deduction game. The mansion's owner is found dead, the guests investigate, and
// one of the guests is the killer.
//
// Every guest gets an alibi card: where they were, what they were holding, and a mark on them. The killer's card is
// the crime. The TV shows the guest ledger, which only counts ("3 guests were in the Library"), and each guest files
// a statement of their alibi. The killer has to lie about their card, so the statements stop adding up to the
// ledger. A guest who dies or is jailed has their real card pinned up, which leaves the killer fewer lies to tell.
//
// A day: Night (the same for everyone: each phone taps a hunch, and anyone with a night role uses it) → Morning (any
// body is found, and a clue about the killer is pinned up if the lab finished its work the day before) →
// Investigation (talk, file or change statements, do lab work on the phone to fill the lab bar, accuse; the killer
// can contaminate a sample) → Trial (the most-accused guest defends themselves, then everyone votes; more than half
// of the living guests voting Jail jails them). Dead and jailed guests become ghosts: they keep doing lab work and
// keep one ghost vote.
//
// Detectives win by jailing the killer, unless the killer's Last Words name the Witness. The killer wins when the
// killer's side is as big as everyone else still free, or when the case goes cold after day 5. The Tabloid Reporter
// gets the scoop (and a win) if they are jailed.
//
// Roles and cards go only to their own phone (herring:me) and, in a hosted game, the storyteller's controller
// (herring:grimoire); never to the TV state, which everyone can see.
//
// The practice case (the tutorial; see docs/tutorial.md and "Practice case" below) plays a short made-up case first,
// with Mr. Kipper, a guest nobody plays, as its killer. It is thrown away afterwards: the real roles and cards are
// only dealt once it's over.
import { CATEGORIES, FACTS, ROLES, OPTIONAL_ROLES, DEFAULT_ROLES, MIN_PLAYERS, MAX_PLAYERS, MAX_DAYS, VICTIMS, dealCards, dealRoles, tally } from './herringCase.js'
import { beginTutorial, setTutorialStep, endTutorial as leaveTutorial } from './tutorial.js'

export const HERRING_TIMES = { nightMs: 30000, morningMs: 16000, defenseMs: 30000, voteMs: 20000, verdictMs: 10000, lastWordsMs: 30000 }
export const INVESTIGATE_LENGTHS = [120000, 180000, 240000]
// The lab needs this many finished samples in a day to pin up a clue the next morning. A contaminated sample
// takes CONTAMINATE away.
export const LAB = { base: 2, perGuest: 1.5, contaminate: 3, minSolveMs: 1500 }
export const labTarget = (guests) => Math.round(LAB.base + LAB.perGuest * guests)
const RULINGS = new Set(['next'])
const TUBES = 5, SEQUENCE = 4

// ---------- Practice case ----------
// The steps, in order: reading your alibi card, a night, the morning report, filing a statement, spotting the lie,
// one lab task, accusing, the trial, the vote, and the verdict (then the real case is dealt).
export const PRACTICE_STEPS = ['card', 'night', 'morning', 'statement', 'lie', 'lab', 'accuse', 'trial', 'vote', 'done']
// How long each part of the practice runs at most; most move on as soon as everyone has done the thing. A hosted
// game still waits for the storyteller at the morning and the verdict.
export const PRACTICE_MS = { alibi: 30000, night: 25000, morning: 12000, statement: 30000, lie: 12000, lab: 30000, accuse: 30000, defense: 10000, vote: 20000, verdict: 12000 }
// The practice killer: a guest nobody plays. Their statement is the practice's lie.
export const PRACTICE_NPC = { id: 'npc-kipper', name: 'Mr. Kipper' }
// A fixed little case, three facts of each kind. Nobody else was in the Wine Cellar, which the practice clue names,
// and Mr. Kipper says he was in the Library: so the Library has one claim too many and the Cellar one too few.
const PRACTICE_FACTS = { room: ['library', 'kitchen', 'cellar'], item: ['poker', 'teacup', 'key'], mark: ['smoke', 'mud', 'ink'] }
const PRACTICE_CRIME = { room: 'cellar', item: 'poker', mark: 'smoke' }
const PRACTICE_LIE = { room: 'library', item: 'poker', mark: 'smoke' }
const PRACTICE_ROOMS = ['library', 'kitchen']

const text = (value, max) => String(value ?? '').trim().slice(0, max)
const KILLER_SIDE = new Set(['killer', 'accomplice'])

function cleanConfig(config) {
  const roles = {}
  for (const role of Object.keys(OPTIONAL_ROLES)) roles[role] = config?.roles && Object.hasOwn(config.roles, role) ? !!config.roles[role] : DEFAULT_ROLES[role]
  const investigateMs = INVESTIGATE_LENGTHS.includes(Number(config?.investigateMs)) ? Number(config.investigateMs) : 180000
  return { hostless: !!config?.hostless, roles, investigateMs, tutorial: !!config?.tutorial }
}

export function createHerringGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave, random = Math.random, now = Date.now }) {
  const herringGame = (code) => { const game = games.get(code); return game?.kind === 'herring' ? game : undefined }
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const pick = (list) => list[Math.floor(random() * list.length)]
  const shuffle = (list) => list.map((item) => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item)
  const roleOf = (game, id) => game.case?.roles[id]
  const fate = (game, id) => game.fates?.[id] || 'alive'
  const free = (game, id) => game.case?.roles[id] && fate(game, id) === 'alive'
  const ghost = (game, id) => ['dead', 'jailed'].includes(fate(game, id))
  const freeIds = (game) => Object.keys(game.case?.roles || {}).filter((id) => free(game, id))
  const liveFree = (game) => freeIds(game).filter((id) => game.players.get(id)?.socketId)
  const killerSide = (game, id) => KILLER_SIDE.has(roleOf(game, id))
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }
  // Something on a phone's or the controller's private view changed: they fetch it again when this goes up.
  const touch = (game) => { game.privateRev = (game.privateRev || 0) + 1 }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return {
      kind: 'herring', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config,
      victim: pick(VICTIMS), case: null, fates: {}, day: 0, phase: null, deadline: null, lastEvent: null, privateRev: 0,
    }
  }
  function playerJoined() {}
  // Once the case is dealt, nobody new can join: there's no card or role for them. The practice case doesn't count:
  // a guest who arrives during it watches, and is dealt in when the real case starts.
  const maxPlayers = (game) => (game.status === 'lobby' || game.tutorial ? MAX_PLAYERS : game.players.size)
  const rulingTurn = (game) => (game.status === 'playing' ? `${game.day}:${game.phase}${game.tutorial ? `:${game.practice?.stage || ''}` : ''}` : null)

  // ---------- Public view (the TV and everyone's Board tab) ----------
  function publicGame(game) {
    if (game.tutorial) setTutorialStep(game, practiceStep(game))
    const c = game.case, done = game.status === 'complete'
    const out = Object.keys(c?.roles || {}).filter((id) => ghost(game, id) || fate(game, id) === 'gone')
    const trial = game.trial
    const verdictShown = trial?.verdict
    return {
      kind: 'herring', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      config: { investigateMs: game.config.investigateMs, roles: game.config.roles, tutorial: game.config.tutorial },
      victim: game.victim, day: game.day, maxDays: MAX_DAYS, phase: game.phase, deadline: game.deadline,
      players: [
        ...[...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId, fate: c ? fate(game, player.id) : 'alive', ghostVote: !!c && ghost(game, player.id) && !game.ghostVotesUsed?.[player.id] })),
        // The practice killer sits at the table like any guest, but nobody plays them.
        ...(game.tutorial && c?.roles[PRACTICE_NPC.id] ? [{ id: PRACTICE_NPC.id, name: PRACTICE_NPC.name, score: 0, npc: true, connected: true, fate: fate(game, PRACTICE_NPC.id), ghostVote: false }] : []),
      ],
      names: c?.names || null,
      ledger: c ? tally(c.values, c.cards) : null,
      inPlay: c ? c.values : null,
      rolesInPlay: c ? [...new Set(Object.values(c.roles))].filter((role) => role !== 'detective').sort() : null,
      statements: game.statements || {},
      // A ghost's real card is pinned up next to their statement.
      pinned: c ? Object.fromEntries((done ? Object.keys(c.cards) : out).map((id) => [id, c.cards[id]])) : {},
      clues: (game.clues || []).map(({ framed, ...clue }) => clue),
      morning: game.morning || null,
      hunches: game.hunchBoard || null,
      lab: game.lab ? { count: game.lab.count, target: game.lab.target, solved: game.lab.solved } : null,
      // How many have finished tonight: a count, never who.
      night: game.phase === 'night' && game.night ? { done: liveFree(game).filter((id) => game.night.actions[id]?.hunch).length, of: liveFree(game).length } : null,
      accusations: game.accusations || {},
      trial: trial ? {
        accusedId: trial.accusedId, voted: Object.keys(trial.votes),
        votes: verdictShown ? trial.votes : null, verdict: trial.verdict || null, lastWords: trial.lastWords || null,
      } : null,
      outcome: game.outcome || null,
      reveal: done && c ? { roles: c.roles, crime: c.crime, frames: (game.clues || []).filter((clue) => clue.framed).map((clue) => clue.day) } : null,
      // The practice case's progress (null in the real case): who has read their card, who has tried the lab.
      practice: game.tutorial && game.practice ? { stage: game.practice.stage, ready: Object.keys(game.practice.ready), tried: Object.keys(game.practice.tried), npcId: PRACTICE_NPC.id } : null,
      serverNow: now(), lastEvent: game.lastEvent, events: game.recentEvents || [], privateRev: game.privateRev,
    }
  }

  // ---------- Private views ----------
  function nightAsk(game, id) {
    const role = roleOf(game, id)
    if (game.phase !== 'night' || !free(game, id)) return null
    const action = game.night.actions[id] || {}
    const ask = { done: !!action.hunch, hunch: action.hunch || null, target: action.target || null, frame: action.frame || null }
    if (role === 'killer') return { ...ask, kind: game.day >= 2 ? 'kill' : 'case', canFrame: !game.frameUsed }
    if (role === 'officer') return { ...ask, kind: 'protect', notSame: game.lastProtected || null }
    if (role === 'forensics' || role === 'rookie') return { ...ask, kind: 'inspect' }
    return { ...ask, kind: 'none' }
  }
  function privateView(game, id) {
    const c = game.case, role = roleOf(game, id)
    if (!c || !role) return { lobby: true }
    const shownRole = role === 'rookie' ? 'forensics' : role
    const partner = role === 'killer' ? c.accompliceId : role === 'accomplice' ? c.killerId : null
    const canTaint = game.phase === 'investigate' && free(game, id) && killerSide(game, id) && game.lab && !game.lab.tainted[id]
    return {
      practice: !!game.tutorial,
      role: shownRole, team: ROLES[role].team, card: c.cards[id], partnerId: partner,
      crime: killerSide(game, id) ? c.crime : null,
      notes: c.notes[id] || [],
      night: nightAsk(game, id),
      task: game.phase === 'investigate' ? game.tasks?.[id] && publicTask(game.tasks[id]) : null,
      canContaminate: !!canTaint,
      accused: game.accusations?.[id] || null,
      vote: game.trial?.votes[id] || null,
    }
  }
  function grimoire(game) {
    const c = game.case
    if (!c) return { lobby: true }
    return {
      practice: !!game.tutorial,
      roles: c.roles, cards: c.cards, crime: c.crime, notes: c.notes,
      night: game.phase === 'night' ? game.night.actions : null,
      rookie: game.phase === 'night' && game.night.rookieLie !== undefined ? game.night.rookieLie : null,
      frameUsed: !!game.frameUsed, lastProtected: game.lastProtected || null,
      tainted: game.lab ? Object.keys(game.lab.tainted) : [],
      framedDays: (game.clues || []).filter((clue) => clue.framed).map((clue) => clue.day),
    }
  }

  // ---------- Phases ----------
  const PHASE_MS = { night: () => HERRING_TIMES.nightMs, morning: () => HERRING_TIMES.morningMs, investigate: (game) => game.config.investigateMs, defense: () => HERRING_TIMES.defenseMs, vote: () => HERRING_TIMES.voteMs, verdict: () => HERRING_TIMES.verdictMs, lastWords: () => HERRING_TIMES.lastWordsMs }
  // A hosted game waits for the storyteller to read the morning and the verdict aloud.
  const HOST_PACED = new Set(['morning', 'verdict'])
  // The practice case runs on its own shorter clocks (its investigation on its stages' clocks: see toStage).
  const phaseMs = (game, phase) => (!game.hostless && HOST_PACED.has(phase) ? null : game.tutorial ? PRACTICE_MS[phase] : PHASE_MS[phase](game))
  function setPhase(game, phase) {
    game.phase = phase
    const ms = phaseMs(game, phase)
    game.deadline = ms ? now() + ms : null
    clearGameTimers(game)
    const day = game.day
    if (ms) schedule(game, 'herring', ms, () => { if (game.status === 'playing' && game.phase === phase && game.day === day) { advance(game); emitGame(game) } })
    touch(game)
  }
  function advance(game) {
    if (game.tutorial) {
      if (game.phase === 'alibi') return toNight(game)
      if (game.phase === 'investigate') return nextStage(game)
      if (game.phase === 'verdict') return endTutorial(game)
    }
    if (game.phase === 'night') return toMorning(game)
    if (game.phase === 'morning') return toInvestigation(game)
    if (game.phase === 'investigate') return toTrial(game)
    if (game.phase === 'defense') return toVote(game)
    if (game.phase === 'vote') return toVerdict(game)
    if (game.phase === 'verdict') return afterVerdict(game)
    if (game.phase === 'lastWords') return lastWords(game, null)
  }

  // The guests to deal in: the connected ones; anyone who left before the deal is no longer part of the party. After
  // the practice, everyone still at the table is dealt in, including a phone that's only briefly away.
  function seat(game, { everyone = false } = {}) {
    const ids = [...game.players.values()].filter((player) => everyone || player.socketId).map((player) => player.id)
    if (ids.length < MIN_PLAYERS) return null
    for (const id of [...game.players.keys()]) if (!ids.includes(id)) game.players.delete(id)
    return ids
  }
  // A clear table: no case, nobody dead, nothing filed or pinned up.
  function clearCase(game) {
    Object.assign(game, {
      case: null, fates: {}, day: 0, phase: null, deadline: null, night: null, statements: {}, clues: [], morning: null, hunchBoard: null,
      lab: null, labDone: false, tasks: {}, trial: null, accusations: {}, ghostVotesUsed: {}, outcome: null, scoopId: null,
      frameId: null, frameSpent: false, frameUsed: false, lastProtected: null, recentEvents: [],
    })
  }
  // Deals the real case: fresh roles and alibi cards. Returns false if there are too few guests.
  function start(game, options) {
    const ids = seat(game, options)
    if (!ids) return false
    const roles = dealRoles(ids, game.config.roles, random)
    const killerId = ids.find((id) => roles[id] === 'killer')
    const { values, crime, cards } = dealCards(ids, killerId, random)
    const notes = Object.fromEntries(ids.map((id) => [id, []]))
    const witnessId = ids.find((id) => roles[id] === 'witness'), seen = pick(CATEGORIES)
    if (witnessId) notes[witnessId].push({ day: 0, type: 'witness', category: seen, value: crime[seen] })
    game.case = {
      roles, cards, values, crime, notes, killerId, accompliceId: ids.find((id) => roles[id] === 'accomplice') || null,
      names: Object.fromEntries(ids.map((id) => [id, game.players.get(id).name])),
    }
    Object.assign(game, {
      status: 'playing', fates: {}, day: 0, statements: {}, clues: [], accusations: {}, ghostVotesUsed: {},
      lab: null, tasks: {}, trial: null, morning: null, hunchBoard: null, outcome: null, frameUsed: false, lastProtected: null,
    })
    toNight(game)
    return true
  }

  // ---------- Practice case (the tutorial) ----------
  // Everyone at the table is a Detective with a made-up alibi card, and Mr. Kipper (nobody's) is the killer. No real
  // role or card exists until the practice is over.
  function startPractice(game) {
    const ids = seat(game)
    if (!ids) return
    const roles = {}, cards = {}, npc = PRACTICE_NPC.id
    ids.forEach((id, i) => {
      roles[id] = 'detective'
      cards[id] = { room: PRACTICE_ROOMS[i % PRACTICE_ROOMS.length], item: PRACTICE_FACTS.item[i % 3], mark: PRACTICE_FACTS.mark[(i + 1) % 3] }
    })
    roles[npc] = 'killer'; cards[npc] = { ...PRACTICE_CRIME }
    clearCase(game)
    game.case = {
      practice: true, roles, cards, values: structuredClone(PRACTICE_FACTS), crime: { ...PRACTICE_CRIME },
      notes: Object.fromEntries([...ids, npc].map((id) => [id, []])), killerId: npc, accompliceId: null,
      names: { ...Object.fromEntries(ids.map((id) => [id, game.players.get(id).name])), [npc]: PRACTICE_NPC.name },
    }
    game.status = 'playing'
    game.practice = { stage: null, ready: {}, tried: {} }
    beginTutorial(game, PRACTICE_STEPS)
    event(game, 'practice')
    setPhase(game, 'alibi')
  }
  // The coach's step, read off the state so it always matches the screens.
  function practiceStep(game) {
    if (game.phase === 'investigate') return game.practice?.stage || 'statement'
    return { alibi: 'card', night: 'night', morning: 'morning', defense: 'trial', vote: 'vote', verdict: 'done' }[game.phase] || 'card'
  }
  // The practice investigation, a stage at a time: statements, a look at the lie, the lab, then accusations.
  function toStage(game, stage) {
    game.practice.stage = stage
    const ms = PRACTICE_MS[stage]
    game.deadline = now() + ms
    schedule(game, 'herring', ms, () => { if (game.tutorial && game.phase === 'investigate' && game.practice?.stage === stage) { advance(game); emitGame(game) } })
    touch(game)
    practiceProgress(game)
  }
  function nextStage(game) {
    const next = { statement: 'lie', lie: 'lab', lab: 'accuse' }[game.practice.stage]
    if (next) return toStage(game, next)
    // Somebody always stands trial in the practice: the most-accused guest, or else Mr. Kipper.
    toTrial(game, mostAccused(game) ? null : PRACTICE_NPC.id)
  }
  // Moves the practice on as soon as every guest at the table has done what this step asks.
  function practiceProgress(game) {
    if (!game.tutorial || game.status !== 'playing') return
    const live = liveFree(game), p = game.practice
    if (game.phase === 'alibi' && live.every((id) => p.ready[id])) return toNight(game)
    if (game.phase !== 'investigate') return
    if (p.stage === 'statement' && live.every((id) => game.statements[id])) return toStage(game, 'lie')
    if (p.stage === 'lab' && live.every((id) => p.tried[id])) return toStage(game, 'accuse')
    if (p.stage === 'accuse' && live.every((id) => game.accusations[id])) return nextStage(game)
  }
  function practiceReady(game, id) {
    if (!game.tutorial || game.phase !== 'alibi' || !free(game, id) || game.practice.ready[id]) return false
    game.practice.ready[id] = true
    return true
  }
  // Out of the practice and into the real case: the practice case is thrown away and fresh roles and cards are
  // dealt. With too few guests left to deal, back to the lobby.
  function endTutorial(game) {
    if (!leaveTutorial(game)) return
    clearGameTimers(game)
    game.practice = null
    game.config.tutorial = false
    clearCase(game)
    game.status = 'lobby'
    if (!start(game, { everyone: true })) touch(game)
    emitGame(game)
  }

  function toNight(game) {
    game.day++
    game.night = { actions: {} }
    game.accusations = {}
    game.trial = null
    event(game, 'night', { day: game.day })
    setPhase(game, 'night')
    // The Rookie's report: a hosted game lets the storyteller choose it (see hostAction 'rookie').
    if (!game.hostless && Object.values(game.case.roles).includes('rookie')) game.night.rookieLie = null
  }
  const nightDone = (game) => liveFree(game).every((id) => game.night.actions[id]?.hunch)

  function nightAct(game, id, data) {
    if (game.status !== 'playing' || game.phase !== 'night' || !free(game, id)) return false
    const role = roleOf(game, id), action = game.night.actions[id] ||= {}
    const target = text(data.target, 12), hunch = text(data.hunch, 12), frame = text(data.frame, 12)
    const valid = (other) => other && other !== id && free(game, other)
    if (data.target !== undefined) {
      if (data.target === null) delete action.target
      else if (role === 'killer' && game.day >= 2 && valid(target)) action.target = target
      else if (role === 'officer' && valid(target) && target !== game.lastProtected) action.target = target
      else if ((role === 'forensics' || role === 'rookie') && valid(target)) action.target = target
      else return false
    }
    if (data.frame !== undefined && role === 'killer' && !game.frameUsed) {
      if (data.frame === null) delete action.frame
      else if (valid(frame) && !killerSide(game, frame)) action.frame = frame
    }
    if (data.hunch !== undefined && valid(hunch)) action.hunch = hunch
    touch(game)
    if (nightDone(game)) toMorning(game)
    return true
  }

  // The morning: who died (or nearly did), the lab's clue, and each role's private findings.
  function toMorning(game) {
    const c = game.case, actions = game.night.actions
    const byRole = (role) => Object.keys(actions).find((id) => roleOf(game, id) === role && free(game, id))
    const killerId = c.killerId, attack = free(game, killerId) ? actions[killerId]?.target : null
    const officerId = byRole('officer'), guarded = officerId ? actions[officerId]?.target : null
    game.lastProtected = guarded || null
    const morning = { day: game.day, victimId: null, room: null, foiled: false, clue: null, first: game.day === 1 }
    if (attack && free(game, attack)) {
      if (attack === guarded) { morning.foiled = true; morning.savedId = attack }
      else { game.fates[attack] = 'dead'; morning.victimId = attack; morning.room = c.cards[attack].room }
    }
    if (actions[killerId]?.frame && !game.frameUsed) { game.frameUsed = true; game.frameId = actions[killerId].frame }
    // A clue when the lab finished yesterday, and a free one when the Officer foiled an attack.
    const clues = (game.labDone ? 1 : 0) + (morning.foiled ? 1 : 0)
    for (let i = 0; i < clues; i++) { const clue = drawClue(game); if (clue) morning.clue = clue }
    // The practice morning pins up a clue straight away, so the lie can be spotted.
    if (game.tutorial) { morning.clue = { day: game.day, category: 'room', value: c.crime.room }; game.clues.push(morning.clue) }
    game.labDone = false
    // Private findings.
    for (const [id, action] of Object.entries(actions)) {
      const role = roleOf(game, id)
      if ((role === 'forensics' || role === 'rookie') && action.target) c.notes[id].push(inspect(game, id, action.target, role === 'rookie'))
    }
    const coroner = Object.keys(c.roles).find((id) => c.roles[id] === 'coroner' && free(game, id))
    if (coroner) {
      const known = new Set(c.notes[coroner].filter((note) => note.type === 'coroner').map((note) => note.targetId))
      for (const id of Object.keys(c.roles)) if (ghost(game, id) && !known.has(id)) c.notes[coroner].push({ day: game.day, type: 'coroner', targetId: id, role: c.roles[id] })
    }
    const informant = Object.keys(c.roles).find((id) => c.roles[id] === 'informant' && free(game, id))
    if (informant) {
      const others = freeIds(game).filter((id) => id !== informant)
      const innocent = shuffle(others.filter((id) => !killerSide(game, id)))[0]
      const other = shuffle(others.filter((id) => id !== innocent))[0]
      if (innocent && other) c.notes[informant].push({ day: game.day, type: 'tip', ids: shuffle([innocent, other]) })
    }
    // The room's hunches, most suspected first.
    const counts = {}
    for (const action of Object.values(actions)) if (action.hunch) counts[action.hunch] = (counts[action.hunch] || 0) + 1
    game.hunchBoard = Object.entries(counts).map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 3)
    game.morning = morning
    event(game, morning.victimId ? 'body' : morning.foiled ? 'foiled' : morning.first ? 'body' : 'quiet', { day: game.day })
    if (morning.clue) event(game, 'clue', { category: morning.clue.category })
    setPhase(game, 'morning')
    checkWin(game)
  }
  // Forensics learns one true fact about a guest, a new one each time if there is one. The Rookie's report is often
  // wrong: the storyteller's pick in a hosted game, a coin toss otherwise.
  function inspect(game, id, targetId, rookie) {
    const c = game.case, seen = new Set(c.notes[id].filter((note) => note.targetId === targetId).map((note) => note.category))
    const category = pick(CATEGORIES.filter((cat) => !seen.has(cat)).length ? CATEGORIES.filter((cat) => !seen.has(cat)) : CATEGORIES)
    let value = c.cards[targetId][category]
    if (rookie) {
      const lie = game.night.rookieLie
      const wrong = c.values[category].filter((v) => v !== value)
      if (lie && lie !== 'truth' && c.values[lie.category]?.includes(lie.value)) return { day: game.day, type: 'inspect', targetId, category: lie.category, value: lie.value }
      if (lie !== 'truth' && (game.hostless || lie == null) && random() < 0.5 && wrong.length) value = pick(wrong)
    }
    return { day: game.day, type: 'inspect', targetId, category, value }
  }
  // The next clue: one of the crime's facts not pinned up yet, or, once all three are up, a guest the lab clears.
  // A frame swaps the next fact clue for one of the framed guest's facts that isn't the killer's.
  function drawClue(game) {
    const c = game.case, open = CATEGORIES.filter((category) => !game.clues.some((clue) => clue.category === category))
    let clue
    if (open.length) {
      const framed = game.frameId && !game.frameSpent ? open.filter((category) => c.cards[game.frameId][category] !== c.crime[category]) : []
      if (framed.length) { const category = pick(framed); clue = { day: game.day, category, value: c.cards[game.frameId][category], framed: true }; game.frameSpent = true }
      else { const category = pick(open); clue = { day: game.day, category, value: c.crime[category] } }
    } else {
      const cleared = new Set(game.clues.filter((clue) => clue.category === 'cleared').map((clue) => clue.value))
      const id = pick(freeIds(game).filter((id) => !killerSide(game, id) && !cleared.has(id)))
      if (!id) return null
      clue = { day: game.day, category: 'cleared', value: id }
    }
    game.clues.push(clue)
    return clue
  }

  // ---------- Investigation ----------
  function toInvestigation(game) {
    game.lab = { count: 0, target: labTarget(Object.keys(game.case.roles).length), tainted: {}, solved: false }
    game.tasks = {}
    for (const id of Object.keys(game.case.roles)) if (fate(game, id) !== 'gone') game.tasks[id] = newTask(game)
    event(game, 'investigate', { day: game.day })
    setPhase(game, 'investigate')
    if (game.tutorial) {
      // One sample each fills the practice lab, and Mr. Kipper's statement is already on the board.
      game.lab.target = Math.max(1, liveFree(game).length)
      game.statements[PRACTICE_NPC.id] = { ...PRACTICE_LIE, changes: 0, day: game.day }
      toStage(game, 'statement')
    }
  }
  // Lab work: match a fingerprint to one of four, or repeat the order the sample tubes lit up in.
  function newTask(game) {
    game.taskSeq = (game.taskSeq || 0) + 1
    const id = `t${game.taskSeq}`, issued = now()
    if (random() < 0.5) {
      const seeds = new Set()
      while (seeds.size < 4) seeds.add(1 + Math.floor(random() * 9999))
      const options = [...seeds], answer = Math.floor(random() * 4)
      return { id, type: 'print', target: options[answer], options, answer, issued }
    }
    const order = []
    while (order.length < SEQUENCE) { const tube = Math.floor(random() * TUBES); if (tube !== order.at(-1)) order.push(tube) }
    return { id, type: 'tubes', tubes: TUBES, order, answer: order, issued }
  }
  const publicTask = ({ answer, issued, ...task }) => task
  function solve(game, id, taskId, answer) {
    const task = game.tasks?.[id]
    if (game.status !== 'playing' || game.phase !== 'investigate' || !task || task.id !== taskId || fate(game, id) === 'gone') return { ok: false }
    if (game.tutorial) game.practice.tried[id] = true
    const right = task.type === 'print' ? Number(answer) === task.answer : Array.isArray(answer) && answer.length === task.answer.length && answer.every((tube, i) => Number(tube) === task.answer[i])
    // Quicker than a person can do it is a script, not lab work.
    const tooQuick = now() - task.issued < LAB.minSolveMs
    game.tasks[id] = newTask(game)
    touch(game)
    if (!right || tooQuick) return { ok: true, right: false }
    const lab = game.lab
    lab.count = Math.min(lab.target, lab.count + 1)
    event(game, 'sample', { count: lab.count })
    if (lab.count >= lab.target && !lab.solved) { lab.solved = true; game.labDone = true; event(game, 'labDone') }
    return { ok: true, right: true }
  }
  function contaminate(game, id) {
    const lab = game.lab
    if (game.phase !== 'investigate' || !free(game, id) || !killerSide(game, id) || !lab || lab.tainted[id]) return false
    lab.tainted[id] = true
    lab.count = Math.max(0, lab.count - LAB.contaminate)
    if (lab.solved && lab.count < lab.target) { lab.solved = false; game.labDone = false }
    event(game, 'contaminated')
    touch(game)
    return true
  }
  // A statement: the alibi a guest says is theirs. It can be changed during the investigation, and everyone sees
  // that it was.
  function fileStatement(game, id, data) {
    if (game.status !== 'playing' || game.phase !== 'investigate' || !free(game, id)) return false
    const c = game.case, claim = {}
    for (const category of CATEGORIES) { const value = text(data?.[category], 20); if (!c.values[category].includes(value)) return false; claim[category] = value }
    const before = game.statements[id]
    if (before && CATEGORIES.every((category) => before[category] === claim[category])) return false
    game.statements[id] = { ...claim, changes: before ? before.changes + 1 : 0, day: game.day }
    event(game, before ? 'changed' : 'statement', { playerId: id })
    return true
  }
  function accuse(game, id, targetId) {
    if (game.status !== 'playing' || game.phase !== 'investigate' || !free(game, id)) return false
    if (targetId == null) { delete game.accusations[id]; return true }
    const target = text(targetId, 12)
    if (target === id || !free(game, target) || game.accusations[id] === target) return false
    game.accusations[id] = target
    event(game, 'accuse', { playerId: id, targetId: target })
    return true
  }

  // ---------- Trial ----------
  // The most-accused guest stands trial, if two or more guests accused them (ties go to whoever got there first).
  function mostAccused(game) {
    const counts = new Map()
    for (const [accuser, accused] of Object.entries(game.accusations)) if (free(game, accuser) && free(game, accused)) counts.set(accused, (counts.get(accused) || 0) + 1)
    const order = Object.values(game.accusations)
    return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0] || null
  }
  function toTrial(game, forcedId = null) {
    game.tasks = {}
    const accusedId = forcedId && free(game, forcedId) ? forcedId : mostAccused(game)
    game.trial = { accusedId: accusedId || null, votes: {}, verdict: null }
    if (!accusedId) { game.trial.verdict = { none: true }; event(game, 'noTrial'); return setPhase(game, 'verdict') }
    event(game, 'trial', { playerId: accusedId })
    setPhase(game, 'defense')
  }
  function toVote(game) { event(game, 'vote'); setPhase(game, 'vote') }
  function castVote(game, id, choice) {
    const trial = game.trial
    if (game.phase !== 'vote' || !trial || trial.votes[id] || !['jail', 'release'].includes(choice)) return false
    if (free(game, id)) trial.votes[id] = choice
    else if (ghost(game, id) && !game.ghostVotesUsed[id]) { trial.votes[id] = choice; trial.ghosts = [...(trial.ghosts || []), id]; game.ghostVotesUsed[id] = true }
    else return false
    event(game, 'voted', { playerId: id })
    if (liveFree(game).every((other) => trial.votes[other])) toVerdict(game)
    return true
  }
  function toVerdict(game) {
    const trial = game.trial, votes = Object.values(trial.votes)
    const jail = votes.filter((v) => v === 'jail').length, release = votes.length - jail
    const jailed = jail > freeIds(game).length / 2
    trial.verdict = { jail, release, jailed, needed: Math.floor(freeIds(game).length / 2) + 1, ghosts: trial.ghosts || [] }
    if (jailed) {
      const role = roleOf(game, trial.accusedId)
      game.fates[trial.accusedId] = 'jailed'
      trial.verdict.wasKiller = role === 'killer'
      if (role === 'reporter') { game.scoopId = trial.accusedId; trial.verdict.scoop = true }
      event(game, role === 'killer' ? 'caught' : 'jailed', { playerId: trial.accusedId })
    } else event(game, 'released', { playerId: trial.accusedId })
    setPhase(game, 'verdict')
  }
  function afterVerdict(game) {
    const verdict = game.trial?.verdict
    if (verdict?.wasKiller) {
      // Last Words: the jailed killer names the Witness, if there is one, to steal the win.
      if (Object.values(game.case.roles).includes('witness')) { event(game, 'lastWords'); return setPhase(game, 'lastWords') }
      return finish(game, 'detectives', 'jailed')
    }
    if (checkWin(game)) return
    if (game.day >= MAX_DAYS) return finish(game, 'killer', 'cold')
    toNight(game)
  }
  function lastWords(game, guessId) {
    const trial = game.trial
    if (game.phase !== 'lastWords' || !trial) return false
    const right = !!guessId && roleOf(game, guessId) === 'witness'
    trial.lastWords = { guessId: guessId || null, right }
    finish(game, right ? 'killer' : 'detectives', right ? 'lastWords' : 'jailed')
    return true
  }
  // The killer's side wins once it's as big as everyone else still free.
  function checkWin(game) {
    if (game.status !== 'playing') return true
    if (game.tutorial) return false
    const ids = freeIds(game), bad = ids.filter((id) => killerSide(game, id)).length
    if (!free(game, game.case.killerId)) return false
    if (bad >= ids.length - bad) { finish(game, 'killer', 'parity'); return true }
    return false
  }
  function finish(game, winner, reason) {
    clearGameTimers(game)
    game.status = 'complete'
    game.deadline = null
    game.outcome = { winner, reason, killerId: game.case.killerId, accompliceId: game.case.accompliceId, scoopId: game.scoopId || null }
    event(game, 'complete', { winner })
    touch(game)
  }

  // ---------- Leaving ----------
  // A guest who leaves for good (or is kicked) is out of the game; a killer who runs off hands the detectives the win.
  function remove(game, id) {
    if (game.status !== 'playing' || !game.case?.roles[id]) return
    if (free(game, id)) game.fates[id] = 'gone'
    delete game.accusations[id]
    if (id === game.case.killerId && fate(game, id) === 'gone') return finish(game, 'detectives', 'fled')
    if (game.phase === 'night' && nightDone(game)) return toMorning(game)
    if (game.phase === 'vote' && liveFree(game).every((other) => game.trial.votes[other])) return toVerdict(game)
    if (game.phase === 'defense' && game.trial?.accusedId === id) return toVerdict(game)
    checkWin(game)
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    if (game.status === 'lobby') game.players.delete(playerId)
    else if (game.tutorial) {
      // Gone for good during the practice: out of the party, so they aren't dealt into the real case.
      game.players.delete(playerId)
      if (free(game, playerId)) game.fates[playerId] = 'gone'
      if (game.phase === 'night' && nightDone(game)) toMorning(game)
      else if (game.phase === 'vote' && liveFree(game).every((other) => game.trial.votes[other])) toVerdict(game)
      else practiceProgress(game)
    } else if (game.phase === 'night' && free(game, playerId) && nightDone(game)) toMorning(game)
    emitGame(game)
  }

  function hostAction(game, action, payload) {
    const playing = game.status === 'playing'
    if (action === 'start' && game.status === 'lobby') { if (game.config.tutorial) startPractice(game); else start(game) }
    // Without a storyteller the practice runs itself, and only the players' vote skips it.
    if (action === 'next' && playing && !(game.tutorial && game.hostless)) advance(game)
    if (action === 'putOnTrial' && playing && game.phase === 'investigate') toTrial(game, text(payload.playerId, 12))
    if (action === 'rookie' && playing && game.phase === 'night' && game.night.rookieLie !== undefined) {
      const lie = payload.lie === 'truth' ? 'truth' : payload.lie && CATEGORIES.includes(payload.lie.category) && game.case.values[payload.lie.category].includes(payload.lie.value) ? { category: payload.lie.category, value: payload.lie.value } : null
      game.night.rookieLie = lie
      touch(game)
    }
    if (action === 'endGame' && playing && !game.tutorial) finish(game, null, 'ended')
    if (action === 'renamePlayer') {
      const player = game.players.get(payload.playerId), name = text(payload.name, 20)
      if (player && name) { player.name = name; if (game.case?.names[player.id]) game.case.names[player.id] = name }
    }
    if (action === 'kickPlayer') {
      const player = game.players.get(payload.playerId)
      if (player) {
        cancelLeave(game.code, player.id)
        const socket = io.sockets.sockets.get(player.socketId)
        socket?.leave(game.code); socket?.emit('player:kicked')
        game.players.delete(player.id)
        remove(game, player.id)
        practiceProgress(game)
      }
    }
    if (action === 'replay' && game.status === 'complete') {
      clearGameTimers(game)
      for (const [id, player] of game.players) if (!player.socketId) game.players.delete(id)
      clearCase(game)
      // A replay goes straight to the case: this table has had its practice.
      Object.assign(game, { status: 'lobby', victim: pick(VICTIMS) })
      game.config.tutorial = false
      touch(game)
    }
    emitGame(game)
  }

  function register(socket) {
    // A phone's own role, card, notes and current task; asked for again whenever privateRev goes up.
    socket.on('herring:me', ({ code, playerId } = {}, ack) => {
      const game = herringGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false })
      ack?.({ ok: true, rev: game.privateRev, ...privateView(game, playerId) })
    })
    // The storyteller's grimoire: every role, card and night action. Only for a hosted game's controller.
    socket.on('herring:grimoire', ({ code } = {}, ack) => {
      const game = herringGame(code)
      if (!game || game.hostless || socket.data.controllerGame !== code || socket.id === game.hostSocketId) return ack?.({ ok: false })
      ack?.({ ok: true, rev: game.privateRev, ...grimoire(game) })
    })
    socket.on('herring:act', ({ code, playerId, action, payload } = {}, ack) => {
      const game = herringGame(code), data = payload && typeof payload === 'object' ? payload : {}
      if (!isLive(game, playerId, socket) || game.status !== 'playing') return ack?.({ ok: false })
      let changed = false, reply = { ok: true }
      if (action === 'night') changed = nightAct(game, playerId, data)
      else if (action === 'statement') changed = fileStatement(game, playerId, data)
      else if (action === 'accuse') changed = accuse(game, playerId, data.targetId ?? null)
      else if (action === 'solve') { reply = solve(game, playerId, String(data.taskId || ''), data.answer); changed = reply.ok }
      else if (action === 'contaminate') changed = contaminate(game, playerId)
      else if (action === 'vote') changed = castVote(game, playerId, data.choice)
      else if (action === 'lastWords') changed = game.phase === 'lastWords' && playerId === game.case.killerId && lastWords(game, text(data.guessId, 12) || null)
      else if (action === 'ready') changed = practiceReady(game, playerId)
      if (changed && game.tutorial) practiceProgress(game)
      ack?.({ ...reply, ok: reply.ok && changed !== false })
      if (changed) emitGame(game)
    })
  }

  return { MAX_PLAYERS, RULINGS, rulingTurn, maxPlayers, makeGame, publicGame, playerJoined, playerLeft, hostAction, hostJoined: () => {}, register, privateView, grimoire, endTutorial }
}
