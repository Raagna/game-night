// Tip of the Tongue screens: host setup, the shared TV display, players' phones, the host controller and the end.
import React, { useEffect, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, useEventSounds, playWinnersTune, playBuzz, playDing, playRoundWon } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { playClue, playPop } from "../fib/sounds";
import WORDS from "./words.json";
import "./tongue.css";
import Flap, { Brand, Money } from "../Flap";

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
const Check = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

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

function useTvSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "turn") playClue();
    else if (e.type === "got") playDing(10);
    else if (e.type === "pass") playPop();
    else if (e.type === "foul") playBuzz();
    else if (e.type === "turnEnd") playRoundWon();
  });
}

// ---------- Setup ----------
export function TongueSetup({ onCreate }) {
  const [rounds, setRounds] = useState(() => Number(read(ROUNDS_KEY, ["3", "4", "5"], "3"))),
    [guessing, setGuessing] = useState(() => read(GUESSING_KEY, ["typed", "aloud"], "typed")),
    [chosen, setChosen] = useState(readCategories),
    [hostless, setHostless] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const choose = (list) => { setChosen(list); remember(CATEGORIES_KEY, JSON.stringify(list)); };
  const toggle = (name) => choose(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]);
  const wordCount = new Set(wordsIn(chosen).map((w) => w.toLowerCase())).size, enough = wordCount >= WORDS_PER_TURN;
  const start = () => {
    setNotice(""); setBusy(true);
    onCreate({ game: "tongue", words: dealWords(chosen), rounds, guessing, hostless }, (e) => { setBusy(false); setNotice(e); });
  };
  return (
    <main className="setup tt-setup">
      <BackToHub />
      <Brand text="TIP OF THE TONGUE" className="tt-brand" />
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Tip of the Tongue</h1>
            <p className="muted">Teams of two. One partner sees a word and clues it; the other guesses as many as they can in 45 seconds. Players pair up as they join, and you can swap them in the lobby.</p>
          </div>
        </div>
        <fieldset className="ws-fieldset">
          <legend>Rounds</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Rounds">
            {[3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rounds === n} onClick={() => { setRounds(n); remember(ROUNDS_KEY, String(n)); }}>{n} rounds</button>)}
          </div>
          <p className="muted sv-hint">Each round, every team takes one turn. Partners swap who gives the clues each round; in the last round, each team decides.</p>
        </fieldset>
        <fieldset className="ws-fieldset">
          <legend>Guessing</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Guessing">
            {Object.entries(GUESSING).map(([id, { label }]) => <button key={id} role="radio" aria-checked={guessing === id} onClick={() => { setGuessing(id); remember(GUESSING_KEY, id); }}>{label}</button>)}
          </div>
          <p className="muted sv-hint">{GUESSING[guessing].note}</p>
        </fieldset>
        <fieldset className="ws-fieldset tt-cats-field">
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
function Scoreboard({ game }) {
  return (
    <section className="fib-scoreboard" aria-label="Scores">
      <h2>Teams</h2>
      <ol>
        {ranked(game).map((team) => (
          <li key={team.id} className={game.turn?.teamId === team.id ? "is-turn" : ""}>
            <span className="fib-sb-name">{team.name}<small> · {names(game, team.members)}</small>{game.turn?.teamId === team.id && <em className="tt-playing">Playing</em>}</span>
            <b className="money">{team.score}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
function Results({ turn }) {
  return (
    <ol className="tt-results">
      {turn.results.map((word, i) => <li key={i} className={`is-${word.status}`}><span>{word.text}</span><em>{word.status === "got" && <Check />}{STATUS[word.status]}</em></li>)}
    </ol>
  );
}
const turnLabel = (game) => `Round ${game.roundIndex + 1} of ${game.rounds}`;

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const ready = game.teams.some((team) => team.members.filter((id) => game.players.find((p) => p.id === id)?.connected).length >= 2);
  const nextTeam = (team) => { const i = game.teams.indexOf(team); return game.teams[i + 1]?.id || "new"; };
  return (
    <div className="lobby fib-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <ul className="tt-lobby-teams">
        {game.teams.map((team) => (
          <li key={team.id}>
            <h2>{team.name}</h2>
            {team.members.map((id) => <button key={id} onClick={() => onAction("movePlayer", { playerId: id, teamId: nextTeam(team) })} aria-label={`Move ${nameOf(game, id)} to the next team`}>{nameOf(game, id)}</button>)}
            {team.members.length < 2 && <span className="muted">Waiting for a partner</span>}
          </li>
        ))}
        {!game.teams.length && <li className="muted">Nobody yet</li>}
      </ul>
      <p className="muted">Players pair up as they join. Tap a name to move them to the next team.</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="muted">You need at least one team of two to start.</p>}
    </div>
  );
}
function Stage({ game, onAction }) {
  const turn = game.turn, team = teamById(game, turn.teamId), giver = turn.clueGiverId;
  const next = !game.hostless && turn.phase === "done";
  return (
    <div className="fib-center tt-center">
      <p className="sv-round-label">{turnLabel(game)}<em>{team?.name}</em></p>
      {turn.phase === "choose" && <h1 className="tt-headline">{team?.name}: who’s giving the clues?<small>Last round — decide on your phones.</small></h1>}
      {turn.phase === "ready" && <h1 className="tt-headline">{nameOf(game, giver)} gives the clues to {names(game, guessersOf(game))}<small>Get ready — the clock starts when {nameOf(game, giver)} taps Start.</small></h1>}
      {turn.phase === "play" && (
        <>
          <h1 className="tt-headline">{nameOf(game, giver)} is giving clues to {names(game, guessersOf(game))}</h1>
          <p className="tt-count"><b className="dmd-line">{turn.points}</b> of {turn.total}</p>
          <ul className="tt-got">{turn.got.map((word) => <li key={word}><Check />{word}</li>)}</ul>
          {turn.lastGuess && !turn.lastGuess.correct && game.guessing === "typed" && <p className="tt-miss" key={turn.lastGuess.at}>“{turn.lastGuess.text}”? Nope.</p>}
        </>
      )}
      {turn.phase === "done" && (
        <>
          <h1 className="tt-headline">{team?.name} scored {turn.points + turn.bonus}{turn.bonus ? <small>{turn.points} words + {turn.bonus} bonus for the seconds left</small> : null}</h1>
          {turn.results?.length ? <Results turn={turn} /> : null}
        </>
      )}
      {next && <button className="primary sv-next" onClick={() => onAction("next")}>Next turn</button>}
    </div>
  );
}
export function TongueDisplay({ game, onAction }) {
  const turn = game.turn;
  useTvSounds(game);
  useClockTicks(turn?.phase === "play" ? turn.deadline : null, game.serverNow, 5);
  return (
    <main className="display tt">
      <SoundToggle />
      <header className="display-bar">
        <Brand text="TIP OF THE TONGUE" className="tt-brand" />
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        <ClueTimer deadline={turn?.deadline} serverNow={game.serverNow} />
      </header>
      {game.status === "lobby" || !turn ? <Lobby game={game} onAction={onAction} /> : (
        <div className="fib-stage"><Stage game={game} onAction={onAction} /><Scoreboard game={game} /></div>
      )}
      {game.hostless && game.players.length > 0 && game.status === "playing" && (
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
function ClueCard({ game, playerId }) {
  const word = useWord(game, playerId, true), act = (action) => socket.emit("tongue:word", { code: game.code, playerId, action });
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">Clue it to {names(game, guessersOf(game))}. Don’t say it!</span><ClueTimer deadline={game.turn.deadline} serverNow={game.serverNow} /></div>
      <p className="tt-word" aria-live="polite">{word || "…"}</p>
      <p className="tt-progress"><b className="dmd-line">{game.turn.points}</b> of {game.turn.total} · {game.turn.left} left</p>
      <div className="tt-actions">
        {game.guessing === "aloud" && <button className="tt-got-btn" onClick={() => act("got")}>Got it!</button>}
        <button className="tt-pass-btn" onClick={() => act("pass")}>Pass</button>
      </div>
      <button className="tt-foul-btn" onClick={() => act("foul")}>Oops — I said it</button>
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
      <div className="sv-guess-top"><span className="sv-guess-label">{nameOf(game, game.turn.clueGiverId)} is cluing</span><ClueTimer deadline={game.turn.deadline} serverNow={game.serverNow} /></div>
      <p className="tt-progress"><b className="dmd-line">{game.turn.points}</b> of {game.turn.total}</p>
      <input autoFocus aria-label="Your guess" autoComplete="off" enterKeyHint="send" maxLength="60" value={guess} onChange={(e) => { setGuess(e.target.value); setResult(null); }} placeholder="Type your guess" />
      {result && !result.correct && <p className="notice" role="status">Not it — keep going!</p>}
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
          <div className="sv-guess-top"><span className="sv-guess-label">You’re giving the clues to {names(game, guessersOf(game))}. Seven words, 45 seconds.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
          <button className="primary tt-big" onClick={() => socket.emit("tongue:start", { code: game.code, playerId })}>Start</button>
        </div>
      );
    return <p className="player-status">{onTurn ? `Get ready to guess — ${nameOf(game, turn.clueGiverId)} is giving the clues!` : `${teamById(game, turn.teamId)?.name} is up next`}</p>;
  }
  if (turn.phase === "play") {
    if (giver) return <ClueCard game={game} playerId={playerId} />;
    if (onTurn) return game.guessing === "typed" ? <GuessBox game={game} playerId={playerId} /> : <div className="tt-card-wrap"><p className="player-status is-you">Guess out loud!</p><p className="tt-progress"><b className="dmd-line">{turn.points}</b> of {turn.total}</p></div>;
    return <p className="player-status">{teamById(game, turn.teamId)?.name} is playing<br /><small className="muted">No shouting answers!</small></p>;
  }
  return (
    <div className="fib-my-result">
      <p className="player-status">{teamById(game, turn.teamId)?.name} scored {turn.points + turn.bonus}</p>
      {turn.results?.length ? <Results turn={turn} /> : null}
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
      <header className="player-bar"><Brand text="TIP OF THE TONGUE" className="tt-brand" /><span className="player-name">{player.name}</span></header>
      <b className="player-score money">{team?.score ?? 0}</b>
      <p className="tt-team">{team ? `${team.name} · ${names(game, team.members)}` : "No team yet"}</p>
      {game.status === "lobby" || !turn ? <p className="player-status">You’re in! {team?.members.length < 2 ? "Waiting for a partner…" : "The game starts when everyone’s here."}</p> : (
        <>
          <p className="player-clue-meta">{turnLabel(game)}{isLast(game) ? " · last round" : ""}</p>
          <PlayerAction game={game} playerId={playerId} />
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
function TeamTools({ game, onAction }) {
  return (
    <div className="sv-team-tools fib-player-tools">
      <ul>
        {game.teams.map((team) => (
          <li key={team.id}>
            <input aria-label={`${team.name}’s name`} defaultValue={team.name} key={team.name} maxLength="24" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== team.name && onAction("renameTeam", { teamId: team.id, name: e.target.value })} />
            <span className="money">{team.score}</span>
            <button className="chip-btn add" onClick={() => onAction("adjustScore", { teamId: team.id, amount: 1 })}>+1</button>
            <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { teamId: team.id, amount: -1 })}>−1</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function TongueController({ game, onAction }) {
  const turn = game.turn, word = useWord(game, undefined, !game.hostless && turn?.phase === "play");
  const header = <header className="controller-bar"><Brand text="TIP OF THE TONGUE" className="tt-brand" /><Flap className="code-chip" text={game.code} label={`Game code ${game.code}`} /></header>;
  if (game.status === "lobby" || !turn)
    return <main className="controller tt">{header}<h1>Lobby</h1><p className="muted">Start the game from the main screen. Move players between teams by tapping their names there.</p><section className="controller-players"><h2>Teams</h2><TeamTools game={game} onAction={onAction} /></section></main>;
  const team = teamById(game, turn.teamId);
  return (
    <main className="controller tt">
      {header}
      <p className="player-clue-meta">{turnLabel(game)} · {team?.name}</p>
      {turn.phase === "ready" && <p className="status-note">{nameOf(game, turn.clueGiverId)} gives the clues to {names(game, guessersOf(game))}. Their clock starts when they tap Start.</p>}
      {turn.phase === "play" && (
        <>
          <div className="controller-answer"><span>The word</span>{word || "…"}</div>
          <p className="tt-progress"><b className="dmd-line">{turn.points}</b> of {turn.total} · {turn.left} left</p>
          <div className="tt-actions">
            <button className="tt-got-btn" onClick={() => onAction("got")}>Got it!</button>
            <button className="tt-pass-btn" onClick={() => onAction("pass")}>Pass</button>
          </div>
          <button className="tt-foul-btn" onClick={() => onAction("foul")}>Foul — they said it</button>
        </>
      )}
      {turn.phase === "done" && turn.results?.length > 0 && <Results turn={turn} />}
      <button className="wide on" onClick={() => onAction("next")}>{turn.phase === "play" ? "Stop the clock" : turn.phase === "done" ? "Next turn" : turn.phase === "ready" ? "Start their clock" : "Skip ahead"}</button>
      <div className="sv-round-controls"><button className="chip-btn" onClick={() => onAction("skipTurn")}>Skip this turn</button><button className="chip-btn danger" onClick={() => onAction("endGame")}>End game early</button></div>
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
      <Brand text="TIP OF THE TONGUE" className="tt-brand" />
      <h1>{!standings.length ? "Game over" : tie ? "It’s a tie!" : `${standings[0].name} wins!`}</h1>
      <div className="podium">{top.map((t, i) => <div className={`place place-${i + 1}`} key={t.id}><span className="rank">{i + 1}</span><b>{t.name}</b><small>{names(game, t.members)}</small><strong className="money">{t.score}</strong></div>)}</div>
      {rest.length > 0 && <ol className="remaining-players" start="4">{rest.map((t) => <li key={t.id}><span>{t.name}</span><b className="money">{t.score}</b></li>)}</ol>}
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
