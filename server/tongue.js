// Tip of the Tongue — a team word game in the style of the TV word-clue shows.
//
// Teams of two (an odd player makes one team of three). Each round, every team takes a turn: once the clue-giver
// is ready, they have TONGUE_TIMES.playMs to clue their partner through seven words drawn at random from the
// game's word pool (the host picks which categories go into it at setup; players never see a category). A word the
// partner gets scores a point and brings the next; a passed word goes to the back of the line (passes are
// unlimited); a foul (saying the word) throws it out. Clearing all seven banks a bonus point for every second left
// on the clock. Partners swap roles every round; in the last round each team chooses who gives the clues.
//
// Guessing is set per game: "aloud" (the partner says it; the clue-giver, or a host, taps Got it) or "typed" (the
// partner types it and the server checks it). The word is only ever shown on the clue-giver's phone and the host
// controller, which ask for it with tongue:peek; it never goes out in the game state.
import { answersMatch } from './text.js'

export const TONGUE_TIMES = { chooseMs: 15000, readyMs: 15000, playMs: 45000, doneMs: 8000 }
export const WORDS_PER_TURN = 7
const MAX_PLAYERS = 12
const MAX_WORDS = 1000

const text = (value, max) => String(value ?? '').trim().slice(0, max)
// The word pool arrives shuffled; turns deal from it in order, so no word comes up twice until the pool runs out.
function cleanConfig(config) {
  const seen = new Set()
  const words = (Array.isArray(config?.words) ? config.words : []).slice(0, MAX_WORDS).map((word) => text(word, 40))
    .filter((word) => word && !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()))
  if (words.length < WORDS_PER_TURN) throw new Error(`Pick categories with at least ${WORDS_PER_TURN} words between them.`)
  const rounds = Math.max(3, Math.min(5, Math.trunc(Number(config?.rounds)) || 3))
  return { words, rounds, guessing: config?.guessing === 'aloud' ? 'aloud' : 'typed', hostless: !!config?.hostless }
}

export function createTongueGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave, random = Math.random }) {
  const tongueGame = (code) => { const game = games.get(code); return game?.kind === 'tongue' ? game : undefined }
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const live = (game, ids) => ids.filter((id) => isLive(game, id))
  const teamOf = (game, playerId) => game.teams.find((team) => team.members.includes(playerId))
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: Date.now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return { kind: 'tongue', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config, teams: [], teamSeq: 0, roundIndex: 0, order: [], turn: null, dealt: 0, lastEvent: null }
  }
  const newTeam = (game) => { game.teamSeq++; const team = { id: `t${game.teamSeq}`, name: `Team ${game.teamSeq}`, members: [], score: 0 }; game.teams.push(team); return team }
  // Players pair up in the order they join.
  function playerJoined(game, player) {
    const last = game.teams.at(-1)
    const team = last && last.members.length < 2 ? last : newTeam(game)
    team.members.push(player.id)
  }

  function publicTurn(game) {
    const turn = game.turn
    if (!turn) return null
    const done = turn.phase === 'done'
    return {
      teamId: turn.teamId, phase: turn.phase, deadline: turn.deadline, clueGiverId: turn.clueGiverId, seq: turn.seq,
      // Words the team got are safe to show as they land; passed ones would give the game away.
      got: turn.words.filter((word) => word.status === 'got').map((word) => word.text),
      total: turn.words.length, left: turn.queue.length, points: turn.points, bonus: turn.bonus,
      results: done ? turn.words : null, lastGuess: turn.lastGuess,
    }
  }
  function publicGame(game) {
    return {
      kind: 'tongue', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      guessing: game.config.guessing, rounds: game.config.rounds, roundIndex: game.roundIndex,
      teams: game.teams, order: game.order, turn: publicTurn(game),
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // ---------- Turns ----------
  const PHASE_TIME = { choose: 'chooseMs', ready: 'readyMs', play: 'playMs', done: 'doneMs' }
  function setPhase(game, phase) {
    const turn = game.turn
    turn.phase = phase
    const ms = phase === 'done' && !game.hostless ? null : TONGUE_TIMES[PHASE_TIME[phase]]
    turn.deadline = ms ? Date.now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'tongue', ms, () => { if (game.turn === turn && turn.phase === phase && game.status === 'playing') { advance(game); emitGame(game) } })
  }
  // The clock ran out or the host tapped Next.
  function advance(game) {
    const turn = game.turn
    if (turn.phase === 'choose') { turn.clueGiverId ||= defaultClueGiver(game, turn.teamId); setPhase(game, 'ready') }
    else if (turn.phase === 'ready') startPlay(game)
    else if (turn.phase === 'play') endTurn(game)
    else nextTurn(game)
  }
  const isLastRound = (game) => game.roundIndex === game.config.rounds - 1
  // Partners swap every round: the clue-giver is member (round number) of the team, wrapping for a team of three.
  function defaultClueGiver(game, teamId) {
    const team = game.teams.find((t) => t.id === teamId), members = live(game, team.members)
    return members[game.roundIndex % members.length]
  }

  function startRound(game) {
    game.order = game.teams.filter((team) => live(game, team.members).length >= 2).map((team) => team.id)
    if (!game.order.length) return finish(game)
    startTurn(game, game.order[0])
  }
  function startTurn(game, teamId) {
    game.turn = { teamId, phase: 'ready', deadline: null, clueGiverId: null, words: [], queue: [], seq: 0, points: 0, bonus: 0, lastGuess: null }
    event(game, 'turn', { teamId })
    if (isLastRound(game)) setPhase(game, 'choose')
    else { game.turn.clueGiverId = defaultClueGiver(game, teamId); setPhase(game, 'ready') }
  }
  // The next seven words from the pool (starting over from the top if a long game uses them all up).
  function deal(game) {
    const { words } = game.config, hand = []
    for (let i = 0; i < Math.min(WORDS_PER_TURN, words.length); i++) hand.push(words[(game.dealt + i) % words.length])
    game.dealt = (game.dealt + hand.length) % words.length
    return hand
  }
  function startPlay(game) {
    const turn = game.turn
    if (turn.phase !== 'ready') return false
    turn.words = deal(game).map((word) => ({ text: word, status: 'waiting' }))
    turn.queue = turn.words.map((_, i) => i)
    turn.seq++
    event(game, 'play', { teamId: turn.teamId })
    setPhase(game, 'play')
    return true
  }
  function nextTurn(game) {
    const at = game.order.indexOf(game.turn?.teamId)
    const next = game.order.slice(at + 1).find((id) => live(game, game.teams.find((t) => t.id === id)?.members || []).length >= 2)
    if (next) return startTurn(game, next)
    if (isLastRound(game)) return finish(game)
    game.roundIndex++
    startRound(game)
  }
  function endTurn(game) {
    const turn = game.turn
    for (const i of turn.queue) if (turn.words[i].status === 'waiting') turn.words[i].status = 'missed'
    turn.queue = []
    const team = game.teams.find((t) => t.id === turn.teamId)
    if (team) team.score += turn.points + turn.bonus
    event(game, 'turnEnd', { teamId: turn.teamId, points: turn.points, bonus: turn.bonus })
    setPhase(game, 'done')
  }
  function finish(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.turn) game.turn.deadline = null
    event(game, 'complete')
  }

  // ---------- Playing a word ----------
  function wordAction(game, action) {
    const turn = game.turn
    if (game.status !== 'playing' || turn?.phase !== 'play' || !turn.queue.length) return false
    const index = turn.queue[0], word = turn.words[index]
    if (action === 'got') { word.status = 'got'; turn.points++; turn.queue.shift() }
    else if (action === 'foul') { word.status = 'foul'; turn.queue.shift() }
    else if (action === 'pass') { word.status = 'passed'; turn.queue.push(turn.queue.shift()) }
    else return false
    turn.seq++
    event(game, action, { teamId: turn.teamId })
    // Every word got (no fouls, no misses): the seconds left on the clock are a bonus.
    if (!turn.queue.length) {
      if (turn.words.every((w) => w.status === 'got')) turn.bonus = Math.max(0, Math.ceil((turn.deadline - Date.now()) / 1000))
      endTurn(game)
    }
    return true
  }
  const isClueGiver = (game, playerId) => game.turn?.clueGiverId === playerId
  const isGuesser = (game, playerId) => { const turn = game.turn, team = turn && game.teams.find((t) => t.id === turn.teamId); return !!team?.members.includes(playerId) && turn.clueGiverId !== playerId }

  function guess(game, playerId, raw) {
    const turn = game.turn
    if (game.config.guessing !== 'typed' || turn?.phase !== 'play' || !isGuesser(game, playerId)) return { ok: false }
    const answer = text(raw, 60)
    if (!answer) return { ok: false }
    const word = turn.words[turn.queue[0]], correct = answersMatch(answer, word.text)
    turn.lastGuess = { text: answer, correct, at: Date.now() }
    if (correct) wordAction(game, 'got')
    return { ok: true, correct }
  }

  // ---------- Players coming and going ----------
  function handOff(game, playerId) {
    const turn = game.turn
    if (game.status !== 'playing' || !turn) return
    const team = game.teams.find((t) => t.id === turn.teamId)
    if (!team?.members.includes(playerId)) return
    const others = live(game, team.members)
    if (others.length < 2) { if (turn.phase === 'play') endTurn(game); else nextTurn(game); return }
    if (turn.clueGiverId === playerId) { turn.clueGiverId = others[0]; turn.seq++ }
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    handOff(game, playerId)
    emitGame(game)
  }
  function removeFromTeams(game, playerId) {
    for (const team of game.teams) team.members = team.members.filter((id) => id !== playerId)
    if (game.status === 'lobby') game.teams = game.teams.filter((team) => team.members.length)
  }

  function hostAction(game, action, payload) {
    const turn = game.turn, playing = game.status === 'playing' && turn
    if (action === 'start' && game.status === 'lobby') {
      // A team left with one player joins the team before it, making a team of three.
      for (let i = game.teams.length - 1; i > 0; i--) if (game.teams[i].members.length === 1) { game.teams[i - 1].members.push(...game.teams[i].members); game.teams.splice(i, 1) }
      if (game.teams.some((team) => live(game, team.members).length >= 2)) { game.status = 'playing'; game.roundIndex = 0; startRound(game) }
    }
    if (action === 'next' && playing) advance(game)
    if (['got', 'pass', 'foul'].includes(action) && playing) wordAction(game, action)
    if (action === 'skipTurn' && playing) { if (turn.phase === 'play') endTurn(game); else nextTurn(game) }
    if (action === 'endGame' && game.status === 'playing') finish(game)
    if (action === 'renameTeam') { const team = game.teams.find((t) => t.id === payload.teamId), name = text(payload.name, 24); if (team && name) team.name = name }
    if (action === 'adjustScore') { const team = game.teams.find((t) => t.id === payload.teamId), amount = Math.trunc(Number(payload.amount)); if (team && Number.isFinite(amount)) team.score += amount }
    if (action === 'renamePlayer') { const player = game.players.get(payload.playerId), name = text(payload.name, 20); if (player && name) player.name = name }
    // Lobby only: move a player to another team (or a new one).
    if (action === 'movePlayer' && game.status === 'lobby' && game.players.has(payload.playerId)) {
      removeFromTeams(game, payload.playerId)
      const target = game.teams.find((t) => t.id === payload.teamId) || newTeam(game)
      target.members.push(payload.playerId)
    }
    if (action === 'kickPlayer') {
      const player = game.players.get(payload.playerId)
      if (player) {
        cancelLeave(game.code, player.id)
        const socket = io.sockets.sockets.get(player.socketId)
        socket?.leave(game.code); socket?.emit('player:kicked')
        game.players.delete(player.id)
        handOff(game, player.id)
        removeFromTeams(game, player.id)
      }
    }
    if (action === 'replay') {
      let config = game.config
      try { if (payload.words) config = cleanConfig({ ...game.config, words: payload.words, hostless: game.hostless }) } catch {}
      clearGameTimers(game)
      Object.assign(game, { status: 'lobby', config, roundIndex: 0, order: [], turn: null, dealt: 0, lastEvent: null })
      for (const team of game.teams) team.score = 0
    }
    emitGame(game)
  }

  function register(socket) {
    // The current word, for the clue-giver's phone (and host controllers, in hosted games) only.
    socket.on('tongue:peek', ({ code, playerId } = {}, ack) => {
      const game = tongueGame(code), turn = game?.turn
      const allowed = turn?.phase === 'play' && ((playerId && isLive(game, playerId, socket) && isClueGiver(game, playerId)) || (!playerId && !game.hostless && socket.data.controllerGame === code))
      if (!allowed || !turn.queue.length) return ack?.({ ok: false })
      ack?.({ ok: true, word: turn.words[turn.queue[0]].text, seq: turn.seq })
    })
    socket.on('tongue:word', ({ code, playerId, action } = {}) => {
      const game = tongueGame(code)
      if (!isLive(game, playerId, socket) || !isClueGiver(game, playerId)) return
      if (action === 'got' && game.config.guessing !== 'aloud') return
      if (wordAction(game, action)) emitGame(game)
    })
    socket.on('tongue:guess', ({ code, playerId, guess: answer } = {}, ack) => {
      const game = tongueGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false })
      const result = guess(game, playerId, answer)
      ack?.(result)
      if (result.ok) emitGame(game)
    })
    // The clue-giver starts the clock when they're ready.
    socket.on('tongue:start', ({ code, playerId } = {}) => {
      const game = tongueGame(code)
      if (!isLive(game, playerId, socket) || !isClueGiver(game, playerId)) return
      if (startPlay(game)) emitGame(game)
    })
    // Last round: whoever on the team taps first gives the clues.
    socket.on('tongue:choose', ({ code, playerId } = {}) => {
      const game = tongueGame(code), turn = game?.turn
      if (!isLive(game, playerId, socket) || turn?.phase !== 'choose' || teamOf(game, playerId)?.id !== turn.teamId) return
      turn.clueGiverId = playerId
      setPhase(game, 'ready')
      emitGame(game)
    })
    socket.on('tongue:team', ({ code, playerId, teamId } = {}) => {
      const game = tongueGame(code)
      if (!isLive(game, playerId, socket) || game.status !== 'lobby') return
      removeFromTeams(game, playerId)
      ;(game.teams.find((t) => t.id === teamId) || newTeam(game)).members.push(playerId)
      emitGame(game)
    })
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, register }
}
