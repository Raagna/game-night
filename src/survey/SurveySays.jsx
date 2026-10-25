// Survey Says! screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
import React, { useEffect, useRef, useState } from "react";
import { socket, tone, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner } from "../JoinQR";
import { BackToHub } from "../Hub";
import SURVEYS from "../surveys.json";
import "./survey.css";

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
// The hand-written pack ships in the bundle. The ProtoQA pack (scripts/build-protoqa-surveys.py) is over a
// megabyte, so it's fetched from public/data when the host opens Survey Says!
const PACK_KEY = "gameNight.survey.pack.v1";
const PACKS = [{ id: "all", label: "Everything" }, { id: "classic", label: "Game Night" }, { id: "protoqa", label: "ProtoQA" }];
let protoqa = [], protoqaRequest = null;
export function loadProtoQA() {
  protoqaRequest ||= fetch(`${import.meta.env.BASE_URL}data/surveys-protoqa.json`)
    .then((response) => { if (!response.ok) throw new Error("Couldn’t load the ProtoQA questions."); return response.json(); })
    .then(({ surveys }) => (protoqa = surveys.map(([id, question, answers]) => ({ id, question, answers: answers.map(([text, points, alts = []]) => ({ text, points, alts })) }))))
    .catch((error) => { protoqaRequest = null; throw error; });
  return protoqaRequest;
}
const readPack = () => { try { return localStorage.getItem(PACK_KEY) || "all"; } catch { return "all"; } };
const rememberPack = (pack) => { try { localStorage.setItem(PACK_KEY, pack); } catch {} };
// Until the ProtoQA pack has loaded (or if it can't), every pack falls back to the hand-written questions.
const surveysIn = (pack) => (pack === "classic" || !protoqa.length ? SURVEYS : pack === "protoqa" ? protoqa : [...SURVEYS, ...protoqa]);

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
const GUESS_RESULT = { hit: "On the board!", miss: "Not on the board", repeat: "Already on the board", timeout: "Time’s up" };

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
    case "guessing":
      return { title: `${teamName(game, round.control)} is playing`, detail: `${nameOf(game, round.guesserId)}’s turn to guess` };
    case "steal":
      return { title: `${teamName(game, round.stealTeam)} can steal!`, detail: `One answer takes all ${points(round.bank)} points` };
    case "roundEnd":
      if (round.winner == null) return { title: "Question skipped", detail: "No points this round" };
      return { title: `${teamName(game, round.winner)} ${round.winner === round.stealTeam ? "stole" : "won"} ${points(round.awarded)} points`, detail: "" };
    default:
      return { title: "", detail: "" };
  }
}

// ---------- Setup ----------
export function SurveySetup({ onCreate }) {
  const [teamNames, setTeamNames] = useState(["", ""]),
    [rounds, setRounds] = useState(5),
    [pack, setPack] = useState(readPack),
    [packStatus, setPackStatus] = useState(protoqa.length ? "ready" : "loading"),
    [picks, setPicks] = useState(() => pickSurveys(5, [], pack)),
    [hostless, setHostless] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  // Once the ProtoQA pack arrives, deal a fresh set, unless the host has already started swapping questions.
  const edited = useRef(false);
  useEffect(() => {
    if (protoqa.length) return;
    let live = true;
    loadProtoQA()
      .then(() => { if (!live) return; setPackStatus("ready"); if (!edited.current) setPicks((list) => pickSurveys(list.length, [], pack)); })
      .catch(() => live && setPackStatus("failed"));
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
  const hasProtoqa = pack !== "classic" && packStatus === "ready";
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed(picks.map((survey) => survey.id));
    onCreate(
      { game: "survey", surveys: picks, teamNames: teamNames.map((name, i) => name.trim() || `Team ${i + 1}`), hostless },
      (error) => { setBusy(false); setNotice(error); },
    );
  };
  const doubles = multipliers.map((m, i) => (m === 2 ? i + 1 : null)).filter(Boolean), triples = multipliers.map((m, i) => (m === 3 ? i + 1 : null)).filter(Boolean);
  const list = (rounds) => rounds.length > 1 ? `rounds ${rounds.slice(0, -1).join(", ")} and ${rounds.at(-1)}` : `round ${rounds[0]}`;
  return (
    <main className="setup survey-setup">
      <BackToHub />
      <div className="brand survey-brand">SURVEY SAYS! <span>game night</span></div>
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
            : packStatus === "loading" ? "Loading the ProtoQA questions…"
            : packStatus === "failed" ? "The ProtoQA questions couldn’t be loaded, so these are from the Game Night pack."
            : pack === "protoqa" ? "ProtoQA boards use real survey counts, so some answers are dated or oddly spelled."
            : "ProtoQA boards use real survey counts; the Game Night pack’s answers are invented for this game."}
        </p>
        {hasProtoqa && (
          <p className="muted sv-hint sv-credit">
            ProtoQA questions from <a href="https://github.com/iesl/protoqa-data" target="_blank" rel="noreferrer">Boratko et al., 2020</a>,
            used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a> and trimmed to each board’s top answers.
          </p>
        )}
        <section className="game-options" aria-labelledby="sv-options-title">
          <h2 id="sv-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>Players type their guesses and the game checks them against the survey. With a host, players say answers out loud and the host reveals them from their phone.</small></span>
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
function AnswerBoard({ round, showAll = false, onReveal, disabled }) {
  const rows = Math.max(2, Math.ceil(round.answers.length / 2));
  return (
    <ol className="sv-board" style={{ "--rows": rows }}>
      {round.answers.map((answer, i) => {
        const shown = answer.revealed || (showAll && answer.text);
        const className = `sv-slot${answer.revealed ? " is-revealed" : shown ? " is-missed" : ""}${answer.team != null ? ` team-${answer.team}` : ""}`;
        const inner = shown ? (
          <><span className="sv-slot-text">{answer.text}</span><span className="sv-slot-points">{answer.points}</span></>
        ) : (
          <span className="sv-slot-num">{i + 1}</span>
        );
        return (
          <li key={`${i}-${!!shown}`} className={className}>
            {onReveal ? (
              <button disabled={disabled || answer.revealed} onClick={() => onReveal(i)} aria-label={answer.revealed ? `${answer.text}, already revealed` : `Reveal ${answer.text}, ${answer.points} points`}>
                <span className="sv-slot-rank">{i + 1}</span>{inner}
              </button>
            ) : inner}
          </li>
        );
      })}
    </ol>
  );
}

function Strikes({ count, label = true }) {
  return (
    <div className="sv-strikes" role="img" aria-label={label ? `${count} of 3 strikes` : undefined}>
      {[0, 1, 2].map((i) => <span key={i} className={i < count ? "is-on" : ""}><XIcon /></span>)}
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
      <h2>{teamName(game, team)}</h2>
      <div className="sv-team-score money">{points(game.teams[team].score)}</div>
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

// Big red X's across the TV when someone strikes out.
function useStrikeFlash(game) {
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    const e = game.lastEvent;
    if (!e || Date.now() - e.at > 4000) return;
    if (e.type === "strike") { playStrike(); setFlash({ count: e.count || 1, at: e.at }); const t = setTimeout(() => setFlash(null), 1300); return () => clearTimeout(t); }
    if (e.type === "hit") playHit();
    if (e.type === "roundWon") { tone(523, 0.18); setTimeout(() => tone(659, 0.18), 160); setTimeout(() => tone(784, 0.4), 320); }
  }, [game.lastEvent?.at]);
  return flash;
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
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>{last ? "End game" : "End game early"}</button>
    </div>
  );
}

// ---------- Shared TV display ----------
function Lobby({ game, onAction }) {
  const ready = [0, 1].every((team) => membersOf(game, team).some((player) => player.connected));
  return (
    <div className="lobby sv-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <div className="sv-lobby-teams">
        {[0, 1].map((team) => (
          <section key={team} className={`sv-lobby-team team-${team}`}>
            <h2>{teamName(game, team)}</h2>
            <ul>
              {membersOf(game, team).map((player) => (
                <li key={player.id}>
                  <button onClick={() => onAction("movePlayer", { playerId: player.id, team: 1 - team })} aria-label={`Move ${player.name} to ${teamName(game, 1 - team)}`}>
                    {player.name} <span aria-hidden="true">⇄</span>
                  </button>
                </li>
              ))}
              {!membersOf(game, team).length && <li className="muted">Nobody yet</li>}
            </ul>
          </section>
        ))}
      </div>
      <p className="muted">Players choose a team on their phone. Tap a name to move someone.</p>
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
      <header className="display-bar">
        <div className="brand survey-brand">SURVEY SAYS!</div>
        {game.status !== "lobby" ? (
          <JoinCorner code={game.code} />
        ) : <span />}
        <ClueTimer deadline={timed ? round.deadline : null} serverNow={game.serverNow} />
      </header>
      {game.status === "lobby" || !round ? (
        <Lobby game={game} onAction={onAction} />
      ) : (
        <div className="sv-stage">
          <TeamPanel game={game} team={0} />
          <div className="sv-center">
            <p className="sv-round-label">
              Round {game.roundIndex + 1} of {game.roundCount}
              {MULTIPLIER_NAME[game.multiplier] && <em>{MULTIPLIER_NAME[game.multiplier]} points</em>}
            </p>
            <h1 className="sv-question">{round.question}</h1>
            <div className="sv-bank" aria-label={`${points(round.bank)} points in the bank`}><span>Bank</span><b className="money">{points(round.bank)}</b></div>
            <div className="sv-board-wrap">
              <AnswerBoard round={round} showAll={round.phase === "roundEnd"} />
              {flash && <div className="sv-strike-flash" key={flash.at} aria-hidden="true">{Array.from({ length: flash.count }, (_, i) => <XIcon key={i} />)}</div>}
            </div>
            <Strikes count={["guessing", "steal"].includes(round.phase) || (round.phase === "roundEnd" && round.stealTeam != null) ? round.strikes : 0} />
            <div className="sv-status" role="status">
              <h2>{title}</h2>
              {detail && <p>{detail}</p>}
              <LastGuess game={game} />
            </div>
            {round.phase === "roundEnd" && (
              <button className="primary sv-next" onClick={() => onAction("nextRound")}>{last ? "See final scores" : "Next question"}</button>
            )}
            {round.phase === "roundEnd" && game.hostless && <p className="muted">{last ? "Final scores" : "The next question"} will appear in a few seconds.</p>}
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
      return status(`${teamName(game, round.control)} is guessing. Think of a steal answer!`);
    case "steal":
      if (myTeam === round.stealTeam)
        return game.hostless
          ? <GuessBox game={game} playerId={me} label="Steal! Agree on one answer — the first one your team sends counts" />
          : status("Steal! Huddle up and tell the host your team’s answer.", true);
      return status(`${teamName(game, round.stealTeam)} is trying to steal`);
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
        <span className="brand survey-brand">SURVEY SAYS!</span>
        <span className="player-name">{player.name}</span>
      </header>
      <div className={`sv-my-team team-${player.team}`}>
        <span>{myTeam.name}</span>
        <b className="money">{points(myTeam.score)}</b>
      </div>
      {game.status === "lobby" || !round ? (
        <div className="sv-team-pick">
          <p className="player-status">Pick your team, then wait for the game to start.</p>
          <div className="sv-team-pick-buttons" role="radiogroup" aria-label="Your team">
            {[0, 1].map((team) => (
              <button key={team} role="radio" aria-checked={player.team === team} className={`team-${team}`} onClick={() => socket.emit("survey:team", { code: game.code, playerId, team })}>
                {teamName(game, team)}
                <small>{membersOf(game, team).length} {membersOf(game, team).length === 1 ? "player" : "players"}</small>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className="player-clue-meta">Round {game.roundIndex + 1} of {game.roundCount}{MULTIPLIER_NAME[game.multiplier] ? ` · ${MULTIPLIER_NAME[game.multiplier]} points` : ""}</p>
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
      <span className="brand survey-brand">SURVEY SAYS!</span>
      <span className="code-chip">{game.code}</span>
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
      <p className="player-clue-meta">Round {game.roundIndex + 1} of {game.roundCount}{MULTIPLIER_NAME[game.multiplier] ? ` · ${MULTIPLIER_NAME[game.multiplier]} points` : ""} · bank {points(round.bank)}</p>
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
      {round.phase === "roundEnd" && <button className="wide on" onClick={() => onAction("nextRound")}>{last ? "See final scores" : "Next question"}</button>}
      <RoundControls game={game} onAction={onAction} />
      <section className="controller-players">
        <h2>Teams</h2>
        <TeamTools game={game} onAction={onAction} />
      </section>
    </main>
  );
}

// ---------- End of game ----------
export function SurveyEnd({ game, host, onAction }) {
  const [a, b] = game.teams, winner = a.score === b.score ? null : a.score > b.score ? 0 : 1;
  // A host who reloaded mid-game hasn't fetched the ProtoQA pack yet; get it in time for "Play again".
  useEffect(() => { if (host) loadProtoQA().catch(() => {}); }, [host]);
  const playAgain = () => {
    const surveys = pickSurveys(game.roundCount);
    rememberPlayed(surveys.map((s) => s.id));
    onAction("replay", { surveys });
  };
  return (
    <main className="end survey">
      <div className="brand survey-brand">SURVEY SAYS!</div>
      <h1>{winner == null ? "It’s a tie!" : `${teamName(game, winner)} win!`}</h1>
      <div className="sv-final-scores">
        {[0, 1].map((team) => (
          <section key={team} className={`sv-final-team team-${team}${winner === team ? " is-winner" : ""}`}>
            <h2>{teamName(game, team)}</h2>
            <strong className="money">{points(game.teams[team].score)}</strong>
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
