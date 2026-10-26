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
// The order of play. The show: two toss-ups, rounds 1 and 2, a $3,000 toss-up, round 3, then the final round.
const TOSSUP = (value) => ({ type: "tossup", value }), ROUND = { type: "round" };
const LENGTHS = [
  { id: "short", label: "Short", plan: [TOSSUP(1000), ROUND, ROUND, ROUND] },
  { id: "classic", label: "Classic", plan: [TOSSUP(1000), TOSSUP(2000), ROUND, ROUND, TOSSUP(3000), ROUND, ROUND] },
  { id: "custom", label: "Custom" },
];
function planFor(length, rounds, tossups) {
  const preset = LENGTHS.find((option) => option.id === length)?.plan;
  if (preset) return preset;
  const plan = tossups ? [TOSSUP(1000), TOSSUP(2000)] : [];
  for (let i = 0; i < rounds; i++) { if (tossups && i === 2) plan.push(TOSSUP(3000)); plan.push(ROUND); }
  return plan;
}
// "Toss-up · $2,000", "Round 2", "Final round" for each step of a plan.
function planLabels(plan) {
  const rounds = plan.filter((step) => step.type !== "tossup").length;
  let n = 0;
  return plan.map((step) => (step.type === "tossup" ? `Toss-up · ${money(step.value)}` : ++n === rounds ? "Final round" : `Round ${n}`));
}
const forServer = ({ category, text }) => ({ category, text });
const puzzleId = (text) => text.trim().replace(/\s+/g, " ").toUpperCase();
const poolOf = (groups) => Object.entries(groups).flatMap(([category, list]) => list.map((text) => ({ id: puzzleId(text), category, text })));
const MAIN = poolOf(PUZZLES.main), BONUS_POOL = poolOf(PUZZLES.bonus);
const readPlayed = () => { try { return JSON.parse(localStorage.getItem(PLAYED_KEY)) || []; } catch { return []; } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-600))); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

// Puzzles this browser hasn't played come first, and a game avoids repeating a category while it can.
export function pickPuzzles(count, keep = [], from = MAIN) {
  const played = new Set(readPlayed()), skip = new Set(keep.map((puzzle) => puzzle.id));
  let pool = from.filter((puzzle) => !played.has(puzzle.id) && !skip.has(puzzle.id));
  if (pool.length < count) pool = from.filter((puzzle) => !skip.has(puzzle.id));
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
const isTeams = (game) => game.mode === "teams";
// "Ann’s", but "Reds’" for a team name ending in s.
const possessive = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
const membersOf = (game, contestant) => game.players.filter((player) => player.contestant === contestant);
const playerName = (game, id) => game.players.find((player) => player.id === id)?.name || "";
// In a teams game, which teammate is up ("Sam is up. "), to go before what the turn is waiting for.
const teamActor = (game) => (isTeams(game) && game.round?.actorId ? `${playerName(game, game.round.actorId)} is up. ` : "");
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
function segmentLabel(game) {
  const { type, n, value, rounds } = game.segment;
  if (type === "tossup") return `Toss-up · ${money(value)}`;
  if (type === "tiebreak") return "Tiebreaker";
  if (type === "final") return "Final round";
  return `Round ${n} of ${rounds}`;
}
const SOLVE_PHASES = ["solving", "tossupSolve", "speedSolve"];
const CLOCK_PHASES = ["turn", "consonant", "solving", "tossupSolve", "finalSpin", "speedLetter", "speedSolve", "mystery", "expressChoice", "express"];
const namesList = (game, list) => list.map((i) => nameOf(game, i)).join(" and ");
const plural = (count, letter) => (count === 1 ? `one ${letter}` : `${count} ${letter}’s`);

// What the round is waiting for, as a headline and a line of detail.
function phaseText(game) {
  const round = game.round, who = nameOf(game, round.control);
  switch (round.phase) {
    case "turn":
      if (round.control == null) return { title: "Waiting for players", detail: "Nobody’s phone is connected" };
      return { title: `${possessive(who)} turn`, detail: teamActor(game) + (round.consonantsLeft ? "Spin, buy a vowel or solve" : "Only vowels left: buy a vowel or solve") };
    case "spinning":
      return { title: `${who} is spinning…`, detail: "" };
    case "consonant":
      return { title: `${who} landed on ${landedName(round)}`, detail: landedHint(round) };
    case "mystery":
      return { title: `${who}: take the money or flip?`, detail: `Keep ${money(round.landed?.value)} a letter, or turn the wedge over for ${money(10000)} or Bankrupt` };
    case "expressChoice":
      return { title: `${who}: play the Express?`, detail: "Keep calling letters at $1,000 each without spinning; any mistake is Bankrupt" };
    case "express":
      return { title: `${who} is on the Express!`, detail: `Consonants ${money(1000)} each, vowels ${money(game.vowelCost)}; any mistake is Bankrupt` };
    case "solving":
      return { title: `${who} is solving…`, detail: game.hostless ? "Filling in the blanks" : "Say it out loud, or fill in the blanks" };
    case "tossupReveal": {
      const eligible = round.tossup.eligible;
      return { title: round.type === "tiebreak" ? `Tiebreaker for ${money(round.tossup.value)}` : `Toss-up for ${money(round.tossup.value)}`, detail: eligible ? `Only ${namesList(game, eligible)} can buzz in` : "Buzz in on your phone as soon as you know it" };
    }
    case "tossupSolve":
      return { title: `${who} buzzed in!`, detail: game.hostless ? "One try to fill in the blanks" : "One try: say it, or fill in the blanks" };
    case "finalSpin":
      return { title: "Speed-up!", detail: `${who} spins one last time. Consonants will be worth the spin plus $1,000` };
    case "speedLetter":
      return { title: `${who}: call a letter`, detail: `Consonants ${money(round.value)} · vowels free` };
    case "speedSolve":
      return { title: `${who}, solve it now!`, detail: game.hostless ? "As many tries as the clock allows" : "Say it, or fill in the blanks" };
    case "roundEnd":
      if (round.winner == null) return { title: "Nobody solved it", detail: round.tossup ? "Nobody wins the toss-up" : "No money banked this round" };
      return {
        title: `${nameOf(game, round.winner)} ${round.tossup ? "wins the toss-up" : "solved it"}!`,
        detail: round.tossup ? `+${money(round.awarded)}` : `Banks ${money(round.awarded)}${round.prizesWon?.length ? `, including ${round.prizesWon.map((prize) => prize.name).join(" and ")}` : ""}`,
      };
    default:
      return { title: "", detail: "" };
  }
}

// What the last spin landed on, and what calling a consonant there gets you.
function landedName(round) {
  const landed = round.landed;
  if (!landed) return money(round.value);
  return { gift: "the Gift", million: "the Million Dollar wedge", mystery: "a Mystery wedge", express: "the Express" }[landed.kind] || money(landed.value);
}
function landedHint(round) {
  const landed = round.landed, each = `Call a consonant: ${money(landed?.value)} a letter`;
  switch (landed?.kind) {
    case "gift": return round.gift ? `${each}, plus ${round.gift.name} (${money(round.gift.value)})` : each;
    case "million": return `${each}, and a shot at $1,000,000 in the bonus round`;
    case "mystery": return `${each}, or flip it for ${money(10000)} or Bankrupt`;
    case "express": return `${each}, then play the Express or pass`;
    default: return "Call a consonant";
  }
}

// The latest thing that happened this round, in words ("There are 3 L’s!").
const NEWS = ["hit", "miss", "land", "timeout", "wrongSolve", "skipped", "gift", "million", "wild", "wildUsed", "mysteryTake", "mysteryFlip", "expressPlay", "bankrupt"];
function latestNews(game) {
  const events = game.events || [], since = events.findLastIndex((e) => e.type === "round");
  const e = events.slice(since + 1).findLast((item) => NEWS.includes(item.type));
  if (!e) return null;
  const who = nameOf(game, e.contestant);
  switch (e.type) {
    case "hit": return { tone: "good", text: e.vowel || e.amount == null ? `There ${e.count === 1 ? "is" : "are"} ${plural(e.count, e.letter)}` : `There ${e.count === 1 ? "is" : "are"} ${plural(e.count, e.letter)}! +${money(e.amount)}` };
    case "gift": return { tone: "good", text: `${who} picks up ${e.name}!` };
    case "million": return { tone: "good", text: `${who} has the Million Dollar wedge! Solve to keep it` };
    case "wild": return { tone: "good", text: `${who} picks up the Wild Card!` };
    case "wildUsed": return { tone: "good", text: `${who} plays the Wild Card for another consonant` };
    case "mysteryTake": return { tone: "good", text: `${who} takes the money: +${money(e.amount)}` };
    case "mysteryFlip": return e.won ? { tone: "good", text: `${who} flipped it: ${money(e.amount)}!` } : { tone: "bad", text: `${who} flipped it: Bankrupt!` };
    case "expressPlay": return { tone: "good", text: `${who} is playing the Express!` };
    case "bankrupt": return { tone: "bad", text: `${who} went bankrupt on the Express` };
    case "miss": return { tone: "bad", text: `No ${e.letter}` };
    case "land":
      if (e.final) return e.kind === "cash" ? null : { tone: "bad", text: "That doesn’t count for the speed-up: spinning again" };
      return e.kind === "bankrupt" ? { tone: "bad", text: `${who} went bankrupt` } : e.kind === "loseTurn" ? { tone: "bad", text: `${who} lost a turn` } : null;
    case "timeout": return { tone: "bad", text: `${who} ran out of time` };
    case "wrongSolve": return { tone: "bad", text: e.text ? `“${e.text}” isn’t it` : `${who} didn’t get it` };
    case "skipped": return { tone: "bad", text: `${possessive(who)} turn was skipped` };
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

// Puzzles for a plan, two spares kept back for tiebreakers, and the bonus round's three categories
// (from the short bonus puzzles, each in a different category).
function dealPuzzles(plan) {
  const picks = pickPuzzles(plan.length);
  return { picks, spares: pickPuzzles(2, picks), bonus: pickPuzzles(3, [], BONUS_POOL) };
}
// The Gift wedge's prize for rounds 1 to 3 and the round-3 Prize Puzzle's trip, from the pack's prize lists.
function dealPrizes() {
  const prize = ([name, value]) => ({ name, value });
  return { gifts: shuffle(PUZZLES.gifts).slice(0, 3).map(prize), trip: prize(shuffle(PUZZLES.trips)[0]) };
}
// What setup sends the server for a plan and its puzzles.
const gameSegments = (plan, picks) => plan.map((step, i) => ({ ...step, ...forServer(picks[i]) }));

// ---------- Setup ----------
export function WheelSetup({ onCreate }) {
  const [length, setLength] = useState("classic"),
    [rounds, setRounds] = useState(4),
    [tossups, setTossups] = useState(true),
    [{ picks, spares, bonus }, setDeal] = useState(() => dealPuzzles(planFor("classic", 4, true))),
    [withBonus, setWithBonus] = useState(true),
    [teams, setTeams] = useState(false),
    [teamCount, setTeamCount] = useState(2),
    [teamNames, setTeamNames] = useState(["", "", "", ""]),
    [hostless, setHostless] = useState(false),
    [relaxed, setRelaxed] = useState(false),
    [speedUpNow, setSpeedUpNow] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const plan = planFor(length, rounds, tossups), labels = planLabels(plan);
  const roundCount = plan.filter((step) => step.type !== "tossup").length, tossupCount = plan.length - roundCount;
  // A new plan keeps the puzzles already dealt, as far as they go.
  const changePlan = (nextLength, nextRounds, nextTossups) => {
    setLength(nextLength); setRounds(nextRounds); setTossups(nextTossups);
    const count = planFor(nextLength, nextRounds, nextTossups).length;
    setDeal((deal) => ({ ...deal, picks: count <= deal.picks.length ? deal.picks.slice(0, count) : [...deal.picks, ...pickPuzzles(count - deal.picks.length, [...deal.picks, ...deal.spares])] }));
  };
  const swap = (index) => setDeal((deal) => ({ ...deal, picks: deal.picks.map((puzzle, i) => (i === index ? pickPuzzles(1, [...deal.picks, ...deal.spares])[0] || puzzle : puzzle)) }));
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed([...picks, ...(withBonus ? bonus : [])].map((puzzle) => puzzle.id));
    onCreate(
      {
        game: "wheel", segments: gameSegments(plan, picks), spares: spares.map(forServer), bonus: withBonus ? bonus.map(forServer) : [], ...dealPrizes(),
        mode: teams ? "teams" : "solo", teamCount, teamNames: teamNames.slice(0, teamCount).map((name, i) => name.trim() || `Team ${i + 1}`),
        hostless, pace: relaxed ? "relaxed" : "show", speedUp: speedUpNow ? "start" : "after",
      },
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
            <p className="muted">Spin the wheel, call letters and solve the puzzle. 2 to 6 players, each on their own phone. Pick how long a game to play and swap out any puzzle you don’t like.</p>
          </div>
        </div>
        <fieldset className="ws-fieldset">
          <legend>Players</legend>
          <div className="ws-rounds ws-two" role="radiogroup" aria-label="Solo or teams">
            <button role="radio" aria-checked={!teams} onClick={() => setTeams(false)}>Solo</button>
            <button role="radio" aria-checked={teams} onClick={() => setTeams(true)}>Teams</button>
          </div>
          {teams ? (
            <>
              <div className="ws-rounds ws-rounds-small" role="radiogroup" aria-label="Number of teams">
                {[2, 3, 4].map((count) => <button key={count} role="radio" aria-checked={teamCount === count} onClick={() => setTeamCount(count)}>{count} teams</button>)}
              </div>
              <div className="ws-team-names">
                {Array.from({ length: teamCount }, (_, i) => (
                  <label className="field" key={i}>
                    <span>Team {i + 1}</span>
                    <input value={teamNames[i]} maxLength="24" placeholder={`Team ${i + 1}`} onChange={(e) => setTeamNames((names) => names.map((name, j) => (j === i ? e.target.value : name)))} />
                  </label>
                ))}
              </div>
              <p className="muted ws-hint">Up to 12 phones. Players pick a team when they join. Teammates take turns spinning and calling letters, anyone on the team can buzz in on a toss-up, and the whole team plays the bonus round.</p>
            </>
          ) : <p className="muted ws-hint">2 to 6 players, each with their own podium. The show has 3.</p>}
        </fieldset>
        <fieldset className="ws-fieldset">
          <legend>Game length</legend>
          <div className="ws-rounds" role="radiogroup" aria-label="Game length">
            {LENGTHS.map((option) => <button key={option.id} role="radio" aria-checked={length === option.id} onClick={() => changePlan(option.id, rounds, tossups)}>{option.label}</button>)}
          </div>
          {length === "custom" && (
            <div className="ws-custom">
              <div className="ws-rounds ws-rounds-small" role="radiogroup" aria-label="Number of rounds">
                {ROUND_CHOICES.map((count) => <button key={count} role="radio" aria-checked={rounds === count} onClick={() => changePlan("custom", count, tossups)}>{count} rounds</button>)}
              </div>
              <label className="game-mode"><input type="checkbox" checked={tossups} onChange={(e) => changePlan("custom", rounds, e.target.checked)} /><span><b>Toss-ups</b></span></label>
            </div>
          )}
          <p className="muted ws-hint">
            {length === "short" ? "A $1,000 toss-up, two rounds and the final round. About 20 minutes."
              : length === "classic" ? "Like the show: $1,000 and $2,000 toss-ups, rounds 1 and 2, a $3,000 toss-up, round 3 and the final round. About 35 minutes."
              : `${roundCount} rounds${tossupCount ? ` and ${tossupCount} toss-ups` : ", no toss-ups"}.`}
            {" "}Rounds 1 to 3 have the Wild Card, a Gift and the Million Dollar wedge; round 2 adds two Mystery wedges, and round 3 (Classic, or Custom with 4 or more rounds) the Express wedge and a Prize Puzzle worth a trip.
            {" "}The final round ends in a speed-up: one last spin sets every consonant’s value, vowels are free, and each letter found gives a few seconds to solve. A tie for the lead is settled with a toss-up.
          </p>
        </fieldset>
        <div className="ws-puzzles-head">
          <h2>Puzzles</h2>
          <button className="chip-btn" onClick={() => setDeal(dealPuzzles(plan))}>New set</button>
        </div>
        <ol className="ws-puzzle-list">
          {picks.map((puzzle, i) => (
            <li key={puzzle.id}>
              <span className="ws-p-round">{labels[i]}</span>
              <span className="ws-p-category">{puzzle.category}</span>
              <span className="ws-p-size muted">{puzzle.text.split(" ").length} {puzzle.text.split(" ").length === 1 ? "word" : "words"}</span>
              <button className="chip-btn" aria-label={`Swap the ${labels[i]} puzzle`} onClick={() => swap(i)}>Swap</button>
            </li>
          ))}
        </ol>
        <div className={`ws-bonus-setup${withBonus ? "" : " is-off"}`}>
          <label className="game-mode">
            <input type="checkbox" checked={withBonus} onChange={(e) => setWithBonus(e.target.checked)} />
            <span><b>Bonus round</b><small>The winner picks one of three categories, spins for a sealed envelope ($40,000 to $100,000) and gets R S T L N E plus three consonants and a vowel of their choice. Ten seconds to solve it for the money.</small></span>
          </label>
          {withBonus && (
            <div className="ws-bonus-cats">
              {bonus.map((puzzle) => <span key={puzzle.id}>{puzzle.category}</span>)}
              <button className="chip-btn" onClick={() => setDeal((deal) => ({ ...deal, bonus: pickPuzzles(3, deal.bonus, BONUS_POOL) }))}>Swap</button>
            </div>
          )}
        </div>
        <p className="muted ws-hint">Puzzles stay hidden here so you can play too. {MAIN.length.toLocaleString()} puzzles in the pack, and {BONUS_POOL.length} bonus puzzles; ones this browser has played are saved for last.</p>
        <section className="game-options" aria-labelledby="ws-options-title">
          <h2 id="ws-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>Players solve by filling in the blanks on their phone, and the game checks them. With a host, players can also say the answer out loud and the host judges it from the host controller, which shows the answer.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={relaxed} onChange={(e) => setRelaxed(e.target.checked)} />
            <span><b>Relaxed pace</b><small>Twice as long to decide, call a letter and solve: 20 seconds, 20 seconds and 40 seconds instead of 10, 10 and 20 (and 20 instead of 10 for a toss-up or speed-up solve).</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={speedUpNow} onChange={(e) => setSpeedUpNow(e.target.checked)} />
            <span><b>Speed-up from the start of the final round</b><small>Otherwise the final round plays normally for two minutes first{hostless ? "" : ", or until the host starts the speed-up"}.</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{roundCount} rounds{tossupCount ? ` · ${tossupCount} toss-ups` : ""}</p>
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
// The bonus wheel's envelopes are sealed: they all look the same.
const WEDGE_LABELS = { envelope: "?", bankrupt: "BANKRUPT", loseTurn: "LOSE A TURN", gift: "GIFT", million: "$1M", mystery: "MYSTERY", express: "EXPRESS" };
const wedgeLabel = (wedge) => WEDGE_LABELS[wedge.kind] || money(wedge.value).replace(",", "");
// [fill, dark text] for wedges that aren't plain cash.
const WEDGE_STYLES = { bankrupt: ["#101014", false], loseTurn: ["#f4f4f4", true], gift: ["#7b2ff7", false], million: ["#101014", false], mystery: ["#b5179e", false], express: ["#ffd23f", true] };
const ENVELOPE_WHEEL = Array.from({ length: 24 }, () => ({ kind: "envelope" }));
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
            const [styleFill, styleDark] = WEDGE_STYLES[wedge.kind] || [];
            const fill = wedge.kind === "envelope" ? (i % 2 ? "#e9e2cc" : "#f2c14e") : styleFill || (wedge.top ? "#dfe3ee" : WEDGE_COLORS[i % WEDGE_COLORS.length]);
            const dark = wedge.kind === "envelope" || styleDark || wedge.top || (!styleFill && LIGHT_WEDGES.has(fill));
            const label = wedgeLabel(wedge);
            // The Million Dollar wedge's middle third is the million; the slivers either side are Bankrupt.
            const [m1x, m1y] = point(center - size / 6, 100), [m2x, m2y] = point(center + size / 6, 100);
            return (
              <g key={i}>
                <path d={`M0 0 L${x1} ${y1} A100 100 0 0 1 ${x2} ${y2} Z`} fill={fill} stroke="#0b1030" strokeWidth="0.8" />
                {wedge.kind === "million" && <path d={`M0 0 L${m1x} ${m1y} A100 100 0 0 1 ${m2x} ${m2y} Z`} fill="#1db954" />}
                <g transform={`rotate(${center - 90})`}>
                  <text x="62" y="0" className="ws-wedge-text" fill={dark ? "#141833" : "#fff"} fontSize={label.length > 5 ? 6.2 : 9} dominantBaseline="middle" textAnchor="middle">{label}</text>
                  {wedge.wild && (
                    <g>
                      <rect x="79" y="-4.6" width="17" height="9.2" rx="1.6" fill="#fff" stroke="#141833" strokeWidth="0.6" />
                      <text x="87.5" y="0.2" className="ws-wedge-text" fill="#b5179e" fontSize="3.8" dominantBaseline="middle" textAnchor="middle">WILD</text>
                    </g>
                  )}
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
  useNewEvents(game, (e) => {
    if (e.type === "land") setFlash({ ...e });
    // Turning the Mystery wedge over.
    if (e.type === "mysteryFlip") setFlash({ id: e.id, kind: e.won ? "mysteryWin" : "bankrupt", value: e.amount });
  });
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [flash]);
  if (!flash) return null;
  const FLASH = { bankrupt: "BANKRUPT", loseTurn: "LOSE A TURN", gift: "GIFT", million: "$1,000,000", mystery: "MYSTERY", express: "EXPRESS" };
  const text = flash.kind === "mysteryWin" ? `${money(flash.value)}!` : FLASH[flash.kind] || money(flash.value);
  return <div className={`ws-flash is-${flash.kind}`} key={flash.id} aria-hidden="true">{text}</div>;
}

// ---------- Podiums ----------
function Podiums({ game }) {
  const round = game.round;
  return (
    <ol className="ws-podiums">
      {game.contestants.map((contestant, i) => {
        const control = round && round.control === i && round.phase !== "roundEnd";
        const sittingOut = round?.tossup && round.phase !== "roundEnd" && (round.tossup.lockedOut.includes(i) || (round.tossup.eligible && !round.tossup.eligible.includes(i)));
        return (
          <li key={i} className={`ws-podium ${colorOf(i)}${control ? " is-control" : ""}${contestant.present ? "" : " is-away"}${sittingOut ? " is-out" : ""}${round?.winner === i && round.phase === "roundEnd" ? " is-winner" : ""}`}>
            <span className="ws-podium-name">{contestant.name}{!contestant.present && <small> · away</small>}</span>
            <b className="ws-podium-bank money">{money(contestant.roundBank)}</b>
            <span className="ws-podium-total">Total <b className="money">{money(contestant.total)}</b></span>
            <Extras contestant={contestant} />
            {isTeams(game) && (
              <span className="ws-podium-members">
                {membersOf(game, i).map((player) => <span key={player.id} className={`${player.id === round?.actorId ? "is-up" : ""}${player.connected ? "" : " is-away"}`}>{player.name}</span>)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// How long until the final round's speed-up starts by itself ("in 1:24"), counting down.
function SpeedUpIn({ game }) {
  const at = game.round?.speedUpAt, [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!at || game.clocksPaused) return null;
  const left = Math.max(0, Math.ceil((at - game.serverNow - (now - receivedAt(game))) / 1000));
  return <small className="ws-speedup-in">{left ? `(by itself in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")})` : "(at the next turn)"}</small>;
}
// When this browser got the current update, so server times can be turned into local ones.
const received = new WeakMap();
const receivedAt = (game) => { if (!received.has(game)) received.set(game, Date.now()); return received.get(game); };

// What a contestant is holding besides money: the Wild Card, the Million Dollar wedge (dashed until the
// round is solved), and gifts picked up this round.
function Extras({ contestant }) {
  if (!contestant || !(contestant.wildCard || contestant.million || contestant.millionThisRound || contestant.roundPrizes?.length)) return null;
  return (
    <span className="ws-extras">
      {contestant.wildCard && <span className="ws-chip is-wild">Wild Card</span>}
      {(contestant.million || contestant.millionThisRound) && <span className={`ws-chip is-million${contestant.million ? "" : " is-pending"}`}>$1M wedge</span>}
      {contestant.roundPrizes?.map((prize, i) => <span key={i} className="ws-chip is-gift">{prize.name}</span>)}
    </span>
  );
}

function Clock({ game }) {
  const round = game.round;
  if (!round || !CLOCK_PHASES.includes(round.phase)) return <span />;
  if (round.pausedMs != null) return <ClueTimer frozenMs={round.pausedMs} />;
  return <ClueTimer deadline={round.deadline} serverNow={game.serverNow} />;
}

// ---------- Host tools (TV without a host, and the host controller) ----------
function RoundTools({ game, onAction }) {
  const round = game.round, waiting = CLOCK_PHASES.includes(round.phase);
  const last = game.segment.index >= game.segment.count - 1;
  return (
    <div className="ws-round-tools">
      {game.clocksPaused
        ? <button className="chip-btn" onClick={() => onAction("resume")}>Resume clocks</button>
        : <button className="chip-btn" onClick={() => onAction("pause")}>Pause clocks</button>}
      <button className="chip-btn" disabled={!waiting} onClick={() => onAction("skipTurn")}>Skip turn</button>
      {round.type === "final" && !round.speedUp && round.phase !== "roundEnd" && (
        <button className="chip-btn" onClick={() => onAction("speedUp")}>Start the speed-up <SpeedUpIn game={game} /></button>
      )}
      {round.phase !== "roundEnd" && <button className="chip-btn" onClick={() => onAction("revealPuzzle")}>Reveal puzzle (nobody wins)</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>{last ? "End game" : "End game early"}</button>
    </div>
  );
}
function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("500");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  const teams = isTeams(game), adjust = (contestant) => (
    <>
      <span className="money">{money(game.contestants[contestant]?.total)}</span>
      <button className="chip-btn add" onClick={() => onAction("adjustScore", { contestant, amount: step })}>+{step}</button>
      <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { contestant, amount: -step })}>−{step}</button>
    </>
  );
  return (
    <div className="ws-player-tools">
      {game.status !== "lobby" && <label className="inline-field">Adjust totals by <input aria-label="Score adjustment amount" type="number" min="1" step="50" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
      {teams && (
        <ul className="ws-team-tools">
          {game.contestants.map((team, i) => (
            <li key={i} className={colorOf(i)}>
              <input aria-label={`Team ${i + 1} name`} defaultValue={team.name} key={team.name} maxLength="24" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== team.name && onAction("renameTeam", { contestant: i, name: e.target.value })} />
              {game.status !== "lobby" && adjust(i)}
            </li>
          ))}
        </ul>
      )}
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            {teams && (
              <select aria-label={`${player.name}’s team`} value={player.contestant} onChange={(e) => onAction("movePlayer", { playerId: player.id, contestant: Number(e.target.value) })}>
                {game.contestants.map((team, i) => <option key={i} value={i}>{team.name}</option>)}
              </select>
            )}
            {!teams && game.status !== "lobby" && adjust(player.contestant)}
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
      {isTeams(game) ? (
        <div className="ws-lobby-teams">
          {game.contestants.map((team, i) => (
            <section key={i} className={colorOf(i)}>
              <h2>{team.name}</h2>
              <ul>
                {membersOf(game, i).map((player) => (
                  <li key={player.id}>
                    <button onClick={() => onAction("movePlayer", { playerId: player.id, contestant: (i + 1) % game.contestants.length })} aria-label={`Move ${player.name} to ${game.contestants[(i + 1) % game.contestants.length].name}`}>
                      {player.name} <span aria-hidden="true">⇄</span>
                    </button>
                  </li>
                ))}
                {!membersOf(game, i).length && <li className="muted">Nobody yet</li>}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ol className="ws-lobby-players">
          {game.contestants.map((contestant, i) => <li key={i} className={colorOf(i)}>{contestant.name}</li>)}
          {!game.contestants.length && <li className="muted">Nobody yet</li>}
        </ol>
      )}
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      <p className="muted">
        {isTeams(game) ? "Players choose a team on their phone. Tap a name to move someone. Up to 12 players."
          : game.contestants.length < 2 ? "2 to 6 players. The show has 3." : `${game.contestants.length} players. Player 1 spins first.`}
      </p>
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
        {game.status === "bonus" ? <BonusClock game={game} /> : <Clock game={game} />}
      </header>
      {game.status === "bonus" ? (
        <BonusStage game={game} onAction={onAction} />
      ) : game.status === "lobby" || !round ? (
        <Lobby game={game} onAction={onAction} />
      ) : (
        <div className="ws-stage">
          {round.tossup ? (
            <div className="ws-wheel-wrap ws-tossup-panel">
              <span>{round.type === "tiebreak" ? "Tiebreaker" : "Toss-up"}</span>
              <b className="money">{money(round.tossup.value)}</b>
              <p>{round.phase === "tossupReveal" ? "Buzz in on your phone!" : round.phase === "tossupSolve" ? `${nameOf(game, round.control)} buzzed in` : ""}</p>
            </div>
          ) : (
            <div className="ws-wheel-wrap">
              <Wheel wheel={round.wheel} spin={round.spin} spinKey={round.spin ? `${game.segment.index}-${round.spin.id}` : null} />
              <LandingFlash game={game} />
            </div>
          )}
          <div className="ws-main">
            <div className="ws-board-wrap">
              <PuzzleBoard board={round.board} />
              <p className="ws-category"><span>{segmentLabel(game)}</span>{round.category}</p>
            </div>
            <div className="ws-status" role="status">
              {round.speedUp?.value && round.phase !== "roundEnd" && <p className="ws-speedup">Speed-up · consonants {money(round.speedUp.value)} · vowels free</p>}
              {round.prizePuzzle && round.phase !== "roundEnd" && <p className="ws-prize-puzzle">Prize Puzzle · solve it to win {round.prizePuzzle.name} ({money(round.prizePuzzle.value)})</p>}
              {round.express && round.phase !== "roundEnd" && <p className="ws-speedup">Express · no spinning · any mistake is Bankrupt</p>}
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
          {game.status === "bonus" && <BonusTools game={game} onAction={onAction} />}
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
// board, blanks, event and clock default to the current round's; the bonus round passes its own.
function SolveBox({ game, playerId, board = game.round?.board, blanks = game.round?.blanks, event = "wheel:solve", clock = <Clock game={game} /> }) {
  const count = blanks;
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
  // In the speed-up a wrong try isn't the end: the letters stay for another go.
  const lastEvent = game.events?.at(-1);
  useEffect(() => { if (lastEvent?.type === "wrongSolve") setSent(false); }, [lastEvent?.id]);
  const submit = () => {
    if (!full || sent) return;
    setSent(true);
    socket.emit(event, { code: game.code, playerId, guess: state.letters.join("") });
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
      <div className="ws-solve-top"><b>Fill in the blanks</b>{clock}</div>
      {!game.hostless && <p className="muted">Or say it out loud for the host.</p>}
      <PuzzleBoard board={board} small fill={state.letters} cursor={state.cursor} onPick={(i) => setState((s) => ({ ...s, cursor: i }))} />
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
function SpinButton({ game, playerId, disabled, hint = "Hold to spin harder", event = "wheel:spin" }) {
  const pressed = useRef(null), [sent, setSent] = useState(false);
  const release = () => {
    if (pressed.current == null || sent) return;
    const power = Math.min(1, 0.3 + (Date.now() - pressed.current) / 1100);
    pressed.current = null; setSent(true);
    socket.emit(event, { code: game.code, playerId, power });
  };
  return (
    <button className="ws-spin" disabled={disabled || sent} onPointerDown={() => { pressed.current = Date.now(); }} onPointerUp={release} onPointerLeave={release}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && pressed.current == null) pressed.current = Date.now(); }} onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") release(); }}>
      SPIN
      <small>{disabled ? "No consonants left" : hint}</small>
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
      {round.wildChance && me.wildCard && round.consonantsLeft && (
        <button className="secondary ws-wild-btn" disabled={sent} onClick={() => emit("wild")}>Play your Wild Card <small>Another consonant at the same value</small></button>
      )}
    </div>
  );
}
// Two big choices (Mystery: take or flip; Express: pass or play).
function ChoiceButtons({ game, playerId, event, options }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="ws-turn-row ws-choice">
      {options.map((option) => (
        <button key={option.label} className={option.primary ? "primary" : "secondary"} disabled={sent} onClick={() => { setSent(true); socket.emit(`wheel:${event}`, { code: game.code, playerId, ...option.payload }); }}>
          {option.label} <small>{option.note}</small>
        </button>
      ))}
    </div>
  );
}
// On the Express: consonants without spinning, vowels at $250, or solve.
function ExpressActions({ game, playerId }) {
  const round = game.round, me = game.contestants[round.control], [sent, setSent] = useState(false);
  const canBuy = round.vowelsLeft && me.roundBank >= game.vowelCost;
  const emit = (name, extra = {}) => { setSent(true); socket.emit(`wheel:${name}`, { code: game.code, playerId, ...extra }); };
  return (
    <>
      <Keyboard allowed={sent ? "" : CONSONANTS + (canBuy ? VOWELS : "")} used={round.called.join("")} onKey={(letter) => emit(VOWELS.includes(letter) ? "buyVowel" : "consonant", { letter })} />
      <p className="muted ws-hint">{canBuy ? `Vowels cost ${money(game.vowelCost)}.` : round.vowelsLeft ? `Vowels need ${money(game.vowelCost)}.` : "No vowels left."}</p>
      <button className="primary ws-solve-now" disabled={sent} onClick={() => emit("solveStart")}>Solve</button>
    </>
  );
}

function PlayerAction({ game, playerId }) {
  const round = game.round, mine = round.actorId === playerId;
  const status = (text, you = false) => <p className={"player-status" + (you ? " is-you" : "")}>{text}</p>;
  // Each turn's controls start fresh, so a button pressed last turn isn't still "sent".
  const turnKey = `${game.segment.index}-${game.events?.at(-1)?.id}`;
  const solveKey = `${game.segment.index}-${round.phase}-${round.control}`;
  if (round.phase === "roundEnd") { const { title, detail } = phaseText(game); return <>{status(title, round.winner === myContestant(game, playerId))}<p className="muted">{detail}</p></>; }
  if (round.phase === "tossupReveal") return <TossupBuzzer game={game} playerId={playerId} />;
  if (!mine) {
    const { title, detail } = phaseText(game);
    // A teammate is acting for the team.
    if (isTeams(game) && round.actorId && round.control === myContestant(game, playerId))
      return <>{status(`${playerName(game, round.actorId)} is playing for your team`, true)}<p className="muted">{title}{/[.!?…]$/.test(title) ? "" : "."} Help them out!</p></>;
    return <>{status(title)}{detail && <p className="muted">{detail}</p>}</>;
  }
  switch (round.phase) {
    case "tossupSolve":
    case "speedSolve":
      return <>{round.phase === "speedSolve" && status("Solve it now!", true)}<SolveBox key={solveKey} game={game} playerId={playerId} /></>;
    case "finalSpin":
      return <>{status("Speed-up! Spin one last time", true)}<p className="muted">Consonants will be worth the spin plus $1,000 for the rest of the round.</p><Clock game={game} /><SpinButton key={turnKey} game={game} playerId={playerId} hint="For the speed-up" /></>;
    case "speedLetter":
      return <>{status(`Call a letter: consonants ${money(round.value)}, vowels free`, true)}<Clock game={game} /><SpeedLetterPicker key={turnKey} game={game} playerId={playerId} /></>;
    case "mystery":
      return (
        <>
          {status("Take the money, or flip the wedge?", true)}
          <Clock game={game} />
          <ChoiceButtons key={turnKey} game={game} playerId={playerId} event="mystery" options={[
            { label: "Take the money", note: `${money(round.landed?.value)} a letter`, payload: { flip: false } },
            { label: "Flip it!", note: `${money(10000)} or Bankrupt`, payload: { flip: true }, primary: true },
          ]} />
        </>
      );
    case "expressChoice":
      return (
        <>
          {status("All aboard the Express?", true)}
          <p className="muted">Keep calling consonants at $1,000 each without spinning. Any mistake is Bankrupt.</p>
          <Clock game={game} />
          <ChoiceButtons key={turnKey} game={game} playerId={playerId} event="express" options={[
            { label: "Pass", note: "Play on normally", payload: { play: false } },
            { label: "Play", note: "No more spinning", payload: { play: true }, primary: true },
          ]} />
        </>
      );
    case "express":
      return <>{status("Express! Call a consonant, buy a vowel or solve", true)}<Clock game={game} /><ExpressActions key={turnKey} game={game} playerId={playerId} /></>;
    case "turn":
      return <>{status("Your turn!", true)}<Clock game={game} /><TurnActions key={turnKey} game={game} playerId={playerId} /></>;
    case "spinning":
      return status("Spinning… watch the wheel!", true);
    case "consonant":
      return (
        <>
          {status(round.landed && round.landed.kind !== "cash" ? `You landed on ${landedName(round)}!` : `${money(round.value)} — call a consonant`, true)}
          {round.landed && round.landed.kind !== "cash" && <p className="muted">{landedHint(round)}</p>}
          <Clock game={game} />
          <ConsonantPicker key={turnKey} game={game} playerId={playerId} />
        </>
      );
    case "solving":
      return <SolveBox key={solveKey} game={game} playerId={playerId} />;
    default:
      return null;
  }
}
function TossupBuzzer({ game, playerId }) {
  const round = game.round, me = myContestant(game, playerId), { lockedOut, eligible } = round.tossup;
  const out = lockedOut.includes(me), notInIt = eligible && !eligible.includes(me);
  return (
    <>
      <p className={"player-status" + (out || notInIt ? "" : " is-you")}>{notInIt ? `Tiebreaker: ${namesList(game, eligible)} only` : out ? "You’re out of this toss-up" : "Know it? Buzz in!"}</p>
      <button className={"buzzer" + (out || notInIt ? "" : " ready")} disabled={out || notInIt} onClick={() => socket.emit("wheel:buzz", { code: game.code, playerId })}>BUZZ!</button>
    </>
  );
}
function SpeedLetterPicker({ game, playerId }) {
  const [sent, setSent] = useState(false);
  const emit = (name, extra = {}) => { setSent(true); socket.emit(`wheel:${name}`, { code: game.code, playerId, ...extra }); };
  return (
    <>
      <Keyboard allowed={sent ? "" : CONSONANTS + VOWELS} used={game.round.called.join("")} onKey={(letter) => emit("letter", { letter })} />
      <button className="primary ws-solve-now" disabled={sent} onClick={() => emit("solveStart")}>Solve now</button>
    </>
  );
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
      {isTeams(game) && <p className={`ws-my-team ${colorOf(player.contestant)}`}>{me?.name}</p>}
      <div className={`ws-my-podium ${colorOf(player.contestant)}`}>
        <span>This round <b className="money">{money(me?.roundBank)}</b></span>
        <span>Total <b className="money">{money(me?.total)}</b></span>
      </div>
      <Extras contestant={me} />
      {game.status === "bonus" ? (
        <BonusPlayer game={game} playerId={playerId} />
      ) : game.status === "lobby" || !round ? (
        isTeams(game) ? (
          <div className="ws-team-pick">
            <p className="player-status">Pick your team, then wait for the game to start.</p>
            <div className="ws-team-pick-buttons" role="radiogroup" aria-label="Your team">
              {game.contestants.map((team, i) => (
                <button key={i} role="radio" aria-checked={player.contestant === i} className={colorOf(i)} onClick={() => socket.emit("wheel:team", { code: game.code, playerId, contestant: i })}>
                  {team.name}
                  <small>{membersOf(game, i).length} {membersOf(game, i).length === 1 ? "player" : "players"}</small>
                </button>
              ))}
            </div>
          </div>
        ) : <p className="player-status">You’re in! Wait for the game to start.</p>
      ) : (
        <>
          <p className="player-clue-meta">{segmentLabel(game)} · {round.category}</p>
          {/* The solve screen has its own board, with the blanks to fill in. */}
          {SOLVE_PHASES.includes(round.phase) && round.actorId === playerId ? null : <PuzzleBoard board={round.board} small />}
          {news && round.phase !== "roundEnd" && <p className={`ws-news is-${news.tone}`} key={game.events.at(-1)?.id}>{news.text}</p>}
          <PlayerAction game={game} playerId={playerId} />
          {!SOLVE_PHASES.includes(round.phase) && !round.tossup && <UsedLetters round={round} />}
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
  if (game.status === "bonus")
    return (
      <main className="controller wheel-game">
        {header}
        <BonusControl game={game} onAction={onAction} />
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
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
      {SOLVE_PHASES.includes(round.phase) && (
        <div className="judgement">
          <h2>{nameOf(game, round.control)} is solving</h2>
          <p className="muted">If they say it out loud, judge it here. It has to be said exactly as written.{round.phase === "speedSolve" ? " In the speed-up, Wrong lets them keep trying until the clock runs out." : ""}</p>
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

// ---------- Bonus round ----------
// What the bonus round is waiting for, as a headline and a line of detail.
function bonusText(game) {
  const bonus = game.bonus, who = nameOf(game, bonus.contestant), want = `${bonus.picks.consonants} consonants and a vowel`;
  switch (bonus.phase) {
    case "pick": return { title: "Bonus round!", detail: `${who} picks a category` };
    case "spin": return { title: `${who} spins for the prize`, detail: "Every envelope holds $40,000 or more" };
    case "spinning": return { title: "Spinning for the envelope…", detail: "" };
    case "given": return { title: "R S T L N E", detail: "Here come the letters everyone gets" };
    case "letters": return { title: `${who} picks ${want}`, detail: bonus.extra ? "The Wild Card is worth a fourth consonant" : "" };
    case "lighting": return { title: bonus.picked.length ? bonus.picked.join(" ") : "No letters picked", detail: "" };
    case "solve": return { title: "Ten seconds to solve it!", detail: game.hostless ? "" : "Say it out loud, or fill in the blanks" };
    case "envelope": return bonus.solved ? { title: `${who} solved it!`, detail: `and wins ${money(bonus.prize)}` } : { title: "So close!", detail: `The envelope held ${money(bonus.prize)}` };
    default: return { title: "", detail: "" };
  }
}
const BONUS_CLOCKS = ["pick", "spin", "letters", "solve"];
function BonusClock({ game }) {
  const bonus = game.bonus;
  if (!BONUS_CLOCKS.includes(bonus.phase)) return <span />;
  if (bonus.pausedMs != null) return <ClueTimer frozenMs={bonus.pausedMs} />;
  return <ClueTimer deadline={bonus.deadline} serverNow={game.serverNow} />;
}
// The given letters and the player's picks, as tiles.
function BonusLetterTiles({ bonus }) {
  if (!bonus.board) return null;
  return (
    <div className="ws-bonus-letters" aria-label={`Letters: ${[...bonus.given, ...bonus.picked].join(" ")}`}>
      {[...bonus.given].map((letter) => <span key={letter}>{letter}</span>)}
      {bonus.picked.map((letter) => <span key={letter} className="is-picked">{letter}</span>)}
    </div>
  );
}
function BonusNews({ game }) {
  const e = game.events?.at(-1);
  if (game.bonus.phase !== "solve" || e?.type !== "wrongSolve") return null;
  return <p className="ws-news is-bad" key={e.id}>{e.text ? `“${e.text}” isn’t it` : "Not it, keep going!"}</p>;
}

function BonusStage({ game, onAction }) {
  const bonus = game.bonus, { title, detail } = bonusText(game), winner = game.contestants[bonus.contestant];
  const spinning = ["spin", "spinning"].includes(bonus.phase);
  return (
    <div className="ws-bonus">
      <p className="ws-bonus-label">Bonus round · {winner?.name} · total {money(winner?.total)}</p>
      {bonus.phase === "pick" ? (
        <ol className="ws-bonus-choices">
          {bonus.categories.map((category, i) => <li key={i}>{category}</li>)}
        </ol>
      ) : spinning ? (
        <div className="ws-wheel-wrap ws-bonus-wheel">
          <Wheel wheel={ENVELOPE_WHEEL} spin={bonus.spin} spinKey={bonus.spin ? `bonus-${bonus.spin.id}` : null} />
        </div>
      ) : (
        <div className="ws-board-wrap">
          <PuzzleBoard board={bonus.board} />
          <p className="ws-category"><span>Bonus round</span>{bonus.category}</p>
          <BonusLetterTiles bonus={bonus} />
        </div>
      )}
      <div className="ws-status" role="status">
        {bonus.phase === "envelope" && <div className={`ws-envelope${bonus.solved ? " is-won" : ""}`}><span>The envelope</span><b className="money">{money(bonus.prize)}</b></div>}
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
        <BonusNews game={game} />
        {game.clocksPaused && bonus.phase !== "envelope" && <p className="ws-paused">Clocks paused</p>}
        {bonus.phase === "envelope" && (game.hostless
          ? <p className="muted">Final scores in a few seconds.</p>
          : <button className="primary ws-next" onClick={() => onAction("finishBonus")}>See final scores</button>)}
      </div>
    </div>
  );
}

// Three consonants (four with the Wild Card) and a vowel, from the letters that aren't given.
function BonusLetterPicker({ game, playerId }) {
  const bonus = game.bonus, want = bonus.picks.consonants;
  const [consonants, setConsonants] = useState([]), [vowel, setVowel] = useState(""), [sent, setSent] = useState(false);
  const toggle = (letter) => setConsonants((list) => (list.includes(letter) ? list.filter((l) => l !== letter) : list.length < want ? [...list, letter] : list));
  const ready = consonants.length === want && vowel;
  const free = [...CONSONANTS].filter((letter) => !bonus.given.includes(letter)).join("");
  return (
    <div className="ws-bonus-pick">
      <p className="player-status is-you">Pick {want} consonants and a vowel</p>
      <BonusClock game={game} />
      <div className="ws-keyboard">
        {KEY_ROWS.map((row) => (
          <div className="ws-key-row" key={row}>
            {[...row].filter((letter) => free.includes(letter)).map((letter) => (
              <button key={letter} className={consonants.includes(letter) ? "is-chosen" : ""} aria-pressed={consonants.includes(letter)} disabled={sent} onClick={() => toggle(letter)}>{letter}</button>
            ))}
          </div>
        ))}
        <div className="ws-key-row ws-bonus-vowels">
          {[..."AIOU"].map((letter) => <button key={letter} className={vowel === letter ? "is-chosen" : ""} aria-pressed={vowel === letter} disabled={sent} onClick={() => setVowel(letter)}>{letter}</button>)}
        </div>
      </div>
      <button className="primary ws-solve-now" disabled={!ready || sent} onClick={() => { setSent(true); socket.emit("wheel:bonusLetters", { code: game.code, playerId, consonants, vowel }); }}>
        {ready ? `Light up ${[...consonants, vowel].join(" ")}` : `${consonants.length} of ${want} consonants${vowel ? "" : ", no vowel yet"}`}
      </button>
    </div>
  );
}

function BonusPlayer({ game, playerId }) {
  // On a team, everyone on the winning team gets the controls: whoever acts first.
  const bonus = game.bonus, mine = myContestant(game, playerId) === bonus.contestant, { title, detail } = bonusText(game);
  const status = (text, you = false) => <p className={"player-status" + (you ? " is-you" : "")}>{text}</p>;
  let action = null;
  if (mine && bonus.phase === "pick")
    action = (
      <>
        {status(`${isTeams(game) ? "Your team won" : "You won"}! Pick a category for the bonus round`, true)}
        <BonusClock game={game} />
        <div className="ws-bonus-choices is-phone">
          {bonus.categories.map((category, i) => <button key={i} onClick={() => socket.emit("wheel:bonusPick", { code: game.code, playerId, index: i })}>{category}</button>)}
        </div>
      </>
    );
  else if (mine && bonus.phase === "spin") action = <>{status("Spin for your envelope!", true)}<BonusClock game={game} /><SpinButton game={game} playerId={playerId} event="wheel:bonusSpin" hint="For the prize" /></>;
  else if (mine && bonus.phase === "letters") action = <BonusLetterPicker game={game} playerId={playerId} />;
  else if (mine && bonus.phase === "solve") action = <SolveBox key="bonus" game={game} playerId={playerId} board={bonus.board} blanks={bonus.blanks} event="wheel:bonusSolve" clock={<BonusClock game={game} />} />;
  else action = <>{status(title, mine && bonus.phase === "envelope" && bonus.solved)}{detail && <p className="muted">{detail}</p>}</>;
  const solving = mine && bonus.phase === "solve";
  return (
    <>
      <p className="player-clue-meta">Bonus round{bonus.category ? ` · ${bonus.category}` : ""}</p>
      {bonus.board && !solving && <PuzzleBoard board={bonus.board} small />}
      {!solving && <BonusLetterTiles bonus={bonus} />}
      <BonusNews game={game} />
      {action}
    </>
  );
}

function BonusControl({ game, onAction }) {
  const bonus = game.bonus, solution = useSolution(game.code), { title, detail } = bonusText(game);
  const answer = bonus.solution || (bonus.category ? solution?.text : null);
  return (
    <>
      <p className="player-clue-meta">Bonus round · {nameOf(game, bonus.contestant)}</p>
      <div className="ws-answer">
        <span>The answer</span>
        <b>{answer || (bonus.phase === "pick" ? "Shown once they pick a category" : "Waiting for the answer…")}</b>
      </div>
      {bonus.board && <PuzzleBoard board={bonus.board} small />}
      <div className="ws-ctrl-status" role="status"><b>{title}</b>{detail && <span>{detail}</span>}</div>
      <BonusClock game={game} />
      {bonus.phase === "solve" && (
        <div className="judgement">
          <h2>{nameOf(game, bonus.contestant)} is solving</h2>
          <p className="muted">If they say it out loud, judge it here. Wrong lets them keep trying until the clock runs out.</p>
          <div className="verdict">
            <button onClick={() => onAction("judgeSolve", { correct: true })}>Correct</button>
            <button onClick={() => onAction("judgeSolve", { correct: false })}>Wrong</button>
          </div>
        </div>
      )}
      {bonus.phase === "envelope" && <button className="wide on" onClick={() => onAction("finishBonus")}>See final scores</button>}
      <BonusTools game={game} onAction={onAction} />
    </>
  );
}
function BonusTools({ game, onAction }) {
  return (
    <div className="ws-round-tools">
      {game.clocksPaused
        ? <button className="chip-btn" onClick={() => onAction("resume")}>Resume clocks</button>
        : <button className="chip-btn" onClick={() => onAction("pause")}>Pause clocks</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>End game</button>
    </div>
  );
}

// ---------- End of game ----------
export function WheelEnd({ game, host, onAction }) {
  // The winner was decided before anyone who solved nothing got their $1,000, so it comes from the server.
  const ranked = game.contestants.map((contestant, i) => ({ ...contestant, i })).sort((a, b) => (b.i === game.winner) - (a.i === game.winner) || b.total - a.total);
  const tied = game.winner == null && ranked.length > 1;
  const playAgain = () => {
    const { picks, spares, bonus } = dealPuzzles(game.plan), bonusPicks = game.hasBonus ? bonus : [];
    rememberPlayed([...picks, ...bonusPicks].map((puzzle) => puzzle.id));
    onAction("replay", { segments: gameSegments(game.plan, picks), spares: spares.map(forServer), bonus: bonusPicks.map(forServer), ...dealPrizes() });
  };
  return (
    <main className="end wheel-game">
      <div className="brand ws-brand">SPIN &amp; SOLVE</div>
      <h1>{!ranked.length ? "Game over" : tied ? "It’s a tie!" : `${nameOf(game, game.winner ?? ranked[0].i)} wins!`}</h1>
      {game.bonus?.prize != null && (
        <p className="ws-bonus-result">
          {game.bonus.solved
            ? <>Solved the bonus puzzle, <b>{game.bonus.solution}</b>, for <b className="money">{money(game.bonus.prize)}</b>.</>
            : <>The bonus puzzle was <b>{game.bonus.solution}</b>. The envelope held <b className="money">{money(game.bonus.prize)}</b>.</>}
        </p>
      )}
      <ol className="ws-final">
        {ranked.map((contestant) => (
          <li key={contestant.i} className={`${colorOf(contestant.i)}${contestant.i === game.winner ? " is-winner" : ""}`}>
            <span>
              {contestant.name}
              {contestant.prizes?.length > 0 && <small>won {contestant.prizes.map((prize) => prize.name).join(", ")}</small>}
              {contestant.consolation > 0 && <small>includes {money(contestant.consolation)} for playing</small>}
              {isTeams(game) && <small>{membersOf(game, contestant.i).map((player) => player.name).join(", ") || "No players"}</small>}
            </span>
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
