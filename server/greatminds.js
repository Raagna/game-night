// Great Minds — a party game about thinking alike.
//
// Each round the TV shows an open prompt ("Name a breakfast food"). Everyone secretly types one answer on their phone
// before the clock runs out. Then the TV groups the matching answers and reveals the groups one at a time, smallest
// first and biggest last. Each player scores one point for every other player in their group; an answer on its own
// scores nothing.
//
// The Lone Wolf: when exactly one player ends up alone in a round, they take the Lone Wolf marker from whoever had
// it. Whoever holds it at the end can't win: the win goes to the best score among everyone else.
//
// Merging: the server groups answers that are clearly the same ("Pancakes", "a pancake", "pancaks"), but it can't
// know that "flapjacks" means pancakes. With a host, only the host can merge (or split) groups during the review,
// before the scores lock; players control nothing about the answers. Without a host, any player can propose "these
// two are the same" from their phone, and the merge goes through on a strict majority of the connected players. The
// review waits a little while for that.
//
// Practice round (the tutorial; see docs/tutorial.md): one practice prompt played with the real rules before round
// one, with nothing scoring and the Lone Wolf staying put. The coach text is MINDS_COACH in src/minds/GreatMinds.jsx.
import { stripAccents, numberWordPattern, NUMBER_WORDS, editDistance } from './text.js'
import { beginTutorial, setTutorialStep, endTutorial as leaveTutorial, inTutorial, skipCarried, votesNeeded } from './tutorial.js'

// Generous clocks (players asked for more time to think): the answer clock is set up per game. The reveal shows a
// group every revealStepMs (quicker when there are lots of groups); without a host, the review waits reviewMs for
// merge ideas (never more than reviewMaxMs in all), a merge vote stays open voteMs, and the scores stay up scoredMs.
export const MINDS_TIMES = { revealStepMs: 2400, revealMinStepMs: 1300, revealAllMs: 15000, reviewMs: 15000, reviewMaxMs: 60000, voteMs: 12000, afterMergeMs: 6000, scoredMs: 11000, practiceEndMs: 9000 }
export const ANSWER_SECONDS = [30, 40, 60, 90]
export const DEFAULT_ANSWER_SECONDS = 40
export const ROUND_COUNTS = [8, 12, 16]
export const MINDS_TUTORIAL_STEPS = ['answer', 'reveal', 'review', 'scored', 'done']
export const PRACTICE_PROMPT = 'Name a fruit that’s yellow.'
export const MAX_ANSWER_LENGTH = 40
// A player can float this many merge ideas a round, so one player can't hold up the review.
export const PROPOSALS_PER_PLAYER = 2
const MAX_PLAYERS = 12

// ---------- Matching answers ----------
// Two answers match when they say the same thing once case, accents, punctuation, spaces, articles and plurals are
// set aside ("The Pancakes" = "pancake", "ice-cream" = "Ice cream"), or when one is a small typo of the other. The
// typo allowance is stricter than answersMatch in text.js on purpose: prompts like "a word that rhymes with cat"
// want "hat", "bat" and "rat" kept apart, so short words must match exactly, and a typo has to keep the first letter.
const ARTICLES = new Set(['a', 'an', 'the', 'some'])
const IRREGULAR = {
  mice: 'mouse', geese: 'goose', men: 'man', women: 'woman', children: 'child', teeth: 'tooth', feet: 'foot', people: 'person',
  wolves: 'wolf', leaves: 'leaf', halves: 'half', shelves: 'shelf', scarves: 'scarf', calves: 'calf', loaves: 'loaf',
  knives: 'knife', wives: 'wife', lives: 'life', thieves: 'thief', elves: 'elf', hooves: 'hoof', n: 'and',
}
// A crude singular: it only has to turn both sides of a comparison into the same thing.
export function singular(word) {
  if (/^\d+$/.test(word)) return word
  if (Object.hasOwn(IRREGULAR, word)) return IRREGULAR[word]
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 4 && word.endsWith('ie')) return word.slice(0, -2) + 'y'
  if (word.length > 4 && /(ss|x|ch|sh|z|us)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is|ous)$/.test(word)) return word.slice(0, -1)
  return word
}
// The words of an answer, normalised: lower case, no accents or punctuation, number words as digits, no articles,
// each word singular.
export function answerWords(text) {
  return stripAccents(text).toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(numberWordPattern, (word) => String(NUMBER_WORDS[word]))
    .split(/[^a-z0-9]+/).filter((word) => word && !ARTICLES.has(word)).map(singular)
}
// The key an answer is compared by: its normalised words run together, so "ice cream" and "icecream" agree.
export const answerKey = (text) => answerWords(text).join('')
export function keysMatch(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  if (/^\d+$/.test(a) || /^\d+$/.test(b) || a[0] !== b[0]) return false
  const shortest = Math.min(a.length, b.length), allowed = shortest >= 10 ? 2 : shortest >= 6 ? 1 : 0
  return allowed > 0 && Math.abs(a.length - b.length) <= allowed && editDistance(a, b) <= allowed
}
export const sameAnswer = (a, b) => keysMatch(answerKey(a), answerKey(b))
// What an answer looks like on the TV: trimmed, single-spaced, as the player typed it.
export const tidyAnswer = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER_LENGTH)

// Groups the answers ({ playerId: text }) into [{ label, members }]: matching answers together (a match of a match
// counts too), each group labelled with its most common wording, and the groups in reveal order, smallest first.
export function groupAnswers(answers) {
  const entries = Object.entries(answers).map(([id, text]) => ({ id, text, key: answerKey(text) })).filter((entry) => entry.key)
  const parent = entries.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) if (keysMatch(entries[i].key, entries[j].key)) parent[find(j)] = find(i)
  const byRoot = new Map()
  entries.forEach((entry, i) => { const root = find(i); if (!byRoot.has(root)) byRoot.set(root, []); byRoot.get(root).push(entry) })
  return revealOrder([...byRoot.values()].map((members) => ({ label: labelFor(members.map((m) => m.text)), members: members.map((m) => m.id) })))
}
// The wording most players used (ignoring case), first come first served on a tie.
function labelFor(texts) {
  const counts = new Map()
  for (const text of texts) { const key = text.toLowerCase(); counts.set(key, { text: counts.get(key)?.text ?? text, n: (counts.get(key)?.n || 0) + 1 }) }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.text || ''
}
// Smallest groups first, so the biggest comes last; same-sized groups alphabetically.
export const revealOrder = (groups) => [...groups].sort((a, b) => a.members.length - b.members.length || a.label.localeCompare(b.label))

// ---------- Scoring ----------
// Each player scores the number of other players in their group. `alone` is everyone on their own: a group of one,
// or no answer at all from a player who was here to give one (so leaving it blank never dodges the Lone Wolf).
export function scoreGroups(groups, noAnswer = []) {
  const points = {}, alone = []
  for (const group of groups) for (const id of group.members) points[id] = group.members.length - 1
  for (const group of groups) if (group.members.length === 1) alone.push(group.members[0])
  for (const id of noAnswer) { points[id] = 0; alone.push(id) }
  return { points, alone }
}
// The Lone Wolf after a round: exactly one player alone takes it; otherwise it stays where it was.
export const nextWolf = (current, alone) => (alone.length === 1 ? alone[0] : current)
// Who wins: the best score among everyone except the Lone Wolf (ties share the win).
export function winnersOf(players, wolfId) {
  const eligible = players.filter((player) => player.id !== wolfId)
  if (!eligible.length) return []
  const best = Math.max(...eligible.map((player) => player.score))
  return eligible.filter((player) => player.score === best).map((player) => player.id)
}

// ---------- Game setup ----------
const text = (value, max) => String(value ?? '').trim().slice(0, max)
function cleanConfig(config) {
  const rounds = ROUND_COUNTS.includes(Number(config?.rounds)) ? Number(config.rounds) : null
  const prompts = [...new Set((Array.isArray(config?.prompts) ? config.prompts : []).map((prompt) => text(prompt, 140)).filter(Boolean))].slice(0, rounds || Math.max(...ROUND_COUNTS))
  if (!prompts.length) throw new Error('A game needs at least one prompt.')
  const answerSeconds = ANSWER_SECONDS.includes(Number(config?.answerSeconds)) ? Number(config.answerSeconds) : DEFAULT_ANSWER_SECONDS
  return { prompts, answerSeconds, hostless: !!config?.hostless, tutorial: !!config?.tutorial }
}

export function createMindsGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave }) {
  const mindsGame = (code) => { const game = games.get(code); return game?.kind === 'minds' ? game : undefined }
  const isLive = (game, playerId, socket) => { const player = game?.players.get(playerId); return !!player?.socketId && (!socket || player.socketId === socket.id) }
  const connected = (game) => [...game.players.values()].filter((player) => player.socketId)
  const event = (game, type, extra = {}) => {
    game.eventSeq = (game.eventSeq || 0) + 1
    game.lastEvent = { id: game.eventSeq, type, at: Date.now(), ...extra }
    game.recentEvents = [...(game.recentEvents || []).slice(-7), game.lastEvent]
  }

  function makeGame(code, rawConfig) {
    const config = cleanConfig(rawConfig)
    return {
      kind: 'minds', code, status: 'lobby', hostSocketId: null, hostless: config.hostless, players: new Map(), config,
      prompts: config.prompts, answerMs: config.answerSeconds * 1000, index: 0, round: null, wolfId: null, history: [], practice: null, tutorial: null, lastEvent: null,
    }
  }
  function playerJoined() {}

  // ---------- What the screens see ----------
  // Answers stay secret until the reveal, and each group only goes out once it's been revealed.
  function publicRound(game) {
    const round = game.round
    const groups = round.groups ? round.order.slice(0, round.shown).map((id) => round.groups.find((group) => group.id === id)).filter(Boolean) : []
    return {
      prompt: round.prompt, phase: round.phase, deadline: round.deadline, answered: Object.keys(round.answers),
      groups: groups.map((group) => ({ id: group.id, label: group.label, members: group.members, answers: Object.fromEntries(group.members.map((id) => [id, round.answers[id]])) })),
      groupCount: round.groups?.length ?? 0, noAnswer: round.phase === 'answer' ? [] : round.noAnswer,
      proposal: round.proposal && { id: round.proposal.id, by: round.proposal.by, groups: round.proposal.groups, deadline: round.proposal.deadline, yes: Object.keys(round.proposal.votes).filter((id) => round.proposal.votes[id]), no: Object.keys(round.proposal.votes).filter((id) => !round.proposal.votes[id]) },
      proposalsUsed: round.proposalsUsed, rejected: round.rejected,
      points: round.phase === 'scored' ? round.points : null, alone: round.phase === 'scored' ? round.alone : null,
      wolfBefore: round.wolfBefore ?? null, wolfAfter: round.phase === 'scored' ? round.wolfAfter : null,
    }
  }
  function publicGame(game) {
    if (inTutorial(game)) setTutorialStep(game, practiceStep(game))
    const live = connected(game).length
    return {
      kind: 'minds', code: game.code, status: game.status, hostless: game.hostless, hostConnected: !!game.hostSocketId,
      index: game.index, roundCount: game.prompts.length, answerMs: game.answerMs, wolfId: game.wolfId,
      players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
      round: game.round && publicRound(game), history: game.history, practice: game.practice ? { done: game.practice.done } : null,
      votesNeeded: votesNeeded(live), winners: game.status === 'complete' ? winnersOf([...game.players.values()], game.wolfId) : null,
      serverNow: Date.now(), lastEvent: game.lastEvent, events: game.recentEvents || [],
    }
  }

  // ---------- Phases and clocks ----------
  function setPhase(game, phase, ms = null) {
    const round = game.round
    round.phase = phase
    round.deadline = ms ? Date.now() + ms : null
    clearGameTimers(game)
    if (ms) schedule(game, 'minds', ms, () => timedOut(game, round, phase))
  }
  function timedOut(game, round, phase) {
    if (game.round !== round || round.phase !== phase || game.status !== 'playing') return
    if (phase === 'answer') endAnswers(game)
    else if (phase === 'reveal') revealNext(game)
    else if (phase === 'review') { if (round.proposal) return waitForVote(game); score(game) }
    else if (phase === 'scored') nextRound(game)
    emitGame(game)
  }
  const revealStep = (round) => Math.max(MINDS_TIMES.revealMinStepMs, Math.min(MINDS_TIMES.revealStepMs, Math.round(MINDS_TIMES.revealAllMs / Math.max(1, round.groups.length))))

  function startRound(game, prompt = game.prompts[game.index]) {
    game.round = { prompt, phase: 'answer', deadline: null, answers: {}, groups: null, order: [], shown: 0, noAnswer: [], nextGroup: 1, proposal: null, proposalSeq: 0, proposalsUsed: {}, rejected: [], points: null, alone: null, wolfBefore: game.wolfId, wolfAfter: null, reviewEndsBy: null }
    event(game, 'round', { index: game.index })
    setPhase(game, 'answer', game.answerMs)
  }
  // The answers are in (everyone answered, the clock ran out, or the host stopped it): group them and start the
  // reveal. The first group comes up after one step, so the room gets a beat of "here we go".
  function endAnswers(game) {
    const round = game.round
    round.noAnswer = connected(game).filter((player) => round.answers[player.id] == null).map((player) => player.id)
    round.groups = groupAnswers(round.answers).map((group) => ({ id: `g${round.nextGroup++}`, ...group }))
    round.order = round.groups.map((group) => group.id)
    round.shown = 0
    if (!round.groups.length) return score(game)
    event(game, 'allIn')
    setPhase(game, 'reveal', revealStep(round))
  }
  // One more group onto the TV; after the last, the review.
  function revealNext(game) {
    const round = game.round
    if (round.shown < round.order.length) {
      round.shown++
      const group = round.groups.find((g) => g.id === round.order[round.shown - 1])
      event(game, 'group', { size: group.members.length, last: round.shown === round.order.length })
    }
    if (round.shown < round.order.length) setPhase(game, 'reveal', revealStep(round))
    else startReview(game)
  }
  function startReview(game) {
    const round = game.round
    round.shown = round.order.length
    round.reviewEndsBy = Date.now() + MINDS_TIMES.reviewMaxMs
    // With a host, the review lasts until the host locks the scores. Without one, it waits a little for merge ideas.
    setPhase(game, 'review', game.hostless ? MINDS_TIMES.reviewMs : null)
    event(game, 'review')
  }
  // The review clock ran out while a merge vote was open: wait for the vote.
  function waitForVote(game) {
    const round = game.round
    round.deadline = round.proposal.deadline
    schedule(game, 'minds', Math.max(50, round.proposal.deadline - Date.now() + 50), () => timedOut(game, round, 'review'))
  }
  // Stretches the hostless review to at least `until`, never past its limit (an open vote still runs to its end).
  function extendReview(game, until) {
    const round = game.round
    if (!game.hostless || round.phase !== 'review') return
    const target = Math.min(until, Math.max(round.reviewEndsBy, round.proposal?.deadline || 0))
    if (target <= (round.deadline || 0)) return
    round.deadline = target
    schedule(game, 'minds', target - Date.now(), () => timedOut(game, round, 'review'))
  }

  // ---------- Scores lock ----------
  function score(game) {
    const round = game.round, practice = inTutorial(game)
    clearGameTimers(game)
    round.proposal = null
    round.shown = round.order.length
    const noAnswer = round.noAnswer.filter((id) => game.players.has(id))
    const { points, alone } = scoreGroups(round.groups || [], noAnswer)
    round.points = points
    round.alone = alone
    round.wolfBefore = game.wolfId
    // In the practice round nothing scores and the Lone Wolf stays put; wolfAfter still shows who would have taken it.
    round.wolfAfter = nextWolf(game.wolfId, alone)
    if (!practice) {
      for (const [id, n] of Object.entries(points)) { const player = game.players.get(id); if (player) player.score += n }
      game.wolfId = round.wolfAfter
      game.history.push({
        prompt: round.prompt, answers: { ...round.answers }, points, alone, wolfId: game.wolfId,
        groups: revealOrder(round.groups || []).map((group) => ({ label: group.label, members: group.members })),
      })
    }
    event(game, 'scored', { wolf: alone.length === 1 ? alone[0] : null, moved: round.wolfAfter !== round.wolfBefore })
    setPhase(game, 'scored', game.hostless ? MINDS_TIMES.scoredMs : null)
  }
  function nextRound(game) {
    if (inTutorial(game)) return finishPractice(game)
    if (game.index < game.prompts.length - 1) { game.index++; return startRound(game) }
    finish(game)
  }
  function finish(game) {
    clearGameTimers(game)
    game.status = 'complete'
    if (game.round) { game.round.deadline = null; game.round.proposal = null }
    event(game, 'complete', { wolfId: game.wolfId })
  }

  // ---------- Practice round ----------
  function beginPractice(game) {
    beginTutorial(game, MINDS_TUTORIAL_STEPS)
    game.practice = { done: false }
    startRound(game, PRACTICE_PROMPT)
  }
  // The step is read off the round, so the coach always matches the screen.
  function practiceStep(game) {
    if (!game.practice || game.practice.done || !game.round) return 'done'
    return MINDS_TUTORIAL_STEPS.includes(game.round.phase) ? game.round.phase : 'done'
  }
  // After the practice's scores: without a host, round one starts a few seconds later; with one, the host starts it.
  function finishPractice(game) {
    if (!game.hostless) return endTutorial(game)
    game.practice.done = true
    clearGameTimers(game)
    game.round.deadline = Date.now() + MINDS_TIMES.practiceEndMs
    schedule(game, 'minds', MINDS_TIMES.practiceEndMs, () => endTutorial(game))
    event(game, 'practiceDone')
  }
  // Out of the practice (played through, skipped by the host or voted off) into round one, with scores at 0.
  function endTutorial(game) {
    if (!leaveTutorial(game)) return
    clearGameTimers(game)
    game.practice = null
    for (const player of game.players.values()) player.score = 0
    Object.assign(game, { index: 0, wolfId: null, history: [] })
    startRound(game)
    emitGame(game)
  }

  // ---------- Answers ----------
  function answer(game, playerId, raw) {
    const round = game.round
    if (game.status !== 'playing' || round?.phase !== 'answer') return { ok: false, error: 'Time’s up for this one.' }
    if (round.answers[playerId] != null) return { ok: false, error: 'You’ve already locked in an answer.' }
    const clean = tidyAnswer(raw)
    if (!clean || !answerKey(clean)) return { ok: false, error: 'Type a word or two.' }
    round.answers[playerId] = clean
    event(game, 'answered', { playerId })
    checkDone(game)
    return { ok: true }
  }
  // Everyone here has answered: no need to wait for the clock.
  function checkDone(game) {
    const round = game.round
    if (game.status !== 'playing' || round?.phase !== 'answer') return
    const live = connected(game)
    if (live.length && live.every((player) => round.answers[player.id] != null)) endAnswers(game)
  }

  // ---------- Merging and splitting ----------
  const groupById = (round, id) => round.groups?.find((group) => group.id === id)
  function mergeGroups(round, a, b) {
    const first = groupById(round, a), second = groupById(round, b)
    if (!first || !second || first === second) return false
    // The bigger group keeps its name ("Pancakes" swallows "Flapjacks").
    const [keep, fold] = second.members.length > first.members.length ? [second, first] : [first, second]
    keep.members = [...keep.members, ...fold.members]
    round.groups = round.groups.filter((group) => group !== fold)
    round.order = revealOrder(round.groups).map((group) => group.id)
    round.shown = round.order.length
    return keep
  }
  // Pulls one player's answer out of its group into a group of its own (the host only).
  function splitOff(round, playerId) {
    const group = round.groups?.find((g) => g.members.includes(playerId))
    if (!group || group.members.length < 2) return false
    group.members = group.members.filter((id) => id !== playerId)
    if (labelFor([round.answers[playerId]]).toLowerCase() === group.label.toLowerCase()) group.label = labelFor(group.members.map((id) => round.answers[id]))
    round.groups.push({ id: `g${round.nextGroup++}`, label: round.answers[playerId], members: [playerId] })
    round.order = revealOrder(round.groups).map((g) => g.id)
    round.shown = round.order.length
    return true
  }
  const pairKey = (a, b) => [a, b].sort().join('+')
  // A player's "these two are the same" (games without a host only). One idea is open at a time; the player who
  // floats it votes yes, and it goes through on a strict majority of the connected players.
  function propose(game, playerId, a, b) {
    const round = game.round
    if (game.hostless !== true) return { ok: false, error: 'The host decides which answers match.' }
    if (game.status !== 'playing' || round?.phase !== 'review') return { ok: false, error: 'Matching is closed for this round.' }
    if (round.proposal) return { ok: false, error: 'Vote on the open idea first.' }
    if (a === b || !groupById(round, a) || !groupById(round, b)) return { ok: false, error: 'Pick two different answers.' }
    if ((round.proposalsUsed[playerId] || 0) >= PROPOSALS_PER_PLAYER) return { ok: false, error: `That’s your ${PROPOSALS_PER_PLAYER} ideas for this round.` }
    if (round.rejected.includes(pairKey(a, b))) return { ok: false, error: 'The room already said no to that one.' }
    round.proposalsUsed[playerId] = (round.proposalsUsed[playerId] || 0) + 1
    const proposal = { id: ++round.proposalSeq, by: playerId, groups: [a, b], votes: { [playerId]: true }, deadline: Date.now() + MINDS_TIMES.voteMs }
    round.proposal = proposal
    schedule(game, 'mindsVote', MINDS_TIMES.voteMs, () => { if (game.round === round && round.proposal === proposal) { rejectProposal(game); emitGame(game) } })
    extendReview(game, proposal.deadline + 1000)
    event(game, 'proposal', { playerId })
    checkProposal(game)
    return { ok: true }
  }
  function vote(game, playerId, yes) {
    const round = game.round
    if (!game.hostless || game.status !== 'playing' || round?.phase !== 'review' || !round.proposal) return { ok: false, error: 'There’s nothing to vote on.' }
    round.proposal.votes[playerId] = !!yes
    checkProposal(game)
    return { ok: true }
  }
  // Counts the open idea's votes from the connected players: a strict majority of yes merges the two groups, and
  // once a majority is out of reach it's turned down.
  function checkProposal(game) {
    const round = game.round, proposal = round?.proposal
    if (!proposal) return
    const live = connected(game).map((player) => player.id), needed = votesNeeded(live.length)
    const yes = live.filter((id) => proposal.votes[id] === true).length, no = live.filter((id) => proposal.votes[id] === false).length
    if (live.length && yes >= needed) {
      round.proposal = null
      const kept = mergeGroups(round, ...proposal.groups)
      event(game, 'merged', { size: kept ? kept.members.length : 0, by: proposal.by })
      extendReview(game, Date.now() + MINDS_TIMES.afterMergeMs)
    } else if (!live.length || live.length - no < needed) rejectProposal(game)
  }
  function rejectProposal(game) {
    const round = game.round, proposal = round.proposal
    if (!proposal) return
    round.proposal = null
    round.rejected.push(pairKey(...proposal.groups))
    event(game, 'mergeRejected', { by: proposal.by })
  }

  // ---------- Players coming and going ----------
  // A player left (after the reconnect grace period) or was kicked: don't wait for their answer or their vote.
  function recheck(game) {
    if (game.status !== 'playing') return
    checkDone(game)
    if (game.round?.proposal) checkProposal(game)
  }
  function playerLeft(game, playerId) {
    const player = game.players.get(playerId)
    if (!player || player.socketId) return
    recheck(game)
    emitGame(game)
  }
  function removeFromRound(game, playerId) {
    const round = game.round
    if (!round) return
    delete round.answers[playerId]
    round.noAnswer = round.noAnswer.filter((id) => id !== playerId)
    if (round.groups && round.phase !== 'scored') {
      for (const group of round.groups) group.members = group.members.filter((id) => id !== playerId)
      round.groups = round.groups.filter((group) => group.members.length)
      round.order = round.order.filter((id) => round.groups.some((group) => group.id === id))
      round.shown = Math.min(round.shown, round.order.length)
    }
    if (game.wolfId === playerId) game.wolfId = null
  }

  const nextStep = (game) => `${inTutorial(game) ? 'practice' : game.index}:${game.round?.phase}${game.practice?.done ? ':done' : ''}`
  function hostAction(game, action, payload) {
    const round = game.round, playing = game.status === 'playing' && round
    if (action === 'start' && game.status === 'lobby' && connected(game).length >= 2) {
      game.status = 'playing'; game.index = 0
      if (game.config.tutorial) beginPractice(game); else startRound(game)
    }
    // Next: stop the answer clock, show every group at once, lock the scores, or go on to the next round. A Next tagged
    // with the step it was tapped on (`at`, see nextStep) only counts on that step, so a double tap or a tap from an
    // out-of-date screen can't skip a step.
    if (action === 'next' && playing && payload.at != null && payload.at !== nextStep(game)) return emitGame(game)
    if (action === 'next' && playing) {
      if (round.phase === 'answer') endAnswers(game)
      else if (round.phase === 'reveal') startReview(game)
      else if (round.phase === 'review') score(game)
      else if (round.phase === 'scored') { if (game.practice?.done) return endTutorial(game); nextRound(game) }
    }
    // Only a host merges or splits, during the review, before the scores lock. Without a host, the players vote.
    if (action === 'merge' && playing && !game.hostless && round.phase === 'review') {
      const kept = mergeGroups(round, String(payload.a), String(payload.b))
      if (kept) event(game, 'merged', { size: kept.members.length })
    }
    if (action === 'split' && playing && !game.hostless && round.phase === 'review') splitOff(round, String(payload.playerId))
    // Skipping a round during the practice skips the practice (endTutorial sends the game out itself).
    if (action === 'skip' && playing) { if (inTutorial(game)) return endTutorial(game); clearGameTimers(game); nextRound(game) }
    if (action === 'endGame' && game.status === 'playing' && !inTutorial(game)) finish(game)
    if (action === 'adjustScore') { const player = game.players.get(payload.playerId), amount = Math.trunc(Number(payload.amount)); if (player && Number.isFinite(amount)) player.score += amount }
    if (action === 'renamePlayer') { const player = game.players.get(payload.playerId), name = text(payload.name, 20); if (player && name) player.name = name }
    if (action === 'kickPlayer') {
      const player = game.players.get(payload.playerId)
      if (player) {
        cancelLeave(game.code, player.id)
        const socket = io.sockets.sockets.get(player.socketId)
        socket?.leave(game.code); socket?.emit('player:kicked')
        game.players.delete(player.id)
        removeFromRound(game, player.id)
        recheck(game)
        // One fewer player can carry a vote to skip the practice.
        if (skipCarried(game)) return endTutorial(game)
      }
    }
    if (action === 'replay') {
      let config = game.config
      try { if (payload.prompts) config = cleanConfig({ ...game.config, prompts: payload.prompts, rounds: payload.prompts.length }) } catch {}
      // No practice round on a replay.
      config = { ...config, tutorial: false }
      clearGameTimers(game)
      Object.assign(game, { status: 'lobby', config, prompts: config.prompts, index: 0, round: null, wolfId: null, history: [], lastEvent: null, tutorial: null, practice: null })
      for (const player of game.players.values()) player.score = 0
    }
    emitGame(game)
  }

  function register(socket) {
    const reply = (game, ack, result) => { ack?.(result); if (result.ok) emitGame(game) }
    socket.on('minds:answer', ({ code, playerId, text: raw } = {}, ack) => {
      const game = mindsGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false, error: 'You’re not in this game.' })
      reply(game, ack, answer(game, playerId, raw))
    })
    socket.on('minds:propose', ({ code, playerId, groups } = {}, ack) => {
      const game = mindsGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false, error: 'You’re not in this game.' })
      const [a, b] = Array.isArray(groups) ? groups.map(String) : []
      reply(game, ack, propose(game, playerId, a, b))
    })
    socket.on('minds:vote', ({ code, playerId, yes } = {}, ack) => {
      const game = mindsGame(code)
      if (!isLive(game, playerId, socket)) return ack?.({ ok: false, error: 'You’re not in this game.' })
      reply(game, ack, vote(game, playerId, yes))
    })
  }

  return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, register, endTutorial, nextStep }
}
