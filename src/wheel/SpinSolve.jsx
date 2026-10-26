// Spin & Solve screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
import React, { useEffect, useRef, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner } from "../JoinQR";
import { BackToHub } from "../Hub";
import PUZZLES from "./puzzles.json";
import "./wheel.css";

// ---------- Picking puzzles ----------
const PLAYED_KEY = "gameNight.wheel.played.v1";
const ROUND_CHOICES = [3, 4, 5];
const puzzleId = (text) => text.trim().replace(/\s+/g, " ").toUpperCase();
const MAIN = Object.entries(PUZZLES.main).flatMap(([category, list]) => list.map((text) => ({ id: puzzleId(text), category, text })));
const readPlayed = () => { try { return JSON.parse(localStorage.getItem(PLAYED_KEY)) || []; } catch { return []; } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-600))); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

// Puzzles this browser hasn't played come first, and a game avoids repeating a category while it can.
export function pickPuzzles(count, keep = []) {
  const played = new Set(readPlayed()), skip = new Set(keep.map((puzzle) => puzzle.id));
  let pool = MAIN.filter((puzzle) => !played.has(puzzle.id) && !skip.has(puzzle.id));
  if (pool.length < count) pool = MAIN.filter((puzzle) => !skip.has(puzzle.id));
  pool = shuffle(pool);
  const picks = [], categories = new Set(keep.map((puzzle) => puzzle.category));
  for (const puzzle of pool) if (picks.length < count && !categories.has(puzzle.category)) { picks.push(puzzle); categories.add(puzzle.category); }
  for (const puzzle of pool) if (picks.length < count && !picks.includes(puzzle)) picks.push(puzzle);
  return picks;
}

// ---------- Small helpers ----------
const CONSONANTS = "BCDFGHJKLMNPQRSTVWXYZ", VOWELS = "AEIOU";
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const money = (value) => `$${(value || 0).toLocaleString()}`;
const nameOf = (game, contestant) => game.contestants[contestant]?.name || "Nobody";
const colorOf = (contestant) => `c-${contestant % 6}`;
const myContestant = (game, playerId) => game.players.find((player) => player.id === playerId)?.contestant;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const segmentLabel = (game) => `Round ${game.segment.index + 1} of ${game.segment.count}`;
const plural = (count, letter) => (count === 1 ? `one ${letter}` : `${count} ${letter}’s`);

// What the round is waiting for, as a headline and a line of detail.
function phaseText(game) {
  const round = game.round, who = nameOf(game, round.control);
  switch (round.phase) {
    case "turn":
      if (round.control == null) return { title: "Waiting for players", detail: "Nobody’s phone is connected" };
      return { title: `${who}’s turn`, detail: round.consonantsLeft ? "Spin, buy a vowel or solve" : "Only vowels left: buy a vowel or solve" };
    case "spinning":
      return { title: `${who} is spinning…`, detail: "" };
    case "consonant":
      return { title: `${who} landed on ${money(round.value)}`, detail: "Call a consonant" };
    case "solving":
      return { title: `${who} is solving…`, detail: game.hostless ? "Filling in the blanks" : "Say it out loud, or fill in the blanks" };
    case "roundEnd":
      return round.winner == null ? { title: "Nobody solved it", detail: "No money banked this round" } : { title: `${nameOf(game, round.winner)} solved it!`, detail: `Banks ${money(round.awarded)}` };
    default:
      return { title: "", detail: "" };
  }
}

// The latest thing that happened this round, in words ("There are 3 L’s!").
const NEWS = ["hit", "miss", "land", "timeout", "wrongSolve", "skipped"];
function latestNews(game) {
  const events = game.events || [], since = events.findLastIndex((e) => e.type === "round");
  const e = events.slice(since + 1).findLast((item) => NEWS.includes(item.type));
  if (!e) return null;
  const who = nameOf(game, e.contestant);
  switch (e.type) {
    case "hit": return { tone: "good", text: e.vowel ? `There ${e.count === 1 ? "is" : "are"} ${plural(e.count, e.letter)}` : `There ${e.count === 1 ? "is" : "are"} ${plural(e.count, e.letter)}! +${money(e.amount)}` };
    case "miss": return { tone: "bad", text: `No ${e.letter}` };
    case "land": return e.kind === "bankrupt" ? { tone: "bad", text: `${who} went bankrupt` } : e.kind === "loseTurn" ? { tone: "bad", text: `${who} lost a turn` } : null;
    case "timeout": return { tone: "bad", text: `${who} ran out of time` };
    case "wrongSolve": return { tone: "bad", text: e.text ? `“${e.text}” isn’t it` : `${who} didn’t get it` };
    case "skipped": return { tone: "bad", text: `${who}’s turn was skipped` };
    default: return null;
  }
}

// Calls onEvent once for each new event, in order (not for events already there when the screen opened).
function useNewEvents(game, onEvent) {
  const seen = useRef(null);
  const latest = game.events?.at(-1)?.id || 0;
  useEffect(() => {
    if (seen.current == null || latest < seen.current) { seen.current = latest; return; }
    for (const e of game.events || []) if (e.id > seen.current) onEvent(e);
    seen.current = latest;
  }, [latest]);
}

// The answer for host controllers. It can arrive straight after the controller connects, before this
// screen is drawn, so it's caught here when the module loads rather than in a component.
let lastSolution = null;
const solutionListeners = new Set();
socket.on("wheel:solution", (solution) => { lastSolution = solution; solutionListeners.forEach((listener) => listener(solution)); });
function useSolution(code) {
  const [solution, setSolution] = useState(lastSolution);
  useEffect(() => { solutionListeners.add(setSolution); return () => solutionListeners.delete(setSolution); }, []);
  return solution?.code === code ? solution : null;
}

// ---------- Setup ----------
export function WheelSetup({ onCreate }) {
  const [rounds, setRounds] = useState(4),
    [picks, setPicks] = useState(() => pickPuzzles(4)),
    [hostless, setHostless] = useState(false),
    [relaxed, setRelaxed] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const changeRounds = (count) => {
    setRounds(count);
    setPicks((list) => (count <= list.length ? list.slice(0, count) : [...list, ...pickPuzzles(count - list.length, list)]));
  };
  const swap = (index) => setPicks((list) => list.map((puzzle, i) => (i === index ? pickPuzzles(1, list)[0] || puzzle : puzzle)));
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed(picks.map((puzzle) => puzzle.id));
    onCreate(
      { game: "wheel", puzzles: picks.map(({ category, text }) => ({ category, text })), hostless, pace: relaxed ? "relaxed" : "show" },
      (error) => { setBusy(false); setNotice(error); },
    );
  };
  return (
    <main className="setup ws-setup">
      <BackToHub />
      <div className="brand ws-brand">SPIN &amp; SOLVE <span>game night</span></div>
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Spin &amp; Solve</h1>
            <p className="muted">Spin the wheel, call letters and solve the puzzle. 2 to 6 players, each on their own phone. Pick how many rounds and swap out any puzzle you don’t like.</p>
          </div>
        </div>
        <fieldset className="ws-fieldset">
          <legend>Rounds</legend>
          <div className="ws-rounds" role="radiogroup" aria-label="Number of rounds">
            {ROUND_CHOICES.map((count) => <button key={count} role="radio" aria-checked={rounds === count} onClick={() => changeRounds(count)}>{count}</button>)}
          </div>
          <p className="muted ws-hint">The top wedge is worth $2,500 in round 1, $3,500 in rounds 2 and 3, and $5,000 after that. Most money after the last round wins.</p>
        </fieldset>
        <div className="ws-puzzles-head">
          <h2>Puzzles</h2>
          <button className="chip-btn" onClick={() => setPicks(pickPuzzles(rounds))}>New set</button>
        </div>
        <ol className="ws-puzzle-list">
          {picks.map((puzzle, i) => (
            <li key={puzzle.id}>
              <span className="ws-p-round">Round {i + 1}</span>
              <span className="ws-p-category">{puzzle.category}</span>
              <span className="ws-p-size muted">{puzzle.text.split(" ").length} {puzzle.text.split(" ").length === 1 ? "word" : "words"}</span>
              <button className="chip-btn" aria-label={`Swap the round ${i + 1} puzzle`} onClick={() => swap(i)}>Swap</button>
            </li>
          ))}
        </ol>
        <p className="muted ws-hint">Puzzles stay hidden here so you can play too. {MAIN.length.toLocaleString()} puzzles in the pack; ones this browser has played are saved for last.</p>
        <section className="game-options" aria-labelledby="ws-options-title">
          <h2 id="ws-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>Players solve by filling in the blanks on their phone, and the game checks them. With a host, players can also say the answer out loud and the host judges it from the host controller, which shows the answer.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={relaxed} onChange={(e) => setRelaxed(e.target.checked)} />
            <span><b>Relaxed pace</b><small>Twice as long to decide, call a letter and solve: 20 seconds, 20 seconds and 40 seconds instead of 10, 10 and 20.</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{rounds} rounds</p>
          <button className="primary" disabled={busy} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- The puzzle board ----------
const exists = (row, column) => !((row === 0 || row === 3) && (column === 0 || column === 13));
// fill: letters typed into the blanks on the solve screen, in reading order. Letters that have just been
// turned show a lit-up tile first, one after another, like the show's letter turner.
function PuzzleBoard({ board, small = false, fill = null, cursor = -1, onPick }) {
  const turned = useRef({ key: null, cells: new Map() });
  const flat = board.flat(), now = Date.now();
  const key = board.map((row) => row.map((cell) => (cell ? 1 : 0)).join("")).join("|");
  if (turned.current.key !== key) turned.current = { key, cells: new Map(), seen: flat.map((cell) => cell?.ch || "") };
  const { cells, seen } = turned.current;
  const fresh = flat.map((cell, i) => (cell?.letter && cell.ch && !seen[i] ? i : -1)).filter((i) => i >= 0);
  const step = fresh.length ? Math.min(350, 2400 / fresh.length) : 0;
  fresh.forEach((index, order) => cells.set(index, { at: now, delay: order * step }));
  turned.current.seen = flat.map((cell) => cell?.ch || "");
  let blank = -1;
  return (
    <div className={`wb-board${small ? " is-small" : ""}`} role="img" aria-label={boardLabel(board)}>
      {board.map((row, r) => row.map((cell, c) => {
        const index = r * 14 + c;
        if (!exists(r, c)) return <span key={index} className="wb-cell is-void" />;
        if (!cell) return <span key={index} className="wb-cell is-empty" />;
        if (cell.letter && !cell.ch) {
          blank++;
          const mine = blank, typed = fill?.[mine];
          const className = `wb-cell is-blank${typed ? " is-typed" : ""}${mine === cursor ? " is-cursor" : ""}`;
          return onPick ? <button key={index} className={className} onClick={() => onPick(mine)} aria-label={`Blank ${mine + 1}${typed ? `: ${typed}` : ""}`}>{typed}</button>
            : <span key={index} className={className}>{typed}</span>;
        }
        const turn = cells.get(index), turning = turn && now - turn.at < turn.delay + 1600;
        return <span key={index} className={`wb-cell is-shown${turning ? " is-turning" : ""}`} style={turning ? { animationDelay: `${turn.delay}ms` } : undefined}>{cell.ch}</span>;
      }))}
    </div>
  );
}
// Read out word by word, with a dash for each letter still hidden: "Puzzle: F I S H, T – – –".
function boardLabel(board) {
  const words = board.flatMap((row) => row.map((cell) => (cell ? (cell.ch || "–") : " ")).join("").trim().split(/\s+/)).filter(Boolean);
  return `Puzzle: ${words.map((word) => [...word].join(" ")).join(", ")}`;
}

// The letters called so far: dim if they were in the puzzle, struck through if not.
function UsedLetters({ round }) {
  return (
    <div className="ws-used" aria-label="Letters called">
      {[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => {
        const called = round.called.includes(letter), miss = round.misses.includes(letter);
        return <span key={letter} className={`${VOWELS.includes(letter) ? "is-vowel" : ""}${called ? (miss ? " is-miss" : " is-hit") : ""}`}>{letter}</span>;
      })}
    </div>
  );
}

// ---------- The wheel ----------
const WEDGE_COLORS = ["#e8434f", "#ffb627", "#3d7bff", "#2fbf71", "#a970ff", "#ff7a2f", "#ff5fa8", "#20c3d0"];
const LIGHT_WEDGES = new Set(["#ffb627", "#20c3d0", "#2fbf71"]);
const wedgeLabel = (wedge) => (wedge.kind === "bankrupt" ? "BANKRUPT" : wedge.kind === "loseTurn" ? "LOSE A TURN" : money(wedge.value).replace(",", ""));
const point = (angle, radius) => [radius * Math.sin((angle * Math.PI) / 180), -radius * Math.cos((angle * Math.PI) / 180)];
// Wedge i is centred i × (360 / wedges) degrees clockwise from the pointer at the top, and each wedge is
// split into three slots. The server picks a slot and a spot inside it; the wheel turns so that spot ends
// up under the pointer, after a few full turns that depend on how hard the player spun.
function slotAngle(spin, wedges) {
  const slot = 360 / (wedges * 3);
  return (spin.slot + 0.5 + spin.jitter) * slot - 180 / wedges;
}
function Wheel({ wheel, spin, spinKey }) {
  const wedges = wheel.length, size = 360 / wedges;
  const rotation = useRef(spin ? -slotAngle(spin, wedges) : 0), seen = useRef(spin ? spinKey : null);
  const [view, setView] = useState({ angle: rotation.current, ms: 0 });
  useEffect(() => {
    if (!spin || spinKey === seen.current) return;
    seen.current = spinKey;
    const current = rotation.current, target = -slotAngle(spin, wedges);
    const next = current + (3 + Math.round(spin.power * 3)) * 360 + ((((target - current) % 360) + 360) % 360);
    rotation.current = next;
    setView({ angle: next, ms: Math.max(1000, spin.ms - 250) });
  }, [spinKey]);
  return (
    <div className="ws-wheel">
      <svg viewBox="-110 -116 220 228" aria-hidden="true">
        <g style={{ transform: `rotate(${view.angle}deg)`, transition: view.ms ? `transform ${view.ms}ms cubic-bezier(0.12, 0.6, 0.1, 1)` : "none" }}>
          <circle r="104" fill="#11183f" />
          {wheel.map((wedge, i) => {
            const center = i * size, [x1, y1] = point(center - size / 2, 100), [x2, y2] = point(center + size / 2, 100);
            const fill = wedge.kind === "bankrupt" ? "#101014" : wedge.kind === "loseTurn" ? "#f4f4f4" : wedge.top ? "#dfe3ee" : WEDGE_COLORS[i % WEDGE_COLORS.length];
            const dark = wedge.kind === "loseTurn" || wedge.top || LIGHT_WEDGES.has(fill);
            const label = wedgeLabel(wedge);
            return (
              <g key={i}>
                <path d={`M0 0 L${x1} ${y1} A100 100 0 0 1 ${x2} ${y2} Z`} fill={fill} stroke="#0b1030" strokeWidth="0.8" />
                <g transform={`rotate(${center - 90})`}>
                  <text x="62" y="0" className="ws-wedge-text" fill={dark ? "#141833" : "#fff"} fontSize={label.length > 5 ? 6.2 : 9} dominantBaseline="middle" textAnchor="middle">{label}</text>
                </g>
                <circle cx={point(center - size / 2, 96)[0]} cy={point(center - size / 2, 96)[1]} r="1.6" fill="#f6f2e3" />
              </g>
            );
          })}
          <circle r="16" fill="#0b1030" stroke="#f6f2e3" strokeWidth="1.5" />
        </g>
        <path d="M0 -98 L-7 -114 L7 -114 Z" fill="#f6f2e3" stroke="#0b1030" strokeWidth="1.2" />
      </svg>
    </div>
  );
}

// A big word across the wheel when it stops on something bad, or the value when it's money.
function LandingFlash({ game }) {
  const [flash, setFlash] = useState(null);
  useNewEvents(game, (e) => { if (e.type === "land") setFlash({ ...e }); });
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);
  if (!flash) return null;
  const text = flash.kind === "bankrupt" ? "BANKRUPT" : flash.kind === "loseTurn" ? "LOSE A TURN" : money(flash.value);
  return <div className={`ws-flash is-${flash.kind}`} key={flash.id} aria-hidden="true">{text}</div>;
}

// ---------- Podiums ----------
function Podiums({ game }) {
  const round = game.round;
  return (
    <ol className="ws-podiums">
      {game.contestants.map((contestant, i) => {
        const control = round && round.control === i && round.phase !== "roundEnd";
        return (
          <li key={i} className={`ws-podium ${colorOf(i)}${control ? " is-control" : ""}${contestant.present ? "" : " is-away"}${round?.winner === i && round.phase === "roundEnd" ? " is-winner" : ""}`}>
            <span className="ws-podium-name">{contestant.name}{!contestant.present && <small> · away</small>}</span>
            <b className="ws-podium-bank money">{money(contestant.roundBank)}</b>
            <span className="ws-podium-total">Total <b className="money">{money(contestant.total)}</b></span>
          </li>
        );
      })}
    </ol>
  );
}

function Clock({ game }) {
  const round = game.round;
  if (!round || !["turn", "consonant", "solving"].includes(round.phase)) return <span />;
  if (round.pausedMs != null) return <ClueTimer frozenMs={round.pausedMs} />;
  return <ClueTimer deadline={round.deadline} serverNow={game.serverNow} />;
}

// ---------- Host tools (TV without a host, and the host controller) ----------
function RoundTools({ game, onAction }) {
  const round = game.round, waiting = ["turn", "consonant", "solving"].includes(round.phase);
  const last = game.segment.index >= game.segment.count - 1;
  return (
    <div className="ws-round-tools">
      {game.clocksPaused
        ? <button className="chip-btn" onClick={() => onAction("resume")}>Resume clocks</button>
        : <button className="chip-btn" onClick={() => onAction("pause")}>Pause clocks</button>}
      <button className="chip-btn" disabled={!waiting} onClick={() => onAction("skipTurn")}>Skip turn</button>
      {round.phase !== "roundEnd" && <button className="chip-btn" onClick={() => onAction("revealPuzzle")}>Reveal puzzle (nobody wins)</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>{last ? "End game" : "End game early"}</button>
    </div>
  );
}
function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("500");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="ws-player-tools">
      {game.status !== "lobby" && <label className="inline-field">Adjust totals by <input aria-label="Score adjustment amount" type="number" min="1" step="50" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            {game.status !== "lobby" && <>
              <span className="money">{money(game.contestants[player.contestant]?.total)}</span>
              <button className="chip-btn add" onClick={() => onAction("adjustScore", { contestant: player.contestant, amount: step })}>+{step}</button>
              <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { contestant: player.contestant, amount: -step })}>−{step}</button>
            </>}
            <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Kick</button>
          </li>
        ))}
        {!game.players.length && <li className="muted">No players yet</li>}
      </ul>
    </div>
  );
}

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const ready = game.contestants.some((contestant) => contestant.present);
  return (
    <div className="lobby ws-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <ol className="ws-lobby-players">
        {game.contestants.map((contestant, i) => <li key={i} className={colorOf(i)}>{contestant.name}</li>)}
        {!game.contestants.length && <li className="muted">Nobody yet</li>}
      </ol>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      <p className="muted">{game.contestants.length < 2 ? "2 to 6 players. The show has 3." : `${game.contestants.length} players. Player 1 spins first.`}</p>
    </div>
  );
}

export function WheelDisplay({ game, onAction }) {
  const round = game.round, news = round && latestNews(game);
  const { title, detail } = round ? phaseText(game) : {};
  const last = game.segment.index >= game.segment.count - 1;
  return (
    <main className="display wheel-game">
      <header className="display-bar">
        <div className="brand ws-brand">SPIN &amp; SOLVE</div>
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        <Clock game={game} />
      </header>
      {game.status === "lobby" || !round ? (
        <Lobby game={game} onAction={onAction} />
      ) : (
        <div className="ws-stage">
          <div className="ws-wheel-wrap">
            <Wheel wheel={round.wheel} spin={round.spin} spinKey={round.spin ? `${game.segment.index}-${round.spin.id}` : null} />
            <LandingFlash game={game} />
          </div>
          <div className="ws-main">
            <div className="ws-board-wrap">
              <PuzzleBoard board={round.board} />
              <p className="ws-category"><span>{segmentLabel(game)}</span>{round.category}</p>
            </div>
            <div className="ws-status" role="status">
              <h2>{title}</h2>
              {detail && <p>{detail}</p>}
              {news && round.phase !== "roundEnd" && <p className={`ws-news is-${news.tone}`} key={game.events.at(-1)?.id}>{news.text}</p>}
              {game.clocksPaused && round.phase !== "roundEnd" && <p className="ws-paused">Clocks paused</p>}
              <UsedLetters round={round} />
              {round.phase === "roundEnd" && <button className="primary ws-next" onClick={() => onAction("nextSegment")}>{last ? "See final scores" : "Next puzzle"}</button>}
              {round.phase === "roundEnd" && game.hostless && <p className="muted">{last ? "Final scores" : "The next puzzle"} will appear in a few seconds.</p>}
            </div>
          </div>
          <Podiums game={game} />
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools ws-host-tools">
          <summary>Host tools</summary>
          {round && game.status === "playing" && <RoundTools game={game} onAction={onAction} />}
          <PlayerTools game={game} onAction={onAction} />
        </details>
      )}
      {!game.hostless && (
        <a className="controller-link" href="?controller" onClick={(event) => { event.preventDefault(); sessionStorage.hostCode = game.code; window.open("?controller", "_blank"); }}>
          Open host controller
        </a>
      )}
    </main>
  );
}

// ---------- Player phone ----------
function Keyboard({ allowed, used = "", onKey, extra }) {
  return (
    <div className="ws-keyboard">
      {KEY_ROWS.map((row) => (
        <div className="ws-key-row" key={row}>
          {[...row].map((letter) => {
            const off = !allowed.includes(letter) || used.includes(letter);
            return <button key={letter} className={off ? "is-off" : ""} disabled={off} onClick={() => onKey(letter)} aria-label={off && used.includes(letter) ? `${letter}, already called` : letter}>{letter}</button>;
          })}
        </div>
      ))}
      {extra}
    </div>
  );
}

// Fill in the blanks: typing (on the phone's keys or a real keyboard) fills them left to right; tap a blank to jump to it.
function SolveBox({ game, playerId }) {
  const round = game.round, count = round.blanks;
  const [state, setState] = useState({ letters: Array(count).fill(""), cursor: 0 }), [sent, setSent] = useState(false);
  const type = (letter) => setState(({ letters, cursor }) => {
    const next = [...letters]; next[cursor] = letter;
    const empty = next.findIndex((value, i) => i > cursor && !value);
    return { letters: next, cursor: empty >= 0 ? empty : Math.min(count - 1, cursor + 1) };
  });
  const back = () => setState(({ letters, cursor }) => {
    const next = [...letters];
    if (next[cursor]) { next[cursor] = ""; return { letters: next, cursor }; }
    const to = Math.max(0, cursor - 1); next[to] = "";
    return { letters: next, cursor: to };
  });
  const full = state.letters.every(Boolean);
  const submit = () => {
    if (!full || sent) return;
    setSent(true);
    socket.emit("wheel:solve", { code: game.code, playerId, guess: state.letters.join("") });
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[a-z]$/i.test(event.key)) { event.preventDefault(); type(event.key.toUpperCase()); }
      else if (event.key === "Backspace") { event.preventDefault(); back(); }
      else if (event.key === "Enter") submit();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <div className="ws-solve">
      <div className="ws-solve-top"><b>Fill in the blanks</b><Clock game={game} /></div>
      {!game.hostless && <p className="muted">Or say it out loud for the host.</p>}
      <PuzzleBoard board={round.board} small fill={state.letters} cursor={state.cursor} onPick={(i) => setState((s) => ({ ...s, cursor: i }))} />
      <Keyboard allowed={CONSONANTS + VOWELS} onKey={type} extra={
        <div className="ws-key-row ws-key-actions">
          <button onClick={back} aria-label="Delete">⌫</button>
          <button className="primary" disabled={!full || sent} onClick={submit}>{sent ? "Checking…" : full ? "Solve!" : `${state.letters.filter((l) => !l).length} blanks left`}</button>
        </div>
      } />
    </div>
  );
}

// Hold to spin harder: the longer the press (up to about a second), the more the wheel turns.
function SpinButton({ game, playerId, disabled }) {
  const pressed = useRef(null), [sent, setSent] = useState(false);
  const release = () => {
    if (pressed.current == null || sent) return;
    const power = Math.min(1, 0.3 + (Date.now() - pressed.current) / 1100);
    pressed.current = null; setSent(true);
    socket.emit("wheel:spin", { code: game.code, playerId, power });
  };
  return (
    <button className="ws-spin" disabled={disabled || sent} onPointerDown={() => { pressed.current = Date.now(); }} onPointerUp={release} onPointerLeave={release}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && pressed.current == null) pressed.current = Date.now(); }} onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") release(); }}>
      SPIN
      <small>{disabled ? "No consonants left" : "Hold to spin harder"}</small>
    </button>
  );
}

function TurnActions({ game, playerId }) {
  const round = game.round, me = game.contestants[round.control];
  const [buying, setBuying] = useState(false), [sent, setSent] = useState(false);
  const canBuy = round.vowelsLeft && me.roundBank >= game.vowelCost;
  const emit = (name, extra = {}) => { setSent(true); socket.emit(`wheel:${name}`, { code: game.code, playerId, ...extra }); };
  if (buying)
    return (
      <div className="ws-buy">
        <p className="player-status is-you">Buy a vowel for {money(game.vowelCost)}</p>
        <div className="ws-vowels">
          {[...VOWELS].map((letter) => <button key={letter} disabled={sent || round.called.includes(letter)} onClick={() => emit("buyVowel", { letter })}>{letter}</button>)}
        </div>
        <button className="secondary ws-cancel" onClick={() => setBuying(false)}>Back</button>
      </div>
    );
  return (
    <div className="ws-turn">
      <SpinButton game={game} playerId={playerId} disabled={!round.consonantsLeft} />
      <div className="ws-turn-row">
        <button className="secondary" disabled={!canBuy || sent} onClick={() => setBuying(true)}>
          Buy a vowel <small>{!round.vowelsLeft ? "None left" : !canBuy ? `Needs ${money(game.vowelCost)}` : money(game.vowelCost)}</small>
        </button>
        <button className="primary" disabled={sent} onClick={() => emit("solveStart")}>Solve</button>
      </div>
    </div>
  );
}

function PlayerAction({ game, playerId }) {
  const round = game.round, mine = round.actorId === playerId;
  const status = (text, you = false) => <p className={"player-status" + (you ? " is-you" : "")}>{text}</p>;
  // Each turn's controls start fresh, so a button pressed last turn isn't still "sent".
  const turnKey = `${game.segment.index}-${game.events?.at(-1)?.id}`;
  if (round.phase === "roundEnd") { const { title, detail } = phaseText(game); return <>{status(title, round.winner === myContestant(game, playerId))}<p className="muted">{detail}</p></>; }
  if (!mine) { const { title, detail } = phaseText(game); return <>{status(title)}{detail && <p className="muted">{detail}</p>}</>; }
  switch (round.phase) {
    case "turn":
      return <>{status("Your turn!", true)}<Clock game={game} /><TurnActions key={turnKey} game={game} playerId={playerId} /></>;
    case "spinning":
      return status("Spinning… watch the wheel!", true);
    case "consonant":
      return (
        <>
          {status(`${money(round.value)} — call a consonant`, true)}
          <Clock game={game} />
          <ConsonantPicker key={turnKey} game={game} playerId={playerId} />
        </>
      );
    case "solving":
      return <SolveBox key={turnKey} game={game} playerId={playerId} />;
    default:
      return null;
  }
}
function ConsonantPicker({ game, playerId }) {
  const [sent, setSent] = useState(false);
  return <Keyboard allowed={sent ? "" : CONSONANTS} used={game.round.called.join("")} onKey={(letter) => { setSent(true); socket.emit("wheel:consonant", { code: game.code, playerId, letter }); }} />;
}

export function WheelPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), round = game.round;
  const myTurn = !!round && round.actorId === playerId && round.phase === "turn";
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) { try { navigator.vibrate?.(120); } catch {} }
    wasMyTurn.current = myTurn;
  }, [myTurn]);
  if (!player) return <main className="player wheel-game"><p className="status-card">You’re no longer in this game.</p></main>;
  const me = game.contestants[player.contestant], news = round && latestNews(game);
  return (
    <main className="player wheel-game">
      <header className="player-bar">
        <span className="brand ws-brand">SPIN &amp; SOLVE</span>
        <span className="player-name">{player.name}</span>
      </header>
      <div className={`ws-my-podium ${colorOf(player.contestant)}`}>
        <span>This round <b className="money">{money(me?.roundBank)}</b></span>
        <span>Total <b className="money">{money(me?.total)}</b></span>
      </div>
      {game.status === "lobby" || !round ? (
        <p className="player-status">You’re in! Wait for the game to start.</p>
      ) : (
        <>
          <p className="player-clue-meta">{segmentLabel(game)} · {round.category}</p>
          {round.phase !== "solving" || round.actorId !== playerId ? <PuzzleBoard board={round.board} small /> : null}
          {news && round.phase !== "roundEnd" && <p className={`ws-news is-${news.tone}`} key={game.events.at(-1)?.id}>{news.text}</p>}
          <PlayerAction game={game} playerId={playerId} />
          {round.phase !== "solving" && <UsedLetters round={round} />}
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
export function WheelController({ game, onAction }) {
  const round = game.round, solution = useSolution(game.code);
  const header = (
    <header className="controller-bar">
      <span className="brand ws-brand">SPIN &amp; SOLVE</span>
      <span className="code-chip">{game.code}</span>
    </header>
  );
  if (game.status === "lobby" || !round)
    return (
      <main className="controller wheel-game">
        {header}
        <h1>Lobby</h1>
        <p className="muted">Start the game from the main screen once everyone has joined.</p>
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
    );
  const { title, detail } = phaseText(game), news = latestNews(game);
  const last = game.segment.index >= game.segment.count - 1;
  const answer = round.solution || solution?.text;
  return (
    <main className="controller wheel-game">
      {header}
      <p className="player-clue-meta">{segmentLabel(game)} · {round.category}</p>
      <div className="ws-answer">
        <span>The answer</span>
        <b>{answer || "Waiting for the answer…"}</b>
      </div>
      <PuzzleBoard board={round.board} small />
      <div className="ws-ctrl-status" role="status"><b>{title}</b>{detail && <span>{detail}</span>}{news && round.phase !== "roundEnd" && <span className={`ws-news is-${news.tone}`}>{news.text}</span>}</div>
      <Clock game={game} />
      {round.phase === "solving" && (
        <div className="judgement">
          <h2>{nameOf(game, round.control)} is solving</h2>
          <p className="muted">If they say it out loud, judge it here. It has to be said exactly as written.</p>
          <div className="verdict">
            <button onClick={() => onAction("judgeSolve", { correct: true })}>Correct</button>
            <button onClick={() => onAction("judgeSolve", { correct: false })}>Wrong</button>
          </div>
        </div>
      )}
      {round.phase === "roundEnd" && <button className="wide on" onClick={() => onAction("nextSegment")}>{last ? "See final scores" : "Next puzzle"}</button>}
      <RoundTools game={game} onAction={onAction} />
      <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
export function WheelEnd({ game, host, onAction }) {
  const ranked = game.contestants.map((contestant, i) => ({ ...contestant, i })).sort((a, b) => b.total - a.total);
  const top = ranked[0]?.total ?? 0, winners = ranked.filter((c) => c.total === top);
  const playAgain = () => {
    const puzzles = pickPuzzles(game.segment.count);
    rememberPlayed(puzzles.map((puzzle) => puzzle.id));
    onAction("replay", { puzzles: puzzles.map(({ category, text }) => ({ category, text })) });
  };
  return (
    <main className="end wheel-game">
      <div className="brand ws-brand">SPIN &amp; SOLVE</div>
      <h1>{!ranked.length ? "Game over" : winners.length > 1 ? "It’s a tie!" : `${winners[0].name} wins!`}</h1>
      <ol className="ws-final">
        {ranked.map((contestant) => (
          <li key={contestant.i} className={`${colorOf(contestant.i)}${contestant.total === top ? " is-winner" : ""}`}>
            <span>{contestant.name}</span>
            <b className="money">{money(contestant.total)}</b>
          </li>
        ))}
      </ol>
      {host ? (
        <div className="ws-end-buttons">
          <button className="primary" onClick={playAgain}>Play again with new puzzles</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
