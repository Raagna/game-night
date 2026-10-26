// Spin & Solve — a word-puzzle game in the style of Wheel of Fortune.
//
// A game is a list of segments, like the show: toss-ups, main rounds, and a final round that ends in a
// speed-up. In a main round the contestant in control spins the wheel and calls a consonant, which earns
// the spin's value for every time it appears; then they can spin again, buy a vowel for $250 or solve.
// Landing on Bankrupt empties their round bank; Bankrupt, Lose a Turn, a letter that isn't in the puzzle,
// a wrong solve or running out of time passes control. Solving banks the round (at least $1,000);
// everyone else's round bank is lost.
//
// Toss-ups reveal one tile at a time; the first contestant to buzz in gets one try, and a miss locks them
// out while the tiles keep coming. The winner banks the toss-up's value and starts the next round.
// Rounds 1 to 3 have the show's special wedges. The Wild Card sits on one cash wedge: whoever calls a right
// letter there keeps it, and can spend it on a second consonant at the same value or a fourth consonant in
// the bonus round. The Gift wedge and the Million Dollar wedge (a sliver between two Bankrupts) pay $500 a
// letter plus the gift, or the chance at $1,000,000 in the bonus round, both kept only by solving the round.
// Round 2's two Mystery wedges pay $1,000 a letter, or can be flipped for $10,000 or Bankrupt. Round 3's
// Express wedge pays $1,000 a letter and lets the contestant keep calling letters without spinning, with any
// mistake counting as Bankrupt; round 3 is also the Prize Puzzle, worth a trip to whoever solves it.
// Bankrupt takes the round's money and gifts, and the Wild Card or Million Dollar wedge, from any round.
//
// The final round plays normally until the speed-up (two minutes in, or straight away): one last spin
// sets the value of every consonant for the rest of the round (plus $1,000), vowels are free, and each
// letter found gives that contestant a few seconds to solve. A tie for the lead after that is settled by
// a tiebreaker toss-up, and anyone who solved nothing gets $1,000 for playing.
//
// The winner then plays the bonus round: they pick one of three categories, spin a wheel of 24 sealed
// envelopes ($40,000 to $100,000) for the prize, and see the puzzle with R S T L N E showing. They choose
// three more consonants and a vowel, then have ten seconds to solve it, as many tries as fit. The envelope
// is opened either way; the money is theirs only if they solved it.
//
// Players play on their own (2 to 6, a podium each) or in 2 to 4 teams sharing up to 12 phones. A team plays
// as one contestant: its members take turns acting when the team has control, any member can buzz in on a
// toss-up, and the whole team plays the bonus round.
//
// The server picks where every spin lands and only applies it once the wheel has stopped on the TV, so
// all screens agree and no phone can fake a spin. The solution never goes out with the game state:
// phones get the board with unrevealed letters blank, and only the host controller is sent the answer.
// Solves are typed as the missing letters ("fill in the blanks") and checked exactly, like the show's
// "read it exactly as written". In hosted games the host can also judge a solve said out loud.
import { layoutPuzzle, puzzleProblem, normalizePuzzle, letterCounts, isLetter, isVowel, CONSONANTS, VOWELS } from './wheelBoard.js'

export const WHEEL_TIMES = {
  decideMs: 10000, letterMs: 10000, solveMs: 20000, quickSolveMs: 10000, spinMs: 5200, roundEndMs: 9000,
  tossupRevealMs: 1100, tossupLastMs: 6000, speedUpAfterMs: 120000,
  pickMs: 15000, lightMs: 3000, bonusLettersMs: 20000, envelopeMs: 12000,
}
// Relaxed pace doubles the clocks people play against (not the spin, the toss-up tiles or the pause between rounds).
const RELAXED = new Set(['decideMs', 'letterMs', 'solveMs', 'quickSolveMs', 'pickMs', 'bonusLettersMs'])
// Up to 6 contestants on their own, or 2 to 4 teams sharing up to 12 phones.
const MAX_SOLO = 6, MAX_TEAM_PLAYERS = 12, TEAM_COUNTS = [2, 3, 4]
const MAX_SEGMENTS = 12
export const VOWEL_COST = 250
// Solving a round for less than this is raised to it, as on the show.
export const SOLVE_MINIMUM = 1000
// Added to the final spin's value for the speed-up.
export const SPEED_UP_BONUS = 1000
// For anyone who solved nothing all game.
export const CONSOLATION = 1000
export const TIEBREAK_VALUE = 1000
export const SLOTS_PER_WEDGE = 3
// The bonus round's given letters, and how many more of each kind the player picks.
export const BONUS_GIVEN = 'RSTLNE'
export const BONUS_PICKS = { consonants: 3, vowels: 1 }
// The bonus wheel's 24 envelopes. They're sealed: their order is shuffled for each game and only the
// server knows it until the envelope is opened. Holding the Million Dollar wedge swaps $100,000 for $1,000,000.
export const BONUS_ENVELOPES = [100000, 40000, 45000, 40000, 50000, 40000, 45000, 40000, 55000, 40000, 45000, 40000, 60000, 40000, 45000, 40000, 50000, 40000, 45000, 40000, 75000, 40000, 45000, 40000]
export const MILLION_PRIZE = 1000000
const TOP_VALUES = [2500, 3500, 3500, 5000]
// Each round's 24 wedges, clockwise from the top-value wedge. Numbers are cash wedges.
const LAYOUTS = [
  ['TOP', 600, 700, 600, 650, 500, 700, 'BANKRUPT', 600, 550, 500, 600, 'MILLION', 650, 'GIFT', 700, 'LOSE', 800, 500, 650, 500, 900, 'BANKRUPT', 600],
  ['TOP', 600, 'MYSTERY', 700, 600, 650, 500, 700, 'BANKRUPT', 600, 550, 500, 'MILLION', 650, 'GIFT', 700, 'LOSE', 800, 'MYSTERY', 650, 500, 900, 'BANKRUPT', 600],
  ['TOP', 600, 700, 'EXPRESS', 650, 500, 700, 'BANKRUPT', 600, 550, 500, 600, 'MILLION', 650, 'GIFT', 700, 'LOSE', 800, 500, 650, 500, 900, 'BANKRUPT', 600],
  ['TOP', 600, 700, 600, 650, 500, 700, 'BANKRUPT', 600, 550, 500, 600, 800, 650, 900, 700, 'LOSE', 800, 500, 650, 500, 900, 'BANKRUPT', 600],
]
// While someone holds the Million Dollar wedge, its spot is a plain $900 wedge.
const MILLION_STAND_IN = 900
// What the special wedges pay for each letter, as on the show.
export const SPECIAL_VALUES = { gift: 500, million: 500, mystery: 1000, express: 1000 }
export const MYSTERY_PRIZE = 10000
// The Wild Card, the Million Dollar wedge and the Gift are on the wheel in rounds 1 to 3 (never the final round);
// round 2 adds the Mystery wedges, round 3 the Express wedge and the Prize Puzzle.
export const SPECIAL_ROUNDS = 3
const DEFAULT_GIFT = { name: 'A surprise gift', value: 1000 }, DEFAULT_TRIP = { name: 'A trip for two', value: 8000 }

// The wheel for a round (1-based); rounds after the fourth, and the final round, use the fourth round's wheel.
export function buildWheel(roundNumber, { million = true } = {}) {
  const index = Math.min(Math.max(roundNumber, 1), LAYOUTS.length) - 1
  return LAYOUTS[index].map((wedge) =>
    wedge === 'TOP' ? { kind: 'cash', value: TOP_VALUES[index], top: true }
      : wedge === 'BANKRUPT' ? { kind: 'bankrupt' }
      : wedge === 'LOSE' ? { kind: 'loseTurn' }
      : wedge === 'MILLION' ? (million ? { kind: 'million', value: SPECIAL_VALUES.million } : { kind: 'cash', value: MILLION_STAND_IN })
      : wedge === 'GIFT' ? { kind: 'gift', value: SPECIAL_VALUES.gift }
      : wedge === 'MYSTERY' ? { kind: 'mystery', value: SPECIAL_VALUES.mystery }
      : wedge === 'EXPRESS' ? { kind: 'express', value: SPECIAL_VALUES.express }
      : { kind: 'cash', value: wedge })
}

const text = (value, max) => String(value ?? '').trim().slice(0, max)
const cleanPuzzle = (puzzle) => ({ category: text(puzzle?.category, 30) || 'Phrase', text: normalizePuzzle(text(puzzle?.text, 80)) })
const usable = (puzzle) => !puzzleProblem(puzzle.text)
// The game's order of play: toss-ups and main rounds as sent by setup, with the last main round made the
// final round and the main rounds numbered. `puzzles` (just main rounds) is accepted too.
function cleanSegments(config) {
  const raw = Array.isArray(config?.segments) ? config.segments : (Array.isArray(config?.puzzles) ? config.puzzles : []).map((puzzle) => ({ ...puzzle, type: 'round' }))
  const segments = raw.slice(0, MAX_SEGMENTS).map((segment) => {
    const puzzle = cleanPuzzle(segment)
    if (segment?.type === 'tossup') return { type: 'tossup', value: Math.max(100, Math.min(10000, Math.trunc(Number(segment.value)) || 1000)), puzzle }
    return { type: 'round', puzzle }
  }).filter((segment) => usable(segment.puzzle))
  const rounds = segments.filter((segment) => segment.type === 'round')
  if (!rounds.length) throw new Error('A game needs at least one puzzle.')
  rounds.forEach((segment, i) => { segment.n = i + 1 })
  rounds.at(-1).type = 'final'
  return segments
}
function cleanConfig(config) {
  const segments = cleanSegments(config)
  const spares = (Array.isArray(config?.spares) ? config.spares : []).slice(0, 3).map(cleanPuzzle).filter(usable)
  // The bonus round's three category choices (fewer is fine; none means no bonus round).
  const bonus = (Array.isArray(config?.bonus) ? config.bonus : []).slice(0, 3).map(cleanPuzzle).filter(usable)
  // The Gift wedge's prize in rounds 1 to 3, and the Prize Puzzle's trip in round 3.
  const prize = (raw) => { const name = text(raw?.name, 40), value = Math.trunc(Number(raw?.value)); return name && value >= 100 && value <= 50000 ? { name, value } : null }
  const gifts = (Array.isArray(config?.gifts) ? config.gifts : []).slice(0, SPECIAL_ROUNDS).map(prize).filter(Boolean)
  const teams = config?.mode === 'teams'
  const teamCount = TEAM_COUNTS.includes(Number(config?.teamCount)) ? Number(config.teamCount) : 2
  return {
    mode: teams ? 'teams' : 'solo', teamNames: teams ? Array.from({ length: teamCount }, (_, i) => text(config?.teamNames?.[i], 24) || `Team ${i + 1}`) : [],
    segments, spares, bonus, gifts, trip: prize(config?.trip), hostless: !!config?.hostless, pace: config?.pace === 'relaxed' ? 'relaxed' : 'show',
    speedUp: config?.speedUp === 'start' ? 'start' : 'after',
  }
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
      // Teams have their podiums from the start; solo podiums appear as phones join.
      contestants: config.teamNames.map(freshContestant), ...freshPlay(config), lastEvent: null,
    }
  }
  const isTeams = (game) => game.config.mode === 'teams'
  const maxPlayers = (game) => (isTeams(game) ? MAX_TEAM_PLAYERS : MAX_SOLO)
  // Everything a new game (or a replay) starts from.
  const freshPlay = (config) => ({
    segments: config.segments.map((segment) => ({ ...segment })), spares: [...config.spares],
    segmentIndex: 0, round: null, clocksPaused: false, startNext: null, winner: null, bonus: null, undo: null,
  })
  // Solo: each new phone is a new contestant, with its own podium. Teams: new phones join the smallest
  // team, so teams stay even as people arrive (they can switch in the lobby).
  function playerJoined(game, player) {
    if (!isTeams(game)) {
      player.contestant = game.contestants.length
      game.contestants.push(freshContestant(player.name))
      return
    }
    const sizes = game.contestants.map((_, i) => members(game, i).filter((other) => other !== player).length)
    player.contestant = sizes.indexOf(Math.min(...sizes))
  }
  // roundPrizes: gifts picked up this round, kept only on a solve; prizes: everything won so far.
  // wildCard and million carry over from round to round until used, or lost to Bankrupt.
  // turnRotation: which team member acts next time the team gets control.
  const freshContestant = (name) => ({
    name, total: 0, roundBank: 0, solvedAny: false, consolation: 0,
    roundPrizes: [], prizes: [], wildCard: false, million: false, millionThisRound: false, turnRotation: 0,
  })
  // The team member whose turn it is to act for the team (members take turns), or null if none are connected.
  function nextActor(game, contestant) {
    const here = members(game, contestant).filter((player) => player.socketId)
    if (!here.length) return null
    const player = here[game.contestants[contestant].turnRotation % here.length]
    game.contestants[contestant].turnRotation++
    return player.id
  }

  // ---------- The puzzle ----------
  // A letter is showing if it has been called, or (in a toss-up) its tile has been turned on its own.
  // Positions count the puzzle's letters in reading order, which is also the board's order.
  const lettersOf = (round) => [...round.puzzle.text].filter(isLetter)
  function shownFlags(round) {
    const called = new Set(round.shown), turned = new Set(round.revealed)
    return lettersOf(round).map((ch, k) => called.has(ch) || turned.has(k))
  }
  const allShown = (round) => shownFlags(round).every(Boolean)
  const lettersLeft = (round, set) => { const flags = shownFlags(round); return lettersOf(round).some((ch, k) => set.includes(ch) && !flags[k]) }
  // The letters still hidden, in reading order: what a fill-in-the-blanks solve has to supply.
  const hiddenLetters = (round) => { const flags = shownFlags(round); return lettersOf(round).filter((_, k) => !flags[k]) }
  // The puzzle as someone tried to solve it, with their letters in the blanks ("_" where they left one).
  function attempt(round, guess) {
    const flags = shownFlags(round), letters = [...guess]
    let k = 0
    return [...round.puzzle.text].map((ch) => (isLetter(ch) && !flags[k++] ? letters.shift() || '_' : ch)).join('')
  }
  function publicBoard(round, reveal) {
    const flags = shownFlags(round)
    let k = 0
    return round.puzzle.rows.map((row) => row.map((cell) => {
      if (!cell) return null
      if (!cell.letter) return { ch: cell.ch, letter: false }
      return { ch: reveal || flags[k++] ? cell.ch : '', letter: true }
    }))
  }
  const isTossup = (round) => round.type === 'tossup' || round.type === 'tiebreak'

  function publicGame(game) {
    const round = game.round, ended = round?.phase === 'roundEnd' || game.status === 'complete'
    const segment = game.segments[game.segmentIndex]
    return {
      kind: 'wheel', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId, mode: game.config.mode, maxPlayers: maxPlayers(game),
      pace: game.config.pace, clocksPaused: game.clocksPaused, vowelCost: VOWEL_COST, canUndo: !!game.undo && game.status === 'playing', winner: game.winner, speedUpMode: game.config.speedUp,
      // The order of play without the puzzles, so "Play again" can deal new ones for the same game.
      plan: game.config.segments.map(({ type, value }) => ({ type: type === 'final' ? 'round' : type, value })), hasBonus: game.config.bonus.length > 0,
      bonus: publicBonus(game),
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      contestants: game.contestants.map((contestant, i) => ({ ...contestant, present: present(game, i) })),
      segment: {
        index: game.segmentIndex, count: game.segments.length, type: segment?.type, n: segment?.n, value: segment?.value,
        rounds: game.segments.filter((s) => s.type === 'round' || s.type === 'final').length,
      },
      round: round && {
        type: round.type, phase: round.phase, category: round.puzzle.category, board: publicBoard(round, ended),
        control: round.control, actorId: round.actorId, deadline: round.deadline, pausedMs: round.pausedMs,
        called: round.called, misses: round.called.filter((letter) => !round.puzzle.counts[letter]),
        consonantsLeft: lettersLeft(round, CONSONANTS), vowelsLeft: lettersLeft(round, VOWELS), blanks: hiddenLetters(round).length,
        wheel: round.wheel, spin: round.spin, value: round.value, lastSolve: round.lastSolve,
        // Not which Mystery wedge holds the $10,000: that stays on the server.
        landed: round.landed && { kind: round.landed.kind, value: round.landed.value }, wildChance: !!round.wildChance, express: round.express,
        gift: round.gift, prizePuzzle: round.prizePuzzle, mysteryFlipped: round.mysteryFlipped, prizesWon: round.prizesWon,
        tossup: isTossup(round) ? { value: round.tossupValue, lockedOut: round.lockedOut, eligible: round.eligible } : null,
        speedUp: round.speedUp, speedUpAt: round.speedUp ? null : round.speedUpAt,
        winner: round.winner, awarded: round.awarded, solution: ended ? round.puzzle.text : undefined,
      },
      serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // The bonus round as the screens see it. The puzzle shows once the envelope is picked, and the
  // envelope's value only when it's opened.
  function publicBonus(game) {
    const bonus = game.bonus
    if (!bonus) return null
    const opened = bonus.phase === 'envelope' || game.status === 'complete'
    return {
      contestant: bonus.contestant, playerId: bonus.playerId, phase: bonus.phase, deadline: bonus.deadline, pausedMs: bonus.pausedMs,
      categories: bonus.choices.map((puzzle) => puzzle.category), choice: bonus.choice, category: bonus.puzzle?.category || null,
      board: bonus.puzzle && !['pick', 'spin', 'spinning'].includes(bonus.phase) ? publicBoard(bonus, opened) : null,
      blanks: bonus.puzzle ? hiddenLetters(bonus).length : 0,
      given: BONUS_GIVEN, picked: bonus.picked, picks: { ...BONUS_PICKS, consonants: BONUS_PICKS.consonants + (bonus.extra ? 1 : 0) }, extra: bonus.extra,
      spin: bonus.spin, envelopes: bonus.envelopes.length, envelope: bonus.envelope, million: bonus.million,
      prize: opened ? bonus.prize : null, solved: bonus.solved, lastSolve: bonus.lastSolve, solution: opened && bonus.puzzle ? bonus.puzzle.text : undefined,
    }
  }

  // The puzzle being played right now: the round's, or the bonus round's once it's picked.
  const currentPuzzle = (game) => (game.status === 'bonus' ? game.bonus?.puzzle : game.status === 'playing' ? game.round?.puzzle : null)
  // The answer goes only to host controllers: never to phones, and not to the TV, which everyone can see.
  function sendSecret(game, only = null) {
    const puzzle = currentPuzzle(game)
    if (game.hostless || !puzzle) return
    const secret = { code: game.code, category: puzzle.category, text: puzzle.text }
    const sockets = only ? [only] : [...(io.sockets.adapter.rooms.get(game.code) || [])].map((id) => io.sockets.sockets.get(id))
    for (const socket of sockets) if (socket?.data.controllerGame === game.code && socket.id !== game.hostSocketId) socket.emit('wheel:solution', secret)
  }
  const hostJoined = (game, socket) => sendSecret(game, socket)

  // ---------- Phases and their clocks ----------
  const PHASE_TIME = {
    turn: 'decideMs', consonant: 'letterMs', solving: 'solveMs', spinning: 'spinMs', roundEnd: 'roundEndMs',
    tossupSolve: 'quickSolveMs', finalSpin: 'decideMs', speedLetter: 'letterMs', speedSolve: 'quickSolveMs',
    mystery: 'decideMs', expressChoice: 'decideMs', express: 'letterMs',
  }
  // Phases waiting on the contestant in control: the host can pause these clocks.
  const ACTOR_PHASES = ['turn', 'consonant', 'solving', 'tossupSolve', 'finalSpin', 'speedLetter', 'speedSolve', 'mystery', 'expressChoice', 'express']
  function phaseMs(game, phase) {
    const key = PHASE_TIME[phase]
    // With a host, the host moves on from a finished round.
    if (!key || (phase === 'roundEnd' && !game.hostless)) return null
    return WHEEL_TIMES[key] * (game.config.pace === 'relaxed' && RELAXED.has(key) ? 2 : 1)
  }
  function setPhase(game, phase) {
    const round = game.round
    // Once the final round's two minutes are up, the speed-up starts at the next turn.
    if (phase === 'turn' && speedUpDue(game)) { startSpeedUp(game); return }
    const ms = phaseMs(game, phase)
    round.phase = phase; round.deadline = null; round.pausedMs = null
    clearGameTimers(game)
    if (phase === 'tossupReveal') { if (!game.clocksPaused) scheduleReveal(game); return }
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
    // Nobody spun for the speed-up: the wheel gets spun for them.
    else if (phase === 'finalSpin') spinWheel(game, 0.6)
    else if (phase === 'tossupSolve') lockOut(game, 'timeout')
    // Not deciding in time takes the safe choice: the Mystery money, or passing on the Express.
    else if (phase === 'mystery') chooseMystery(game, false)
    else if (phase === 'expressChoice') chooseExpress(game, false)
    // A speed-up solve lasts until the clock runs out, however many tries that takes. On the Express,
    // running out of time is Bankrupt.
    else {
      event(game, 'timeout', { contestant: round.control })
      if (round.express) goBankrupt(game, 'express')
      passControl(game)
    }
    emitGame(game)
  }

  // ---------- Segments ----------
  function startSegment(game) {
    const segment = game.segments[game.segmentIndex], puzzle = segment.puzzle
    game.undo = null
    game.contestants.forEach((contestant) => Object.assign(contestant, { roundBank: 0, roundPrizes: [], millionThisRound: false }))
    game.round = {
      type: segment.type, n: segment.n, puzzle: { ...puzzle, rows: layoutPuzzle(puzzle.text).rows, counts: letterCounts(puzzle.text) },
      phase: null, shown: [], revealed: [], called: [], control: null, actorId: null, deadline: null, pausedMs: null,
      wheel: null, spin: null, value: null, lastSolve: null, winner: null, awarded: 0, prizesWon: [],
      // landed: the wedge the last spin stopped on; wildChance: the value a Wild Card would call a second consonant at.
      landed: null, wildChance: null, express: false, gift: null, prizePuzzle: null, mysteryTenK: null, mysteryFlipped: false,
    }
    event(game, 'round', { segment: game.segmentIndex, type: segment.type })
    if (segment.type === 'tossup' || segment.type === 'tiebreak') startTossup(game, segment)
    else startMainRound(game, segment)
    sendSecret(game)
  }
  function startMainRound(game, segment) {
    const round = game.round, special = segment.type === 'round' && segment.n <= SPECIAL_ROUNDS
    const nobodyHolds = (flag) => !game.contestants.some((contestant) => contestant[flag])
    round.wheel = buildWheel(segment.type === 'final' ? LAYOUTS.length : segment.n, { million: special && nobodyHolds('million') })
    if (special) {
      round.gift = game.config.gifts[segment.n - 1] || DEFAULT_GIFT
      if (segment.n === SPECIAL_ROUNDS) round.prizePuzzle = game.config.trip || DEFAULT_TRIP
      // The Wild Card goes on a random cash wedge (not the top value), unless someone already has it.
      if (nobodyHolds('wildCard')) {
        const cash = round.wheel.map((wedge, i) => (wedge.kind === 'cash' && !wedge.top ? i : -1)).filter((i) => i >= 0)
        round.wheel[cash[Math.floor(random() * cash.length)]].wild = true
      }
      // Which Mystery wedge hides the $10,000 is decided now and never sent to the screens.
      const mysteries = round.wheel.map((wedge, i) => (wedge.kind === 'mystery' ? i : -1)).filter((i) => i >= 0)
      if (mysteries.length) round.mysteryTenK = mysteries[Math.floor(random() * mysteries.length)]
    }
    if (segment.type === 'final') { round.speedUp = null; round.speedUpAt = Date.now() + (game.config.speedUp === 'start' ? 0 : WHEEL_TIMES.speedUpAfterMs) }
    // The winner of the toss-up just before starts the round; otherwise control rotates from round to round.
    const start = game.startNext != null && present(game, game.startNext) ? game.startNext : firstPresent(game, (segment.n - 1) % Math.max(1, game.contestants.length))
    game.startNext = null
    giveControl(game, start)
  }
  function nextSegment(game) {
    if (game.segmentIndex >= game.segments.length - 1 && !addTiebreak(game)) { endMainGame(game); return }
    game.segmentIndex++
    startSegment(game)
    emitGame(game)
  }
  // After the last segment, a tie for the lead is played off with a toss-up between the tied contestants,
  // for as long as there are spare puzzles.
  function addTiebreak(game) {
    const tied = leaders(game)
    if (tied.length < 2 || !game.spares.length) return false
    game.segments.push({ type: 'tiebreak', value: TIEBREAK_VALUE, puzzle: game.spares.shift(), eligible: tied })
    return true
  }
  function leaders(game) {
    const top = Math.max(...game.contestants.map((contestant) => contestant.total))
    return game.contestants.map((contestant, i) => (contestant.total === top ? i : -1)).filter((i) => i >= 0)
  }
  // The main game is over: decide the winner, pay out the consolation money, then the bonus round (unless
  // the host ended the game early, nobody won outright, or the winner's phone isn't connected).
  function endMainGame(game, { bonus = true } = {}) {
    clearGameTimers(game)
    if (game.contestants.length) {
      const top = leaders(game)
      game.winner = top.length === 1 ? top[0] : null
    }
    // Decided before the consolation money, which only goes to contestants who solved nothing.
    for (const contestant of game.contestants) if (!contestant.solvedAny && !contestant.consolation) { contestant.consolation = CONSOLATION; contestant.total += CONSOLATION }
    if (game.round) { game.round.phase = 'roundEnd'; game.round.deadline = null; game.round.actorId = null }
    if (bonus && game.config.bonus.length && game.winner != null && present(game, game.winner)) startBonus(game)
    else complete(game)
  }
  function complete(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.bonus) { game.bonus.deadline = null; game.bonus.pausedMs = null }
    event(game, 'complete')
    emitGame(game)
  }

  // ---------- Toss-ups ----------
  function startTossup(game, segment) {
    const round = game.round
    round.tossupValue = segment.value
    round.lockedOut = []
    round.eligible = segment.eligible || null
    // The order the tiles turn over in.
    round.order = lettersOf(round).map((_, k) => k).map((k) => [random(), k]).sort((a, b) => a[0] - b[0]).map(([, k]) => k)
    if (segment.type === 'tossup') game.startNext = null
    setPhase(game, 'tossupReveal')
  }
  const canBuzz = (game, contestant) => {
    const round = game.round
    return contestant != null && present(game, contestant) && !round.lockedOut.includes(contestant) && (!round.eligible || round.eligible.includes(contestant))
  }
  // A tile every second or so, until one letter is left; then a last few seconds to buzz in.
  function scheduleReveal(game) {
    const round = game.round
    schedule(game, 'wheel', round.blanksLeft <= 1 ? WHEEL_TIMES.tossupLastMs : WHEEL_TIMES.tossupRevealMs, () => revealTick(game, round))
  }
  function revealTick(game, round) {
    if (game.round !== round || round.phase !== 'tossupReveal' || game.status !== 'playing') return
    const flags = shownFlags(round), hidden = flags.filter((shown) => !shown).length
    if (hidden <= 1) { endRoundUnsolved(game); emitGame(game); return }
    const next = round.order.find((k) => !flags[k])
    round.revealed.push(next)
    round.blanksLeft = hidden - 1
    event(game, 'tile')
    scheduleReveal(game)
    emitGame(game)
  }
  function buzz(game, playerId) {
    const round = game.round, contestant = game.players.get(playerId)?.contestant
    if (round?.phase !== 'tossupReveal' || !canBuzz(game, contestant)) return
    round.control = contestant; round.actorId = playerId
    event(game, 'buzz', { contestant })
    setPhase(game, 'tossupSolve')
  }
  // A wrong toss-up solve (or none in time): that contestant sits out the rest of it, and the tiles keep coming.
  function lockOut(game, why = 'wrongSolve') {
    const round = game.round
    event(game, why, { contestant: round.control, text: why === 'wrongSolve' ? round.lastSolve?.text || null : null })
    round.lockedOut.push(round.control)
    round.control = null; round.actorId = null
    const anyone = game.contestants.some((_, i) => canBuzz(game, i))
    if (anyone) setPhase(game, 'tossupReveal')
    else endRoundUnsolved(game)
  }
  function winTossup(game, contestant) {
    const round = game.round, winner = game.contestants[contestant]
    round.shown = Object.keys(round.puzzle.counts)
    round.winner = contestant
    round.awarded = round.tossupValue
    winner.total += round.awarded
    winner.solvedAny = true
    round.actorId = null
    if (round.type === 'tossup') game.startNext = contestant
    event(game, 'solve', { contestant, amount: round.awarded, tossup: true })
    setPhase(game, 'roundEnd')
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
    round.actorId = contestant == null ? null : nextActor(game, contestant)
    round.express = false; round.landed = null; round.wildChance = null
    if (!round.speedUp) round.value = null
    setPhase(game, round.speedUp?.value ? 'speedLetter' : round.speedUp ? 'finalSpin' : 'turn')
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
    if (round.phase === 'turn' && lettersLeft(round, CONSONANTS)) { round.wildChance = null; spinWheel(game, power) }
    else if (round.phase === 'finalSpin') spinWheel(game, power)
  }
  function spinWheel(game, power) {
    const round = game.round, slots = round.wheel.length * SLOTS_PER_WEDGE
    // jitter is where in its slot the pointer stops (-0.4 to 0.4 of a slot), so every screen draws the same landing.
    round.spin = { id: (round.spin?.id || 0) + 1, slot: Math.floor(random() * slots), jitter: random() * 0.8 - 0.4, power: Math.min(1, Math.max(0, Number(power) || 0.6)), ms: WHEEL_TIMES.spinMs }
    event(game, 'spin', { contestant: round.control })
    setPhase(game, 'spinning')
  }
  function land(game) {
    const round = game.round, index = Math.floor(round.spin.slot / SLOTS_PER_WEDGE), wedge = round.wheel[index]
    // The Million Dollar wedge is three slots: Bankrupt, the million, Bankrupt.
    const kind = wedge.kind === 'million' && round.spin.slot % SLOTS_PER_WEDGE !== 1 ? 'bankrupt' : wedge.kind
    event(game, 'land', { contestant: round.control, kind, value: wedge.value, wild: !!wedge.wild, final: !!round.speedUp })
    // The final spin only sets the speed-up's value: anything that isn't money is spun again.
    if (round.speedUp) {
      if (kind !== 'cash') { spinWheel(game, 0.6); return }
      round.speedUp.value = wedge.value + SPEED_UP_BONUS
      round.value = round.speedUp.value
      event(game, 'speedUpValue', { value: round.value })
      setPhase(game, 'speedLetter')
      return
    }
    if (kind === 'bankrupt') { goBankrupt(game); passControl(game) }
    else if (kind === 'loseTurn') passControl(game)
    else { round.landed = { index, kind, value: wedge.value, wild: !!wedge.wild }; round.value = wedge.value; setPhase(game, 'consonant') }
  }
  // Bankrupt takes the round's money and gifts, and the Wild Card and Million Dollar wedge even if they were
  // won in an earlier round. Money banked in earlier rounds is safe.
  function goBankrupt(game, why = null) {
    Object.assign(bankOf(game), { roundBank: 0, roundPrizes: [], millionThisRound: false, wildCard: false, million: false })
    if (why) event(game, 'bankrupt', { contestant: game.round.control, why })
  }
  // A consonant after a spin, or during the Express (no spin, $1,000 a letter, and a miss is Bankrupt).
  function callConsonant(game, letter) {
    const round = game.round, express = round.phase === 'express'
    if ((round.phase !== 'consonant' && !express) || !CONSONANTS.includes(letter) || round.called.includes(letter)) return
    round.called.push(letter)
    round.wildChance = null
    const count = round.puzzle.counts[letter] || 0, contestant = bankOf(game)
    const landed = express ? { kind: 'express', value: SPECIAL_VALUES.express } : round.landed
    if (!count) {
      event(game, 'miss', { contestant: round.control, letter })
      if (express) goBankrupt(game, 'express')
      passControl(game)
      return
    }
    round.shown.push(letter)
    round.value = null
    // On a Mystery wedge the money waits for the choice: take it, or flip the wedge over.
    if (landed.kind === 'mystery') { round.mysteryCount = count; event(game, 'hit', { contestant: round.control, letter, count, amount: null }); setPhase(game, 'mystery'); return }
    contestant.roundBank += landed.value * count
    event(game, 'hit', { contestant: round.control, letter, count, amount: landed.value * count })
    claimWedge(game, landed)
    if (allShown(round)) { win(game, round.control); return }
    if (express) { setPhase(game, 'express'); return }
    if (landed.kind === 'express') { setPhase(game, 'expressChoice'); return }
    // Holding the Wild Card, they can call a second consonant for the same value straight away.
    if (!landed.usedWild) round.wildChance = landed.value
    setPhase(game, 'turn')
  }
  // A right letter on the Gift, the Million Dollar wedge or the Wild Card picks it up and takes it off the wheel.
  function claimWedge(game, landed) {
    const round = game.round, contestant = bankOf(game), wedge = round.wheel[landed.index]
    if (landed.kind === 'gift' && round.gift) {
      contestant.roundPrizes.push(round.gift)
      event(game, 'gift', { contestant: round.control, ...round.gift })
      round.gift = null
      round.wheel[landed.index] = { kind: 'cash', value: SPECIAL_VALUES.gift }
    }
    if (landed.kind === 'million') {
      contestant.millionThisRound = true
      event(game, 'million', { contestant: round.control })
      round.wheel[landed.index] = { kind: 'cash', value: MILLION_STAND_IN }
    }
    if (landed.wild && wedge?.wild) {
      contestant.wildCard = true
      delete wedge.wild
      event(game, 'wild', { contestant: round.control })
    }
  }
  function useWild(game) {
    const round = game.round, contestant = bankOf(game)
    if (round.phase !== 'turn' || !round.wildChance || !contestant.wildCard || !lettersLeft(round, CONSONANTS)) return
    contestant.wildCard = false
    round.landed = { kind: 'cash', value: round.wildChance, usedWild: true }
    round.value = round.wildChance
    round.wildChance = null
    event(game, 'wildUsed', { contestant: round.control })
    setPhase(game, 'consonant')
  }
  function chooseMystery(game, flip) {
    const round = game.round, contestant = bankOf(game), landed = round.landed
    if (round.phase !== 'mystery') return
    if (!flip) {
      contestant.roundBank += landed.value * round.mysteryCount
      event(game, 'mysteryTake', { contestant: round.control, amount: landed.value * round.mysteryCount })
    } else {
      // Flipping gives up the letter money for whatever is on the back. After that, neither wedge can be flipped.
      const won = landed.index === round.mysteryTenK
      round.mysteryFlipped = true
      round.wheel = round.wheel.map((wedge) => (wedge.kind === 'mystery' ? { kind: 'cash', value: SPECIAL_VALUES.mystery } : wedge))
      event(game, 'mysteryFlip', { contestant: round.control, won, amount: won ? MYSTERY_PRIZE : 0 })
      if (!won) { goBankrupt(game); passControl(game); return }
      contestant.roundBank += MYSTERY_PRIZE
    }
    if (allShown(round)) { win(game, round.control); return }
    round.wildChance = landed.value
    setPhase(game, 'turn')
  }
  function chooseExpress(game, play) {
    const round = game.round
    if (round.phase !== 'expressChoice') return
    if (play) { round.express = true; event(game, 'expressPlay', { contestant: round.control }); setPhase(game, 'express'); return }
    round.wildChance = SPECIAL_VALUES.express
    setPhase(game, 'turn')
  }
  function buyVowel(game, letter) {
    const round = game.round, bank = bankOf(game), express = round.phase === 'express'
    if ((round.phase !== 'turn' && !express) || !isVowel(letter) || round.called.includes(letter) || bank.roundBank < VOWEL_COST || !lettersLeft(round, VOWELS)) return
    bank.roundBank -= VOWEL_COST
    round.called.push(letter)
    round.wildChance = null
    const count = round.puzzle.counts[letter] || 0
    if (!count) {
      event(game, 'miss', { contestant: round.control, letter, vowel: true })
      if (express) goBankrupt(game, 'express')
      passControl(game)
      return
    }
    round.shown.push(letter)
    event(game, 'hit', { contestant: round.control, letter, count, amount: 0, vowel: true })
    if (allShown(round)) win(game, round.control)
    else setPhase(game, express ? 'express' : 'turn')
  }
  function startSolve(game) {
    const round = game.round
    if (!['turn', 'speedLetter', 'express'].includes(round.phase)) return
    round.wildChance = null
    event(game, 'solving', { contestant: round.control })
    setPhase(game, round.phase === 'speedLetter' ? 'speedSolve' : 'solving')
  }
  const SOLVE_PHASES = ['solving', 'tossupSolve', 'speedSolve']
  function solve(game, playerId, rawGuess) {
    const round = game.round
    if (!SOLVE_PHASES.includes(round.phase)) return
    const guess = String(rawGuess ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 60)
    const correct = guess === hiddenLetters(round).join('')
    round.lastSolve = { playerId, contestant: round.control, text: attempt(round, guess), correct }
    ruleSolve(game, correct)
  }
  function ruleSolve(game, correct) {
    const round = game.round
    if (round.phase === 'tossupSolve') { if (correct) winTossup(game, round.control); else lockOut(game); return }
    if (correct) { win(game, round.control); return }
    event(game, 'wrongSolve', { contestant: round.control, text: round.lastSolve?.text || null })
    // In the speed-up, wrong tries are allowed until the clock runs out. On the Express, a wrong solve is Bankrupt.
    if (round.phase === 'speedSolve') return
    if (round.express) goBankrupt(game, 'express')
    passControl(game)
  }
  // Solving banks the round's money and gifts (and the Prize Puzzle's trip). Cash and prizes together are
  // worth at least $1,000. A Million Dollar wedge picked up this round is now theirs to keep.
  function win(game, contestant) {
    const round = game.round, winner = game.contestants[contestant]
    const prizes = [...winner.roundPrizes, ...(round.prizePuzzle ? [round.prizePuzzle] : [])]
    const prizeValue = prizes.reduce((sum, prize) => sum + prize.value, 0)
    round.shown = Object.keys(round.puzzle.counts)
    round.winner = contestant
    round.prizesWon = prizes
    round.awarded = Math.max(winner.roundBank, SOLVE_MINIMUM - prizeValue) + prizeValue
    winner.total += round.awarded
    winner.prizes.push(...prizes)
    if (winner.millionThisRound) winner.million = true
    winner.solvedAny = true
    game.contestants.forEach((other) => Object.assign(other, { roundBank: 0, roundPrizes: [], millionThisRound: false }))
    round.actorId = null; round.express = false; round.wildChance = null
    event(game, 'solve', { contestant, amount: round.awarded, prizes })
    setPhase(game, 'roundEnd')
  }
  // Nobody solved it (the host gave up on it, or a toss-up ran out): show it, nobody banks anything.
  function endRoundUnsolved(game) {
    const round = game.round
    round.shown = Object.keys(round.puzzle.counts)
    round.winner = null; round.awarded = 0; round.actorId = null; round.control = null; round.express = false; round.wildChance = null
    game.contestants.forEach((contestant) => Object.assign(contestant, { roundBank: 0, roundPrizes: [], millionThisRound: false }))
    event(game, 'roundSkipped')
    setPhase(game, 'roundEnd')
  }

  // ---------- The speed-up ----------
  const speedUpDue = (game) => {
    const round = game.round
    return round.type === 'final' && !round.speedUp && round.speedUpAt != null && Date.now() >= round.speedUpAt && !game.clocksPaused
  }
  function startSpeedUp(game) {
    const round = game.round
    round.speedUp = { value: null }
    round.value = null
    event(game, 'speedUp', { contestant: round.control })
    setPhase(game, 'finalSpin')
  }
  // Any letter: a consonant pays the speed-up value for each time it appears, a vowel is free. A letter
  // that's there gives the same contestant a few seconds to solve; one that isn't passes control.
  function speedLetter(game, letter) {
    const round = game.round
    if (round.phase !== 'speedLetter' || !isLetter(letter) || letter.length !== 1 || round.called.includes(letter)) return
    round.called.push(letter)
    const count = round.puzzle.counts[letter] || 0
    if (!count) { event(game, 'miss', { contestant: round.control, letter, vowel: isVowel(letter) }); passControl(game); return }
    round.shown.push(letter)
    const amount = isVowel(letter) ? 0 : round.speedUp.value * count
    bankOf(game).roundBank += amount
    event(game, 'hit', { contestant: round.control, letter, count, amount, vowel: isVowel(letter) })
    if (allShown(round)) win(game, round.control)
    else setPhase(game, 'speedSolve')
  }

  // ---------- The bonus round ----------
  // [clock, waits on the player (pausable, and doubled at relaxed pace)]. With a host, the host opens the
  // envelope's result up to the final scores; without one, they follow by themselves.
  const BONUS_TIME = {
    pick: ['pickMs', true], spin: ['decideMs', true], spinning: ['spinMs'], given: ['lightMs'],
    letters: ['bonusLettersMs', true], lighting: ['lightMs'], solve: ['quickSolveMs', true], envelope: ['envelopeMs'],
  }
  function startBonus(game) {
    const contestant = game.contestants[game.winner]
    // Shuffled so the $100,000 envelope (or $1,000,000) could be anywhere.
    const values = BONUS_ENVELOPES.map((value) => (value === 100000 && contestant.million ? MILLION_PRIZE : value))
    game.status = 'bonus'
    game.bonus = {
      contestant: game.winner, playerId: members(game, game.winner).find((player) => player.socketId)?.id || null,
      choices: game.config.bonus, choice: null, puzzle: null, shown: [...BONUS_GIVEN], revealed: [], picked: [],
      extra: !!contestant.wildCard, million: !!contestant.million,
      envelopes: values.map((value) => [random(), value]).sort((a, b) => a[0] - b[0]).map(([, value]) => value),
      spin: null, envelope: null, prize: null, solved: null, lastSolve: null, phase: null, deadline: null, pausedMs: null,
    }
    event(game, 'bonus', { contestant: game.winner })
    setBonusPhase(game, 'pick')
    emitGame(game)
  }
  function setBonusPhase(game, phase) {
    const bonus = game.bonus, [key, waits] = BONUS_TIME[phase]
    bonus.phase = phase; bonus.deadline = null; bonus.pausedMs = null
    clearGameTimers(game)
    if (phase === 'envelope' && !game.hostless) return
    const ms = WHEEL_TIMES[key] * (game.config.pace === 'relaxed' && RELAXED.has(key) ? 2 : 1)
    if (waits && game.clocksPaused) { bonus.pausedMs = ms; return }
    runBonusClock(game, ms)
  }
  function runBonusClock(game, ms) {
    const bonus = game.bonus, phase = bonus.phase
    bonus.deadline = Date.now() + ms; bonus.pausedMs = null
    schedule(game, 'wheel', ms, () => bonusTimedOut(game, bonus, phase))
  }
  function bonusTimedOut(game, bonus, phase) {
    if (game.bonus !== bonus || bonus.phase !== phase || game.status !== 'bonus') return
    // Anything the player didn't do in time is done for them, except the letters (they just get none) and the solve.
    if (phase === 'pick') pickBonus(game, Math.floor(random() * bonus.choices.length))
    else if (phase === 'spin') spinBonus(game, 0.6)
    else if (phase === 'spinning') { bonus.envelope = Math.floor(bonus.spin.slot / SLOTS_PER_WEDGE); event(game, 'envelopeLanded'); setBonusPhase(game, 'given') }
    else if (phase === 'given') setBonusPhase(game, 'letters')
    else if (phase === 'letters') lightBonus(game, [])
    else if (phase === 'lighting') setBonusPhase(game, 'solve')
    else if (phase === 'solve') openEnvelope(game, false)
    else if (phase === 'envelope') { complete(game); return }
    emitGame(game)
  }
  function pickBonus(game, index) {
    const bonus = game.bonus, puzzle = bonus.choices[Math.trunc(Number(index))]
    if (bonus.phase !== 'pick' || !puzzle) return
    bonus.choice = bonus.choices.indexOf(puzzle)
    bonus.puzzle = { ...puzzle, rows: layoutPuzzle(puzzle.text).rows, counts: letterCounts(puzzle.text) }
    event(game, 'bonusPick', { category: puzzle.category })
    setBonusPhase(game, 'spin')
    sendSecret(game)
  }
  function spinBonus(game, power) {
    const bonus = game.bonus
    if (bonus.phase !== 'spin') return
    const slots = bonus.envelopes.length * SLOTS_PER_WEDGE
    bonus.spin = { id: (bonus.spin?.id || 0) + 1, slot: Math.floor(random() * slots), jitter: random() * 0.8 - 0.4, power: Math.min(1, Math.max(0, Number(power) || 0.6)), ms: WHEEL_TIMES.spinMs }
    event(game, 'spin', { contestant: bonus.contestant, bonus: true })
    setBonusPhase(game, 'spinning')
  }
  // Three consonants (four with the Wild Card) and a vowel, none of them already given.
  function chooseBonusLetters(game, consonants, vowel) {
    const bonus = game.bonus
    if (bonus.phase !== 'letters') return
    const want = BONUS_PICKS.consonants + (bonus.extra ? 1 : 0)
    const picked = [...new Set((Array.isArray(consonants) ? consonants : []).map((letter) => String(letter).toUpperCase()))]
    const v = String(vowel ?? '').toUpperCase()
    if (picked.length !== want || picked.some((letter) => !CONSONANTS.includes(letter) || BONUS_GIVEN.includes(letter))) return
    if (!isVowel(v) || BONUS_GIVEN.includes(v)) return
    lightBonus(game, [...picked, v])
  }
  function lightBonus(game, letters) {
    const bonus = game.bonus
    bonus.picked = letters
    bonus.shown.push(...letters)
    event(game, 'bonusLetters', { letters, found: letters.filter((letter) => bonus.puzzle.counts[letter]) })
    setBonusPhase(game, allShown(bonus) ? 'solve' : 'lighting')
  }
  function solveBonus(game, playerId, rawGuess) {
    const bonus = game.bonus
    if (bonus.phase !== 'solve') return
    const guess = String(rawGuess ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 60)
    const correct = guess === hiddenLetters(bonus).join('')
    bonus.lastSolve = { playerId, text: attempt(bonus, guess), correct }
    ruleBonus(game, correct)
  }
  // Wrong tries are allowed until the ten seconds are up.
  function ruleBonus(game, correct) {
    if (correct) openEnvelope(game, true)
    else event(game, 'wrongSolve', { contestant: game.bonus.contestant, text: game.bonus.lastSolve?.text || null, bonus: true })
  }
  function openEnvelope(game, solved) {
    const bonus = game.bonus, contestant = game.contestants[bonus.contestant]
    bonus.solved = solved
    bonus.prize = bonus.envelopes[bonus.envelope ?? 0]
    bonus.shown = Object.keys(bonus.puzzle.counts)
    if (solved) contestant.total += bonus.prize
    event(game, 'envelope', { contestant: bonus.contestant, solved, prize: bonus.prize })
    setBonusPhase(game, 'envelope')
  }

  // ---------- Pausing (host) ----------
  function pause(game) {
    const round = game.round
    if (game.clocksPaused) return
    game.clocksPaused = true
    const bonus = game.status === 'bonus' && game.bonus
    if (bonus && BONUS_TIME[bonus.phase]?.[1] && bonus.deadline) {
      bonus.pausedMs = Math.max(0, bonus.deadline - Date.now()); bonus.deadline = null
      clearGameTimers(game)
      return
    }
    if (!round || bonus) return
    if (round.speedUpAt != null && !round.speedUp) round.speedUpLeft = Math.max(0, round.speedUpAt - Date.now())
    if (ACTOR_PHASES.includes(round.phase) && round.deadline) {
      round.pausedMs = Math.max(0, round.deadline - Date.now()); round.deadline = null
      clearGameTimers(game)
    }
    if (round.phase === 'tossupReveal') clearGameTimers(game)
  }
  function resume(game) {
    const round = game.round
    if (!game.clocksPaused) return
    game.clocksPaused = false
    if (game.status === 'bonus') { if (game.bonus?.pausedMs != null) runBonusClock(game, game.bonus.pausedMs); return }
    if (!round || game.status !== 'playing') return
    if (round.speedUpLeft != null) { round.speedUpAt = Date.now() + round.speedUpLeft; round.speedUpLeft = null }
    if (round.pausedMs != null) runClock(game, round.pausedMs)
    else if (round.phase === 'tossupReveal') scheduleReveal(game)
  }

  // ---------- Players coming and going ----------
  // A player left (after the reconnect grace period) or was kicked: if the game was waiting on them, move on.
  function handOff(game, playerId) {
    const round = game.round
    if (game.status !== 'playing' || !round || round.actorId !== playerId) return
    // On a team, a teammate takes over the same turn, clock and all.
    const teammate = isTeams(game) && round.control != null && members(game, round.control).find((player) => player.socketId && player.id !== playerId)
    if (teammate) { round.actorId = teammate.id; return }
    if (round.phase === 'tossupSolve') lockOut(game, 'timeout')
    else if (ACTOR_PHASES.includes(round.phase)) passControl(game)
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
    // Before a solo game starts their podium goes too; once it's running, their score stays on the board.
    // Team podiums stay put.
    if (game.status === 'lobby' && !isTeams(game) && !members(game, player.contestant).length) {
      game.contestants.splice(player.contestant, 1)
      for (const other of game.players.values()) if (other.contestant > player.contestant) other.contestant--
    } else handOff(game, player.id)
  }

  // ---------- Undo (host) ----------
  // The round as it was before the last player action or host ruling, so the host can take it back (a
  // mis-tap on a phone, or a wrong call on a spoken solve). Only one step, and only within the round.
  function withUndo(game, act) {
    const before = game.undo, seq = game.eventSeq
    if (game.status === 'playing' && game.round) game.undo = JSON.stringify({ round: game.round, contestants: game.contestants, startNext: game.startNext })
    act()
    // An action that changed nothing (every change is announced with an event) keeps the older snapshot.
    if (game.eventSeq === seq) game.undo = before
  }
  function undo(game) {
    if (!game.undo || game.status !== 'playing') return
    const saved = JSON.parse(game.undo)
    game.undo = null
    Object.assign(game, { round: saved.round, contestants: saved.contestants, startNext: saved.startNext })
    event(game, 'undo')
    // The restored phase's clock starts again from the top; a spin restored mid-air lands straight away.
    if (game.round.phase === 'spinning') land(game)
    else setPhase(game, game.round.phase)
  }

  // Switching teams. Mid-game, if the team was waiting on them, a teammate (or the next team) takes over.
  function movePlayer(game, playerId, contestant) {
    const player = game.players.get(playerId), to = Math.trunc(Number(contestant))
    if (!player || !game.contestants[to] || player.contestant === to) return
    handOff(game, player.id)
    player.contestant = to
  }

  function hostAction(game, action, payload) {
    const round = game.round, playing = game.status === 'playing' && round
    if (action === 'start' && game.status === 'lobby') {
      if (!game.contestants.some((_, i) => present(game, i))) return emitGame(game)
      Object.assign(game, freshPlay(game.config), { status: 'playing' })
      startSegment(game)
    }
    if (action === 'judgeSolve' && playing && SOLVE_PHASES.includes(round.phase)) withUndo(game, () => {
      round.lastSolve = { playerId: round.actorId, contestant: round.control, text: null, correct: !!payload.correct, byHost: true }
      ruleSolve(game, !!payload.correct)
    })
    if (action === 'undo' && playing) undo(game)
    const bonus = game.status === 'bonus' && game.bonus
    if (action === 'judgeSolve' && bonus?.phase === 'solve') {
      bonus.lastSolve = { playerId: bonus.playerId, text: null, correct: !!payload.correct, byHost: true }
      ruleBonus(game, !!payload.correct)
    }
    if (action === 'finishBonus' && bonus?.phase === 'envelope') { complete(game); return }
    if (action === 'endGame' && bonus) { complete(game); return }
    if (action === 'pause' && (playing || bonus)) pause(game)
    if (action === 'resume' && (playing || bonus)) resume(game)
    if (action === 'skipTurn' && playing && ACTOR_PHASES.includes(round.phase)) withUndo(game, () => {
      if (round.phase === 'tossupSolve') lockOut(game, 'skipped')
      else { event(game, 'skipped', { contestant: round.control }); passControl(game) }
    })
    // Starts at the next turn (straight away if someone is deciding what to do now).
    if (action === 'speedUp' && playing && round.type === 'final' && !round.speedUp) {
      round.speedUpAt = Date.now(); round.speedUpLeft = null
      if (round.phase === 'turn') startSpeedUp(game)
    }
    if (action === 'revealPuzzle' && playing && round.phase !== 'roundEnd') withUndo(game, () => endRoundUnsolved(game))
    if (action === 'nextSegment' && playing && round.phase === 'roundEnd') { nextSegment(game); return }
    // Ending early skips the bonus round.
    if (action === 'endGame' && game.status === 'playing') { endMainGame(game, { bonus: false }); return }
    if (action === 'adjustScore') {
      const contestant = game.contestants[payload.contestant], amount = Math.trunc(Number(payload.amount))
      if (contestant && Number.isFinite(amount)) contestant.total += amount
    }
    if (action === 'renamePlayer') {
      const player = game.players.get(payload.playerId), name = text(payload.name, 20)
      if (player && name) { player.name = name; if (!isTeams(game)) game.contestants[player.contestant].name = name }
    }
    if (action === 'renameTeam' && isTeams(game)) {
      const team = game.contestants[payload.contestant], name = text(payload.name, 24)
      if (team && name) { team.name = name; game.config.teamNames[payload.contestant] = name }
    }
    if (action === 'movePlayer' && isTeams(game)) movePlayer(game, payload.playerId, payload.contestant)
    if (action === 'kickPlayer') kick(game, payload.playerId)
    if (action === 'replay') {
      try {
        if (payload.segments) Object.assign(game.config, cleanConfig({ ...game.config, segments: payload.segments, spares: payload.spares, bonus: payload.bonus, ...(payload.gifts && { gifts: payload.gifts, trip: payload.trip }) }))
      } catch {}
      clearGameTimers(game)
      Object.assign(game, freshPlay(game.config), { status: 'lobby', lastEvent: null })
      game.contestants.forEach((contestant, i) => { game.contestants[i] = freshContestant(contestant.name) })
    }
    emitGame(game)
  }

  function register(socket) {
    // Every phone action but the toss-up buzzer comes from the player whose turn it is, on their own connection.
    const on = (name, handle) => socket.on(`wheel:${name}`, (payload = {}) => {
      const game = wheelGame(payload.code)
      if (!isLive(game, payload.playerId, socket) || game.status !== 'playing' || game.round?.actorId !== payload.playerId) return
      withUndo(game, () => handle(game, payload))
      emitGame(game)
    })
    const letterIn = (value) => String(value ?? '').toUpperCase().slice(0, 1)
    on('spin', (game, { power }) => spin(game, power))
    on('consonant', (game, { letter }) => callConsonant(game, letterIn(letter)))
    on('buyVowel', (game, { letter }) => buyVowel(game, letterIn(letter)))
    on('letter', (game, { letter }) => speedLetter(game, letterIn(letter)))
    on('solveStart', (game) => startSolve(game))
    on('wild', (game) => useWild(game))
    on('mystery', (game, { flip }) => chooseMystery(game, !!flip))
    on('express', (game, { play }) => chooseExpress(game, !!play))
    on('solve', (game, { playerId, guess }) => solve(game, playerId, guess))
    // The bonus round's player, on their own connection. On a team, the whole team plays it: any member can
    // pick, spin, choose the letters or type the solve.
    const onBonus = (name, handle) => socket.on(`wheel:${name}`, (payload = {}) => {
      const game = wheelGame(payload.code)
      if (!isLive(game, payload.playerId, socket) || game.status !== 'bonus' || game.players.get(payload.playerId)?.contestant !== game.bonus?.contestant) return
      handle(game, payload)
      emitGame(game)
    })
    onBonus('bonusPick', (game, { index }) => pickBonus(game, index))
    onBonus('bonusSpin', (game, { power }) => spinBonus(game, power))
    onBonus('bonusLetters', (game, { consonants, vowel }) => chooseBonusLetters(game, consonants, vowel))
    onBonus('bonusSolve', (game, { playerId, guess }) => solveBonus(game, playerId, guess))
    // Choosing a team before the game starts.
    socket.on('wheel:team', ({ code, playerId, contestant } = {}) => {
      const game = wheelGame(code)
      if (!isLive(game, playerId, socket) || game.status !== 'lobby' || !isTeams(game)) return
      movePlayer(game, playerId, contestant)
      emitGame(game)
    })
    socket.on('wheel:buzz', ({ code, playerId } = {}) => {
      const game = wheelGame(code)
      if (!isLive(game, playerId, socket) || game.status !== 'playing' || !game.round) return
      withUndo(game, () => buzz(game, playerId))
      emitGame(game)
    })
  }

  return { MAX_PLAYERS: MAX_SOLO, maxPlayers, makeGame, publicGame, playerJoined, playerLeft, hostAction, hostJoined, register }
}
