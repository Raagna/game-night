import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  fallbackQuestions,
  loadSeason,
  loadSeasonIndex,
  parseJeopardyJson,
  parseKaggleCsv,
  parseSeasonZip,
} from "./questions";
import "@fontsource/archivo-black/400.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "./styles.css";

const SERVER =
  import.meta.env.VITE_SERVER_URL ||
  `${location.protocol}//${location.hostname}:3001`;
const JOIN_URL = "raagna.github.io/jeopardy-party";
const socket = io(SERVER, { autoConnect: true });
const PLAYER_KEYS = ["playerId", "gameCode", "playerName"];
const clearPlayerSession = () => PLAYER_KEYS.forEach((key) => sessionStorage.removeItem(key));
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
let soundContext;
let dailyDoubleAudio, dailyDoubleStop;
function tone(frequency, duration = .16, type = "sine", volume = .12) { try { const Audio=window.AudioContext||window.webkitAudioContext; soundContext ||= new Audio(); if(soundContext.state === "suspended") soundContext.resume(); const osc=soundContext.createOscillator(), gain=soundContext.createGain(); osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(volume,soundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+duration);osc.connect(gain).connect(soundContext.destination);osc.start();osc.stop(soundContext.currentTime+duration) } catch {} }
function playDailyDouble() { try { dailyDoubleAudio ||= new Audio(`${import.meta.env.BASE_URL}audio/daily-double.mp3`); clearTimeout(dailyDoubleStop); dailyDoubleAudio.pause(); dailyDoubleAudio.currentTime=0; dailyDoubleAudio.play().catch(()=>{}); dailyDoubleStop=setTimeout(()=>{ dailyDoubleAudio.pause(); dailyDoubleAudio.currentTime=0 },4000) } catch {} }
function useClueMusic(active) { useEffect(()=>{ if(!active) return; let step=0; const notes=[262,330,392,330,294,349,440,349]; const play=()=>tone(notes[step++%notes.length],.3,"triangle",.035); play(); const id=setInterval(play,420); return()=>clearInterval(id) },[active]) }
const byCategory = (questions) =>
  Object.entries(
    questions
      .filter((q) => q.round !== "Final Jeopardy!")
      .reduce((a, q) => {
        const key = `${q.category}|${q.airDate || "undated"}|${q.round || "Jeopardy!"}`;
        (a[key] ||= []).push(q);
        return a;
      }, {}),
  )
    .filter(([, q]) => q.length >= 5)
    .sort((a, b) =>
      (b[1][0].airDate || "").localeCompare(a[1][0].airDate || ""),
    );
const categoryTitle = (entry) => entry[1][0].category;
const hasBoardValues = (questions, boardIndex) => {
  const step = boardIndex === 0 ? 200 : 400;
  const values = new Set(questions.map((q) => q.value));
  return [1, 2, 3, 4, 5].every((multiplier) => values.has(multiplier * step));
};
const makeCategory = ([, qs], boardIndex) => ({
  name: qs[0].category,
  airDate: qs[0].airDate,
  questions: [...qs]
    .sort((a, b) => (a.value || 0) - (b.value || 0))
    .slice(0, 5)
    .map((q, i) => ({ ...q, value: (i + 1) * (boardIndex === 0 ? 200 : 400) })),
});
const uid = () => Math.random().toString(36).slice(2);

function Setup({ onCreate }) {
  const [questions, setQuestions] = useState(fallbackQuestions),
    [search, setSearch] = useState(""),
    [board, setBoard] = useState(0),
    [picked, setPicked] = useState([[], []]),
    [final, setFinal] = useState(null),
    [hostless, setHostless] = useState(false),
    [notice, setNotice] = useState(""),
    [seasons, setSeasons] = useState([]),
    [source, setSource] = useState(""),
    [loading, setLoading] = useState(true),
    [visibleCount, setVisibleCount] = useState(60);
  const showSeason = async (season) => {
    setSource(String(season));
    setLoading(true);
    setNotice("");
    try {
      setQuestions(await loadSeason(Number(season)));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    loadSeasonIndex()
      .then((list) => { setSeasons(list); if (list.length) return showSeason(list[0].season); setLoading(false); })
      .catch((err) => { setLoading(false); setNotice(`${err.message} You can still import a file.`); });
  }, []);
  const allCategories = useMemo(() => byCategory(questions), [questions]);
  const categories = useMemo(
    () =>
      allCategories.filter(
        ([, qs]) =>
          qs[0].round === (board === 0 ? "Jeopardy!" : "Double Jeopardy!") &&
          hasBoardValues(qs, board) &&
          qs[0].category.includes(search.toUpperCase()),
      ),
    [allCategories, search, board],
  );
  const select = (entry) =>
    setPicked((p) =>
      p.map((b, i) =>
        i === board
          ? b.some((x) => x[0] === entry[0])
            ? b.filter((x) => x[0] !== entry[0])
            : b.length < 6 &&
                !b.some((x) => categoryTitle(x) === categoryTitle(entry))
              ? [...b, entry]
              : b
          : b,
      ),
    );
  const randomize = () =>
    setPicked((p) =>
      p.map((b, i) =>
        i === board
          ? (() => {
              const pool = categories
                .filter(
                  (e) => !b.some((x) => categoryTitle(x) === categoryTitle(e)),
                )
                .sort(() => Math.random() - 0.5);
              return [...b, ...pool.slice(0, 6 - b.length)];
            })()
          : b,
      ),
    );
  useEffect(() => setVisibleCount(60), [search, questions, board]);
  const start = () => {
    if (picked[0].length !== 6 || picked[1].length !== 6)
      return setNotice("Choose six categories for each board.");
    const finalPool = questions.filter((q) => q.round === "Final Jeopardy!");
    const finalQ =
      final ||
      finalPool[Math.floor(Math.random() * finalPool.length)] ||
      questions[Math.floor(Math.random() * questions.length)];
    onCreate({ boards: picked.map((b, boardIndex) => b.map((entry) => makeCategory(entry, boardIndex))), final: finalQ, hostless });
  };
  return (
    <main className="setup">
      <div className="brand">
        JEOPARDY! <span>local game night</span>
      </div>
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Build your game board</h1>
            <p className="muted">
              Every season of the show is built in. Pick six categories per round, or fill the rest randomly.
            </p>
          </div>
          <label className="upload">
            Import questions (JSON, CSV or season ZIP)
            <input
              type="file"
              accept=".json,.csv,.zip"
              onChange={async (e) => {
                try {
                  const file = e.target.files[0];
                  setNotice(`Loading ${file.name}…`);
                  const q = file.name.endsWith(".zip")
                    ? await parseSeasonZip(file)
                    : file.name.endsWith(".json")
                      ? parseJeopardyJson(await file.text())
                      : parseKaggleCsv(await file.text());
                  setQuestions(q);
                  setPicked([[], []]);
                  setFinal(null);
                  setSource("import");
                  setNotice(`${q.length.toLocaleString()} clues loaded from ${file.name}.`);
                } catch (err) {
                  setNotice(err.message);
                }
              }}
            />
          </label>
        </div>
        <div className="tabs">
          <button
            className={board === 0 ? "active" : ""}
            onClick={() => setBoard(0)}
          >
            Jeopardy · {picked[0].length}/6
          </button>
          <button
            className={board === 1 ? "active" : ""}
            onClick={() => setBoard(1)}
          >
            Double Jeopardy · {picked[1].length}/6
          </button>
          <button className="randomize" onClick={randomize}>
            Fill remaining randomly
          </button>
        </div>
        <label className="game-mode"><input type="checkbox" checked={hostless} onChange={(event) => setHostless(event.target.checked)} /> <span><b>Play without a host</b><small>Players select clues, buzz automatically, and type their own responses.</small></span></label>
        <div className="builder">
          <div>
            <div className="archive-controls">
              <input
                className="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories…"
              />
              <select
                aria-label="Question set"
                value={source}
                disabled={loading}
                onChange={(e) => showSeason(e.target.value)}
              >
                {source === "import" && <option value="import">Imported file</option>}
                {!seasons.length && source !== "import" && <option value="">Built-in questions</option>}
                {seasons.map((s) => (
                  <option key={s.season} value={s.season}>
                    Season {s.season} ({s.from.slice(0, 4)}–{s.to.slice(2, 4)})
                  </option>
                ))}
              </select>
            </div>
            <div
              className="category-list"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 30)
                  setVisibleCount((n) => Math.min(n + 60, categories.length));
              }}
            >
              {loading && <div className="load-more">Loading questions…</div>}
              {!loading && !categories.length && <div className="load-more">No categories match.</div>}
              {!loading && categories.slice(0, visibleCount).map((entry) => (
                <button
                  key={entry[0]}
                  className={
                    picked[board].some((x) => x[0] === entry[0]) ? "chosen" : ""
                  }
                  onClick={() => select(entry)}
                >
                  <span>{categoryTitle(entry)}</span>
                  <small>
                    {entry[1][0].airDate || "Undated"} ·{" "}
                    {entry[1][0].round || "Jeopardy!"}
                  </small>
                </button>
              ))}
              {!loading && visibleCount < categories.length && (
                <div className="load-more">Scroll for more categories…</div>
              )}
            </div>
          </div>
          <div className="selected">
            <h2>{board === 0 ? "Jeopardy round" : "Double Jeopardy round"}</h2>
            {picked[board].map((x) => (
              <div className="pill" key={x[0]}>
                <span>{categoryTitle(x)} <small>{x[1][0].airDate}</small></span>
                <button aria-label={`Remove ${categoryTitle(x)}`} onClick={() => select(x)}><CloseIcon /></button>
              </div>
            ))}
            {Array.from({ length: 6 - picked[board].length }).map((_, i) => (
              <div className="empty" key={i}>
                Choose a category
              </div>
            ))}
          </div>
        </div>
        <div className="final-row">
          <label className="field">
            <span>Final Jeopardy clue</span>
            <select
              value={final?.id || ""}
              onChange={(e) =>
                setFinal(questions.find((q) => q.id === e.target.value) || null)
              }
            >
              <option value="">Random Final Jeopardy clue</option>
              {questions
                .filter((q) => q.round === "Final Jeopardy!")
                .map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.airDate} · {q.category}: {q.question.slice(0, 52)}
                  </option>
                ))}
            </select>
          </label>
          <button className="primary" onClick={start}>
            Create lobby
          </button>
        </div>
        {notice && <p className="notice">{notice}</p>}
      </section>
    </main>
  );
}

function Scores({ players, turnPlayerId }) {
  if (!players.length) return null;
  return (
    <ul className="scores">
      {players.map((p) => (
        <li key={p.id} className={(p.id === turnPlayerId ? "is-turn " : "") + (p.connected ? "" : "is-away")}>
          <b>{p.name}</b>
          <span className="money">${p.score.toLocaleString()}</span>
          {!p.connected && <small>Reconnecting…</small>}
        </li>
      ))}
    </ul>
  );
}
function ClueTimer({ deadline, serverNow }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const startedAt=Date.now(), startRemaining=Math.max(0,deadline-serverNow);
    const update=()=>setRemaining(Math.max(0,startRemaining-(Date.now()-startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline,serverNow]);
  if (!deadline) return null;
  const seconds = Math.ceil(remaining / 1000);
  return <div className={"clue-timer" + (seconds <= 5 ? " is-low" : "")} role="timer" aria-label={`${seconds} seconds left`}>{seconds}</div>;
}
const formatBuzzTime = (milliseconds) => `${(Math.max(0, milliseconds || 0) / 1000).toFixed(3)}s`;
function Display({ game, host = false, onAction }) {
  const q = game.activeQuestion?.question;
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer);
  const chooser = game.players.find((p) => p.id === game.turnPlayerId);
  const boardDone = game.board?.every((c) => c.questions.every((q) => q.used));
  const dailyPending = game.activeQuestion?.dailyDouble && !game.activeQuestion.dailyReady;
  useClueMusic(Boolean(game.activeQuestion && game.buzzerOpen));
  useEffect(() => {
    if (game.lastEvent?.type === "reveal") tone(1047, .55, "sine", .16);
    if (game.lastEvent?.type === "daily") playDailyDouble();
  }, [game.lastEvent?.at]);
  return (
    <main className="display">
      <header className="display-bar">
        <div className="brand">JEOPARDY!</div>
        {game.status !== "lobby" && (
          <p className="join-hint">
            Join at <b>{JOIN_URL}</b> <span className="code-chip">{game.code}</span>
          </p>
        )}
        <ClueTimer deadline={game.activeQuestion ? game.answerDeadline || game.clueDeadline || game.preBuzzDeadline || game.finalDeadline : null} serverNow={game.serverNow} />
      </header>
      {game.status === "lobby" ? (
        <div className="lobby">
          <h1>Join the game</h1>
          <p className="lobby-url">Open <b>{JOIN_URL}</b> on your phone and enter</p>
          <div className="lobby-code">{game.code}</div>
          {game.players.length ? <Scores players={game.players} /> : <p className="muted">No players yet.</p>}
          {host && (
            <button className="primary" onClick={() => onAction("start")}>
              Start game
            </button>
          )}
        </div>
      ) : game.activeQuestion ? (
        <div className="clue-screen">
          <p className="clue-meta">
            {dailyPending ? "Daily Double" : <>{q.category} <span>{q.value ? `$${q.value.toLocaleString()}` : "Final Jeopardy"}</span></>}
          </p>
          <h1>{dailyPending ? "Wager required" : q.question}</h1>
          {game.reveal && <div className="answer">{q.answer}</div>}
          {buzzed && <div className="buzzed">{game.activeQuestion.dailyDouble ? `${buzzed.name} buzzed in` : `${buzzed.name} buzzed in at ${formatBuzzTime(game.buzzedAtMs)}`}</div>}
        </div>
      ) : game.status === "final" ? (
        <div className="clue-screen">
          <p className="clue-meta">Final Jeopardy</p>
          <h1>Ready for the final clue</h1>
        </div>
      ) : (
        <>
          <div className="round-title">
            {game.boardIndex === 0 ? "Jeopardy!" : "Double Jeopardy!"}
          </div>
          <div className="board">
            {game.board.map((c, ci) => (
              <div className="column" key={c.name}>
                <div className="cat">{c.name}</div>
                {c.questions.map((q, qi) => (
                  <button
                    disabled={q.used || !host || game.hostless}
                    onClick={() =>
                      onAction("select", {
                        categoryIndex: ci,
                        questionIndex: qi,
                      })
                    }
                    key={q.id}
                    className={q.used ? "used" : ""}
                    aria-label={q.used ? `${c.name} $${q.value}, already played` : `${c.name} for $${q.value}`}
                  >
                    ${q.value}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {chooser && <p className="turn-note">{chooser.name} picks the next clue</p>}
          {host && boardDone && (
            <div className="host-bottom">
              <button
                className="primary"
                onClick={() =>
                  onAction(game.boardIndex === 0 ? "nextBoard" : "final")
                }
              >
                {game.boardIndex === 0
                  ? "Start Double Jeopardy"
                  : "Final Jeopardy"}
              </button>
            </div>
          )}
        </>
      )}
      {game.status !== "lobby" && <Scores players={game.players} turnPlayerId={game.activeQuestion ? null : game.turnPlayerId} />}
      {host && game.hostless && game.players.length > 0 && <HostTools game={game} onAction={onAction} />}
    </main>
  );
}
function HostTools({ game, onAction }) {
  const [amount, setAmount] = useState("100");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <details className="host-tools">
      <summary>Host tools</summary>
      <label className="inline-field">Adjust scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            <button className="chip-btn add" aria-label={`Add $${step} to ${player.name}`} onClick={() => onAction("adjustScore", { playerId: player.id, amount: step })}>+${step}</button>
            <button className="chip-btn subtract" aria-label={`Subtract $${step} from ${player.name}`} onClick={() => onAction("adjustScore", { playerId: player.id, amount: -step })}>−${step}</button>
            <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Kick</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
function ControllerPlayerTools({ player, onAction }) {
  const [name, setName] = useState(player.name), [amount, setAmount] = useState("100");
  useEffect(() => setName(player.name), [player.name]);
  const scoreAmount = Math.max(1, Math.trunc(Number(amount) || 0));
  return <div className="controller-player-tools">
    <div className="player-line">
      <input aria-label={`${player.name} name`} value={name} maxLength="20" onChange={(event) => setName(event.target.value)} onBlur={() => name.trim() && name.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name })} />
      <span className="money">${player.score.toLocaleString()}</span>
    </div>
    <div className="score-adjustment">
      <input aria-label={`Amount to adjust ${player.name}'s score by`} type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <button className="chip-btn add" onClick={() => onAction("adjustScore", { playerId: player.id, amount: scoreAmount })}>+${scoreAmount}</button>
      <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { playerId: player.id, amount: -scoreAmount })}>−${scoreAmount}</button>
      <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Kick</button>
    </div>
  </div>;
}
function Controller({ game, onAction }) {
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer),
    finalMode = game.status === "final";
  const skip = () => onAction(game.boardIndex === 0 ? "nextBoard" : "final");
  return (
    <main className="controller">
      <header className="controller-bar">
        <span className="brand">JEOPARDY!</span>
        <span className="code-chip">{game.code}</span>
      </header>
      <h1>
        {finalMode
          ? "Final Jeopardy"
          : game.activeQuestion
            ? "Clue controls"
            : "Board controls"}
      </h1>
      {finalMode ? (
        <>
          <button className="wide" onClick={() => onAction("reveal")}>
            {game.reveal ? "Hide final answer" : "Reveal final answer"}
          </button>
          {game.players.map((p) => {
            const r = game.finalResponses.find((x) => x.playerId === p.id);
            return (
              <div className="judgement" key={p.id}>
                <h2>
                  {p.name} <small>{r ? "Submitted" : "Waiting"}</small>
                </h2>
                {r && (
                  <>
                    <p>
                      Wager: <b>${r.wager}</b>
                    </p>
                    <button
                      className="wide"
                      onClick={() =>
                        onAction("revealFinalPlayer", { playerId: p.id })
                      }
                    >
                      {r.revealed ? "Hide response" : "Reveal response"}
                    </button>
                    {r.revealed && (
                      <p className="final-response">{r.response}</p>
                    )}
                    <div className="verdict">
                      <button
                        onClick={() =>
                          onAction("score", { playerId: p.id, amount: r.wager })
                        }
                      >
                        Correct +${r.wager}
                      </button>
                      <button
                        onClick={() =>
                          onAction("score", {
                            playerId: p.id,
                            amount: -r.wager,
                          })
                        }
                      >
                        Incorrect −${r.wager}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <button className="close" onClick={() => onAction("close")}>
            Finish game
          </button>
        </>
      ) : game.activeQuestion ? (
        <>
          {game.activeQuestion.dailyDouble && <p className="status-note">Daily Double · {game.activeQuestion.dailyReady ? `wager $${game.activeQuestion.dailyWager}` : "waiting for the wager"}</p>}
          <div className="controller-answer">
            <span>Correct response</span>
            {game.activeQuestion.question.answer}
          </div>
          <button
            className={"wide " + (game.buzzerOpen ? "on" : "")}
            disabled={game.activeQuestion.dailyDouble && !game.activeQuestion.dailyReady}
            onClick={() => onAction("buzzer", { open: !game.buzzerOpen })}
          >
            {game.buzzerOpen ? "Buzzers open · tap to close" : game.activeQuestion.dailyDouble ? "Open Daily Double buzzer" : "Open buzzers"}
          </button>
          {buzzed && (
            <div className="judgement">
              <h2>{buzzed.name} buzzed in</h2>
              <div className="verdict">
                <button
                  onClick={() =>
                    onAction("score", {
                      playerId: buzzed.id,
                      amount: game.activeQuestion.question.value || 1000,
                    })
                  }
                >
                  Correct +${game.activeQuestion.question.value || 1000}
                </button>
                <button
                  onClick={() =>
                    onAction("score", {
                      playerId: buzzed.id,
                      amount: -(game.activeQuestion.question.value || 1000),
                    })
                  }
                >
                  Incorrect −${game.activeQuestion.question.value || 1000}
                </button>
              </div>
            </div>
          )}
          <button className="close" onClick={() => onAction("timeoutClue")}>
            Reveal answer and return to board
          </button>
        </>
      ) : (
        <p className="muted">
          Pick a clue on the shared display, then control it here.
        </p>
      )}
      {game.status === "playing" && (
        <button className="skip-controller" onClick={skip}>
          {game.boardIndex === 0
            ? "Skip to Double Jeopardy"
            : "Skip to Final Jeopardy"}
        </button>
      )}
      <section className="controller-players">
        <h2>Players</h2>
        <p className="muted">Rename, adjust a score, or remove a player.</p>
        {game.players.map((player) => <ControllerPlayerTools key={player.id} player={player} onAction={onAction} />)}
      </section>
    </main>
  );
}
function FinalPlayer({ game, playerId, p }) {
  const [wager, setWager] = useState("0"),
    [response, setResponse] = useState(""),
    [error, setError] = useState("");
  const submitted = game.finalResponses.find((x) => x.playerId === playerId);
  if (p.score < 1)
    return <p className="status-card">You need a positive score to play Final Jeopardy.</p>;
  if (submitted && game.hostless && game.reveal)
    return <div className="status-card"><p>The answer was <b>{game.activeQuestion?.question?.answer}</b></p><p className={submitted.correct ? "final-correct" : "final-incorrect"}>{submitted.correct ? `Correct! +$${submitted.wager}` : `Incorrect. −$${submitted.wager}`}</p></div>;
  if (submitted)
    return (
      <p className="status-card">
        Response locked in · wager ${submitted.wager}
      </p>
    );
  const submit = () =>
    socket.emit(
      "player:finalSubmit",
      { code: game.code, playerId, wager, response },
      (r) => !r.ok && setError(r.error),
    );
  return (
    <div className="final-form">
      <label className="field">
        <span>Wager ($0 to ${Math.max(0, p.score).toLocaleString()})</span>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          max={Math.max(0, p.score)}
          value={wager}
          onChange={(e) => setWager(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Your response</span>
        <textarea
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder="Type your response"
        />
      </label>
      <button className="primary" onClick={submit}>
        Lock in response
      </button>
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
function DailyWager({ game, playerId, player }) {
  const [wager,setWager]=useState("5"); const max=Math.max(player.score,game.boardIndex===0?1000:2000,5)
  if(game.activeQuestion.dailyReady) return <><p className="status-card">Wager locked: ${game.activeQuestion.dailyWager.toLocaleString()}</p><p className="player-status">{game.buzzedPlayer ? "You buzzed in." : game.buzzerOpen ? "Buzz in!" : game.hostless ? "Your buzzer opens in 10 seconds." : "Waiting for the host to open your buzzer."}</p><button className={"buzzer " + (game.buzzerOpen ? "ready" : "")} disabled={!!game.buzzedPlayer || !game.buzzerOpen} onClick={()=>socket.emit("player:buzz",{code:game.code,playerId})}>BUZZ!</button></>
  return <div className="final-form"><p className="daily-title">Daily Double!</p><label className="field"><span>Wager ($5 to ${max.toLocaleString()})</span><input type="number" inputMode="numeric" min="5" max={max} value={wager} onChange={e=>setWager(e.target.value)}/></label><button className="primary" onClick={()=>socket.emit("player:dailyWager",{code:game.code,playerId,wager})}>Lock wager</button></div>
}
function HostlessBoard({ game, playerId }) {
  const chooser=game.players.find((player)=>player.id===game.turnPlayerId), canSelect=chooser?.id===playerId;
  return <div className="hostless-board"><p className={"player-status" + (canSelect ? " is-you" : "")}>{canSelect ? "Your turn — pick a clue" : `${chooser?.name || "Another player"} is picking a clue`}</p><div className="board">{game.board.map((category,categoryIndex)=><div className="column" key={category.name}><div className="cat">{category.name}</div>{category.questions.map((question,questionIndex)=><button key={question.id} disabled={question.used || !canSelect} className={question.used ? "used" : ""} aria-label={question.used ? `${category.name} $${question.value}, already played` : `${category.name} for $${question.value}`} onClick={()=>socket.emit("player:select",{code:game.code,playerId,categoryIndex,questionIndex})}>${question.value}</button>)}</div>)}</div></div>
}
function HostlessAnswer({ game, playerId }) {
  const [response,setResponse]=useState("");
  const send=()=>socket.emit("player:answer",{code:game.code,playerId,response});
  return <div className="final-form"><label className="field"><span>You buzzed in — type your response</span><input autoFocus autoComplete="off" autoCapitalize="off" enterKeyHint="send" value={response} onChange={(event)=>setResponse(event.target.value)} placeholder="Your response" onKeyDown={(event)=>event.key==='Enter'&&send()}/></label><button className="primary" onClick={send}>Submit response</button></div>
}
function Player({ game, playerId }) {
  const p = game.players.find((p) => p.id === playerId);
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer),
    hasTurn = game.answeringPlayerId === playerId,
    chooser = game.players.find((p) => p.id === game.turnPlayerId),
    lockedOut = game.incorrectPlayerIds?.includes(playerId);
  const signal = game.lastEvent?.playerId === playerId ? game.lastEvent.type : "";
  const personalBuzzTime = game.buzzTimes?.[playerId];
  const canRecordBuzz = !game.activeQuestion?.dailyDouble && game.buzzInputDeadline > game.serverNow && personalBuzzTime == null && !lockedOut;
  const [showPersonalBuzzTime, setShowPersonalBuzzTime] = useState(false);
  useClueMusic(game.buzzerOpen || game.status === "final");
  useEffect(() => {
    if (personalBuzzTime == null) { setShowPersonalBuzzTime(false); return; }
    setShowPersonalBuzzTime(true);
    const timeout = setTimeout(() => setShowPersonalBuzzTime(false), 5000);
    return () => clearTimeout(timeout);
  }, [personalBuzzTime]);
  useEffect(() => { if(signal === "correct") tone(880,.28); if(signal === "incorrect") tone(150,.35); if(signal === "daily") playDailyDouble(); if(game.lastEvent?.type === "reveal") tone(1047,.55,"sine",.16); }, [game.lastEvent?.at]);
  if (!p) return <main className="player"><p className="status-card">You’re no longer in this game.</p></main>;
  const clue = game.activeQuestion && !game.activeQuestion.final ? game.activeQuestion.question : null;
  return (
    <main className={`player ${signal === "correct" ? "signal-correct" : signal === "incorrect" ? "signal-incorrect" : ""}`}>
      <header className="player-bar">
        <span className="brand">JEOPARDY!</span>
        <span className="player-name">{p.name}</span>
      </header>
      <div className="player-score money">${p.score.toLocaleString()}</div>
      {clue && !game.activeQuestion.dailyDouble && <p className="player-clue-meta">{clue.category} · ${clue.value?.toLocaleString()}</p>}
      {game.status === "lobby" ? (
        <p className="player-status">{game.hostless ? "Waiting for the game to start…" : "Waiting for the host to start…"}</p>
      ) : game.status === "final" ? (
        <FinalPlayer game={game} playerId={playerId} p={p} />
      ) : !game.activeQuestion && game.hostless ? <HostlessBoard game={game} playerId={playerId} /> : !game.activeQuestion ? (
        <p className="player-status">
          {chooser ? (chooser.id === playerId ? "Your turn to pick a clue" : `${chooser.name} is picking a clue`) : "Waiting for the first turn…"}
        </p>
      ) : game.hostless && hasTurn ? <HostlessAnswer game={game} playerId={playerId} /> : game.activeQuestion?.dailyDouble ? (
        game.activeQuestion.dailyPlayerId===playerId ? <DailyWager game={game} playerId={playerId} player={p}/> : <p className="player-status">A Daily Double is in play.</p>
      ) : (
        <>
          <p className="player-status">
            {game.reveal
              ? "Answer revealed"
              : showPersonalBuzzTime
              ? `You buzzed in at ${formatBuzzTime(personalBuzzTime)}`
              : lockedOut
              ? "Incorrect — wait for the next clue"
              : buzzed
                  ? buzzed.id === playerId
                    ? "Waiting for the host to judge"
                    : `${buzzed.name} buzzed in at ${formatBuzzTime(game.buzzedAtMs)}`
                  : game.buzzerOpen
                    ? "Buzz in!"
                    : game.hostless
                      ? "Buzzers open in 10 seconds"
                      : "Wait for the host to open buzzers"}
          </p>
          <button
            className={"buzzer " + (game.buzzerOpen ? "ready" : "")}
            disabled={lockedOut || (!game.buzzerOpen && !canRecordBuzz)}
            onClick={() => { tone(420,.1,"square"); socket.emit("player:buzz", { code: game.code, playerId }); }}
          >
            BUZZ!
          </button>
        </>
      )}
      {game.status === "playing" && <SkipVote game={game} playerId={playerId} />}
    </main>
  );
}
function SkipVote({ game, playerId }) {
  const active = game.activeQuestion;
  if (!game.hostless || !active || active.final || active.dailyDouble || game.reveal) return null;
  const votes = game.skipVotes || [];
  const needed = game.players.filter((player) => player.connected && !game.incorrectPlayerIds?.includes(player.id));
  const voted = votes.includes(playerId);
  const count = needed.filter((player) => votes.includes(player.id)).length;
  return (
    <div className="skip-vote">
      <button className={"skip-button" + (voted ? " voted" : "")} aria-pressed={voted} onClick={() => socket.emit("player:skip", { code: game.code, playerId })}>
        {voted ? "Undo skip" : "Skip clue"}
      </button>
      <small>{count} of {needed.length} want to skip{voted && count < needed.length ? " · waiting for everyone" : ""}</small>
    </div>
  );
}
function Join({ onJoined, initialError }) {
  const [code, setCode] = useState(""),
    [name, setName] = useState(sessionStorage.playerName || ""),
    [error, setError] = useState(initialError || ""),
    [busy, setBusy] = useState(false);
  const join = (event) => {
    event.preventDefault();
    tone(1,.01,"sine",.001); setBusy(true); setError("");
    socket.timeout(8000).emit("player:join", { code: code.trim(), name, returningPlayerId: sessionStorage.playerId }, (err, r) => {
      setBusy(false);
      if (err) return setError("Couldn’t reach the game server. Check your connection and try again.");
      r.ok ? onJoined(r.game, r.playerId) : setError(r.error);
    });
  };
  return (
    <main className="join">
      <div className="brand">JEOPARDY!</div>
      <h1>Join a game</h1>
      <form onSubmit={join}>
        <label className="field">
          <span>Game code</span>
          <input
            className="code-input"
            value={code}
            maxLength="6"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength="20"
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Joining…" : "Join game"}
        </button>
      </form>
      {error && <p className="notice" role="alert">{error}</p>}
      <p className="muted">Up to 6 players can join, even after the game starts.</p>
      <a href="?host">Hosting a game?</a>
    </main>
  );
}
function EndGame({ game, host }) {
  const ranked=[...game.players].sort((a,b)=>b.score-a.score), top=ranked.slice(0,3), rest=ranked.slice(3);
  return (
    <main className="end">
      <div className="brand">JEOPARDY!</div>
      <h1>Final standings</h1>
      <div className="podium">{top.map((p,i)=><div className={`place place-${i+1}`} key={p.id}><span className="rank">{i+1}</span><b>{p.name}</b><strong className="money">${p.score.toLocaleString()}</strong></div>)}</div>
      {rest.length>0&&<ol className="remaining-players" start="4">{rest.map((p)=><li key={p.id}><span>{p.name}</span><b className="money">${p.score.toLocaleString()}</b></li>)}</ol>}
      {host ? (
        <button className="primary" onClick={() => { sessionStorage.removeItem("displayCode"); location.assign("?host"); }}>
          New game
        </button>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={()=>{clearPlayerSession();location.assign("./")}}>Join another game</button></div>
      )}
    </main>
  );
}
function App() {
  const params = new URLSearchParams(location.search),
    host = params.has("host"),
    controller = params.has("controller");
  const [game, setGame] = useState(null),
    [playerId, setPlayerId] = useState(sessionStorage.playerId),
    [connected, setConnected] = useState(socket.connected),
    [joinError, setJoinError] = useState(""),
    [restoring, setRestoring] = useState(() =>
      host ? Boolean(sessionStorage.displayCode) : controller ? true : Boolean(sessionStorage.playerId && sessionStorage.gameCode));
  const gameCode = useRef(null);
  gameCode.current = game?.code;
  useEffect(() => {
    // Re-attach this device to its game whenever the connection is (re)established or the page wakes up.
    // Phones drop the socket when locked or backgrounded; without this they stop receiving updates.
    const resync = () => {
      if (host || controller) {
        let code = gameCode.current || (host ? sessionStorage.displayCode : sessionStorage.hostCode);
        if (!code && controller) {
          code = prompt("Enter the game code")?.trim().toUpperCase();
          if (code) sessionStorage.hostCode = code;
        }
        if (!code) return setRestoring(false);
        socket.timeout(5000).emit("host:join", { code, display: host }, (err, r) => {
          if (err) return socket.disconnect().connect();
          if (r.ok) setGame(r.game);
          else if (host) { sessionStorage.removeItem("displayCode"); setGame(null); }
          setRestoring(false);
        });
        return;
      }
      const id = sessionStorage.playerId, code = sessionStorage.gameCode;
      if (!id || !code) return setRestoring(false);
      socket.timeout(5000).emit("player:join", { code, returningPlayerId: id }, (err, r) => {
        if (err) return socket.disconnect().connect();
        if (r.ok && r.rejoined) { setPlayerId(r.playerId); setGame(r.game); }
        else {
          clearPlayerSession(); setPlayerId(undefined); setGame(null);
          setJoinError("That game has ended or the server restarted. Enter the code to join again.");
        }
        setRestoring(false);
      });
    };
    const onConnect = () => { setConnected(true); resync(); };
    const onDisconnect = () => setConnected(false);
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      if (!socket.connected) socket.connect(); else resync();
    };
    const kicked = () => { clearPlayerSession(); location.assign("./"); };
    socket.on("game:update", setGame);
    socket.on("player:kicked", kicked);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("online", wake);
    document.addEventListener("resume", wake);
    if (socket.connected) onConnect();
    return () => {
      socket.off("game:update", setGame); socket.off("player:kicked", kicked);
      socket.off("connect", onConnect); socket.off("disconnect", onDisconnect);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("resume", wake);
    };
  }, []);
  const action = (action, payload = {}) =>
    socket.emit("host:action", { code: game.code, action, payload });
  const banner = game && !connected && <div className="connection-banner" role="status">Reconnecting…</div>;
  if (!game) {
    if (restoring || controller)
      return <main className="join"><div className="brand">JEOPARDY!</div>{controller && !restoring ? <button className="primary" onClick={() => location.reload()}>Enter game code</button> : <p className="player-status">Reconnecting to your game…</p>}</main>;
    if (host)
      return (
        <Setup
          onCreate={(config) =>
            socket.emit("host:create", config, (r) => {
              sessionStorage.displayCode = r.code;
              setGame(r.game);
              history.replaceState({}, "", "?host");
            })
          }
        />
      );
    return (
      <Join
        initialError={joinError}
        onJoined={(g, p) => {
          sessionStorage.playerId = p;
          sessionStorage.gameCode = g.code;
          sessionStorage.playerName = g.players.find((player) => player.id === p)?.name || "";
          setPlayerId(p);
          setGame(g);
        }}
      />
    );
  }
  if (game.status === "complete")
    return <>{banner}<EndGame game={game} host={host || controller} /></>;
  if (controller) return <>{banner}<Controller game={game} onAction={action} /></>;
  if (host)
    return (
      <>
        {banner}
        <Display game={game} host onAction={action} />
        {!game.hostless && <a
          className="controller-link"
          href="?controller"
          onClick={(event) => {
            event.preventDefault();
            sessionStorage.hostCode = game.code;
            window.open("?controller", "_blank");
          }}
        >
          Open host controller
        </a>}
      </>
    );
  return <>{banner}<Player game={game} playerId={playerId} /></>;
}
createRoot(document.getElementById("root")).render(<App />);
