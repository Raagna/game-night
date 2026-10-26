# Wheel of Fortune: build plan

A third Game Night game: a hangman-style word puzzle game played with a spinning wheel, following the TV show's rules as closely as a TV-plus-phones party game allows. It stands alone: its own puzzle pack, with nothing taken from the Jeopardy archive or the Survey Says! packs.

Shown as **Spin & Solve**. Internal name: `kind: 'wheel'`, files in `server/wheel.js` and `src/wheel/`. Decisions on the open questions are at the end.

---

## 1. How a game runs

### The show's order, and ours

| # | Segment | Show | Our default ("Classic") |
|---|---|---|---|
| 1 | Toss-up | $1,000 | $1,000. The winner starts Round 1 |
| 2 | Toss-up | $2,000 | $2,000 |
| 3 | Round 1 | Top value $2,500, Wild Card, Gift, Million wedge | Same |
| 4 | Round 2 | Top value $3,500, two Mystery wedges | Same |
| 5 | Toss-up | $3,000 | $3,000. The winner starts Round 3 |
| 6 | Round 3: Prize Puzzle | Top value $3,500, Express wedge, the solver wins a trip | Same, but the "trip" is worth points |
| 7 | Round 4: final round | Top value $5,000, plays normally until the speed-up | Same (see the speed-up trigger below) |
| 8 | Tiebreaker toss-up | Only when the top score is tied after the speed-up; the winner gets +$1,000 | Same |
| 9 | Bonus round | Highest total plays; RSTLNE; prize envelope | Same |

Setup also offers **Short** (Toss-up → Round 1 → Round 2 → Final round → Bonus, about 20 minutes) and a **custom** option: 3–5 main rounds, toss-ups on or off, bonus round on or off.

Who starts each round: the winner of the toss-up just before it. When no toss-up comes first, control rotates: contestant 1 starts Round 1, contestant 2 starts Round 2, and so on.

### A turn in a main round

```
          ┌────────────── turn (decide clock) ───────────────┐
          │  Spin            Buy a vowel ($250)      Solve   │
          └───┬──────────────────┬────────────────────┬─────┘
           spinning           pick vowel           solving
              │                   │                     │
   ┌──────────┼──────────────┐    ├─ in puzzle → turn   ├─ right → round won
 Bankrupt  Lose a Turn   $ / special  └─ not → next      └─ wrong → next
   │          │              │
 next      next        call consonant (clock)
                             ├─ in puzzle: + value × count → turn
                             │      (Wild Card: may call a 2nd consonant at the same value)
                             └─ not in puzzle / already called / time up → next
```

"next" means control passes to the next contestant in join order, which is the show's "clockwise."

The show's rules this follows:
- **Consonants** are only called after a spin. Each one found earns the spin value times the number of times it appears.
- **Vowels** cost a flat $250 from the round bank. You can't buy one with less than $250, or once every vowel is showing.
- **Spinning is disabled once every consonant is showing** ("only vowels remain").
- **You lose your turn** when you land on Lose a Turn or Bankrupt, call a letter that isn't in the puzzle, call a letter already called, solve wrong, or run out of time.
- **Bankrupt** wipes the round bank and any Gift or Million Dollar wedge picked up this round. It also takes away a Wild Card or Million Dollar wedge carried over from earlier rounds. Totals banked in earlier rounds are safe.
- **Solving** banks the round bank, the Gift, the Prize Puzzle trip and the Million Dollar wedge. Anyone who solves for less than $1,000 is raised to $1,000. Everyone else loses their round bank. A Wild Card is kept even without solving.
- **Revealing the last missing letter** counts as solving it for the contestant who called that letter.

### Special wedges

| Wedge | Rounds | What it does |
|---|---|---|
| **Wild Card** | 1–3, while nobody holds it | Sits on top of a $ wedge. Land there and call a right consonant to take the card. Later, after a right consonant, the holder may call a second consonant for the same spin value, or save the card for a 4th bonus-round consonant. It's used up once played and lost to Bankrupt. |
| **Gift** | 1–3 | Pays $500 per letter plus a named gift (for example "Trip to Lisbon, $6,500"), banked only if you solve |
| **Million Dollar wedge** | 1–3, while nobody holds it | One wedge split into thirds: Bankrupt, Million, Bankrupt. Land on the middle third and call a right consonant to take it ($500 per letter). Solve the round to keep it. If its holder plays the bonus round, the $100,000 envelope becomes $1,000,000. |
| **Mystery** ×2 | 2 | $1,000 per letter. After a right consonant, either take that money, or give it up and flip the wedge: one Mystery hides $10,000 and the other Bankrupt (the server decides which when the round starts). Once one is flipped, the other becomes a plain $1,000 wedge. |
| **Express** | 3 | $1,000 per letter. Then choose: **Pass** and play on normally, or **Play** and keep calling consonants for $1,000 each without spinning, buying vowels at $250, until you solve. Any wrong letter, repeated letter, timeout or wrong solve counts as Bankrupt. |

### Wheel layouts (24 wedges each)

| Round | Wedges |
|---|---|
| 1 | $2,500 ×1 · Bankrupt ×2 · Lose a Turn ×1 · Million ×1 · Gift ×1 · $500–$900 ×18 (one carries the Wild Card) |
| 2 | $3,500 ×1 · Bankrupt ×2 · Lose a Turn ×1 · Million ×1 · Gift ×1 · Mystery ×2 · $500–$900 ×16 (one carries the Wild Card) |
| 3 | $3,500 ×1 · Bankrupt ×2 · Lose a Turn ×1 · Million ×1 · Gift ×1 · Express ×1 · $500–$900 ×17 (one carries the Wild Card) |
| 4+ / final | $5,000 ×1 · Bankrupt ×2 · Lose a Turn ×1 · $500–$900 ×20 |

When the Million wedge or Wild Card isn't in play (someone holds it), its spot becomes a plain $ wedge, so every wheel keeps 24 wedges.

The wheel is modelled as **72 slots** (24 wedges × 3 thirds). Every wedge fills its three slots with the same thing, except the Million wedge, which is Bankrupt / Million / Bankrupt. One list of slots covers every case.

### Toss-ups

The category shows and letters appear one at a time in random order (one every ~1.1 s). Any contestant can buzz from their phone. The first to buzz gets the solve clock (10 s) to fill in the blanks. Right wins the toss-up cash (added straight to their total) and control of the next round. Wrong locks that contestant out of this toss-up, and the letters keep coming. If the board is down to one hidden letter and nobody has solved, the toss-up ends with no winner.

### The final round's speed-up

1. Round 4 plays normally until the speed-up starts: by default after **2 minutes** of play, or earlier if the host presses "Speed-up." With no host, it always starts on that clock. A setup option can make it start right away. Like the show's bell, it starts at the next turn: a spin already under way is played out first, and paused clocks hold the two minutes back too.
2. The contestant in control makes the **final spin**. Non-dollar results respin automatically. Consonants are worth that value + $1,000 for the rest of the round. **Vowels are free** and worth $0.
3. Each turn: call any letter, or solve straight away. If the letter is in the puzzle, the letters light up and that contestant gets the speed-up solve clock (10 s on phones instead of the show's 3 s spoken, because typing is slower), with as many tries as fit in the time. A miss or a timeout passes control.
4. After the round: anyone who solved no puzzles gets $1,000. If the top total is tied, the tied contestants play a tiebreaker toss-up for +$1,000.

### Bonus round

1. The contestant with the highest total picks one of **three categories**, each hiding a bonus puzzle.
2. They spin the **bonus wheel**: 24 envelopes from $40,000 to $100,000, with one $100,000. If they hold the Million Dollar wedge, the $100,000 envelope becomes $1,000,000. The envelope stays sealed.
3. The puzzle appears, and R S T L N E light up.
4. They pick **3 consonants and 1 vowel**, plus a 4th consonant with the Wild Card. Those letters light up.
5. **10 seconds** to solve, with as many tries as fit in the time.
6. The envelope opens. Its value is added only if they solved.

### Players and teams

- **Solo** (default): 2–6 contestants, one phone each. The show uses 3.
- **Teams**: 2–4 teams, up to 12 phones. Each team plays as one contestant and its members take turns acting, the way the show's two-person teams work. New phones join the smallest team, like Survey Says!.
- Late joiners in solo mode become a new contestant with $0. Contestants whose phones are all disconnected are skipped in the turn order.

### Clocks

Clocks run with or without a host. The host can pause them from the controller. Setup offers **Show pace** or **Relaxed** (every clock doubled).

| Clock | Show pace |
|---|---|
| Decide: spin, buy or solve | 10 s |
| Call a consonant after the spin / pick a vowel | 10 s |
| Solve (main round) | 20 s |
| Solve (toss-up after a buzz, speed-up, bonus) | 10 s |
| Mystery flip / Express pass-or-play | 10 s |
| Wheel spin animation (locked, no input) | ~5 s |
| Toss-up letter reveal | 1.1 s per letter |
| Round result on screen before the next segment | 8 s with no host; with a host, it waits for "Next" |
| Speed-up starts after | 2 min into the final round |

---

## 2. Solving on a phone

On the show you solve by saying the answer, and it has to be said exactly. On a phone, typing a whole phrase invites typos, and a fuzzy match would break the "exactly" rule.

**Plan: fill in the blanks.** The Solve screen shows the board with the hidden tiles empty. Typing fills them in order, Backspace steps back, and you can tap a tile to jump to it. The server compares the filled letters with the hidden ones exactly. This makes the "read exactly" rule automatic, needs no matching code, and works the same in toss-ups, the speed-up and the bonus round.

In **host mode**, the controller also shows **Correct / Wrong** buttons while someone is solving, so a player can say the answer out loud and the host judges it, like the show. Whichever comes first wins.

---

## 3. Server

### Changes to `server/index.js`

Right now the server only tells Jeopardy and Survey Says! apart (`isSurvey`, and `jGame` returns a game unless it's a survey). A Wheel game would slip through `jGame` into the Jeopardy handlers. Before anything else, switch to looking the game up by `kind`:

```js
const modes = { survey, wheel }               // each from its create…Games factory
const modeOf = (game) => modes[game?.kind]
const jGame = (code) => { const game = games.get(code); return game && !game.kind ? game : undefined }
```

…and send each existing `isSurvey(game) ? survey.x : …` call through `modeOf(game)?.x ?? …`: `publicGame`, `host:create` (`config.game`), `MAX_PLAYERS`, `playerJoined`, `host:action`, and the disconnect handler's `playerLeft`. `wheel.register(socket)` goes next to `survey.register(socket)`. This is a small change that makes any future game a one-line addition.

### `server/wheel.js`: `createWheelGames({ io, games, emitGame, schedule, clearGameTimers, cancelLeave })`

It returns `{ MAX_PLAYERS, makeGame, publicGame, playerJoined, playerLeft, hostAction, register, sendSecret }`, the same shape as `survey.js`.

### `server/wheelBoard.js`: puzzle layout (no dependencies)

- The board is 4 rows of **12 / 14 / 14 / 12** tiles. Rows 1 and 4 are indented by one tile.
- Whole words wrap greedily. Short puzzles sit in the middle: 1 row → row 2, 2 rows → rows 2–3, 3 rows → rows 1–3 or 2–4 depending on length.
- Every row is centred.
- Punctuation (`' - & ? ! . ,`) is shown from the start.
- `layout(text) → { rows: [[cell|null]] }` where `cell = { ch, letter: bool }`.
- Used by the server and by the puzzle check script.

### Game state (server only)

```js
{
  kind: 'wheel', code, status: 'lobby' | 'playing' | 'bonus' | 'complete',
  hostSocketId, hostless, players: Map<id, { id, name, socketId, contestant /* index */ }>,
  config: { mode: 'solo' | 'teams', teamNames, segments /* see below */, pace: 'show' | 'relaxed', speedUpAfterMs },
  contestants: [{
    name, color, total, roundBank,
    roundPrizes: [{ name, value }],        // gift, trip: kept only on a solve
    wildCard: false, million: false,       // held across rounds
    millionThisRound: false, solvedAny: false,
    turnRotation: 0,                       // team mode: which member acts next
  }],
  segments: [                              // fixed when the game is created
    { type: 'tossup', value: 1000, puzzle },
    { type: 'round', n: 1, wheel: 'r1', puzzle },
    { type: 'round', n: 3, wheel: 'r3', prizePuzzle: { name, value }, puzzle },
    { type: 'final', wheel: 'r4', puzzle },
    { type: 'bonus', choices: [puzzle, puzzle, puzzle] },
  ],
  spareTossups: [puzzle, …],               // for the tiebreaker
  segmentIndex,
  round: {
    type: 'tossup' | 'round' | 'final' | 'tiebreak',
    puzzle: { id, category, text, rows },  // the solution: never in publicGame
    shown: Set<letter>,                    // letters lit on the board
    called: [letter],                      // every letter called this round (for the letter board)
    control,                               // contestant index
    actorId,                               // the phone allowed to act right now
    phase,                                 // see below
    deadline, pausedRemaining,
    wheel: { slots: [72], wildSlot, mysteryTenK /* wedge index */, mysteryFlipped },
    spin: { id, slot, jitter, at, ms } | null,
    value,                                 // what the current spin pays per consonant
    express: false,
    speedUp: { value } | null, startedAt,
    tossup: { order: [cellIndex], next, buzzedId, lockedOut: [contestant] },
    lastSolve: { playerId, guess, correct },
    winner,
  },
  bonus: { contestant, playerId, phase, choiceIndex, envelopes: [24], envelopeSlot, picked: [], deadline, tries, solved, prize },
  undo, lastEvent, recentEvents, eventSeq,
}
```

`round.phase` is one of:

| Phase | Who acts | What's waiting |
|---|---|---|
| `tossupReveal` | anyone not locked out | buzz |
| `tossupSolve` | the buzzer | fill in the blanks |
| `turn` | control | spin / buy / solve (+ use the Wild Card when allowed) |
| `spinning` | nobody | animation; then the landing is applied |
| `consonant` | control | call a consonant at `value` |
| `mystery` | control | take the $1,000s or flip |
| `expressChoice` | control | pass or play |
| `express` | control | consonant / vowel / solve, no spinning |
| `solving` | control | fill in the blanks |
| `finalSpin` | control | the final spin (respins automatically) |
| `speedLetter` | control | any letter, or solve |
| `speedSolve` | control | fill in the blanks after a hit |
| `roundEnd` | host / clock | next segment |

Bonus phases (`bonus.phase`): `pick` → `spin` → `spinning` → `letters` → `lighting` → `solve` → `envelope`.

### What clients see: `publicGame(game)`

The board goes out as cells, so a phone never receives a letter that hasn't been shown:

```js
{
  kind: 'wheel', code, status, hostless, hostConnected, pace, mode,
  players: [{ id, name, contestant, connected }],
  contestants: [{ name, color, total, roundBank, wildCard, million, prizes }],
  segment: { index, count, type, label /* "Toss-up · $2,000", "Round 3 · Prize Puzzle" */ },
  round: {
    phase, category, control, actorId, deadline, paused,
    board: [[null | { ch: 'A' | '' , letter: true, lit: bool } | { ch: '-', letter: false }]],
    called: ['T', 'R', …], misses: ['Q'],
    vowelsLeft: bool, consonantsLeft: bool,
    wheel: { wedges: [24 × { kind, value, label }], wildWedge, mysteryFlipped },
    spin, value, express, speedUp,
    tossup: { buzzedId, lockedOut },
    lastSolve, winner,
    solution: /* only once the round ends */,
  },
  bonus: { contestant, phase, categories, envelopeSlot, picked, deadline, prize /* after the envelope opens */ },
  serverNow, lastEvent, events,
}
```

**The answer goes only to the host controller.** `emitGame` broadcasts one payload to the whole room: the TV, every phone and the controller. So the solution never goes in it. When a round starts (or a controller connects), `sendSecret(game)` emits `wheel:solution { code, text }` only to sockets whose `socket.data.controllerGame === code`. The TV doesn't get it either, since everyone can see the TV.

The spin's `slot` and `jitter` are public as soon as the wheel starts. The TV needs them to animate to the right spot, and every screen then shows the same landing. The server only applies the result after `ms`, so seeing it half a second early doesn't help anyone.

### Socket events

Phone → server (each checked against `actorId`/phase, like the `survey:*` handlers):

| Event | Payload | When |
|---|---|---|
| `wheel:spin` | `{ code, playerId, power }` | `turn`, `finalSpin`, bonus `spin`. `power` (0–1, from the swipe) only changes how many times the wheel visibly turns; the landing is random on the server |
| `wheel:consonant` | `{ letter, wild? }` | `consonant`, `express`, or `turn` with `wild: true` right after a hit |
| `wheel:buyVowel` | `{ letter }` | `turn`, `express` (charges $250 and calls the vowel in one step) |
| `wheel:letter` | `{ letter }` | `speedLetter` (any letter) |
| `wheel:solveStart` | `{}` | `turn`, `express`, `speedLetter`: starts the solve clock |
| `wheel:solve` | `{ guess }` | the letters for the hidden tiles, in order. `solving`, `tossupSolve`, `speedSolve`, bonus `solve` (repeatable until time runs out) |
| `wheel:buzz` | `{}` | `tossupReveal` |
| `wheel:mystery` | `{ flip }` | `mystery` |
| `wheel:express` | `{ play }` | `expressChoice` |
| `wheel:bonusPick` | `{ index }` | bonus `pick` |
| `wheel:bonusLetters` | `{ consonants: [3–4], vowel }` | bonus `letters` |
| `wheel:team` | `{ team }` | lobby, team mode |

Every event also carries `code` and `playerId`.

Host → server (`host:action`, already wired up): `start`, `judgeSolve { correct }`, `pause` / `resume`, `skipTurn`, `speedUp`, `revealPuzzle` (end the round with no winner), `nextSegment`, `undo`, `endGame`, `replay { segments? }`, `adjustScore { contestant, amount }`, `renamePlayer`, `renameTeam`, `movePlayer`, `kickPlayer`.

Server → clients: `game:update` (the existing event) and `wheel:solution` (controller only).

Events for sound (`lastEvent` / `events`, numbered like Survey Says!): `spin`, `land` (with the wedge kind), `hit` (with count), `miss`, `repeat`, `bankrupt`, `loseTurn`, `vowel`, `solve`, `wrongSolve`, `tossupLetter`, `buzz`, `wild`, `million`, `mysteryFlip` (with the result), `express`, `speedUp`, `bonusLetters`, `envelope`, `complete`.

### Leaving, kicking, undo

- **A player leaves** (after the 20 s reconnect grace) or is kicked: if they were `actorId`, team mode hands the turn to a teammate. Otherwise control passes on, the same as a timeout. A contestant with no connected phones is skipped.
- **Undo** (host): a snapshot of `round` + `contestants` before each letter or solve ruling, as `survey.js` does with `saveUndo`. It's mostly there for wrong host judgements.

---

## 4. Puzzles

`src/wheel/puzzles.json` is bundled like `src/surveys.json`, all written for this project:

```json
{
  "main":  { "Phrase": ["A penny for your thoughts", …], "Thing": […], … },
  "bonus": { "Thing": ["Folding chair", …], … },
  "gifts": [["Spa weekend", 3000], …],
  "trips": [["Trip to Lisbon", 8500], …]
}
```

Puzzles are written in normal case and shown in capitals. A puzzle's id is its text in capitals, which the check script keeps unique.

- **Main pool: about 500 puzzles** (675 so far). Mostly everyday phrases and figures of speech, like the show, spread over the categories: Phrase, Thing, Things, Place, Person, Proper Name, Food & Drink, Around the House, Living Thing, Event, Fun & Games, Occupation, What Are You Doing?, Before & After, Rhyme Time, Same Name, Same Letter, Landmark, On the Map, Character, Title.
- **Bonus pool: about 150** (153 so far). Two or three words, deliberately light on R S T L N E.
- **Toss-ups** come from the main pool.
- A game uses about 10 puzzles, so 500 is roughly 50 games before repeats. Already-played puzzles are remembered in `localStorage` (like `gameNight.survey.played.v1`) and skipped.
- Setup lists the chosen puzzles by category only, with a swap button for each. The answers stay hidden, because the host may also be playing.

`scripts/check-wheel-puzzles.mjs` (Node, uses `server/wheelBoard.js`) checks every puzzle: only A–Z and the allowed punctuation, fits the board, no duplicates across pools, known category, bonus puzzles 2 or 3 words, every word of a Same Letter puzzle starts with the same letter, Same Name puzzles have " & ", Before & After puzzles have at least three words (whether they share a word can't be checked mechanically). It warns about main puzzles with fewer than 8 letters, and about bonus puzzles where R S T L N E already show more than 60% of the letters. Run it with `npm run check:puzzles` whenever the pack changes. `npm test` runs the board layout tests.

**Crossword puzzles** (words in any order, linked by a clue) are left out of v1. They need a different board layout and different solve checking.

---

## 5. Screens (`src/wheel/`)

### `WheelSetup` (TV, `?host&game=wheel`)
- Game length: Classic / Short / Custom (3–5 main rounds, toss-ups on/off, bonus on/off).
- Solo or teams (team names).
- Pace: Show / Relaxed. Speed-up: after 2 min / from the start.
- Play with a host / without a host.
- Puzzles: one row per segment showing its category and a swap button. "Don't repeat puzzles we've played" is on by default.

### `WheelDisplay` (TV)
- **Lobby**: QR code and code (reusing `JoinQR`), contestants or teams as they join.
- **Main layout**: the **puzzle board** across the top (green unused tiles, white hidden letter tiles that flip when lit, one at a time like the show's letter turner), the **category** under it, the **wheel** on one side, and the **used-letter board** (A–Z, called letters greyed, misses struck through) on the other. **Podiums** along the bottom (red / yellow / blue / green / purple / orange) with round bank, total, Wild Card and Million badges, and a clock ring on whoever's acting.
- **Wheel**: SVG with 24 wedges, the pointer at the top, and pegs between wedges. The spin is one CSS `transform: rotate()` with a strong ease-out over ~5 s, ending at `slot` centre + `jitter`. Every screen lands in the same place. Peg ticks are timed from the rotation angle while it spins.
- **Overlays**: BANKRUPT, Lose a Turn, Mystery flip (the wedge flips over), Express "Pass or Play?", Wild Card / Million picked up, "Solving…", round won (the whole puzzle lights up and the round bank counts into the total), Speed-up banner ("Consonants worth $1,700 · vowels free"), toss-up letters appearing, tiebreaker.
- **Bonus**: three category cards, the envelope wheel, RSTLNE lighting, the chosen letters lighting, a big 10 s clock, then the envelope opening.
- Sound on/off button in the corner (same as Survey Says!).

### `WheelPlayer` (phone)
- **Lobby**: your name, your colour, and the team picker in team mode.
- **Waiting**: a small copy of the board, whose turn it is, your round bank and total.
- **Your turn**: three big buttons, **Spin**, **Buy a Vowel $250**, **Solve**, plus **Use Wild Card** when you can. Buttons you can't use are disabled with a reason ("Only vowels left", "You need $250").
- **Spin**: drag down on a wheel graphic (or tap). The strength sends `power`.
- **Letter picker**: a keyboard of consonants or vowels. **Letters already called are disabled.** (The show treats a repeat as losing your turn; see open questions.)
- **Solve**: fill-in-the-blanks board, a typing keyboard, a Submit button and the clock.
- **Mystery**: "Take $3,000" / "Flip it!". **Express**: "Pass" / "Play".
- **Toss-up**: a big **BUZZ** button. Greyed out when you're locked out.
- **Bonus**: category cards, spin, letter picks (3 + 1, with a counter), solve.
- In team mode, everyone on the team sees the screens, but only the member whose turn it is can act ("Sam is playing for your team").

### `WheelController` (host's second window)
- **The answer** in large type (from `wheel:solution`).
- During a solve: **Correct / Wrong**.
- Pause / resume clocks, Skip turn, Start speed-up, Reveal & end round, Next segment, Undo.
- Contestants: rename, adjust score, move between teams, kick.

### `WheelEnd`
Final podium, the bonus round result, a Play again button (new puzzles), Back to Game Night.

### Wiring
- `Hub.jsx`: add a third card.
- `main.jsx`: `pick === "wheel"` → `<WheelSetup>`, and a `game.kind === "wheel"` block next to the Survey Says! one.
- Sounds: `src/wheel/sounds.js`, all synthesized (peg ticks, the letter ding, the miss buzzer, a falling "Bankrupt" slide, a solve fanfare, bonus clock ticks, the envelope reveal), using the building blocks in `src/survey/sounds.js` (`note`, the mute switch, `useEventSounds`). Those get exported, or moved into a shared `src/sounds.js`, so the mute button covers the whole site.

---

## 6. What changes from the show, and why

| Show | Here | Why |
|---|---|---|
| Solve by speaking | Fill in the blanks on the phone (and spoken + host judging in host mode) | Exact solves with no typo matching |
| Speed-up: 3 s to solve | 10 s | Typing takes longer than speaking |
| Calling a used letter loses the turn | Used letters are disabled | Fewer mis-taps on phones (open question) |
| Cash, trips, cars | Points only. Gifts and trips are named for fun and count their value | It's a party game |
| Crossword puzzles | Left out of v1 | Needs a different board |
| 3 contestants | 2–6, or teams | Bigger groups |
| Speed-up starts when time runs low in the taping | After 2 min of the final round, or when the host says | No studio clock |

---

## 7. Build order (one PR each, like #7–#11)

1. **Server dispatch by `kind`**: `modes` table, `jGame` fix. No behaviour change for the existing games.
2. **Board layout + puzzle pack + check script**: `server/wheelBoard.js`, `src/wheel/puzzles.json` (about 500 + 150), `scripts/check-wheel-puzzles.mjs`.
3. **A basic playable round**: cash wedges, Bankrupt, Lose a Turn, consonants, vowels, fill-in-the-blanks solving, turn order, clocks, `wheel:solution` to the controller. Plain Setup, Display, Player and Controller screens, and the Hub card. Playable from here.
4. **Show structure**: toss-ups, the final round's speed-up, consolation $1,000, tiebreaker, end screen.
5. **Bonus round**: categories, envelope wheel, RSTLNE, letter picks, the 10 s solve.
6. **Special wedges**: Wild Card, Gift, Million Dollar wedge, Mystery, Express, Prize Puzzle.
7. **Teams mode.**
8. **Sound and polish**: tile flip, wheel ticks, overlays, Relaxed pace, undo, README section, credits note.

Testing: the repo has no tests yet. `wheelBoard.js` and the turn rules are plain functions, so a few `node --test` files (layout cases, Bankrupt / Express / Mystery outcomes, the $1,000 minimum, the speed-up value) would be cheap and would catch rule mistakes that are hard to hit by hand. Also a play-through with 3 browser tabs as phones for each PR.

---

## 8. Decisions

1. **Name on the hub and screens: "Spin & Solve"**, matching how Survey Says! avoids the Family Feud name. The internal name stays `wheel`.
2. **Repeated letters are disabled** on the phone instead of losing the turn.
3. **The speed-up starts 2 minutes into the final round**, or earlier if the host starts it. A setup option can make the final round all speed-up.
4. **Solving is fill-in-the-blanks only**, plus spoken solves judged by the host in host mode.
5. **In team mode, the whole team plays the bonus round**, and any member can type the solve.
