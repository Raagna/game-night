// Word Budget screens: host setup, the shared TV display, players' phones, the host controller and the end.
// The card's five words only ever reach the two clue-givers' phones and the host controller (budget:card); the TV
// shows the bidding, the words-left board, the clock and each word once it's been said.
import React, { useEffect, useRef, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, setMuted, isMuted, useEventSounds, playWinnersTune, playBuzz, playDing, playRoundWon, playTick } from "../survey/sounds";
import { useClockTicks, playBlip, playSoClose } from "../wheel/sounds";
import { playClue, playPop } from "../fib/sounds";
import { repeatHostTap } from "../../server/taps.js";
import { standings } from "../../server/budget.js";
import WORDS from "../tongue/words.json";
import "./budget.css";
import Flap, { Brand, Money } from "../Flap";

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
const Check = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const left = (turn) => turn.marks.filter((m) => m === "waiting").length;
const scoreLine = (game, team) => (game.scoring === "points" ? `${team.points} pts` : plural(team.cards, "card"));

// The card's words for whoever may see them (the clue-givers, the judge or a host controller), fetched for each
// new card and whenever this phone gains or loses the right to see it.
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

// ---------- Setup ----------
export function BudgetSetup({ onCreate }) {
  const [cardsToWin, setCardsToWin] = useState(() => Number(read(CARDS_KEY, ["5", "7", "10"], "10"))),
    [scoring, setScoring] = useState(() => read(SCORING_KEY, ["cards", "points"], "cards")),
    [chosen, setChosen] = useState(readCategories),
    [hostless, setHostless] = useState(false),
    [sound, setSound] = useState(() => !isMuted()),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const choose = (list) => { setChosen(list); remember(CATEGORIES_KEY, JSON.stringify(list)); };
  const toggle = (name) => choose(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name]);
  const wordCount = new Set(wordsIn(chosen).map((w) => w.toLowerCase())).size, enough = wordCount >= CARD_SIZE * 2;
  const start = () => {
    setNotice(""); setBusy(true);
    onCreate({ game: "budget", words: dealWords(chosen), cardsToWin, scoring, hostless }, (e) => { setBusy(false); setNotice(e); });
  };
  return (
    <main className="setup wb-setup">
      <BackToHub />
      <Brand text="WORD BUDGET" className="wb-brand" />
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Word Budget</h1>
            <p className="muted">Two teams. Both clue-givers see a card of five words, then bid down from 25: “we can get all five in 14 words.” The lowest bid plays, and the other clue-giver counts every word they say.</p>
          </div>
        </div>
        <fieldset className="ws-fieldset">
          <legend>Cards to win</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Cards to win">
            {[5, 7, 10].map((n) => <button key={n} role="radio" aria-checked={cardsToWin === n} onClick={() => { setCardsToWin(n); remember(CARDS_KEY, String(n)); }}>{n} cards</button>)}
          </div>
          <p className="muted sv-hint">About two minutes a card. Five cards is a short game; ten is the classic length.</p>
        </fieldset>
        <fieldset className="ws-fieldset">
          <legend>Winning</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Winning">
            {Object.entries(SCORING).map(([id, { label }]) => <button key={id} role="radio" aria-checked={scoring === id} onClick={() => { setScoring(id); remember(SCORING_KEY, id); }}>{label}</button>)}
          </div>
          <p className="muted sv-hint">{SCORING[scoring].note}</p>
        </fieldset>
        <fieldset className="ws-fieldset tt-cats-field">
          <legend>Word categories</legend>
          <p className="muted sv-hint">Each card is five random words from the categories you leave on, mixed together. Players never see a category.</p>
          <div className="tt-cats-tools">
            <button className="chip-btn" onClick={() => choose(ALL_CATEGORIES)} disabled={chosen.length === ALL_CATEGORIES.length}>All</button>
            <button className="chip-btn" onClick={() => choose([])} disabled={!chosen.length}>None</button>
            <span className="muted">{chosen.length} of {ALL_CATEGORIES.length} on · {wordCount} words</span>
          </div>
          <div className="tt-cats" role="group" aria-label="Word categories">
            {ALL_CATEGORIES.map((name) => <button key={name} role="checkbox" aria-checked={chosen.includes(name)} onClick={() => toggle(name)}>{name}</button>)}
          </div>
          {!enough && <p className="notice" role="alert">Turn on categories with at least {CARD_SIZE * 2} words between them.</p>}
        </fieldset>
        <section className="game-options" aria-labelledby="wb-options-title">
          <h2 id="wb-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The judge and clue-giver run each card from their phones, and the game moves on by itself. With a host, the controller sees every card and can count, mark words, call a no-no or give a card to either team.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); setMuted(!e.target.checked); }} />
            <span><b>Sound on the TV</b><small>A tick for every word counted, a ding for every word guessed, a buzzer for a no-no or a blown budget. You can switch it off on the TV any time.</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">First to {scoring === "points" ? `${cardsToWin * 10} points` : `${cardsToWin} cards`} · two teams of two or more · up to 16 players</p>
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
// Cards won as a row of lamps toward the target (points mode shows the total instead).
function CardLamps({ game, team }) {
  if (game.scoring === "points") return <b className="money">{team.points}</b>;
  return (
    <span className="wb-lamps" role="img" aria-label={`${plural(team.cards, "card")} of ${game.target}`}>
      {Array.from({ length: game.target }, (_, i) => <i key={i} className={i < team.cards ? "is-lit" : ""} />)}
    </span>
  );
}
function Scoreboard({ game }) {
  const turn = game.turn;
  return (
    <section className="fib-scoreboard wb-scoreboard" aria-label="Scores">
      <h2>First to {game.scoring === "points" ? `${game.target} points` : plural(game.target, "card")}</h2>
      <ol>
        {game.teams.map((team) => (
          <li key={team.id} className={turn?.control === team.id && ["play", "steal"].includes(turn.phase) ? "is-turn" : ""}>
            <span className="fib-sb-name">{team.name}<small> · {names(game, team.members)}</small></span>
            <CardLamps game={game} team={team} />
            <small className="wb-saved">{team.cards} {team.cards === 1 ? "card" : "cards"} · {plural(team.bonus, "word")} saved</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
// The card's five slots: blank until a word is said (the text arrives in the public state only then).
function Slots({ turn, big = false }) {
  return (
    <ol className={"wb-slots" + (big ? " is-big" : "")} aria-label="The card">
      {turn.marks.map((mark, i) => (
        <li key={i} className={`is-${mark}`}>
          {turn.slots[i] ? <span>{turn.slots[i]}</span> : <span className="wb-slot-blank" aria-label="Not said yet">?</span>}
          {STATUS[mark] && turn.phase === "done" && <em>{(mark === "got" || mark === "stolen") && <Check />}{STATUS[mark]}</em>}
        </li>
      ))}
    </ol>
  );
}
function resultLine(game, turn) {
  const r = turn.result, winner = teamById(game, r?.winnerId), control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  if (!r) return { head: "", sub: "" };
  if (r.reason === "cleared") return { head: `${winner.name} wins the card!`, sub: !turn.used ? `All five without a single clue word: ${plural(r.bonus, "word")} saved.` : r.bonus ? `All five in ${turn.used} of ${turn.budget} words: ${plural(r.bonus, "word")} saved.` : `All five, right on budget at ${turn.budget} words.` };
  if (r.reason === "nono") return { head: `No-no! The card goes to ${winner.name}.`, sub: `${nameOf(game, turn.judgeId)} called it on ${nameOf(game, turn.clueGiverId)}.` };
  const why = r.failReason === "time" ? `${control?.name} ran out of time` : `${control?.name} went over budget (${turn.used} words of ${turn.budget})`;
  if (r.reason === "stolen") return { head: `${winner.name} steals the card!`, sub: `${why}, and ${winner.name} said every word left.` };
  if (r.reason === "stealMissed") return { head: "Nobody gets the card", sub: `${why}, and ${steal?.name} couldn’t steal it.` };
  return { head: winner ? `The host gives the card to ${winner.name}` : "The host voids the card", sub: "" };
}

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const connected = (id) => game.players.find((p) => p.id === id)?.connected;
  const ready = game.teams.every((team) => team.members.filter(connected).length >= 2);
  return (
    <div className="lobby fib-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <ul className="tt-lobby-teams wb-lobby-teams">
        {game.teams.map((team) => (
          <li key={team.id}>
            <h2>{team.name}</h2>
            {team.members.map((id) => <button key={id} onClick={() => onAction("movePlayer", { playerId: id, teamId: otherTeam(game, team.id).id })} aria-label={`Move ${nameOf(game, id)} to ${otherTeam(game, team.id).name}`}>{nameOf(game, id)}</button>)}
            {team.members.length < 2 && <span className="muted">Needs {plural(2 - team.members.length, "more player")}</span>}
          </li>
        ))}
      </ul>
      <p className="muted">New players join the smaller team. Tap a name to move them to the other team.</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="muted">Each team needs at least two players.</p>}
    </div>
  );
}
function BidBoard({ game }) {
  const turn = game.turn, leader = teamById(game, turn.bid?.teamId), starter = teamById(game, turn.starterId);
  return (
    <div className="wb-bidboard">
      <div className="wb-bid-main">
        <span className="wb-board-label">{leader ? `${leader.name} can do it in` : "Nobody has bid"}</span>
        <b className={"wb-board-number" + (leader ? "" : " is-idle")} key={turn.bid?.amount}>{turn.bid?.amount ?? START_BID}</b>
        <span className="wb-board-label">{leader ? `words · ${nameOf(game, turn.bid && turn.givers[turn.bid.teamId])}` : `${starter?.name} takes it at ${START_BID} if nobody bids`}</span>
      </div>
      <div className="wb-shot" aria-label="Shot clock"><span className="wb-board-label">Shot clock</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
    </div>
  );
}
function Stage({ game, onAction }) {
  const turn = game.turn, control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  const passed = turn.passes.map((id) => teamById(game, id)?.name);
  const won = leaderOf(game);
  return (
    <div className="fib-center wb-center">
      <p className="sv-round-label">Card {turn.number}<em>{turn.phase === "peek" ? "Look" : turn.phase === "bid" ? "Bidding" : turn.phase === "play" ? control?.name : turn.phase === "steal" ? "Steal!" : "Result"}</em></p>
      {turn.phase === "peek" && (
        <>
          <h1 className="tt-headline">{names(game, Object.values(turn.givers).filter(Boolean))}: look at your phones<small>Five words, eyes only. Bidding opens in a moment.</small></h1>
          <Slots turn={turn} />
        </>
      )}
      {turn.phase === "bid" && <><BidBoard game={game} /><p className="wb-howto">Bid lower on your phone. Every bid restarts the shot clock; when it runs out, the lowest bid plays.</p></>}
      {["peek", "bid"].includes(turn.phase) && passed.length > 0 && <p className="wb-pass-note">{passed.join(" and ")} {passed.length > 1 ? "pass" : "wants a new card"}…</p>}
      {turn.phase === "play" && (
        <>
          <h1 className="tt-headline wb-headline">{nameOf(game, turn.clueGiverId)} clues {control?.name}<small>{nameOf(game, turn.judgeId)} counts every word</small></h1>
          <div className="wb-countdown" role="status" aria-label={`${turn.budget - turn.used} words left of ${turn.budget}`}>
            <b className="wb-board-number" key={turn.used}>{turn.budget - turn.used}</b>
            <span className="wb-board-label">words left of {turn.budget}</span>
          </div>
          <Slots turn={turn} big />
        </>
      )}
      {turn.phase === "steal" && (
        <>
          <h1 className="tt-headline wb-steal-head">{steal?.name}: steal it!<small>{turn.failReason === "time" ? "Time’s up" : "Over budget"}. Say the {plural(left(turn), "word")} left, using only the clues you’ve heard. Get them all and the card is yours; miss one and nobody gets it. {nameOf(game, turn.judgeId)} knows the card: no help!</small></h1>
          <Slots turn={turn} big />
        </>
      )}
      {turn.phase === "done" && (() => {
        const { head, sub } = resultLine(game, turn);
        return (
          <>
            <h1 className="tt-headline">{head}{sub && <small>{sub}</small>}</h1>
            <Slots turn={turn} big />
            {won && <p className="wb-pass-note">{won.name} reaches {game.scoring === "points" ? `${game.target} points` : plural(game.target, "card")}: that’s the game!</p>}
          </>
        );
      })()}
      {!game.hostless && turn.phase === "done" && <button className="primary sv-next" onClick={() => onAction("next")}>{won ? "See the winners" : "Next card"}</button>}
    </div>
  );
}
export function BudgetDisplay({ game, onAction }) {
  const turn = game.turn, phase = turn?.phase;
  useTvSounds(game);
  useClockTicks(phase === "bid" ? turn.deadline : null, game.serverNow, 3);
  useClockTicks(phase === "play" || phase === "steal" ? turn.deadline : null, game.serverNow, 5);
  return (
    <main className="display wb">
      <SoundToggle />
      <header className="display-bar">
        <Brand text="WORD BUDGET" className="wb-brand" />
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        {phase !== "bid" && <ClueTimer deadline={turn?.deadline} serverNow={game.serverNow} />}
      </header>
      {game.status === "lobby" || !turn ? <Lobby game={game} onAction={onAction} /> : (
        <div className="fib-stage"><Stage game={game} onAction={onAction} /><Scoreboard game={game} /></div>
      )}
      {game.hostless && game.players.length > 0 && game.status === "playing" && (
        <details className="host-tools sv-host-tools">
          <summary>Host tools</summary>
          <div className="sv-round-controls">
            {["peek", "bid"].includes(phase) && <button className="chip-btn" onClick={() => onAction("newCard")}>New card</button>}
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
// The card as the clue-givers see it while they bid: five words, nothing to tap.
function CardWords({ words, marks }) {
  return (
    <ol className="wb-card">
      {(words || Array(CARD_SIZE).fill("…")).map((word, i) => <li key={i} className={marks ? `is-${marks[i]}` : ""}><span>{word}</span>{marks && marks[i] !== "waiting" && <em><Check />{STATUS[marks[i]]}</em>}</li>)}
    </ol>
  );
}
function BidPad({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId), myTeam = teamOfPlayer(game, playerId);
  const [typed, setTyped] = useState("");
  const current = turn.bid?.amount ?? START_BID + 1, leading = turn.bid?.teamId === myTeam?.id, open = turn.phase === "bid";
  const passed = turn.passes.includes(myTeam?.id);
  const bid = (amount) => { if (amount >= 1 && amount < current) { act("bid", { amount }); setTyped(""); } };
  const n = Math.trunc(Number(typed));
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">{open ? "Bid lower to take the card" : "Bidding opens in a moment…"}</span>{open && <ClueTimer deadline={turn.deadline} serverNow={game.serverNow} />}</div>
      <CardWords words={words} />
      <p className="wb-phone-bid">{turn.bid ? <>{leading ? "Your team" : teamById(game, turn.bid.teamId)?.name} · <b className="dmd-line">{turn.bid.amount}</b> words</> : <>No bids yet · {teamById(game, turn.starterId)?.name} takes it at {START_BID}</>}</p>
      {leading ? <p className="player-status is-you">You’re lowest. Hold your nerve…</p> : (
        <>
          <div className="wb-bid-steps">
            {[1, 3, 5].map((step) => <button key={step} disabled={!open || current - step < 1} onClick={() => bid(current - step)}>{current - step >= 1 ? current - step : "–"}<small>−{step}</small></button>)}
          </div>
          <form className="wb-bid-type" onSubmit={(e) => { e.preventDefault(); bid(n); }}>
            <input aria-label="Your bid" inputMode="numeric" pattern="[0-9]*" maxLength="2" value={typed} disabled={!open} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} placeholder={`1–${Math.min(START_BID, current - 1)}`} />
            <button className="primary" disabled={!open || !(n >= 1 && n < current)}>Bid {n >= 1 && n < current ? n : ""}</button>
          </form>
        </>
      )}
      <button className="tt-foul-btn wb-pass-btn" disabled={passed} onClick={() => act("pass")}>{passed ? `Waiting for ${otherTeam(game, myTeam?.id)?.name} to pass too…` : "Pass on this card"}</button>
    </div>
  );
}
// The clue-giver taps each word as their team says it. The judge can take one back.
function ClueGiverCard({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId);
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">Clue {teamById(game, turn.control)?.name}. Tap each word when they say it.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
      <p className="wb-phone-left"><b className="dmd-line">{turn.budget - turn.used}</b> words left of {turn.budget}</p>
      <ol className="wb-card wb-card-tap">
        {(words || []).map((word, i) => (
          <li key={i} className={`is-${turn.marks[i]}`}>
            <button disabled={turn.marks[i] !== "waiting"} onClick={() => act("mark", { index: i })}>{turn.marks[i] === "got" && <Check />}{word}</button>
          </li>
        ))}
      </ol>
      <p className="muted wb-rules">No rhymes, no “sounds like”, no gestures, and no part of an answer word.</p>
    </div>
  );
}
function NoNo({ onConfirm, label = "No-no!" }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!asking) return; const timer = setTimeout(() => setAsking(false), 5000); return () => clearTimeout(timer); }, [asking]);
  if (!asking) return <button className="wb-nono" onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="wb-nono-confirm" role="alertdialog" aria-label="Call a no-no?">
      <p>Call a no-no? The card goes to the other team.</p>
      <button className="secondary" onClick={() => setAsking(false)}>Cancel</button>
      <button className="wb-nono" onClick={() => { setAsking(false); onConfirm(); }}>Yes, no-no</button>
    </div>
  );
}
// The judge: a huge +1 for every word the clue-giver says, undo, the no-no, and the card to dispute marked words.
function JudgePad({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId), over = turn.used >= turn.budget;
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">You’re the judge. Count every word {nameOf(game, turn.clueGiverId)} says.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
      <button className={"wb-plus" + (over ? " is-last" : "")} onClick={() => act("countWord")}>
        <b>+1</b><span>{turn.used} of {turn.budget} words{over ? " · one more ends it" : ""}</span>
      </button>
      <div className="wb-judge-row">
        <button className="tt-pass-btn" disabled={!turn.used} onClick={() => act("uncount")}>Undo</button>
        <NoNo onConfirm={() => act("nono")} />
      </div>
      <ol className="wb-card">
        {(words || []).map((word, i) => (
          <li key={i} className={`is-${turn.marks[i]}`}>
            <span>{word}</span>
            {turn.marks[i] === "got" && <button className="chip-btn" onClick={() => act("unmark", { index: i })}>Not it</button>}
          </li>
        ))}
      </ol>
    </div>
  );
}
// A steal without a host: the clue-giver who lost the card confirms the other team's words.
function StealConfirm({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId);
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">{teamById(game, turn.stealTeamId)?.name} is stealing. Tap each word they say. Play fair: the TV shows the whole card after.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
      <ol className="wb-card wb-card-tap">
        {(words || []).map((word, i) => (
          <li key={i} className={`is-${turn.marks[i]}`}>
            <button disabled={turn.marks[i] !== "waiting"} onClick={() => act("mark", { index: i })}>{turn.marks[i] !== "waiting" && <Check />}{word}</button>
          </li>
        ))}
      </ol>
    </div>
  );
}
function PlayerAction({ game, playerId }) {
  const turn = game.turn, myTeam = teamOfPlayer(game, playerId);
  const giver = Object.values(turn.givers).includes(playerId), clueGiver = turn.clueGiverId === playerId, judge = turn.judgeId === playerId;
  const sees = (["peek", "bid"].includes(turn.phase) && giver) || (["play", "steal"].includes(turn.phase) && (clueGiver || judge));
  const words = useCard(game, playerId, sees);
  const control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  if (["peek", "bid"].includes(turn.phase)) {
    if (giver) return <BidPad game={game} playerId={playerId} words={words} />;
    return <p className="player-status">{names(game, Object.values(turn.givers).filter(Boolean))} {turn.phase === "peek" ? "are looking at the card" : "are bidding"}…<br /><small className="muted">{turn.bid ? `${teamById(game, turn.bid.teamId)?.name}: ${turn.bid.amount} words` : "No bids yet"}</small></p>;
  }
  if (turn.phase === "play") {
    if (clueGiver) return <ClueGiverCard game={game} playerId={playerId} words={words} />;
    if (judge) return <JudgePad game={game} playerId={playerId} words={words} />;
    if (myTeam?.id === turn.control) return <div className="tt-card-wrap"><p className="player-status is-you">Guess out loud! Any order.</p><p className="wb-phone-left"><b className="dmd-line">{left(turn)}</b> of 5 words to go · <b className="dmd-line">{turn.budget - turn.used}</b> clue words left</p></div>;
    return <p className="player-status">{control?.name} is playing<br /><small className="muted">No shouting answers! If they blow it, you get to steal.</small></p>;
  }
  if (turn.phase === "steal") {
    if (clueGiver && game.hostless) return <StealConfirm game={game} playerId={playerId} words={words} />;
    if (judge) return <p className="player-status is-you">You know the card. Not a word!<br /><small className="muted">Your team is stealing: {plural(left(turn), "word")} to go.</small></p>;
    if (myTeam?.id === turn.stealTeamId) return <div className="tt-card-wrap"><p className="player-status is-you">Steal it! Shout the {plural(left(turn), "word")} left.</p><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>;
    return <p className="player-status">{steal?.name} is trying to steal the card…</p>;
  }
  const { head, sub } = resultLine(game, turn);
  return <div className="fib-my-result"><p className="player-status">{head}</p>{sub && <p className="muted">{sub}</p>}<Slots turn={turn} /></div>;
}
export function BudgetPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), turn = game.turn, team = teamOfPlayer(game, playerId);
  const giver = turn && Object.values(turn.givers).includes(playerId);
  const myMove = turn && ((["peek", "bid"].includes(turn.phase) && giver) || (turn.phase === "play" && (turn.clueGiverId === playerId || turn.judgeId === playerId)));
  useEffect(() => { if (myMove) { try { navigator.vibrate?.(150); } catch {} } }, [myMove, turn?.phase, turn?.id]);
  if (!player) return <main className="player wb"><p className="status-card">You’re no longer in this game.</p></main>;
  const other = team && otherTeam(game, team.id);
  return (
    <main className="player wb">
      <header className="player-bar"><Brand text="WORD BUDGET" className="wb-brand" /><span className="player-name">{player.name}</span></header>
      <b className="player-score money">{team ? progress(game, team) : 0}</b>
      <p className="tt-team">{team ? `${team.name} · ${scoreLine(game, team)} · ${names(game, team.members)}` : "No team yet"}</p>
      {game.status === "lobby" || !turn ? (
        <>
          <p className="player-status">You’re in! {team && team.members.length < 2 ? "Waiting for a teammate…" : "The game starts when everyone’s here."}</p>
          {game.status === "lobby" && other && <button className="secondary wb-switch" onClick={() => socket.emit("budget:team", { code: game.code, playerId, teamId: other.id })}>Switch to {other.name}</button>}
        </>
      ) : (
        <>
          <p className="player-clue-meta">Card {turn.number} · first to {game.target}</p>
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
            <span className="money">{plural(team.cards, "card")}</span>
            <button className="chip-btn add" onClick={() => onAction("adjustScore", { teamId: team.id, amount: 1 })}>+1</button>
            <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { teamId: team.id, amount: -1 })}>−1</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function BudgetController({ game, onAction }) {
  const turn = game.turn, phase = turn?.phase;
  const words = useCard(game, undefined, !game.hostless && !!turn && phase !== "done");
  const header = <header className="controller-bar"><Brand text="WORD BUDGET" className="wb-brand" /><Flap className="code-chip" text={game.code} label={`Game code ${game.code}`} /></header>;
  if (game.status === "lobby" || !turn)
    return <main className="controller wb">{header}<h1>Lobby</h1><p className="muted">Start the game from the main screen. Move players between teams by tapping their names there.</p><section className="controller-players"><h2>Teams</h2><TeamTools game={game} onAction={onAction} /></section></main>;
  const current = turn.bid?.amount ?? START_BID + 1, control = teamById(game, turn.control);
  const toggle = (i) => onAction(turn.marks[i] === "waiting" ? "mark" : "unmark", { index: i });
  const nextLabel = { peek: "Open the bidding", bid: "Close the bidding", play: "Stop the clock (a fail)", steal: "End the steal", done: leaderOf(game) ? "See the winners" : "Next card" }[phase];
  return (
    <main className="controller wb">
      {header}
      <p className="player-clue-meta">Card {turn.number} · {phase === "play" ? control?.name : phase}</p>
      {["peek", "bid"].includes(phase) && (
        <>
          <CardWords words={words} />
          <p className="status-note">{turn.bid ? `${teamById(game, turn.bid.teamId)?.name} leads at ${turn.bid.amount} words.` : `No bids. ${teamById(game, turn.starterId)?.name} takes it at ${START_BID}.`} {turn.passes.length ? `${turn.passes.map((id) => teamById(game, id)?.name).join(" and ")} passed.` : ""}</p>
          {phase === "bid" && current > 1 && (
            <div className="wb-judge-row">
              {game.teams.filter((t) => t.id !== turn.bid?.teamId).map((team) => <button key={team.id} className="tt-pass-btn" onClick={() => onAction("bid", { teamId: team.id, amount: current - 1 })}>{team.name} bids {current - 1}</button>)}
            </div>
          )}
          <button className="chip-btn wb-newcard" onClick={() => onAction("newCard")}>New card</button>
        </>
      )}
      {phase === "play" && (
        <>
          <p className="status-note">{nameOf(game, turn.clueGiverId)} clues; {nameOf(game, turn.judgeId)} judges. Tap a word to mark it (tap again to take it back).</p>
          <ol className="wb-card wb-card-tap">{(words || []).map((word, i) => <li key={i} className={`is-${turn.marks[i]}`}><button onClick={() => toggle(i)}>{turn.marks[i] === "got" && <Check />}{word}</button></li>)}</ol>
          <button className={"wb-plus" + (turn.used >= turn.budget ? " is-last" : "")} onClick={() => onAction("countWord")}><b>+1</b><span>{turn.used} of {turn.budget} words</span></button>
          <div className="wb-judge-row"><button className="tt-pass-btn" disabled={!turn.used} onClick={() => onAction("uncount")}>Undo</button><NoNo onConfirm={() => onAction("nono")} /></div>
        </>
      )}
      {phase === "steal" && (
        <>
          <p className="status-note">{teamById(game, turn.stealTeamId)?.name} is stealing. Tap each word they say.</p>
          <ol className="wb-card wb-card-tap">{(words || []).map((word, i) => <li key={i} className={`is-${turn.marks[i]}`}><button disabled={turn.marks[i] === "got"} onClick={() => toggle(i)}>{turn.marks[i] !== "waiting" && <Check />}{word}</button></li>)}</ol>
        </>
      )}
      {phase === "done" && (
        <>
          <p className="status-note">{resultLine(game, turn).head}</p>
          <Slots turn={turn} />
          <div className="wb-judge-row wb-award">
            {game.teams.map((team) => <button key={team.id} className="chip-btn" disabled={turn.result?.winnerId === team.id} onClick={() => onAction("award", { teamId: team.id })}>Give it to {team.name}</button>)}
            <button className="chip-btn" disabled={!turn.result?.winnerId} onClick={() => onAction("award", { teamId: null })}>Nobody</button>
          </div>
        </>
      )}
      <button className="wide on" onClick={() => onAction("next")}>{nextLabel}</button>
      <div className="sv-round-controls"><button className="chip-btn danger" onClick={() => onAction("endGame")}>End game early</button></div>
      <section className="controller-players"><h2>Teams</h2><TeamTools game={game} onAction={onAction} /></section>
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
    <main className="end wb">
      {display && <SoundToggle />}
      <Brand text="WORD BUDGET" className="wb-brand" />
      <h1>{tie ? "It’s a tie!" : `${ranked[0].name} wins!`}</h1>
      {byBonus && <p className="muted">Level on {game.scoring === "points" ? "points" : "cards"}, so saved words decide it.</p>}
      <div className="podium">{ranked.map((t, i) => <div className={`place place-${i + 1}`} key={t.id}><span className="rank">{i + 1}</span><b>{t.name}</b><small>{names(game, t.members)} · {plural(t.bonus, "word")} saved</small><strong className="money">{game.scoring === "points" ? t.points : t.cards}</strong></div>)}</div>
      {host ? (
        <div className="sv-end-buttons">
          <button className="primary" onClick={() => onAction("replay", { words: dealWords(readCategories()) })}>Play again with new cards</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
