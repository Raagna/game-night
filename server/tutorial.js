// Tutorials: a short guided practice round a game can run before its first real round. Nothing scores, and coach
// text on the TV and the phones explains each step as players do it. The game keeps its own practice state; this file
// keeps which step the room is on and who wants to skip. See docs/tutorial.md for the whole contract.
//
// Skipping: with a host, only the host (the TV or the host controller) can skip. Without one, every phone gets a
// "Skip tutorial" vote, and the practice ends once a strict majority of the connected players have voted.

// Starts the tutorial on `steps`, the game's step ids in order. The first step is the current one.
export function beginTutorial(game, steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('A tutorial needs at least one step.')
  game.tutorial = { steps: [...steps], step: steps[0], votes: [] }
}
export const inTutorial = (game) => !!game?.tutorial
// Moves to step `id` (one of the declared steps). Returns false, and stays put, for an unknown step.
export function setTutorialStep(game, id) {
  if (!game?.tutorial?.steps.includes(id)) return false
  game.tutorial.step = id
  return true
}
// Leaves the tutorial. Returns true if the game was in one, so a second end (a skip racing the last step) does nothing.
export function endTutorial(game) {
  const was = inTutorial(game)
  game.tutorial = null
  return was
}

const connectedIds = (game) => [...game.players.values()].filter((player) => player.socketId).map((player) => player.id)
// A strict majority of the connected players: 1 of 1, 2 of 2, 2 of 3, 3 of 4, 3 of 5.
export const votesNeeded = (connected) => Math.floor(connected / 2) + 1
// The votes that count: only connected players' (a vote comes back with its player when they reconnect).
const liveVotes = (game) => { const live = connectedIds(game); return game.tutorial.votes.filter((id) => live.includes(id)) }
// True once enough connected players want to skip. Check it again whenever a player drops out or leaves, since the
// number needed goes down with them.
export function skipCarried(game) {
  if (!inTutorial(game) || !game.hostless) return false
  const connected = connectedIds(game).length
  return connected > 0 && liveVotes(game).length >= votesNeeded(connected)
}
// A player's Skip tutorial tap: a vote, or taking their vote back. Returns true when it carries the skip.
export function toggleSkipVote(game, playerId) {
  if (!inTutorial(game) || !game.hostless || !game.players.has(playerId)) return false
  const { votes } = game.tutorial
  game.tutorial.votes = votes.includes(playerId) ? votes.filter((id) => id !== playerId) : [...votes, playerId]
  return skipCarried(game)
}

// What the screens get as `game.tutorial`: null outside the tutorial.
export function publicTutorial(game) {
  if (!inTutorial(game)) return null
  const connected = connectedIds(game).length
  return { step: game.tutorial.step, steps: game.tutorial.steps, votes: liveVotes(game), connected, needed: votesNeeded(connected) }
}

// The skip events, for every game. `end(game)` is the game's own way out of its tutorial into the first real round;
// the caller looks it up for the game (see server/index.js).
//   tutorial:skip { code }            from the TV or host controller of a hosted game
//   tutorial:vote { code, playerId }  from a player's own phone in a hostless game (a second tap takes it back)
export function registerTutorial(socket, { games, emitGame, end }) {
  const isHostScreen = (game) => game.hostSocketId === socket.id || socket.data.controllerGame === game.code
  socket.on('tutorial:skip', ({ code } = {}) => {
    const game = games.get(code)
    if (!inTutorial(game) || game.hostless || !isHostScreen(game)) return
    end(game)
  })
  socket.on('tutorial:vote', ({ code, playerId } = {}) => {
    const game = games.get(code), player = game?.players.get(playerId)
    if (!inTutorial(game) || !game.hostless || !player?.socketId || player.socketId !== socket.id) return
    if (toggleSkipVote(game, playerId)) end(game)
    else emitGame(game)
  })
}
