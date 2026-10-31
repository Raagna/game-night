// Word Budget — a team word game in the style of the bid-and-clue party games, with our own words.
//
// Two teams. Each card is five words. Both teams' clue-givers see it on their phones for ten seconds, then bid
// down from 25 against a 10-second shot clock that resets on every bid: "I can get all five in N words". The lowest
// bid wins control (no bid at all: the team whose turn it was to start takes it at 25). The two clue-givers can
// agree to pass on a card and draw another.
//
// The bid winner then has 90 seconds to get their team to say all five words, using no more than N spoken clue
// words. Someone who isn't on the clue-giver's team keeps track: every clue word is counted (one past the budget
// ends the turn), each word is checked off as the team says it, and a no-no (rhymes, sounds-like, gestures, part of
// an answer) forfeits the card to the other team. With a host, the host does all of that from the controller and the
// phones only bid. Without one, the other team's clue-giver (the judge) does it from their phone.
// Clearing the card wins it, and the words left over in the budget are banked as bonus words (the tiebreak). Going
// over budget or running out of time hands the other team a 35-second steal: say every word still left, using only
// the clues already given, and the card is theirs. Miss, and nobody gets it. In a steal the tracking swaps sides
// too: without a host, the clue-giver who lost the card checks off the stealing team's words.
//
// First team to the target number of cards wins (or, in points mode, a card is 10 and every saved word 1).
// The words are only ever sent to the phones that need them and the host controller (budget:card); the TV gets
// each word's status, and a word's text only once it has been guessed or the card is over.
import { repeatHostTap } from './taps.js'

export const BUDGET_TIMES = { peekMs: 10000, bidMs: 10000, playMs: 90000, stealMs: 35000, doneMs: 18000 }
export const START_BID = 25
export const CARD_SIZE = 5
const MAX_PLAYERS = 16
const MAX_WORDS = 2000
// A judge counting spoken words taps fast, but not this fast: anything quicker is a stuck finger or a script.
export const COUNT_LIMIT = { taps: 8, perMs: 1000 }
// Actions tagged with the card and phase they were meant for (see rulingTurn): a tap sent for a card or phase
// that's already over is ignored rather than landing on the next one.
const RULINGS = new Set(['next', 'bid', 'pass', 'countWord', 'uncount', 'mark', 'unmark', 'nono', 'award', 'newCard'])

const text = (value, max) => String(value ?? '').trim().slice(0, max)
function cleanConfig(config) {
  const seen = new Set()
  const words = (Array.isArray(config?.words) ? config.words : []).slice(0, MAX_WORDS).map((word) => text(word, 40))
    .filter((word) => word && !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()))
  if (words.length < CARD_SIZE * 2) throw new Error(`Pick categories with at least ${CARD_SIZE * 2} words between them.`)
  const cardsToWin = [5, 7, 10].includes(Number(config?.cardsToWin)) ? Number(config.cardsToWin) : 10
  return { words, cardsToWin, scoring: config?.scoring === 'points' ? 'points' : 'cards', hostless: !!config?.hostless }
}

// Best first: most cards, then most saved words (the tiebreak). In points mode, most points, then most cards.
// Shared with the screens, which rank teams the same way.
export function standings(teams, scoring = 'cards') {
  const key = (team) => scoring === 'points' ? [team.points, team.cards] : [team.cards, team.bonus]
  return [...teams].sort((a, b) => { const [a1, a2] = key(a), [b1, b2] = key(b); return b1 - a1 || b2 - a2 })
}

export function createBudgetGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave, now = Date.now }) {
  const budgetGame = (code) => { const game = games.get(code); return game?.kind === 'budget' ? game : undefined }
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const live = (game, ids) => ids.filter((id) => isLive(game, id))
  const teamOf = (game, playerId) => game.teams.find((team) => team.members.includes(playerId))
  const teamById = (game, id) => game.teams.find((team) => team.id === id)
  const otherTeam = (game, id) => game.teams.find((team) => team.id !== id)
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }
  const points = (game, team) => team.cards * 10 + team.bonus
  const target = (game) => game.config.scoring === 'points' ? game.config.cardsToWin * 10 : game.config.cardsToWin
  const progress = (game, team) => game.config.scoring === 'points' ? points(game, team) : team.cards

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    const game = { kind: 'budget', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config, teams: [], cardNo: 0, cardSeq: 0, dealt: 0, turn: null, lastEvent: null, phoneTaps: {} }
    game.teams = [1, 2].map((n) => ({ id: `t${n}`, name: `Team ${n}`, members: [], cards: 0, bonus: 0 }))
    return game
  }
  // New players join the smaller team (Team 1 on a tie), so the teams fill evenly.
  function playerJoined(game, player) {
    const [a, b] = game.teams
    ;(b.members.length < a.members.length ? b : a).members.push(player.id)
  }

  // ---------- Public state ----------
  // Changes whenever a ruling would mean something different: a new card (a pass draws one too) or a new phase.
  // Deliberately not the word count, so the judge's +1 taps all carry the same tag.
  const rulingTurn = (game) => game.status === 'playing' && game.turn ? `${game.turn.id}:${game.turn.phase}` : null
  function publicTurn(game) {
    const turn = game.turn
    if (!turn) return null
    const over = turn.phase === 'done'
    return {
      id: turn.id, number: turn.number, phase: turn.phase, deadline: turn.deadline,
      givers: turn.givers, starterId: turn.starterId, bid: turn.bid, passes: turn.passes,
      control: turn.control, clueGiverId: turn.clueGiverId, judgeId: turn.judgeId, stealTeamId: turn.stealTeamId,
      budget: turn.budget, used: turn.used, lastCount: turn.lastCount,
      // Each word's status is safe for everyone; its text only once it's been said (or the card is over).
      marks: turn.words.map((word) => word.status),
      slots: turn.words.map((word) => over || word.status === 'got' || word.status === 'stolen' ? word.text : null),
      result: turn.result,
    }
  }
  function publicGame(game) {
    return {
      kind: 'budget', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      cardsToWin: game.config.cardsToWin, scoring: game.config.scoring, target: target(game), cardNo: game.cardNo,
      teams: game.teams.map((team) => ({ ...team, points: points(game, team) })), turn: publicTurn(game),
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      serverNow: now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // ---------- Cards ----------
  const PHASE_TIME = { peek: 'peekMs', bid: 'bidMs', play: 'playMs', steal: 'stealMs', done: 'doneMs' }
  function setPhase(game, phase, ms = phase === 'done' && !game.hostless ? null : BUDGET_TIMES[PHASE_TIME[phase]]) {
    const turn = game.turn
    turn.phase = phase
    turn.deadline = ms ? now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'budget', ms, () => { if (game.turn === turn && turn.phase === phase && game.status === 'playing') { timeUp(game); emitGame(game) } })
  }
  // The next five words from the pool (starting over from the top if a long game uses them all up).
  function deal(game) {
    const { words } = game.config, hand = []
    for (let i = 0; i < CARD_SIZE; i++) hand.push(words[(game.dealt + i) % words.length])
    game.dealt = (game.dealt + CARD_SIZE) % words.length
    return hand.map((word) => ({ text: word, status: 'waiting' }))
  }
  // Each card, both teams' clue-givers move one along their team, so everyone gets a go.
  function giverFor(game, team) {
    const members = live(game, team.members)
    return members.length ? members[game.cardNo % members.length] : null
  }
  function startCard(game) {
    const [a, b] = game.teams, starter = game.teams[game.cardNo % 2]
    game.turn = {
      id: ++game.cardSeq, number: game.cardNo + 1, phase: 'peek', deadline: null, words: deal(game),
      givers: { [a.id]: giverFor(game, a), [b.id]: giverFor(game, b) }, starterId: starter.id,
      bid: null, passes: [], control: null, clueGiverId: null, judgeId: null, stealTeamId: null,
      budget: null, used: 0, lastCount: null, countTimes: [], result: null,
    }
    event(game, 'card', { number: game.turn.number })
    setPhase(game, 'peek')
  }
  // Both clue-givers passed (or the host drew a new card): same givers, same starter, fresh words.
  function newCard(game) {
    const turn = game.turn
    if (!['peek', 'bid'].includes(turn?.phase)) return false
    Object.assign(turn, { id: ++game.cardSeq, words: deal(game), bid: null, passes: [] })
    event(game, 'newCard')
    setPhase(game, 'peek')
    return true
  }
  function timeUp(game) {
    const turn = game.turn
    if (turn.phase === 'peek') setPhase(game, 'bid')
    else if (turn.phase === 'bid') closeBidding(game)
    else if (turn.phase === 'play') fail(game, 'time')
    else if (turn.phase === 'steal') endSteal(game)
    else nextCard(game)
  }

  // ---------- Bidding ----------
  const currentBid = (turn) => turn.bid?.amount ?? START_BID + 1
  function bid(game, teamId, raw) {
    const turn = game.turn, amount = Math.trunc(Number(raw))
    if (turn?.phase !== 'bid' || !teamById(game, teamId) || !Number.isFinite(amount)) return false
    // Lower than the standing bid, from 25 down to 1, and never against your own team's bid.
    if (amount < 1 || amount >= currentBid(turn) || turn.bid?.teamId === teamId) return false
    turn.bid = { teamId, amount }
    turn.passes = turn.passes.filter((id) => id !== teamId)
    event(game, 'bid', { teamId, amount })
    if (amount === 1) closeBidding(game)
    else setPhase(game, 'bid') // the shot clock starts again
    return true
  }
  function pass(game, teamId) {
    const turn = game.turn
    if (!['peek', 'bid'].includes(turn?.phase) || !teamById(game, teamId) || turn.passes.includes(teamId)) return false
    turn.passes.push(teamId)
    if (turn.passes.length === game.teams.length) return newCard(game)
    event(game, 'pass', { teamId })
    return true
  }
  function closeBidding(game) {
    const turn = game.turn
    if (turn.phase !== 'bid') return false
    const control = turn.bid?.teamId ?? turn.starterId
    turn.control = control
    turn.budget = turn.bid?.amount ?? START_BID
    turn.clueGiverId = turn.givers[control]
    turn.judgeId = turn.givers[otherTeam(game, control).id]
    event(game, 'play', { teamId: control, budget: turn.budget })
    setPhase(game, 'play')
    return true
  }

  // ---------- Playing the card ----------
  function countWord(game) {
    const turn = game.turn, at = now()
    if (turn?.phase !== 'play') return false
    turn.countTimes = turn.countTimes.filter((t) => at - t < COUNT_LIMIT.perMs)
    if (turn.countTimes.length >= COUNT_LIMIT.taps) return false
    turn.countTimes.push(at)
    turn.used++
    turn.lastCount = { at, delta: 1 }
    event(game, 'count', { used: turn.used })
    // Using exactly the budget is fine; one word past it ends the turn.
    if (turn.used > turn.budget) fail(game, 'budget')
    return true
  }
  function uncount(game) {
    const turn = game.turn
    if (turn?.phase !== 'play' || !turn.used) return false
    turn.used--
    turn.lastCount = { at: now(), delta: -1 }
    return true
  }
  // In play a word said by the clue-giver's team is 'got'; in a steal, one said by the stealing team is 'stolen'.
// Who may tap it is decided in register (PHONE): the team not saying the words keeps track, or the host.
  function mark(game, index) {
    const turn = game.turn, word = turn?.words[Math.trunc(Number(index))]
    if (!word || word.status !== 'waiting' || !['play', 'steal'].includes(turn.phase)) return false
    word.status = turn.phase === 'play' ? 'got' : 'stolen'
    event(game, 'word', { status: word.status })
    if (turn.words.every((w) => w.status !== 'waiting')) {
      if (turn.phase === 'play') finishCard(game, turn.control, 'cleared', turn.budget - turn.used)
      else finishCard(game, turn.stealTeamId, 'stolen')
    }
    return true
  }
  // A disputed word goes back to waiting (only the ones marked in the current phase).
  function unmark(game, index) {
    const turn = game.turn, word = turn?.words[Math.trunc(Number(index))]
    if (!word || word.status !== (turn.phase === 'play' ? 'got' : turn.phase === 'steal' ? 'stolen' : '')) return false
    word.status = 'waiting'
    event(game, 'unmark')
    return true
  }
  function nono(game) {
    const turn = game.turn
    if (turn?.phase !== 'play') return false
    finishCard(game, otherTeam(game, turn.control).id, 'nono')
    return true
  }
  // Over budget or out of time: the other team gets a short steal at the words still left.
  function fail(game, reason) {
    const turn = game.turn
    turn.stealTeamId = otherTeam(game, turn.control).id
    turn.failReason = reason
    event(game, 'fail', { reason, teamId: turn.control })
    setPhase(game, 'steal')
  }
  // The steal clock ran out (or the host stopped it) before every word was said: nobody gets the card.
  function endSteal(game) { finishCard(game, null, 'stealMissed') }
  function finishCard(game, winnerId, reason, bonus = 0) {
    const turn = game.turn, winner = teamById(game, winnerId)
    for (const word of turn.words) if (word.status === 'waiting') word.status = 'missed'
    if (winner) { winner.cards++; winner.bonus += bonus }
    turn.result = { winnerId: winner?.id ?? null, reason, bonus: winner ? bonus : 0, failReason: turn.failReason ?? null }
    turn.countTimes = []
    event(game, winner ? 'cardWon' : 'cardVoid', { teamId: winner?.id, reason })
    setPhase(game, 'done')
  }
  // The host's last word on a finished card: give it to a team (no bonus), or to nobody.
  function award(game, teamId) {
    const turn = game.turn
    if (turn?.phase !== 'done' || !turn.result) return false
    const old = teamById(game, turn.result.winnerId), next = teamById(game, teamId) ?? null
    if (old === next) return false
    if (old) { old.cards--; old.bonus -= turn.result.bonus }
    if (next) next.cards++
    turn.result = { ...turn.result, winnerId: next?.id ?? null, reason: 'host', bonus: 0 }
    return true
  }
  const leader = (game) => game.teams.find((team) => progress(game, team) >= target(game))
  function nextCard(game) {
    if (leader(game)) return finish(game)
    game.cardNo++
    startCard(game)
  }
  function finish(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.turn) game.turn.deadline = null
    event(game, 'complete')
  }
  function start(game) {
    if (game.status !== 'lobby' || game.teams.some((team) => live(game, team.members).length < 2)) return false
    game.status = 'playing'
    game.cardNo = 0
    startCard(game)
    return true
  }

  // ---------- Players coming and going ----------
  // A clue-giver or judge who leaves hands their job to a teammate who's still here.
  function handOff(game, playerId) {
    const turn = game.turn
    if (game.status !== 'playing' || !turn) return
    const team = teamOf(game, playerId)
    if (!team || turn.givers[team.id] !== playerId) return
    const stand = live(game, team.members).find((id) => id !== playerId) ?? null
    turn.givers[team.id] = stand
    if (turn.clueGiverId === playerId) turn.clueGiverId = stand
    if (turn.judgeId === playerId) turn.judgeId = stand
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    handOff(game, playerId)
    emitGame(game)
  }
  const removeFromTeams = (game, playerId) => { for (const team of game.teams) team.members = team.members.filter((id) => id !== playerId) }
  function moveToTeam(game, playerId, teamId) {
    const team = teamById(game, teamId) || otherTeam(game, teamOf(game, playerId)?.id)
    if (game.status !== 'lobby' || !game.players.has(playerId) || !team) return false
    removeFromTeams(game, playerId)
    team.members.push(playerId)
    return true
  }

  // The card's actions, shared by the host controller and the phones (which are checked for their role first).
  function act(game, action, payload) {
    if (game.status !== 'playing' || !game.turn) return false
    if (action === 'bid') return bid(game, payload.teamId, payload.amount)
    if (action === 'pass') return pass(game, payload.teamId)
    if (action === 'countWord') return countWord(game)
    if (action === 'uncount') return uncount(game)
    if (action === 'mark') return mark(game, payload.index)
    if (action === 'unmark') return unmark(game, payload.index)
    if (action === 'nono') return nono(game)
    return false
  }

  function hostAction(game, action, payload) {
    const turn = game.turn, playing = game.status === 'playing' && turn
    if (action === 'start') start(game)
    if (playing) {
      act(game, action, payload)
      // Next: skip the look, close the bidding, stop the clock (a fail), end the steal, or deal the next card.
      if (action === 'next') timeUp(game)
      if (action === 'newCard') newCard(game)
      if (action === 'award') award(game, payload.teamId)
    }
    if (action === 'endGame' && game.status === 'playing') finish(game)
    if (action === 'renameTeam') { const team = teamById(game, payload.teamId), name = text(payload.name, 24); if (team && name) team.name = name }
    if (action === 'adjustScore') { const team = teamById(game, payload.teamId), amount = Math.trunc(Number(payload.amount)); if (team && Number.isFinite(amount)) team.cards = Math.max(0, team.cards + amount) }
    if (action === 'renamePlayer') { const player = game.players.get(payload.playerId), name = text(payload.name, 20); if (player && name) player.name = name }
    if (action === 'movePlayer') moveToTeam(game, payload.playerId, payload.teamId)
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
      Object.assign(game, { status: 'lobby', config, cardNo: 0, dealt: 0, turn: null, lastEvent: null })
      for (const team of game.teams) { team.cards = 0; team.bonus = 0 }
    }
    emitGame(game)
  }

  // ---------- Phones ----------
  // Who may do what from their own phone. The host controller can do all of it.
  // With a host, the host keeps track of everything (counting, checking off words, no-nos): phones only bid and pass.
  // Without one, the team that isn't saying the words keeps track: in play that's the judge (the other team's
  // clue-giver); in a steal it's the clue-giver who just lost the card, checking off the stealing team's words (the TV
  // shows the whole card afterwards for the room).
  const isGiver = (game, playerId) => Object.values(game.turn?.givers || {}).includes(playerId)
  const tracker = (game) => !game.hostless ? null : game.turn.phase === 'play' ? game.turn.judgeId : game.turn.phase === 'steal' ? game.turn.clueGiverId : null
  const tracks = (game, id) => !!id && tracker(game) === id
  const PHONE = {
    bid: (game, id) => isGiver(game, id),
    pass: (game, id) => isGiver(game, id),
    countWord: (game, id) => game.turn.phase === 'play' && tracks(game, id),
    uncount: (game, id) => game.turn.phase === 'play' && tracks(game, id),
    nono: (game, id) => game.turn.phase === 'play' && tracks(game, id),
    mark: (game, id) => tracks(game, id),
    unmark: (game, id) => tracks(game, id),
  }
  // Which players' phones are shown the card right now: both clue-givers until bidding closes (they bid on it); then
  // the clue-giver, through the play and the steal (so they can follow the other team's steal); and, without a host,
  // the judge while the card is played, since they check off the words.
  function maySeeCard(game, playerId) {
    const turn = game.turn
    if (game.status !== 'playing' || !turn || turn.phase === 'done' || !playerId) return false
    if (['peek', 'bid'].includes(turn.phase)) return isGiver(game, playerId)
    if (turn.clueGiverId === playerId) return true
    return game.hostless && turn.phase === 'play' && turn.judgeId === playerId
  }

  function register(socket) {
    socket.on('budget:card', ({ code, playerId } = {}, ack) => {
      const game = budgetGame(code)
      const allowed = game && ((playerId && isLive(game, playerId, socket) && maySeeCard(game, playerId)) || (!playerId && !game.hostless && socket.data.controllerGame === code && game.turn?.phase !== 'done'))
      if (!allowed || !game.turn) return ack?.({ ok: false })
      ack?.({ ok: true, id: game.turn.id, words: game.turn.words.map((word) => word.text) })
    })
    socket.on('budget:act', ({ code, playerId, action, payload } = {}) => {
      const game = budgetGame(code), data = payload && typeof payload === 'object' ? payload : {}
      if (!isLive(game, playerId, socket) || game.status !== 'playing' || !game.turn || !Object.hasOwn(PHONE, action) || !PHONE[action](game, playerId)) return
      // A tap meant for a card or phase that's over (a slow phone, a late double tap) is ignored.
      if (data.turn != null && data.turn !== rulingTurn(game)) return emitGame(game)
      // The same tap twice in a row counts once, except +1, which the judge taps again and again on purpose.
      if (repeatHostTap(game.phoneTaps[playerId] ||= {}, action, data, now())) return
      const teamId = teamOf(game, playerId)?.id
      if (act(game, action, { ...data, teamId })) emitGame(game)
    })
    socket.on('budget:team', ({ code, playerId, teamId } = {}) => {
      const game = budgetGame(code)
      if (isLive(game, playerId, socket) && moveToTeam(game, playerId, teamId)) emitGame(game)
    })
  }

  return { MAX_PLAYERS, RULINGS, rulingTurn, makeGame, publicGame, playerJoined, playerLeft, hostAction, register }
}
