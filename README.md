# Game Night

Party games for a TV and everyone's phones: Jeopardy!, Survey Says! and Spin & Solve. One screen everyone can see hosts the game; players join on their phones by scanning a QR code and play from there.

## Games

### Jeopardy!
Up to 6 players buzz in from their phones.

- **Built-in archive**: every season of the show (seasons 1–42) is built in. Pick six categories for each of the Jeopardy and Double Jeopardy rounds, or fill the rest randomly.
- **Topic search**: search categories by name or by topic ("sports" also finds sports categories whose names don't say so), or filter with the topic chips.
- **Custom boards**: make your own boards (up to 2 rounds, up to 6 categories × 6 rows, with an optional Final Jeopardy clue and Fast Money clues). Boards are saved in the browser and can be exported to and imported from a `.json` file.
- **JeopardyLabs import**: paste a `jeopardylabs.com/play/...` link to turn a JeopardyLabs game into a custom board.
- **Your own question files**: the archive screen also loads clues from a JSON, CSV or season ZIP file.
- **Daily Doubles**, with wagers.
- **Final Jeopardy**: one last wagered clue after the final round, from the archive or from your board.
- **Fast Money finale**: the top two players race the clock through the same five quick clues: $1,000 per right answer, plus a $5,000 bonus each if they get 8 of 10 between them.

### Survey Says!
A Family Feud-style game for two teams of up to 12 players in all. Teams face off for control of each "we asked 100 people" question, then guess the top answers. After three strikes, the other team gets one guess to steal everything banked so far. Games are 3 to 6 rounds, and points are multiplied in the later rounds.

Setup offers three question packs, one at a time or all together (*Everything*). You can swap any question before starting.

- **Game Night**: 110 hand-written questions in `src/surveys.json`.
- **ProtoQA**: 7,619 boards with real survey counts from the [ProtoQA dataset](https://github.com/iesl/protoqa-data), in `public/data/surveys-protoqa.json`.
- **Feud Sheet**: 406 boards from a shared "Family Feud Question Database" spreadsheet, with the sheet's own answers and points, in `public/data/surveys-sheet.json`.

The ProtoQA and Feud Sheet packs are loaded when Survey Says! opens.

The TV screen plays a buzzer for wrong answers, a ding for each answer revealed, a short fanfare when a team banks a round and an upbeat tune on the winners screen. They're all synthesized in the browser, with a sound on/off button in the corner.

### Spin & Solve
A Wheel of Fortune-style word puzzle game for 2 to 6 players on their own, or 2 to 4 teams sharing up to 12 phones. Spin the wheel on your phone, call a consonant to earn the spin's value for every time it appears, buy vowels for $250, and solve the puzzle to bank the round.

- **Solving** is fill-in-the-blanks on the phone: type the missing letters and they're checked exactly. With a host, players can also say the answer out loud and the host judges it.
- **Game length**: Short (a toss-up, two rounds and the final round, about 20 minutes), Classic (the show's order: two toss-ups, rounds 1 and 2, a toss-up, round 3 and the final round, about 35 minutes) or Custom (3 to 5 rounds, toss-ups on or off).
- **The wheel** has the show's 24 wedges per round: the top value ($2,500, $3,500, $3,500, then $5,000), two Bankrupts and a Lose a Turn. Rounds 1 to 3 add the Wild Card, a Gift and the Million Dollar wedge; round 2 has two Mystery wedges (flip for $10,000 or Bankrupt) and round 3 the Express wedge and a Prize Puzzle worth a trip.
- **Toss-ups** turn one tile at a time; the first to buzz in gets one try.
- **The final round** ends in a speed-up: one last spin sets every consonant's value (plus $1,000), vowels are free, and each letter found gives a few seconds to solve. A tie for the lead is settled with a toss-up, and anyone who solved nothing gets $1,000 for playing.
- **The bonus round**: the winner picks a category, spins for a sealed envelope ($40,000 to $100,000, or $1,000,000 with the Million Dollar wedge), gets R S T L N E plus three consonants and a vowel, and has ten seconds to solve it.
- **Teams**: teammates take turns acting for the team, anyone on it can buzz in on a toss-up, and the whole team plays the bonus round.

Setup offers two puzzle packs, one at a time or both together (*Everything*):

- **Game Night**: 675 puzzles, 153 bonus puzzles and the gift and trip prizes in `src/wheel/puzzles.json`, all written for this project.
- **Fan Database**: 72,164 puzzles in 41 categories from [wheeloffortuneanswer.com](https://wheeloffortuneanswer.com/), a player-maintained list of answers from the official game, in `public/data/puzzles-fans.json`. It's loaded when Spin & Solve opens. The bonus round always uses Game Night's bonus puzzles.

The TV plays peg clicks as the wheel turns, a ding for each letter, the Bankrupt slide, a fanfare for each solve and a ticking bonus clock, all synthesized in the browser and sharing Survey Says!' sound on/off button.

### With or without a host
All three games can be played two ways:

- **With a host**: the host runs the game from the host controller (the "Open host controller" link opens it in a second window), judges responses and reveals answers. In Survey Says!, the controller's "Time!" button gives a stalling player a 3-second count, like the TV host does, and no answer by then is a strike. In Spin & Solve, the controller shows the answer (which never goes to the TV or the phones), judges spoken solves, pauses the clocks, starts the speed-up and can undo the last move.
- **Without a host** ("Play without a host" in setup): the game runs itself. In Jeopardy, players pick clues and type their own responses; in Survey Says!, players type guesses and the server checks them against the survey; in Spin & Solve, solves are checked exactly and the rounds move on by themselves. Survey Says! answers are on a show-paced clock: 8 seconds for a face-off answer, 10 per guess and 20 for the other team to confer on a steal, with a 3-2-1 count on the TV and a strike when time runs out. Spin & Solve gives 10 seconds to decide, 10 to call a letter and 20 to solve (twice that at Relaxed pace).

## How to play

1. Open the site on the screen everyone can see (a TV or laptop) and pick a game under **Host a game**.
2. Set it up and choose **Create lobby**. The lobby shows a QR code and a short game code.
3. Players scan the QR code with their phone camera, or open the site and type the code under **Joining a game?**, then enter their name.
4. Start the game from the host screen.

When you run it yourself, phones must be on the same network as the computer running it. If the host screen is open on `localhost`, the QR code automatically points phones at the computer's network address (it asks the server's `/lan` endpoint for it), because phones can't open `localhost`.

## Running it locally

You need Node.js. It isn't pinned in `package.json`; the deploy workflow builds with Node 22.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts two things together:

- the Vite dev server for the client on port 5173, listening on `0.0.0.0` so phones on your network can reach it;
- the game server (`server/index.js`, Express + Socket.IO) on port 3001.

Open `http://localhost:5173` on the host screen. `npm run client` and `npm run server` start either half on its own.

To make a production build in `dist/`:

```bash
npm run build
```

To run the Spin & Solve tests (the board layout and the game rules, with Node's built-in test runner):

```bash
npm test
```

To check the Spin & Solve puzzle pack after editing it (every puzzle fits the board, uses allowed characters, appears once and follows its category's rule):

```bash
npm run check:puzzles
```

## Deployment

Every push to `main` builds the client and deploys it to GitHub Pages (`.github/workflows/deploy-pages.yml`). The deployed client connects to the game server at `VITE_SERVER_URL` from `.env.production`; without that variable, the client looks for the server on port 3001 of the host it was loaded from.

## Project layout

```
src/                  React client
  main.jsx            app entry: Jeopardy setup, host display, controller, player screens
  Hub.jsx             the Game Night home page
  survey/             Survey Says! screens and styles
  wheel/              Spin & Solve screens, styles, sounds and its puzzle pack (puzzles.json)
  FastMoney.jsx       Fast Money finale
  BoardEditor.jsx     custom board editor
  MyBoards.jsx        saved boards, board file and JeopardyLabs import
  boards.js           custom board format, storage and import/export
  questions.js        loads the built-in archive and parses imported question files
  JoinQR.jsx          join QR codes and the phone join link
  shared.jsx          server address, socket connection and shared pieces
  surveys.json        Survey Says! hand-written questions
  topics.json         topic keywords for archive search
server/               game server (Express + Socket.IO)
  index.js            lobbies, Jeopardy game logic, /health, /lan and the JeopardyLabs import route
  survey.js           Survey Says! game logic and answer matching
  wheel.js            Spin & Solve game logic (wheel.test.js tests it)
  wheelBoard.js       Spin & Solve puzzle board layout (wheelBoard.test.js tests it)
  jeopardylabs.js     JeopardyLabs board import
  text.js             text helpers for matching answers
public/
  data/               built-in Jeopardy archive, one file per season (seasons.json is the index),
                      the Survey Says! packs (surveys-protoqa.json, surveys-sheet.json)
                      and the Spin & Solve Fan Database (puzzles-fans.json)
  audio/              sound effects
scripts/
  build-question-data.py    rebuilds the Jeopardy archive in public/data from a season archive ZIP
  build-protoqa-surveys.py  rebuilds public/data/surveys-protoqa.json from the ProtoQA data files
  build-sheet-surveys.py    rebuilds public/data/surveys-sheet.json from CSV exports of the sheet's tabs
  check-wheel-puzzles.mjs   checks the Spin & Solve puzzle packs (npm run check:puzzles)
  build-fan-puzzles.mjs     rebuilds public/data/puzzles-fans.json from answers collected from wheeloffortuneanswer.com
docs/
  wheel-of-fortune-plan.md  the Spin & Solve design: rules, server state, socket events and screens
```

## Credits and licence

- The built-in Jeopardy clues are generated into `public/data/` from a Jeopardy season archive by `scripts/build-question-data.py`.
- The Survey Says! questions in `src/surveys.json` were written for this project, and their answers and points are invented.
- The Survey Says! sounds and winners tune are synthesized in `src/survey/sounds.js` and are original; no audio from the show is used.
- The Spin & Solve Game Night puzzles, bonus puzzles and prizes in `src/wheel/puzzles.json` were written for this project, and its sounds are synthesized in `src/wheel/sounds.js`; nothing is taken from the show.
- The Spin & Solve Fan Database pack comes from wheeloffortuneanswer.com, a player-maintained list of answers from the official Wheel of Fortune game. Its author and licence aren't known; see [CREDITS.md](CREDITS.md).
- The ProtoQA pack is built from [ProtoQA](https://github.com/iesl/protoqa-data) (Boratko et al., 2020), used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). See [CREDITS.md](CREDITS.md) for the full attribution and what was changed.
- The Feud Sheet pack comes from a publicly shared "Family Feud Question Database" Google Sheet. Its author and licence aren't known; see [CREDITS.md](CREDITS.md).
- Game Night is a fan project and isn't affiliated with *Jeopardy!*, *Family Feud*, *Wheel of Fortune* or their owners.
- The repository has no licence file yet, so no licence is granted for the code.
