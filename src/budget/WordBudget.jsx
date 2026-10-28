// Word Budget screens: host setup, the shared TV display, players' phones, the host controller and the end.
// The card's five words only ever reach the two clue-givers' phones and the host controller (budget:card); the TV
// shows the bidding, the words-left board, the clock and each word once it's been said.
import React, { useEffect, useRef, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner, Departures } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, setMuted, isMuted, useEventSounds, playWinnersTune, playBuzz, playDing, playRoundWon, playTick } from "../survey/sounds";
import { useClockTicks, playBlip, playSoClose } from "../wheel/sounds";
import { playClue, playPop } from "../fib/sounds";
import { SwapIcon } from "../survey/SurveySays";
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
const Check = () => <svg className="tt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const XIcon = () => <svg className="tt-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
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
        <fieldset className="sv-fieldset tt-fieldset">
          <legend>Cards to win</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Cards to win">
            {[5, 7, 10].map((n) => <button key={n} role="radio" aria-checked={cardsToWin === n} onClick={() => { setCardsToWin(n); remember(CARDS_KEY, String(n)); }}>{n} cards</button>)}
          </div>
          <p className="muted sv-hint">About two minutes a card. Five cards is a short game; ten is the classic length.</p>
        </fieldset>
        <fieldset className="sv-fieldset tt-fieldset">
          <legend>Winning</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Winning">
            {Object.entries(SCORING).map(([id, { label }]) => <button key={id} role="radio" aria-checked={scoring === id} onClick={() => { setScoring(id); remember(SCORING_KEY, id); }}>{label}</button>)}
          </div>
          <p className="muted sv-hint">{SCORING[scoring].note}</p>
        </fieldset>
        <fieldset className="sv-fieldset tt-fieldset tt-cats-field">
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
    {off ? <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />}
  </svg>
);
function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return <button className="sv-sound" aria-pressed={!muted} onClick={toggle}><SpeakerIcon off={muted} />{muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}</button>;
}
const teamIndex = (game, id) => Math.max(0, game.teams.findIndex((t) => t.id === id));
// A team's number on its quiet colour (never red), so the two teams are told apart by more than colour.
const TeamNum = ({ game, team }) => <span className={`sv-team-num team-${teamIndex(game, team?.id)}`} aria-hidden="true">{teamIndex(game, team?.id) + 1}</span>;
// Cards won as a row of square markers toward the target, filled as they're won (points mode shows the total).
function CardLamps({ game, team }) {
  if (game.scoring === "points") return null;
  return (
    <span className="wb-lamps" role="img" aria-label={`${plural(team.cards, "card")} of ${game.target}`}>
      {Array.from({ length: game.target }, (_, i) => <i key={i} className={i < team.cards ? "is-lit" : ""} />)}
    </span>
  );
}
function Scoreboard({ game }) {
  const turn = game.turn;
  return (
    <section className="wb-scores" aria-label="Scores">
      <h2 className="label">First to {game.scoring === "points" ? `${game.target} points` : plural(game.target, "card")}</h2>
      <ol>
        {game.teams.map((team) => {
          const playing = turn?.control === team.id && turn.phase === "play", stealing = turn?.stealTeamId === team.id && turn.phase === "steal";
          return (
            <li key={team.id} className={`team-${teamIndex(game, team.id)}` + (playing || stealing ? " is-turn" : "")}>
              <span className="tt-team-head"><TeamNum game={game} team={team} /><b>{team.name}</b></span>
              <Money className="wb-team-score" value={progress(game, team)} cells={2} />
              <CardLamps game={game} team={team} />
              <small>{names(game, team.members)}</small>
              <small className="wb-saved">{game.scoring === "points" ? `${plural(team.cards, "card")} · ` : ""}{plural(team.bonus, "word")} saved</small>
              {(playing || stealing) && <em className="tt-playing">{stealing ? "Stealing" : "Playing"}</em>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
// The card's five rows: blank cells until a word is said (the text arrives in the public state only then).
function Slots({ turn, compact = false }) {
  const done = turn.phase === "done";
  return (
    <ol className={"tt-board wb-slots" + (compact ? " is-compact" : "")} aria-label="The card">
      {turn.marks.map((mark, i) => (
        <li key={i} className={`tt-row is-${mark}`}>
          <span className="tt-mark">{(mark === "got" || mark === "stolen") && <Check />}</span>
          <span className="tt-row-word">{turn.slots[i] ? <Flap text={turn.slots[i]} wrap intro /> : <Flap text="" cells={9} label="Not said yet" />}</span>
          {done && STATUS[mark] ? <em>{STATUS[mark]}</em> : <em aria-hidden="true" />}
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
// What went wrong (red, with an X cell) or right (the lamp) on a card.
function ResultTags({ turn }) {
  const r = turn.result;
  if (!r) return null;
  const failed = r.failReason && ["stolen", "stealMissed"].includes(r.reason);
  return (
    <p className="wb-tags">
      {r.reason === "nono" && <span className="wb-tag is-bad"><XIcon />No-no</span>}
      {failed && <span className="wb-tag is-bad"><XIcon />{r.failReason === "time" ? "Out of time" : "Over budget"}</span>}
      {r.reason === "stolen" && <span className="wb-tag is-good"><Check />Stolen</span>}
      {r.reason === "stealMissed" && <span className="wb-tag is-bad"><XIcon />Steal missed</span>}
      {r.reason === "cleared" && <span className="wb-tag is-good"><Check />Cleared{r.bonus ? ` · ${plural(r.bonus, "word")} saved` : ""}</span>}
    </p>
  );
}
// The words meter: how many of the budget are left (or, once it's blown, red with an X), and how many were said.
function WordsMeter({ turn }) {
  const over = turn.used > turn.budget, rest = Math.max(0, turn.budget - turn.used);
  return (
    <div className={"tt-meter wb-meter" + (over ? " is-over" : "")} role="status" aria-label={over ? `Over budget: ${turn.used} words of ${turn.budget}` : `${rest} words left of ${turn.budget}`}>
      <span className="label">{over ? "Over budget" : "Words left"}</span>
      <span className="wb-meter-main">{over && <span className="wb-x-cell"><XIcon /></span>}<Flap text={String(over ? turn.used : rest)} cells={2} align="right" /></span>
      <span className="wb-meter-sub"><span className="label">Said</span><Flap text={String(turn.used)} /><span className="label">of</span><Flap text={String(turn.budget)} /></span>
    </div>
  );
}

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const connected = (id) => game.players.find((p) => p.id === id)?.connected;
  const ready = game.teams.every((team) => team.members.filter(connected).length >= 2);
  const smaller = [...game.teams].sort((a, b) => a.members.length - b.members.length)[0];
  return (
    <div className="lobby wb-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <Departures
        head={["Player", "Team", "Status"]}
        cols="1fr 0.8fr 0.5fr"
        rows={game.teams.flatMap((team) => team.members.map((id) => ({
          key: id,
          state: connected(id) ? "ready" : "away",
          label: `${nameOf(game, id)}, ${team.name}, ${connected(id) ? "ready" : "reconnecting"}`,
          cells: [
            <button type="button" onClick={() => onAction("movePlayer", { playerId: id, teamId: otherTeam(game, team.id).id })} aria-label={`Move ${nameOf(game, id)} to ${otherTeam(game, team.id).name}`}>{nameOf(game, id)}<SwapIcon /></button>,
            <><TeamNum game={game} team={team} />{team.name}</>,
            connected(id) ? "Ready" : "Away",
          ],
        })))}
        openCells={game.players.length < 16 ? ["— — —", smaller?.name || "Either", "Waiting"] : null}
      />
      <p className="muted">New players join the smaller team. Tap a name to move them to the other team.</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="muted">Each team needs at least two players.</p>}
    </div>
  );
}
function BidBoard({ game }) {
  const turn = game.turn, leader = teamById(game, turn.bid?.teamId), starter = teamById(game, turn.starterId);
  return (
    <div className="tt-meters wb-bidboard">
      <div className={"tt-meter wb-bid" + (leader ? "" : " is-idle")} role="status" aria-label={leader ? `${leader.name} bids ${turn.bid.amount} words` : `No bids yet, ${START_BID}`}>
        <span className="label">{leader ? <>{leader.name} can do it in</> : "Nobody has bid"}</span>
        <Flap text={String(turn.bid?.amount ?? START_BID)} cells={2} align="right" />
        <span className="wb-meter-note">{leader ? `words · ${nameOf(game, turn.bid && turn.givers[turn.bid.teamId])}` : `${starter?.name} takes it at ${START_BID} if nobody bids`}</span>
      </div>
      <div className="tt-meter wb-shot"><span className="label">Shot clock</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
    </div>
  );
}
function Stage({ game, onAction }) {
  const turn = game.turn, control = teamById(game, turn.control), steal = teamById(game, turn.stealTeamId);
  const passed = turn.passes.map((id) => teamById(game, id)?.name);
  const won = leaderOf(game);
  const phaseName = turn.phase === "peek" ? "Look" : turn.phase === "bid" ? "Bidding" : turn.phase === "play" ? control?.name : turn.phase === "steal" ? "Steal" : "Result";
  return (
    <div className="tt-center wb-center">
      <p className="tt-round-label"><Flap text={`Card ${turn.number}`} /><span className="tt-round-team">{turn.phase === "play" && control && <TeamNum game={game} team={control} />}{phaseName}</span></p>
      {turn.phase === "peek" && (
        <>
          <h1 className="tt-headline"><em>{names(game, Object.values(turn.givers).filter(Boolean))}</em>: look at your phones<small>Five words, eyes only. Bidding opens in a moment.</small></h1>
          <Slots turn={turn} />
        </>
      )}
      {turn.phase === "bid" && <><BidBoard game={game} /><p className="wb-howto">Bid lower on your phone. Every bid restarts the shot clock; when it runs out, the lowest bid plays.</p></>}
      {["peek", "bid"].includes(turn.phase) && passed.length > 0 && <p className="wb-pass-note">{passed.join(" and ")} {passed.length > 1 ? "pass" : "wants a new card"}…</p>}
      {turn.phase === "play" && (
        <>
          <h1 className="tt-headline wb-headline"><em>{nameOf(game, turn.clueGiverId)}</em> clues <em>{control?.name}</em><small>{nameOf(game, turn.judgeId)} counts every word</small></h1>
          <div className="wb-play">
            <div className="wb-meters">
              <div className="tt-meter"><span className="label">Clock</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
              <WordsMeter turn={turn} />
            </div>
            <Slots turn={turn} />
          </div>
        </>
      )}
      {turn.phase === "steal" && (
        <>
          <div className="wb-steal" key={turn.id}>
            <p className="wb-tags"><span className="wb-tag is-bad"><XIcon />{turn.failReason === "time" ? "Time’s up" : "Over budget"}</span></p>
            <h1 className="wb-steal-head"><Flap text={`${steal?.name}: steal it!`} wrap intro /></h1>
            <p className="wb-howto">Say the {plural(left(turn), "word")} left, using only the clues you’ve heard. Get them all and the card is yours; miss one and nobody gets it. {nameOf(game, turn.judgeId)} knows the card: no help!</p>
          </div>
          <div className="wb-play">
            <div className="wb-meters">
              <div className="tt-meter wb-steal-clock"><span className="label">Steal clock</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
              {turn.failReason !== "time" && <WordsMeter turn={turn} />}
            </div>
            <Slots turn={turn} />
          </div>
        </>
      )}
      {turn.phase === "done" && (() => {
        const { head, sub } = resultLine(game, turn), bad = !turn.result?.winnerId || turn.result?.reason === "nono";
        return (
          <>
            <ResultTags turn={turn} />
            <h1 className={"wb-result" + (bad ? " is-bad" : "")}><Flap text={head} wrap intro /></h1>
            {sub && <p className="wb-howto">{sub}</p>}
            <Slots turn={turn} />
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
        {!["bid", "play", "steal"].includes(phase) && <ClueTimer deadline={turn?.deadline} serverNow={game.serverNow} />}
      </header>
      {game.status === "lobby" || !turn ? <Lobby game={game} onAction={onAction} /> : (
        <div className="tt-stage wb-stage"><Stage game={game} onAction={onAction} /><Scoreboard game={game} /></div>
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
// The card as the clue-givers see it while they bid: five words on flaps, nothing to tap.
function CardWords({ words, marks }) {
  return (
    <ol className="tt-board is-compact wb-card" aria-label="The card">
      {(words || Array(CARD_SIZE).fill("")).map((word, i) => {
        const mark = marks ? marks[i] : "waiting";
        return (
          <li key={i} className={`tt-row is-${mark}`}>
            <span className="tt-mark">{(mark === "got" || mark === "stolen") && <Check />}</span>
            <span className="tt-row-word">{word ? <Flap text={word} wrap intro /> : <Flap text="" cells={8} label="Loading" />}</span>
            {mark !== "waiting" ? <em>{STATUS[mark]}</em> : <em aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
// The card as keys: tap a word when it's said. Said words take the lamp marker and stop taking taps.
function TapCard({ words, marks, onTap, locked = (mark) => mark !== "waiting" }) {
  return (
    <ol className="tt-board is-compact wb-card wb-card-tap" aria-label="The card">
      {(words || []).map((word, i) => (
        <li key={i}>
          <button className={`tt-row is-${marks[i]}`} disabled={locked(marks[i])} onClick={() => onTap(i)}>
            <span className="tt-mark">{marks[i] !== "waiting" && marks[i] !== "missed" && <Check />}</span>
            <span className="tt-row-word"><Flap text={word} wrap intro /></span>
            <em>{STATUS[marks[i]] || "Tap"}</em>
          </button>
        </li>
      ))}
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
      <p className="wb-phone-bid">{turn.bid ? <><span className="label">{leading ? "Your team" : teamById(game, turn.bid.teamId)?.name}</span><Flap text={String(turn.bid.amount)} /><span className="label">words</span></> : <span className="label">No bids yet · {teamById(game, turn.starterId)?.name} takes it at {START_BID}</span>}</p>
      {leading ? <p className="player-status is-you">You’re lowest. Hold your nerve…</p> : (
        <>
          <div className="wb-bid-steps">
            {[1, 3, 5].map((step) => <button key={step} disabled={!open || current - step < 1} onClick={() => bid(current - step)}><b>{current - step >= 1 ? current - step : "–"}</b><small>−{step}</small></button>)}
          </div>
          <form className="wb-bid-type" onSubmit={(e) => { e.preventDefault(); bid(n); }}>
            <input aria-label="Your bid" inputMode="numeric" pattern="[0-9]*" maxLength="2" value={typed} disabled={!open} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} placeholder={`1–${Math.min(START_BID, current - 1)}`} />
            <button className="primary" disabled={!open || !(n >= 1 && n < current)}>Bid {n >= 1 && n < current ? n : ""}</button>
          </form>
        </>
      )}
      <button className="secondary wb-pass-btn" disabled={passed} onClick={() => act("pass")}>{passed ? `Waiting for ${otherTeam(game, myTeam?.id)?.name} to pass too…` : "Pass on this card"}</button>
    </div>
  );
}
// The clue-giver taps each word as their team says it. The judge can take one back.
function ClueGiverCard({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId), over = turn.used > turn.budget;
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">Clue {teamById(game, turn.control)?.name}. Tap each word when they say it.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
      <p className={"tt-tally wb-phone-left" + (over ? " is-over" : "")}><span className="label">Words left</span><Flap text={String(Math.max(0, turn.budget - turn.used))} /><span className="label">of</span><Flap text={String(turn.budget)} /></p>
      <TapCard words={words} marks={turn.marks} onTap={(index) => act("mark", { index })} />
      <p className="muted wb-rules">No rhymes, no “sounds like”, no gestures, and no part of an answer word.</p>
    </div>
  );
}
function NoNo({ onConfirm, label = "No-no!" }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!asking) return; const timer = setTimeout(() => setAsking(false), 5000); return () => clearTimeout(timer); }, [asking]);
  if (!asking) return <button className="wb-nono" onClick={() => setAsking(true)}><XIcon />{label}</button>;
  return (
    <div className="wb-nono-confirm" role="alertdialog" aria-label="Call a no-no?">
      <p>Call a no-no? The card goes to the other team.</p>
      <button className="secondary" onClick={() => setAsking(false)}>Cancel</button>
      <button className="wb-nono" onClick={() => { setAsking(false); onConfirm(); }}><XIcon />Yes, no-no</button>
    </div>
  );
}
// The judge's +1: the biggest key on the phone, with the count on flaps beside the budget.
function PlusKey({ turn, onCount }) {
  const last = turn.used >= turn.budget;
  return (
    <button className={"wb-plus" + (last ? " is-last" : "")} onClick={onCount} aria-label={`Count a word: ${turn.used} of ${turn.budget}`}>
      <b>+1</b>
      <span className="wb-plus-count"><Flap text={String(turn.used)} /><small>of</small><Flap text={String(turn.budget)} /><small>words</small></span>
      {last && <span className="wb-plus-warn"><XIcon />One more ends it</span>}
    </button>
  );
}
// The judge: a huge +1 for every word the clue-giver says, undo, the no-no, and the card to dispute marked words.
function JudgePad({ game, playerId, words }) {
  const turn = game.turn, act = usePhoneAct(game, playerId);
  return (
    <div className="tt-card-wrap">
      <div className="sv-guess-top"><span className="sv-guess-label">You’re the judge. Count every word {nameOf(game, turn.clueGiverId)} says.</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div>
      <PlusKey turn={turn} onCount={() => act("countWord")} />
      <div className="wb-judge-row">
        <button className="tt-pass-btn" disabled={!turn.used} onClick={() => act("uncount")}>Undo</button>
        <NoNo onConfirm={() => act("nono")} />
      </div>
      <ol className="tt-board is-compact wb-card" aria-label="The card">
        {(words || []).map((word, i) => (
          <li key={i} className={`tt-row is-${turn.marks[i]}`}>
            <span className="tt-mark">{turn.marks[i] === "got" && <Check />}</span>
            <span className="tt-row-word"><Flap text={word} wrap intro /></span>
            {turn.marks[i] === "got" ? <button className="chip-btn" onClick={() => act("unmark", { index: i })}>Not it</button> : <em aria-hidden="true" />}
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
      <TapCard words={words} marks={turn.marks} onTap={(index) => act("mark", { index })} />
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
    return (
      <div className="tt-card-wrap">
        <p className="player-status">{names(game, Object.values(turn.givers).filter(Boolean))} {turn.phase === "peek" ? "are looking at the card" : "are bidding"}…</p>
        <p className="wb-phone-bid">{turn.bid ? <><span className="label">{teamById(game, turn.bid.teamId)?.name}</span><Flap text={String(turn.bid.amount)} /><span className="label">words</span></> : <span className="label">No bids yet</span>}</p>
      </div>
    );
  }
  if (turn.phase === "play") {
    if (clueGiver) return <ClueGiverCard game={game} playerId={playerId} words={words} />;
    if (judge) return <JudgePad game={game} playerId={playerId} words={words} />;
    if (myTeam?.id === turn.control) return <div className="tt-card-wrap"><p className="player-status is-you">Guess out loud! Any order.</p><p className="tt-tally"><span className="label">To go</span><Flap text={String(left(turn))} /><span className="label">of 5 · clue words left</span><Flap text={String(Math.max(0, turn.budget - turn.used))} /></p></div>;
    return <p className="player-status">{control?.name} is playing<br /><small className="muted">No shouting answers! If they blow it, you get to steal.</small></p>;
  }
  if (turn.phase === "steal") {
    if (clueGiver && game.hostless) return <StealConfirm game={game} playerId={playerId} words={words} />;
    if (judge) return <p className="player-status is-you">You know the card. Not a word!<br /><small className="muted">Your team is stealing: {plural(left(turn), "word")} to go.</small></p>;
    if (myTeam?.id === turn.stealTeamId) return <div className="tt-card-wrap wb-phone-steal"><h2 className="wb-steal-head"><Flap text="Steal it!" intro /></h2><p className="player-status is-you">Shout the {plural(left(turn), "word")} left.</p><div className="wb-phone-clock"><span className="label">Steal clock</span><ClueTimer deadline={turn.deadline} serverNow={game.serverNow} /></div></div>;
    return <p className="player-status">{steal?.name} is trying to steal the card…</p>;
  }
  const { head, sub } = resultLine(game, turn);
  return <div className="tt-my-result"><ResultTags turn={turn} /><p className="player-status">{head}</p>{sub && <p className="muted">{sub}</p>}<Slots turn={turn} compact /></div>;
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
      <div className={"tt-my-team" + (team ? ` team-${teamIndex(game, team.id)}` : "")}>
        <span className="tt-my-name">{team && <TeamNum game={game} team={team} />}<span className="tt-my-text"><b>{team ? team.name : "No team yet"}</b>{team && <small>{scoreLine(game, team)} · {names(game, team.members)}</small>}</span></span>
        <Money value={team ? progress(game, team) : 0} />
      </div>
      {game.status === "lobby" || !turn ? (
        <>
          <p className="player-status">You’re in! {team && team.members.length < 2 ? "Waiting for a teammate…" : "The game starts when everyone’s here."}</p>
          {game.status === "lobby" && other && <button className="secondary wb-switch" onClick={() => socket.emit("budget:team", { code: game.code, playerId, teamId: other.id })}><SwapIcon />Switch to {other.name}</button>}
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
    <ul className="tt-team-tools">
      {game.teams.map((team) => (
        <li key={team.id} className={`team-${teamIndex(game, team.id)}`}>
          <TeamNum game={game} team={team} />
          <input aria-label={`${team.name}’s name`} defaultValue={team.name} key={team.name} maxLength="24" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== team.name && onAction("renameTeam", { teamId: team.id, name: e.target.value })} />
          <span className="wb-tool-cards"><Money value={team.cards} /><small>{team.cards === 1 ? "card" : "cards"}</small></span>
          <button className="chip-btn add" onClick={() => onAction("adjustScore", { teamId: team.id, amount: 1 })}>+1</button>
          <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { teamId: team.id, amount: -1 })}>−1</button>
        </li>
      ))}
    </ul>
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
      <div className="sv-guess-top tt-ctrl-top">
        <p className="player-clue-meta">Card {turn.number} · {phase === "play" ? control?.name : phase}</p>
        {["bid", "play", "steal"].includes(phase) && <ClueTimer deadline={turn.deadline} serverNow={game.serverNow} />}
      </div>
      {["peek", "bid"].includes(phase) && (
        <>
          <CardWords words={words} />
          <p className="wb-phone-bid">{turn.bid ? <><span className="label">{teamById(game, turn.bid.teamId)?.name} leads at</span><Flap text={String(turn.bid.amount)} /><span className="label">words</span></> : <span className="label">No bids · {teamById(game, turn.starterId)?.name} takes it at {START_BID}</span>}</p>
          {turn.passes.length > 0 && <p className="status-note">{turn.passes.map((id) => teamById(game, id)?.name).join(" and ")} passed.</p>}
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
          <TapCard words={words} marks={turn.marks} onTap={toggle} locked={() => false} />
          <PlusKey turn={turn} onCount={() => onAction("countWord")} />
          <div className="wb-judge-row"><button className="tt-pass-btn" disabled={!turn.used} onClick={() => onAction("uncount")}>Undo</button><NoNo onConfirm={() => onAction("nono")} /></div>
        </>
      )}
      {phase === "steal" && (
        <>
          <p className="wb-tags"><span className="wb-tag is-bad"><XIcon />{turn.failReason === "time" ? "Time’s up" : "Over budget"}</span></p>
          <p className="status-note">{teamById(game, turn.stealTeamId)?.name} is stealing. Tap each word they say.</p>
          <TapCard words={words} marks={turn.marks} onTap={toggle} locked={(mark) => mark === "got"} />
        </>
      )}
      {phase === "done" && (
        <>
          <ResultTags turn={turn} />
          <p className="status-note">{resultLine(game, turn).head}</p>
          <Slots turn={turn} compact />
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
      <h1><Flap text={tie ? "It’s a tie!" : `${ranked[0].name} wins!`} wrap intro /></h1>
      {byBonus && <p className="muted">Level on {game.scoring === "points" ? "points" : "cards"}, so saved words decide it.</p>}
      <ol className="podium">
        {ranked.map((t, i) => (
          <li className={`place place-${i + 1} team-${teamIndex(game, t.id)}`} key={t.id}>
            <span className="rank">{i + 1}</span>
            <span className="tt-place-name"><b><TeamNum game={game} team={t} />{t.name}</b><small>{names(game, t.members)} · {plural(t.bonus, "word")} saved</small></span>
            <span className="wb-place-score"><Flap className="money" text={String(game.scoring === "points" ? t.points : t.cards)} intro /><small>{game.scoring === "points" ? "points" : t.cards === 1 ? "card" : "cards"}</small></span>
          </li>
        ))}
      </ol>
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
