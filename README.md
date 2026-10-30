# Game Night

Party games for a TV and everyone's phones: Jeoparty!, Survey Says!, Spin & Solve, Fib or Fact, Price Check, Tip of the Tongue, Word Budget and Red Herring. One screen everyone can see hosts the game; players join on their phones by scanning a QR code and play from there.

## Games

### Jeoparty!
Trivia on clues from the show's archive.
Up to 6 players buzz in from their phones.

- **Built-in archive**: every season of the show (seasons 1–42) is built in. Pick six categories for each of the Jeoparty and Double Jeoparty rounds, or fill the rest randomly.
- **Topic search**: search categories by name or by topic ("sports" also finds sports categories whose names don't say so), or filter with the topic chips.
- **Custom boards**: make your own boards (up to 2 rounds, up to 6 categories × 6 rows, with an optional Final Jeoparty clue and Fast Money clues). Boards are saved in the browser and can be exported to and imported from a `.json` file.
- **JeopardyLabs import**: paste a `jeopardylabs.com/play/...` link to turn a JeopardyLabs game into a custom board.
- **Your own question files**: the archive screen also loads clues from a JSON, CSV or season ZIP file.
- **Daily Doubles**, with wagers.
- **Final Jeoparty**: one last wagered clue after the final round, from the archive or from your board.
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

### Fib or Fact
A bluffing trivia game for 2 to 8 players (best with 4 or more), played on clues from the built-in Jeopardy archive. Each clue, one player picks one of three categories. Everyone reads the clue and writes a fake answer (a "fib") on their phone. Then the fibs and the real answer are shuffled together and everyone votes for the one they think is the fact.

- **Scoring**: 1,000 for finding the fact, and 500 for every player your fib fools. Points double halfway through the game and triple on the final clue.
- **Fibs**: typing the real answer, or a copy of someone else's fib, is turned away and you write another. If there aren't enough fibs to choose from, "house fibs" (other answers from the same Jeopardy category) fill the vote up to four choices.
- **The reveal**: the fibs that fooled somebody are shown one at a time, least popular first, with who fell for each and who wrote it, and then the fact.
- **Game length**: 5, 7 or 9 clues. Setup loads three random seasons of the archive and deals three categories for each clue; you can swap any clue's categories before starting. The final clue comes from the hardest rows.

The TV plays a pop for each fib and vote, a sliding "wah-wah" for each fib that fooled someone, a bell and fanfare for the fact and a ticking count at the end of each clock, sharing the other games' sound on/off button.

### Price Check
A price-guessing game for 2 to 8 players on real prices: what shoppers paid for groceries and household goods at US stores. Everyone plays every round on their phone at once.

- **Closest Bid**: everyone bids secretly on one product; closest without going over wins 500 (an exact bid earns 500 more). If everybody goes over, everyone bids again, under the lowest bid.
- **Higher or Lower**: five products, each shown with a wrong price; call whether the real one is higher or lower (100 each, 200 more for all five).
- **Pick the Priciest**: three sets of three products; pick the most expensive in each (200 each).
- **Price Order**: put four products in order, cheapest first (100 per product in its place, 200 more for a perfect order).
- **Grocery Run**: fill a cart as close to the budget as you can without going over (400 to the closest).
- **The Showcase**: the top two players each bid on a bundle of big-ticket prizes; closest without going over wins 1,500, and within $250 of your own showcase wins both (1,500 more). Everyone else predicts the winner (300 if they're right).
- **Game length**: Short (four rounds and the showcase, about 20 minutes) or Classic (eight rounds, about 35 minutes). Setup deals the products; "New products" deals again.

Prices come from two packs:

- **Open Prices**: real receipt prices from US stores, built from [Open Prices](https://prices.openfoodfacts.org) by `scripts/build-openprices-pack.py` into `public/data/prices-openprices.json` (fetched when Price Check opens). Product photos load from Open Food Facts.
- **Showcase**: big-ticket items in `src/price/showcase.json`, written for this project with estimated typical US prices.

### Tip of the Tongue
A team word game for teams of two (up to 12 players). Players pair up as they join; the host can move them between teams in the lobby, and an odd player makes one team of three.

- **A turn**: when the clue-giver taps Start (or after 15 seconds), they have 45 seconds to clue their partner through seven words drawn at random. The word shows only on the clue-giver's phone (and the host controller), never on the TV.
- **Categories**: the host picks which of the 32 word categories go into the pool at setup (all of them by default). Players never see a category, so the words give nothing away.
- **Scoring**: a point per word. Clearing all seven banks a bonus point for every second left on the clock. Passes are unlimited (a passed word comes round again); saying the word is a foul and throws it out.
- **Rounds**: 3, 4 or 5. Every team takes a turn each round; partners swap who gives the clues, and in the last round each team decides. No word comes up twice until the pool runs out.
- **Guessing**: set up to be typed (the guesser types on their phone and the game checks it) or said out loud (the clue-giver, or the host, taps Got it).
- **Words**: 32 categories in `src/tongue/words.json`, written for this project.

### Word Budget
A bid-and-clue word game for two teams of two or more (4 to 16 players). New players join the smaller team; players can switch teams from their phones in the lobby, and the host can move them by tapping their names on the TV.

- **A card** is five random words from the chosen categories (the same 32 as Tip of the Tongue). It only ever shows on the two clue-givers' phones and the host controller, never on the TV, because the guessers can see the TV.
- **Bidding**: both clue-givers get 5 seconds to look at the card, then bid on their phones: "we can get all five in N words". Tap −1, −3 or −5, or type a number. Each bid must be lower than the last (25 down to 1), and every bid restarts a 5-second shot clock shown big on the TV. When it runs out, the lowest bid plays; if nobody bids, the team whose turn it is to start plays at 25. The starting team alternates card to card. Both clue-givers can tap Pass to swap the card for a new one.
- **Playing the card**: the winning clue-giver has 60 seconds to get their team to say all five words, in any order, using no more than the bid in spoken clue words (repeats count). The other team's clue-giver is the judge: they tap a big +1 for every word said (with Undo), and the TV counts down the words left. The clue-giver taps each word as their team says it, and the TV fills in its slot; the judge can tap Not it to dispute one.
- **No-nos**: rhymes, "sounds like", gestures, or any part of an answer word ("fights fires" for "fireman"). The judge taps No-no! and confirms, and the card goes to the judge's team.
- **The steal**: if the clue-giver's team goes over budget or runs out of time, the other team gets 10 seconds to say every word still left, using only the clues already given. If they get them all, they steal the card. If they miss any, **nobody gets the card** (in the classic game the other team wins it on any fail; here they have to earn it). Without a host, the clue-giver who just lost the card confirms the stealing team's words, and the TV shows the whole card afterwards so the room can see.
- **Words saved**: finishing a card under budget banks the unused words (bid 19, used 14: 5 saved). They break a tie and show on the scoreboard.
- **Winning**: first to 5, 7 or 10 cards (10 by default), with saved words as the tiebreak. Or set up "Points": a card is worth 10 and every saved word 1, first to 10 × the target. Clue-givers move along their team every card, so everyone gets a go.

### Red Herring
A detective social deduction game for 5 to 12 players, about 25 to 40 minutes. The owner of Herringbone Hall is found dead, the guests investigate, and one of them is the killer.

- **Alibi cards**: every guest gets a secret card on their phone with three facts: where they were (a room), what they were holding and a mark on them. The killer's card is the crime. Fewer facts are in play in a small party, so every fact is on two cards or more and no innocent guest has all three of the crime's facts.
- **The guest ledger**: the TV only counts ("3 guests were in the Library"). Each guest files a statement of their alibi during the investigation, and the board adds the statements up beside the counts. The killer has to lie, so a fact ends up claimed by too many (≠) or, once everyone has filed, too few (?). Changing a statement is allowed, and the board shows "Changed ×1". A guest who dies or is jailed has their real card pinned up beside their statement (marked LIED if they differ).
- **A day**: Night (30 seconds, the same for everyone: every phone taps a hunch, and anyone with a night role uses it) → Morning (any body is found; a clue about the killer is pinned up if the lab finished the day before; the most-suspected names from the hunches) → Investigation (2, 3 or 4 minutes: statements, lab work, accusations) → Trial (the most-accused guest, with two accusations or more, gets 30 seconds to defend themselves; then everyone votes, and more than half of the living voting Jail jails them).
- **The lab**: phone mini-tasks (match a fingerprint to one of four, or repeat the order the sample tubes lit up). Each one done right fills a vial on the lab bar; a full bar pins up one of the crime's facts the next morning (once all three are up, the lab clears an innocent guest instead). The killer and the accomplice can each contaminate the lab once a day, which spoils 3 samples.
- **Roles**: the Killer (kills from night 2; once a game, plants evidence on a guest so the next fact clue points at them), Forensics (learns a true fact from a guest's card each night) and the Witness (knows one of the crime's facts) are in every case. With more guests: the Officer (6+, guards a guest each night; a foiled attack pins up a free clue), the Coroner (7+, learns the role of everyone dead or jailed), the Tabloid Reporter (7+, wins if jailed, and the game goes on), the Accomplice (8+, knows the killer), the Informant (9+, is told each morning that one of two guests is innocent) and the Rookie (10+, off by default, is told they're Forensics but their findings are unreliable). The host can leave any of these out.
- **Ghosts**: dead and jailed guests keep doing lab work and keep one ghost vote.
- **Winning**: the detectives win by jailing the killer, unless the killer's Last Words name the Witness. The killer's side wins once it's as big as everyone else still free, or when day 5 ends without the killer jailed. A jailed guest's role stays hidden (only the Coroner learns it); the verdict only says whether they were the killer.
- **Privacy**: roles, cards and notes go only to each guest's own phone (and, in a hosted game, the storyteller's controller), never to the TV. Each phone has a Board tab that mirrors the TV, for playing over a video call. The role card lies face down until tapped.
- **The storyteller**: with a host, one person who isn't a guest runs the case from the controller: a grimoire of every role, card and night action, the narration to read aloud, the pacing of mornings and verdicts, and what the Rookie learns. Without one, the TV narrates and everything runs on the clock.

### With or without a host
All eight games can be played two ways:

- **With a host**: the host runs the game from the host controller (the "Open host controller" link opens it in a second window), judges responses and reveals answers. In Survey Says!, the controller's "Time!" button gives a stalling player a 3-second count, like the TV host does, and no answer by then is a strike. In Spin & Solve, the controller shows the answer (which never goes to the TV or the phones), judges spoken solves, pauses the clocks, starts the speed-up and can undo the last move. In Fib or Fact, the controller shows the real answer and every fib as it comes in, can throw out a fib (its writer writes another, or it leaves the vote), and moves the reveals along; picking, writing and voting are still timed. In Price Check, the controller shows every real price (which never goes to the TV or the phones) and moves the reveals along. In Tip of the Tongue, the controller shows the current word and can call Got it, Pass or Foul, which helps when guesses are shouted out loud. In Word Budget, the controller sees every card and can do the judge's and the clue-giver's jobs (count, undo, mark or unmark a word, call a no-no), bid for a team, draw a new card, confirm steal words, give a finished card to either team or to nobody, and move on to the next card; the judge and clue-giver can still use their phones. In Red Herring, the host is the storyteller: the controller is the grimoire (every role, card and night action), shows the narration to read aloud, waits for the storyteller at each morning and verdict, can put a guest on trial, and chooses what the Rookie learns.
- **Without a host** ("Play without a host" in setup): the game runs itself. In Jeoparty, players pick clues and type their own responses; in Survey Says!, players type guesses and the server checks them against the survey; in Spin & Solve, solves are checked exactly and the rounds move on by themselves; in Fib or Fact, Price Check and Tip of the Tongue, the reveals and turns move on by themselves; in Word Budget, the judge and clue-giver run each card from their phones and the next card starts by itself. Survey Says! answers are on a show-paced clock: 8 seconds for a face-off answer, 10 per guess and 20 for the other team to confer on a steal, with a 3-2-1 count on the TV and a strike when time runs out. Spin & Solve gives 10 seconds to decide, 10 to call a letter and 20 to solve (twice that at Relaxed pace). Fib or Fact gives 15 seconds to pick a category, 50 to write a fib and 25 to vote, with or without a host. In Red Herring, the TV narrates and the mornings and verdicts move on by themselves.

## How to play

1. Open the site on the screen everyone can see (a TV or laptop) and pick a game under **Host a game**.
2. Set it up and choose **Create lobby**. The lobby shows a QR code and a short game code.
3. Players scan the QR code with their phone camera, or open the site and type the code under **Joining a game?**, then enter their name.
4. Start the game from the host screen.

To change something (or after starting by mistake), press **Back to settings** at the bottom of the TV or the top of the host controller. That closes the room: every phone goes back to the join screen with a note saying so, and the setup comes back with your choices as you left them. Creating the lobby again gives a new code and QR code; the old code can't be rejoined.

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
- the game server (`server/index.js`, Express + Socket.IO) on port 3001, or on `PORT` if that's set.

Open `http://localhost:5173` on the host screen. `npm run client` and `npm run server` start either half on its own.

To make a production build in `dist/`:

```bash
npm run build
```

To run the tests (the Spin & Solve board layout and game rules, and the Fib or Fact, Price Check and Tip of the Tongue rules, with Node's built-in test runner):

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
  main.jsx            app entry: Jeoparty setup, host display, controller, player screens
  Hub.jsx             the Game Night home page
  survey/             Survey Says! screens and styles
  wheel/              Spin & Solve screens, styles, sounds and its puzzle pack (puzzles.json)
  fib/                Fib or Fact screens, styles and sounds
  price/              Price Check screens, styles and its showcase pack (showcase.json)
  tongue/             Tip of the Tongue screens, styles and its word pack (words.json)
  budget/             Word Budget screens and styles (its cards come from tongue/words.json)
  herring/            Red Herring screens, styles, sounds, lab tasks and pictograms (icons.jsx)
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
  index.js            lobbies, Jeoparty game logic, /health, /lan and the JeopardyLabs import route
  survey.js           Survey Says! game logic and answer matching
  wheel.js            Spin & Solve game logic (wheel.test.js tests it)
  wheelBoard.js       Spin & Solve puzzle board layout (wheelBoard.test.js tests it)
  fib.js              Fib or Fact game logic (fib.test.js tests it)
  price.js            Price Check game logic (price.test.js tests it)
  tongue.js           Tip of the Tongue game logic (tongue.test.js tests it)
  budget.js           Word Budget game logic (budget.test.js tests it)
  herring.js          Red Herring game logic (herring.test.js tests it)
  herringCase.js      Red Herring's facts, roles and the deal, shared with the screens
  taps.js             ignores a host's (or phone's) double tap on a ruling (taps.test.js tests it)
  jeopardylabs.js     JeopardyLabs board import
  text.js             text helpers for matching answers, including Jeopardy responses
public/
  data/               built-in Jeopardy archive, one file per season (seasons.json is the index),
                      the Survey Says! packs (surveys-protoqa.json, surveys-sheet.json)
                      the Spin & Solve Fan Database (puzzles-fans.json)
                      and the Price Check prices (prices-openprices.json)
  audio/              sound effects
scripts/
  build-question-data.py    rebuilds the Jeopardy archive in public/data from a season archive ZIP
  build-protoqa-surveys.py  rebuilds public/data/surveys-protoqa.json from the ProtoQA data files
  build-sheet-surveys.py    rebuilds public/data/surveys-sheet.json from CSV exports of the sheet's tabs
  check-wheel-puzzles.mjs   checks the Spin & Solve puzzle packs (npm run check:puzzles)
  build-fan-puzzles.mjs     rebuilds public/data/puzzles-fans.json from answers collected from wheeloffortuneanswer.com
  build-openprices-pack.py  rebuilds public/data/prices-openprices.json from the Open Prices API
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
- Fib or Fact uses the same built-in Jeopardy clues. Its sounds are synthesized in `src/fib/sounds.js` and are original.
- Price Check's prices come from [Open Prices](https://prices.openfoodfacts.org), an Open Food Facts project, under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/); the pack built from it is released under the same licence. Product photos are from Open Food Facts under CC BY-SA. The showcase prices in `src/price/showcase.json` are our own estimates. See [CREDITS.md](CREDITS.md).
- The Tip of the Tongue word pack in `src/tongue/words.json` was written for this project.
- Game Night is a fan project and isn't affiliated with *Jeopardy!*, *Family Feud*, *Wheel of Fortune*, *The Price Is Right* or their owners.
- The repository has no licence file yet, so no licence is granted for the code.
