# Game Night

Party games for a TV and everyone's phones. One screen everyone can see hosts the game; players join on their phones by scanning a QR code and play from there.

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
A Family Feud-style game for two teams of up to 12 players in all. Teams face off for control of each "we asked 100 people" question, then guess the top answers. After three strikes, the other team gets one guess to steal everything banked so far. Games are 3 to 6 rounds, and points are multiplied in the later rounds. The questions come from a hand-written pack in `src/surveys.json`. You can swap any question during setup.

### With or without a host
Both games can be played two ways:

- **With a host**: the host runs the game from the host controller (the "Open host controller" link opens it in a second window), judges responses and reveals answers.
- **Without a host** ("Play without a host" in setup): the game runs itself. In Jeopardy, players pick clues and type their own responses; in Survey Says!, players type guesses and the server checks them against the survey.

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

## Deployment

Every push to `main` builds the client and deploys it to GitHub Pages (`.github/workflows/deploy-pages.yml`). The deployed client connects to the game server at `VITE_SERVER_URL` from `.env.production`; without that variable, the client looks for the server on port 3001 of the host it was loaded from.

## Project layout

```
src/                  React client
  main.jsx            app entry: Jeopardy setup, host display, controller, player screens
  Hub.jsx             the Game Night home page
  survey/             Survey Says! screens and styles
  FastMoney.jsx       Fast Money finale
  BoardEditor.jsx     custom board editor
  MyBoards.jsx        saved boards, board file and JeopardyLabs import
  boards.js           custom board format, storage and import/export
  questions.js        loads the built-in archive and parses imported question files
  JoinQR.jsx          join QR codes and the phone join link
  shared.jsx          server address, socket connection and shared pieces
  surveys.json        Survey Says! questions
  topics.json         topic keywords for archive search
server/               game server (Express + Socket.IO)
  index.js            lobbies, Jeopardy game logic, /health, /lan and the JeopardyLabs import route
  survey.js           Survey Says! game logic and answer matching
  jeopardylabs.js     JeopardyLabs board import
  text.js             text helpers for matching answers
public/
  data/               built-in Jeopardy archive, one file per season (seasons.json is the index)
  audio/              sound effects
scripts/
  build-question-data.py  rebuilds public/data from a Jeopardy season archive ZIP
```

## Credits and licence

- The built-in Jeopardy clues are generated into `public/data/` from a Jeopardy season archive by `scripts/build-question-data.py`.
- The Survey Says! questions in `src/surveys.json` were written for this project, and their answers and points are invented.
- Game Night is a fan project and isn't affiliated with *Jeopardy!*, *Family Feud* or their owners.
- The repository has no licence file yet, so no licence is granted for the code.
