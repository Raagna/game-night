// Spin & Solve — a word-puzzle game in the style of Wheel of Fortune.
//
// Each round is a hidden phrase. The contestant in control spins the wheel and calls a consonant, which
// earns the spin's value for every time it appears; then they can spin again, buy a vowel for $250 or
// solve. Landing on Bankrupt empties their round bank; Bankrupt, Lose a Turn, a letter that isn't in the
// puzzle, a wrong solve or running out of time passes control to the next contestant. Solving banks the
// round (at least $1,000); everyone else's round bank is lost.
//
// The server picks where every spin lands and only applies it once the wheel has stopped on the TV, so
// all screens agree and no phone can fake a spin. The solution never goes out with the game state:
// phones get the board with unrevealed letters blank, and only the host controller is sent the answer.
// Solves are typed as the missing letters ("fill in the blanks") and checked exactly, like the show's
// "read it exactly as written". In hosted games the host can also judge a solve said out loud.
import { layoutPuzzle, puzzleProblem, normalizePuzzle, letterCounts, isLetter, isVowel, CONSONANTS, VOWELS } from './wheelBoard.js'

export const WHEEL_TIMES = { decideMs: 10000, letterMs: 10000, solveMs: 20000, spinMs: 5200, roundEndMs: 9000 }
// Relaxed pace doubles the clocks people play against (not the spin or the pause between rounds).
const RELAXED = new Set(['decideMs', 'letterMs', 'solveMs'])
const MAX_PLAYERS = 6
const MAX_ROUNDS = 5
export const VOWEL_COST = 250
// Solving for less than this is raised to it, as on the show.
export const SOLVE_MINIMUM = 1000
export const SLOTS_PER_WEDGE = 3
const TOP_VALUES = [2500, 3500, 3500, 5000]
// Each round's 24 wedges, clockwise from the top-value wedge. Numbers are cash wedges. Special wedges
// stand in as the cash value in STAND_IN until they're in play.
const LAYOUTS = [
  ['TOP', 600, 700, 600, 650, 500, 700, 'BANKRUPT', 600, 550, 500, 600, 'MILLION', 650, 'GIFT', 700, 'LOSE', 800, 500, 650, 500, 900, 'BANKRUPT', 600],
  ['TOP', 600, 'MYSTERY', 700, 600, 650, 500, 700, 'BANKRUPT', 600, 550, 500, 'MILLION', 650, 'GIFT', 700, 'LOSE', 800, 'MYSTERY', 650, 500, 900, 'BANKRUPT', 600],
  ['TOP', 600, 700, 'EXPRESS', 650, 500, 700, 'BANKRUPT', 600, 550, 500, 600, 'MILLION', 650, 'GIFT', 700, 'LOSE', 800, 500, 650, 500, 900, 'BANKRUPT', 600],
  ['TOP', 600, 700, 600, 650, 500, 700, 'BANKRUPT', 600, 550, 500, 600, 800, 650, 900, 700, 'LOSE', 800, 500, 650, 500, 900, 'BANKRUPT', 600],
]
const STAND_IN = { MILLION: 900, GIFT: 500, MYSTERY: 1000, EXPRESS: 1000 }

// The wheel for a round (1-based); rounds after the fourth use the fourth round's wheel.
export function buildWheel(roundNumber) {
  const index = Math.min(Math.max(roundNumber, 1), LAYOUTS.length) - 1
  return LAYOUTS[index].map((wedge) =>
    wedge === 'TOP' ? { kind: 'cash', value: TOP_VALUES[index], top: true }
      : wedge === 'BANKRUPT' ? { kind: 'bankrupt' }
      : wedge === 'LOSE' ? { kind: 'loseTurn' }
      : { kind: 'cash', value: typeof wedge === 'number' ? wedge : STAND_IN[wedge] })
}

const text = (value, max) => String(value ?? '').trim().slice(0, max)
function cleanConfig(config) {
  const puzzles = (Array.isArray(config?.puzzles) ? config.puzzles : []).slice(0, MAX_ROUNDS)
    .map((puzzle) => ({ category: text(puzzle?.category, 30) || 'Phrase', text: normalizePuzzle(text(puzzle?.text, 80)) }))
    .filter((puzzle) => !puzzleProblem(puzzle.text))
  if (!puzzles.length) throw new Error('A game needs at least one puzzle.')
  return { puzzles, hostless: !!config?.hostless, pace: config?.pace === 'relaxed' ? 'relaxed' : 'show' }
}

export function createWheelGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave, random = Math.random }) {
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const wheelGame = (code) => { const game = games.get(code); return game?.kind === 'wheel' ? game : undefined }
  const members = (game, contestant) => [...game.players.values()].filter((player) => player.contestant === contestant)
  const present = (game, contestant) => members(game, contestant).some((player) => player.socketId)
  // Several things can happen between two updates (a hit that also finishes the puzzle), so the recent
  // events are kept, numbered, for the TV to play each sound once and in order.
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: Date.now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return {
      kind: 'wheel', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config,
      contestants: [], segments: segmentsFor(config.puzzles), segmentIndex: 0, round: null, clocksPaused: false, lastEvent: null,
    }
  }
  const segmentsFor = (puzzles) => puzzles.map((puzzle, i) => ({ type: 'round', n: i + 1, puzzle }))
  // Everyone plays for themselves: each new phone is a new contestant, with its own podium.
  function playerJoined(game, player) {
    player.contestant = game.contestants.length
    game.contestants.push({ name: player.name, total: 0, roundBank: 0, solvedAny: false })
  }

  // ---------- The puzzle ----------
  const shownSet = (round) => new Set(round.shown)
  const allShown = (round) => { const shown = shownSet(round); return Object.keys(round.puzzle.counts).every((letter) => shown.has(letter)) }
  const lettersLeft = (round, set) => { const shown = shownSet(round); return Object.keys(round.puzzle.counts).some((letter) => set.includes(letter) && !shown.has(letter)) }
  // The letters still hidden, in reading order: what a fill-in-the-blanks solve has to supply.
  const hiddenLetters = (round) => { const shown = shownSet(round); return [...round.puzzle.text].filter((ch) => isLetter(ch) && !shown.has(ch)) }
  // The puzzle as someone tried to solve it, with their letters in the blanks ("_" where they left one).
  function attempt(round, guess) {
    const shown = shownSet(round), letters = [...guess]
    return [...round.puzzle.text].map((ch) => (isLetter(ch) && !shown.has(ch) ? letters.shift() || '_' : ch)).join('')
  }
  function publicBoard(round, reveal) {
    const shown = shownSet(round)
    return round.puzzle.rows.map((row) => row.map((cell) => cell && (cell.letter ? { ch: reveal || shown.has(cell.ch) ? cell.ch : '', letter: true } : { ch: cell.ch, letter: false })))
  }

  function publicGame(game) {
    const round = game.round, ended = round?.phase === 'roundEnd' || game.status === 'complete'
    const segment = game.segments[game.segmentIndex]
    return {
      kind: 'wheel', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      pace: game.config.pace, clocksPaused: game.clocksPaused, vowelCost: VOWEL_COST,
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      contestants: game.contestants.map((contestant, i) => ({ ...contestant, present: present(game, i) })),
      segment: { index: game.segmentIndex, count: game.segments.length, type: segment?.type, n: segment?.n },
      round: round && {
        phase: round.phase, category: round.puzzle.category, board: publicBoard(round, ended),
        control: round.control, actorId: round.actorId, deadline: round.deadline, pausedMs: round.pausedMs,
        called: round.called, misses: round.called.filter((letter) => !round.puzzle.counts[letter]),
        consonantsLeft: lettersLeft(round, CONSONANTS), vowelsLeft: lettersLeft(round, VOWELS), blanks: hiddenLetters(round).length,
        wheel: round.wheel, spin: round.spin, value: round.value, lastSolve: round.lastSolve,
        winner: round.winner, awarded: round.awarded, solution: ended ? round.puzzle.text : undefined,
      },
      serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // The answer goes only to host controllers: never to phones, and not to the TV, which everyone can see.
  function sendSecret(game, only = null) {
    if (game.hostless || !game.round || game.status !== 'playing') return
    const secret = { code: game.code, category: game.round.puzzle.category, text: game.round.puzzle.text }
    const sockets = only ? [only] : [...(io.sockets.adapter.rooms.get(game.code) || [])].map((id) => io.sockets.sockets.get(id))
    for (const socket of sockets) if (socket?.data.controllerGame === game.code && socket.id !== game.hostSocketId) socket.emit('wheel:solution', secret)
  }
  const hostJoined = (game, socket) => sendSecret(game, socket)

  // ---------- Phases and their clocks ----------
  const PHASE_TIME = { turn: 'decideMs', consonant: 'letterMs', solving: 'solveMs', spinning: 'spinMs', roundEnd: 'roundEndMs' }
  // Phases waiting on the contestant in control: the host can pause these clocks.
  const ACTOR_PHASES = ['turn', 'consonant', 'solving']
  function phaseMs(game, phase) {
    const key = PHASE_TIME[phase]
    // With a host, the host moves on from a finished round.
    if (!key || (phase === 'roundEnd' && !game.hostless)) return null
    return WHEEL_TIMES[key] * (game.config.pace === 'relaxed' && RELAXED.has(key) ? 2 : 1)
  }
  function setPhase(game, phase) {
    const round = game.round, ms = phaseMs(game, phase)
    round.phase = phase; round.deadline = null; round.pausedMs = null
    clearGameTimers(game)
    if (!ms || (ACTOR_PHASES.includes(phase) && !round.actorId)) return
    if (game.clocksPaused && ACTOR_PHASES.includes(phase)) { round.pausedMs = ms; return }
    runClock(game, ms)
  }
  function runClock(game, ms) {
    const round = game.round, phase = round.phase
    round.deadline = Date.now() + ms; round.pausedMs = null
    schedule(game, 'wheel', ms, () => timedOut(game, round, phase))
  }
  function timedOut(game, round, phase) {
    if (game.round !== round || round.phase !== phase || game.status !== 'playing') return
    if (phase === 'spinning') land(game)
    else if (phase === 'roundEnd') { nextSegment(game); return }
    else { event(game, 'timeout', { contestant: round.control }); passControl(game) }
    emitGame(game)
  }

  // ---------- Rounds ----------
  function startSegment(game) {
    const segment = game.segments[game.segmentIndex], puzzle = segment.puzzle
    game.contestants.forEach((contestant) => { contestant.roundBank = 0 })
    game.round = {
      n: segment.n, puzzle: { ...puzzle, rows: layoutPuzzle(puzzle.text).rows, counts: letterCounts(puzzle.text) }, wheel: buildWheel(segment.n),
      phase: 'turn', shown: [], called: [], control: null, actorId: null, deadline: null, pausedMs: null,
      spin: null, value: null, lastSolve: null, winner: null, awarded: 0,
    }
    event(game, 'round', { n: segment.n })
    // Control rotates from round to round: contestant 1 starts round 1, contestant 2 round 2, and so on.
    giveControl(game, firstPresent(game, (segment.n - 1) % Math.max(1, game.contestants.length)))
    sendSecret(game)
  }
  function nextSegment(game) {
    if (game.segmentIndex >= game.segments.length - 1) { finish(game); return }
    game.segmentIndex++
    startSegment(game)
    emitGame(game)
  }
  function finish(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.round) { game.round.phase = 'roundEnd'; game.round.deadline = null; game.round.actorId = null }
    event(game, 'complete')
    emitGame(game)
  }

  // ---------- Turns ----------
  // The next contestant after `from` with a phone connected (possibly `from` itself, if nobody else is), or null.
  function nextPresent(game, from) {
    const count = game.contestants.length
    for (let i = 1; i <= count; i++) { const contestant = (from + i) % count; if (present(game, contestant)) return contestant }
    return null
  }
  const firstPresent = (game, start) => (start != null && present(game, start) ? start : nextPresent(game, start ?? -1))
  function giveControl(game, contestant) {
    const round = game.round
    round.control = contestant
    round.actorId = contestant == null ? null : members(game, contestant).find((player) => player.socketId)?.id || null
    round.value = null
    setPhase(game, 'turn')
  }
  function passControl(game) {
    const round = game.round
    giveControl(game, nextPresent(game, round.control ?? -1))
    event(game, 'control', { contestant: round.control })
  }
  const bankOf = (game) => game.contestants[game.round.control]

  function spin(game, power) {
    const round = game.round
    // Once every consonant is showing, only vowels and solving are left.
    if (round.phase !== 'turn' || !lettersLeft(round, CONSONANTS)) return
    const slots = round.wheel.length * SLOTS_PER_WEDGE
    // jitter is where in its slot the pointer stops (-0.4 to 0.4 of a slot), so every screen draws the same landing.
    round.spin = { id: (round.spin?.id || 0) + 1, slot: Math.floor(random() * slots), jitter: random() * 0.8 - 0.4, power: Math.min(1, Math.max(0, Number(power) || 0.6)), ms: WHEEL_TIMES.spinMs }
    event(game, 'spin', { contestant: round.control })
    setPhase(game, 'spinning')
  }
  function land(game) {
    const round = game.round, wedge = round.wheel[Math.floor(round.spin.slot / SLOTS_PER_WEDGE)]
    event(game, 'land', { contestant: round.control, kind: wedge.kind, value: wedge.value })
    if (wedge.kind === 'bankrupt') { bankOf(game).roundBank = 0; passControl(game) }
    else if (wedge.kind === 'loseTurn') passControl(game)
    else { round.value = wedge.value; setPhase(game, 'consonant') }
  }
  function callConsonant(game, letter) {
    const round = game.round
    if (round.phase !== 'consonant' || !CONSONANTS.includes(letter) || round.called.includes(letter)) return
    round.called.push(letter)
    const count = round.puzzle.counts[letter] || 0
    if (!count) { event(game, 'miss', { contestant: round.control, letter }); passControl(game); return }
    round.shown.push(letter)
    bankOf(game).roundBank += round.value * count
    event(game, 'hit', { contestant: round.control, letter, count, amount: round.value * count })
    round.value = null
    if (allShown(round)) win(game, round.control)
    else setPhase(game, 'turn')
  }
  function buyVowel(game, letter) {
    const round = game.round, bank = bankOf(game)
    if (round.phase !== 'turn' || !isVowel(letter) || round.called.includes(letter) || bank.roundBank < VOWEL_COST || !lettersLeft(round, VOWELS)) return
    bank.roundBank -= VOWEL_COST
    round.called.push(letter)
    const count = round.puzzle.counts[letter] || 0
    if (!count) { event(game, 'miss', { contestant: round.control, letter, vowel: true }); passControl(game); return }
    round.shown.push(letter)
    event(game, 'hit', { contestant: round.control, letter, count, amount: 0, vowel: true })
    if (allShown(round)) win(game, round.control)
    else setPhase(game, 'turn')
  }
  function startSolve(game) {
    if (game.round.phase !== 'turn') return
    event(game, 'solving', { contestant: game.round.control })
    setPhase(game, 'solving')
  }
  function solve(game, playerId, rawGuess) {
    const round = game.round
    if (round.phase !== 'solving') return
    const guess = String(rawGuess ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 60)
    const correct = guess === hiddenLetters(round).join('')
    round.lastSolve = { playerId, contestant: round.control, text: attempt(round, guess), correct }
    ruleSolve(game, correct)
  }
  function ruleSolve(game, correct) {
    const round = game.round
    if (correct) win(game, round.control)
    else { event(game, 'wrongSolve', { contestant: round.control, text: round.lastSolve?.text || null }); passControl(game) }
  }
  function win(game, contestant) {
    const round = game.round, winner = game.contestants[contestant]
    round.shown = Object.keys(round.puzzle.counts)
    round.winner = contestant
    round.awarded = Math.max(winner.roundBank, SOLVE_MINIMUM)
    winner.total += round.awarded
    winner.solvedAny = true
    game.contestants.forEach((other) => { other.roundBank = 0 })
    round.actorId = null
    event(game, 'solve', { contestant, amount: round.awarded })
    setPhase(game, 'roundEnd')
  }
  // The host gave up on the puzzle: show it, nobody banks anything.
  function revealPuzzle(game) {
    const round = game.round
    round.shown = Object.keys(round.puzzle.counts)
    round.winner = null; round.awarded = 0; round.actorId = null
    game.contestants.forEach((contestant) => { contestant.roundBank = 0 })
    event(game, 'roundSkipped')
    setPhase(game, 'roundEnd')
  }

  // ---------- Pausing (host) ----------
  function pause(game) {
    const round = game.round
    game.clocksPaused = true
    if (round && ACTOR_PHASES.includes(round.phase) && round.deadline) {
      round.pausedMs = Math.max(0, round.deadline - Date.now()); round.deadline = null
      clearGameTimers(game)
    }
  }
  function resume(game) {
    game.clocksPaused = false
    if (game.round?.pausedMs != null && game.status === 'playing') runClock(game, game.round.pausedMs)
  }

  // ---------- Players coming and going ----------
  // A player left (after the reconnect grace period) or was kicked: if the game was waiting on them, move on.
  function handOff(game, playerId) {
    const round = game.round
    if (game.status !== 'playing' || !round || round.actorId !== playerId) return
    if (ACTOR_PHASES.includes(round.phase)) passControl(game)
    // Mid-spin, the wheel still lands; the next phase finds nobody to act and the clock moves things on.
    else round.actorId = null
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    handOff(game, playerId)
    emitGame(game)
  }
  function kick(game, playerId) {
    const player = game.players.get(playerId)
    if (!player) return
    cancelLeave(game.code, player.id)
    const socket = io.sockets.sockets.get(player.socketId)
    socket?.leave(game.code); socket?.emit('player:kicked')
    game.players.delete(player.id)
    // Before the game starts their podium goes too; once it's running, their score stays on the board.
    if (game.status === 'lobby' && !members(game, player.contestant).length) {
      game.contestants.splice(player.contestant, 1)
      for (const other of game.players.values()) if (other.contestant > player.contestant) other.contestant--
    } else handOff(game, player.id)
  }

  function hostAction(game, action, payload) {
    const round = game.round, playing = game.status === 'playing' && round
    if (action === 'start' && game.status === 'lobby') {
      if (!game.contestants.some((_, i) => present(game, i))) return emitGame(game)
      game.status = 'playing'; game.segmentIndex = 0; game.clocksPaused = false
      startSegment(game)
    }
    if (action === 'judgeSolve' && playing && round.phase === 'solving') {
      round.lastSolve = { playerId: round.actorId, contestant: round.control, text: null, correct: !!payload.correct, byHost: true }
      ruleSolve(game, !!payload.correct)
    }
    if (action === 'pause' && playing) pause(game)
    if (action === 'resume' && playing) resume(game)
    if (action === 'skipTurn' && playing && ACTOR_PHASES.includes(round.phase)) { event(game, 'skipped', { contestant: round.control }); passControl(game) }
    if (action === 'revealPuzzle' && playing && round.phase !== 'roundEnd') revealPuzzle(game)
    if (action === 'nextSegment' && playing && round.phase === 'roundEnd') { nextSegment(game); return }
    if (action === 'endGame' && game.status === 'playing') { finish(game); return }
    if (action === 'adjustScore') {
      const contestant = game.contestants[payload.contestant], amount = Math.trunc(Number(payload.amount))
      if (contestant && Number.isFinite(amount)) contestant.total += amount
    }
    if (action === 'renamePlayer') {
      const player = game.players.get(payload.playerId), name = text(payload.name, 20)
      if (player && name) { player.name = name; game.contestants[player.contestant].name = name }
    }
    if (action === 'kickPlayer') kick(game, payload.playerId)
    if (action === 'replay') {
      let puzzles = game.config.puzzles
      try { if (payload.puzzles) puzzles = cleanConfig({ puzzles: payload.puzzles }).puzzles } catch {}
      clearGameTimers(game)
      Object.assign(game, { status: 'lobby', segments: segmentsFor(puzzles), segmentIndex: 0, round: null, clocksPaused: false, lastEvent: null })
      game.config.puzzles = puzzles
      game.contestants.forEach((contestant) => Object.assign(contestant, { total: 0, roundBank: 0, solvedAny: false }))
    }
    emitGame(game)
  }

  function register(socket) {
    // Every phone action comes from the player whose turn it is, on their own connection.
    const on = (name, handle) => socket.on(`wheel:${name}`, (payload = {}) => {
      const game = wheelGame(payload.code)
      if (!isLive(game, payload.playerId, socket) || game.status !== 'playing' || game.round?.actorId !== payload.playerId) return
      handle(game, payload)
      emitGame(game)
    })
    const letterIn = (value) => String(value ?? '').toUpperCase().slice(0, 1)
    on('spin', (game, { power }) => spin(game, power))
    on('consonant', (game, { letter }) => callConsonant(game, letterIn(letter)))
    on('buyVowel', (game, { letter }) => buyVowel(game, letterIn(letter)))
    on('solveStart', (game) => startSolve(game))
    on('solve', (game, { playerId, guess }) => solve(game, playerId, guess))
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, hostJoined, register }
}
