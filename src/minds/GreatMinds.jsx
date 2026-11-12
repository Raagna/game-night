// Great Minds screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
// The look is its own (minds.css), not the split-flap board the menu uses: a warm cocoa stage, cream answer cards in
// a chunky rounded face that snap together into groups, and two overlapping circles for the "mind meld".
import React, { useEffect, useState } from "react";
import "@fontsource/fredoka/400.css";
import "@fontsource/fredoka/500.css";
import "@fontsource/fredoka/600.css";
import "@fontsource/fredoka/700.css";
import { socket, clockText } from "../shared";
import { QRCode, useJoinBase, joinLink, displayAddress } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, useEventSounds, playWinnersTune } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { Coach } from "../Tutorial";
import { MINDS_TIMES, ANSWER_SECONDS, DEFAULT_ANSWER_SECONDS, ROUND_COUNTS, MAX_ANSWER_LENGTH, PROPOSALS_PER_PLAYER } from "../../server/greatminds.js";
import PACK from "./prompts.json";
import { playPrompt, playLockIn, playAllIn, playGroup, playSnap, playNope, playHowl, playScores } from "./sounds";
import "./minds.css";

// ---------- Dealing prompts ----------
// Prompts this browser hasn't played come first, no category twice in a row, and no category more than a quarter of
// the game (so a 16-round game isn't half rhymes).
const PLAYED_KEY = "gameNight.minds.played.v1";
const ROUNDS_KEY = "gameNight.minds.rounds.v1";
const CLOCK_KEY = "gameNight.minds.clock.v1";
const readPlayed = () => { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY)) || []); } catch { return new Set(); } };
const rememberPlayed = (prompts) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...prompts])].slice(-400))); } catch {} };
const readNumber = (key, options, fallback) => { try { const value = Number(localStorage.getItem(key)); return options.includes(value) ? value : fallback; } catch { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
export function dealPrompts(count) {
  const played = readPlayed(), pool = shuffle(PACK.prompts).sort((a, b) => played.has(a[1]) - played.has(b[1]));
  const cap = Math.ceil(count / 4), picks = [], perCategory = {};
  for (const relaxed of [false, true]) {
    for (const entry of pool) {
      if (picks.length === count) break;
      const [category] = entry;
      if (picks.includes(entry)) continue;
      if (!relaxed && ((perCategory[category] || 0) >= cap || picks.at(-1)?.[0] === category)) continue;
      picks.push(entry); perCategory[category] = (perCategory[category] || 0) + 1;
    }
  }
  return picks.map(([, prompt]) => prompt);
}

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || "A player";
const ranked = (game) => [...game.players].sort((a, b) => b.score - a.score);
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const roundLabel = (game) => (game.tutorial ? "Practice" : `Round ${game.index + 1} of ${game.roundCount}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const points = (n) => (n > 0 ? `+${n}` : "0");
const groupOf = (round, id) => round?.groups?.find((group) => group.members.includes(id));
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th"}`;
// The step a Next tap is meant for (nextStep in server/greatminds.js): the server ignores it once the step has moved on.
const nextAt = (game) => `${game.tutorial ? "practice" : game.index}:${game.round?.phase}${game.practice?.done ? ":done" : ""}`;
// How long the current clock ran from the start, for the clock's ring.
function phaseMs(game) {
  const round = game.round;
  if (!round) return 0;
  if (game.practice?.done) return MINDS_TIMES.practiceEndMs;
  if (round.phase === "answer") return game.answerMs;
  if (round.phase === "review") return round.proposal ? MINDS_TIMES.voteMs : MINDS_TIMES.reviewMs;
  if (round.phase === "scored") return MINDS_TIMES.scoredMs;
  return MINDS_TIMES.revealStepMs;
}
// One sentence about the Lone Wolf after a round's scores.
function wolfNews(game, practice = !!game.tutorial) {
  const round = game.round, alone = round?.alone || [];
  if (!round || round.phase !== "scored") return "";
  if (alone.length === 1) {
    const who = nameOf(game, alone[0]);
    if (practice) return `${who} was the only one alone, so in a real round ${who} would take the Lone Wolf.`;
    return round.wolfBefore === alone[0] ? `${who} is alone again and keeps the Lone Wolf.` : `${who} was the only one alone and takes the Lone Wolf!`;
  }
  const keeps = round.wolfAfter ? `, so it stays with ${nameOf(game, round.wolfAfter)}` : "";
  if (!alone.length) return `Nobody was alone this time${keeps}.`;
  return `${plural(alone.length, "player")} were alone, so nobody takes the Lone Wolf${keeps}.`;
}

// ---------- The practice round's coach (see docs/tutorial.md) ----------
// The steps come from the server (practiceStep in server/greatminds.js): answer, the reveal, the review, the scores.
const answeredBy = (game, me) => game.round?.answered?.includes(me);
const MINDS_COACH = {
  answer: {
    tv: "Everyone types one answer on their phone. The aim is to think alike: write what you think most people here will write.",
    controller: "Players answer on their phones. The clock stops by itself once everyone’s in; tap Stop the clock if you want to move on sooner.",
    phone: ({ game, me }) => answeredBy(game, me) ? "Locked in. The answers come up on the TV once everyone’s in." : "Type the answer you think most people here will give, then lock it in.",
  },
  reveal: {
    tv: "Matching answers snap together into groups: “Banana”, “a banana” and “bananas” all count as the same. The groups come up smallest first, so the biggest comes last.",
    phone: "Eyes on the TV: your answer is in one of these groups.",
  },
  review: {
    tv: ({ game }) => game.hostless
      ? "Two groups that mean the same thing? Anyone can say so on their phone, and if more than half the room agrees, they merge before the scores lock."
      : "Two groups that mean the same thing? The host can merge them, or split an answer off, before the scores lock.",
    controller: "Tap two groups that mean the same thing, then Merge. Tap a name in a group to split that answer off. Then lock the scores.",
    phone: ({ game }) => game.hostless ? "Think two groups are the same answer? Tap both, then “Same answer”. More than half the room has to agree." : "The host is checking the matches. Nothing to do on your phone.",
  },
  scored: {
    tv: ({ game }) => `You score a point for every other player who said the same as you; an answer on its own scores nothing. ${wolfNews(game, true)} Whoever holds the Lone Wolf at the end can’t win.`,
    controller: ({ game }) => `${wolfNews(game, true)} Tap Start the game when everyone’s ready: round one starts, scores at 0.`,
    phone: ({ game, me }) => `${game.round?.points?.[me] ? `You’d score ${game.round.points[me]} here.` : "You’d score nothing here."} When exactly one player is alone, they take the Lone Wolf, and whoever holds it at the end can’t win.`,
    skip: "Start the game",
  },
  done: {
    tv: "That’s the practice! Scores start at 0, and round one starts in a few seconds.",
    phone: "That’s the practice! Round one starts in a few seconds.",
    skip: "Start the game",
  },
};

// ---------- Pieces ----------
// The mark: two overlapping minds, coral and sun, meeting in the middle.
export function MindsMark({ className = "" }) {
  return (
    <svg className={`gm-mark ${className}`} viewBox="0 0 48 32" aria-hidden="true">
      <circle cx="18" cy="16" r="13" fill="#ff6f4f" />
      <circle cx="30" cy="16" r="13" fill="#ffc53d" />
      <path d="M24 4.47A13 13 0 0 1 24 27.53A13 13 0 0 1 24 4.47Z" fill="#fff4e4" />
      <circle cx="18" cy="16" r="13" fill="none" stroke="#2a1711" strokeWidth="2.4" />
      <circle cx="30" cy="16" r="13" fill="none" stroke="#2a1711" strokeWidth="2.4" />
    </svg>
  );
}
function Logo({ small = false }) {
  return <div className={`gm-logo${small ? " is-small" : ""}`}><MindsMark /><span>Great<br />Minds</span></div>;
}
// The Lone Wolf: a little wolf's head on a round token.
export function WolfIcon({ className = "" }) {
  return (
    <svg className={`gm-wolf-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.6 1.8l4.3 6h6.2l4.3-6 .9 9.6-3.6 3.4L12 22.6l-4.7-7.8-3.6-3.4z" fill="currentColor" />
      <path d="M8.6 11.4l2 .9M15.4 11.4l-2 .9" stroke="var(--gm-wolf-eye, #ffc53d)" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.9 19.6h2.2L12 21.3z" fill="var(--gm-wolf-eye, #ffc53d)" />
    </svg>
  );
}
function WolfToken({ label = "Lone Wolf" }) {
  return <span className="gm-wolf-token" title="Holds the Lone Wolf: can’t win while they have it"><WolfIcon /><span>{label}</span></span>;
}
const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

function Clock({ game, deadline = game.round?.deadline, total = phaseMs(game) }) {
  const serverNow = game.serverNow;
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const startedAt = Date.now(), startRemaining = Math.max(0, deadline - serverNow);
    const update = () => setRemaining(Math.max(0, startRemaining - (Date.now() - startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline, serverNow]);
  if (!deadline) return null;
  const seconds = Math.ceil(remaining / 1000), left = total ? Math.min(1, remaining / total) : 1;
  return (
    <div className={`gm-clock${seconds <= 10 ? " is-low" : ""}`} role="timer" aria-label={`${seconds} seconds left`} style={{ "--left": left }}>
      <b>{clockText(seconds)}</b>
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
function JoinCorner({ code }) {
  const base = useJoinBase();
  return (
    <div className="gm-join-corner">
      <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} />
      <span><small>Join at {displayAddress(base)}</small><b aria-label={`code ${code.split("").join(" ")}`}>{code}</b></span>
    </div>
  );
}
function useTvSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "round") playPrompt();
    else if (e.type === "answered") playLockIn();
    else if (e.type === "allIn") playAllIn();
    else if (e.type === "group") playGroup(e.size, e.last);
    else if (e.type === "merged") playSnap();
    else if (e.type === "mergeRejected") playNope();
    else if (e.type === "scored") { playScores(); if (e.moved) setTimeout(playHowl, 500); }
  });
}

// ---------- Groups of answers ----------
// One group: the answer, how many said it, and each player's card (with their own wording when it differs).
// `selectable` makes it a button for picking groups to merge; `onSplit` lets the host pull a player's answer out.
function Group({ game, group, size = "md", selected = false, onSelect, onSplit, mine = false, highlight = false, showPoints = false }) {
  const n = group.members.length, round = game.round;
  const body = (
    <>
      <span className="gm-group-head">
        <span className="gm-group-label">{group.label}</span>
        <span className="gm-group-count" aria-label={plural(n, "player")}>{n === 1 ? <WolfIcon /> : `×${n}`}</span>
      </span>
      <span className="gm-group-cards">
        {group.members.map((id) => {
          const wording = group.answers?.[id], differs = wording && wording.toLowerCase() !== group.label.toLowerCase();
          const card = <><b>{nameOf(game, id)}</b>{differs && <small>“{wording}”</small>}</>;
          return onSplit && n > 1
            ? <button key={id} type="button" className="gm-member is-splittable" onClick={(e) => { e.stopPropagation(); onSplit(id); }} aria-label={`Split ${nameOf(game, id)}’s answer “${wording}” off`}>{card}<span className="gm-split-x" aria-hidden="true">×</span></button>
            : <span key={id} className={`gm-member${game.wolfId === id ? " has-wolf" : ""}`}>{card}</span>;
        })}
      </span>
      {showPoints && round?.points && <span className="gm-group-points">{n === 1 ? "Alone · 0" : `+${n - 1} each`}</span>}
    </>
  );
  const cls = `gm-group is-${size}${n === 1 ? " is-alone" : ""}${selected ? " is-selected" : ""}${mine ? " is-mine" : ""}${highlight ? " is-top" : ""}`;
  // Keyed on its size, so a merge re-mounts the group and it snaps together again.
  return onSelect
    ? <div className={cls} role="button" tabIndex={0} aria-pressed={selected} onClick={() => onSelect(group.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(group.id); } }}>{body}</div>
    : <div className={cls}>{body}</div>;
}
const topGroupId = (round) => {
  const groups = round?.groups || [];
  if (!groups.length || groups.length < round.groupCount) return null;
  const best = Math.max(...groups.map((g) => g.members.length));
  const tops = groups.filter((g) => g.members.length === best);
  return best > 1 && tops.length === 1 ? tops[0].id : null;
};
function GroupWall({ game, size }) {
  const round = game.round, top = topGroupId(round), waiting = round.groupCount - round.groups.length;
  return (
    <div className="gm-wall">
      <ul className="gm-groups" aria-label="Answers">
        {round.groups.map((group) => (
          <li key={`${group.id}-${group.members.length}`}>
            {group.id === top && <span className="gm-ribbon">Great minds!</span>}
            <Group game={game} group={group} size={size(group)} highlight={group.id === top} showPoints={round.phase === "scored"} />
          </li>
        ))}
        {waiting > 0 && Array.from({ length: Math.min(waiting, 6) }, (_, i) => <li key={`wait-${i}`} className="gm-group-waiting" aria-hidden="true"><span>?</span></li>)}
      </ul>
      {round.noAnswer?.length > 0 && <p className="gm-no-answer">No answer: {round.noAnswer.map((id) => nameOf(game, id)).join(", ")} <small>(counts as alone)</small></p>}
    </div>
  );
}
// Groups get bigger cards the more players are in them.
const sizeFor = (group) => (group.members.length >= 4 ? "xl" : group.members.length >= 2 ? "lg" : "md");

// The open merge idea (games without a host): the two answers, who floated it and the votes so far.
function ProposalCard({ game, playerId }) {
  const round = game.round, proposal = round?.proposal;
  if (!proposal) return null;
  const [a, b] = proposal.groups.map((id) => round.groups.find((group) => group.id === id)?.label || "?");
  const mine = playerId && proposal.yes.includes(playerId) ? "yes" : playerId && proposal.no.includes(playerId) ? "no" : null;
  const vote = (yes) => socket.emit("minds:vote", { code: game.code, playerId, yes });
  return (
    <section className={`gm-proposal${playerId ? " is-phone" : ""}`} aria-label="Merge vote">
      <p className="gm-proposal-q"><b>{nameOf(game, proposal.by)}</b> says these are the same:</p>
      <p className="gm-proposal-pair"><span>{a}</span><span className="gm-equals" aria-label="equals">=</span><span>{b}</span></p>
      <p className="gm-proposal-tally" role="status">{proposal.yes.length} of {game.votesNeeded} yes votes needed{proposal.no.length ? ` · ${proposal.no.length} said no` : ""}</p>
      {playerId && proposal.by !== playerId && (
        <div className="gm-vote">
          <button type="button" className={`gm-btn is-yes${mine === "yes" ? " is-on" : ""}`} aria-pressed={mine === "yes"} onClick={() => vote(true)}><Check />Same</button>
          <button type="button" className={`gm-btn is-no${mine === "no" ? " is-on" : ""}`} aria-pressed={mine === "no"} onClick={() => vote(false)}>Different</button>
        </div>
      )}
      {playerId && proposal.by === playerId && <p className="gm-hint">Your idea. Waiting for the others to vote…</p>}
      {!playerId && <Clock game={game} deadline={proposal.deadline} total={MINDS_TIMES.voteMs} />}
    </section>
  );
}

// ---------- The TV ----------
function Scoreboard({ game }) {
  const round = game.round, answering = round?.phase === "answer", scored = round?.phase === "scored";
  return (
    <section className="gm-scores" aria-label="Scores">
      <h2>Scores</h2>
      <ol>
        {ranked(game).map((player) => {
          const isIn = round?.answered.includes(player.id), gained = scored ? round.points?.[player.id] : null;
          return (
            <li key={player.id} className={`${player.connected ? "" : "is-away"}${answering && isIn ? " is-in" : ""}${game.wolfId === player.id ? " has-wolf" : ""}`}>
              <span className="gm-score-name">{player.name}{!player.connected && <small> · away</small>}</span>
              {game.wolfId === player.id && <span className="gm-score-wolf" title="Holds the Lone Wolf"><WolfIcon /><span className="sr-only">holds the Lone Wolf</span></span>}
              <span className="gm-score-points">{player.score}</span>
              {answering && <span className="gm-score-status">{isIn ? <><Check />In</> : "Thinking…"}</span>}
              {gained != null && !game.tutorial && <span className={`gm-score-gain${gained ? "" : " is-zero"}`}>{points(gained)}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
function PromptCard({ game, small = false }) {
  return <div className={`gm-prompt${small ? " is-small" : ""}`}><span className="gm-prompt-round">{roundLabel(game)}</span><p>{game.round.prompt}</p></div>;
}
function AnswerStage({ game }) {
  const round = game.round, live = game.players.filter((p) => p.connected);
  return (
    <div className="gm-answering">
      <PromptCard game={game} />
      <p className="gm-callout">Answer on your phone. Say what everyone else will say!</p>
      <ul className="gm-bubbles" aria-label="Who’s locked in">
        {live.map((player) => <li key={player.id} className={round.answered.includes(player.id) ? "is-in" : ""}>{player.name}{round.answered.includes(player.id) && <Check />}</li>)}
      </ul>
    </div>
  );
}
function RevealStage({ game, onAction }) {
  const round = game.round, step = game.tutorial?.step;
  const allShown = round.groups.length >= round.groupCount;
  const lock = !game.hostless && round.phase === "review";
  return (
    <div className="gm-reveal">
      <PromptCard game={game} small />
      <GroupWall game={game} size={sizeFor} />
      {round.phase === "review" && game.hostless && !round.proposal && <p className="gm-callout is-quiet">Same answer, different words? Anyone can say so on their phone.</p>}
      {round.phase === "review" && <ProposalCard game={game} />}
      {round.phase === "scored" && <p className={`gm-wolf-news${round.alone?.length === 1 ? " is-moved" : ""}`}>{round.alone?.length === 1 && <WolfIcon />}{wolfNews(game)}</p>}
      {!game.hostless && (
        <div className="gm-tv-actions">
          {round.phase === "reveal" && !allShown && <button className="gm-btn" onClick={() => onAction("next", { at: nextAt(game) })}>Show them all</button>}
          {lock && <><span className="gm-hint">Merge or split answers from the host controller, then</span><button className="primary" onClick={() => onAction("next", { at: nextAt(game) })}>Lock the scores</button></>}
          {round.phase === "scored" && step !== "scored" && <button className="primary" onClick={() => onAction("next", { at: nextAt(game) })}>{game.index >= game.roundCount - 1 ? "See final scores" : "Next round"}</button>}
        </div>
      )}
    </div>
  );
}
function Lobby({ game, onAction }) {
  const ready = game.players.filter((player) => player.connected).length >= 2, base = useJoinBase();
  return (
    <div className="gm-lobby">
      <div className="gm-lobby-join">
        <div className="gm-code-card">
          <span className="gm-code-label">Room code</span>
          <b className="gm-code" aria-label={`Room code ${game.code.split("").join(" ")}`}>{game.code}</b>
          <span className="gm-lobby-url">Scan the code, or open <b>{displayAddress(base)}</b> and key it in.</span>
        </div>
        <figure className="gm-qr-card">
          <QRCode value={joinLink(base, game.code)} label={`QR code to join game ${game.code}`} />
          <figcaption>Scan to join</figcaption>
        </figure>
      </div>
      <ul className="gm-bubbles is-lobby" aria-label="Players">
        {game.players.map((player) => <li key={player.id} className={player.connected ? "is-in" : "is-away"}>{player.name}{!player.connected && <small> · reconnecting</small>}</li>)}
        {game.players.length < 12 && <li className="is-open">Your name here</li>}
      </ul>
      <p className="gm-lobby-note">{ready ? `${plural(game.roundCount, "prompt")}, ${Math.round(game.answerMs / 1000)} seconds to answer each. Score a point for everyone who says what you say.` : "Great Minds needs at least 2 players, and it’s best with 3 or more."}</p>
      <button className="primary gm-start" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
    </div>
  );
}
function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("1");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="sv-team-tools fib-player-tools gm-player-tools">
      <label className="inline-field">Adjust scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            <b className="gm-tool-score">{player.score}</b>
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
function RoundControls({ game, onAction }) {
  return (
    <div className="sv-round-controls gm-round-controls">
      {game.round && <button className="chip-btn" onClick={() => onAction("skip")}>Skip this prompt</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>End game early</button>
    </div>
  );
}

export function MindsDisplay({ game, onAction }) {
  const round = game.round, playing = game.status !== "lobby" && round;
  useTvSounds(game);
  useClockTicks(round?.phase === "answer" ? round.deadline : null, game.serverNow);
  return (
    <main className={`display gm gm-tv is-${round?.phase || "lobby"}`}>
      <SoundToggle />
      <header className="gm-tv-bar">
        <Logo />
        {playing ? <h1 className="gm-tv-title">{round.phase === "answer" ? "Think alike!" : round.phase === "scored" ? "Points!" : "The answers"}</h1> : <h1 className="gm-tv-title">Join the game</h1>}
        {playing && <Clock game={game} />}
        {playing && <JoinCorner code={game.code} />}
      </header>
      <Coach game={game} coach={MINDS_COACH} place="tv" />
      {!playing ? <Lobby game={game} onAction={onAction} /> : (
        <div className="gm-stage">
          <div className="gm-center">{round.phase === "answer" ? <AnswerStage game={game} /> : <RevealStage game={game} onAction={onAction} />}</div>
          <Scoreboard game={game} />
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools sv-host-tools gm-host-tools">
          <summary>Host tools</summary>
          {game.status === "playing" && !game.tutorial && <RoundControls game={game} onAction={onAction} />}
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

// ---------- Setup ----------
export function MindsSetup({ onCreate }) {
  const [rounds, setRounds] = useState(() => readNumber(ROUNDS_KEY, ROUND_COUNTS, 12)),
    [seconds, setSeconds] = useState(() => readNumber(CLOCK_KEY, ANSWER_SECONDS, DEFAULT_ANSWER_SECONDS)),
    [hostless, setHostless] = useState(false),
    [practice, setPractice] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const minutes = Math.round((rounds * (seconds + 35)) / 60);
  const start = () => {
    setNotice(""); setBusy(true);
    const prompts = dealPrompts(rounds);
    rememberPlayed(prompts);
    onCreate({ game: "minds", prompts, rounds, answerSeconds: seconds, hostless, tutorial: practice }, (e) => { setBusy(false); setNotice(e); });
  };
  const choose = (setter, key) => (value) => { setter(value); saveSetting(key, value); };
  return (
    <main className="setup gm-setup">
      <BackToHub />
      <Logo />
      <section className="gm-setup-card">
        <h1>Set up Great Minds</h1>
        <p className="gm-setup-intro">Everyone answers the same prompt on their phone. Score a point for every player who says what you say, and don’t be the one left alone: that’s how you end up with the Lone Wolf, and whoever holds it at the end can’t win.</p>
        <fieldset className="gm-fieldset">
          <legend>Prompts</legend>
          <div className="gm-choices" role="radiogroup" aria-label="Number of prompts">
            {ROUND_COUNTS.map((n) => <button key={n} role="radio" aria-checked={rounds === n} onClick={() => choose(setRounds, ROUNDS_KEY)(n)}><span>{n}</span></button>)}
          </div>
          <p className="gm-hint">About {minutes} minutes. Prompts are dealt from {PACK.prompts.length} in the pack, ones this screen hasn’t played first, and stay hidden so you can play too.</p>
        </fieldset>
        <fieldset className="gm-fieldset">
          <legend>Time to answer</legend>
          <div className="gm-choices" role="radiogroup" aria-label="Time to answer">
            {ANSWER_SECONDS.map((n) => <button key={n} role="radio" aria-checked={seconds === n} onClick={() => choose(setSeconds, CLOCK_KEY)(n)}><span>{n}s</span></button>)}
          </div>
          <p className="gm-hint">The clock stops early once everyone has answered.</p>
        </fieldset>
        <section className="game-options gm-options" aria-labelledby="gm-options-title">
          <h2 id="gm-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The game runs itself. Any player can say two answers are the same (“pancakes” and “flapjacks”), and they merge if more than half the room agrees. With a host, only the host merges or splits answers, from the host controller.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            <span><b>Practice round first</b><small>One practice prompt before round one, with tips on the TV and every phone about matching, scoring and the Lone Wolf. Nothing scores. {hostless ? "Players can vote to skip it." : "The host can skip it."}</small></span>
          </label>
        </section>
        <div className="gm-final-row">
          <p className="gm-summary">{rounds} prompts · {seconds}s each · 2 to 12 players, best with 3 or more</p>
          <button className="primary" disabled={busy} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- Player phone ----------
// The phone remembers what it sent for this prompt, so "Locked in: pancakes" survives a reload.
const answerKey = (game) => `gameNight.minds.answer.${game.code}.${game.tutorial ? "practice" : game.index}`;
function AnswerForm({ game, playerId }) {
  const [value, setValue] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const send = (e) => {
    e.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    socket.timeout(5000).emit("minds:answer", { code: game.code, playerId, text }, (err, result) => {
      setBusy(false);
      if (err) setError("Couldn’t reach the game. Try again.");
      else if (!result?.ok) setError(result?.error || "That didn’t go through.");
      else { try { sessionStorage.setItem(answerKey(game), text); } catch {} }
    });
  };
  return (
    <form className="gm-answer-form" onSubmit={send}>
      <label className="sr-only" htmlFor="gm-answer">Your answer</label>
      <input id="gm-answer" autoFocus autoComplete="off" autoCapitalize="sentences" enterKeyHint="send" maxLength={MAX_ANSWER_LENGTH} placeholder="Your answer" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary gm-lock" disabled={!value.trim() || busy}>{busy ? "Sending…" : "Lock it in"}</button>
    </form>
  );
}
// Without a host: tap two groups, then say they're the same.
function MergePicker({ game, playerId }) {
  const round = game.round, [picked, setPicked] = useState([]), [error, setError] = useState("");
  const used = round.proposalsUsed?.[playerId] || 0, left = PROPOSALS_PER_PLAYER - used;
  useEffect(() => setPicked((list) => list.filter((id) => round.groups.some((g) => g.id === id))), [round.groups.length]);
  const toggle = (id) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list.slice(-1), id]));
  const propose = () => socket.timeout(5000).emit("minds:propose", { code: game.code, playerId, groups: picked }, (err, result) => {
    if (err) setError("Couldn’t reach the game. Try again.");
    else if (!result?.ok) setError(result?.error || "That didn’t go through.");
    else { setError(""); setPicked([]); }
  });
  if (round.proposal) return <ProposalCard game={game} playerId={playerId} />;
  return (
    <section className="gm-merge" aria-label="Same answer?">
      <div className="gm-merge-top">
        <button type="button" className="primary gm-merge-go" disabled={picked.length !== 2 || left <= 0} onClick={propose}>{picked.length === 2 ? "Same answer!" : left > 0 ? `Tap two that match (${picked.length}/2)` : "No ideas left"}</button>
        <Clock game={game} />
      </div>
      {error && <p className="notice" role="alert">{error}</p>}
      <ul className="gm-merge-list">
        {round.groups.map((group) => <li key={group.id}><Group game={game} group={group} size="sm" selected={picked.includes(group.id)} onSelect={toggle} mine={group.members.includes(playerId)} /></li>)}
      </ul>
      <p className="gm-hint">More than half the room has to agree. You can float {plural(PROPOSALS_PER_PLAYER, "idea")} a round ({left} left).</p>
    </section>
  );
}
function MyRound({ game, playerId }) {
  const round = game.round, mine = groupOf(round, playerId), sent = (() => { try { return sessionStorage.getItem(answerKey(game)); } catch { return null; } })();
  if (round.phase === "answer") {
    if (!round.answered.includes(playerId)) return <AnswerForm key={answerKey(game)} game={game} playerId={playerId} />;
    return <div className="gm-locked"><Check /><p>Locked in{sent ? <>: <b>{sent}</b></> : ""}</p><small>{round.answered.length} of {game.players.filter((p) => p.connected).length} in. Waiting for the others…</small></div>;
  }
  if (round.phase === "reveal") return <div className="gm-locked is-watch"><p>{mine ? `“${mine.label}”: ${mine.members.length === 1 ? "on your own so far…" : `you and ${plural(mine.members.length - 1, "other")}!`}` : "Eyes on the TV!"}</p><small>{sent ? `You said “${sent}”.` : ""} The answers are coming up one group at a time.</small></div>;
  if (round.phase === "review") {
    if (game.hostless) return <MergePicker game={game} playerId={playerId} />;
    return <div className="gm-locked is-watch"><p>{mine ? `“${mine.label}”: ${mine.members.length === 1 ? "all on your own" : `you and ${plural(mine.members.length - 1, "other")}`}` : "Eyes on the TV!"}</p><small>The host is checking the matches before the scores lock.</small></div>;
  }
  // The scores are in.
  const gained = round.points?.[playerId] ?? 0, wolf = round.alone?.length === 1 && round.alone[0] === playerId;
  return (
    <div className={`gm-my-result${gained ? " is-scored" : ""}`}>
      <p className="gm-my-points">{game.tutorial ? "Practice" : points(gained)}<small>{game.tutorial ? "nothing scores" : gained === 1 ? "point this round" : "points this round"}</small></p>
      <p>{mine ? (mine.members.length === 1 ? `Nobody else said “${mine.label}”.` : `You and ${plural(mine.members.length - 1, "other")} said “${mine.label}”.`) : "No answer this time."}</p>
      {wolf && <p className="gm-my-wolf"><WolfIcon />{game.tutorial ? "You were the only one alone: in a real round you’d take the Lone Wolf." : round.wolfBefore === playerId ? "Alone again: you keep the Lone Wolf." : "You were the only one alone: you take the Lone Wolf!"}</p>}
      {!wolf && game.wolfId === playerId && <p className="gm-my-wolf"><WolfIcon />You still hold the Lone Wolf. Someone else has to end up alone to take it.</p>}
    </div>
  );
}
export function MindsPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), round = game.round;
  const myTurn = round?.phase === "answer" && !round.answered.includes(playerId);
  useEffect(() => { if (myTurn) { try { navigator.vibrate?.(120); } catch {} } }, [myTurn, game.index]);
  if (!player) return <main className="player gm gm-phone"><p className="gm-status">You’re no longer in this game.</p></main>;
  const place = 1 + game.players.filter((p) => p.score > player.score).length;
  return (
    <main className="player gm gm-phone">
      <header className="gm-phone-bar">
        <Logo small />
        <span className="gm-phone-name">{player.name}<b>{player.score}</b></span>
      </header>
      {game.wolfId === playerId && <p className="gm-wolf-banner"><WolfIcon />You hold the Lone Wolf. You can’t win while you have it.</p>}
      {game.status === "lobby" || !round ? <p className="gm-status">You’re in! The game starts when everyone’s here.</p> : (
        <>
          <div className="gm-phone-prompt">
            <span>{roundLabel(game)}{round.phase === "answer" && <Clock game={game} />}</span>
            <p>{round.prompt}</p>
          </div>
          <MyRound game={game} playerId={playerId} />
          <Coach game={game} coach={MINDS_COACH} place="phone" playerId={playerId} />
          {!game.tutorial && round.phase !== "answer" && game.players.length > 1 && <p className="gm-place">You’re {game.players.some((p) => p.id !== playerId && p.score === player.score) ? "tied for" : "in"} {ordinal(place)} place.</p>}
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
function HostMerge({ game, onAction }) {
  const round = game.round, [picked, setPicked] = useState([]);
  useEffect(() => setPicked((list) => list.filter((id) => round.groups.some((g) => g.id === id))), [round.groups.map((g) => g.id).join()]);
  const toggle = (id) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list.slice(-1), id]));
  const merge = () => { onAction("merge", { a: picked[0], b: picked[1] }); setPicked([]); };
  return (
    <section className="gm-merge is-host" aria-label="Merge or split">
      <button type="button" className="gm-btn gm-merge-go" disabled={picked.length !== 2} onClick={merge}>{picked.length === 2 ? "Merge these two" : `Tap two groups to merge (${picked.length}/2)`}</button>
      <ul className="gm-merge-list">
        {round.groups.map((group) => <li key={group.id}><Group game={game} group={group} size="sm" selected={picked.includes(group.id)} onSelect={toggle} onSplit={(playerId) => onAction("split", { playerId })} /></li>)}
      </ul>
      <p className="gm-hint">Tap a name in a group to split that answer off.</p>
    </section>
  );
}
export function MindsController({ game, onAction }) {
  const round = game.round, step = game.tutorial?.step;
  const header = <header className="gm-phone-bar"><Logo small /><b className="gm-ctrl-code" aria-label={`Game code ${game.code}`}>{game.code}</b></header>;
  if (game.status === "lobby" || !round)
    return (
      <main className="controller gm gm-phone">
        {header}
        <h1>Lobby</h1>
        <p className="gm-hint">Start the game from the main screen once at least two players have joined. {plural(game.roundCount, "prompt")}, {Math.round(game.answerMs / 1000)} seconds each.</p>
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
    );
  const live = game.players.filter((p) => p.connected).length;
  const nextLabel = round.phase === "answer" ? "Stop the clock" : round.phase === "reveal" ? "Show them all" : round.phase === "review" ? "Lock the scores" : game.index >= game.roundCount - 1 ? "See final scores" : "Next round";
  return (
    <main className="controller gm gm-phone">
      {header}
      <Coach game={game} coach={MINDS_COACH} place="controller" />
      <div className="gm-phone-prompt"><span>{roundLabel(game)}{round.phase === "answer" && <Clock game={game} />}</span><p>{round.prompt}</p></div>
      <p className="gm-ctrl-status" role="status">
        {round.phase === "answer" ? `${round.answered.length} of ${live} answered` : round.phase === "reveal" ? `Revealing: ${round.groups.length} of ${round.groupCount} groups` : round.phase === "review" ? "Check the matches, then lock the scores." : wolfNews(game)}
      </p>
      {!(round.phase === "scored" && step === "scored") && <button className="wide on" onClick={() => onAction("next", { at: nextAt(game) })}>{nextLabel}</button>}
      {round.phase === "review" && <HostMerge game={game} onAction={onAction} />}
      {round.phase !== "review" && round.groups.length > 0 && <ul className="gm-merge-list is-plain">{round.groups.map((group) => <li key={group.id}><Group game={game} group={group} size="sm" showPoints={round.phase === "scored"} /></li>)}</ul>}
      {!game.tutorial && <RoundControls game={game} onAction={onAction} />}
      <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
function Breakdown({ game, only }) {
  const players = only ? game.players.filter((p) => p.id === only) : ranked(game), history = game.history || [];
  if (!history.length) return null;
  if (only)
    return (
      <ol className="gm-my-rounds" aria-label="Your rounds">
        {history.map((round, i) => {
          const gained = round.points?.[only] ?? 0, took = round.alone?.length === 1 && round.alone[0] === only;
          return (
            <li key={i} className={gained ? "" : "is-zero"}>
              <span className="gm-r-num">{i + 1}</span>
              <span className="gm-r-text"><b>{round.prompt}</b><small>{round.answers?.[only] ? `You: “${round.answers[only]}”` : "No answer"}</small></span>
              <span className="gm-r-points">{took && <WolfIcon />}{points(gained)}</span>
            </li>
          );
        })}
      </ol>
    );
  return (
    <section className="gm-breakdown" aria-label="Round by round">
      <h2>Round by round</h2>
      <div className="gm-table-wrap">
        <table>
          <thead>
            <tr><th scope="col">Player</th>{history.map((round, i) => <th key={i} scope="col" title={round.prompt}>{i + 1}</th>)}<th scope="col">Total</th></tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={player.id} className={game.wolfId === player.id ? "has-wolf" : ""}>
                <th scope="row">{player.name}</th>
                {history.map((round, i) => {
                  const gained = round.points?.[player.id], took = round.alone?.length === 1 && round.alone[0] === player.id;
                  return <td key={i} className={`${gained ? "" : "is-zero"}${took ? " took-wolf" : ""}`}>{took && <WolfIcon />}{gained == null ? "–" : gained}</td>;
                })}
                <td className="gm-total">{player.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="gm-prompt-list">
        {history.map((round, i) => {
          const top = [...round.groups].sort((a, b) => b.members.length - a.members.length)[0];
          return <li key={i}><span className="gm-r-num">{i + 1}</span><span>{round.prompt}</span><b>{top ? `${top.label} ×${top.members.length}` : "No answers"}</b></li>;
        })}
      </ol>
    </section>
  );
}
export function MindsEnd({ game, host, display, onAction, playerId }) {
  const winners = game.winners || [], standings = ranked(game), wolf = game.wolfId;
  const eligible = standings.filter((p) => p.id !== wolf);
  const place = (p) => 1 + eligible.filter((q) => q.score > p.score).length;
  const title = !standings.length ? "Game over" : winners.length > 1 ? "It’s a tie!" : winners.length ? `${nameOf(game, winners[0])} wins!` : "Nobody wins!";
  const top = standings.find((p) => p.score === standings[0]?.score);
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  return (
    <main className={`end gm gm-end${display ? " gm-tv" : " gm-phone"}`}>
      {display && <SoundToggle />}
      <Logo small={!display} />
      <h1 className="gm-winner">{title}</h1>
      {wolf && top && top.id === wolf && <p className="gm-wolf-news is-moved"><WolfIcon />{nameOf(game, wolf)} had the top score but holds the Lone Wolf, so the win goes to the next best.</p>}
      {wolf && !(top && top.id === wolf) && <p className="gm-wolf-news"><WolfIcon />{nameOf(game, wolf)} finished with the Lone Wolf and couldn’t win.</p>}
      <ol className="gm-standings">
        {standings.map((p) => (
          <li key={p.id} className={`${winners.includes(p.id) ? "is-winner" : ""}${p.id === wolf ? " has-wolf" : ""}${p.id === playerId ? " is-me" : ""}`}>
            <span className="gm-place-num">{p.id === wolf ? <WolfIcon /> : place(p)}</span>
            <b>{p.name}</b>
            {p.id === wolf && <small>Lone Wolf · can’t win</small>}
            <span className="gm-standing-score">{p.score}</span>
          </li>
        ))}
      </ol>
      <Breakdown game={game} only={display || host ? null : playerId} />
      {host ? (
        <div className="gm-end-buttons">
          <button className="primary" onClick={() => onAction("replay", { prompts: (() => { const prompts = dealPrompts(game.roundCount); rememberPlayed(prompts); return prompts; })() })}>Play again with new prompts</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="gm-end-buttons"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
