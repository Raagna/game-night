// Survey Says! — a two-team survey game in the style of Family Feud.
//
// Each round: one player from each team faces off on a survey question. The team that wins the face-off
// chooses to play or pass. The playing team takes turns guessing the remaining answers; three strikes and
// the other team gets one guess to steal everything banked so far. Round points are multiplied in later rounds.
//
// Hostless games match typed guesses to answers on the server. Hosted games let the host reveal answers and
// give strikes from the controller; the host can also undo the last ruling in either mode.
import { numberWordPattern, NUMBER_WORDS, editDistance, stripAccents } from './text.js'

export const SURVEY_TIMES = { readMs: 3000, buzzMs: 20000, faceoffAnswerMs: 15000, chooseMs: 10000, guessMs: 20000, stealMs: 30000, roundEndMs: 9000 }
const MAX_PLAYERS = 12
const MAX_ROUNDS = 8
// Face-off misses before control goes to a coin toss, so two stumped players can't stall the round.
const MAX_FACEOFF_MISSES = 6
const MULTIPLIERS = { 1: [1], 2: [1, 2], 3: [1, 1, 2], 4: [1, 1, 2, 3], 5: [1, 1, 1, 2, 3], 6: [1, 1, 1, 2, 2, 3], 7: [1, 1, 1, 2, 2, 3, 3], 8: [1, 1, 1, 1, 2, 2, 3, 3] }

// ---------- Matching typed guesses to survey answers ----------
const STOP_WORDS = new Set('a an the my your his her their our its some any to of go going get getting got be being is are was were it in on at for with and i im me we you they them he she just really probably definitely maybe um uh do does doing'.split(' '))
// A deliberately crude stemmer: it only has to turn both sides of a comparison into the same thing.
function stem(word) {
  let w = word
  if (/^\d+$/.test(w)) return w
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'i'
  else if (w.length > 4 && /(ss|x|ch|sh|z)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1)
  if (w.length > 3 && /[ey]$/.test(w)) w = w.slice(0, -1) + (w.endsWith('y') ? 'i' : '')
  return w
}
export function words(text) {
  return stripAccents(text).toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(numberWordPattern, (word) => String(NUMBER_WORDS[word]))
    .split(/[^a-z0-9]+/).filter((word) => word && !STOP_WORDS.has(word)).map(stem)
}
const similar = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 1 && editDistance(a, b) <= 1)
const contains = (tokens, token) => tokens.some((other) => similar(other, token))
function matchScore(guess, candidate) {
  const g = guess.join(''), c = candidate.join('')
  if (!g || !c) return 0
  if (g === c) return 100
  const allowed = c.length >= 10 ? 2 : c.length >= 5 ? 1 : 0
  if (allowed && Math.abs(g.length - c.length) <= allowed && editDistance(g, c) <= allowed) return 85
  // Every word of the answer is in the guess ("I'd walk my dog" for "Walk Dog"), without a lot of extra words.
  if (candidate.every((token) => contains(guess, token)) && guess.length <= candidate.length + 2) return 80
  // The guess is a meaningful part of a short answer ("teeth" for "Brush Teeth").
  if (candidate.length <= 3 && guess.length * 2 >= candidate.length && g.length >= 4 && guess.every((token) => contains(candidate, token))) return 70
  return 0
}
export function buildMatcher(survey) {
  return survey.answers.map((answer) => [...new Set([answer.text, answer.text.replace(/\([^)]*\)/g, ' '), ...(answer.alts || [])])].map(words).filter((tokens) => tokens.length))
}
// Index of the answer a guess matches best (higher-ranked answers win ties), or -1.
export function matchAnswer(matcher, text) {
  const guess = words(text)
  let best = -1, bestScore = 0
  matcher.forEach((variants, index) => {
    const score = Math.max(0, ...variants.map((variant) => matchScore(guess, variant)))
    if (score > bestScore) { best = index; bestScore = score }
  })
  return bestScore >= 70 ? best : -1
}

// ---------- Game setup ----------
const text = (value, max) => String(value ?? '').trim().slice(0, max)
function cleanConfig(config) {
  const surveys = (Array.isArray(config?.surveys) ? config.surveys : []).slice(0, MAX_ROUNDS).map((survey, i) => ({
    id: text(survey?.id, 40) || `q${i}`,
    question: text(survey?.question, 200),
    answers: (Array.isArray(survey?.answers) ? survey.answers : []).slice(0, 10).map((answer) => ({
      text: text(answer?.text, 40),
      points: Math.max(1, Math.min(100, Math.trunc(Number(answer?.points)) || 1)),
      alts: (Array.isArray(answer?.alts) ? answer.alts : []).slice(0, 12).map((alt) => text(alt, 40)).filter(Boolean),
    })).filter((answer) => answer.text).sort((a, b) => b.points - a.points),
  })).filter((survey) => survey.question && survey.answers.length >= 2)
  if (!surveys.length) throw new Error('A game needs at least one survey question with two or more answers.')
  const teamNames = [0, 1].map((i) => text(config?.teamNames?.[i], 24) || `Team ${i + 1}`)
  return { surveys, teamNames, hostless: !!config?.hostless }
}

export function createSurveyGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave }) {
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const surveyGame = (code) => { const game = games.get(code); return game?.kind === 'survey' ? game : undefined }
  const teamMembers = (game, team) => [...game.players.values()].filter((player) => player.team === team && player.socketId)
  const current = (game) => game.surveys[game.roundIndex]
  const multiplier = (game) => game.multipliers[game.roundIndex] || 1
  const allRevealed = (game) => game.round.revealed.every(Boolean)
  const other = (team) => 1 - team
  const event = (game, type, extra = {}) => { game.lastEvent = { type, at: Date.now(), ...extra } }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return {
      kind: 'survey', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config,
      teams: config.teamNames.map((name) => ({ name, score: 0 })),
      surveys: config.surveys, matchers: config.surveys.map(buildMatcher), multipliers: MULTIPLIERS[config.surveys.length],
      roundIndex: 0, round: null, rotation: { faceoff: [0, 0], guess: [0, 0] }, undo: null, lastEvent: null,
    }
  }
  // New players go to the smaller team, so teams stay even as people arrive.
  function playerJoined(game, player) {
    const sizes = [0, 1].map((team) => [...game.players.values()].filter((p) => p !== player && p.team === team).length)
    player.team = sizes[1] < sizes[0] ? 1 : 0
  }
  // Takes turns through a team's connected players.
  function nextFrom(game, kind, team) {
    const members = teamMembers(game, team)
    if (!members.length) return null
    const player = members[game.rotation[kind][team] % members.length]
    game.rotation[kind][team]++
    return player
  }

  function publicGame(game) {
    const round = game.round, survey = current(game)
    const showAll = !game.hostless || round?.phase === 'roundEnd' || game.status === 'complete'
    return {
      kind: 'survey', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      teams: game.teams, roundIndex: game.roundIndex, roundCount: game.surveys.length, multiplier: multiplier(game), multipliers: game.multipliers,
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      round: round && {
        phase: round.phase, question: survey.question, strikes: round.strikes, bank: round.bank, control: round.control,
        answers: survey.answers.map((answer, i) => round.revealed[i] || showAll ? { text: answer.text, points: answer.points, revealed: round.revealed[i], team: round.revealedBy[i] } : { revealed: false }),
        faceoff: round.faceoff, chooserId: round.chooserId, guesserId: round.guesserId, stealTeam: round.stealTeam,
        winner: round.winner, awarded: round.awarded, lastGuess: round.lastGuess, deadline: round.deadline,
      },
      canUndo: !!game.undo, serverNow: Date.now(), lastEvent: game.lastEvent,
    }
  }

  // ---------- Phases and their clocks ----------
  const PHASE_TIME = { faceoffRead: 'readMs', faceoff: 'buzzMs', faceoffAnswer: 'faceoffAnswerMs', choose: 'chooseMs', guessing: 'guessMs', steal: 'stealMs', roundEnd: 'roundEndMs' }
  function setPhase(game, phase) {
    const round = game.round
    round.phase = phase
    // Hosted games only run the short read-the-question pause; the host paces everything else.
    const ms = game.hostless || phase === 'faceoffRead' ? SURVEY_TIMES[PHASE_TIME[phase]] : null
    round.deadline = ms ? Date.now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'survey', ms, () => timedOut(game, round))
  }
  function timedOut(game, round) {
    if (game.round !== round || game.status !== 'playing') return
    const { phase, faceoff } = round
    if (phase === 'faceoffRead') setPhase(game, 'faceoff')
    else if (phase === 'faceoff') {
      // Nobody buzzed: one of the two face-off players is picked to answer.
      const present = faceoff.playerIds.filter((id) => isLive(game, id))
      if (!present.length) { setPhase(game, 'faceoff'); return }
      faceoff.answeringId = present[Math.floor(Math.random() * present.length)]
      setPhase(game, 'faceoffAnswer')
    } else if (phase === 'faceoffAnswer') { ruleMiss(game, faceoff.answeringId, '', 'timeout'); return }
    else if (phase === 'choose') { choose(game, true); return }
    else if (phase === 'guessing') { ruleMiss(game, round.guesserId, '', 'timeout'); return }
    else if (phase === 'steal') { ruleMiss(game, null, '', 'timeout'); return }
    else if (phase === 'roundEnd') { nextRound(game); return }
    emitGame(game)
  }

  function startRound(game) {
    clearGameTimers(game)
    game.undo = null
    const survey = current(game)
    const first = nextFrom(game, 'faceoff', 0), second = nextFrom(game, 'faceoff', 1)
    game.round = {
      phase: 'faceoffRead', revealed: survey.answers.map(() => false), revealedBy: survey.answers.map(() => null), strikes: 0, bank: 0, control: null,
      faceoff: { playerIds: [first?.id || null, second?.id || null], answeringId: null, firstHit: null, misses: 0 },
      chooserId: null, guesserId: null, stealTeam: null, winner: null, awarded: 0, lastGuess: null, deadline: null,
    }
    event(game, 'round', { roundIndex: game.roundIndex })
    if (first && second) setPhase(game, 'faceoffRead')
    else if (first || second) { game.round.control = first ? 0 : 1; startGuessing(game) }
    else setPhase(game, 'faceoffRead')
  }
  function nextRound(game) {
    if (game.roundIndex >= game.surveys.length - 1) { finish(game); return }
    game.roundIndex++
    startRound(game)
    emitGame(game)
  }
  function finish(game) {
    clearGameTimers(game)
    game.undo = null
    game.status = 'complete'
    if (game.round) { game.round.phase = 'roundEnd'; game.round.deadline = null }
    event(game, 'complete')
    emitGame(game)
  }

  // Face-off won: the winner chooses to play or pass (unless nothing is left to guess).
  function winFaceoff(game, team) {
    const round = game.round
    round.control = team
    round.faceoff.answeringId = null
    if (allRevealed(game)) return endRound(game, team)
    round.chooserId = round.faceoff.playerIds[team]
    if (!isLive(game, round.chooserId)) return choose(game, true, false)
    setPhase(game, 'choose')
  }
  function choose(game, play, undoable = true) {
    const round = game.round
    if (undoable) saveUndo(game)
    if (!play) round.control = other(round.control)
    event(game, play ? 'play' : 'pass', { team: round.control })
    startGuessing(game)
  }
  function startGuessing(game) {
    const round = game.round
    round.strikes = 0
    round.chooserId = null
    nextGuesser(game)
  }
  function nextGuesser(game) {
    const round = game.round, player = nextFrom(game, 'guess', round.control)
    round.guesserId = player?.id || null
    if (!player) return toSteal(game)
    setPhase(game, 'guessing')
  }
  function toSteal(game) {
    const round = game.round
    round.guesserId = null
    round.stealTeam = other(round.control)
    if (!teamMembers(game, round.stealTeam).length) return endRound(game, round.control)
    setPhase(game, 'steal')
  }
  function endRound(game, team) {
    const round = game.round
    round.winner = team
    round.awarded = team == null ? 0 : round.bank
    if (team != null) game.teams[team].score += round.bank
    round.guesserId = null; round.chooserId = null; round.faceoff.answeringId = null
    event(game, team == null ? 'roundSkipped' : 'roundWon', { team })
    setPhase(game, 'roundEnd')
  }

  // The player (or, for a steal, team) a ruling applies to right now.
  function responderTeam(game, playerId) {
    const round = game.round
    if (round.phase === 'steal') return round.stealTeam
    return game.players.get(playerId)?.team ?? round.faceoff.playerIds.indexOf(playerId)
  }
  function saveUndo(game) {
    game.undo = JSON.parse(JSON.stringify({ round: game.round, teams: game.teams, rotation: game.rotation }))
  }

  function ruleHit(game, index, playerId, guess = '') {
    const round = game.round
    if (round.revealed[index]) return ruleMiss(game, playerId, guess, 'repeat')
    saveUndo(game)
    const team = responderTeam(game, playerId), points = current(game).answers[index].points * multiplier(game)
    round.revealed[index] = true
    round.revealedBy[index] = team
    round.bank += points
    round.lastGuess = { playerId, team, text: guess, result: 'hit', index }
    event(game, 'hit', { index, playerId, team })
    if (round.phase === 'faceoffAnswer') {
      const { faceoff } = round
      // The top answer wins outright, and so does any answer after the other player has missed.
      if (index === 0 || (faceoff.misses > 0 && !faceoff.firstHit)) winFaceoff(game, team)
      else if (!faceoff.firstHit) {
        faceoff.firstHit = { playerId, team, index }
        const rival = faceoff.playerIds[other(team)]
        if (!isLive(game, rival)) winFaceoff(game, team)
        else { faceoff.answeringId = rival; setPhase(game, 'faceoffAnswer') }
      } else winFaceoff(game, index < faceoff.firstHit.index ? team : faceoff.firstHit.team)
    } else if (round.phase === 'guessing') {
      if (allRevealed(game)) endRound(game, round.control)
      else nextGuesser(game)
    } else if (round.phase === 'steal') endRound(game, round.stealTeam)
    emitGame(game)
  }
  // A wrong guess, a repeat of an answer already on the board, or running out of time.
  function ruleMiss(game, playerId, guess = '', result = 'miss') {
    const round = game.round
    saveUndo(game)
    const team = responderTeam(game, playerId)
    round.lastGuess = { playerId, team, text: guess, result, index: null }
    event(game, 'strike', { playerId, team, result })
    if (round.phase === 'faceoffAnswer') {
      const { faceoff } = round
      if (faceoff.firstHit) winFaceoff(game, faceoff.firstHit.team)
      else if (++faceoff.misses >= MAX_FACEOFF_MISSES) winFaceoff(game, Math.random() < 0.5 ? 0 : 1)
      else {
        const rival = faceoff.playerIds[other(team)]
        faceoff.answeringId = isLive(game, rival) ? rival : playerId
        setPhase(game, 'faceoffAnswer')
      }
    } else if (round.phase === 'guessing') {
      round.strikes++
      game.lastEvent.count = round.strikes
      if (round.strikes >= 3) toSteal(game)
      else nextGuesser(game)
    } else if (round.phase === 'steal') endRound(game, round.control)
    emitGame(game)
  }
  function judgeGuess(game, playerId, guess) {
    const index = matchAnswer(game.matchers[game.roundIndex], guess)
    if (index >= 0 && !game.round.revealed[index]) ruleHit(game, index, playerId, guess)
    else ruleMiss(game, playerId, guess, index >= 0 ? 'repeat' : guess ? 'miss' : 'timeout')
  }
  function canAnswer(game, playerId) {
    const round = game.round
    if (game.status !== 'playing' || !round) return false
    if (round.phase === 'faceoffAnswer') return round.faceoff.answeringId === playerId
    if (round.phase === 'guessing') return round.guesserId === playerId
    if (round.phase === 'steal') return game.players.get(playerId)?.team === round.stealTeam
    return false
  }
  function buzz(game, playerId) {
    const round = game.round
    if (game.status !== 'playing' || round?.phase !== 'faceoff' || !round.faceoff.playerIds.includes(playerId)) return
    round.faceoff.answeringId = playerId
    event(game, 'buzz', { playerId })
    setPhase(game, 'faceoffAnswer')
    emitGame(game)
  }

  // A player left (after the reconnect grace period), was kicked, or moved teams: hand off whatever they were doing.
  function handOff(game, playerId, team) {
    const round = game.round
    if (game.status !== 'playing' || !round || team == null) return
    const { faceoff } = round
    if (['faceoffRead', 'faceoff', 'faceoffAnswer'].includes(round.phase) && faceoff.playerIds[team] === playerId) {
      const replacement = nextFrom(game, 'faceoff', team)
      if (replacement) {
        faceoff.playerIds[team] = replacement.id
        if (faceoff.answeringId === playerId) { faceoff.answeringId = replacement.id; setPhase(game, 'faceoffAnswer') }
      } else if (teamMembers(game, other(team)).length) {
        // Nobody left on that side to face off: the other team takes control.
        faceoff.playerIds[team] = null
        winFaceoff(game, other(team))
      }
    } else if (round.phase === 'choose' && round.chooserId === playerId) choose(game, true, false)
    else if (round.phase === 'guessing' && round.guesserId === playerId) nextGuesser(game)
    else if (round.phase === 'steal' && round.stealTeam === team && !teamMembers(game, team).length) endRound(game, round.control)
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    handOff(game, playerId, player.team)
    emitGame(game)
  }

  function hostAction(game, action, payload) {
    const round = game.round, playing = game.status === 'playing' && round
    if (action === 'start' && game.status === 'lobby') {
      if (!teamMembers(game, 0).length || !teamMembers(game, 1).length) return emitGame(game)
      game.status = 'playing'; game.roundIndex = 0; startRound(game)
    }
    if (action === 'buzz' && playing) { buzz(game, payload.playerId); return }
    if (action === 'reveal' && playing) {
      const index = Math.trunc(Number(payload.index))
      if (!(index >= 0 && index < round.revealed.length)) return
      if (round.phase === 'faceoff' || round.phase === 'faceoffRead') return
      if (['faceoffAnswer', 'guessing', 'steal'].includes(round.phase)) { ruleHit(game, index, round.phase === 'faceoffAnswer' ? round.faceoff.answeringId : round.phase === 'guessing' ? round.guesserId : null); return }
      return
    }
    if (action === 'strike' && playing && ['faceoffAnswer', 'guessing', 'steal'].includes(round.phase)) {
      ruleMiss(game, round.phase === 'faceoffAnswer' ? round.faceoff.answeringId : round.phase === 'guessing' ? round.guesserId : null); return
    }
    if (action === 'choose' && playing && round.phase === 'choose') { choose(game, !!payload.play); emitGame(game); return }
    if (action === 'undo' && playing && game.undo) {
      Object.assign(game, { round: game.undo.round, teams: game.undo.teams, rotation: game.undo.rotation, undo: null })
      if (game.round.phase === 'guessing' && !isLive(game, game.round.guesserId)) nextGuesser(game)
      else setPhase(game, game.round.phase)
      event(game, 'undo')
    }
    if (action === 'nextRound' && playing && round.phase === 'roundEnd') { nextRound(game); return }
    if (action === 'skipRound' && playing && round.phase !== 'roundEnd') { saveUndo(game); endRound(game, null) }
    if (action === 'endGame' && game.status === 'playing') { finish(game); return }
    if (action === 'renameTeam') { const team = game.teams[payload.team], name = text(payload.name, 24); if (team && name) team.name = name }
    if (action === 'adjustScore') { const team = game.teams[payload.team], amount = Math.trunc(Number(payload.amount)); if (team && Number.isFinite(amount)) team.score += amount }
    if (action === 'renamePlayer') { const player = game.players.get(payload.playerId), name = text(payload.name, 20); if (player && name) player.name = name }
    if (action === 'movePlayer') {
      const player = game.players.get(payload.playerId), team = payload.team === 1 ? 1 : 0
      if (player && player.team !== team) { const from = player.team; player.team = team; handOff(game, player.id, from) }
    }
    if (action === 'kickPlayer') {
      const player = game.players.get(payload.playerId)
      if (player) {
        cancelLeave(game.code, player.id)
        const socket = io.sockets.sockets.get(player.socketId)
        socket?.leave(game.code); socket?.emit('player:kicked')
        game.players.delete(player.id)
        handOff(game, player.id, player.team)
      }
    }
    if (action === 'replay') {
      let surveys = game.surveys
      try { if (payload.surveys) surveys = cleanConfig({ surveys: payload.surveys }).surveys } catch {}
      clearGameTimers(game)
      Object.assign(game, { status: 'lobby', surveys, matchers: surveys.map(buildMatcher), multipliers: MULTIPLIERS[surveys.length], roundIndex: 0, round: null, rotation: { faceoff: [0, 0], guess: [0, 0] }, undo: null, lastEvent: null })
      game.teams.forEach((team) => { team.score = 0 })
    }
    emitGame(game)
  }

  function register(socket) {
    socket.on('survey:buzz', ({ code, playerId } = {}) => { const game = surveyGame(code); if (isLive(game, playerId, socket)) buzz(game, playerId) })
    socket.on('survey:guess', ({ code, playerId, guess } = {}) => {
      const game = surveyGame(code)
      if (!game?.hostless || !isLive(game, playerId, socket) || !canAnswer(game, playerId)) return
      judgeGuess(game, playerId, text(guess, 80))
    })
    socket.on('survey:choose', ({ code, playerId, play } = {}) => {
      const game = surveyGame(code)
      if (!isLive(game, playerId, socket) || game.round?.phase !== 'choose' || game.round.chooserId !== playerId) return
      choose(game, !!play); emitGame(game)
    })
    socket.on('survey:team', ({ code, playerId, team } = {}) => {
      const game = surveyGame(code), player = game?.players.get(playerId)
      if (!isLive(game, playerId, socket) || game.status !== 'lobby') return
      player.team = team === 1 ? 1 : 0; emitGame(game)
    })
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, register }
}
