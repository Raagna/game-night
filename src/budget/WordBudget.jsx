// Word Budget screens: host setup, the shared TV display, players' phones, the host controller and the end.
// The card's five words only ever reach the phones that need them and the host controller (budget:card); the TV
// shows the bidding, the budget, the clock and each word once it's been said.
//
// Word Budget has its own look, a party card game on a TV set rather than the house departure board: bold paper
// word cards with ink outlines on a cobalt stage, a yellow price tag for the bid, a budget meter of word pips and a
// ring clock. Everything is drawn here and in budget.css; no flaps.
import React, { useEffect, useRef, useState } from "react";
import { socket } from "../shared";
import { QRCode, useJoinBase, joinLink, displayAddress } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, setMuted, isMuted, useEventSounds, playWinnersTune, playBuzz, playDing, playRoundWon, playTick } from "../survey/sounds";
import { useClockTicks, playBlip, playSoClose } from "../wheel/sounds";
import { playClue, playPop } from "../fib/sounds";
import { repeatHostTap } from "../../server/taps.js";
import { standings, BUDGET_TIMES, BUDGET_PRACTICE_TIMES } from "../../server/budget.js";
import { Coach } from "../Tutorial";
import WORDS from "../tongue/words.json";
import "./budget.css";

// ---------- Dealing the words ----------
const CARD_SIZE = 5, START_BID = 25;
const CARDS_KEY = "gameNight.budget.cards.v1", SCORING_KEY = "gameNight.budget.scoring.v1", CATEGORIES_KEY = "gameNight.budget.categories.v1";
const ALL_CATEGORIES = WORDS.categories.map(([name]) => name);
const read = (key, allowed, fallback) => { try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
const readCategories = () => {
  try { const saved = JSON.parse(localStorage.getItem(CATEGORIES_KEY)); return Array.isArray(saved) && saved.some((n) => ALL_CATEGORIES.includes(n)) ? saved.filter((n) => ALL_CATEGORIES.includes(n)) : ALL_CATEGORIES; } catch { return ALL_CATEGORIES; }
};
const wordsIn = (chosen) => WORDS.categories.filter(([name]) => chosen.includes(name)).flatMap(([, words]) => words);
// One shuffled pool of every chosen category's words: each card is the next five, so a card mixes categories.
function dealWords(chosen) {
  const seen = new Set();
  return shuffle(wordsIn(chosen)).filter((word) => !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()));
}
const SCORING = {
  cards: { label: "Most cards", note: "First team to the target number of cards wins. Saved words break a tie." },
  points: { label: "Points", note: "A card is worth 10 and every saved word 1. First team to 10 × the target wins." },
};
const secs = (ms) => Math.round(ms / 1000);
// Each phase's clock, from the real game's times or (on the practice card) the practice's.
const timesOf = (game) => (game?.tutorial ? BUDGET_PRACTICE_TIMES : BUDGET_TIMES);
const phaseMs = (game, phase) => timesOf(game)[`${phase}Ms`];

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((p) => p.id === id)?.name || "Nobody";
const teamById = (game, id) => game.teams.find((t) => t.id === id);
const teamOfPlayer = (game, id) => game.teams.find((t) => t.members.includes(id));
const otherTeam = (game, id) => game.teams.find((t) => t.id !== id);
const names = (game, ids) => { const list = ids.map((id) => nameOf(game, id)); return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] || ""; };
const progress = (game, team) => (game.scoring === "points" ? team.points : team.cards);
const leaderOf = (game) => game.teams.find((team) => progress(game, team) >= game.target);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const STATUS = { got: "Got it", stolen: "Stolen", missed: "Missed", waiting: "" };
const Check = () => <svg className="wb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const XIcon = () => <svg className="wb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" /></svg>;
const SwapIcon = () => <svg className="wb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14l-4-4M20 16H6l4 4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const left = (turn) => turn.marks.filter((m) => m === "waiting").length;
const scoreLine = (game, team) => (game.scoring === "points" ? `${team.points} pts` : plural(team.cards, "card"));
const teamIndex = (game, id) => Math.max(0, game.teams.findIndex((t) => t.id === id));
const teamClass = (game, id) => `wb-team-${teamIndex(game, id)}`;

// The card's words for whoever may see them (the clue-givers, the judge without a host, or a host controller),
// fetched for each new card and whenever this phone gains or loses the right to see it.
function useCard(game, playerId, allowed) {
  const [card, setCard] = useState(null), id = game.turn?.id;
  useEffect(() => {
    if (!allowed) { setCard(null); return; }
    let live = true;
    socket.emit("budget:card", { code: game.code, playerId }, (result) => { if (live) setCard(result?.ok ? result.words : null); });
    return () => { live = false; };
  }, [allowed, id]);
  return card;
}
// A phone's taps: tagged with the card and phase they're for, and a double tap sent once (except +1, which the
// judge taps again and again on purpose). The server checks both as well.
function usePhoneAct(game, playerId) {
  const taps = useRef({});
  return (action, payload = {}) => {
    if (repeatHostTap(taps.current, action, payload, Date.now())) return;
    socket.emit("budget:act", { code: game.code, playerId, action, payload: { ...payload, turn: game.rulingTurn } });
  };
}

function useTvSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "card") playClue();
    else if (e.type === "newCard") playPop();
    else if (e.type === "bid") playBlip();
    else if (e.type === "count") playTick();
    else if (e.type === "word") playDing(10);
    else if (e.type === "fail") playBuzz();
    else if (e.type === "cardWon") { if (e.reason === "nono") playBuzz(); else playRoundWon(); }
    else if (e.type === "cardVoid") playSoClose();
  });
}

// ---------- The look's pieces ----------
// The wordmark: WORD in paper letters, BUDGET on a yellow price tag.
const Logo = ({ className = "" }) => (
  <span className={"wb-logo " + className} role="img" aria-label="Word Budget">
    <span className="wb-logo-word" aria-hidden="true">Word</span>
    <span className="wb-logo-tag" aria-hidden="true">Budget</span>
  </span>
);
// Time left on a server deadline, ticking four times a second.
function useRemaining(deadline, serverNow) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!deadline) { setRemaining(null); return; }
    const startedAt = Date.now(), start = Math.max(0, deadline - serverNow);
    const update = () => setRemaining(Math.max(0, start - (Date.now() - startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline, serverNow]);
  return deadline ? remaining : null;
}
const clockText = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s));
// The clock: a ring that empties as the time runs out, the seconds in the middle. Red with a pulse in the last five.
function Clock({ deadline, serverNow, total, label, className = "" }) {
  const ms = useRemaining(deadline, serverNow);
  if (ms == null) return null;
  const s = Math.ceil(ms / 1000), frac = total ? Math.max(0, Math.min(1, ms / total)) : 1;
  return (
    <div className={"wb-clock" + (s <= 5 ? " is-low" : "") + (s >= 60 ? " is-long" : "") + (className ? ` ${className}` : "")} role="timer" aria-label={`${label ? `${label}: ` : ""}${s} seconds left`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="wb-clock-track" cx="50" cy="50" r="43" />
        <circle className="wb-clock-fill" cx="50" cy="50" r="43" pathLength="100" strokeDasharray={`${(frac * 100).toFixed(2)} 100`} />
      </svg>
      <b aria-hidden="true">{clockText(s)}</b>
      {label && <small aria-hidden="true">{label}</small>}
    </div>
  );
}
const PhaseClock = ({ game, label, className }) => <Clock deadline={game.turn?.deadline} serverNow={game.serverNow} total={phaseMs(game, game.turn?.phase)} label={label} className={className} />;
// A team's number in a sticker dot of its colour, so teams are told apart by more than colour.
const TeamDot = ({ game, team }) => <span className={`wb-dot ${teamClass(game, team?.id)}`} aria-hidden="true">{teamIndex(game, team?.id) + 1}</span>;
// The bid on a price tag: the number big, who holds it underneath.
function BidTag({ game, turn, size = "" }) {
  const leader = teamById(game, turn.bid?.teamId);
  return (
    <div className={"wb-bidtag" + (leader ? ` ${teamClass(game, leader.id)}` : " is-idle") + (size ? ` is-${size}` : "")} role="status" aria-label={leader ? `${leader.name} bids ${turn.bid.amount} words` : `No bids yet: ${teamById(game, turn.starterId)?.name} takes it at ${START_BID}`}>
      <span className="wb-bidtag-kicker" aria-hidden="true">{leader ? <><TeamDot game={game} team={leader} />{leader.name} can do it in</> : "Nobody has bid"}</span>
      <b aria-hidden="true">{turn.bid?.amount ?? START_BID}</b>
      <span className="wb-bidtag-unit" aria-hidden="true">{leader ? "words" : `${teamById(game, turn.starterId)?.name} takes it at ${START_BID}`}</span>
    </div>
  );
}
// The budget: words left big, then a pip for every word in the budget, crossed out as each clue word is counted.
// Over budget it goes red with an X, and the extra words show as red pips.
function BudgetMeter({ turn, size = "" }) {
  const over = turn.used > turn.budget, rest = Math.max(0, turn.budget - turn.used);
  return (
    <div className={"wb-budget" + (over ? " is-over" : rest === 0 ? " is-last" : "") + (size ? ` is-${size}` : "")} role="status" aria-label={over ? `Over budget: ${turn.used} words of ${turn.budget}` : `${rest} words left of ${turn.budget}`}>
      <span className="wb-budget-label" aria-hidden="true">{over ? "Over budget" : "Words left"}</span>
      <b className="wb-budget-num" aria-hidden="true">{over && <XIcon />}{over ? turn.used : rest}</b>
      <span className="wb-budget-sub" aria-hidden="true">{turn.used} of {turn.budget} said</span>
      <span className="wb-pips" aria-hidden="true">
        {Array.from({ length: Math.max(turn.budget, turn.used) }, (_, i) => <i key={i} className={i >= turn.budget ? "is-over" : i < turn.used ? "is-used" : ""} />)}
      </span>
    </div>
  );
}
// The card: five words on a paper card. words: the text for each slot (null for a word the viewer can't see yet).
// onTap makes each word a key; locked(mark) says which keys don't take taps. compact: slimmer rows (while bidding).
function WordCard({ words, marks, onTap, locked = () => false, tapHint = "Tap", size = "", compact = false, label = "The card", loading = false }) {
  return (
    <ol className={"wb-card" + (size ? ` is-${size}` : "") + (compact ? " is-compact" : "") + (onTap ? " is-keys" : "")} aria-label={label}>
      {marks.map((mark, i) => {
        const word = words?.[i], hidden = !word;
        const tag = STATUS[mark] || (onTap && !locked(mark) ? tapHint : "");
        const inner = (
          <>
            <span className="wb-word-badge" aria-hidden="true">{mark === "got" || mark === "stolen" ? <Check /> : mark === "missed" ? <XIcon /> : i + 1}</span>
            <span className="wb-word-text">{hidden ? <span className="wb-word-blank">{loading ? "Loading…" : <span className="sr-only">Not said yet</span>}</span> : word}</span>
            {tag ? <em>{tag}</em> : null}
          </>
        );
        return (
          <li key={`${i}-${mark}-${hidden ? "h" : "s"}`} className={`wb-word is-${mark}` + (hidden ? " is-hidden" : "")}>
            {onTap ? <button type="button" className="wb-word-row" disabled={locked(mark)} onClick={() => onTap(i)}>{inner}</button> : <div className="wb-word-row">{inner}</div>}
          </li>
        );
      })}
    </ol>
  );
}
const blankMarks = Array(CARD_SIZE).fill("waiting");

// ---------- Setup ----------
export function BudgetSetup({ onCreate }) {
  const [cardsToWin, setCardsToWin] = useState(() => Number(read(CARDS_KEY, ["5", "7", "10"], "10"))),
    [scoring, setScoring] = useState(() => read(SCORING_KEY, ["cards", "points"], "cards")),
    [chosen, setChosen] = useState(readCategories),
    [hostless, setHostless] = useState(false),
    [practice, setPractice] = useState(true),
    [sound, setSound] = useState(() => !isMuted()),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const choose = (list) => { setChosen(list); remember(CATEGORIES_KEY, JSON.stringify(list)); };
  const toggle = (name) => choose(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]);
  const wordCount = new Set(wordsIn(chosen).map((w) => w.toLowerCase())).size, enough = wordCount >= CARD_SIZE * 2;
  const start = () => {
    setNotice(""); setBusy(true);
    onCreate({ game: "budget", words: dealWords(chosen), cardsToWin, scoring, hostless, tutorial: practice }, (e) => { setBusy(false); setNotice(e); });
  };
  return (
    <main className="wb-setup">
      <BackToHub />
      <Logo className="is-setup" />
      <section className="wb-setup-card">
        <h1>Set up Word Budget</h1>
        <p className="wb-lede">Two teams. Both clue-givers get {secs(BUDGET_TIMES.peekMs)} seconds with a card of five words, then bid down from 25: “we can get all five in 14 words.” The lowest bid has {secs(BUDGET_TIMES.playMs)} seconds to get there, and every clue word counts.</p>
        <fieldset className="wb-field">
          <legend>Cards to win</legend>
          <div className="wb-choices" role="radiogroup" aria-label="Cards to win">
            {[5, 7, 10].map((n) => <button key={n} type="button" role="radio" aria-checked={cardsToWin === n} onClick={() => { setCardsToWin(n); remember(CARDS_KEY, String(n)); }}>{n} cards</button>)}
          </div>
          <p className="wb-hint">About three minutes a card. Five cards is a short game; ten is the classic length.</p>
        </fieldset>
        <fieldset className="wb-field">
          <legend>Winning</legend>
          <div className="wb-choices" role="radiogroup" aria-label="Winning">
            {Object.entries(SCORING).map(([id, { label }]) => <button key={id} type="button" role="radio" aria-checked={scoring === id} onClick={() => { setScoring(id); remember(SCORING_KEY, id); }}>{label}</button>)}
          </div>
          <p className="wb-hint">{SCORING[scoring].note}</p>
        </fieldset>
        <fieldset className="wb-field">
          <legend>Word categories</legend>
          <p className="wb-hint">Each card is five random words from the categories you leave on, mixed together. Players never see a category.</p>
          <div className="wb-cats-tools">
            <button type="button" className="wb-chip" onClick={() => choose(ALL_CATEGORIES)} disabled={chosen.length === ALL_CATEGORIES.length}>All</button>
            <button type="button" className="wb-chip" onClick={() => choose([])} disabled={!chosen.length}>None</button>
            <span>{chosen.length} of {ALL_CATEGORIES.length} on · {wordCount} words</span>
          </div>
          <div className="wb-cats" role="group" aria-label="Word categories">
            {ALL_CATEGORIES.map((name) => <button key={name} type="button" role="checkbox" aria-checked={chosen.includes(name)} onClick={() => toggle(name)}>{name}</button>)}
          </div>
          {!enough && <p className="wb-notice" role="alert">Turn on categories with at least {CARD_SIZE * 2} words between them.</p>}
        </fieldset>
        <section className="wb-field" aria-labelledby="wb-options-title">
          <h2 id="wb-options-title" className="wb-legend">Game options</h2>
          <label className="wb-option">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The team that isn’t guessing keeps track: the other clue-giver counts every clue word, checks off each word said and calls no-nos from their phone, and the game moves on by itself. With a host, the host does all of that from the controller, and phones only bid.</small></span>
          </label>
          <label className="wb-option">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            <span><b>Practice round first</b><small>One practice card before card one, with tips on the TV and every phone: the look, bidding the budget down, clueing while every word is counted, going over the budget, and the steal. Nothing scores, and it takes about two minutes. {hostless ? "Players can vote to skip it." : "The host can skip it."}</small></span>
          </label>
          <label className="wb-option">
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); setMuted(!e.target.checked); }} />
            <span><b>Sound on the TV</b><small>A tick for every word counted, a ding for every word guessed, a buzzer for a no-no or a blown budget. You can switch it off on the TV any time.</small></span>
          </label>
        </section>
        <div className="wb-setup-go">
          <p>First to {scoring === "points" ? `${cardsToWin * 10} points` : `${cardsToWin} cards`} · two teams of two or more · up to 16 players</p>
          <button className="wb-btn is-go" disabled={busy || !enough} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="wb-notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- Shared pieces ----------
const SpeakerIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />}
  </svg>
);
function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return <button className="sv-sound wb-rail-btn" aria-pressed={!muted} onClick={toggle}><SpeakerIcon off={muted} />{muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}</button>;
}
// Cards won as a row of card-shaped pips toward the target (points mode shows the total only).
function CardPips({ game, team }) {
  if (game.scoring === "points") return null;
  return (
    <span className="wb-cardpips" role="img" aria-label={`${plural(team.cards, "card")} of ${game.target}`}>
      {Array.from({ length: game.target }, (_, i) => <i key={i} className={i < team.cards ? "is-won" : ""} />)}
    </span>
  );
}
function Scoreboard({ game }) {
  const turn = game.turn;
  return (
    <section className="wb-teams" aria-label="Scores">
      <h2 className="wb-kicker">First to {game.scoring === "points" ? `${game.target} points` : plural(game.target, "card")}</h2>
      {game.teams.map((team) => {
        const playing = turn?.control === team.id && turn.phase === "play", stealing = turn?.stealTeamId === team.id && turn.phase === "steal";
        return (
          <article key={team.id} className={`wb-team ${teamClass(game, team.id)}` + (playing || stealing ? " is-turn" : "")}>
            <header><TeamDot game={game} team={team} /><b>{team.name}</b>{(playing || stealing) && <em>{stealing ? "Stealing" : "Playing"}</em>}</header>
            <p className="wb-team-score"><b>{progress(game, team)}</b><span>{game.scoring === "points" ? "points" : team.cards === 1 ? "card" : "cards"}</span></p>
            <CardPips game={game} team={team} />
            <small>{names(game, team.members)}</small>
            <small className="wb-saved">{game.scoring === "points" ? `${plural(team.cards, "card")} · ` : ""}{plural(team.bonus, "word")} saved</small>
          </article>
        );
      })}
    </section>
  );
}
function resultLine(game, turn) {
  const r = turn.result, winner = teamById(game, r?.winnerId), control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  if (!r) return { head: "", sub: "" };
  if (r.reason === "cleared") return { head: `${winner.name} wins the card!`, sub: !turn.used ? `All five without a single clue word: ${plural(r.bonus, "word")} saved.` : r.bonus ? `All five in ${turn.used} of ${turn.budget} words: ${plural(r.bonus, "word")} saved.` : `All five, right on budget at ${turn.budget} words.` };
  if (r.reason === "nono") return { head: `No-no! The card goes to ${winner.name}.`, sub: `${game.hostless ? nameOf(game, turn.judgeId) : "The host"} called it on ${nameOf(game, turn.clueGiverId)}.` };
  const why = r.failReason === "time" ? `${control?.name} ran out of time` : `${control?.name} went over budget (${turn.used} words of ${turn.budget})`;
  if (r.reason === "stolen") return { head: `${winner.name} steals the card!`, sub: `${why}, and ${winner.name} said every word left.` };
  if (r.reason === "stealMissed") return { head: "Nobody gets the card", sub: `${why}, and ${steal?.name} couldn’t steal it.` };
  return { head: winner ? `The host gives the card to ${winner.name}` : "The host voids the card", sub: "" };
}
// What went wrong (red, with an X) or right (green, with a check) on a card.
function ResultTags({ turn, inline = false }) {
  const r = turn.result;
  if (!r) return null;
  const failed = r.failReason && ["stolen", "stealMissed"].includes(r.reason);
  const Wrap = inline ? React.Fragment : "p";
  return (
    <Wrap {...(inline ? {} : { className: "wb-tags" })}>
      {r.reason === "nono" && <span className="wb-tag is-bad"><XIcon />No-no</span>}
      {failed && <span className="wb-tag is-bad"><XIcon />{r.failReason === "time" ? "Out of time" : "Over budget"}</span>}
      {r.reason === "stolen" && <span className="wb-tag is-good"><Check />Stolen</span>}
      {r.reason === "stealMissed" && <span className="wb-tag is-bad"><XIcon />Steal missed</span>}
      {r.reason === "cleared" && <span className="wb-tag is-good"><Check />Cleared{r.bonus ? ` · ${plural(r.bonus, "word")} saved` : ""}</span>}
    </Wrap>
  );
}
// Who keeps track of the words on this card, for the screens' instructions.
const trackerLine = (game, turn) => (game.hostless ? `${nameOf(game, turn.judgeId)} counts every word and checks them off` : "The host counts every word and checks them off");

// ---------- The practice card's coach (see docs/tutorial.md) ----------
// What to do at each step, on the TV, the host controller and the phones. The step is the practice card's phase
// (server/budget.js): the look, the bidding, the clue-giving with every word tracked, the steal, and the result.
const giversOf = (game) => Object.values(game.turn?.givers || {}).filter(Boolean);
const teamNameOf = (game, id) => teamById(game, id)?.name || "the other team";
const BUDGET_COACH = {
  peek: {
    tv: ({ game }) => `The practice card. ${names(game, giversOf(game))}, your team’s clue-givers, look at its five words on their phones. Nobody else sees them, and the TV shows a word only once it’s been said.`,
    controller: "You see the card too. Bidding opens when the look clock runs out, or tap Open the bidding once both clue-givers have read it.",
    phone: ({ game, me }) => giversOf(game).includes(me) ? "You’re your team’s clue-giver for this card. Learn the five words: next you bid on how few clue words you need." : `${names(game, giversOf(game))} are reading the card. Clue-givers take turns, so your go is coming.`,
  },
  bid: {
    tv: ({ game }) => `Bidding: from 25 down, each clue-giver bids how few clue words they need to get all five. Every bid restarts the shot clock; when it runs out, the lowest bid plays the card. No bids, and ${teamNameOf(game, game.turn?.starterId)} plays it at 25.`,
    controller: "The clue-givers bid on their phones, or tap a team’s bid here. Tap Close the bidding to move on.",
    phone: ({ game, me }) => {
      const turn = game.turn, mine = teamOfPlayer(game, me);
      if (!giversOf(game).includes(me)) return "Your clue-giver is bidding. The lowest bid when the shot clock runs out plays the card.";
      return turn?.bid?.teamId === mine?.id ? "You’re lowest. If the other clue-giver doesn’t go under you, you clue it." : "Bid lower to win the card, but then your clues must fit the bid. Try a bid!";
    },
  },
  play: {
    tv: ({ game }) => {
      const turn = game.turn;
      return `${nameOf(game, turn.clueGiverId)} clues ${teamNameOf(game, turn.control)}, and every clue word counts. ${game.hostless ? `${nameOf(game, turn.judgeId)}, from the other team,` : "The host"} taps +1 for each word and checks off each one guessed. For practice, keep clueing past the budget and see what happens.`;
    },
    controller: "Tap +1 for every clue word, and tap each word when the team says it. For practice, keep counting past the budget: one word over ends the turn.",
    phone: ({ game, me }) => {
      const turn = game.turn;
      if (turn.clueGiverId === me) return "Clue your team, in any order. Every word you say counts, so keep it short. For practice, keep talking past the budget.";
      if (game.hostless && turn.judgeId === me) return "You keep track for the other team: tap +1 for every word they say, and tap each word their team gets. Keep counting past the budget.";
      if (teamOfPlayer(game, me)?.id === turn.control) return "Shout your guesses! Each word you get is checked off on the TV.";
      return "Watch the budget. If they go over or run out of time, your team gets to steal.";
    },
  },
  steal: {
    tv: ({ game }) => {
      const turn = game.turn, why = turn.failReason === "time" ? "The clock ran out" : "One word over the budget";
      return `${why}: that ends the turn, and ${teamNameOf(game, turn.stealTeamId)} gets a steal. They say every word left, using only the clues already given. All of them wins the card; miss one and nobody gets it.`;
    },
    controller: "Tap each word the stealing team says. Tap End the steal when they’re done.",
    phone: ({ game, me }) => {
      const turn = game.turn;
      if (turn.clueGiverId === me) return game.hostless ? "Your team lost it. Check off each word the other team says, fairly: the TV shows the whole card after." : "The other team is stealing, and the host checks off what they say. Not a word!";
      if (turn.judgeId === me) return "You know the card, so not a word! Your team is stealing.";
      if (teamOfPlayer(game, me)?.id === turn.stealTeamId) return "Steal! Shout the words left, using only the clues you’ve heard.";
      return "The other team is stealing. No help from you!";
    },
  },
  done: {
    tv: ({ game }) => `That’s the practice! In a real game the card counts toward the target, and words left in a cleared budget are saved for the tiebreak. Both teams start at 0: ${game.hostless ? "card one starts in a few seconds." : "the host starts card one."}`,
    controller: "That’s the practice. Tap Start the game for card one, with both teams at 0.",
    phone: ({ game }) => `That’s the practice! Both teams start at 0, and ${game.hostless ? "card one starts in a few seconds." : "the host starts card one."}`,
    skip: "Start the game",
  },
};

// ---------- Shared TV display ----------
function JoinCorner({ code }) {
  const base = useJoinBase();
  return (
    <div className="wb-joincorner">
      <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} className="wb-qr-small" />
      <span>Join at <b>{displayAddress(base)}</b><span className="wb-code is-small" aria-label={`code ${code.split("").join(" ")}`}>{code.split("").map((c, i) => <i key={i} aria-hidden="true">{c}</i>)}</span></span>
    </div>
  );
}
function Lobby({ game, onAction }) {
  const base = useJoinBase();
  const connected = (id) => game.players.find((p) => p.id === id)?.connected;
  const ready = game.teams.every((team) => team.members.filter(connected).length >= 2);
  const smaller = [...game.teams].sort((a, b) => a.members.length - b.members.length)[0];
  return (
    <div className="wb-lobby">
      <div className="wb-join">
        <div className="wb-join-code">
          <h1 className="wb-kicker">Join the game</h1>
          <span className="wb-code" aria-label={`Room code ${game.code.split("").join(" ")}`}>{game.code.split("").map((c, i) => <i key={i} aria-hidden="true" style={{ "--i": i }}>{c}</i>)}</span>
          <p>Scan the code, or open <b>{displayAddress(base)}</b> on your phone and key in the room code.</p>
        </div>
        <figure className="wb-qr">
          <QRCode value={joinLink(base, game.code)} label={`QR code to join game ${game.code}`} />
          <figcaption>Scan to join</figcaption>
        </figure>
      </div>
      <div className="wb-lobby-teams">
        {game.teams.map((team) => (
          <section key={team.id} className={`wb-lobby-team ${teamClass(game, team.id)}`} aria-label={team.name}>
            <h2><TeamDot game={game} team={team} />{team.name}<small>{plural(team.members.length, "player")}</small></h2>
            <ul>
              {team.members.map((id) => (
                <li key={id} className={connected(id) ? "" : "is-away"}>
                  <button type="button" onClick={() => onAction("movePlayer", { playerId: id, teamId: otherTeam(game, team.id).id })} aria-label={`${nameOf(game, id)}${connected(id) ? "" : " (reconnecting)"}: move to ${otherTeam(game, team.id).name}`}>
                    <span>{nameOf(game, id)}</span>{!connected(id) && <small>Away</small>}<SwapIcon />
                  </button>
                </li>
              ))}
              {team === smaller && game.players.length < 16 && <li className="is-open"><span>Next to join</span></li>}
            </ul>
          </section>
        ))}
      </div>
      <p className="wb-note">New players join the smaller team. Tap a name to move them to the other team.</p>
      <button className="wb-btn is-go wb-start" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="wb-note">Each team needs at least two players.</p>}
    </div>
  );
}
function Stage({ game, onAction }) {
  const turn = game.turn, control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  const passed = turn.passes.map((id) => teamById(game, id)?.name);
  const won = leaderOf(game);
  const phaseName = { peek: "Look", bid: "Bidding", play: "Clue it", steal: "Steal", done: "Result" }[turn.phase];
  return (
    <div className={`wb-center is-${turn.phase}`}>
      <div className="wb-round">
        <span className="wb-round-card">{game.tutorial ? "Practice card" : `Card ${turn.number}`}</span><span className="wb-round-phase">{phaseName}</span>
        {turn.phase === "steal" && <span className="wb-tag is-bad"><XIcon />{turn.failReason === "time" ? "Time’s up" : "Over budget"}</span>}
        {turn.phase === "done" && <ResultTags turn={turn} inline />}
      </div>
      {turn.phase === "peek" && (
        <>
          <h1 className="wb-headline"><em>{names(game, Object.values(turn.givers).filter(Boolean))}</em>: look at your phones</h1>
          <p className="wb-howto">Five words, eyes only. Bidding opens in a moment.</p>
          <div className="wb-play">
            <PhaseClock game={game} label="Look" className="is-big" />
            <WordCard marks={turn.marks} words={turn.slots} size="tv" />
          </div>
        </>
      )}
      {turn.phase === "bid" && (
        <>
          <div className="wb-bidboard">
            <BidTag game={game} turn={turn} size="tv" />
            <PhaseClock game={game} label="Shot clock" className="is-huge" />
          </div>
          <p className="wb-howto">Bid lower on your phone. Every bid restarts the {secs(timesOf(game).bidMs)}-second shot clock; when it runs out, the lowest bid plays.</p>
        </>
      )}
      {["peek", "bid"].includes(turn.phase) && passed.length > 0 && <p className="wb-pass-note">{passed.join(" and ")} {passed.length > 1 ? "pass" : "wants a new card"}…</p>}
      {turn.phase === "play" && (
        <>
          <h1 className="wb-headline"><em>{nameOf(game, turn.clueGiverId)}</em> clues <span className={`wb-teamname ${teamClass(game, control?.id)}`}>{control?.name}</span></h1>
          <p className="wb-howto">{trackerLine(game, turn)}. No rhymes, no “sounds like”, no gestures.</p>
          <div className="wb-play">
            <div className="wb-meters">
              <PhaseClock game={game} label="Clock" className="is-big" />
              <BudgetMeter turn={turn} size="tv" />
            </div>
            <WordCard marks={turn.marks} words={turn.slots} size="tv" />
          </div>
        </>
      )}
      {turn.phase === "steal" && (
        <>
          <div className="wb-steal" key={turn.id}>
            <h1 className="wb-steal-head"><span className={`wb-teamname ${teamClass(game, steal?.id)}`}>{steal?.name}</span> steal it!</h1>
            <p className="wb-howto">Say the {plural(left(turn), "word")} left, using only the clues you’ve heard. Get them all and the card is yours; miss one and nobody gets it. {game.hostless ? `${nameOf(game, turn.clueGiverId)} checks them off. ` : ""}{nameOf(game, turn.judgeId)} knows the card: no help!</p>
          </div>
          <div className="wb-play">
            <div className="wb-meters">
              <PhaseClock game={game} label="Steal" className="is-big is-steal" />
              {turn.failReason !== "time" && <BudgetMeter turn={turn} size="tv" />}
            </div>
            <WordCard marks={turn.marks} words={turn.slots} size="tv" />
          </div>
        </>
      )}
      {turn.phase === "done" && (() => {
        const { head, sub } = resultLine(game, turn), bad = !turn.result?.winnerId || turn.result?.reason === "nono";
        return (
          <>
            <h1 className={"wb-result" + (bad ? " is-bad" : "")}>{head}</h1>
            {sub && <p className="wb-howto">{sub}</p>}
            <WordCard marks={turn.marks} words={turn.slots} size="tv" />
            {won && <p className="wb-pass-note">{won.name} reaches {game.scoring === "points" ? `${game.target} points` : plural(game.target, "card")}: that’s the game!</p>}
          </>
        );
      })()}
      {!game.hostless && turn.phase === "done" && !game.tutorial && <button className="wb-btn is-go wb-next" onClick={() => onAction("next")}>{won ? "See the winners" : "Next card"}</button>}
    </div>
  );
}
export function BudgetDisplay({ game, onAction }) {
  const turn = game.turn, phase = turn?.phase;
  useTvSounds(game);
  useClockTicks(phase === "bid" ? turn.deadline : null, game.serverNow, 3);
  useClockTicks(phase === "play" || phase === "steal" ? turn.deadline : null, game.serverNow, 5);
  return (
    <main className="display wb wb-tv">
      <SoundToggle />
      <header className="wb-bar">
        <Logo />
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        {phase === "done" && game.hostless ? <PhaseClock game={game} label={game.tutorial ? "Card one" : "Next card"} className="is-small" /> : <span />}
      </header>
      <Coach game={game} coach={BUDGET_COACH} place="tv" />
      {game.status === "lobby" || !turn ? <Lobby game={game} onAction={onAction} /> : (
        <div className="wb-stage"><Stage game={game} onAction={onAction} /><Scoreboard game={game} /></div>
      )}
      {game.hostless && game.players.length > 0 && game.status === "playing" && (
        <details className="host-tools wb-host-tools">
          <summary>Host tools</summary>
          <div className="wb-tools-row">
            {["peek", "bid"].includes(phase) && <button className="wb-chip" onClick={() => onAction("newCard")}>New card</button>}
            {!game.tutorial && <button className="wb-chip is-danger" onClick={() => onAction("endGame")}>End game early</button>}
          </div>
        </details>
      )}
      {!game.hostless && (
        <a className="controller-link wb-rail-btn" href="?controller" onClick={(event) => { event.preventDefault(); sessionStorage.hostCode = game.code; window.open("?controller", "_blank"); }}>Open host controller</a>
      )}
    </main>
  );
}

// ---------- Player phone ----------
function BidPad({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId), myTeam = teamOfPlayer(game, playerId);
  const [typed, setTyped] = useState("");
  const current = turn.bid?.amount ?? START_BID + 1, leading = turn.bid?.teamId === myTeam?.id, open = turn.phase === "bid";
  const passed = turn.passes.includes(myTeam?.id);
  const bid = (amount) => { if (amount >= 1 && amount < current) { act("bid", { amount }); setTyped(""); } };
  const n = Math.trunc(Number(typed));
  return (
    <div className="wb-pad">
      <div className="wb-pad-top"><p className="wb-say">{open ? "Bid lower to take the card" : "Learn the card: bidding opens in a moment"}</p><PhaseClock game={game} className="is-small" /></div>
      <WordCard words={words} marks={blankMarks} size="phone" compact loading={!words} />
      <BidTag game={game} turn={turn} size="phone" />
      {leading ? <p className="wb-status is-you">You’re lowest. Hold your nerve…</p> : (
        <>
          <div className="wb-bid-steps">
            {[1, 3, 5].map((step) => <button key={step} type="button" disabled={!open || current - step < 1} onClick={() => bid(current - step)}><b>{current - step >= 1 ? current - step : "–"}</b><small>−{step}</small></button>)}
          </div>
          <form className="wb-bid-type" onSubmit={(e) => { e.preventDefault(); bid(n); }}>
            <input aria-label="Your bid" inputMode="numeric" pattern="[0-9]*" maxLength="2" value={typed} disabled={!open} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} placeholder={`1–${Math.min(START_BID, current - 1)}`} />
            <button className="wb-btn is-go" disabled={!open || !(n >= 1 && n < current)}>Bid {n >= 1 && n < current ? n : ""}</button>
          </form>
        </>
      )}
      <button type="button" className="wb-btn is-ghost" disabled={passed} onClick={() => act("pass")}>{passed ? `Waiting for ${otherTeam(game, myTeam?.id)?.name} to pass too…` : "Pass on this card"}</button>
    </div>
  );
}
// The clue-giver: the card to clue from (who checks words off is someone else's job), the budget and the clock.
function ClueGiverCard({ game, words }) {
  const turn = game.turn;
  return (
    <div className="wb-pad">
      <div className="wb-pad-top"><p className="wb-say">Clue <span className={`wb-teamname ${teamClass(game, turn.control)}`}>{teamById(game, turn.control)?.name}</span>! Any order.</p><PhaseClock game={game} className="is-small" /></div>
      <BudgetMeter turn={turn} size="phone" />
      <WordCard words={words} marks={turn.marks} size="phone" loading={!words} />
      <p className="wb-note">{trackerLine(game, turn)}. No rhymes, no “sounds like”, no gestures, and no part of an answer word.</p>
    </div>
  );
}
function NoNo({ onConfirm, label = "No-no!" }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!asking) return; const timer = setTimeout(() => setAsking(false), 5000); return () => clearTimeout(timer); }, [asking]);
  if (!asking) return <button type="button" className="wb-nono" onClick={() => setAsking(true)}><XIcon />{label}</button>;
  return (
    <div className="wb-nono-confirm" role="alertdialog" aria-label="Call a no-no?">
      <p>Call a no-no? The card goes to the other team.</p>
      <button type="button" className="wb-btn is-ghost" onClick={() => setAsking(false)}>Cancel</button>
      <button type="button" className="wb-nono" onClick={() => { setAsking(false); onConfirm(); }}><XIcon />Yes, no-no</button>
    </div>
  );
}
// The +1: the biggest key on the phone, a round yellow button with the count under it.
function PlusKey({ turn, onCount }) {
  const last = turn.used >= turn.budget;
  return (
    <button type="button" className={"wb-plus" + (last ? " is-last" : "")} onClick={onCount} aria-label={`Count a clue word: ${turn.used} of ${turn.budget}`}>
      <b>+1</b>
      <span className="wb-plus-count">{turn.used} of {turn.budget} words</span>
      {last && <span className="wb-plus-warn"><XIcon />One more ends it</span>}
    </button>
  );
}
// Tap a waiting word to check it off, a checked one to take it back.
const toggler = (marks, act) => (i) => act(marks[i] === "waiting" ? "mark" : "unmark", { index: i });
// The judge, without a host: +1 for every clue word, undo, the no-no, and the card to check off each word said.
function JudgePad({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId);
  return (
    <div className="wb-pad">
      <div className="wb-pad-top"><p className="wb-say">You keep track. Count every word {nameOf(game, turn.clueGiverId)} says.</p><PhaseClock game={game} className="is-small" /></div>
      <PlusKey turn={turn} onCount={() => act("countWord")} />
      <div className="wb-row2">
        <button type="button" className="wb-btn is-ghost" disabled={!turn.used} onClick={() => act("uncount")}>Undo</button>
        <NoNo onConfirm={() => act("nono")} />
      </div>
      <p className="wb-say is-small">Tap each word when {teamById(game, turn.control)?.name} says it:</p>
      <WordCard words={words} marks={turn.marks} size="phone" loading={!words} onTap={toggler(turn.marks, act)} locked={(m) => m !== "waiting" && m !== "got"} />
    </div>
  );
}
// The clue-giver during a steal: the card with the words their team already got, and the ones the other team still
// needs. Without a host they check off the stealing team's words; with one, they just follow along.
function StealCard({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId), steal = teamById(game, turn.stealTeamId);
  const confirm = game.hostless;
  return (
    <div className="wb-pad">
      <div className="wb-pad-top"><p className="wb-say"><span className={`wb-teamname ${teamClass(game, steal?.id)}`}>{steal?.name}</span> is stealing: {plural(left(turn), "word")} to go.</p><PhaseClock game={game} className="is-small" /></div>
      <WordCard words={words} marks={turn.marks} size="phone" loading={!words} label="The card in the steal"
        {...(confirm ? { onTap: toggler(turn.marks, act), locked: (m) => m !== "waiting" && m !== "stolen", tapHint: "Tap if said" } : {})} />
      <p className="wb-note">{confirm ? "Tap each word they say. Play fair: the TV shows the whole card after." : "The host checks off what they say. Not a word from you!"}</p>
    </div>
  );
}
function Waiting({ children, you = false, sub }) {
  return <div className="wb-wait"><p className={"wb-status" + (you ? " is-you" : "")}>{children}</p>{sub && <p className="wb-note">{sub}</p>}</div>;
}
function PlayerAction({ game, playerId }) {
  const turn = game.turn, myTeam = teamOfPlayer(game, playerId);
  const giver = Object.values(turn.givers).includes(playerId), clueGiver = turn.clueGiverId === playerId, judge = turn.judgeId === playerId;
  // The same rule as the server's maySeeCard.
  const sees = (["peek", "bid"].includes(turn.phase) && giver) || (["play", "steal"].includes(turn.phase) && clueGiver) || (game.hostless && turn.phase === "play" && judge);
  const words = useCard(game, playerId, sees);
  const control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  if (["peek", "bid"].includes(turn.phase)) {
    if (giver) return <BidPad game={game} playerId={playerId} words={words} />;
    return (
      <div className="wb-pad">
        <Waiting sub={turn.phase === "peek" ? "They’re learning the card. Bidding opens in a moment." : "The lowest bid when the shot clock runs out plays the card."}>{names(game, Object.values(turn.givers).filter(Boolean))} {turn.phase === "peek" ? "are looking at the card" : "are bidding"}…</Waiting>
        <BidTag game={game} turn={turn} size="phone" />
      </div>
    );
  }
  if (turn.phase === "play") {
    if (clueGiver) return <ClueGiverCard game={game} words={words} />;
    if (judge && game.hostless) return <JudgePad game={game} playerId={playerId} words={words} />;
    if (myTeam?.id === turn.control) return (
      <div className="wb-pad">
        <Waiting you>Guess out loud! Any order.</Waiting>
        <div className="wb-mini"><p><b>{left(turn)}</b><span>of 5 to go</span></p><BudgetMeter turn={turn} size="phone" /></div>
        <PhaseClock game={game} label="Clock" />
      </div>
    );
    return <div className="wb-pad"><Waiting sub="No shouting answers! If they blow it, you get to steal.">{control?.name} is playing</Waiting><PhaseClock game={game} label="Clock" /></div>;
  }
  if (turn.phase === "steal") {
    if (clueGiver) return <StealCard game={game} playerId={playerId} words={words} />;
    if (judge) return <div className="wb-pad"><Waiting you sub={`Your team is stealing: ${plural(left(turn), "word")} to go.`}>You know the card. Not a word!</Waiting><PhaseClock game={game} label="Steal" /></div>;
    if (myTeam?.id === turn.stealTeamId) return (
      <div className="wb-pad wb-phone-steal">
        <h2 className="wb-steal-head">Steal it!</h2>
        <Waiting you sub="Only the clues you’ve already heard.">Shout the {plural(left(turn), "word")} left.</Waiting>
        <PhaseClock game={game} label="Steal" className="is-big" />
      </div>
    );
    return <div className="wb-pad"><Waiting>{steal?.name} is trying to steal the card…</Waiting><PhaseClock game={game} label="Steal" /></div>;
  }
  const { head, sub } = resultLine(game, turn);
  return <div className="wb-pad"><ResultTags turn={turn} /><p className="wb-status">{head}</p>{sub && <p className="wb-note">{sub}</p>}<WordCard marks={turn.marks} words={turn.slots} size="phone" /></div>;
}
export function BudgetPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), turn = game.turn, team = teamOfPlayer(game, playerId);
  const giver = turn && Object.values(turn.givers).includes(playerId);
  const myMove = turn && ((["peek", "bid"].includes(turn.phase) && giver) || (turn.phase === "play" && (turn.clueGiverId === playerId || (game.hostless && turn.judgeId === playerId))) || (turn.phase === "steal" && game.hostless && turn.clueGiverId === playerId));
  useEffect(() => { if (myMove) { try { navigator.vibrate?.(150); } catch {} } }, [myMove, turn?.phase, turn?.id]);
  if (!player) return <main className="player wb wb-phone"><p className="wb-status">You’re no longer in this game.</p></main>;
  const other = team && otherTeam(game, team.id);
  return (
    <main className="player wb wb-phone">
      <header className="wb-phone-bar"><Logo className="is-small" /><span className="wb-phone-name">{player.name}</span></header>
      <div className={"wb-myteam" + (team ? ` ${teamClass(game, team.id)}` : "")}>
        {team && <TeamDot game={game} team={team} />}
        <span className="wb-myteam-text"><b>{team ? team.name : "No team yet"}</b>{team && <small>{names(game, team.members)}</small>}</span>
        <span className="wb-myteam-score"><b>{team ? progress(game, team) : 0}</b><small>{team ? scoreLine(game, team).replace(/^\d+ /, "") : ""}</small></span>
      </div>
      {game.status === "lobby" || !turn ? (
        <div className="wb-pad">
          <Waiting you>You’re in!</Waiting>
          <p className="wb-note">{team && team.members.length < 2 ? "Waiting for a teammate…" : "The game starts when everyone’s here."}</p>
          {game.status === "lobby" && other && <button type="button" className="wb-btn is-ghost" onClick={() => socket.emit("budget:team", { code: game.code, playerId, teamId: other.id })}><SwapIcon />Switch to {other.name}</button>}
        </div>
      ) : (
        <>
          <p className="wb-meta">{game.tutorial ? "Practice card · nothing scores" : `Card ${turn.number} · first to ${game.target}`}</p>
          <Coach game={game} coach={BUDGET_COACH} place="phone" playerId={playerId} />
          <PlayerAction game={game} playerId={playerId} />
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
function TeamTools({ game, onAction }) {
  return (
    <ul className="wb-teamtools">
      {game.teams.map((team) => (
        <li key={team.id} className={teamClass(game, team.id)}>
          <TeamDot game={game} team={team} />
          <input aria-label={`${team.name}’s name`} defaultValue={team.name} key={team.name} maxLength="24" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== team.name && onAction("renameTeam", { teamId: team.id, name: e.target.value })} />
          <span className="wb-teamtools-cards"><b>{team.cards}</b><small>{team.cards === 1 ? "card" : "cards"}</small></span>
          <button className="wb-chip" aria-label={`Give ${team.name} a card`} onClick={() => onAction("adjustScore", { teamId: team.id, amount: 1 })}>+1</button>
          <button className="wb-chip is-danger" aria-label={`Take a card from ${team.name}`} onClick={() => onAction("adjustScore", { teamId: team.id, amount: -1 })}>−1</button>
        </li>
      ))}
    </ul>
  );
}
export function BudgetController({ game, onAction }) {
  const turn = game.turn, phase = turn?.phase;
  const words = useCard(game, undefined, !game.hostless && !!turn && phase !== "done");
  const header = <header className="wb-phone-bar"><Logo className="is-small" /><span className="wb-code is-small" aria-label={`Game code ${game.code.split("").join(" ")}`}>{game.code.split("").map((c, i) => <i key={i} aria-hidden="true">{c}</i>)}</span></header>;
  if (game.status === "lobby" || !turn)
    return <main className="controller wb wb-phone">{header}<h1 className="wb-ctrl-title">Lobby</h1><p className="wb-note">Start the game from the main screen. Move players between teams by tapping their names there.</p><section className="wb-ctrl-teams"><h2 className="wb-kicker">Teams</h2><TeamTools game={game} onAction={onAction} /></section></main>;
  const current = turn.bid?.amount ?? START_BID + 1, control = teamById(game, turn.control);
  const toggle = (i) => onAction(turn.marks[i] === "waiting" ? "mark" : "unmark", { index: i });
  const nextLabel = { peek: "Open the bidding", bid: "Close the bidding", play: "Stop the clock (a fail)", steal: "End the steal", done: leaderOf(game) ? "See the winners" : "Next card" }[phase];
  return (
    <main className="controller wb wb-phone">
      {header}
      <Coach game={game} coach={BUDGET_COACH} place="controller" />
      <div className="wb-pad-top">
        <p className="wb-meta">{game.tutorial ? "Practice card" : `Card ${turn.number}`} · {phase === "play" ? control?.name : { peek: "the look", bid: "bidding", steal: "the steal", done: "result" }[phase]}</p>
        <PhaseClock game={game} className="is-small" />
      </div>
      {["peek", "bid"].includes(phase) && (
        <div className="wb-pad">
          <WordCard words={words} marks={blankMarks} size="phone" loading={!words} />
          <BidTag game={game} turn={turn} size="phone" />
          {turn.passes.length > 0 && <p className="wb-note">{turn.passes.map((id) => teamById(game, id)?.name).join(" and ")} passed.</p>}
          {phase === "bid" && current > 1 && (
            <div className="wb-row2">
              {game.teams.filter((t) => t.id !== turn.bid?.teamId).map((team) => <button key={team.id} type="button" className="wb-btn is-ghost" onClick={() => onAction("bid", { teamId: team.id, amount: current - 1 })}>{team.name} bids {current - 1}</button>)}
            </div>
          )}
          <button type="button" className="wb-chip" onClick={() => onAction("newCard")}>New card</button>
        </div>
      )}
      {phase === "play" && (
        <div className="wb-pad">
          <p className="wb-say is-small">{nameOf(game, turn.clueGiverId)} clues {control?.name}. You keep track: +1 for every clue word, and tap each word when they say it (tap again to take it back).</p>
          <PlusKey turn={turn} onCount={() => onAction("countWord")} />
          <div className="wb-row2"><button type="button" className="wb-btn is-ghost" disabled={!turn.used} onClick={() => onAction("uncount")}>Undo</button><NoNo onConfirm={() => onAction("nono")} /></div>
          <WordCard words={words} marks={turn.marks} size="phone" loading={!words} onTap={toggle} />
        </div>
      )}
      {phase === "steal" && (
        <div className="wb-pad">
          <p className="wb-tags"><span className="wb-tag is-bad"><XIcon />{turn.failReason === "time" ? "Time’s up" : "Over budget"}</span></p>
          <p className="wb-say is-small">{teamById(game, turn.stealTeamId)?.name} is stealing. Tap each word they say.</p>
          <WordCard words={words} marks={turn.marks} size="phone" loading={!words} onTap={toggle} locked={(mark) => mark === "got"} tapHint="Tap if said" />
        </div>
      )}
      {phase === "done" && (
        <div className="wb-pad">
          <ResultTags turn={turn} />
          <p className="wb-status">{resultLine(game, turn).head}</p>
          <WordCard marks={turn.marks} words={turn.slots} size="phone" />
          {!game.tutorial && <div className="wb-row2 wb-award">
            {game.teams.map((team) => <button key={team.id} type="button" className="wb-chip" disabled={turn.result?.winnerId === team.id} onClick={() => onAction("award", { teamId: team.id })}>Give it to {team.name}</button>)}
            <button type="button" className="wb-chip" disabled={!turn.result?.winnerId} onClick={() => onAction("award", { teamId: null })}>Nobody</button>
          </div>}
        </div>
      )}
      {!(game.tutorial && phase === "done") && <button type="button" className="wb-btn is-go wb-wide" onClick={() => onAction("next")}>{nextLabel}</button>}
      {!game.tutorial && <div className="wb-tools-row"><button type="button" className="wb-chip is-danger" onClick={() => onAction("endGame")}>End game early</button></div>}
      <section className="wb-ctrl-teams"><h2 className="wb-kicker">Teams</h2><TeamTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
export function BudgetEnd({ game, host, display, onAction }) {
  const ranked = standings(game.teams, game.scoring);
  const tie = ranked.length > 1 && progress(game, ranked[0]) === progress(game, ranked[1]) && ranked[0].bonus === ranked[1].bonus;
  const byBonus = !tie && ranked.length > 1 && progress(game, ranked[0]) === progress(game, ranked[1]);
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  return (
    <main className={"end wb wb-end" + (display ? " wb-tv" : " wb-phone")}>
      {display && <SoundToggle />}
      <Logo />
      <h1 className={"wb-winner" + (tie ? "" : ` ${teamClass(game, ranked[0].id)}`)}>{tie ? "It’s a tie!" : <><span className="wb-teamname">{ranked[0].name}</span> wins!</>}</h1>
      {byBonus && <p className="wb-note">Level on {game.scoring === "points" ? "points" : "cards"}, so saved words decide it.</p>}
      <ol className="wb-podium">
        {ranked.map((t, i) => (
          <li className={`wb-place is-${i + 1} ${teamClass(game, t.id)}`} key={t.id}>
            <span className="wb-place-rank">{i + 1}</span>
            <span className="wb-place-name"><b><TeamDot game={game} team={t} />{t.name}</b><small>{names(game, t.members)} · {plural(t.bonus, "word")} saved</small></span>
            <span className="wb-place-score"><b>{game.scoring === "points" ? t.points : t.cards}</b><small>{game.scoring === "points" ? "points" : t.cards === 1 ? "card" : "cards"}</small></span>
          </li>
        ))}
      </ol>
      {host ? (
        <div className="wb-end-buttons">
          <button className="wb-btn is-go" onClick={() => onAction("replay", { words: dealWords(readCategories()) })}>Play again with new cards</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="wb-end-buttons"><p>Thanks for playing!</p><button className="wb-btn is-go" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
