# Tutorials: a practice round before the first real round

Any game can run a short guided practice round before its first real round. Nothing scores, and a coach banner on
the TV, the host controller and every phone explains each step as the players do it. Jeoparty! is the first game to
use it (two practice clues: a regular clue, then a Daily Double); this page is the contract for adding one to another
game.

The pieces:

- `server/tutorial.js`: which step the room is on, the skip votes, and the two skip events. Tests: `server/tutorial.test.js`.
- `src/Tutorial.jsx`: `<Coach>` (the banner, with the skip control in it) and `<TutorialSkip>` (the skip control alone).
- Styles: the "Tutorials" section of `src/styles.css` (`.coach`, `.tutorial-skip`, `.tutorial-tally`). They read the
  game's `--table` lamp, so the banner takes each game's colour without extra CSS.

## Skipping

- **With a host:** only the host can skip. The TV and the host controller show a **Skip tutorial** button; phones get
  no skip control, just the note "The host can skip the practice."
- **Without a host:** every phone shows a **Skip tutorial** vote (tap again to take it back), and the TV shows the
  count, e.g. "3 of 5 want to skip · skips at 3". The practice is skipped as soon as a **strict majority of the
  connected players** have voted (1 of 1, 2 of 2, 2 of 3, 3 of 4, 3 of 5…). Only connected players' votes count, and
  a player dropping out lowers the number needed, so a disconnect can carry the vote.

## Server

### 1. Declare the steps and enter the tutorial

Steps are short ids, in order. Enter the tutorial when the host starts the game from the lobby, and keep
`game.status` as `'playing'` so joining and reconnecting work as they do in the game.

```js
import { beginTutorial, setTutorialStep, endTutorial, inTutorial } from './tutorial.js'

const TUTORIAL_STEPS = ['faceoff', 'guess', 'strike', 'done']

// in hostAction 'start', only when coming from the lobby and the setup asked for it:
if (fromLobby && game.config.tutorial) { beginTutorial(game, TUTORIAL_STEPS); /* set up your practice state */ }
```

Add a `tutorial: !!config.tutorial` option to your game's config (Jeoparty's setup has a "Practice round first"
checkbox, on by default), and leave it off on a replay.

### 2. Move through the steps

Call `setTutorialStep(game, id)` whenever your practice state moves on (an unknown id is ignored and returns false).
If the step can be read straight off your state, do what Jeoparty does: compute it at the top of your `publicGame`
(`if (game.tutorial) setTutorialStep(game, practiceStep(game))`), so the coach can never disagree with the screen.

While `inTutorial(game)`, play the practice with your real rules but **don't change scores** (Jeoparty sends every
score change through one `award(game, player, amount)` that does nothing during the tutorial), and hide or refuse
anything that would leave the practice early (Jeoparty's "skip to the next round" ends the tutorial instead, and its
per-clue skip vote is off).

### 3. Leave it

Export `endTutorial(game)` from your mode (next to `publicGame`, `hostAction` and the rest). It's called when the
host skips, when the vote carries, and should be called by you when the last step is done. It must:

1. call the helper's `endTutorial(game)` first and return if that returns false (the practice already ended; a skip
   can race the last step),
2. clear your practice state and timers, put scores back to 0,
3. start your first real round, and `emitGame(game)`.

```js
import { endTutorial as leaveTutorial } from './tutorial.js'
function endTutorial(game) {
  if (!leaveTutorial(game)) return
  clearGameTimers(game); game.practice = null
  for (const player of game.players.values()) player.score = 0
  startFirstRound(game)
  emitGame(game)
}
return { MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, register, endTutorial }
```

### What `server/index.js` already does for every game

- Adds `tutorial` to every game's public state: `null` outside the tutorial, otherwise
  `{ step, steps, votes, connected, needed }` (`votes` are the ids of connected players who voted).
- Registers the skip events for every socket, and calls your mode's `endTutorial(game)` when a skip goes through:

  | Event | Payload | From | Accepted when |
  | --- | --- | --- | --- |
  | `tutorial:skip` | `{ code }` | the TV or the host controller | the game has a host and is in its tutorial |
  | `tutorial:vote` | `{ code, playerId }` | that player's own phone | the game has no host and is in its tutorial; a second vote takes it back |

- Re-checks the vote when a player disconnects (and when Jeoparty kicks one).

## Client

`<Coach>` renders nothing outside the tutorial, so it can sit in your screens unconditionally.

```jsx
import { Coach } from "../Tutorial";

const COACH = {
  faceoff: {
    tv: "Two players face off: the first to buzz in answers.",
    phone: ({ game, me, name }) => game.faceoff.playerIds.includes(me) ? "You’re in the face-off. Buzz in!" : `${name(game.faceoff.playerIds[0])} and a rival face off.`,
    controller: "Read the question, then open the buzzers.",
  },
  // …
  done: { tv: "That’s the practice! Round one starts now.", skip: "Start the game" },
};

<Coach game={game} coach={COACH} place="tv" />                          // the TV
<Coach game={game} coach={COACH} place="controller" />                  // the host controller
<Coach game={game} coach={COACH} place="phone" playerId={playerId} />   // a phone
```

- `coach` has one entry per step id. Each place's text is a string or a function of `{ game, me, name }`: `me` is the
  phone's player id, `name(id)` a player's name. `controller` falls back to `tv`; a missing step shows no text.
- `skip` (optional) relabels the host's skip button on that step and lights it as the screen's main action, e.g.
  "Start the game" once the practice is done.
- `title` (optional prop) replaces the banner's label, "Practice round · nothing scores".
- The skip control comes with the banner and follows the rules above. To put it somewhere else, use
  `<TutorialSkip game={game} place="tv" | "controller" | "phone" playerId={playerId} />`.
- Hide things that don't belong in the practice (Jeoparty hides "Skip to next round" and its per-clue skip vote while
  `game.tutorial` is set).

## Jeoparty's practice round, as the worked example

- Server (`server/index.js`, "Practice round"): `PRACTICE_STEPS = pick, read, buzz, answer, wager, reveal, done`; a
  one-category practice board (a $200 clue, then a $400 Daily Double) played through the real clue code via
  `currentBoard(game)`; `practiceStep(game)` reads the step off the clue's state; `award()` keeps scores at 0;
  `endPractice(game)` is its `endTutorial`. Without a host the game starts 9 seconds after the last practice clue;
  with one, the host starts it with the skip button (labelled "Start the game" on the last step).
- Client (`src/main.jsx`): `JEOPARTY_COACH` holds the text for every step and place; the TV, controller and phone each
  render `<Coach>`.
