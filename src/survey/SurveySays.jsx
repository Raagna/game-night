// Survey Says! screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
import React, { useEffect, useRef, useState } from "react";
import { socket, tone, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner, Departures } from "../JoinQR";
import { BackToHub } from "../Hub";
import SURVEYS from "../surveys.json";
import { useSound, useEventSounds, playWinnersTune, playTick } from "./sounds";
import "./survey.css";
import Flap from "../Flap";
import { Coach } from "../Tutorial";

// ---------- Picking questions ----------
const PLAYED_KEY = "gameNight.survey.played.v1";
const ROUND_CHOICES = [3, 4, 5, 6];
// Mirrors the server's point multipliers so setup can preview them.
const MULTIPLIERS = { 3: [1, 1, 2], 4: [1, 1, 2, 3], 5: [1, 1, 1, 2, 3], 6: [1, 1, 1, 2, 2, 3] };
const MULTIPLIER_NAME = { 2: "Double", 3: "Triple" };
const readPlayed = () => { try { return JSON.parse(localStorage.getItem(PLAYED_KEY)) || []; } catch { return []; } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-400))); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

// ---------- Question packs ----------
// The hand-written pack ships in the bundle. The packs with a file are built into public/data by
// scripts/build-*-surveys.py and fetched when the host opens Survey Says! (ProtoQA alone is over a megabyte).
const PACK_KEY = "gameNight.survey.pack.v1";
const PACKS = [
  { id: "all", label: "Everything" },
  { id: "classic", label: "Game Night" },
  { id: "protoqa", label: "ProtoQA", file: "surveys-protoqa.json" },
  { id: "sheet", label: "Feud Sheet", file: "surveys-sheet.json" },
];
const packLabel = (id) => PACKS.find((pack) => pack.id === id)?.label || id;
const loaded = { classic: SURVEYS };
let packsRequest = null;
const expand = ({ surveys }) => surveys.map(([id, question, answers]) => ({ id, question, answers: answers.map(([text, points, alts = []]) => ({ text, points, alts })) }));
// Settles once every pack has loaded or failed. A pack that failed is left out, and asked for again next time.
export function loadPacks() {
  packsRequest ||= Promise.all(PACKS.filter((pack) => pack.file && !loaded[pack.id]).map((pack) =>
    fetch(`${import.meta.env.BASE_URL}data/${pack.file}`)
      .then((response) => { if (!response.ok) throw new Error(`Couldn’t load the ${pack.label} questions.`); return response.json(); })
      .then((data) => { loaded[pack.id] = expand(data); })
      .catch(() => {}),
  )).then(() => { if (PACKS.some((pack) => pack.file && !loaded[pack.id])) packsRequest = null; });
  return packsRequest;
}
const packsLoaded = () => PACKS.every((pack) => !pack.file || loaded[pack.id]);
const readPack = () => { try { return localStorage.getItem(PACK_KEY) || "all"; } catch { return "all"; } };
const rememberPack = (pack) => { try { localStorage.setItem(PACK_KEY, pack); } catch {} };
// A pack that hasn't loaded (or can't) falls back to the hand-written questions.
const surveysIn = (pack) => (pack === "all" ? PACKS.flatMap(({ id }) => loaded[id] || []) : loaded[pack] || SURVEYS);

// Questions this browser hasn't played yet come first; once they run out, everything is back in the mix.
export function pickSurveys(count, exclude = [], pack = readPack()) {
  const all = surveysIn(pack), played = new Set(readPlayed()), skip = new Set(exclude);
  let pool = all.filter((survey) => !played.has(survey.id) && !skip.has(survey.id));
  if (pool.length < count) pool = all.filter((survey) => !skip.has(survey.id));
  return shuffle(pool).slice(0, count);
}

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || "A player";
const teamName = (game, team) => game.teams[team]?.name || `Team ${team + 1}`;
const membersOf = (game, team) => game.players.filter((player) => player.team === team);
const points = (value) => (value || 0).toLocaleString();
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const XIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>;
export const CheckIcon = () => <svg className="check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
export const SwapIcon = () => <svg className="dep-swap" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h14l-4-4M20 16H6l4 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const GUESS_RESULT = { hit: "On the board!", miss: "Not on the board", repeat: "Already on the board", timeout: "Time’s up" };

// The show's name on a lit plate, in place of the menu's split-flap brand.
function ShowTitle({ className = "" }) {
  return <div className={`sv-title${className ? ` ${className}` : ""}`}><span>Survey Says!</span></div>;
}
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
// A score that counts up (or down) to its new value, like the show's scoreboards. Reduced motion: it just changes.
export function useCountUp(value, ms = 900, initial = value) {
  const [shown, setShown] = useState(initial), from = useRef(initial), frame = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    const start = from.current;
    if (start === value || reducedMotion()) { from.current = value; setShown(value); return; }
    const began = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - began) / ms), next = Math.round(start + (value - start) * (1 - (1 - t) ** 3));
      from.current = next; setShown(next);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value]);
  return shown;
}
// intro: count up from zero when it first appears (the final scores).
function Score({ value, className = "", intro = false }) {
  const shown = useCountUp(value || 0, intro ? 1600 : 900, intro ? 0 : value || 0);
  return <span className={`sv-score${className ? ` ${className}` : ""}`} aria-label={points(value)}><span aria-hidden="true">{points(shown)}</span></span>;
}

function playHit() { tone(660, 0.14, "sine", 0.14); setTimeout(() => tone(990, 0.3, "sine", 0.14), 120); }
function playStrike() { tone(110, 0.6, "sawtooth", 0.13); }

// What the round is waiting for, in a headline and a line of detail.
function phaseText(game) {
  const round = game.round, faceoff = round.faceoff, [first, second] = faceoff.playerIds;
  switch (round.phase) {
    case "faceoffRead":
      return { title: "Face-off", detail: `${nameOf(game, first)} vs ${nameOf(game, second)} — get ready to buzz` };
    case "faceoff":
      return { title: "Face-off", detail: `${nameOf(game, first)} vs ${nameOf(game, second)} — buzz in!` };
    case "faceoffAnswer": {
      const who = nameOf(game, faceoff.answeringId);
      if (faceoff.firstHit) return { title: "Face-off", detail: `${who} has to beat “${round.answers[faceoff.firstHit.index]?.text}”` };
      if (faceoff.misses) return { title: "Face-off", detail: `${who}’s turn — anything on the board wins control` };
      return { title: "Face-off", detail: `${who} buzzed in first` };
    }
    case "choose":
      return { title: `${teamName(game, round.control)} won the face-off`, detail: `${nameOf(game, round.chooserId)} decides: play or pass?` };
    // "Up: The Smiths", not "The Smiths is playing": a team name can be singular or plural.
    case "guessing":
      return { title: `Up: ${teamName(game, round.control)}`, detail: `${nameOf(game, round.guesserId)}’s turn to guess` };
    case "steal":
      return { title: `${teamName(game, round.stealTeam)} can steal!`, detail: `One answer takes all ${points(round.bank)} points` };
    case "roundEnd":
      if (round.winner == null) return { title: "Question skipped", detail: "No points this round" };
      if (game.tutorial) return { title: `${teamName(game, round.winner)} ${round.winner === round.stealTeam ? "stole" : "won"} the practice round`, detail: `${points(round.awarded)} points in a real round. Practice scores stay at 0.` };
      return { title: `${teamName(game, round.winner)} ${round.winner === round.stealTeam ? "stole" : "won"} ${points(round.awarded)} points`, detail: "" };
    default:
      return { title: "", detail: "" };
  }
}

// "Round 2 of 5", or "Practice round" before round one.
const roundLabel = (game) => (game.tutorial ? "Practice round" : `Round ${game.roundIndex + 1} of ${game.roundCount}`);

// ---------- Practice round ----------
// The coach for the practice round (see docs/tutorial.md): what to do at each step, on the TV, the host controller and
// the phones. The steps come from the server (PRACTICE_STEPS in server/survey.js), read off the round's phase.
const facing = (game, me) => game.round?.faceoff.playerIds.includes(me);
const teamOf = (game, me) => game.players.find((player) => player.id === me)?.team;
const SURVEY_COACH = {
  faceoff: {
    tv: ({ game }) => `Face-off! One player from each team steps up. ${game.hostless ? "When the buzzers light up" : "Once the host has read the question"}, the first to buzz in answers.`,
    controller: "Read the question out loud. Phones buzz in by themselves; if someone slaps the table instead, tap their name.",
    phone: ({ game, me, name }) => facing(game, me) ? (game.round.phase === "faceoffRead" ? "You’re in the face-off! Read the question; your buzzer lights up in a moment." : "You’re in the face-off! Buzz in as soon as you think of an answer.") : `${name(game.round.faceoff.playerIds[0])} and ${name(game.round.faceoff.playerIds[1])} face off. Watch the TV.`,
  },
  answer: {
    tv: ({ game }) => `${game.hostless ? "Type" : "Say"} an answer. The number one answer wins control outright; anything else, and the other player gets a chance to beat it.`,
    controller: "Tap the answer they said, or Strike if it isn’t on the board. The number one answer wins outright; otherwise their rival tries to beat it.",
    phone: ({ game, me }) => game.round.faceoff.answeringId === me ? (game.hostless ? "Type an answer. The number one answer wins control outright." : "Say your answer out loud. The number one answer wins control outright.") : "A higher answer on the board wins control for that team.",
  },
  choose: {
    tv: ({ game }) => `${teamName(game, game.round.control)} won the face-off. They can play the question, or pass it to the other team.`,
    controller: "Tap Play or Pass for the team, or let the face-off winner choose on their phone.",
    phone: ({ game, me }) => game.round.chooserId === me ? "Play means your team guesses the rest of the board. Pass hands it to the other team." : "The face-off winner chooses: play the question, or pass it.",
  },
  guess: {
    tv: ({ game }) => `The team in control takes turns guessing, one player at a time. A wrong answer${game.hostless ? " or running out of time" : ""} is a strike: three strikes and the other team can steal. In practice, one strike is enough.`,
    controller: "Tap each answer they give, or Strike if it isn’t on the board. In practice, one strike goes to the steal.",
    phone: ({ game, me }) => game.round.guesserId === me ? (game.hostless ? "Your turn: type an answer you think is on the board." : "Your turn: say an answer out loud.") : teamOf(game, me) === game.round.control ? "Your team is guessing. Help out, but only the player whose turn it is answers." : "The other team is guessing. Think of an answer to steal with!",
  },
  steal: {
    tv: ({ game }) => `That was a strike, so ${teamName(game, game.round.stealTeam)} can steal: one answer on the board takes the whole bank. (A real round takes three strikes.)`,
    controller: "The stealing team agrees on one answer. Tap it if it’s on the board, or Strike if not.",
    phone: ({ game, me }) => teamOf(game, me) === game.round.stealTeam ? (game.hostless ? "Steal! Agree on one answer with your team: the first one sent counts." : "Steal! Huddle up and tell the host one answer.") : "The other team gets one answer to steal your bank.",
  },
  done: {
    tv: ({ game }) => `That’s the practice! A right steal takes the bank; a miss leaves it with the team in control. ${game.hostless ? "Round one starts in a few seconds." : "The host starts round one."}`,
    controller: "That’s the practice. Tap Start the game for round one, with the scores at 0.",
    phone: "That’s the practice! Scores stay at 0. Round one is next.",
    skip: "Start the game",
  },
};

// ---------- Setup ----------
export function SurveySetup({ onCreate }) {
  const [teamNames, setTeamNames] = useState(["", ""]),
    [rounds, setRounds] = useState(5),
    [pack, setPack] = useState(readPack),
    [packsReady, setPacksReady] = useState(packsLoaded),
    [picks, setPicks] = useState(() => pickSurveys(5, [], pack)),
    [hostless, setHostless] = useState(false),
    [practice, setPractice] = useState(true),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  // Once the packs arrive, deal a fresh set, unless the host has already started swapping questions.
  const edited = useRef(false);
  useEffect(() => {
    if (packsReady) return;
    let live = true;
    loadPacks().then(() => { if (!live) return; setPacksReady(true); if (!edited.current) setPicks((list) => pickSurveys(list.length, [], pack)); });
    return () => { live = false; };
  }, []);
  const multipliers = MULTIPLIERS[rounds];
  const changeRounds = (count) => {
    setRounds(count);
    setPicks((list) => (count <= list.length ? list.slice(0, count) : [...list, ...pickSurveys(count - list.length, list.map((s) => s.id), pack)]));
  };
  const swap = (index) => {
    edited.current = true;
    setPicks((list) => list.map((survey, i) => (i === index ? pickSurveys(1, list.map((s) => s.id), pack)[0] || survey : survey)));
  };
  const choosePack = (id) => {
    setPack(id); rememberPack(id);
    edited.current = false;
    setPicks(pickSurveys(rounds, [], id));
  };
  const shows = (id) => (pack === "all" || pack === id) && !!loaded[id];
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed(picks.map((survey) => survey.id));
    onCreate(
      { game: "survey", surveys: picks, teamNames: teamNames.map((name, i) => name.trim() || `Team ${i + 1}`), hostless, tutorial: practice },
      (error) => { setBusy(false); setNotice(error); },
    );
  };
  const doubles = multipliers.map((m, i) => (m === 2 ? i + 1 : null)).filter(Boolean), triples = multipliers.map((m, i) => (m === 3 ? i + 1 : null)).filter(Boolean);
  const list = (rounds) => rounds.length > 1 ? `rounds ${rounds.slice(0, -1).join(", ")} and ${rounds.at(-1)}` : `round ${rounds[0]}`;
  return (
    <main className="setup survey-setup">
      <BackToHub />
      <ShowTitle />
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Survey Says!</h1>
            <p className="muted">Two teams face off over “we asked 100 people” questions. Name the teams, pick how many rounds, and swap out any question you don’t like.</p>
          </div>
        </div>
        <div className="sv-setup-grid">
          <fieldset className="sv-fieldset">
            <legend>Teams</legend>
            {[0, 1].map((team) => (
              <label className="field" key={team}>
                <span>Team {team + 1} name</span>
                <input value={teamNames[team]} maxLength="24" placeholder={`Team ${team + 1}`} onChange={(e) => setTeamNames((names) => names.map((name, i) => (i === team ? e.target.value : name)))} />
              </label>
            ))}
          </fieldset>
          <fieldset className="sv-fieldset">
            <legend>Rounds</legend>
            <div className="sv-rounds" role="radiogroup" aria-label="Number of rounds">
              {ROUND_CHOICES.map((count) => (
                <button key={count} role="radio" aria-checked={rounds === count} onClick={() => changeRounds(count)}>{count}</button>
              ))}
            </div>
            <p className="muted sv-hint">
              Points are doubled in {list(doubles)}{triples.length ? ` and tripled in ${list(triples)}` : ""}. Highest score after the last round wins.
            </p>
          </fieldset>
        </div>
        <div className="sv-questions-head">
          <h2>Questions</h2>
          <div className="sv-packs" role="radiogroup" aria-label="Question pack">
            {PACKS.map(({ id, label }) => (
              <button key={id} role="radio" aria-checked={pack === id} onClick={() => choosePack(id)}>{label}</button>
            ))}
          </div>
          <button className="chip-btn" onClick={() => { edited.current = false; setPicks(pickSurveys(rounds, [], pack)); }}>New set</button>
        </div>
        <ol className="sv-question-list">
          {picks.map((survey, i) => (
            <li key={survey.id}>
              <span className="sv-q-round">Round {i + 1}{MULTIPLIER_NAME[multipliers[i]] && <em>{MULTIPLIER_NAME[multipliers[i]]}</em>}</span>
              <span className="sv-q-text">{survey.question}</span>
              <button className="chip-btn" aria-label={`Swap round ${i + 1} question`} onClick={() => swap(i)}>Swap</button>
            </li>
          ))}
        </ol>
        <p className="muted sv-hint">
          Answers stay hidden here so you can play too.{" "}
          {pack === "classic" ? "The answers and points are invented for this game, not from a real survey."
            : !packsReady ? "Loading the question packs…"
            : pack !== "all" && !loaded[pack] ? `The ${packLabel(pack)} questions couldn’t be loaded, so these are from the Game Night pack.`
            : pack === "protoqa" ? "ProtoQA boards use real survey counts, so some answers are dated or oddly spelled."
            : pack === "sheet" ? "Feud Sheet boards keep the answers and points from a shared Family Feud question spreadsheet."
            : "The Game Night pack’s answers are invented for this game; ProtoQA and Feud Sheet boards come from Family Feud-style surveys."}
        </p>
        {shows("protoqa") && (
          <p className="muted sv-hint sv-credit">
            ProtoQA questions from <a href="https://github.com/iesl/protoqa-data" target="_blank" rel="noreferrer">Boratko et al., 2020</a>,
            used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> and trimmed to each board’s top answers.
          </p>
        )}
        {shows("sheet") && (
          <p className="muted sv-hint sv-credit">
            Feud Sheet questions from the publicly shared <a href="https://docs.google.com/spreadsheets/d/1y5TtM4rXHfv_9BktCiJEW621939RzJucXxhJidJZbfQ/htmlview" target="_blank" rel="noreferrer">“Family Feud Question Database”</a> spreadsheet;
            its author and licence aren’t known.
          </p>
        )}
        <section className="game-options" aria-labelledby="sv-options-title">
          <h2 id="sv-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>Players type their guesses and the game checks them against the survey. Answers have to come fast, like on the show: 8 seconds for a face-off answer, 10 per guess, and 20 for the other team to confer on a steal. With a host, players say answers out loud and the host reveals them from their phone, and can give a stalling player a 3-second count.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            <span><b>Practice round first</b><small>One practice question before round one, with tips on the TV and every phone: the face-off buzz, play or pass, guessing, a strike and a steal. Nothing scores. {hostless ? "Players can vote to skip it." : "The host can skip it."}</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{rounds} rounds · {surveysIn(pack).length.toLocaleString()} questions in the pack</p>
          <button className="primary" disabled={busy} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- Shared pieces ----------
// The answer board: a lit panel for each answer, showing its number until it's found, when it turns over to show
// the answer and its points. Answers nobody found turn over in a darker blue at the end of the round, and an odd
// number of answers leaves a dark, empty panel, as on the show.
function AnswerBoard({ round, showAll = false, onReveal, disabled }) {
  const rows = Math.max(2, Math.ceil(round.answers.length / 2));
  if (onReveal)
    return (
      <ol className="sv-board sv-board-list">
        {round.answers.map((answer, i) => (
          <li key={i} className={`sv-slot${answer.revealed ? " is-revealed" : ""}`}>
            <button disabled={disabled || answer.revealed} onClick={() => onReveal(i)} aria-label={answer.revealed ? `${answer.text}, already revealed` : `Reveal ${answer.text}, ${answer.points} points`}>
              <span className="sv-slot-rank">{i + 1}</span>
              <span className="sv-slot-text">{answer.text}</span>
              <span className="sv-slot-points">{answer.points}</span>
              {answer.revealed && <CheckIcon />}
            </button>
          </li>
        ))}
      </ol>
    );
  const empty = rows * 2 - round.answers.length;
  return (
    <ol className="sv-board" style={{ "--rows": rows }}>
      {round.answers.map((answer, i) => {
        const shown = answer.revealed || (showAll && answer.text);
        const className = `sv-slot${shown ? " is-open" : ""}${answer.revealed ? " is-revealed" : shown ? " is-missed" : ""}${answer.team != null ? ` team-${answer.team}` : ""}`;
        return (
          <li key={i} className={className} style={{ "--i": i }} aria-label={shown ? `${i + 1}: ${answer.text}, ${answer.points} points${answer.revealed ? "" : ", not found"}` : `Answer ${i + 1}, hidden`}>
            <span className="sv-panel" aria-hidden="true">
              <span className="sv-face sv-front"><span className="sv-num">{i + 1}</span></span>
              <span className="sv-face sv-back">
                <span className="sv-answer">{shown ? answer.text : ""}</span>
                <span className="sv-pts">{shown ? answer.points : ""}</span>
                {answer.revealed && answer.team != null && <span className="sv-slot-team">{answer.team + 1}</span>}
              </span>
            </span>
          </li>
        );
      })}
      {Array.from({ length: empty }, (_, i) => <li key={`empty-${i}`} className="sv-slot is-void" aria-hidden="true"><span className="sv-panel"><span className="sv-face sv-front" /></span></li>)}
    </ol>
  );
}

function Strikes({ count, label = true }) {
  return (
    <div className="sv-strikes" role="img" aria-label={label ? `${count} of 3 strikes` : undefined}>
      {[0, 1, 2].map((i) => <span key={i} className={i < count ? "is-on" : ""}>{i < count && <XIcon />}</span>)}
    </div>
  );
}

function TeamPanel({ game, team }) {
  const round = game.round, inControl = round && round.control === team && !["roundEnd"].includes(round.phase);
  const active = round && [round.guesserId, round.chooserId, round.faceoff.answeringId].filter(Boolean);
  const facing = round && ["faceoffRead", "faceoff", "faceoffAnswer"].includes(round.phase) ? round.faceoff.playerIds[team] : null;
  const stealing = round?.phase === "steal" && round.stealTeam === team;
  return (
    <section className={`sv-team team-${team}${inControl ? " is-control" : ""}${stealing ? " is-stealing" : ""}`} aria-label={`${teamName(game, team)}: ${points(game.teams[team].score)} points`}>
      <h2><span className="sv-team-num" aria-hidden="true">{team + 1}</span>{teamName(game, team)}</h2>
      <Score className="sv-team-score" value={game.teams[team].score} />
      {inControl && <span className="sv-badge">In control</span>}
      {stealing && <span className="sv-badge">Stealing</span>}
      <ul>
        {membersOf(game, team).map((player) => (
          <li key={player.id} className={`${active?.includes(player.id) ? "is-active" : ""}${facing === player.id ? " is-facing" : ""}${player.connected ? "" : " is-away"}`}>
            {player.name}{!player.connected && <small> · reconnecting</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// The TV's buzzes and dings, and big red X's across it when someone strikes out.
function useStrikeFlash(game) {
  const [flash, setFlash] = useState(null);
  useEventSounds(game, (e) => { if (e.type === "strike") setFlash({ count: e.count || 1, at: e.at }); });
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1300);
    return () => clearTimeout(t);
  }, [flash]);
  return flash;
}

const SpeakerIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);
// The last three seconds of an answer clock, counted out big on the TV like the host's "3, 2, 1".
const ANSWER_PHASES = ["faceoffAnswer", "guessing", "steal"];
// It stays mounted under the strike X's (hidden), so the clock is worked out when each update arrives.
function FinalCount({ round, serverNow, hidden }) {
  const [count, setCount] = useState(null);
  const deadline = ANSWER_PHASES.includes(round.phase) ? round.deadline : null;
  useEffect(() => {
    setCount(null);
    if (!deadline) return;
    const end = Date.now() + (deadline - serverNow);
    // A second that has already gone by (the TV was reloaded mid-count) isn't counted late.
    const timers = [3, 2, 1].filter((n) => end - n * 1000 - Date.now() > -300)
      .map((n) => setTimeout(() => { setCount(n); playTick(n === 1); }, end - n * 1000 - Date.now()));
    timers.push(setTimeout(() => setCount(null), end - Date.now()));
    return () => timers.forEach(clearTimeout);
  }, [deadline]);
  return count && !hidden ? <div className="sv-final-count" key={count} aria-hidden="true"><span>{count}</span></div> : null;
}

// Sound on/off for the TV (remembered in this browser). Until someone clicks the page, browsers keep it silent.
export function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return (
    <button className="sv-sound" aria-pressed={!muted} onClick={toggle}>
      <SpeakerIcon off={muted} />
      {muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}
    </button>
  );
}

function LastGuess({ game }) {
  const guess = game.round?.lastGuess;
  if (!guess || (!guess.text && guess.result !== "timeout") || game.round.phase === "faceoffRead") return null;
  return (
    <p className={`sv-last-guess is-${guess.result}`} key={game.lastEvent?.at}>
      {guess.text && <q>{guess.text}</q>} <span>{guess.result === "timeout" ? `${guess.playerId ? nameOf(game, guess.playerId) : teamName(game, guess.team)} ran out of time` : GUESS_RESULT[guess.result]}</span>
    </p>
  );
}

function TeamTools({ game, onAction }) {
  const [amount, setAmount] = useState("10");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="sv-team-tools">
      <label className="inline-field">Adjust team scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      {[0, 1].map((team) => (
        <div className="sv-tool-team" key={team}>
          <div className="sv-tool-team-head">
            <input aria-label={`Team ${team + 1} name`} defaultValue={game.teams[team].name} key={game.teams[team].name} maxLength="24" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== game.teams[team].name && onAction("renameTeam", { team, name: e.target.value })} />
            <span className="money">{points(game.teams[team].score)}</span>
            <button className="chip-btn add" onClick={() => onAction("adjustScore", { team, amount: step })}>+{step}</button>
            <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { team, amount: -step })}>−{step}</button>
          </div>
          <ul>
            {membersOf(game, team).map((player) => (
              <li key={player.id}>
                <span>{player.name}{!player.connected && <small> · away</small>}</span>
                <button className="chip-btn" aria-label={`Move ${player.name} to ${teamName(game, 1 - team)}`} onClick={() => onAction("movePlayer", { playerId: player.id, team: 1 - team })}>Switch team</button>
                <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Kick</button>
              </li>
            ))}
            {!membersOf(game, team).length && <li className="muted">No players</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RoundControls({ game, onAction }) {
  const round = game.round, last = game.roundIndex >= game.roundCount - 1;
  return (
    <div className="sv-round-controls">
      <button className="chip-btn" disabled={!game.canUndo} onClick={() => onAction("undo")}>Undo last ruling</button>
      {round.phase !== "roundEnd" && <button className="chip-btn" onClick={() => onAction("skipRound")}>Skip this question</button>}
      {/* The practice round is left with its skip control instead. */}
      {!game.tutorial && <button className="chip-btn danger" onClick={() => onAction("endGame")}>{last ? "End game" : "End game early"}</button>}
    </div>
  );
}

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const ready = [0, 1].every((team) => membersOf(game, team).some((player) => player.connected));
  const full = game.players.length >= 12;
  return (
    <div className="lobby sv-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <div className="sv-lobby-teams">
        {[0, 1].map((team) => (
          <section key={team} className={`sv-lobby-team team-${team}`} aria-label={`${teamName(game, team)}: ${membersOf(game, team).length} players`}>
            <h2><span className="sv-team-num" aria-hidden="true">{team + 1}</span>{teamName(game, team)}</h2>
            <ol>
              {membersOf(game, team).map((player) => (
                <li key={player.id} className={player.connected ? "is-ready" : "is-away"}>
                  <button type="button" onClick={() => onAction("movePlayer", { playerId: player.id, team: 1 - team })} aria-label={`${player.name}, ${player.connected ? "ready" : "reconnecting"}. Move to ${teamName(game, 1 - team)}`}>
                    <span className="sv-lobby-name">{player.name}</span><SwapIcon />
                  </button>
                  <span className="sv-lobby-status">{player.connected ? "Ready" : "Away"}</span>
                </li>
              ))}
              {!full && <li className="is-open"><span className="sv-lobby-name">{membersOf(game, team).length ? "Room for more" : "Waiting for players"}</span></li>}
            </ol>
          </section>
        ))}
      </div>
      <p className="muted">Players choose a team on their phone. Tap a name to move someone to the other team.</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
      {!ready && <p className="muted">Each team needs at least one player to start.</p>}
    </div>
  );
}

export function SurveyDisplay({ game, onAction }) {
  const round = game.round, flash = useStrikeFlash(game);
  const timed = round && round.deadline && !["faceoffRead", "roundEnd"].includes(round.phase);
  const { title, detail } = round ? phaseText(game) : {};
  const last = game.roundIndex >= game.roundCount - 1;
  return (
    <main className="display survey">
      <SoundToggle />
      <header className="display-bar">
        <ShowTitle />
        {game.status !== "lobby" ? (
          <JoinCorner code={game.code} />
        ) : <span />}
        <ClueTimer deadline={timed ? round.deadline : null} serverNow={game.serverNow} />
      </header>
      <Coach game={game} coach={SURVEY_COACH} place="tv" />
      {game.status === "lobby" || !round ? (
        <Lobby game={game} onAction={onAction} />
      ) : (
        <div className="sv-stage">
          <TeamPanel game={game} team={0} />
          <div className="sv-center">
            <h1 className="sv-question">{round.question}</h1>
            {/* The scoreboard row over the board: the round, the bank, and the strikes. */}
            <div className="sv-scoreline">
              <p className="sv-round-tag">
                <span>{roundLabel(game)}</span>
                {MULTIPLIER_NAME[game.multiplier] && <span className="sv-mult-tag">{MULTIPLIER_NAME[game.multiplier]} points</span>}
              </p>
              <div className="sv-bank" aria-label={`${points(round.bank)} points in the bank`}><span className="sv-bank-label">Bank</span><Score value={round.bank} /></div>
              <Strikes count={["guessing", "steal"].includes(round.phase) || (round.phase === "roundEnd" && round.stealTeam != null) ? round.strikes : 0} />
            </div>
            <div className="sv-board-wrap">
              <AnswerBoard round={round} showAll={round.phase === "roundEnd"} />
              {flash && <div className="sv-strike-flash" key={flash.at} aria-hidden="true">{Array.from({ length: flash.count }, (_, i) => <XIcon key={i} />)}</div>}
              <FinalCount round={round} serverNow={game.serverNow} hidden={!!flash} />
            </div>
            <div className="sv-status" role="status">
              <h2>{title}</h2>
              {detail && <p>{detail}</p>}
              <LastGuess game={game} />
            </div>
            {/* After the practice question, the coach's button starts round one. */}
            {round.phase === "roundEnd" && !game.tutorial && (
              <button className="primary sv-next" onClick={() => onAction("nextRound")}>{last ? "See final scores" : "Next question"}</button>
            )}
            {round.phase === "roundEnd" && game.hostless && !game.tutorial && <p className="muted">{last ? "Final scores" : "The next question"} will appear in a few seconds.</p>}
          </div>
          <TeamPanel game={game} team={1} />
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools sv-host-tools">
          <summary>Host tools</summary>
          {round && game.status === "playing" && <RoundControls game={game} onAction={onAction} />}
          <TeamTools game={game} onAction={onAction} />
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
function GuessBox({ game, playerId, label }) {
  const [guess, setGuess] = useState(""), [sent, setSent] = useState(false);
  const send = (event) => {
    event.preventDefault();
    if (!guess.trim() || sent) return;
    setSent(true);
    socket.emit("survey:guess", { code: game.code, playerId, guess });
  };
  return (
    <form className="final-form sv-guess" onSubmit={send}>
      <div className="sv-guess-top">
        <span className="sv-guess-label">{label}</span>
        <ClueTimer deadline={game.round.deadline} serverNow={game.serverNow} />
      </div>
      <input autoFocus aria-label="Your answer" autoComplete="off" autoCapitalize="off" enterKeyHint="send" maxLength="80" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Type your answer" disabled={sent} />
      <button className="primary" disabled={!guess.trim() || sent}>{sent ? "Checking…" : "Submit answer"}</button>
    </form>
  );
}

function PlayerAction({ game, player }) {
  const round = game.round, me = player.id, myTeam = player.team, faceoff = round.faceoff;
  const status = (text, you = false) => <p className={"player-status" + (you ? " is-you" : "")}>{text}</p>;
  const sayIt = status("Your turn — say your answer out loud!", true);
  switch (round.phase) {
    case "faceoffRead":
    case "faceoff":
      if (faceoff.playerIds.includes(me))
        return (
          <>
            {status(round.phase === "faceoff" ? "Buzz in!" : "You’re in the face-off. Get ready…", true)}
            <button className={"buzzer" + (round.phase === "faceoff" ? " ready" : "")} disabled={round.phase !== "faceoff"} onClick={() => { tone(420, 0.1, "square"); socket.emit("survey:buzz", { code: game.code, playerId: me }); }}>BUZZ!</button>
          </>
        );
      return status(`${nameOf(game, faceoff.playerIds[0])} and ${nameOf(game, faceoff.playerIds[1])} are facing off`);
    case "faceoffAnswer":
      if (faceoff.answeringId === me)
        return game.hostless ? <GuessBox key={`fo-${faceoff.misses}-${faceoff.firstHit?.index}`} game={game} playerId={me} label={faceoff.firstHit ? `Beat “${round.answers[faceoff.firstHit.index]?.text}”` : "Face-off — what’s on the board?"} /> : sayIt;
      return status(`${nameOf(game, faceoff.answeringId)} is answering the face-off`);
    case "choose":
      if (round.chooserId === me)
        return (
          <div className="sv-choose">
            {status("You won the face-off! Play this question, or pass it to the other team?", true)}
            <div className="sv-choose-buttons">
              <button className="primary" onClick={() => socket.emit("survey:choose", { code: game.code, playerId: me, play: true })}>Play</button>
              <button className="secondary" onClick={() => socket.emit("survey:choose", { code: game.code, playerId: me, play: false })}>Pass</button>
            </div>
            {game.hostless && <ClueTimer deadline={round.deadline} serverNow={game.serverNow} />}
          </div>
        );
      return status(`${nameOf(game, round.chooserId)} is choosing to play or pass`);
    case "guessing":
      if (round.guesserId === me) return game.hostless ? <GuessBox key={`g-${round.answers.filter((a) => a.revealed).length}-${round.strikes}`} game={game} playerId={me} label="Your turn to guess" /> : sayIt;
      if (myTeam === round.control) return status(`${nameOf(game, round.guesserId)} is guessing — help them out!`);
      return status(`Up: ${teamName(game, round.control)}. Think of a steal answer!`);
    case "steal":
      if (myTeam === round.stealTeam)
        return game.hostless
          ? <GuessBox game={game} playerId={me} label="Steal! Agree on one answer — the first one your team sends counts" />
          : status("Steal! Huddle up and tell the host your team’s answer.", true);
      return status(`${teamName(game, round.stealTeam)} can steal your bank`);
    case "roundEnd": {
      const { title } = phaseText(game);
      return status(title, round.winner === myTeam);
    }
    default:
      return null;
  }
}

export function SurveyPlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), round = game.round;
  const [signal, setSignal] = useState("");
  const myTurn = round && player && ((round.phase === "guessing" && round.guesserId === playerId) || (round.phase === "faceoffAnswer" && round.faceoff.answeringId === playerId) || (round.phase === "choose" && round.chooserId === playerId) || (round.phase === "steal" && round.stealTeam === player.team));
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) { try { navigator.vibrate?.(120); } catch {} }
    wasMyTurn.current = !!myTurn;
  }, [myTurn]);
  useEffect(() => {
    const e = game.lastEvent;
    if (!e || !player || Date.now() - e.at > 4000) return;
    if (e.type === "hit" && e.team === player.team) { playHit(); setSignal("correct"); }
    else if (e.type === "strike" && e.team === player.team) { playStrike(); setSignal("incorrect"); }
    else return;
    const t = setTimeout(() => setSignal(""), 2400);
    return () => clearTimeout(t);
  }, [game.lastEvent?.at]);
  if (!player) return <main className="player survey"><p className="status-card">You’re no longer in this game.</p></main>;
  const myTeam = game.teams[player.team];
  const myGuess = round?.lastGuess && (round.lastGuess.playerId === playerId || (round.lastGuess.team === player.team && !round.lastGuess.playerId)) ? round.lastGuess : null;
  return (
    <main className={`player survey ${signal ? `signal-${signal}` : ""}`}>
      <header className="player-bar">
        <ShowTitle className="is-small" />
        <span className="player-name">{player.name}</span>
      </header>
      <div className={`sv-my-team team-${player.team}`}>
        <span className="sv-my-name"><span className="sv-team-num" aria-hidden="true">{player.team + 1}</span>{myTeam.name}</span>
        <Score value={myTeam.score} />
      </div>
      <Coach game={game} coach={SURVEY_COACH} place="phone" playerId={playerId} />
      {game.status === "lobby" || !round ? (
        <div className="sv-team-pick">
          <p className="player-status">Pick your team, then wait for the game to start.</p>
          <div className="sv-team-pick-buttons" role="radiogroup" aria-label="Your team">
            {[0, 1].map((team) => (
              <button key={team} role="radio" aria-checked={player.team === team} className={`team-${team}`} onClick={() => socket.emit("survey:team", { code: game.code, playerId, team })}>
                <span className="sv-pick-name"><span className="sv-team-num" aria-hidden="true">{team + 1}</span>{teamName(game, team)}</span>
                <small>{membersOf(game, team).length} {membersOf(game, team).length === 1 ? "player" : "players"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="player-clue-meta">{roundLabel(game)}{MULTIPLIER_NAME[game.multiplier] ? ` · ${MULTIPLIER_NAME[game.multiplier]} points` : ""}</p>
          <p className="sv-phone-question">{round.question}</p>
          <div className="sv-phone-meta">
            <span>{round.answers.filter((a) => a.revealed).length} of {round.answers.length} found · bank {points(round.bank)}</span>
            {round.phase === "guessing" && <Strikes count={round.strikes} />}
          </div>
          <PlayerAction game={game} player={player} />
          {myGuess && myGuess.text && round.phase !== "roundEnd" && <p className={`sv-last-guess is-${myGuess.result}`}><q>{myGuess.text}</q> <span>{GUESS_RESULT[myGuess.result]}</span></p>}
          {round.phase === "roundEnd" && <AnswerBoard round={round} showAll />}
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
export function SurveyController({ game, onAction }) {
  const round = game.round;
  const header = (
    <header className="controller-bar">
      <ShowTitle className="is-small" />
      <Flap className="code-chip" text={game.code} label={`Game code ${game.code}`} />
    </header>
  );
  if (game.status === "lobby" || !round)
    return (
      <main className="controller survey">
        {header}
        <h1>Lobby</h1>
        <p className="muted">Start the game from the main screen once both teams have players.</p>
        <section className="controller-players">
          <h2>Teams</h2>
          <TeamTools game={game} onAction={onAction} />
        </section>
      </main>
    );
  const { title, detail } = phaseText(game), faceoff = round.faceoff;
  const judging = ["faceoffAnswer", "guessing", "steal"].includes(round.phase);
  const answering = round.phase === "faceoffAnswer" ? nameOf(game, faceoff.answeringId) : round.phase === "guessing" ? nameOf(game, round.guesserId) : round.phase === "steal" ? teamName(game, round.stealTeam) : null;
  const last = game.roundIndex >= game.roundCount - 1;
  return (
    <main className="controller survey">
      {header}
      <Coach game={game} coach={SURVEY_COACH} place="controller" />
      <p className="player-clue-meta">{roundLabel(game)}{MULTIPLIER_NAME[game.multiplier] ? ` · ${MULTIPLIER_NAME[game.multiplier]} points` : ""} · bank {points(round.bank)}</p>
      <h1 className="sv-ctrl-question">{round.question}</h1>
      <div className="sv-ctrl-status" role="status"><b>{title}</b>{detail && <span>{detail}</span>}</div>
      {(round.phase === "faceoffRead" || round.phase === "faceoff") && (
        <div className="judgement">
          <h2>Who buzzed first?</h2>
          <p className="muted">Phones buzz in by themselves. Tap a name if someone slapped the table instead.</p>
          <div className="verdict sv-buzz-pick">
            {faceoff.playerIds.filter(Boolean).map((id) => <button key={id} onClick={() => onAction("buzz", { playerId: id })}>{nameOf(game, id)}</button>)}
          </div>
        </div>
      )}
      {round.phase === "choose" && (
        <div className="judgement">
          <h2>{teamName(game, round.control)}: play or pass?</h2>
          <div className="sv-choose-buttons">
            <button className="primary" onClick={() => onAction("choose", { play: true })}>Play</button>
            <button className="secondary" onClick={() => onAction("choose", { play: false })}>Pass</button>
          </div>
        </div>
      )}
      {judging && <p className="status-note">Answering: <b>{answering}</b>{round.phase === "guessing" ? ` · ${round.strikes} of 3 strikes` : ""}</p>}
      <p className="muted sv-ctrl-hint">{judging ? "Tap the answer they gave, or Strike if it isn’t on the board." : "The survey answers:"}</p>
      <AnswerBoard round={round} showAll onReveal={(index) => onAction("reveal", { index })} disabled={!judging} />
      {judging && <button className="close sv-strike-btn" onClick={() => onAction("strike")}><XIcon /> Strike — not on the board</button>}
      {judging && (
        // Like the TV host's "I need an answer": three seconds, then it's a strike.
        <button className="secondary sv-time-btn" disabled={!!round.deadline} onClick={() => onAction("countdown")}>
          {round.deadline ? <>Counting down <ClueTimer deadline={round.deadline} serverNow={game.serverNow} /></> : "Time! — give them 3 seconds"}
        </button>
      )}
      {round.phase === "roundEnd" && !game.tutorial && <button className="wide on" onClick={() => onAction("nextRound")}>{last ? "See final scores" : "Next question"}</button>}
      <RoundControls game={game} onAction={onAction} />
      <section className="controller-players">
        <h2>Teams</h2>
        <TeamTools game={game} onAction={onAction} />
      </section>
    </main>
  );
}

// ---------- End of game ----------
// display: this is the TV screen (not the host controller or a phone), which is the one that plays the tune.
export function SurveyEnd({ game, host, display, onAction }) {
  const [a, b] = game.teams, winner = a.score === b.score ? null : a.score > b.score ? 0 : 1;
  // A host who reloaded mid-game hasn't fetched the question packs yet; get them in time for "Play again".
  useEffect(() => { if (host) loadPacks(); }, [host]);
  // The winners tune plays once when the scores appear (not when the TV is reloaded later), and fades out
  // if the screen changes first.
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  const playAgain = () => {
    const surveys = pickSurveys(game.roundCount);
    rememberPlayed(surveys.map((s) => s.id));
    onAction("replay", { surveys });
  };
  return (
    <main className="end survey">
      {display && <SoundToggle />}
      <ShowTitle />
      <h1 className="sv-winner-title">{winner == null ? "It’s a tie!" : `${teamName(game, winner)} win!`}</h1>
      <div className="sv-final-scores">
        {[0, 1].map((team) => (
          <section key={team} className={`sv-final-team team-${team}${winner === team ? " is-winner" : ""}`}>
            <h2><span className="sv-team-num" aria-hidden="true">{team + 1}</span>{teamName(game, team)}{winner === team && <span className="sv-winner-tag">Winner</span>}</h2>
            <Score className="sv-final-score" value={game.teams[team].score} intro />
            <p>{membersOf(game, team).map((p) => p.name).join(", ") || "No players"}</p>
          </section>
        ))}
      </div>
      {host ? (
        <div className="sv-end-buttons">
          <button className="primary" onClick={playAgain}>Play again with new questions</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
