import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  createMindsGames, answerKey, sameAnswer, groupAnswers, scoreGroups, nextWolf, winnersOf,
  MINDS_TIMES, MINDS_TUTORIAL_STEPS, PRACTICE_PROMPT, PROPOSALS_PER_PLAYER, ANSWER_SECONDS, DEFAULT_ANSWER_SECONDS,
} from './greatminds.js'
import { registerTutorial, publicTutorial, inTutorial } from './tutorial.js'
import { readFileSync } from 'node:fs'

const PROMPTS = JSON.parse(readFileSync(new URL('../src/minds/prompts.json', import.meta.url), 'utf8'))

// Great Minds without sockets or real timers: scheduled clocks run when a test calls fire().
function harness() {
  const games = new Map(), timers = {}
  const api = createMindsGames({
    io: { sockets: { sockets: new Map() } }, games, emitGame: () => {}, cancelLeave: () => {},
    schedule: (game, name, ms, fn) => { timers[name] = { ms, fn } },
    clearGameTimers: () => { for (const name in timers) delete timers[name] },
  })
  // A socket for player `id` (or the TV): the handlers the module registers, called as that socket.
  const socketFor = (game, id) => {
    const handlers = new Map(), socketId = game.players.get(id)?.socketId || 'tv'
    const socket = { id: socketId, data: {}, on: (event, fn) => handlers.set(event, fn) }
    api.register(socket)
    registerTutorial(socket, { games, emitGame: () => {}, end: (g) => api.endTutorial(g) })
    return (event, payload = {}) => { let reply; handlers.get(event)({ code: game.code, playerId: id, ...payload }, (r) => { reply = r }); return reply }
  }
  return {
    api, games, timers, socketFor,
    fire: (name = 'minds') => { const timer = timers[name]; assert.ok(timer, `no ${name} clock running`); delete timers[name]; timer.fn() },
  }
}
const PROMPTS_3 = ['Name a breakfast food.', 'A word that rhymes with cat.', 'Name a pet.']
function newGame(h, { players = 4, start = true, ...config } = {}) {
  const game = h.api.makeGame('ABCDEF', { prompts: PROMPTS_3, ...config })
  h.games.set(game.code, game)
  for (let i = 0; i < players; i++) game.players.set(`p${i}`, { id: `p${i}`, name: `Player ${i}`, score: 0, socketId: `s${i}` })
  if (start) h.api.hostAction(game, 'start', {})
  return game
}
const say = (h, game, id, text) => h.socketFor(game, id)('minds:answer', { text })
const host = (h, game, action, payload = {}) => h.api.hostAction(game, action, payload)
const score = (game, id) => game.players.get(id).score
// Everyone answers (in player order), then the reveal runs to the review.
function answerAll(h, game, texts) {
  texts.forEach((text, i) => { if (text != null) say(h, game, `p${i}`, text) })
  if (game.round.phase === 'answer') h.fire()
  while (game.round.phase === 'reveal') h.fire()
}
const labels = (groups) => groups.map((group) => [group.label, group.members.length])

describe('matching answers', () => {
  test('case, spaces, punctuation, articles and plurals are set aside', () => {
    assert.ok(sameAnswer('Pancakes', 'a pancake'))
    assert.ok(sameAnswer('The Pancakes!', 'pancake'))
    assert.ok(sameAnswer('ice-cream', 'Ice Cream'))
    assert.ok(sameAnswer('icecream', 'ice cream'))
    assert.ok(sameAnswer('Berries', 'berry'))
    assert.ok(sameAnswer('cookies', 'Cookie'))
    assert.ok(sameAnswer('French fries', 'french fry'))
    assert.ok(sameAnswer('boxes', 'box'))
    assert.ok(sameAnswer('wolves', 'Wolf'))
    assert.ok(sameAnswer('Mac & cheese', 'mac n cheese'))
    assert.ok(sameAnswer('crème brûlée', 'creme brulee'))
    assert.ok(sameAnswer('two', '2'))
  })
  test('small typos in longer words still match', () => {
    assert.ok(sameAnswer('spaghetti', 'spagetti'))
    assert.ok(sameAnswer('banana', 'bananna'))
    assert.ok(sameAnswer('potatoes', 'potato'))
    assert.ok(sameAnswer('strawberry', 'strawbery'))
  })
  test('short words must match exactly, so rhymes stay apart', () => {
    for (const [a, b] of [['hat', 'bat'], ['bear', 'pear'], ['light', 'night'], ['bread', 'break']]) assert.ok(!sameAnswer(a, b), `${a} / ${b}`)
    assert.ok(!sameAnswer('waffle', 'muffle'), 'a typo keeps the first letter')
    assert.ok(!sameAnswer('pancakes', 'flapjacks'), 'synonyms are for the merge')
    assert.ok(!sameAnswer('7', '8'))
    assert.equal(answerKey('  !!  '), '')
  })
  test('answers group together, labelled with the most common wording, smallest group first', () => {
    const groups = groupAnswers({ a: 'Pancakes', b: 'pancake', c: 'Waffles', d: 'pancakes', e: 'Toast', f: 'waffle' })
    assert.deepEqual(labels(groups), [['Toast', 1], ['Waffles', 2], ['Pancakes', 3]])
    assert.deepEqual(groups.at(-1).members.sort(), ['a', 'b', 'd'])
  })
})

describe('scoring', () => {
  test('each player scores the number of other players in their group; alone scores 0', () => {
    const groups = groupAnswers({ a: 'cat', b: 'Cat', c: 'cat', d: 'dog', e: 'dog', f: 'fish' })
    const { points, alone } = scoreGroups(groups)
    assert.deepEqual(points, { a: 2, b: 2, c: 2, d: 1, e: 1, f: 0 })
    assert.deepEqual(alone, ['f'])
  })
  test('a round plays through: answers, a reveal one group at a time, then the scores', () => {
    const h = harness(), game = newGame(h, { players: 5 })
    assert.equal(game.round.phase, 'answer')
    assert.equal(h.timers.minds.ms, DEFAULT_ANSWER_SECONDS * 1000)
    say(h, game, 'p0', 'Pancakes'); say(h, game, 'p1', 'pancake'); say(h, game, 'p2', 'Toast'); say(h, game, 'p3', 'Eggs')
    assert.equal(h.api.publicGame(game).round.groups.length, 0, 'answers stay secret while answering')
    assert.deepEqual(h.api.publicGame(game).round.answered, ['p0', 'p1', 'p2', 'p3'])
    say(h, game, 'p4', 'eggs')
    assert.equal(game.round.phase, 'reveal', 'everyone answered, so no waiting for the clock')
    const shownAt = []
    while (game.round.phase === 'reveal') { h.fire(); shownAt.push(h.api.publicGame(game).round.groups.length) }
    assert.deepEqual(shownAt, [1, 2, 3], 'one group at a time')
    assert.deepEqual(labels(h.api.publicGame(game).round.groups), [['Toast', 1], ['Eggs', 2], ['Pancakes', 2]])
    assert.equal(game.round.phase, 'review')
    host(h, game, 'next') // the host locks the scores
    assert.equal(game.round.phase, 'scored')
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => score(game, `p${i}`)), [1, 1, 0, 1, 1])
    assert.equal(game.history.length, 1)
  })
  test('the answer clock is set up per game, and a missed answer counts as alone', () => {
    const h = harness(), game = newGame(h, { players: 3, answerSeconds: 60 })
    assert.equal(h.timers.minds.ms, 60000)
    assert.equal(newGame(harness(), { answerSeconds: 7 }).answerMs, DEFAULT_ANSWER_SECONDS * 1000, 'an odd clock falls back to the default')
    assert.ok(ANSWER_SECONDS.every((s) => s >= 30), 'generous clocks')
    say(h, game, 'p0', 'pizza'); say(h, game, 'p1', 'Pizza')
    h.fire() // time's up for p2
    assert.deepEqual(game.round.noAnswer, ['p2'])
    while (game.round.phase === 'reveal') h.fire()
    host(h, game, 'next')
    assert.deepEqual(game.round.alone, ['p2'])
    assert.equal(game.wolfId, 'p2')
  })
  test('answers are checked: blank, too late or twice is turned away', () => {
    const h = harness(), game = newGame(h, { players: 2 })
    assert.equal(say(h, game, 'p0', '   ').ok, false)
    assert.equal(say(h, game, 'p0', '?!').ok, false)
    assert.equal(say(h, game, 'p0', 'x'.repeat(80)).ok, true)
    assert.equal(game.round.answers.p0.length, 40)
    assert.equal(say(h, game, 'p0', 'again').ok, false)
    h.fire()
    assert.equal(say(h, game, 'p1', 'late').ok, false)
  })
})

describe('the Lone Wolf', () => {
  test('exactly one player alone takes it; two or more alone leaves it where it was', () => {
    assert.equal(nextWolf(null, ['a']), 'a')
    assert.equal(nextWolf('a', ['b']), 'b')
    assert.equal(nextWolf('a', ['b', 'c']), 'a')
    assert.equal(nextWolf('a', []), 'a')
  })
  test('it moves to the next player who ends up alone by themselves', () => {
    const h = harness(), game = newGame(h, { players: 4 })
    answerAll(h, game, ['pizza', 'pizza', 'pizza', 'sushi']); host(h, game, 'next')
    assert.equal(game.wolfId, 'p3')
    assert.equal(h.api.publicGame(game).round.wolfAfter, 'p3')
    host(h, game, 'next')
    answerAll(h, game, ['hat', 'mat', 'bat', 'bat']); host(h, game, 'next') // p0 and p1 both alone
    assert.equal(game.wolfId, 'p3', 'two alone: nobody takes it')
    host(h, game, 'next')
    answerAll(h, game, ['dog', 'dog', 'goldfish', 'dog']); host(h, game, 'next')
    assert.equal(game.wolfId, 'p2')
    assert.equal(game.status, 'playing')
    host(h, game, 'next')
    assert.equal(game.status, 'complete')
  })
  test('whoever holds it at the end can’t win; the win goes to the next best score', () => {
    const players = [{ id: 'a', score: 9 }, { id: 'b', score: 7 }, { id: 'c', score: 7 }, { id: 'd', score: 2 }]
    assert.deepEqual(winnersOf(players, 'a'), ['b', 'c'])
    assert.deepEqual(winnersOf(players, 'd'), ['a'])
    assert.deepEqual(winnersOf(players, null), ['a'])
    const h = harness(), game = newGame(h, { players: 3, prompts: ['Name a pet.'] })
    answerAll(h, game, ['dog', 'dog', 'cat']); host(h, game, 'next')
    game.players.get('p2').score = 50 // say the holder had the top score
    host(h, game, 'next')
    assert.equal(game.status, 'complete')
    assert.deepEqual(h.api.publicGame(game).winners, ['p0', 'p1'])
    assert.equal(h.api.publicGame(game).wolfId, 'p2')
  })
})

describe('merging with a host', () => {
  test('only the host merges or splits, during the review, before the scores lock', () => {
    const h = harness(), game = newGame(h, { players: 4 })
    answerAll(h, game, ['Pancakes', 'flapjacks', 'pancake', 'toast'])
    assert.deepEqual(labels(h.api.publicGame(game).round.groups), [['flapjacks', 1], ['toast', 1], ['Pancakes', 2]])
    const id = (label) => game.round.groups.find((g) => g.label === label).id
    // Players can't touch the answers in a hosted game.
    assert.equal(h.socketFor(game, 'p1')('minds:propose', { groups: [id('flapjacks'), id('Pancakes')] }).ok, false)
    assert.equal(h.socketFor(game, 'p1')('minds:vote', { yes: true }).ok, false)
    assert.equal(game.round.groups.length, 3)
    host(h, game, 'merge', { a: id('flapjacks'), b: id('Pancakes') })
    assert.deepEqual(labels(h.api.publicGame(game).round.groups), [['toast', 1], ['Pancakes', 3]], 'the bigger group keeps its name')
    // A split pulls one answer back out into a group of its own.
    host(h, game, 'split', { playerId: 'p0' })
    assert.deepEqual(labels(h.api.publicGame(game).round.groups), [['Pancakes', 1], ['toast', 1], ['pancake', 2]], 'the group is renamed after what’s left')
    host(h, game, 'split', { playerId: 'p1' })
    host(h, game, 'merge', { a: id('Pancakes'), b: id('pancake') })
    assert.deepEqual(labels(h.api.publicGame(game).round.groups), [['flapjacks', 1], ['toast', 1], ['Pancakes', 2]])
    host(h, game, 'next') // lock
    assert.deepEqual([0, 1, 2, 3].map((i) => score(game, `p${i}`)), [1, 0, 1, 0])
    // Locked: no more merging.
    host(h, game, 'merge', { a: id('flapjacks'), b: id('toast') })
    assert.equal(game.round.groups.length, 3)
  })
  test('a Next tagged with an old step is ignored, so a double tap can’t skip the review', () => {
    const h = harness(), game = newGame(h, { players: 3 })
    answerAll(h, game, ['cat', 'cat', 'dog'])
    const at = h.api.nextStep(game)
    assert.equal(at, '0:review')
    host(h, game, 'next', { at })
    assert.equal(game.round.phase, 'scored')
    host(h, game, 'next', { at }) // the second tap of a double tap
    assert.equal(game.round.phase, 'scored')
    assert.equal(game.index, 0)
    host(h, game, 'next', { at: h.api.nextStep(game) })
    assert.equal(game.index, 1)
  })
  test('the host review waits for the host; nothing runs out on its own', () => {
    const h = harness(), game = newGame(h, { players: 3 })
    answerAll(h, game, ['a', 'b', 'c'])
    assert.equal(game.round.phase, 'review')
    assert.equal(h.timers.minds, undefined)
    assert.equal(game.round.deadline, null)
  })
})

describe('merging without a host: a vote', () => {
  function hostlessReview(players = 5) {
    const h = harness(), game = newGame(h, { players, hostless: true })
    answerAll(h, game, ['Pancakes', 'flapjacks', 'pancake', 'toast', 'Waffles'].slice(0, players))
    const id = (label) => game.round.groups.find((g) => g.label === label).id
    return { h, game, id }
  }
  test('the TV (host screen) can’t merge in a game without a host', () => {
    const { h, game, id } = hostlessReview()
    host(h, game, 'merge', { a: id('flapjacks'), b: id('Pancakes') })
    assert.equal(game.round.groups.length, 4)
  })
  test('a merge goes through on a strict majority of the connected players', () => {
    const { h, game, id } = hostlessReview(5)
    assert.equal(game.round.phase, 'review')
    assert.equal(h.timers.minds.ms, MINDS_TIMES.reviewMs, 'the review waits a little for ideas')
    const proposal = h.socketFor(game, 'p1')('minds:propose', { groups: [id('flapjacks'), id('Pancakes')] })
    assert.equal(proposal.ok, true)
    assert.deepEqual(h.api.publicGame(game).round.proposal.yes, ['p1'], 'whoever floats it votes yes')
    assert.ok(game.round.deadline >= game.round.proposal.deadline, 'the review waits for the vote')
    assert.equal(h.socketFor(game, 'p2')('minds:propose', { groups: [id('toast'), id('Waffles')] }).ok, false, 'one idea at a time')
    h.socketFor(game, 'p0')('minds:vote', { yes: true })
    assert.equal(game.round.groups.length, 4, '2 of 5 is not a majority')
    h.socketFor(game, 'p3')('minds:vote', { yes: true })
    assert.equal(game.round.proposal, null)
    assert.deepEqual(labels(h.api.publicGame(game).round.groups), [['toast', 1], ['Waffles', 1], ['Pancakes', 3]])
    h.fire() // the review ends
    assert.equal(game.round.phase, 'scored')
    assert.equal(score(game, 'p1'), 2)
  })
  test('an idea is turned down once a majority is out of reach, and can’t be floated again', () => {
    const { h, game, id } = hostlessReview(4)
    const pair = [id('flapjacks'), id('Pancakes')]
    h.socketFor(game, 'p1')('minds:propose', { groups: pair })
    h.socketFor(game, 'p0')('minds:vote', { yes: false })
    assert.ok(game.round.proposal, '1 yes, 1 no of 4: still possible')
    h.socketFor(game, 'p3')('minds:vote', { yes: false })
    assert.equal(game.round.proposal, null, '3 of 4 needed, only 2 can say yes')
    assert.equal(game.round.groups.length, 3)
    assert.equal(h.socketFor(game, 'p2')('minds:propose', { groups: pair }).ok, false)
  })
  test('an idea nobody votes on runs out, and the review then ends', () => {
    const { h, game, id } = hostlessReview(5)
    h.socketFor(game, 'p1')('minds:propose', { groups: [id('flapjacks'), id('Pancakes')] })
    h.fire('mindsVote')
    assert.equal(game.round.proposal, null)
    h.fire()
    assert.equal(game.round.phase, 'scored')
  })
  test('the review clock waits for an open vote', () => {
    const { h, game, id } = hostlessReview(5)
    h.socketFor(game, 'p1')('minds:propose', { groups: [id('flapjacks'), id('Pancakes')] })
    h.fire() // the review's clock runs out mid-vote
    assert.equal(game.round.phase, 'review')
    assert.ok(game.round.proposal)
    h.fire('mindsVote'); h.fire()
    assert.equal(game.round.phase, 'scored')
  })
  test('each player gets a couple of ideas a round, so nobody can stall the review', () => {
    const { h, game, id } = hostlessReview(5)
    const ask = h.socketFor(game, 'p4'), groups = game.round.groups.map((g) => g.id)
    for (let i = 0; i < PROPOSALS_PER_PLAYER; i++) {
      assert.equal(ask('minds:propose', { groups: [groups[i], groups[i + 1]] }).ok, true)
      h.fire('mindsVote')
    }
    assert.equal(ask('minds:propose', { groups: [id('toast'), id('Waffles')] }).ok, false)
  })
  test('only connected players count, and a player dropping out can carry the vote', () => {
    const { h, game, id } = hostlessReview(5)
    h.socketFor(game, 'p1')('minds:propose', { groups: [id('flapjacks'), id('Pancakes')] })
    h.socketFor(game, 'p0')('minds:vote', { yes: true })
    game.players.get('p4').socketId = null; game.players.get('p3').socketId = null
    h.api.playerLeft(game, 'p4')
    assert.equal(game.round.proposal, null, '2 of 3 connected is a majority')
    assert.equal(game.round.groups.length, 3)
  })
  test('votes and ideas only come from the player’s own phone, and only during the review', () => {
    const { h, game, id } = hostlessReview(5)
    game.players.get('p2').socketId = null
    assert.equal(h.socketFor(game, 'p2')('minds:propose', { groups: [id('flapjacks'), id('Pancakes')] }).ok, false)
    h.fire() // the review ends
    assert.equal(h.socketFor(game, 'p1')('minds:propose', { groups: [game.round.groups[0].id, game.round.groups[1].id] }).ok, false)
  })
  test('without a host, rounds move on by themselves to the end', () => {
    const h = harness(), game = newGame(h, { players: 3, hostless: true })
    for (let round = 0; round < 3; round++) {
      answerAll(h, game, ['cat', 'cat', 'dog'])
      h.fire() // review
      assert.equal(game.round.phase, 'scored')
      assert.equal(h.timers.minds.ms, MINDS_TIMES.scoredMs)
      h.fire()
    }
    assert.equal(game.status, 'complete')
    assert.deepEqual(h.api.publicGame(game).winners, ['p0', 'p1'])
    assert.equal(game.history.length, 3)
  })
})

describe('the practice round', () => {
  test('one practice prompt with the real rules, nothing scoring and the Lone Wolf staying put', () => {
    const h = harness(), game = newGame(h, { players: 3, tutorial: true })
    assert.ok(inTutorial(game))
    assert.equal(game.round.prompt, PRACTICE_PROMPT)
    assert.equal(publicTutorial(game).step, 'answer')
    say(h, game, 'p0', 'Banana'); say(h, game, 'p1', 'bananas'); say(h, game, 'p2', 'lemon')
    h.api.publicGame(game)
    assert.equal(publicTutorial(game).step, 'reveal')
    while (game.round.phase === 'reveal') h.fire()
    h.api.publicGame(game)
    assert.equal(publicTutorial(game).step, 'review')
    host(h, game, 'next')
    h.api.publicGame(game)
    assert.equal(publicTutorial(game).step, 'scored')
    assert.equal(score(game, 'p0'), 0)
    assert.equal(game.wolfId, null)
    assert.equal(h.api.publicGame(game).round.wolfAfter, 'p2', 'the coach can still say who would have taken it')
    assert.equal(game.history.length, 0)
    host(h, game, 'next') // with a host, the host starts the game
    assert.ok(!inTutorial(game))
    assert.equal(game.round.prompt, PROMPTS_3[0])
    assert.equal(game.index, 0)
  })
  test('without a host, round one starts a few seconds after the practice', () => {
    const h = harness(), game = newGame(h, { players: 3, tutorial: true, hostless: true })
    answerAll(h, game, ['banana', 'banana', 'banana'])
    h.fire() // review
    h.fire() // scores
    h.api.publicGame(game)
    assert.equal(publicTutorial(game).step, 'done')
    assert.equal(h.timers.minds.ms, MINDS_TIMES.practiceEndMs)
    h.fire()
    assert.ok(!inTutorial(game))
    assert.equal(game.round.prompt, PROMPTS_3[0])
    assert.equal(score(game, 'p0'), 0)
  })
  test('the host can skip it; phones can’t', () => {
    const h = harness(), game = newGame(h, { players: 3, tutorial: true })
    h.socketFor(game, 'p0')('tutorial:vote')
    assert.ok(inTutorial(game), 'no player votes in a hosted game')
    game.hostSocketId = 'tv'
    h.socketFor(game, 'tv')('tutorial:skip')
    assert.ok(!inTutorial(game))
    assert.equal(game.round.prompt, PROMPTS_3[0])
    assert.equal(game.round.phase, 'answer')
  })
  test('without a host, it skips on a strict majority of connected players', () => {
    const h = harness(), game = newGame(h, { players: 4, tutorial: true, hostless: true })
    say(h, game, 'p0', 'banana')
    h.socketFor(game, 'p0')('tutorial:vote'); h.socketFor(game, 'p1')('tutorial:vote')
    assert.ok(inTutorial(game), '2 of 4 is not enough')
    h.socketFor(game, 'p2')('tutorial:vote')
    assert.ok(!inTutorial(game))
    assert.deepEqual(game.round.answers, {}, 'round one starts fresh')
    assert.equal(game.round.prompt, PROMPTS_3[0])
  })
  test('the skip button in the host’s Next during practice, and Skip round, both leave it', () => {
    const h = harness(), game = newGame(h, { players: 3, tutorial: true })
    host(h, game, 'skip')
    assert.ok(!inTutorial(game))
    assert.equal(game.index, 0)
    assert.equal(game.round.prompt, PROMPTS_3[0])
  })
  test('steps are declared in order', () => assert.deepEqual(MINDS_TUTORIAL_STEPS, ['answer', 'reveal', 'review', 'scored', 'done']))
})

describe('setup, players and Play again', () => {
  test('a game needs prompts and two players; rounds are capped by the config', () => {
    const h = harness()
    assert.throws(() => h.api.makeGame('X', { prompts: [] }))
    assert.equal(newGame(h, { players: 1 }).status, 'lobby')
    const many = Array.from({ length: 20 }, (_, i) => `Prompt ${i}`)
    assert.equal(h.api.makeGame('X', { prompts: many, rounds: 8 }).prompts.length, 8)
    assert.equal(h.api.makeGame('X', { prompts: many, rounds: 12 }).prompts.length, 12)
    assert.equal(h.api.makeGame('X', { prompts: many, rounds: 16 }).prompts.length, 16)
  })
  test('a player who leaves isn’t waited for', () => {
    const h = harness(), game = newGame(h, { players: 3 })
    say(h, game, 'p0', 'cat'); say(h, game, 'p1', 'cat')
    game.players.get('p2').socketId = null
    h.api.playerLeft(game, 'p2')
    assert.equal(game.round.phase, 'reveal')
  })
  test('a kicked player’s answer leaves with them', () => {
    const h = harness(), game = newGame(h, { players: 3 })
    say(h, game, 'p0', 'cat'); say(h, game, 'p2', 'dog')
    host(h, game, 'kickPlayer', { playerId: 'p2' })
    assert.equal(game.round.answers.p2, undefined)
    say(h, game, 'p1', 'cat')
    assert.equal(game.round.phase, 'reveal')
  })
  test('Play again: a new set of prompts, scores and the Lone Wolf reset, and no practice', () => {
    const h = harness(), game = newGame(h, { players: 3, tutorial: true })
    host(h, game, 'skip')
    answerAll(h, game, ['cat', 'cat', 'dog']); host(h, game, 'next')
    host(h, game, 'endGame')
    assert.equal(game.status, 'complete')
    host(h, game, 'replay', { prompts: ['Name a color.', 'Name a sport.'] })
    assert.equal(game.status, 'lobby')
    assert.deepEqual(game.prompts, ['Name a color.', 'Name a sport.'])
    assert.equal(game.wolfId, null)
    assert.equal(game.history.length, 0)
    assert.ok([...game.players.values()].every((p) => p.score === 0))
    host(h, game, 'start')
    assert.ok(!inTutorial(game))
    assert.equal(game.round.prompt, 'Name a color.')
  })
})

describe('the prompt pack', () => {
  test('about 200 original prompts, no repeats, enough for the longest game', () => {
    const prompts = PROMPTS.prompts.map(([, prompt]) => prompt)
    assert.ok(prompts.length >= 190, `${prompts.length} prompts`)
    assert.equal(new Set(prompts.map((p) => p.toLowerCase())).size, prompts.length)
    for (const [category, prompt] of PROMPTS.prompts) {
      assert.ok(category && typeof category === 'string')
      assert.ok(prompt.length <= 140, prompt)
    }
  })
})
