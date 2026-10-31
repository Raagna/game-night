// Fib or Fact — a bluffing trivia game on clues from the Jeopardy! archive.
//
// Each clue: one player picks a category from three. Everyone reads the clue and writes a fake answer ("fib")
// meant to fool the others; the real answer, or a copy of someone else's fib, is turned away. The fibs, the real
// answer and a few "house fibs" (other answers from the same category) are shuffled together, and everyone votes
// for the one they think is the fact. Finding the fact scores points, and so does every player your fib fools.
// Points double in the second half of the game and triple on the final clue.
//
// Hosted and hostless games play the same way on the phones. With a host, the controller sees the real answer
// and every fib as it comes in (so the host can throw out a rude one), and the host paces the reveals.
//
// Practice round (the tutorial; see docs/tutorial.md): when the setup asks for it, one practice clue comes before the
// first real one. It plays through the real code (pick a category, write, vote, the reveal, the scores) on an easy
// clue, but nothing scores: the scores screen shows what each player would have won, and the totals stay at 0. The
// coach text for each step is FIB_COACH in src/fib/FibOrFact.jsx.
import { answersMatch, normalizeAnswer } from './text.js'
import { beginTutorial, setTutorialStep, endTutorial as leaveTutorial, inTutorial, skipCarried } from './tutorial.js'

export const FIB_TIMES = { pickMs: 15000, writeMs: 50000, voteMs: 25000, revealMs: 4000, factMs: 5000, scoresMs: 9000 }
export const POINTS = { fact: 1000, fooled: 500 }
const MAX_PLAYERS = 8
const MAX_CLUES = 12
export const MAX_FIB_LENGTH = 40
// House fibs top the vote up to this many choices, so a small game still has something to pick between.
const MIN_OPTIONS = 4

// ×1 for the first half, ×2 for the second and ×3 for the final clue: 7 clues → [1, 1, 1, 2, 2, 2, 3].
export function multipliers(count) {
  if (count <= 1) return [1]
  const rest = count - 1, first = Math.ceil(rest / 2)
  return [...Array(rest)].map((_, i) => (i < first ? 1 : 2)).concat(3)
}

const text = (value, max) => String(value ?? '').trim().slice(0, max)
// How an answer looks among the choices: no "(optional)" parts, quote marks or full stop, so the fact doesn't
// stand out from what players typed.
export function displayAnswer(raw) {
  const tidy = (value) => value.replace(/["“”]/g, '').replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim()
  return tidy(String(raw ?? '').replace(/\([^)]*\)/g, ' ')) || tidy(String(raw ?? '').replace(/[()]/g, ' '))
}
const sameAnswer = (a, b) => normalizeAnswer(a) === normalizeAnswer(b) || answersMatch(a, b)

function cleanClue(clue) {
  const answer = text(clue?.answer, 120)
  return {
    id: text(clue?.id, 60), category: text(clue?.category, 80) || 'Trivia', question: text(clue?.question, 600), answer, display: displayAnswer(answer),
    decoys: (Array.isArray(clue?.decoys) ? clue.decoys : []).slice(0, 6).map((decoy) => displayAnswer(text(decoy, 120))).filter(Boolean),
  }
}
// Each prompt is the (up to) three clues the chooser picks between.
function cleanConfig(config) {
  const prompts = (Array.isArray(config?.prompts) ? config.prompts : []).slice(0, MAX_CLUES)
    .map((prompt) => (Array.isArray(prompt?.choices) ? prompt.choices : []).slice(0, 3).map(cleanClue).filter((clue) => clue.question && clue.display))
    .filter((choices) => choices.length)
  if (!prompts.length) throw new Error('A game needs at least one clue.')
  return { prompts, hostless: !!config?.hostless, tutorial: !!config?.tutorial }
}

// The practice clue: three easy categories for the chooser, each with a clue nearly everyone knows, so the practice
// is about the fibbing rather than the trivia.
const practiceClue = (category, question, answer, decoys) => cleanClue({ id: `practice-${category}`, category, question, answer, decoys })
export const PRACTICE_CHOICES = [
  practiceClue('SPACE', 'Fourth from the Sun, it’s known as the Red Planet', 'Mars', ['Venus', 'Jupiter', 'Saturn']),
  practiceClue('FOOD', 'Guacamole is mostly made from this green fruit', 'avocado', ['lime', 'kiwi', 'cucumber']),
  practiceClue('ANIMALS', 'This black-and-white bear from China eats mostly bamboo', 'the giant panda', ['the polar bear', 'the koala', 'the sun bear']),
]
export const PRACTICE_STEPS = ['pick', 'write', 'vote', 'reveal', 'done']
// The coach's step, read off the practice clue's phase (the scores screen is the last step).
const practiceStep = (round) => (round?.phase === 'scores' ? 'done' : round?.phase)

export function createFibGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave, random = Math.random }) {
  const fibGame = (code) => { const game = games.get(code); return game?.kind === 'fib' ? game : undefined }
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const connected = (game) => [...game.players.values()].filter((player) => player.socketId)
  const multiplier = (game) => game.multipliers[game.index] || 1
  const optionById = (round, id) => round.options.find((option) => option.id === id)
  const votersOf = (round, id) => Object.keys(round.votes).filter((playerId) => round.votes[playerId] === id)
  const shuffle = (list) => list.map((item) => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item)
  // Numbered recent events, so the TV plays each sound once and in order (as in Survey Says!).
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: Date.now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return {
      kind: 'fib', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config,
      prompts: config.prompts, multipliers: multipliers(config.prompts.length), index: 0, round: null, pickTurn: 0, lastEvent: null,
    }
  }
  function playerJoined() {}

  function publicRound(round) {
    const finished = round.phase === 'scores'
    // A choice's authors and voters show once the reveal reaches it; everything shows on the scores screen.
    const shown = new Set(finished ? round.options.map((option) => option.id) : round.reveal.slice(0, round.step + 1))
    return {
      phase: round.phase, deadline: round.deadline, chooserId: round.chooserId,
      categories: round.choices.map((clue) => clue.category),
      clue: round.clue && { category: round.clue.category, question: round.clue.question },
      submitted: Object.keys(round.fibs), removed: Object.keys(round.removed), voted: Object.keys(round.votes),
      options: round.options.map((option) => shown.has(option.id)
        ? { id: option.id, text: option.text, fact: option.fact, house: option.house, authors: option.authors, voters: votersOf(round, option.id) }
        : { id: option.id, text: option.text }),
      reveal: round.reveal.slice(0, round.step + 1), revealCount: round.reveal.length,
      awards: finished ? round.awards : null,
    }
  }
  function publicGame(game) {
    if (inTutorial(game)) setTutorialStep(game, practiceStep(game.round))
    return {
      kind: 'fib', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      index: game.index, clueCount: game.prompts.length, multiplier: multiplier(game), multipliers: game.multipliers,
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      round: game.round && publicRound(game.round),
      serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // The fact and the fibs go only to host controllers: never to phones, and not to the TV, which everyone can see.
  function sendSecret(game, only = null) {
    const round = game.round
    if (game.hostless || !round?.clue) return
    // The practice clue's secret has index -1, so a controller never mistakes it for the first real clue's.
    const secret = { code: game.code, index: inTutorial(game) ? -1 : game.index, fact: round.clue.answer, fibs: Object.entries(round.fibs).map(([playerId, fib]) => ({ playerId, text: fib })) }
    const sockets = only ? [only] : [...(io.sockets.adapter.rooms.get(game.code) || [])].map((id) => io.sockets.sockets.get(id))
    for (const socket of sockets) if (socket?.data.controllerGame === game.code && socket.id !== game.hostSocketId) socket.emit('fib:secret', secret)
  }
  const hostJoined = (game, socket) => sendSecret(game, socket)

  // ---------- Phases and their clocks ----------
  // Picking, writing and voting are timed in every game; hosted games leave the reveals and scores to the host.
  const PHASE_TIME = { pick: 'pickMs', write: 'writeMs', vote: 'voteMs', scores: 'scoresMs' }
  function setPhase(game, phase) {
    const round = game.round
    round.phase = phase
    const ms = PHASE_TIME[phase] && (game.hostless || phase !== 'scores') ? FIB_TIMES[PHASE_TIME[phase]] : null
    round.deadline = ms ? Date.now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'fib', ms, () => { if (game.round === round && round.phase === phase && game.status === 'playing') { advance(game); emitGame(game) } })
  }
  // Moves the clue along: when its clock runs out, when the host taps Next, or (for the reveal) after each step.
  function advance(game) {
    const round = game.round
    if (round.phase === 'pick') pick(game, Math.floor(random() * round.choices.length))
    else if (round.phase === 'write') toVote(game)
    else if (round.phase === 'vote') toReveal(game)
    else if (round.phase === 'reveal') revealNext(game)
    else if (round.phase === 'scores') nextClue(game)
  }

  function startClue(game) {
    const choices = inTutorial(game) ? PRACTICE_CHOICES : game.prompts[game.index]
    game.round = { phase: 'pick', deadline: null, chooserId: null, choices, clue: null, fibs: {}, removed: {}, options: [], votes: {}, reveal: [], step: -1, awards: null }
    event(game, 'clue', { index: game.index })
    // Players take turns choosing, in the order they joined.
    const live = connected(game), chooser = choices.length > 1 && live.length ? live[game.pickTurn++ % live.length] : null
    if (!chooser) return pick(game, 0)
    game.round.chooserId = chooser.id
    setPhase(game, 'pick')
  }
  function pick(game, choice) {
    const round = game.round
    round.clue = round.choices[choice] || round.choices[0]
    event(game, 'picked', { category: round.clue.category })
    setPhase(game, 'write')
    sendSecret(game)
  }
  const everyoneIn = (game, entries) => { const live = connected(game); return live.length > 0 && live.every((player) => entries[player.id] != null) }

  function submitFib(game, playerId, raw) {
    const round = game.round
    if (game.status !== 'playing' || round?.phase !== 'write') return { ok: false, error: 'Writing time is over.' }
    if (round.fibs[playerId]) return { ok: false, error: 'Your fib is already in.' }
    const fib = displayAnswer(text(raw, MAX_FIB_LENGTH))
    if (!fib) return { ok: false, error: 'Write a fake answer first.' }
    if (answersMatch(fib, round.clue.answer)) return { ok: false, fact: true, error: 'That’s the real answer! Write a fake one that could fool everyone.' }
    if (Object.values(round.fibs).some((other) => sameAnswer(fib, other))) return { ok: false, error: 'Someone already wrote that one. Try a different fib.' }
    round.fibs[playerId] = fib
    delete round.removed[playerId]
    event(game, 'fib', { playerId })
    if (everyoneIn(game, round.fibs)) toVote(game)
    sendSecret(game)
    return { ok: true, fib }
  }

  function toVote(game) {
    const round = game.round, clue = round.clue
    const options = Object.entries(round.fibs).map(([playerId, fib]) => ({ text: fib, authors: [playerId], fact: false, house: false }))
    options.push({ text: clue.display, authors: [], fact: true, house: false })
    for (const decoy of shuffle(clue.decoys)) {
      if (options.length >= MIN_OPTIONS) break
      if (!answersMatch(decoy, clue.answer) && !options.some((option) => sameAnswer(decoy, option.text))) options.push({ text: decoy, authors: [], fact: false, house: true })
    }
    round.options = shuffle(options).map((option, i) => ({ id: `o${i}`, ...option }))
    event(game, 'vote')
    // With nothing to choose between (nobody wrote a fib and there were no house fibs), go straight to the fact.
    if (round.options.length < 2) return toReveal(game)
    setPhase(game, 'vote')
  }
  function castVote(game, playerId, optionId) {
    const round = game.round, option = round && optionById(round, optionId)
    if (game.status !== 'playing' || round.phase !== 'vote' || !option || option.authors.includes(playerId) || round.votes[playerId]) return
    round.votes[playerId] = optionId
    event(game, 'voted', { playerId })
    if (everyoneIn(game, round.votes)) toReveal(game)
  }

  function toReveal(game) {
    const round = game.round, m = multiplier(game), awards = {}
    const award = (id) => (awards[id] ||= { fact: 0, fooled: 0, fooledIds: [], points: 0 })
    for (const [voterId, optionId] of Object.entries(round.votes)) {
      const option = optionById(round, optionId)
      if (!option) continue
      if (option.fact) award(voterId).fact = POINTS.fact * m
      else for (const author of option.authors) { const a = award(author); a.fooled += POINTS.fooled * m; a.fooledIds.push(voterId) }
    }
    for (const a of Object.values(awards)) a.points = a.fact + a.fooled
    round.awards = awards
    // The fibs that fooled somebody, least popular first, and the fact last.
    const count = (option) => votersOf(round, option.id).length
    round.reveal = round.options.filter((option) => !option.fact && count(option)).sort((a, b) => count(a) - count(b)).map((option) => option.id)
      .concat(round.options.find((option) => option.fact).id)
    round.step = -1
    setPhase(game, 'reveal')
    revealNext(game)
  }
  function revealNext(game) {
    const round = game.round
    if (round.step >= round.reveal.length - 1) return toScores(game)
    round.step++
    const option = optionById(round, round.reveal[round.step])
    event(game, option.fact ? 'fact' : 'fooled', { optionId: option.id, house: option.house, voters: votersOf(round, option.id).length })
    if (game.hostless) schedule(game, 'fib', option.fact ? FIB_TIMES.factMs : FIB_TIMES.revealMs, () => { if (game.round === round && round.phase === 'reveal') { revealNext(game); emitGame(game) } })
  }
  function toScores(game) {
    const round = game.round
    // In the practice the awards are only shown (what each player would have won); the scores stay at 0.
    if (!inTutorial(game)) for (const [playerId, a] of Object.entries(round.awards || {})) { const player = game.players.get(playerId); if (player) player.score += a.points }
    event(game, 'scores')
    setPhase(game, 'scores')
  }
  function nextClue(game) {
    if (inTutorial(game)) return endTutorial(game)
    if (game.index >= game.prompts.length - 1) return finish(game)
    game.index++
    startClue(game)
  }
  function finish(game) {
    clearGameTimers(game)
    leaveTutorial(game)
    game.status = 'complete'
    if (game.round) game.round.deadline = null
    event(game, 'complete')
  }

  // The host throws out a fib. While players are still writing, its author can write another; once voting has
  // started it's taken off the choices, and anyone who voted for it votes again.
  function removeFib(game, playerId) {
    const round = game.round, fib = round?.fibs[playerId]
    if (game.status !== 'playing' || !fib || !['write', 'vote'].includes(round.phase)) return
    round.removed[playerId] = fib
    delete round.fibs[playerId]
    if (round.phase === 'vote') {
      const option = round.options.find((o) => o.authors.includes(playerId))
      if (option) {
        for (const voter of votersOf(round, option.id)) delete round.votes[voter]
        round.options = round.options.filter((o) => o !== option)
      }
    }
    event(game, 'removed', { playerId })
    sendSecret(game)
  }

  // A player left (after the reconnect grace period) or was kicked: don't keep waiting on them.
  function handOff(game, playerId) {
    const round = game.round
    if (game.status !== 'playing' || !round) return
    if (round.phase === 'pick' && round.chooserId === playerId) pick(game, Math.floor(random() * round.choices.length))
    else if (round.phase === 'write' && everyoneIn(game, round.fibs)) toVote(game)
    else if (round.phase === 'vote' && everyoneIn(game, round.votes)) toReveal(game)
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    handOff(game, playerId)
    emitGame(game)
  }

  function hostAction(game, action, payload) {
    const round = game.round, playing = game.status === 'playing' && round
    if (action === 'start' && game.status === 'lobby' && connected(game).length >= 2) {
      game.status = 'playing'; game.index = 0
      if (game.config.tutorial) beginTutorial(game, PRACTICE_STEPS)
      startClue(game)
    }
    if (action === 'pick' && playing && round.phase === 'pick') pick(game, Math.trunc(Number(payload.choice)) || 0)
    if (action === 'next' && playing) advance(game)
    // The practice is left with the skip button (or vote), not by skipping its clue.
    if (action === 'skipClue' && playing && !inTutorial(game)) nextClue(game)
    if (action === 'removeFib' && playing) removeFib(game, payload.playerId)
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
        handOff(game, player.id)
        // One fewer player can carry a vote to skip the practice.
        if (skipCarried(game)) return endTutorial(game)
      }
    }
    if (action === 'replay') {
      let prompts = game.prompts
      try { if (payload.prompts) prompts = cleanConfig({ prompts: payload.prompts }).prompts } catch {}
      clearGameTimers(game)
      leaveTutorial(game)
      // A replay goes straight to the real clues: everyone has had the practice.
      Object.assign(game, { status: 'lobby', config: { ...game.config, tutorial: false }, prompts, multipliers: multipliers(prompts.length), index: 0, round: null, pickTurn: 0, lastEvent: null })
      for (const player of game.players.values()) player.score = 0
    }
    emitGame(game)
  }

  // Out of the practice and into the first real clue, with every score at 0: after the practice clue's scores, or
  // when the host skips or the players vote to. A skip racing the end of the practice does nothing.
  function endTutorial(game) {
    if (!leaveTutorial(game)) return
    clearGameTimers(game)
    game.round = null; game.index = 0
    for (const player of game.players.values()) player.score = 0
    if (game.status === 'playing') startClue(game)
    emitGame(game)
  }

  function register(socket) {
    socket.on('fib:pick', ({ code, playerId, choice } = {}) => {
      const game = fibGame(code)
      if (!isLive(game, playerId, socket) || game.status !== 'playing' || game.round?.phase !== 'pick' || game.round.chooserId !== playerId) return
      pick(game, Math.trunc(Number(choice)) || 0); emitGame(game)
    })
    socket.on('fib:write', ({ code, playerId, fib } = {}, ack) => {
      const game = fibGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false, error: 'You’re not in this game.' })
      const result = submitFib(game, playerId, fib)
      ack?.(result)
      if (result.ok) emitGame(game)
    })
    socket.on('fib:vote', ({ code, playerId, optionId } = {}) => {
      const game = fibGame(code)
      if (!isLive(game, playerId, socket) || !game.round) return
      castVote(game, playerId, String(optionId)); emitGame(game)
    })
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, hostJoined, register, endTutorial }
}
