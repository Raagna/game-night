// Tip of the Tongue screens: host setup, the shared TV display, players' phones, the host controller and the end.
import React, { useEffect, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner, Departures } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, useEventSounds, playWinnersTune, playBuzz, playDing, playRoundWon } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { playClue, playPop } from "../fib/sounds";
import { SwapIcon } from "../survey/SurveySays";
import WORDS from "./words.json";
import "./tongue.css";
import { Money } from "../Flap";
import { Coach } from "../Tutorial";

// ---------- Dealing the words ----------
const WORDS_PER_TURN = 7;
const ROUNDS_KEY = "gameNight.tongue.rounds.v1", GUESSING_KEY = "gameNight.tongue.guessing.v1", CATEGORIES_KEY = "gameNight.tongue.categories.v1";
const ALL_CATEGORIES = WORDS.categories.map(([name]) => name);
const read = (key, allowed, fallback) => { try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
// The host's categories (all of them unless they've switched some off). Players never see a category: turns
// draw words at random from one shuffled pool of every chosen category's words.
const readCategories = () => {
  try { const saved = JSON.parse(localStorage.getItem(CATEGORIES_KEY)); return Array.isArray(saved) && saved.some((n) => ALL_CATEGORIES.includes(n)) ? saved.filter((n) => ALL_CATEGORIES.includes(n)) : ALL_CATEGORIES; } catch { return ALL_CATEGORIES; }
};
const wordsIn = (chosen) => WORDS.categories.filter(([name]) => chosen.includes(name)).flatMap(([, words]) => words);
function dealWords(chosen) {
  const seen = new Set();
  return shuffle(wordsIn(chosen)).filter((word) => !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()));
}
const GUESSING = {
  typed: { label: "Type it", note: "The guesser types each guess on their phone and the game checks it. The clue-giver can pass, or own up to a foul." },
  aloud: { label: "Say it out loud", note: "The guesser shouts; the clue-giver taps Got it (or the host does, from the controller). Faster and louder." },
};

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((p) => p.id === id)?.name || "A player";
const teamById = (game, id) => game.teams.find((t) => t.id === id);
const teamOfPlayer = (game, id) => game.teams.find((t) => t.members.includes(id));
const names = (game, ids) => { const list = ids.map((id) => nameOf(game, id)); return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] || ""; };
const guessersOf = (game) => { const turn = game.turn, team = turn && teamById(game, turn.teamId); return team ? team.members.filter((id) => id !== turn.clueGiverId) : []; };
const ranked = (game) => [...game.teams].sort((a, b) => b.score - a.score);
const isLast = (game) => game.roundIndex === game.rounds - 1;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const STATUS = { got: "Got it", passed: "Passed", foul: "Foul", missed: "Missed", waiting: "" };
const Check = () => <svg className="tt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const XIcon = () => <svg className="tt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
const teamNumber = (game, team) => game.teams.indexOf(team) + 1;
// The turn's size and clock come with the turn (the practice turn is shorter); these are the real game's.
const turnSize = (turn) => turn?.total || turn?.size || WORDS_PER_TURN;
const turnSeconds = (turn) => turn?.seconds || 45;

// ---------- Practice round ----------
// The coach (see docs/tutorial.md): what to do at each step of the practice turn, on the TV, the host controller and
// the phones. The steps come from the server (practiceStep in server/tongue.js): ready, clue, then got / pass / foul
// after each word played, and done.
const giverOf = (game) => game.turn?.clueGiverId;
const isGuesserOf = (game, me) => guessersOf(game).includes(me);
const typed = (game) => game.guessing === "typed";
const watching = (game) => `${teamById(game, game.turn?.teamId)?.name || "One team"} plays the practice turn. Watch how it works: your team gets its own turns once the game starts.`;
const TONGUE_COACH = {
  ready: {
    tv: ({ game, name }) => `A practice turn: ${name(giverOf(game))} gives the clues to ${names(game, guessersOf(game))}. ${name(giverOf(game))} sees a word on their phone and describes it without saying it. The clock starts when they tap Start.`,
    controller: ({ game, name }) => `${name(giverOf(game))} taps Start on their phone when ready (or tap Start their clock here). You’ll see each word here too.`,
    phone: ({ game, me, name }) => giverOf(game) === me ? `You give the clues. Each word shows up on your phone: describe it without saying it, or any part of it. Tap Start when you’re ready.`
      : isGuesserOf(game, me) ? `${name(giverOf(game))} clues a word and you guess it. ${typed(game) ? "Type your guesses on your phone." : "Shout your guesses out loud."}` : watching(game),
  },
  clue: {
    tv: ({ game }) => `The clock’s running: ${turnSeconds(game.turn)} seconds for ${turnSize(game.turn)} easy words. ${typed(game) ? "The guesser types guesses, and a right one" : "The guesser shouts guesses, and the clue-giver taps Got it for a right one. It"} scores a point and brings the next word.`,
    controller: "You see the word too. Tap Got it when they say it (handy when guesses are shouted), Pass to skip it, or Foul if the clue-giver says it.",
    phone: ({ game, me, name }) => giverOf(game) === me ? (typed(game) ? "Clue the word! Your partner types guesses and the game checks them. Stuck? Tap Pass." : "Clue the word! When your partner says it, tap Got it. Stuck? Tap Pass.")
      : isGuesserOf(game, me) ? (typed(game) ? "Type your guess. Wrong guesses cost nothing, so keep trying!" : "Shout your guesses! A small slip is fine; keep going.") : "No shouting answers: only the partner guesses.",
  },
  got: {
    tv: "Got it! A point, and the next word comes up. Stuck on one? Pass sends it to the back of the line.",
    phone: ({ game, me }) => giverOf(game) === me ? "A point! Next word. If one’s too hard, tap Pass: it comes back later." : isGuesserOf(game, me) ? "A point! Keep going." : "A point for them. No shouting answers!",
  },
  pass: {
    tv: "Passed: the word goes to the back of the line and comes round again. Passes are free, but the clock keeps running.",
    phone: ({ game, me }) => giverOf(game) === me ? "Passed: it comes round again. If you slip and say a word, own up with Oops, I said it." : isGuesserOf(game, me) ? "Passed. A new word to guess!" : "They passed. That word comes round again later.",
  },
  foul: {
    tv: "A foul! The clue-giver said the word (or part of it), so it’s thrown out with no point. Owning up is on your honour.",
    controller: "A foul: the word is out with no point. Tap Foul whenever a clue-giver says the word.",
    phone: ({ game, me }) => giverOf(game) === me ? "Foul: that word’s out with no point. Keep going with the next one!" : "A foul: the clue-giver said the word, so it’s out with no point.",
  },
  done: {
    tv: ({ game }) => `That’s the practice! Each word got is a point, and clearing all seven in a real turn banks a point for every second left. Real turns are 45 seconds, every team plays one a round, and partners swap. Everyone starts at 0. ${game.hostless ? "Round one starts in a moment." : "The host starts round one."}`,
    controller: "That’s the practice. Tap Start the game when everyone’s ready.",
    phone: ({ game }) => `That’s the practice! Real turns are seven words in 45 seconds, and partners swap each round. Everyone starts at 0. ${game.hostless ? "Round one starts in a moment." : "The host starts round one."}`,
    skip: "Start the game",
  },
};

// The word for whoever is allowed to see it (the clue-giver, or a host controller), fetched each time it changes.
function useWord(game, playerId, allowed) {
  const [word, setWord] = useState(null), seq = game.turn?.seq;
  useEffect(() => {
    if (!allowed) { setWord(null); return; }
    let live = true;
    socket.emit("tongue:peek", { code: game.code, playerId }, (result) => { if (live) setWord(result?.ok ? result.word : null); });
    return () => { live = false; };
  }, [allowed, seq]);
  return word;
}

// ---------- Studio pieces ----------
// The show's name on a marquee: TIP OF THE over a big TONGUE in a box ringed with bulbs.
function TongueLogo() {
  return (
    <div className="tt-logo" role="img" aria-label="Tip of the Tongue">
      <span className="tt-logo-top" aria-hidden="true">Tip of the</span>
      <span className="tt-logo-main" aria-hidden="true">Tongue</span>
    </div>
  );
}
// Seven-segment digits, like the studio's clock and score windows. Unlit segments stay faintly visible.
const SEGMENTS = {
  a: "10,8 15,3 45,3 50,8 45,13 15,13", b: "52,10 57,15 57,43 52,48 47,43 47,15", c: "52,52 57,57 57,85 52,90 47,85 47,57",
  d: "10,92 15,87 45,87 50,92 45,97 15,97", e: "8,52 13,57 13,85 8,90 3,85 3,57", f: "8,10 13,15 13,43 8,48 3,43 3,15", g: "10,50 15,45 45,45 50,50 45,55 15,55",
};
const LIT = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function Segments({ value, digits = 1, label, className = "" }) {
  const text = String(value ?? "").padStart(digits, " ");
  return (
    <span className={"tt-seg" + (className ? ` ${className}` : "")} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      {[...text].map((ch, i) => (
        <svg key={i} viewBox="0 0 70 100" aria-hidden="true">
          <g transform="translate(10 0) skewX(-6)">
            {Object.entries(SEGMENTS).map(([seg, points]) => <polygon key={seg} points={points} className={LIT[ch]?.includes(seg) ? "on" : undefined} />)}
          </g>
        </svg>
      ))}
    </span>
  );
}
// Seconds left on a server deadline, ticking down locally.
function useSecondsLeft(deadline, serverNow) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    if (!deadline) { setLeft(null); return; }
    const startedAt = Date.now(), startRemaining = Math.max(0, deadline - serverNow);
    const update = () => setLeft(Math.ceil(Math.max(0, startRemaining - (Date.now() - startedAt)) / 1000));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline, serverNow]);
  return left;
}
// The studio clock: two amber seven-segment digits. Before the turn starts it waits on its length (45, or the
// practice turn's) with dim segments; in
// the last five seconds it turns red.
function StudioClock({ deadline, serverNow, className = "", idle = 45 }) {
  const left = useSecondsLeft(deadline, serverNow), seconds = deadline ? left ?? 0 : idle;
  return (
    <div className={"tt-clock" + (!deadline ? " is-idle" : seconds <= 5 ? " is-low" : "") + (className ? ` ${className}` : "")} role="timer" aria-label={deadline ? `${seconds} seconds left` : `${idle} seconds, not started`}>
      <Segments value={seconds} digits={2} />
    </div>
  );
}
// The monitor wall: a screen for each of the turn's words, numbered underneath. During a turn a screen stays dark
// until its word is got (public as it lands: no lengths, nothing to give away); at the end every screen shows its
// word and how it went: got (amber, with a check), passed or missed (dim), foul (red, with an X).
function MonitorWall({ words, label }) {
  return (
    <ol className="tt-monitors" aria-label={label}>
      {words.map((word, i) => (
        <li key={i} className={`tt-monitor is-${word.status}`} style={{ "--n": Math.max(5, ...String(word.text || "").split(" ").map((w) => w.length)) }}>
          <span className="tt-screen">
            {word.text ? <span className="tt-screen-word" key={word.text}>{word.text}</span> : <span className="tt-screen-idle">?</span>}
            {word.status === "got" ? <span className="tt-screen-mark"><Check /></span> : word.status === "foul" ? <span className="tt-screen-mark"><XIcon /></span> : null}
          </span>
          <span className="tt-monitor-foot"><span className="tt-monitor-num">{i + 1}</span>{STATUS[word.status] ? <em>{STATUS[word.status]}</em> : <em className="sr-only">Not yet</em>}</span>
        </li>
      ))}
    </ol>
  );
}
// The same words as a compact list for phones and the host controller.
function WordList({ words }) {
  return (
    <ul className="tt-wordlist">
      {words.map((word, i) => (
        <li key={i} className={`is-${word.status}`}>
          <span className="tt-wl-mark">{word.status === "got" ? <Check /> : word.status === "foul" ? <XIcon /> : null}</span>
          <span className="tt-wl-word">{word.text}</span>
          {STATUS[word.status] && <em>{STATUS[word.status]}</em>}
        </li>
      ))}
    </ul>
  );
}
const pairNames = (game, team) => team.members.map((id) => nameOf(game, id)).join(" & ");

// The TV's sounds, and a red X cell across the board for a moment when the clue-giver fouls.
function useTvSounds(game) {
  const [foul, setFoul] = useState(null);
  useEventSounds(game, (e) => {
    if (e.type === "turn") playClue();
    else if (e.type === "got") playDing(10);
    else if (e.type === "pass") playPop();
    else if (e.type === "foul") { playBuzz(); setFoul(e.at); }
    else if (e.type === "turnEnd") playRoundWon();
  });
  useEffect(() => {
    if (!foul) return;
    const timer = setTimeout(() => setFoul(null), 1300);
    return () => clearTimeout(timer);
  }, [foul]);
  return foul;
}

// ---------- Setup ----------
export function TongueSetup({ onCreate }) {
  const [rounds, setRounds] = useState(() => Number(read(ROUNDS_KEY, ["3", "4", "5"], "3"))),
    [guessing, setGuessing] = useState(() => read(GUESSING_KEY, ["typed", "aloud"], "typed")),
    [chosen, setChosen] = useState(readCategories),
    [hostless, setHostless] = useState(false),
    [practice, setPractice] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const choose = (list) => { setChosen(list); remember(CATEGORIES_KEY, JSON.stringify(list)); };
  const toggle = (name) => choose(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]);
  const wordCount = new Set(wordsIn(chosen).map((w) => w.toLowerCase())).size, enough = wordCount >= WORDS_PER_TURN;
  const start = () => {
    setNotice(""); setBusy(true);
    onCreate({ game: "tongue", words: dealWords(chosen), rounds, guessing, hostless, tutorial: practice }, (e) => { setBusy(false); setNotice(e); });
  };
  return (
    <main className="setup tt-setup">
      <BackToHub />
      <TongueLogo />
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Tip of the Tongue</h1>
            <p className="muted">Teams of two. One partner sees a word and clues it; the other guesses as many as they can in 45 seconds. Players pair up as they join, and you can swap them in the lobby.</p>
          </div>
        </div>
        <fieldset className="sv-fieldset tt-fieldset">
          <legend>Rounds</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Rounds">
            {[3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rounds === n} onClick={() => { setRounds(n); remember(ROUNDS_KEY, String(n)); }}>{n} rounds</button>)}
          </div>
          <p className="muted sv-hint">Each round, every team takes one turn. Partners swap who gives the clues each round; in the last round, each team decides.</p>
        </fieldset>
        <fieldset className="sv-fieldset tt-fieldset">
          <legend>Guessing</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Guessing">
            {Object.entries(GUESSING).map(([id, { label }]) => <button key={id} role="radio" aria-checked={guessing === id} onClick={() => { setGuessing(id); remember(GUESSING_KEY, id); }}>{label}</button>)}
          </div>
          <p className="muted sv-hint">{GUESSING[guessing].note}</p>
        </fieldset>
        <fieldset className="sv-fieldset tt-fieldset tt-cats-field">
          <legend>Word categories</legend>
          <p className="muted sv-hint">Words come up at random from every category you leave on. Players never see the category.</p>
          <div className="tt-cats-tools">
            <button className="chip-btn" onClick={() => choose(ALL_CATEGORIES)} disabled={chosen.length === ALL_CATEGORIES.length}>All</button>
            <button className="chip-btn" onClick={() => choose([])} disabled={!chosen.length}>None</button>
            <span className="muted">{chosen.length} of {ALL_CATEGORIES.length} on · {wordCount} words</span>
          </div>
          <div className="tt-cats" role="group" aria-label="Word categories">
            {ALL_CATEGORIES.map((name) => <button key={name} role="checkbox" aria-checked={chosen.includes(name)} onClick={() => toggle(name)}>{name}</button>)}
          </div>
          {!enough && <p className="notice" role="alert">Turn on categories with at least {WORDS_PER_TURN} words between them.</p>}
        </fieldset>
        <p className="muted sv-hint">Seven random words a turn. A point for every word, and clearing all seven banks a point for every second left. Passes are unlimited; a passed word comes round again. Words written for Game Night.</p>
        <section className="game-options" aria-labelledby="tt-options-title">
          <h2 id="tt-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The turns move on by themselves. With a host, the controller shows each word and can call Got it, Pass or Foul — handy when guesses are shouted out loud.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            <span><b>Practice round first</b><small>One short practice turn before round one: a team clues three easy words on a 25-second clock, with tips on the TV and every phone for Got it, Pass and fouls. Nothing scores. {hostless ? "Players can vote to skip it." : "The host can skip it."}</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{rounds} rounds · teams of two · up to 12 players</p>
          <button className="primary" disabled={busy || !enough} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- Shared pieces ----------
const SpeakerIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);
function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return <button className="sv-sound" aria-pressed={!muted} onClick={toggle}><SpeakerIcon off={muted} />{muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}</button>;
}
// The teams down the side, as partner pairs: number and name, the pair, and the score in a seven-segment window.
// The team that's playing gets the amber edge and an ON AIR light.
function Scoreboard({ game }) {
  return (
    <section className="tt-scores" aria-label="Scores">
      <h2 className="label">Teams</h2>
      <ol>
        {ranked(game).map((team) => {
          const playing = game.turn?.teamId === team.id;
          return (
            <li key={team.id} className={playing ? "is-turn" : ""}>
              <span className="tt-team-head"><span className="tt-team-num" aria-hidden="true">{teamNumber(game, team)}</span><b>{team.name}</b></span>
              <Segments className="tt-team-score" value={team.score} digits={2} label={`${team.score} points`} />
              <small>{pairNames(game, team)}</small>
              {playing && <em className="tt-playing tt-onair">On air</em>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
const resultWords = (turn) => turn.results.map(({ text, status }) => ({ text, status }));
const clearedWords = (turn) => Array.from({ length: turnSize(turn) }, (_, i) => (turn.got?.[i] ? { text: turn.got[i], status: "got" } : { text: "", status: "waiting" }));
// Got, of, and (for the clue-giver) how many are left in the pile, in seven-segment digits.
function Tally({ turn, showLeft = false }) {
  return (
    <p className="tt-tally" aria-label={`Got ${turn.points} of ${turn.total}${showLeft ? `, ${turn.left} left` : ""}`}>
      <span className="label">Got</span><Segments value={turn.points} />
      <span className="label">of</span><Segments value={turn.total} />
      {showLeft && <><span className="label">Left</span><Segments value={turn.left} /></>}
    </p>
  );
}
const turnLabel = (game) => (game.tutorial ? "Practice turn" : `Round ${game.roundIndex + 1} of ${game.rounds}`);

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const ready = game.teams.some((team) => team.members.filter((id) => game.players.find((p) => p.id === id)?.connected).length >= 2);
  const nextTeam = (team) => { const i = game.teams.indexOf(team); return game.teams[i + 1]?.id || "new"; };
  const solo = game.teams.find((team) => team.members.length < 2);
  return (
    <div className="lobby tt-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <Departures
        head={["Player", "Team", "Status"]}
        cols="1fr 0.8fr 0.5fr"
        rows={game.teams.flatMap((team) => team.members.map((id) => {
          const connected = game.players.find((p) => p.id === id)?.connected;
          return {
            key: id,
            state: connected ? "ready" : "away",
            label: `${nameOf(game, id)}, ${team.name}, ${connected ? "ready" : "reconnecting"}`,
            cells: [
              <button type="button" onClick={() => onAction("movePlayer", { playerId: id, teamId: nextTeam(team) })} aria-label={`Move ${nameOf(game, id)} to the next team`}>{nameOf(game, id)}<SwapIcon /></button>,
              <><span className="tt-team-num" aria-hidden="true">{teamNumber(game, team)}</span>{team.name}</>,
              connected ? "Ready" : "Away",
            ],
          };
        }))}
        openCells={game.players.length < 12 ? ["— — —", solo ? solo.name : "New team", "Waiting"] : null}
      />
      <p className="muted">Players pair up as they join. Tap a name to move them to the next team.</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="muted">You need at least one team of two to start.</p>}
    </div>
  );
}
// The turn's set: the big studio clock and the words cleared on the desk, beside the monitor wall. Before the
// clock starts it waits on 45 with dim segments.
function TurnBoard({ game, foul }) {
  const turn = game.turn, live = turn.phase === "play";
  return (
    <div className={"tt-play" + (live ? " is-live" : " is-waiting")}>
      <div className="tt-console">
        <div className="tt-console-clock">
          <span className="label">Time</span>
          <StudioClock deadline={live ? turn.deadline : null} serverNow={game.serverNow} idle={turnSeconds(turn)} />
        </div>
        <div className="tt-console-words" aria-label={`${turn.points} of ${turnSize(turn)} words`}>
          <span className="label">Words</span>
          <span className="tt-of"><Segments className="tt-of-n" value={turn.points} /><small>of</small><Segments value={turnSize(turn)} /></span>
        </div>
      </div>
      <div className="tt-board-wrap">
        <MonitorWall words={clearedWords(turn)} label={`${turn.points} of ${turnSize(turn)} words cleared`} />
        {foul && <div className="tt-foul-flash" key={foul} aria-hidden="true"><span className="tt-foul-x"><XIcon /></span><span className="tt-foul-word">Foul!</span></div>}
      </div>
    </div>
  );
}
function Stage({ game, onAction, foul }) {
  const turn = game.turn, team = teamById(game, turn.teamId), giver = turn.clueGiverId;
  const next = !game.hostless && turn.phase === "done" && !game.tutorial;
  return (
    <div className="tt-center">
      <p className="tt-round-label"><span className="tt-round-pill">{turnLabel(game)}</span>{team && <span className="tt-round-team"><span className="tt-team-num" aria-hidden="true">{teamNumber(game, team)}</span>{team.name}</span>}</p>
      {turn.phase === "choose" && <h1 className="tt-headline">{team?.name}: who’s giving the clues?<small>Last round. Decide on your phones.</small></h1>}
      {turn.phase === "ready" && (
        <>
          <h1 className="tt-headline"><em>{nameOf(game, giver)}</em> gives the clues to <em>{names(game, guessersOf(game))}</em><small>Get ready. The clock starts when {nameOf(game, giver)} taps Start.</small></h1>
          <TurnBoard game={game} />
        </>
      )}
      {turn.phase === "play" && (
        <>
          <h1 className="tt-headline"><em>{nameOf(game, giver)}</em> is giving clues to <em>{names(game, guessersOf(game))}</em></h1>
          <TurnBoard game={game} foul={foul} />
          {turn.lastGuess && !turn.lastGuess.correct && game.guessing === "typed" ? <p className="tt-miss" key={turn.lastGuess.at}><XIcon /><q>{turn.lastGuess.text}</q> Not it.</p> : <p className="tt-miss is-empty" aria-hidden="true" />}
        </>
      )}
      {turn.phase === "done" && (
        <>
          <h1 className="tt-headline tt-scored">
            <span className="tt-scored-line"><em>{team?.name}</em> {game.tutorial ? "would have scored" : "scored"} <Segments className="tt-scored-n" value={turn.points + turn.bonus} label={String(turn.points + turn.bonus)} /></span>
            {turn.bonus ? <small>{turn.points} words + {turn.bonus} bonus for the seconds left</small> : null}
          </h1>
          {turn.results?.length ? <MonitorWall words={resultWords(turn)} label="The turn's words" /> : null}
        </>
      )}
      {next && <button className="primary sv-next" onClick={() => onAction("next")}>Next turn</button>}
    </div>
  );
}
export function TongueDisplay({ game, onAction }) {
  const turn = game.turn;
  const foul = useTvSounds(game);
  useClockTicks(turn?.phase === "play" ? turn.deadline : null, game.serverNow, 5);
  return (
    <main className="display tt">
      <SoundToggle />
      <header className="display-bar">
        <TongueLogo />
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        {turn?.phase !== "play" && <ClueTimer deadline={turn?.deadline} serverNow={game.serverNow} />}
      </header>
      <Coach game={game} coach={TONGUE_COACH} place="tv" />
      {game.status === "lobby" || !turn ? <Lobby game={game} onAction={onAction} /> : (
        <div className="tt-stage"><Stage game={game} onAction={onAction} foul={foul} /><Scoreboard game={game} /></div>
      )}
      {game.hostless && game.players.length > 0 && game.status === "playing" && !game.tutorial && (
        <details className="host-tools sv-host-tools">
          <summary>Host tools</summary>
          <div className="sv-round-controls">
            <button className="chip-btn" onClick={() => onAction("skipTurn")}>Skip this turn</button>
            <button className="chip-btn danger" onClick={() => onAction("endGame")}>End game early</button>
          </div>
        </details>
      )}
      {!game.hostless && (
        <a className="controller-link" href="?controller" onClick={(event) => { event.preventDefault(); sessionStorage.hostCode = game.code; window.open("?controller", "_blank"); }}>Open host controller</a>
      )}
    </main>
  );
}

// ---------- Player phone ----------
// The word on the clue-giver's phone: a monitor with the word as big as the phone allows, switching on afresh for
// each new word.
function WordCard({ word, small = false }) {
  const longest = word ? Math.max(4, ...word.split(" ").map((w) => w.length)) : 4;
  return (
    <div className={"tt-word" + (small ? " is-small" : "")} aria-live="polite">
      <span className="label">The word</span>
      <div className="tt-word-screen" style={{ "--w": longest }}>{word ? <span className="tt-word-text" key={word}>{word}</span> : <span className="tt-screen-idle" aria-label="Loading the word">…</span>}</div>
    </div>
  );
}
function ClueCard({ game, playerId }) {
  const word = useWord(game, playerId, true), act = (action) => socket.emit("tongue:word", { code: game.code, playerId, action });
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">Clue it to {names(game, guessersOf(game))}. Don’t say it!</span><StudioClock className="is-small" deadline={game.turn.deadline} serverNow={game.serverNow} /></div>
      <WordCard word={word} />
      <Tally turn={game.turn} showLeft />
      <div className="tt-actions">
        {game.guessing === "aloud" && <button className="tt-got-btn" onClick={() => act("got")}><Check />Got it!</button>}
        <button className="tt-pass-btn" onClick={() => act("pass")}>Pass</button>
      </div>
      <button className="tt-foul-btn" onClick={() => act("foul")}><XIcon />Oops, I said it</button>
      {game.turn.got.length > 0 && <WordList words={game.turn.got.map((text) => ({ text, status: "got" }))} />}
    </div>
  );
}
function GuessBox({ game, playerId }) {
  const [guess, setGuess] = useState(""), [result, setResult] = useState(null);
  const send = (e) => {
    e.preventDefault();
    if (!guess.trim()) return;
    socket.timeout(5000).emit("tongue:guess", { code: game.code, playerId, guess }, (err, r) => { setResult(err ? null : r); if (r?.correct) setGuess(""); });
  };
  return (
    <form className="final-form sv-guess tt-guess" onSubmit={send}>
      <div className="sv-guess-top"><span className="sv-guess-label">{nameOf(game, game.turn.clueGiverId)} is cluing</span><StudioClock className="is-small" deadline={game.turn.deadline} serverNow={game.serverNow} /></div>
      <Tally turn={game.turn} />
      <input autoFocus aria-label="Your guess" autoComplete="off" enterKeyHint="send" maxLength="60" value={guess} onChange={(e) => { setGuess(e.target.value); setResult(null); }} placeholder="Type your guess" />
      {result && !result.correct && <p className="notice tt-not-it" role="status"><XIcon />Not it. Keep going!</p>}
      <button className="primary" disabled={!guess.trim()}>Guess</button>
    </form>
  );
}
function PlayerAction({ game, playerId }) {
  const turn = game.turn, myTeam = teamOfPlayer(game, playerId), onTurn = myTeam?.id === turn.teamId;
  const giver = turn.clueGiverId === playerId;
  if (turn.phase === "choose") {
    if (onTurn) return <div className="tt-card-wrap"><p className="player-status is-you">Last round! Who’s giving the clues?</p><button className="primary tt-big" onClick={() => socket.emit("tongue:choose", { code: game.code, playerId })}>I’ll give the clues</button></div>;
    return <p className="player-status">{teamById(game, turn.teamId)?.name} is deciding who gives the clues…</p>;
  }
  if (turn.phase === "ready") {
    if (giver)
      return (
        <div className="tt-card-wrap">
          <div className="sv-guess-top"><span className="sv-guess-label">You’re giving the clues to {names(game, guessersOf(game))}. {game.tutorial ? `${turnSize(turn)} practice words` : "Seven words"}, {turnSeconds(turn)} seconds.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
          <button className="primary tt-big" onClick={() => socket.emit("tongue:start", { code: game.code, playerId })}>Start</button>
        </div>
      );
    return <p className={"player-status" + (onTurn ? " is-you" : "")}>{onTurn ? `Get ready to guess. ${nameOf(game, turn.clueGiverId)} is giving the clues!` : `${teamById(game, turn.teamId)?.name} is up next`}</p>;
  }
  if (turn.phase === "play") {
    if (giver) return <ClueCard game={game} playerId={playerId} />;
    if (onTurn) return game.guessing === "typed" ? <GuessBox game={game} playerId={playerId} /> : <div className="tt-card-wrap"><p className="player-status is-you">Guess out loud!</p><Tally turn={turn} /></div>;
    return <div className="tt-card-wrap"><p className="player-status">{teamById(game, turn.teamId)?.name} is playing<br /><small className="muted">No shouting answers!</small></p><Tally turn={turn} /></div>;
  }
  return (
    <div className="tt-my-result">
      <p className="player-status">{teamById(game, turn.teamId)?.name} {game.tutorial ? "would have scored" : "scored"} <Segments className="tt-status-n" value={turn.points + turn.bonus} label={String(turn.points + turn.bonus)} /></p>
      {turn.results?.length ? <WordList words={resultWords(turn)} /> : null}
    </div>
  );
}
export function TonguePlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), turn = game.turn, team = teamOfPlayer(game, playerId);
  const myMove = turn && ((turn.phase === "ready" || turn.phase === "play") && turn.clueGiverId === playerId || (turn.phase === "choose" && team?.id === turn.teamId));
  useEffect(() => { if (myMove) { try { navigator.vibrate?.(150); } catch {} } }, [myMove, turn?.phase]);
  if (!player) return <main className="player tt"><p className="status-card">You’re no longer in this game.</p></main>;
  return (
    <main className="player tt">
      <header className="player-bar"><TongueLogo /><span className="player-name">{player.name}</span></header>
      <div className="tt-my-team">
        <span className="tt-my-name">{team && <span className="tt-team-num" aria-hidden="true">{teamNumber(game, team)}</span>}<span className="tt-my-text"><b>{team ? team.name : "No team yet"}</b>{team && <small>{pairNames(game, team)}</small>}</span></span>
        <Segments className="tt-my-score" value={team?.score ?? 0} digits={2} label={`${team?.score ?? 0} points`} />
      </div>
      <Coach game={game} coach={TONGUE_COACH} place="phone" playerId={playerId} />
      {game.status === "lobby" || !turn ? <p className="player-status">You’re in! {team?.members.length < 2 ? "Waiting for a partner…" : "The game starts when everyone’s here."}</p> : (
        <>
          <p className="player-clue-meta">{turnLabel(game)}{isLast(game) && !game.tutorial ? " · last round" : ""}</p>
          <PlayerAction game={game} playerId={playerId} />
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
function TeamTools({ game, onAction }) {
  return (
    <ul className="tt-team-tools">
      {game.teams.map((team) => (
        <li key={team.id}>
          <span className="tt-team-num" aria-hidden="true">{teamNumber(game, team)}</span>
          <input aria-label={`${team.name}’s name`} defaultValue={team.name} key={team.name} maxLength="24" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== team.name && onAction("renameTeam", { teamId: team.id, name: e.target.value })} />
          <Money value={team.score} />
          <button className="chip-btn add" onClick={() => onAction("adjustScore", { teamId: team.id, amount: 1 })}>+1</button>
          <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { teamId: team.id, amount: -1 })}>−1</button>
        </li>
      ))}
    </ul>
  );
}
export function TongueController({ game, onAction }) {
  const turn = game.turn, word = useWord(game, undefined, !game.hostless && turn?.phase === "play");
  const header = <header className="controller-bar"><TongueLogo /><span className="code-chip tt-code-chip" aria-label={`Game code ${game.code.split("").join(" ")}`}>{game.code}</span></header>;
  if (game.status === "lobby" || !turn)
    return <main className="controller tt">{header}<h1>Lobby</h1><p className="muted">Start the game from the main screen. Move players between teams by tapping their names there.</p><section className="controller-players"><h2>Teams</h2><TeamTools game={game} onAction={onAction} /></section></main>;
  const team = teamById(game, turn.teamId);
  return (
    <main className="controller tt">
      {header}
      <Coach game={game} coach={TONGUE_COACH} place="controller" />
      <div className="sv-guess-top tt-ctrl-top">
        <p className="player-clue-meta">{turnLabel(game)} · {team?.name}</p>
        {turn.phase === "play" && <StudioClock className="is-small" deadline={turn.deadline} serverNow={game.serverNow} />}
      </div>
      {turn.phase === "ready" && <p className="status-note">{nameOf(game, turn.clueGiverId)} gives the clues to {names(game, guessersOf(game))}. Their clock starts when they tap Start.</p>}
      {turn.phase === "play" && (
        <>
          <WordCard word={word} small />
          <Tally turn={turn} showLeft />
          <div className="tt-actions">
            <button className="tt-got-btn" onClick={() => onAction("got")}><Check />Got it!</button>
            <button className="tt-pass-btn" onClick={() => onAction("pass")}>Pass</button>
          </div>
          <button className="tt-foul-btn" onClick={() => onAction("foul")}><XIcon />Foul: they said it</button>
        </>
      )}
      {turn.phase === "done" && turn.results?.length > 0 && <WordList words={resultWords(turn)} />}
      {/* After the practice turn, the coach's Start the game button takes over from Next turn. */}
      {!(game.tutorial && turn.phase === "done") && <button className="wide on" onClick={() => onAction("next")}>{turn.phase === "play" ? "Stop the clock" : turn.phase === "done" ? "Next turn" : turn.phase === "ready" ? "Start their clock" : "Skip ahead"}</button>}
      {!game.tutorial && <div className="sv-round-controls"><button className="chip-btn" onClick={() => onAction("skipTurn")}>Skip this turn</button><button className="chip-btn danger" onClick={() => onAction("endGame")}>End game early</button></div>}
      <section className="controller-players"><h2>Teams</h2><TeamTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
export function TongueEnd({ game, host, display, onAction }) {
  const standings = ranked(game), top = standings.slice(0, 3), rest = standings.slice(3);
  const tie = standings.length > 1 && standings[0].score === standings[1].score;
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  return (
    <main className="end tt">
      {display && <SoundToggle />}
      <TongueLogo />
      <h1 className="tt-winner">{!standings.length ? "Game over" : tie ? "It’s a tie!" : <><span>{standings[0].name}</span> wins!</>}</h1>
      <ol className="podium">
        {top.map((t, i) => (
          <li className={`place place-${i + 1}`} key={t.id}>
            <span className="rank">{i + 1}</span>
            <span className="tt-place-name"><b>{t.name}</b><small>{pairNames(game, t)}</small></span>
            <Segments className="tt-place-score" value={t.score} digits={2} label={`${t.score} points`} />
          </li>
        ))}
      </ol>
      {rest.length > 0 && <ol className="remaining-players" start="4">{rest.map((t) => <li key={t.id}><span>{t.name}</span><Segments className="tt-rest-score" value={t.score} label={`${t.score} points`} /></li>)}</ol>}
      {host ? (
        <div className="sv-end-buttons">
          <button className="primary" onClick={() => onAction("replay", { words: dealWords(readCategories()) })}>Play again with new words</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
