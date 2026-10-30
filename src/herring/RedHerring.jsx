// Red Herring screens: host setup, the shared TV board, players' phones, the storyteller's controller (the
// grimoire) and the end of the case. The TV only ever has public state; each phone asks for its own role, card and
// notes (herring:me), and a hosted game's controller for every role and card (herring:grimoire).
import React, { useEffect, useMemo, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner, Departures } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, playWinnersTune } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import Flap, { Brand } from "../Flap";
import { CATEGORIES, CATEGORY_NAME, ROLES, OPTIONAL_ROLES, DEFAULT_ROLES, MIN_PLAYERS, MAX_PLAYERS, factName } from "../../server/herringCase.js";
import { Pictogram } from "./icons";
import { LabTask } from "./Lab";
import { useHerringSounds } from "./sounds";
import "./herring.css";

const MANOR = "Herringbone Hall";
const LENGTHS = [[120000, "2 min"], [180000, "3 min"], [240000, "4 min"]];
const SETTINGS_KEY = "gameNight.herring.settings.v1";
const readSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };
const saveSettings = (settings) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));

// What each role does, as its card says it.
const ROLE_TEXT = {
  detective: "Find the killer. Check every statement against the ledger, do lab work, and vote with care.",
  killer: "Your card is the crime. Lie in your statement without breaking the ledger. From night 2, choose a victim. Once a game, plant evidence on a guest; once a day, contaminate a lab sample.",
  accomplice: "You know the killer and the crime. Cover for them, muddy the ledger, and contaminate the lab once a day. You win if the killer does.",
  forensics: "Each night, inspect a guest: you learn one true fact from their alibi card.",
  witness: "You saw one fact of the crime. Steer the room, but stay hidden: a jailed killer who names you still wins.",
  officer: "Each night, guard a guest (not the same one two nights running). A foiled attack pins up a free clue.",
  coroner: "Each morning you learn the real role of every guest who has died or been jailed.",
  informant: "Each morning your contact names two guests. At least one of them is innocent.",
  rookie: "You were told you’re Forensics. Your findings are unreliable.",
  reporter: "You want the scoop. Get yourself jailed and you win, whoever solves the case.",
};
const TEAM_TEXT = { detectives: "Detectives", killer: "The killer’s side", reporter: "On your own" };

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || game.names?.[id] || "A guest";
const listNames = (game, ids) => {
  const list = ids.map((id) => nameOf(game, id));
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] || "";
};
const guestIds = (game) => Object.keys(game.names || {});
const fateOf = (game, id) => game.players.find((player) => player.id === id)?.fate || (game.names?.[id] ? "gone" : "alive");
const isFree = (game, id) => fateOf(game, id) === "alive";
const freeIds = (game) => guestIds(game).filter((id) => isFree(game, id));
const PHASE_NAME = { night: "Night", morning: "Morning", investigate: "Investigation", defense: "The trial", vote: "The vote", verdict: "The verdict", lastWords: "Last words" };
const MARK_PHRASE = { mud: "has muddy boots", ink: "has inky fingers", torn: "has a torn sleeve", smoke: "smells of smoke", scratch: "has a scratched hand", perfume: "wears strong perfume", wine: "has a wine stain", rain: "came in from the rain" };
// The killer, in a clue's words.
function clueSentence(game, clue) {
  if (clue.category === "cleared") return `${nameOf(game, clue.value)} is cleared by the lab`;
  const fact = factName(clue.category, clue.value);
  return clue.category === "room" ? `The killer was in the ${fact}` : clue.category === "item" ? `The killer was holding the ${fact}` : `The killer ${MARK_PHRASE[clue.value] || `has ${fact.toLowerCase()}`}`;
}
// What everyone's statements (or, for ghosts, their real cards) add up to, beside the ledger's true count.
function claims(game) {
  const out = {}, unfiled = freeIds(game).filter((id) => !game.statements[id]).length;
  for (const category of CATEGORIES) {
    out[category] = {};
    for (const { value, count } of game.ledger[category]) out[category][value] = { count, claimed: 0 };
    for (const id of guestIds(game)) {
      const said = game.pinned[id] || game.statements[id];
      if (said && out[category][said[category]]) out[category][said[category]].claimed++;
    }
    for (const row of Object.values(out[category])) row.state = row.claimed > row.count ? "over" : !unfiled && row.claimed < row.count ? "under" : row.claimed === row.count ? "match" : "open";
  }
  return { rows: out, unfiled };
}
const accusedCount = (game, id) => Object.values(game.accusations || {}).filter((target) => target === id).length;
const buzz = (ms = 120) => { try { navigator.vibrate?.(ms); } catch {} };

// ---------- Private state ----------
// The phone's own role and card. Asked for again whenever the server says private views changed, and when this
// phone comes back (its own "connected" flips back on).
function usePrivate(game, playerId) {
  const [me, setMe] = useState(null);
  const connected = game.players.find((player) => player.id === playerId)?.connected;
  useEffect(() => {
    if (!connected) return;
    let live = true;
    socket.timeout(5000).emit("herring:me", { code: game.code, playerId }, (err, r) => { if (live && !err && r?.ok) setMe(r); });
    return () => { live = false; };
  }, [game.code, playerId, game.privateRev, connected, game.status]);
  return me;
}
function useGrimoire(game) {
  const [book, setBook] = useState(null);
  useEffect(() => {
    if (game.hostless) return;
    let live = true;
    const ask = () => socket.timeout(5000).emit("herring:grimoire", { code: game.code }, (err, r) => { if (live && !err && r?.ok) setBook(r); });
    ask(); socket.on("connect", ask);
    return () => { live = false; socket.off("connect", ask); };
  }, [game.code, game.privateRev, game.status]);
  return book;
}
const act = (game, playerId, action, payload, done) =>
  socket.timeout(5000).emit("herring:act", { code: game.code, playerId, action, payload }, (err, r) => done?.(!err && !!r?.ok, r || {}));

// ---------- Pieces ----------
function Fact({ category, value, size = 28, showName = true, className = "" }) {
  return (
    <span className={`rh-fact ${className}`} title={`${CATEGORY_NAME[category]}: ${factName(category, value)}`}>
      <Pictogram group={category} id={value} size={size} />
      {showName && <span>{factName(category, value)}</span>}
    </span>
  );
}
// An alibi card: the pale case-file card, a fact a row.
function AlibiCard({ card, title = "Alibi card", owner, stamp, compact = false }) {
  return (
    <div className={"rh-card" + (compact ? " is-compact" : "")}>
      <div className="rh-card-head"><span>{title}</span>{owner && <b>{owner}</b>}</div>
      <dl>
        {CATEGORIES.map((category) => (
          <div key={category}>
            <dt>{CATEGORY_NAME[category]}</dt>
            <dd><Fact category={category} value={card[category]} size={compact ? 26 : 34} /></dd>
          </div>
        ))}
      </dl>
      {stamp && <span className={`rh-stamp is-${stamp.kind}`}>{stamp.text}</span>}
    </div>
  );
}
function PhaseBanner({ game }) {
  const phase = PHASE_NAME[game.phase] || "";
  return (
    <div className={`rh-banner is-${game.phase}`}>
      <Pictogram group="misc" id={game.phase === "night" ? "moon" : game.phase === "morning" ? "sun" : ["defense", "vote", "verdict", "lastWords"].includes(game.phase) ? "gavel" : "ledger"} size={34} />
      <Flap text={phase} />
      <span className="rh-banner-day label">Day {game.day} of {game.maxDays}</span>
    </div>
  );
}
function LabBar({ lab, small = false }) {
  if (!lab) return null;
  return (
    <div className={"rh-lab" + (lab.solved ? " is-solved" : "") + (small ? " is-small" : "")} role="meter" aria-valuemin={0} aria-valuemax={lab.target} aria-valuenow={lab.count} aria-label="Lab work">
      <span className="rh-lab-label"><Pictogram group="misc" id="lab" size={22} /><span className="label">Lab</span></span>
      <span className="rh-lab-cells" style={{ "--n": lab.target }}>
        {Array.from({ length: lab.target }, (_, i) => <i key={i} className={i < lab.count ? (i === lab.count - 1 ? "on is-new" : "on") : ""} />)}
      </span>
      <span className="rh-lab-count">{lab.solved ? <b>Clue tomorrow</b> : <Flap text={`${lab.count}/${lab.target}`} align="right" cells={5} />}</span>
    </div>
  );
}
function Clues({ game, title = "Pinned clues" }) {
  if (!game.clues?.length) return null;
  return (
    <section className="rh-clues" aria-label={title}>
      <h2 className="label">{title}</h2>
      <ul>
        {game.clues.map((clue, i) => (
          <li key={i} className="rh-clue" style={{ "--tilt": `${((i * 37) % 7) - 3}deg` }}>
            <i className="rh-pin" aria-hidden="true" />
            {clue.category === "cleared" ? <Pictogram group="misc" id="clue" size={30} /> : <Pictogram group={clue.category} id={clue.value} size={34} />}
            <span><small>Day {clue.day}</small>{clueSentence(game, clue)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The manor's floor plan: one cell per room in play, the ledger's count on flaps, what the statements claim, and
// a chalk outline for each body found there.
function FloorPlan({ game, tally }) {
  const bodies = (room) => guestIds(game).filter((id) => fateOf(game, id) === "dead" && game.pinned[id]?.room === room).length;
  return (
    <section className="rh-plan" aria-label="Floor plan">
      <h2 className="label"><Pictogram group="misc" id="mansion" size={20} /> {MANOR}</h2>
      <ul style={{ "--rooms": game.inPlay.room.length }}>
        {game.ledger.room.map(({ value }) => {
          const row = tally.rows.room[value];
          return (
            <li key={value} className={`rh-room is-${row.state}`}>
              <Pictogram group="room" id={value} size={44} />
              <span className="rh-room-name">{factName("room", value)}</span>
              <span className="rh-room-count"><Flap text={String(row.count)} /><small>{row.count === 1 ? "guest" : "guests"}</small></span>
              <ClaimTag row={row} />
              {bodies(value) > 0 && <span className="rh-room-bodies" aria-label={`${bodies(value)} found dead here`}>{Array.from({ length: bodies(value) }, (_, i) => <Pictogram key={i} group="misc" id="body" size={26} />)}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
function ClaimTag({ row }) {
  const text = row.state === "over" ? `${row.claimed} claim it` : row.state === "under" ? `${row.claimed} claim it` : `${row.claimed} claimed`;
  return (
    <span className={`rh-claim is-${row.state}`}>
      {row.state === "over" ? <b>≠</b> : row.state === "under" ? <b>?</b> : row.state === "match" ? <b>=</b> : null}
      {text}
    </span>
  );
}
function Ledger({ game, tally, category }) {
  return (
    <section className="rh-ledger" aria-label={`Ledger: ${CATEGORY_NAME[category]}`}>
      <h2 className="label">{CATEGORY_NAME[category]}</h2>
      <ul>
        {game.ledger[category].map(({ value }) => {
          const row = tally.rows[category][value];
          return (
            <li key={value} className={`is-${row.state}`}>
              <Pictogram group={category} id={value} size={30} />
              <span className="rh-ledger-name">{factName(category, value)}</span>
              <Flap className="rh-ledger-count" text={String(row.count)} />
              <ClaimTag row={row} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
// Every guest's statement as a row: their claimed facts, how often they changed their story, how many accuse them,
// and for a ghost, their real card beside it (LIED if the two differ).
function Guests({ game, compact = false }) {
  return (
    <section className={"rh-guests" + (compact ? " is-compact" : "")} aria-label="Statements">
      <h2 className="label">Statements</h2>
      <ol>
        {guestIds(game).map((id) => {
          const fate = fateOf(game, id), said = game.statements[id], real = game.pinned[id], accused = accusedCount(game, id);
          const lied = real && said && CATEGORIES.some((category) => said[category] !== real[category]);
          const away = fate === "alive" && !game.players.find((player) => player.id === id)?.connected;
          return (
            <li key={id} className={`is-${fate}${away ? " is-away" : ""}${game.trial?.accusedId === id ? " is-accused" : ""}`}>
              <span className="rh-guest-name">{nameOf(game, id)}{fate !== "alive" && <small>{fate === "dead" ? "Dead" : fate === "jailed" ? "Jailed" : "Left"}</small>}</span>
              <span className="rh-guest-said">
                {said ? CATEGORIES.map((category) => <Fact key={category} category={category} value={said[category]} size={compact ? 22 : 26} showName={false} />) : <em>No statement</em>}
                {said?.changes > 0 && <span className="rh-changed">Changed ×{said.changes}</span>}
              </span>
              {real && <span className="rh-guest-real">{CATEGORIES.map((category) => <Fact key={category} category={category} value={real[category]} size={compact ? 22 : 26} showName={false} className={said && said[category] !== real[category] ? "is-lie" : ""} />)}{lied && <b className="rh-lied">Lied</b>}</span>}
              {accused > 0 && fate === "alive" && <span className="rh-accused" aria-label={`${accused} accuse them`}><Pictogram group="role" id="detective" size={18} />{accused}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
// The investigation board: the plan, the item and mark ledgers, the statements, the lab bar and the clues.
function CaseBoard({ game }) {
  const tally = useMemo(() => claims(game), [game]);
  return (
    <div className="rh-board">
      <div className="rh-board-left">
        <FloorPlan game={game} tally={tally} />
        <div className="rh-ledgers"><Ledger game={game} tally={tally} category="item" /><Ledger game={game} tally={tally} category="mark" /></div>
      </div>
      <div className="rh-board-right">
        <Guests game={game} />
        {tally.unfiled > 0 && <p className="muted rh-unfiled">{tally.unfiled} {tally.unfiled === 1 ? "guest hasn’t" : "guests haven’t"} filed a statement. Do it on your phone.</p>}
      </div>
    </div>
  );
}

// ---------- The TV's stages ----------
function NightScene({ game }) {
  const progress = game.night || { done: 0, of: 0 };
  return (
    <div className="rh-night" role="status">
      <div className="rh-sky" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ "--x": `${(i * 47) % 100}%`, "--y": `${(i * 29) % 60}%`, "--d": `${(i % 7) * 0.6}s` }} />)}</div>
      <Pictogram group="misc" id="moon" size={120} className="rh-moon" />
      <Pictogram group="misc" id="mansion" size={260} strokeWidth={1.6} className="rh-manor" />
      <ul className="rh-windows" aria-label={`${progress.done} of ${progress.of} guests done`}>
        {Array.from({ length: progress.of }, (_, i) => <li key={i} className={i < progress.of - progress.done ? "is-lit" : ""} />)}
      </ul>
      <h1 className="rh-headline">Night {game.day} falls on {MANOR}</h1>
      <p className="rh-sub">Every guest: eyes on your own phone. Everyone taps something, every night.</p>
    </div>
  );
}
function MorningReport({ game }) {
  const m = game.morning;
  if (!m) return null;
  const headline = m.first ? `${game.victim} is dead` : m.victimId ? `${nameOf(game, m.victimId)} is dead` : m.foiled ? "An attack, foiled" : "A quiet night";
  const body = m.first ? `Found at the foot of the grand staircase. The storm has cut the road and the doors were locked from inside. One of the guests did this.`
    : m.victimId ? `The body was found in the ${factName("room", m.room)}. Their alibi card is pinned to the board.`
    : m.foiled ? `Someone crept up on ${nameOf(game, m.savedId)} in the night, but the Officer was standing guard. The attacker fled, and left something behind.`
    : "Nobody died. This time.";
  return (
    <div className="rh-morning">
      <article className={"rh-report" + (m.victimId || m.first ? " is-death" : "")}>
        <header><span className="label">{MANOR} · Morning {m.day}</span></header>
        <div className="rh-report-art">
          {m.victimId || m.first ? <Pictogram group="misc" id="body" size={150} strokeWidth={2} className="is-drawn rh-body" /> : <Pictogram group="misc" id={m.foiled ? "candle" : "sun"} size={130} strokeWidth={2} className="is-drawn" />}
          {m.room && <Pictogram group="room" id={m.room} size={70} className="rh-report-room" />}
        </div>
        <h1>{headline}</h1>
        <p>{body}</p>
        {(m.victimId || m.first) && <span className="rh-stamp is-dead">Deceased</span>}
      </article>
      <div className="rh-morning-side">
        {m.clue ? (
          <div className="rh-new-clue" role="status">
            <span className="label">The lab’s report</span>
            <div className="rh-clue is-big"><i className="rh-pin" aria-hidden="true" />{m.clue.category === "cleared" ? <Pictogram group="misc" id="clue" size={60} /> : <Pictogram group={m.clue.category} id={m.clue.value} size={72} />}<span>{clueSentence(game, m.clue)}</span></div>
          </div>
        ) : !m.first && <p className="muted">No new clue: the lab didn’t finish yesterday.</p>}
        {game.hunches?.length > 0 && (
          <div className="rh-hunches">
            <span className="label">Last night’s hunches</span>
            <ol>{game.hunches.map(({ id, count }) => <li key={id}><Flap text={nameOf(game, id)} /><small>{count} {count === 1 ? "hunch" : "hunches"}</small></li>)}</ol>
          </div>
        )}
      </div>
    </div>
  );
}
function TrialStage({ game }) {
  const trial = game.trial, id = trial.accusedId, said = game.statements[id];
  const accusers = Object.entries(game.accusations || {}).filter(([, target]) => target === id).map(([accuser]) => accuser);
  const free = freeIds(game), needed = Math.floor(free.length / 2) + 1;
  return (
    <div className="rh-trial">
      <span className="label">On trial</span>
      <h1 className="rh-accused-name"><Flap text={nameOf(game, id)} intro /></h1>
      {accusers.length > 0 && <p className="muted">Accused by {listNames(game, accusers)}</p>}
      <div className="rh-trial-said">{said ? <AlibiCard card={said} title="Their statement" /> : <p className="rh-no-statement">No statement filed</p>}</div>
      {game.phase === "defense" ? <p className="rh-sub">{nameOf(game, id)}, make your case.</p> : (
        <div className="rh-votes" role="status">
          <p className="rh-sub">Vote on your phone. {needed} Jail votes jail them.</p>
          <ul>{[...free, ...guestIds(game).filter((g) => !free.includes(g) && trial.voted.includes(g))].map((g) => <li key={g} className={trial.voted.includes(g) ? "is-in" : ""}><i />{nameOf(game, g)}{!free.includes(g) && <small>ghost</small>}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
function VerdictStage({ game }) {
  const trial = game.trial, v = trial?.verdict;
  if (!v) return null;
  if (v.none) return <div className="rh-verdict is-none"><Pictogram group="misc" id="gavel" size={110} /><h1 className="rh-headline">Nobody stands trial today</h1><p className="rh-sub">It takes two accusations to put a guest on the stand.</p></div>;
  const name = nameOf(game, trial.accusedId);
  return (
    <div className={`rh-verdict ${v.jailed ? "is-jailed" : "is-released"}`}>
      <Pictogram group="misc" id={v.jailed ? "jail" : "gavel"} size={110} className="rh-verdict-art" />
      <h1><Flap text={v.jailed ? "Jailed" : "Released"} intro /></h1>
      <p className="rh-verdict-name">{name}</p>
      <p className="rh-sub">{v.jail} to jail, {v.release} to release{v.ghosts?.length ? ` (with ${v.ghosts.length} ghost ${v.ghosts.length === 1 ? "vote" : "votes"})` : ""}. {v.needed} needed.</p>
      {v.jailed && <p className={"rh-verdict-truth" + (v.wasKiller ? " is-killer" : "")}>{v.wasKiller ? `${name} was the killer!` : `${name} was not the killer.`}</p>}
      {v.scoop && <p className="rh-scoop"><Pictogram group="role" id="reporter" size={30} /> Stop the presses! {name} was the Tabloid Reporter, and gets the scoop.</p>}
      {v.jailed && game.pinned[trial.accusedId] && <AlibiCard card={game.pinned[trial.accusedId]} owner={name} title="Real card" stamp={{ kind: "jail", text: "Jailed" }} compact />}
    </div>
  );
}
function LastWordsStage({ game }) {
  return (
    <div className="rh-verdict is-jailed">
      <Pictogram group="role" id="witness" size={120} className="rh-verdict-art" />
      <h1 className="rh-headline">Last words</h1>
      <p className="rh-sub">{nameOf(game, game.trial.accusedId)} was the killer, and has one last chance: name the Witness, and the killer still wins.</p>
    </div>
  );
}

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

function Lobby({ game, onAction }) {
  const live = game.players.filter((player) => player.connected).length, ready = live >= MIN_PLAYERS;
  return (
    <div className="lobby rh-lobby">
      <div className="rh-invite">
        <Pictogram group="misc" id="mansion" size={96} strokeWidth={2} />
        <p><span className="label">You are invited to {MANOR}</span><b>{game.victim} requests the pleasure of your company.</b> By morning, one guest will be a murderer.</p>
      </div>
      <LobbyJoin code={game.code} />
      <Departures
        head={["Guest", "Status"]}
        cols="1fr 0.42fr"
        rows={game.players.map((player) => ({ key: player.id, state: player.connected ? "ready" : "away", label: `${player.name}, ${player.connected ? "ready" : "reconnecting"}`, cells: [player.name, player.connected ? "Arrived" : "Away"] }))}
        openCells={game.players.length < MAX_PLAYERS ? ["— — —", "Expected"] : null}
      />
      <p className="muted">{ready ? "Each guest gets a secret role and an alibi card on their phone." : `Red Herring needs at least ${MIN_PLAYERS} guests (${live} here). It’s best with 7 to 10.`}</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start the case</button>
    </div>
  );
}

export function HerringDisplay({ game, onAction }) {
  useHerringSounds(game);
  useClockTicks(["night", "investigate", "vote"].includes(game.phase) ? game.deadline : null, game.serverNow);
  const phase = game.phase, playing = game.status === "playing";
  return (
    <main className={`display rh is-${phase || "lobby"}`}>
      <SoundToggle />
      <header className="display-bar">
        <Brand text="RED HERRING" className="rh-brand" />
        {playing ? <JoinCorner code={game.code} /> : <span />}
        <ClueTimer deadline={game.deadline} serverNow={game.serverNow} />
      </header>
      {game.status === "lobby" ? <Lobby game={game} onAction={onAction} /> : (
        <div className="rh-stage">
          <PhaseBanner game={game} />
          {phase === "night" && <NightScene game={game} />}
          {phase === "morning" && <><MorningReport game={game} /><Clues game={game} /></>}
          {phase === "investigate" && <><div className="rh-top-strip"><LabBar lab={game.lab} /><Clues game={game} /></div><CaseBoard game={game} /></>}
          {["defense", "vote"].includes(phase) && <div className="rh-split"><TrialStage game={game} /><Guests game={game} compact /></div>}
          {phase === "verdict" && <div className="rh-split"><VerdictStage game={game} /><Guests game={game} compact /></div>}
          {phase === "lastWords" && <LastWordsStage game={game} />}
          {!game.hostless && ["morning", "verdict"].includes(phase) && <p className="muted rh-waiting">The storyteller moves the story on.</p>}
        </div>
      )}
      {game.hostless && game.players.length > 0 && playing && (
        <details className="host-tools sv-host-tools">
          <summary>Host tools</summary>
          <div className="sv-round-controls">
            <button className="chip-btn" onClick={() => onAction("next")}>Skip ahead</button>
            <button className="chip-btn danger" onClick={() => onAction("endGame")}>End the case</button>
          </div>
        </details>
      )}
      {!game.hostless && (
        <a className="controller-link" href="?controller" onClick={(event) => { event.preventDefault(); sessionStorage.hostCode = game.code; window.open("?controller", "_blank"); }}>Open storyteller controller</a>
      )}
    </main>
  );
}

// ---------- Player phone ----------
// The role card lies face down (a herring on its back) so a neighbour can't read it; tap to turn it over.
function RoleCard({ me, game }) {
  const [up, setUp] = useState(false);
  useEffect(() => { if (!up) return; const t = setTimeout(() => setUp(false), 8000); return () => clearTimeout(t); }, [up]);
  const role = me.role, team = me.team;
  return (
    <button className={"rh-role" + (up ? " is-up" : "")} onClick={() => setUp(!up)} aria-label={up ? `Your role: ${ROLES[role].name}. Tap to hide.` : "Your role card. Tap to look."}>
      <span className="rh-role-back" aria-hidden="true"><Pictogram group="misc" id="herring" size={72} strokeWidth={2} /><span>Tap to look at your role</span></span>
      <span className={`rh-role-face is-${team}`} aria-hidden={!up}>
        <Pictogram group="role" id={role} size={64} strokeWidth={2.2} />
        <b>{ROLES[role].name}</b>
        <small>{TEAM_TEXT[team]}</small>
        <span>{ROLE_TEXT[role]}</span>
        {me.partnerId && <em>{role === "killer" ? "Your accomplice" : "The killer"}: {nameOf(game, me.partnerId)}</em>}
      </span>
    </button>
  );
}
// What this phone has learned, newest first.
function Notebook({ game, me }) {
  const notes = [...(me.notes || [])].reverse();
  if (!notes.length) return null;
  const line = (note) => {
    if (note.type === "witness") return <>You saw it: <Fact category={note.category} value={note.value} size={22} /> belongs to the killer.</>;
    if (note.type === "inspect") return <>{nameOf(game, note.targetId)}’s card: <Fact category={note.category} value={note.value} size={22} /></>;
    if (note.type === "coroner") return <>{nameOf(game, note.targetId)} was the <b>{ROLES[note.role]?.name}</b>.</>;
    if (note.type === "tip") return <>Your contact says: {listNames(game, note.ids)}. At least one is innocent.</>;
    return null;
  };
  return (
    <section className="rh-notebook">
      <h2 className="label">Your notebook</h2>
      <ol>{notes.map((note, i) => <li key={i}><small>{note.day ? `Night ${note.day}` : "Before"}</small><span>{line(note)}</span></li>)}</ol>
    </section>
  );
}
function PickGuest({ ids, game, value, onPick, disabled = [] }) {
  return (
    <ul className="rh-pick">
      {ids.map((id) => (
        <li key={id}><button className={value === id ? "is-on" : ""} aria-pressed={value === id} disabled={disabled.includes(id)} onClick={() => onPick(value === id ? null : id)}>{nameOf(game, id)}</button></li>
      ))}
    </ul>
  );
}
const NIGHT_ASK = {
  case: { title: "No kill tonight", hint: "The first body is enough for one night. You can plant evidence on a guest instead (once a game)." },
  kill: { title: "Choose your victim", hint: "Or hold off tonight. The body is found in the morning." },
  protect: { title: "Guard a guest", hint: "If the killer comes for them, the attack fails." },
  inspect: { title: "Inspect a guest", hint: "You’ll learn one true fact from their card in the morning." },
};
function NightPhone({ game, playerId, me }) {
  const ask = me.night, [target, setTarget] = useState(ask?.target || null), [frame, setFrame] = useState(ask?.frame || null), [hunch, setHunch] = useState(ask?.hunch || null), [error, setError] = useState("");
  if (!ask) return <div className="rh-phone-scene is-night"><Pictogram group="misc" id="ghost" size={90} /><p className="player-status">You’re a ghost. Rest until morning.</p></div>;
  if (ask.done) return <div className="rh-phone-scene is-night"><Pictogram group="misc" id="moon" size={90} /><p className="player-status">Done for the night.</p><p className="muted">Keep your eyes down until morning.</p></div>;
  const others = freeIds(game).filter((id) => id !== playerId), info = NIGHT_ASK[ask.kind];
  const needsTarget = ask.kind === "protect" || ask.kind === "inspect";
  const send = () => {
    setError("");
    const payload = { hunch };
    if (ask.kind !== "none" && ask.kind !== "case") payload.target = target;
    if (ask.canFrame && frame) payload.frame = frame;
    act(game, playerId, "night", payload, (ok) => { if (!ok) setError("That didn’t go through. Try again."); });
  };
  return (
    <div className="rh-night-phone">
      {info && (
        <section>
          <h2>{info.title}</h2>
          <p className="muted">{info.hint}</p>
          {ask.kind !== "case" && <PickGuest ids={others} game={game} value={target} onPick={setTarget} disabled={ask.kind === "protect" && ask.notSame ? [ask.notSame] : []} />}
          {ask.canFrame && (
            <details className="rh-frame" open={!!frame}>
              <summary>Plant evidence (once a game)</summary>
              <p className="muted">The next clue will point at this guest instead of you.</p>
              <PickGuest ids={others} game={game} value={frame} onPick={setFrame} disabled={me.partnerId ? [me.partnerId] : []} />
            </details>
          )}
        </section>
      )}
      <section>
        <h2>Your hunch</h2>
        <p className="muted">Who do you suspect? Everyone taps one: the room sees the most-suspected names in the morning.</p>
        <PickGuest ids={others} game={game} value={hunch} onPick={setHunch} />
      </section>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary rh-wide" disabled={!hunch || (needsTarget && !target)} onClick={send}>Done for the night</button>
    </div>
  );
}
function StatementForm({ game, playerId, me }) {
  const filed = game.statements[playerId];
  const [draft, setDraft] = useState(() => (filed ? { room: filed.room, item: filed.item, mark: filed.mark } : { ...me.card }));
  const [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const same = filed && CATEGORIES.every((category) => filed[category] === draft[category]);
  const send = () => { setBusy(true); setNote(""); act(game, playerId, "statement", draft, (ok) => { setBusy(false); setNote(ok ? "Statement filed." : "That didn’t go through."); }); };
  return (
    <div className="rh-statement">
      <p className="muted">{me.team === "killer" ? "Your real card is the crime. Say something else — but the ledger counts every guest." : "Say where you were, what you held and your mark. Your real card is filled in."}</p>
      {CATEGORIES.map((category) => (
        <fieldset key={category}>
          <legend className="label">{CATEGORY_NAME[category]}</legend>
          <div className="rh-fact-choices">
            {game.inPlay[category].map((value) => (
              <button key={value} className={draft[category] === value ? "is-on" : ""} aria-pressed={draft[category] === value} onClick={() => setDraft({ ...draft, [category]: value })}>
                <Pictogram group={category} id={value} size={30} /><span>{factName(category, value)}</span>{me.card[category] === value && <small>Yours</small>}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
      {filed && !same && <p className="rh-warn">Everyone will see that you changed your story.</p>}
      <button className="primary rh-wide" disabled={busy || same} onClick={send}>{filed ? (same ? "Statement filed" : "Change my statement") : "File my statement"}</button>
      {note && <p className="muted" role="status">{note}</p>}
    </div>
  );
}
function AccusePanel({ game, playerId, me }) {
  const others = freeIds(game).filter((id) => id !== playerId);
  return (
    <div className="rh-accuse">
      <p className="muted">Tap a guest to accuse them; tap again to take it back. When the clock runs out, the most-accused guest (two accusations or more) stands trial.</p>
      <ul className="rh-pick">
        {others.map((id) => (
          <li key={id}><button className={me.accused === id ? "is-on" : ""} aria-pressed={me.accused === id} onClick={() => act(game, playerId, "accuse", { targetId: me.accused === id ? null : id })}>{nameOf(game, id)}{accusedCount(game, id) > 0 && <small>{accusedCount(game, id)} accuse</small>}</button></li>
        ))}
      </ul>
    </div>
  );
}
function LabPanel({ game, playerId, me }) {
  const [sure, setSure] = useState(false);
  return (
    <div className="rh-lab-panel">
      <LabBar lab={game.lab} small />
      <LabTask task={me.task} onAnswer={(taskId, answer, done) => act(game, playerId, "solve", { taskId, answer }, (ok, r) => done(ok && r.right))} />
      {me.canContaminate && (sure ? (
        <div className="rh-taint">
          <p>Spoil {3} samples? The TV says a sample was contaminated, not who did it.</p>
          <div className="confirm-buttons"><button className="secondary" onClick={() => setSure(false)}>Keep it clean</button><button className="primary danger" onClick={() => { act(game, playerId, "contaminate"); setSure(false); }}>Contaminate</button></div>
        </div>
      ) : <button className="chip-btn danger rh-taint-btn" onClick={() => setSure(true)}>Contaminate a sample (once today)</button>)}
    </div>
  );
}
function InvestigatePhone({ game, playerId, me }) {
  const free = isFree(game, playerId);
  const [tab, setTab] = useState(() => (free && !game.statements[playerId] ? "statement" : "lab"));
  if (!free) return <><p className="player-status">You’re a ghost: keep the lab busy.</p><LabPanel game={game} playerId={playerId} me={me} /></>;
  const tabs = [["statement", "Statement"], ["lab", "Lab"], ["accuse", "Accuse"]];
  return (
    <div className="rh-investigate">
      <div className="sv-rounds rh-tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} aria-checked={tab === id} onClick={() => setTab(id)}>{label}{id === "statement" && !game.statements[playerId] && <i className="rh-dot" aria-label="not filed yet" />}</button>)}
      </div>
      {tab === "statement" && <StatementForm game={game} playerId={playerId} me={me} />}
      {tab === "lab" && <LabPanel game={game} playerId={playerId} me={me} />}
      {tab === "accuse" && <AccusePanel game={game} playerId={playerId} me={me} />}
    </div>
  );
}
function VotePhone({ game, playerId, me }) {
  const trial = game.trial, free = isFree(game, playerId), player = game.players.find((p) => p.id === playerId);
  if (me.vote) return <p className="player-status">You voted to {me.vote === "jail" ? "jail" : "release"} {nameOf(game, trial.accusedId)}.</p>;
  if (!free && !player?.ghostVote) return <p className="player-status">You’ve used your ghost vote. Watch the TV.</p>;
  return (
    <div className="rh-vote">
      <p className="player-status">{trial.accusedId === playerId ? "Your fate. Vote too." : `Jail ${nameOf(game, trial.accusedId)}?`}</p>
      {!free && <p className="muted">You’re a ghost: this is your one ghost vote. Save it, or spend it now.</p>}
      <div className="rh-vote-keys">
        <button className="rh-key is-jail" onClick={() => act(game, playerId, "vote", { choice: "jail" })}><Pictogram group="misc" id="jail" size={40} />Jail</button>
        <button className="rh-key" onClick={() => act(game, playerId, "vote", { choice: "release" })}><Pictogram group="misc" id="gavel" size={40} />Release</button>
      </div>
    </div>
  );
}
function LastWordsPhone({ game, playerId }) {
  if (game.trial.accusedId !== playerId) return <p className="player-status">The killer is choosing their last words…</p>;
  return (
    <div className="rh-night-phone">
      <section>
        <h2>Name the Witness</h2>
        <p className="muted">Guess right and you still win.</p>
        <PickGuest ids={guestIds(game).filter((id) => id !== playerId)} game={game} value={null} onPick={(id) => id && act(game, playerId, "lastWords", { guessId: id })} />
      </section>
    </div>
  );
}
function PhoneAction({ game, playerId, me }) {
  const phase = game.phase, trial = game.trial;
  if (phase === "night") return <NightPhone key={`n${game.day}`} game={game} playerId={playerId} me={me} />;
  if (phase === "morning") return <div className="rh-phone-scene"><Pictogram group="misc" id="sun" size={80} /><p className="player-status">Morning {game.day}. Eyes on the TV.</p></div>;
  if (phase === "investigate") return <InvestigatePhone key={`i${game.day}`} game={game} playerId={playerId} me={me} />;
  if (phase === "defense") return <p className={"player-status" + (trial.accusedId === playerId ? " is-you" : "")}>{trial.accusedId === playerId ? "You’re on trial! Make your case out loud." : `${nameOf(game, trial.accusedId)} is on trial. Listen.`}</p>;
  if (phase === "vote") return <VotePhone game={game} playerId={playerId} me={me} />;
  if (phase === "verdict") {
    const v = trial?.verdict;
    return <p className="player-status">{!v || v.none ? "Nobody stood trial today." : v.jailed ? `${nameOf(game, trial.accusedId)} is jailed.` : `${nameOf(game, trial.accusedId)} is released.`}</p>;
  }
  if (phase === "lastWords") return <LastWordsPhone game={game} playerId={playerId} />;
  return null;
}
export function HerringPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), me = usePrivate(game, playerId);
  const [view, setView] = useState("case");
  const mine = me?.night && !me.night.done;
  useEffect(() => { if (mine || game.phase === "vote") buzz(); }, [game.phase, game.day]);
  if (!player) return <main className="player rh"><p className="status-card">You’re no longer in this game.</p></main>;
  const fate = player.fate;
  return (
    <main className={`player rh is-${game.phase || "lobby"}`}>
      <header className="player-bar">
        <Brand text="RED HERRING" className="rh-brand" />
        <span className="player-name">{player.name}{fate !== "alive" && ` · ${fate === "dead" ? "ghost" : fate}`}</span>
      </header>
      {game.status === "lobby" || !me || me.lobby ? (
        <div className="rh-phone-scene"><Pictogram group="misc" id="mansion" size={120} strokeWidth={2} /><p className="player-status">You’ve arrived at {MANOR}.</p><p className="muted">Your role and alibi card arrive when the case starts.</p></div>
      ) : (
        <>
          <div className="rh-phone-top">
            <span className="label">{PHASE_NAME[game.phase]} · Day {game.day}</span>
            <ClueTimer deadline={game.deadline} serverNow={game.serverNow} />
          </div>
          <div className="sv-rounds rh-views" role="tablist">
            <button role="tab" aria-selected={view === "case"} aria-checked={view === "case"} onClick={() => setView("case")}>My case</button>
            <button role="tab" aria-selected={view === "board"} aria-checked={view === "board"} onClick={() => setView("board")}>Board</button>
          </div>
          {view === "case" ? (
            <>
              <PhoneAction game={game} playerId={playerId} me={me} />
              <div className="rh-identity">
                <RoleCard me={me} game={game} />
                <AlibiCard card={me.card} title="Your real card" stamp={fate === "dead" ? { kind: "dead", text: "Deceased" } : fate === "jailed" ? { kind: "jail", text: "Jailed" } : null} />
                {me.crime && me.role !== "killer" && <AlibiCard card={me.crime} title="The crime" compact />}
              </div>
              <Notebook game={game} me={me} />
            </>
          ) : <PhoneBoard game={game} />}
        </>
      )}
    </main>
  );
}
// The Board tab: what the TV shows, for a phone (and for playing over a call).
function PhoneBoard({ game }) {
  const tally = useMemo(() => game.ledger && claims(game), [game]);
  if (!tally) return null;
  return (
    <div className="rh-phone-board">
      {game.morning && game.phase === "morning" && <MorningReport game={game} />}
      {game.lab && <LabBar lab={game.lab} small />}
      <Clues game={game} />
      <FloorPlan game={game} tally={tally} />
      <Ledger game={game} tally={tally} category="item" />
      <Ledger game={game} tally={tally} category="mark" />
      <Guests game={game} compact />
    </div>
  );
}

// ---------- Storyteller controller (the grimoire) ----------
// What the storyteller reads aloud in each phase.
function script(game) {
  const m = game.morning;
  switch (game.phase) {
    case "night": return `Night ${game.day} falls on ${MANOR}. Everyone, look at your own phone and tap your choices. Every guest taps something, every night.`;
    case "morning": {
      const parts = [m.first ? `Morning. ${game.victim} has been found dead at the foot of the stairs. The road is cut by the storm; one of you did this.` : m.victimId ? `Morning. ${nameOf(game, m.victimId)} has been found dead in the ${factName("room", m.room)}. Their alibi card is pinned to the board.` : m.foiled ? `Morning. Someone tried to kill ${nameOf(game, m.savedId)}, but the Officer was standing guard.` : "Morning. A quiet night: nobody died."];
      if (m.clue) parts.push(`The lab’s report: ${clueSentence(game, m.clue)}.`);
      return parts.join(" ");
    }
    case "investigate": return "Investigate. File your statements, do lab work on your phones, and accuse whoever you suspect. Two accusations put a guest on trial.";
    case "defense": return `${nameOf(game, game.trial.accusedId)} stands trial. You have thirty seconds to defend yourself.`;
    case "vote": return `Vote now: jail ${nameOf(game, game.trial.accusedId)}, or release them. Ghosts may spend their one vote.`;
    case "verdict": {
      const v = game.trial?.verdict;
      if (!v || v.none) return "Nobody stands trial today. Night falls again.";
      return v.jailed ? `${nameOf(game, game.trial.accusedId)} is jailed. ${v.wasKiller ? "And they were the killer!" : "They were not the killer."}${v.scoop ? " They were the Tabloid Reporter: they get the scoop." : ""}` : `${nameOf(game, game.trial.accusedId)} is released.`;
    }
    case "lastWords": return "The killer has been caught, and has one last chance: name the Witness.";
    default: return "";
  }
}
const NEXT_LABEL = { night: "End the night now", morning: "Start the investigation", investigate: "Go to trial now", defense: "Start the vote", vote: "Close the vote", verdict: "Next", lastWords: "Skip last words" };
function Grimoire({ game, book }) {
  const night = book.night;
  return (
    <section className="rh-grimoire">
      <h2>Grimoire</h2>
      <p className="muted">The crime: {CATEGORIES.map((category) => factName(category, book.crime[category])).join(" · ")}{book.frameUsed ? " · evidence planted" : ""}</p>
      <ol>
        {guestIds(game).map((id) => {
          const role = book.roles[id], action = night?.[id];
          return (
            <li key={id} className={`is-${fateOf(game, id)} is-team-${ROLES[role].team}`}>
              <Pictogram group="role" id={role} size={28} />
              <span className="rh-g-name">{nameOf(game, id)}<small>{ROLES[role].name}{fateOf(game, id) !== "alive" ? ` · ${fateOf(game, id)}` : ""}</small></span>
              <span className="rh-g-card">{CATEGORIES.map((category) => <Fact key={category} category={category} value={book.cards[id][category]} size={20} showName={false} />)}</span>
              {night && <span className="rh-g-night">{action?.target && <em>{role === "killer" ? "Kill" : role === "officer" ? "Guard" : "Inspect"}: {nameOf(game, action.target)}</em>}{action?.frame && <em>Frame: {nameOf(game, action.frame)}</em>}{action?.hunch ? <small>Hunch: {nameOf(game, action.hunch)}</small> : isFree(game, id) && <small>Still choosing…</small>}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
// Tonight's Rookie report: the truth, a coin toss, or a fact the storyteller picks.
function RookiePicker({ game, book, onAction }) {
  const rookie = guestIds(game).find((id) => book.roles[id] === "rookie" && isFree(game, id));
  if (!rookie || !book.night) return null;
  const target = book.night[rookie]?.target, lie = book.rookie;
  return (
    <section className="rh-rookie">
      <h2>The Rookie’s report</h2>
      <p className="muted">{nameOf(game, rookie)} thinks they’re Forensics{target ? ` and is inspecting ${nameOf(game, target)}` : ""}. Choose what they learn.</p>
      <div className="rh-rookie-options">
        <button className={"chip-btn" + (lie == null ? " add" : "")} onClick={() => onAction("rookie", { lie: null })}>Coin toss</button>
        <button className={"chip-btn" + (lie === "truth" ? " add" : "")} onClick={() => onAction("rookie", { lie: "truth" })}>The truth</button>
        {CATEGORIES.flatMap((category) => game.inPlay[category].map((value) => (
          <button key={`${category}${value}`} className={"chip-btn" + (lie?.category === category && lie.value === value ? " add" : "")} onClick={() => onAction("rookie", { lie: { category, value } })}><Pictogram group={category} id={value} size={18} /> {factName(category, value)}</button>
        )))}
      </div>
    </section>
  );
}
function GuestTools({ game, onAction }) {
  return (
    <div className="sv-team-tools fib-player-tools">
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Remove</button>
          </li>
        ))}
        {!game.players.length && <li className="muted">No guests yet</li>}
      </ul>
    </div>
  );
}
export function HerringController({ game, onAction }) {
  const book = useGrimoire(game), [trialId, setTrialId] = useState("");
  const header = (
    <header className="controller-bar">
      <Brand text="RED HERRING" className="rh-brand" />
      <Flap className="code-chip" text={game.code} label={`Game code ${game.code}`} />
    </header>
  );
  if (game.status === "lobby")
    return (
      <main className="controller rh">
        {header}
        <h1>The storyteller</h1>
        <p className="muted">You run the case: read the narration aloud, pace the mornings and verdicts, and choose what the Rookie learns. Start the case from the TV once {MIN_PLAYERS} or more guests have arrived. The storyteller doesn’t play a guest.</p>
        <section className="controller-players"><h2>Guests</h2><GuestTools game={game} onAction={onAction} /></section>
      </main>
    );
  return (
    <main className="controller rh">
      {header}
      <div className="rh-ctrl-top"><PhaseBanner game={game} /><ClueTimer deadline={game.deadline} serverNow={game.serverNow} /></div>
      <blockquote className="rh-script"><span className="label">Read aloud</span>{script(game)}</blockquote>
      <button className="wide on" onClick={() => onAction("next")}>{NEXT_LABEL[game.phase]}</button>
      {game.phase === "investigate" && (
        <div className="rh-put">
          <select aria-label="Put a guest on trial" value={trialId} onChange={(e) => setTrialId(e.target.value)}>
            <option value="">Put a guest on trial…</option>
            {freeIds(game).map((id) => <option key={id} value={id}>{nameOf(game, id)} ({accusedCount(game, id)} accuse)</option>)}
          </select>
          <button className="chip-btn" disabled={!trialId} onClick={() => { onAction("putOnTrial", { playerId: trialId }); setTrialId(""); }}>To trial</button>
        </div>
      )}
      {game.phase === "investigate" && <LabBar lab={game.lab} small />}
      {book && !book.lobby && <RookiePicker game={game} book={book} onAction={onAction} />}
      {book && !book.lobby ? <Grimoire game={game} book={book} /> : <p className="muted">Opening the grimoire…</p>}
      <div className="sv-round-controls"><button className="chip-btn danger" onClick={() => onAction("endGame")}>End the case</button></div>
      <section className="controller-players"><h2>Guests</h2><GuestTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- Setup ----------
export function HerringSetup({ onCreate }) {
  const saved = readSettings();
  const [roles, setRoles] = useState({ ...DEFAULT_ROLES, ...(saved.roles || {}) }),
    [investigateMs, setInvestigateMs] = useState(LENGTHS.some(([ms]) => ms === saved.investigateMs) ? saved.investigateMs : 180000),
    [hostless, setHostless] = useState(!!saved.hostless),
    [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const start = () => {
    setBusy(true); setNotice("");
    saveSettings({ roles, investigateMs, hostless });
    onCreate({ game: "herring", roles, investigateMs, hostless }, (error) => { setBusy(false); setNotice(error); });
  };
  return (
    <main className="setup rh-setup">
      <BackToHub />
      <Brand text="RED HERRING" className="rh-brand" />
      <section className="setup-card">
        <div className="setup-top rh-setup-top">
          <div>
            <h1>Set up Red Herring</h1>
            <p className="muted">A body at {MANOR}, a house full of detectives, and one of them did it. Every guest gets a secret role and an alibi card. The TV keeps the guest ledger: it only counts, but the killer has to lie, so the statements stop adding up.</p>
          </div>
          <Pictogram group="misc" id="herring" size={120} strokeWidth={1.8} className="rh-setup-fish" />
        </div>
        <ol className="rh-howto">
          <li><Pictogram group="misc" id="moon" size={36} /><span><b>Night</b> Everyone taps a hunch; the killer picks a victim (from night 2); Forensics and the Officer work.</span></li>
          <li><Pictogram group="misc" id="sun" size={36} /><span><b>Morning</b> Bodies are found and their real cards pinned up. If the lab finished, a clue about the killer.</span></li>
          <li><Pictogram group="misc" id="ledger" size={36} /><span><b>Investigation</b> File a statement, do lab work, accuse. The killer can contaminate a sample.</span></li>
          <li><Pictogram group="misc" id="gavel" size={36} /><span><b>Trial</b> The most-accused guest defends themselves; more than half the living voting Jail jails them.</span></li>
        </ol>
        <fieldset className="sv-fieldset">
          <legend>Investigation length</legend>
          <div className="sv-rounds" role="radiogroup" aria-label="Investigation length">
            {LENGTHS.map(([ms, label]) => <button key={ms} role="radio" aria-checked={investigateMs === ms} onClick={() => setInvestigateMs(ms)}>{label}</button>)}
          </div>
          <p className="muted sv-hint">A case runs up to five days, about 25 to 40 minutes.</p>
        </fieldset>
        <fieldset className="sv-fieldset rh-roles">
          <legend>Roles</legend>
          <p className="muted sv-hint">The Killer, Forensics and the Witness are in every case. These join once the party is big enough:</p>
          <ul>
            {Object.entries(OPTIONAL_ROLES).map(([role, from]) => (
              <li key={role}>
                <label className="game-mode">
                  <input type="checkbox" checked={!!roles[role]} onChange={(e) => setRoles({ ...roles, [role]: e.target.checked })} />
                  <Pictogram group="role" id={role} size={32} />
                  <span><b>{ROLES[role].name} <em>{from}+ guests</em></b><small>{ROLE_TEXT[role]}</small></span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <section className="game-options" aria-labelledby="rh-options-title">
          <h2 id="rh-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a storyteller</b><small>The game runs itself and the TV narrates: 30 seconds a night, mornings and verdicts move on by themselves, and the Rookie’s findings are a coin toss. With a storyteller, one person (not a guest) runs the case from the controller: they see every role and card, read the narration aloud, pace the mornings and verdicts, and choose what the Rookie learns.</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{MIN_PLAYERS} to {MAX_PLAYERS} guests · phones plus this screen</p>
          <button className="primary" disabled={busy} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- The end of the case ----------
const REASON = {
  jailed: "The killer is behind bars.",
  lastWords: "Jailed, but their last words named the Witness. The killer wins anyway.",
  parity: "Too few detectives are left to stop them.",
  cold: "Five days, and the case has gone cold.",
  fled: "The killer ran off into the storm. The detectives win by default.",
  ended: "The case was closed early.",
};
export function HerringEnd({ game, host, display, onAction }) {
  const o = game.outcome, reveal = game.reveal;
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  if (!o || !reveal) return null;
  // A case the host ended early has no winner.
  const detectives = o.winner === "detectives", abandoned = !o.winner;
  return (
    <main className={`end rh is-${o.winner || "none"}`}>
      {display && <SoundToggle />}
      <Brand text="RED HERRING" className="rh-brand" />
      <h1><Flap text={abandoned ? "Case dropped" : detectives ? "Case closed" : "The killer got away"} wrap intro /></h1>
      <p className="rh-end-reason">{REASON[o.reason]}</p>
      <div className="rh-reveal">
        <div className="rh-reveal-killer">
          <span className="label">The killer</span>
          <Flap className="rh-killer-name" text={nameOf(game, o.killerId)} intro />
          {o.accompliceId && <p className="muted">with {nameOf(game, o.accompliceId)} as the accomplice</p>}
          <AlibiCard card={reveal.crime} title="The crime" stamp={{ kind: detectives ? "jail" : "dead", text: detectives ? "Solved" : "Unsolved" }} />
          {reveal.frames.length > 0 && <p className="muted">The clue on day {reveal.frames.join(", ")} was planted evidence.</p>}
        </div>
        <ol className="rh-roles-reveal">
          {guestIds(game).map((id) => {
            const role = reveal.roles[id], won = o.scoopId === id || (!abandoned && (ROLES[role].team === "detectives" ? detectives : ROLES[role].team === "killer" ? !detectives : false));
            return (
              <li key={id} className={`is-team-${ROLES[role].team}${won ? " is-won" : ""}`}>
                <Pictogram group="role" id={role} size={34} />
                <b>{nameOf(game, id)}</b>
                <span>{ROLES[role].name}{fateOf(game, id) !== "alive" ? ` · ${fateOf(game, id)}` : ""}</span>
                {won && <small>{o.scoopId === id ? "Got the scoop" : "Won"}</small>}
              </li>
            );
          })}
        </ol>
      </div>
      {host ? (
        <div className="sv-end-buttons">
          <button className="primary" onClick={() => onAction("replay")}>A new case, same guests</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
