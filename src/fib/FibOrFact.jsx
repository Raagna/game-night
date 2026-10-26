// Fib or Fact screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
import React, { useEffect, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner } from "../JoinQR";
import { BackToHub } from "../Hub";
import { loadSeasonIndex, loadSeason } from "../questions";
import { useSound, playWinnersTune } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { useFibSounds } from "./sounds";
import "./fib.css";

// ---------- Picking clues ----------
// Clues come from the built-in Jeopardy archive: a few seasons are loaded at random when setup opens, and
// each clue offers three categories for the chooser. The other answers in a clue's category go along as
// "house fibs", so the vote has enough choices even with two or three players.
const PLAYED_KEY = "gameNight.fib.played.v1";
const LENGTH_KEY = "gameNight.fib.length.v1";
const LENGTHS = [5, 7, 9];
const SEASONS_TO_LOAD = 3;
const MAX_FIB_LENGTH = 40;
// Mirrors the server: ×1 for the first half, ×2 for the second, ×3 for the final clue.
const multipliers = (count) => [...Array(count - 1)].map((_, i) => (i < Math.ceil((count - 1) / 2) ? 1 : 2)).concat(3);
const MULTIPLIER_NAME = { 2: "Double points", 3: "Triple points" };
// Clues that lean on a picture or sound, and wordplay categories whose answers only make sense as a pun.
const MEDIA = /seen here|shown here|heard here|pictured|clue crew|this video|\[/i;
const WORDPLAY = /BEFORE & AFTER|RHYME TIME|ANAGRAM|CROSSWORD|SPELL|LETTER|HIDDEN|BACKWARD/i;
const readPlayed = () => { try { return JSON.parse(localStorage.getItem(PLAYED_KEY)) || []; } catch { return []; } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-1500))); } catch {} };
const readLength = () => { try { const n = Number(localStorage.getItem(LENGTH_KEY)); return LENGTHS.includes(n) ? n : 7; } catch { return 7; } };
const rememberLength = (n) => { try { localStorage.setItem(LENGTH_KEY, String(n)); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
const plain = (answer) => answer.replace(/\([^)]*\)/g, " ").replace(/["“”]/g, "").replace(/\s+/g, " ").trim();

// A clue works for bluffing when its answer is short and the clue doesn't give it away.
function goodClue({ question, answer }) {
  const shown = plain(answer);
  if (shown.length < 2 || shown.length > 28 || shown.split(" ").length > 4 || /[/\\]| or /i.test(answer)) return false;
  if (question.length < 25 || question.length > 260 || MEDIA.test(question)) return false;
  return !question.toLowerCase().includes(shown.toLowerCase().replace(/^(a|an|the) /, ""));
}
// The third row and below of each Jeopardy and Double Jeopardy category; the bottom two rows are "hard",
// which is where the final clue comes from.
function buildClues(questions) {
  const categories = new Map();
  for (const question of questions) {
    if (question.round === "Final Jeopardy!") continue;
    const key = question.id.replace(/-\d+$/, "");
    if (!categories.has(key)) categories.set(key, []);
    categories.get(key).push(question);
  }
  const clues = [];
  for (const group of categories.values()) {
    if (WORDPLAY.test(group[0].category)) continue;
    group.forEach((question, row) => {
      if (row < 2 || !goodClue(question)) return;
      clues.push({ id: question.id, category: question.category, question: question.question, answer: question.answer, hard: row >= 3, decoys: group.filter((other) => other !== question).map((other) => other.answer) });
    });
  }
  return clues;
}
let poolRequest = null;
function loadPool() {
  poolRequest ||= loadSeasonIndex().then(async (index) => {
    const seasons = shuffle(index.map((entry) => entry.season)).slice(0, SEASONS_TO_LOAD).sort((a, b) => a - b);
    const results = await Promise.allSettled(seasons.map(loadSeason));
    const loaded = seasons.filter((_, i) => results[i].status === "fulfilled");
    if (!loaded.length) throw new Error("Couldn’t load clues from the Jeopardy archive. Check your connection and try again.");
    return { seasons: loaded, clues: buildClues(results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))) };
  }).catch((error) => { poolRequest = null; throw error; });
  return poolRequest;
}
// Three clues from categories not used anywhere else in the game; clues this browser has played come last.
function dealPrompt(clues, usedCategories, final) {
  const played = new Set(readPlayed()), choices = [];
  const ordered = shuffle(final ? clues.filter((clue) => clue.hard) : clues).sort((a, b) => played.has(a.id) - played.has(b.id));
  for (const clue of ordered) {
    if (choices.length === 3) break;
    if (usedCategories.has(clue.category)) continue;
    usedCategories.add(clue.category);
    choices.push(clue);
  }
  return { choices };
}
function dealPrompts(count, clues) {
  const used = new Set();
  return Array.from({ length: count }, (_, i) => dealPrompt(clues, used, i === count - 1));
}
const toConfig = (prompts) => prompts.map(({ choices }) => ({ choices: choices.map(({ id, category, question, answer, decoys }) => ({ id, category, question, answer, decoys })) }));

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || "A player";
const names = (game, ids) => {
  const list = ids.map((id) => nameOf(game, id));
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] || "";
};
const points = (value) => (value || 0).toLocaleString();
const ranked = (game) => [...game.players].sort((a, b) => b.score - a.score);
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th"}`;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const isLast = (game) => game.index >= game.clueCount - 1;
const roundLabel = (game) => (isLast(game) ? "Final clue" : `Clue ${game.index + 1} of ${game.clueCount}`);
// The phone remembers its own fib for this clue (it survives a reload), so it can leave it out of the vote.
const fibKey = (game) => `gameNight.fib.mine.${game.code}.${game.index}`;
const readMine = (game) => { try { return sessionStorage.getItem(fibKey(game)) || ""; } catch { return ""; } };
const writeMine = (game, fib) => { try { sessionStorage.setItem(fibKey(game), fib); } catch {} };

// The fact and the fibs for host controllers. It can arrive straight after the controller connects, before
// this screen is drawn, so it's caught when the module loads (as Spin & Solve does with its solution).
let lastSecret = null;
const secretListeners = new Set();
socket.on("fib:secret", (secret) => { lastSecret = secret; secretListeners.forEach((listener) => listener(secret)); });
function useSecret(game) {
  const [secret, setSecret] = useState(lastSecret);
  useEffect(() => { secretListeners.add(setSecret); return () => secretListeners.delete(setSecret); }, []);
  return secret?.code === game.code && secret.index === game.index ? secret : null;
}

// What the clue is waiting for, in a headline and a line of detail.
function phaseText(game) {
  const round = game.round, live = game.players.filter((player) => player.connected).length;
  switch (round.phase) {
    case "pick": return { title: `${nameOf(game, round.chooserId)} is picking a category`, detail: "" };
    case "write": return { title: "Write a fib!", detail: `Something that sounds true. ${round.submitted.length} of ${live} in.` };
    case "vote": return { title: "Which one is the fact?", detail: `Vote on your phone. ${round.voted.length} of ${live} voted.` };
    case "reveal": return { title: "The reveal", detail: "" };
    case "scores": return { title: "Scores", detail: "" };
    default: return { title: "", detail: "" };
  }
}

// ---------- Setup ----------
export function FibSetup({ onCreate }) {
  const [length, setLength] = useState(readLength),
    [pool, setPool] = useState(null),
    [loadError, setLoadError] = useState(""),
    [prompts, setPrompts] = useState([]),
    [hostless, setHostless] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    loadPool().then((loaded) => { if (!live) return; setPool(loaded); setPrompts(dealPrompts(length, loaded.clues)); }, (error) => live && setLoadError(error.message));
    return () => { live = false; };
  }, []);
  const changeLength = (count) => { setLength(count); rememberLength(count); if (pool) setPrompts(dealPrompts(count, pool.clues)); };
  const swap = (index) => setPrompts((list) => {
    const used = new Set(list.flatMap((prompt, i) => (i === index ? [] : prompt.choices.map((clue) => clue.category))));
    return list.map((prompt, i) => (i === index ? dealPrompt(pool.clues, used, i === list.length - 1) : prompt));
  });
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed(prompts.flatMap((prompt) => prompt.choices.map((clue) => clue.id)));
    onCreate({ game: "fib", prompts: toConfig(prompts), hostless }, (error) => { setBusy(false); setNotice(error); });
  };
  const ready = pool && prompts.length === length && prompts.every((prompt) => prompt.choices.length);
  const seasons = pool?.seasons || [];
  return (
    <main className="setup fib-setup">
      <BackToHub />
      <div className="brand fib-brand">FIB OR FACT <span>game night</span></div>
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Fib or Fact</h1>
            <p className="muted">Everyone writes a fake answer to a real Jeopardy clue, then tries to spot the real one among the fakes. Score for finding the fact, and for every player your fib fools.</p>
          </div>
        </div>
        <fieldset className="sv-fieldset fib-length">
          <legend>Game length</legend>
          <div className="sv-rounds fib-lengths" role="radiogroup" aria-label="Number of clues">
            {LENGTHS.map((count) => <button key={count} role="radio" aria-checked={length === count} onClick={() => changeLength(count)}>{count} clues</button>)}
          </div>
          <p className="muted sv-hint">Points double halfway through and triple on the final clue. Each clue takes about two minutes.</p>
        </fieldset>
        <div className="sv-questions-head">
          <h2>Clues</h2>
          <button className="chip-btn" disabled={!pool} onClick={() => setPrompts(dealPrompts(length, pool.clues))}>New set</button>
        </div>
        {loadError ? <p className="notice" role="alert">{loadError} <button className="chip-btn" onClick={() => location.reload()}>Try again</button></p>
          : !pool ? <p className="muted sv-hint">Loading clues from the Jeopardy archive…</p>
          : (
            <ol className="sv-question-list fib-prompt-list">
              {prompts.map((prompt, i) => {
                const m = multipliers(length)[i];
                return (
                  <li key={prompt.choices.map((clue) => clue.id).join()}>
                    <span className="sv-q-round">{i === length - 1 ? "Final clue" : `Clue ${i + 1}`}{MULTIPLIER_NAME[m] && <em>{MULTIPLIER_NAME[m]}</em>}</span>
                    <span className="fib-q-categories">{prompt.choices.map((clue) => <span key={clue.id}>{clue.category}</span>)}</span>
                    <button className="chip-btn" aria-label={`Swap the categories for clue ${i + 1}`} onClick={() => swap(i)}>Swap</button>
                  </li>
                );
              })}
            </ol>
          )}
        <p className="muted sv-hint">
          Each clue, one player picks one of the three categories. The clues and answers stay hidden here so you can play too.
          {seasons.length > 0 && ` Clues from season${seasons.length > 1 ? "s" : ""} ${seasons.length > 1 ? `${seasons.slice(0, -1).join(", ")} and ${seasons.at(-1)}` : seasons[0]} of the show.`}
        </p>
        <section className="game-options" aria-labelledby="fib-options-title">
          <h2 id="fib-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The game runs itself: 15 seconds to pick a category, 50 to write a fib and 25 to vote, and the reveals move on by themselves. With a host, the host controller shows the real answer and every fib as it comes in (so a rude one can be thrown out), and the host moves the reveals along.</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{length} clues · 2 to 8 players</p>
          <button className="primary" disabled={busy || !ready} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
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
// The same sound switch as the other games' TV screens.
function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return (
    <button className="sv-sound" aria-pressed={!muted} onClick={toggle}>
      <SpeakerIcon off={muted} />
      {muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}
    </button>
  );
}

function Scoreboard({ game }) {
  const round = game.round, waiting = round?.phase === "write" ? round.submitted : round?.phase === "vote" ? round.voted : null;
  return (
    <section className="fib-scoreboard" aria-label="Scores">
      <h2>Scores</h2>
      <ol>
        {ranked(game).map((player) => (
          <li key={player.id} className={`${player.connected ? "" : "is-away"}${waiting?.includes(player.id) ? " is-done" : ""}`}>
            <span className="fib-sb-name">{player.name}{!player.connected && <small> · reconnecting</small>}</span>
            {waiting && <span className="fib-sb-check" aria-label={waiting.includes(player.id) ? "done" : "still going"}>{waiting.includes(player.id) ? "✓" : "…"}</span>}
            <b className="money">{points(player.score)}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RoundMeta({ game }) {
  return (
    <p className="sv-round-label">
      {roundLabel(game)}
      {MULTIPLIER_NAME[game.multiplier] && <em>{MULTIPLIER_NAME[game.multiplier]}</em>}
    </p>
  );
}

function ClueCard({ clue, small = false }) {
  return (
    <div className={`fib-clue${small ? " is-small" : ""}`}>
      <span className="fib-clue-category">{clue.category}</span>
      <p>{clue.question}</p>
    </div>
  );
}

// What a revealed choice turned out to be.
function verdict(game, option) {
  if (option.fact) return "The fact!";
  if (option.house) return "A house fib";
  return `A fib by ${names(game, option.authors)}`;
}

// The choices on the TV. During the reveal, the ones already revealed are marked.
function Options({ game }) {
  const round = game.round, current = round.reveal.at(-1);
  return (
    <ol className={`fib-options count-${round.options.length}`}>
      {round.options.map((option) => {
        const revealed = option.authors !== undefined;
        const state = !revealed ? "" : option.fact ? " is-fact" : " is-fib";
        return (
          <li key={option.id} className={`fib-option${state}${option.id === current && round.phase === "reveal" ? " is-current" : ""}`}>
            <span className="fib-option-text">{option.text}</span>
            {revealed && <span className="fib-option-tag">{option.fact ? "Fact" : option.house ? "House fib" : names(game, option.authors)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// The reveal's spotlight: the choice, who picked it, and then what it really was.
function Spotlight({ game }) {
  const round = game.round, option = round.options.find((o) => o.id === round.reveal.at(-1));
  const [shown, setShown] = useState(false);
  // The verdict lands a beat after the choice and its voters.
  useEffect(() => { setShown(false); const t = setTimeout(() => setShown(true), 1400); return () => clearTimeout(t); }, [option?.id]);
  if (!option) return null;
  const voters = option.voters || [];
  return (
    <div className={`fib-spotlight${shown ? (option.fact ? " is-fact" : " is-fib") : ""}`} key={option.id} role="status">
      <p className="fib-spotlight-text">{option.text}</p>
      <p className="fib-spotlight-voters">
        {voters.length ? `${option.fact ? "Found by" : "Fooled"} ${names(game, voters)}` : option.fact ? "Nobody found it!" : ""}
      </p>
      <p className="fib-spotlight-verdict" aria-hidden={!shown}>{shown ? verdict(game, option) : " "}</p>
    </div>
  );
}

// The points from this clue, best first.
function ClueScores({ game }) {
  const awards = game.round.awards || {};
  const rows = ranked(game).map((player) => ({ player, award: awards[player.id] }));
  return (
    <ol className="fib-clue-scores">
      {rows.map(({ player, award }) => (
        <li key={player.id}>
          <span className="fib-cs-name">{player.name}</span>
          <span className="fib-cs-why">
            {award?.fact > 0 && <em className="is-fact">Found the fact</em>}
            {award?.fooledIds?.length > 0 && <em className="is-fib">Fooled {award.fooledIds.length}</em>}
          </span>
          <span className="fib-cs-gain">{award?.points ? `+${points(award.points)}` : ""}</span>
          <b className="money">{points(player.score)}</b>
        </li>
      ))}
    </ol>
  );
}

function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("500");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="sv-team-tools fib-player-tools">
      <label className="inline-field">Adjust scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            <span className="money">{points(player.score)}</span>
            <button className="chip-btn add" onClick={() => onAction("adjustScore", { playerId: player.id, amount: step })}>+{step}</button>
            <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { playerId: player.id, amount: -step })}>−{step}</button>
            <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Kick</button>
          </li>
        ))}
        {!game.players.length && <li className="muted">No players yet</li>}
      </ul>
    </div>
  );
}

function ClueControls({ game, onAction }) {
  return (
    <div className="sv-round-controls">
      {game.round.phase !== "scores" && <button className="chip-btn" onClick={() => onAction("skipClue")}>Skip this clue</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>{isLast(game) ? "End game" : "End game early"}</button>
    </div>
  );
}

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const ready = game.players.filter((player) => player.connected).length >= 2;
  return (
    <div className="lobby fib-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <ul className="fib-lobby-players">
        {game.players.map((player) => <li key={player.id}>{player.name}</li>)}
        {!game.players.length && <li className="muted">Nobody yet</li>}
      </ul>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="muted">Fib or Fact needs at least 2 players (it’s best with 4 or more).</p>}
    </div>
  );
}

function Stage({ game, onAction }) {
  const round = game.round, { title, detail } = phaseText(game);
  const next = !game.hostless && (round.phase === "reveal" || round.phase === "scores");
  return (
    <div className="fib-center">
      <RoundMeta game={game} />
      {round.phase === "pick" ? (
        <>
          <h1 className="fib-headline">{title}</h1>
          <ul className="fib-categories">{round.categories.map((category, i) => <li key={i}>{category}</li>)}</ul>
        </>
      ) : round.phase === "scores" ? (
        <>
          <h1 className="fib-headline">{isLast(game) ? "Final scores" : "Scores"}</h1>
          <ClueScores game={game} />
        </>
      ) : (
        <>
          <ClueCard clue={round.clue} small={round.phase !== "write"} />
          {round.phase !== "write" && <Options game={game} />}
          {round.phase === "reveal" ? <Spotlight game={game} /> : (
            <div className="sv-status" role="status">
              <h2>{title}</h2>
              {detail && <p>{detail}</p>}
            </div>
          )}
        </>
      )}
      {next && <button className="primary sv-next" onClick={() => onAction("next")}>{round.phase === "scores" ? (isLast(game) ? "See final scores" : "Next clue") : "Next"}</button>}
      {game.hostless && round.phase === "scores" && <p className="muted">{isLast(game) ? "Final scores" : "The next clue"} will appear in a few seconds.</p>}
    </div>
  );
}

export function FibDisplay({ game, onAction }) {
  const round = game.round;
  useFibSounds(game);
  const timed = round && ["write", "vote"].includes(round.phase) ? round.deadline : null;
  useClockTicks(timed, game.serverNow);
  return (
    <main className="display fib">
      <SoundToggle />
      <header className="display-bar">
        <div className="brand fib-brand">FIB OR FACT</div>
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        <ClueTimer deadline={round && round.phase !== "scores" ? round.deadline : null} serverNow={game.serverNow} />
      </header>
      {game.status === "lobby" || !round ? <Lobby game={game} onAction={onAction} /> : (
        <div className="fib-stage">
          <Stage game={game} onAction={onAction} />
          {round.phase !== "scores" && <Scoreboard game={game} />}
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools sv-host-tools">
          <summary>Host tools</summary>
          {round && game.status === "playing" && <ClueControls game={game} onAction={onAction} />}
          <PlayerTools game={game} onAction={onAction} />
        </details>
      )}
      {!game.hostless && (
        <a
          className="controller-link"
          href="?controller"
          onClick={(event) => {
            event.preventDefault();
            sessionStorage.hostCode = game.code;
            window.open("?controller", "_blank");
          }}
        >
          Open host controller
        </a>
      )}
    </main>
  );
}

// ---------- Player phone ----------
function FibForm({ game, playerId }) {
  const round = game.round, [fib, setFib] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const mine = readMine(game), submitted = round.submitted.includes(playerId), removed = round.removed.includes(playerId);
  if (submitted)
    return <p className="player-status">Your fib is in{mine ? <>: <q className="fib-mine">{mine}</q></> : "."}<br /><small className="muted">Waiting for everyone else…</small></p>;
  const send = (event) => {
    event.preventDefault();
    if (!fib.trim() || busy) return;
    setBusy(true); setError("");
    socket.timeout(5000).emit("fib:write", { code: game.code, playerId, fib }, (err, result) => {
      setBusy(false);
      if (err) return setError("Couldn’t reach the game. Try again.");
      if (!result?.ok) return setError(result?.error || "That didn’t go through. Try again.");
      writeMine(game, result.fib);
      setFib("");
    });
  };
  return (
    <form className="final-form sv-guess fib-form" onSubmit={send}>
      <div className="sv-guess-top">
        <span className="sv-guess-label">{removed ? "The host threw out your fib. Write another one!" : "Write a fake answer that sounds true"}</span>
        <ClueTimer deadline={round.deadline} serverNow={game.serverNow} />
      </div>
      <input autoFocus aria-label="Your fib" autoComplete="off" autoCapitalize="sentences" enterKeyHint="send" maxLength={MAX_FIB_LENGTH} value={fib} onChange={(e) => setFib(e.target.value)} placeholder="Your fib" disabled={busy} />
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary" disabled={!fib.trim() || busy}>{busy ? "Sending…" : "Lock in my fib"}</button>
    </form>
  );
}

function VoteList({ game, playerId }) {
  const round = game.round, mine = readMine(game), vote = (optionId) => socket.emit("fib:vote", { code: game.code, playerId, optionId });
  if (round.voted.includes(playerId)) return <p className="player-status">Vote locked in. Eyes on the TV!</p>;
  return (
    <div className="fib-vote">
      <div className="sv-guess-top">
        <span className="sv-guess-label">Which one is the fact?</span>
        <ClueTimer deadline={round.deadline} serverNow={game.serverNow} />
      </div>
      <ul>
        {round.options.map((option) => {
          const own = mine && option.text === mine;
          return (
            <li key={option.id}>
              <button disabled={own} onClick={() => vote(option.id)}>{option.text}{own && <small>Your fib</small>}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// How this clue went for this player, once the scores are up.
function MyResult({ game, playerId }) {
  const award = game.round.awards?.[playerId], place = ranked(game).findIndex((player) => player.id === playerId) + 1;
  const lines = [];
  if (award?.fact) lines.push(`You found the fact: +${points(award.fact)}`);
  if (award?.fooledIds?.length) lines.push(`Your fib fooled ${names(game, award.fooledIds)}: +${points(award.fooled)}`);
  if (!lines.length) lines.push("No points this time.");
  return (
    <div className="fib-my-result">
      {lines.map((line) => <p key={line} className="player-status">{line}</p>)}
      <p className="muted">You’re in {ordinal(place)} place.</p>
    </div>
  );
}

function PlayerAction({ game, playerId }) {
  const round = game.round;
  switch (round.phase) {
    case "pick":
      if (round.chooserId === playerId)
        return (
          <div className="fib-pick">
            <div className="sv-guess-top">
              <span className="sv-guess-label">Your pick! Choose a category</span>
              <ClueTimer deadline={round.deadline} serverNow={game.serverNow} />
            </div>
            {round.categories.map((category, choice) => (
              <button key={choice} className="fib-pick-btn" onClick={() => socket.emit("fib:pick", { code: game.code, playerId, choice })}>{category}</button>
            ))}
          </div>
        );
      return <p className="player-status">{nameOf(game, round.chooserId)} is picking a category…</p>;
    case "write": return <><ClueCard clue={round.clue} /><FibForm key={round.removed.includes(playerId) ? "again" : "first"} game={game} playerId={playerId} /></>;
    case "vote": return <><ClueCard clue={round.clue} small /><VoteList game={game} playerId={playerId} /></>;
    case "reveal": return <p className="player-status">Eyes on the TV!</p>;
    case "scores": return <MyResult game={game} playerId={playerId} />;
    default: return null;
  }
}

export function FibPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), round = game.round;
  const myTurn = round && ((round.phase === "pick" && round.chooserId === playerId) || (round.phase === "write" && !round.submitted.includes(playerId)) || (round.phase === "vote" && !round.voted.includes(playerId)));
  useEffect(() => { if (myTurn) { try { navigator.vibrate?.(120); } catch {} } }, [myTurn, round?.phase]);
  if (!player) return <main className="player fib"><p className="status-card">You’re no longer in this game.</p></main>;
  return (
    <main className="player fib">
      <header className="player-bar">
        <span className="brand fib-brand">FIB OR FACT</span>
        <span className="player-name">{player.name}</span>
      </header>
      <div className="fib-my-score"><span>Your score</span><b className="money">{points(player.score)}</b></div>
      {game.status === "lobby" || !round ? <p className="player-status">You’re in! The game starts when everyone’s here.</p> : (
        <>
          <p className="player-clue-meta">{roundLabel(game)}{MULTIPLIER_NAME[game.multiplier] ? ` · ${MULTIPLIER_NAME[game.multiplier]}` : ""}</p>
          <PlayerAction game={game} playerId={playerId} />
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
export function FibController({ game, onAction }) {
  const round = game.round, secret = useSecret(game);
  const header = (
    <header className="controller-bar">
      <span className="brand fib-brand">FIB OR FACT</span>
      <span className="code-chip">{game.code}</span>
    </header>
  );
  if (game.status === "lobby" || !round)
    return (
      <main className="controller fib">
        {header}
        <h1>Lobby</h1>
        <p className="muted">Start the game from the main screen once at least two players have joined.</p>
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
    );
  const { title, detail } = phaseText(game);
  const nextLabel = { pick: "Pick for them at random", write: "End writing now", vote: "End voting now", reveal: "Next reveal", scores: isLast(game) ? "See final scores" : "Next clue" }[round.phase];
  return (
    <main className="controller fib">
      {header}
      <p className="player-clue-meta">{roundLabel(game)}{MULTIPLIER_NAME[game.multiplier] ? ` · ${MULTIPLIER_NAME[game.multiplier]}` : ""}</p>
      <div className="sv-ctrl-status" role="status"><b>{title}</b>{detail && <span>{detail}</span>}</div>
      {round.phase === "pick" && (
        <div className="judgement">
          <h2>Pick for {nameOf(game, round.chooserId)}</h2>
          <div className="fib-pick">{round.categories.map((category, choice) => <button key={choice} className="fib-pick-btn" onClick={() => onAction("pick", { choice })}>{category}</button>)}</div>
        </div>
      )}
      {round.clue && (
        <>
          <ClueCard clue={round.clue} />
          <div className="controller-answer"><span>The fact</span>{secret?.fact || "…"}</div>
          <p className="muted fib-ctrl-hint">Read the clue out loud while everyone writes.</p>
        </>
      )}
      {["write", "vote"].includes(round.phase) && (
        <section className="fib-ctrl-fibs">
          <h2>Fibs so far</h2>
          <ul>
            {(secret?.fibs || []).map(({ playerId, text }) => (
              <li key={playerId}><q>{text}</q><span>{nameOf(game, playerId)}</span><button className="chip-btn danger" onClick={() => onAction("removeFib", { playerId })}>Throw out</button></li>
            ))}
            {!secret?.fibs?.length && <li className="muted">None yet</li>}
          </ul>
        </section>
      )}
      {round.phase === "scores" && <ClueScores game={game} />}
      <button className="wide on" onClick={() => onAction("next")}>{nextLabel}</button>
      <ClueControls game={game} onAction={onAction} />
      <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
// display: this is the TV screen (not the host controller or a phone), which is the one that plays the tune.
export function FibEnd({ game, host, display, onAction }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const standings = ranked(game), top = standings.slice(0, 3), rest = standings.slice(3);
  const tie = standings.length > 1 && standings[0].score === standings[1].score;
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  const playAgain = () => {
    setBusy(true); setError("");
    loadPool().then((pool) => {
      const prompts = dealPrompts(game.clueCount, pool.clues);
      rememberPlayed(prompts.flatMap((prompt) => prompt.choices.map((clue) => clue.id)));
      onAction("replay", { prompts: toConfig(prompts) });
    }, (e) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <main className="end fib">
      {display && <SoundToggle />}
      <div className="brand fib-brand">FIB OR FACT</div>
      <h1>{!standings.length ? "Game over" : tie ? "It’s a tie!" : `${standings[0].name} wins!`}</h1>
      <div className="podium">{top.map((p, i) => <div className={`place place-${i + 1}`} key={p.id}><span className="rank">{i + 1}</span><b>{p.name}</b><strong className="money">{points(p.score)}</strong></div>)}</div>
      {rest.length > 0 && <ol className="remaining-players" start="4">{rest.map((p) => <li key={p.id}><span>{p.name}</span><b className="money">{points(p.score)}</b></li>)}</ol>}
      {host ? (
        <div className="sv-end-buttons">
          <button className="primary" disabled={busy} onClick={playAgain}>{busy ? "Dealing clues…" : "Play again with new clues"}</button>
          {error && <p className="notice" role="alert">{error}</p>}
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
