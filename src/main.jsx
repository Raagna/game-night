import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SERVER, JOIN_URL, socket, CloseIcon, tone, useClueMusic, ClueTimer, ConfirmSubmit } from "./shared";
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
import "@fontsource/doto/800.css";
import "./styles.css";
import topicList from "./topics.json";
import BoardEditor from "./BoardEditor";
import MyBoards from "./MyBoards";
import { FastMoneyController, FastMoneyDisplay, FastMoneyPlayer } from "./FastMoney";
import { boardToConfig, deleteBoard, fastMoneyFromBoard, hasFinal, loadBoards, newBoard, pickFastMoneyClues, saveBoard } from "./boards";
import Hub, { BackToHub } from "./Hub";
import { LobbyJoin, JoinCorner } from "./JoinQR";
import { SurveySetup, SurveyDisplay, SurveyPlayer, SurveyController, SurveyEnd } from "./survey/SurveySays";
import { WheelSetup, WheelDisplay, WheelPlayer, WheelController, WheelEnd } from "./wheel/SpinSolve";
import { FibSetup, FibDisplay, FibPlayer, FibController, FibEnd } from "./fib/FibOrFact";
import { PriceSetup, PriceDisplay, PricePlayer, PriceController, PriceEnd } from "./price/PriceCheck";

const PLAYER_KEYS = ["playerId", "gameCode", "playerName"];
const clearPlayerSession = () => PLAYER_KEYS.forEach((key) => sessionStorage.removeItem(key));
let dailyDoubleAudio, dailyDoubleStop;
function playDailyDouble() { try { dailyDoubleAudio ||= new Audio(`${import.meta.env.BASE_URL}audio/daily-double.mp3`); clearTimeout(dailyDoubleStop); dailyDoubleAudio.pause(); dailyDoubleAudio.currentTime=0; dailyDoubleAudio.play().catch(()=>{}); dailyDoubleStop=setTimeout(()=>{ dailyDoubleAudio.pause(); dailyDoubleAudio.currentTime=0 },4000) } catch {} }
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
const TOPICS = topicList.map(({ id, label, aliases }) => ({ id, label, names: [label.toLowerCase(), ...aliases] }));
const TOPIC_LABEL = Object.fromEntries(TOPICS.map((topic) => [topic.id, topic.label]));
// Topics a search refers to: "sport" or "sports" means the Sports topic, "movie" means Movies & TV, and so on.
const topicsForQuery = (query) =>
  query.length < 3 ? [] : TOPICS.filter((topic) => topic.names.some((name) => name.startsWith(query))).map((topic) => topic.id);

function Setup({ onCreate }) {
  const [mode, setMode] = useState("archive"),
    [boards, setBoards] = useState(loadBoards),
    [selectedId, setSelectedId] = useState(null),
    [editing, setEditing] = useState(null),
    [storageOk, setStorageOk] = useState(true),
    [includeFinal, setIncludeFinal] = useState(true),
    [fastMoney, setFastMoney] = useState(false),
    [status, setStatus] = useState("");
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
    [topic, setTopic] = useState(null),
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
  const hasTopics = useMemo(() => questions.some((q) => q.topics?.length), [questions]);
  const query = search.trim().toLowerCase();
  const queryTopics = useMemo(() => topicsForQuery(query), [query]);
  const categories = useMemo(() => {
    const nameMatches = [], topicMatches = [];
    for (const entry of allCategories) {
      const first = entry[1][0];
      if (first.round !== (board === 0 ? "Jeopardy!" : "Double Jeopardy!") || !hasBoardValues(entry[1], board)) continue;
      if (topic && !first.topics?.includes(topic)) continue;
      if (!query || first.category.toLowerCase().includes(query)) nameMatches.push(entry);
      else if (first.topics?.some((id) => queryTopics.includes(id))) topicMatches.push(entry);
    }
    return [...nameMatches, ...topicMatches];
  }, [allCategories, board, topic, query, queryTopics]);
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
  useEffect(() => setVisibleCount(60), [search, questions, board, topic]);
  const chosenBoard = boards.find((b) => b.id === selectedId);
  const randomArchiveFinal = () => {
    const pool = questions.filter((q) => q.round === "Final Jeopardy!");
    return pool[Math.floor(Math.random() * pool.length)] || null;
  };
  const start = () => {
    setNotice("");
    let config;
    if (mode === "archive") {
      if (picked[0].length !== 6 || picked[1].length !== 6) return setNotice("Choose six categories for each round.");
      config = { boards: picked.map((b, boardIndex) => b.map((entry) => makeCategory(entry, boardIndex))), roundNames: ["Jeopardy!", "Double Jeopardy!"] };
    } else {
      if (!chosenBoard) return setNotice("Pick one of your boards, or make a new one.");
      config = boardToConfig(chosenBoard);
    }
    let finalClue = null;
    if (includeFinal) {
      finalClue = mode === "archive" ? final || randomArchiveFinal() : hasFinal(chosenBoard) ? chosenBoard.final : randomArchiveFinal();
      if (!finalClue) return setNotice("There’s no Final Jeopardy clue to use. Add one to the board, or turn Final Jeopardy off.");
    }
    let fastMoneyConfig = null;
    if (fastMoney) {
      const own = mode === "custom" ? fastMoneyFromBoard(chosenBoard) : [];
      const clues = [...own, ...pickFastMoneyClues(questions)].slice(0, 5);
      if (!clues.length) return setNotice("Fast Money needs clues. Add some to the board, or wait for the archive to load.");
      fastMoneyConfig = { clues };
    }
    onCreate({ ...config, final: finalClue, fastMoney: fastMoneyConfig, hostless }, setNotice);
  };
  const saveEdited = (board) => {
    const result = saveBoard(boards, board);
    setBoards(result.boards); setStorageOk(result.stored); setSelectedId(board.id); setEditing(null); setMode("custom"); setNotice("");
    setStatus(result.stored ? `Saved “${board.title}”.` : `“${board.title}” is ready for this session, but this browser won’t keep it. Export it to save a copy.`);
  };
  const removeBoard = (id) => {
    const result = deleteBoard(boards, id);
    setBoards(result.boards); setStorageOk(result.stored); if (selectedId === id) setSelectedId(null); setStatus("Board deleted.");
  };
  if (editing)
    return (
      <main className="setup">
        <BackToHub />
        <div className="brand">JEOPARDY!</div>
        <section className="setup-card">
          <BoardEditor initial={editing.board} notes={editing.notes} onSave={saveEdited} onCancel={() => setEditing(null)} />
        </section>
      </main>
    );
  return (
    <main className="setup">
      <BackToHub />
      <div className="brand">
        JEOPARDY!
      </div>
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Build your game board</h1>
            <p className="muted">
              {mode === "archive"
                ? "Every season of the show is built in. Pick six categories per round, or fill the rest randomly."
                : "Play a board you made yourself or imported. Boards are saved in this browser."}
            </p>
          </div>
          {mode === "archive" && <label className="upload">
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
          </label>}
        </div>
        <div className="mode-switch" role="tablist" aria-label="Where the clues come from">
          <button role="tab" aria-selected={mode === "archive"} onClick={() => { setMode("archive"); setStatus(""); }}>Archive categories</button>
          <button role="tab" aria-selected={mode === "custom"} onClick={() => { setMode("custom"); setStatus(""); }}>
            My boards{boards.length ? ` (${boards.length})` : ""}
          </button>
        </div>
        {mode === "custom" ? (
          <MyBoards
            boards={boards}
            selectedId={selectedId}
            storageOk={storageOk}
            onSelect={setSelectedId}
            onNew={() => setEditing({ board: newBoard(), notes: "" })}
            onEdit={(board) => setEditing({ board, notes: "" })}
            onDelete={removeBoard}
            onImported={(board, notes) => setEditing({ board, notes })}
          />
        ) : <>
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
        <div className="builder">
          <div>
            <div className="archive-controls">
              <input
                className="search"
                type="search"
                aria-label="Search categories or topics"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories or topics, e.g. sports"
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
            {hasTopics && (
              <div className="topic-chips" role="group" aria-label="Filter by topic">
                <button aria-pressed={topic === null} onClick={() => setTopic(null)}>All topics</button>
                {TOPICS.map((t) => (
                  <button key={t.id} aria-pressed={topic === t.id} onClick={() => setTopic(topic === t.id ? null : t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {query && queryTopics.length > 0 && (
              <p className="search-hint">
                Showing names with “{search.trim()}” plus categories about {queryTopics.map((id) => TOPIC_LABEL[id]).join(", ")}
              </p>
            )}
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
                    {entry[1][0].airDate || "Undated"}
                    {entry[1][0].topics?.length ? ` · ${entry[1][0].topics.slice(0, 2).map((id) => TOPIC_LABEL[id]).join(", ")}` : ""}
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
        </>}
        <section className="game-options" aria-labelledby="game-options-title">
          <h2 id="game-options-title">Game options</h2>
          <label className="game-mode"><input type="checkbox" checked={hostless} onChange={(event) => setHostless(event.target.checked)} /> <span><b>Play without a host</b><small>Players select clues, buzz automatically, and type their own responses.</small></span></label>
          <label className="game-mode"><input type="checkbox" checked={includeFinal} onChange={(event) => setIncludeFinal(event.target.checked)} /> <span><b>Final Jeopardy</b><small>
            {mode === "archive" ? "One last wagered clue after the final round." : chosenBoard && !hasFinal(chosenBoard) ? "This board has no Final clue, so a random archive one is used." : "Uses the board’s own Final Jeopardy clue."}
          </small></span></label>
          {includeFinal && mode === "archive" && (
            <label className="field option-field">
              <span>Final Jeopardy clue</span>
              <select value={final?.id || ""} onChange={(e) => setFinal(questions.find((q) => q.id === e.target.value) || null)}>
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
          )}
          <label className="game-mode"><input type="checkbox" checked={fastMoney} onChange={(event) => setFastMoney(event.target.checked)} /> <span><b>Fast Money finale</b><small>The top two players race the clock through the same five quick clues: $1,000 per right answer, and a $5,000 bonus each if they get 8 of 10 between them.</small></span></label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">
            {mode === "custom" ? (chosenBoard ? `Playing “${chosenBoard.title || "Untitled board"}”` : "No board chosen yet") : `${picked[0].length + picked[1].length} of 12 categories chosen`}
          </p>
          <button className="primary" onClick={start}>
            Create lobby
          </button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
        {status && !notice && <p className="status-line" role="status">{status}</p>}
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
// What comes after the current board: the next round, Final Jeopardy, Fast Money, or nothing (the game ends).
const nextStage = (game) =>
  game.boardIndex < (game.boardCount || 2) - 1 ? game.roundNames?.[game.boardIndex + 1] || "the next round"
    : game.final ? "Final Jeopardy" : game.hasFastMoney ? "Fast Money" : null;
const formatBuzzTime = (milliseconds) => `${(Math.max(0, milliseconds || 0) / 1000).toFixed(3)}s`;
function Display({ game, host = false, onAction }) {
  const q = game.activeQuestion?.question;
  const buzzed = game.players.find((p) => p.id === game.buzzedPlayer);
  const chooser = game.players.find((p) => p.id === game.turnPlayerId);
  const boardDone = game.board?.every((c) => c.questions.every((q) => q.used));
  const dailyPending = game.activeQuestion?.dailyDouble && !game.activeQuestion.dailyReady;
  useClueMusic(Boolean((game.activeQuestion && game.buzzerOpen) || game.fastMoney?.phase === "playing"));
  const next = nextStage(game);
  useEffect(() => {
    if (game.lastEvent?.type === "reveal") tone(1047, .55, "sine", .16);
    if (game.lastEvent?.type === "daily") playDailyDouble();
  }, [game.lastEvent?.at]);
  return (
    <main className="display">
      <header className="display-bar">
        <div className="brand">JEOPARDY!</div>
        {game.status !== "lobby" && <JoinCorner code={game.code} />}
        <ClueTimer deadline={game.status === "fastmoney" ? game.fastMoney?.deadline : game.activeQuestion ? game.answerDeadline || game.clueDeadline || game.preBuzzDeadline || game.finalDeadline : null} serverNow={game.serverNow} frozenMs={game.clockPaused ? game.pausedRemaining : null} />
      </header>
      {game.status === "lobby" ? (
        <div className="lobby">
          <h1>Join the game</h1>
          <LobbyJoin code={game.code} />
          {game.players.length ? <Scores players={game.players} /> : <p className="muted">No players yet.</p>}
          {host && (
            <button className="primary" onClick={() => onAction("start")}>
              Start game
            </button>
          )}
        </div>
      ) : game.status === "fastmoney" ? (
        <FastMoneyDisplay game={game} host={host} onAction={onAction} />
      ) : game.activeQuestion ? (
        <div className="clue-screen">
          <p className="clue-meta">
            {dailyPending ? "Daily Double" : <>{q.category} <span>{q.value ? `$${q.value.toLocaleString()}` : "Final Jeopardy"}</span></>}
          </p>
          <h1>{dailyPending ? "Wager required" : q.question}</h1>
          {game.status === "final" && !game.hostless && <FinalReveals game={game} />}
          {game.reveal && <div className="answer">{q.answer}</div>}
          {game.clockPaused && <p className="paused-note">Clock paused while {game.status === "final" ? "a player confirms" : `${buzzed?.name || "the player"} confirms`} their answer</p>}
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
            {game.roundNames?.[game.boardIndex] || (game.boardIndex === 0 ? "Jeopardy!" : "Double Jeopardy!")}
          </div>
          <div className="board" style={{ "--cols": game.board.length, "--cols-small": Math.min(3, game.board.length) }}>
            {game.board.map((c, ci) => (
              <div className="column" key={ci}>
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
              <button className="primary" onClick={() => onAction("nextBoard")}>
                {next ? `Start ${next}` : "Finish game"}
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
// Final Jeopardy with a host: each response appears on the main screen as the host reveals it.
function FinalReveals({ game }) {
  const shown = game.finalResponses.filter((r) => r.revealed);
  if (!game.finalTimeUp) return null;
  if (!shown.length) return <p className="final-reveal-note">{game.finalResponses.length ? "Time’s up! Let’s see the responses…" : "Time’s up!"}</p>;
  return (
    <ul className="final-reveals" aria-live="polite">
      {shown.map((r) => (
        <li key={r.playerId}>
          <span className="final-reveal-name">{game.players.find((p) => p.id === r.playerId)?.name || "Player"}</span>
          <span className="final-reveal-response">{r.response}</span>
          <span className="final-reveal-wager">Wager ${r.wager.toLocaleString()}</span>
        </li>
      ))}
    </ul>
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
    finalMode = game.status === "final", next = nextStage(game);
  if (game.status === "fastmoney")
    return (
      <main className="controller">
        <header className="controller-bar">
          <span className="brand">JEOPARDY!</span>
          <span className="code-chip">{game.code}</span>
        </header>
        <FastMoneyController game={game} onAction={onAction} />
      </main>
    );
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
          <FinalControls game={game} onAction={onAction} />
          <button className="close" onClick={() => onAction("close")}>
            {game.hasFastMoney ? "Go to Fast Money" : "Finish game"}
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
          <SkipTally game={game} />
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
        <button className="skip-controller" onClick={() => onAction("nextBoard")}>
          {next ? `Skip to ${next}` : "End the game now"}
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
// Host's Final Jeopardy controls: while the clock runs, players write. Once time is up the host reveals
// every response (each one appears on the main screen) and only then can reveal the correct answer.
function FinalControls({ game, onAction }) {
  const responses = game.finalResponses, revealedCount = responses.filter((r) => r.revealed).length;
  const allRevealed = revealedCount === responses.length, timeUp = game.finalTimeUp;
  return (
    <>
      {!timeUp ? (
        <>
          <p className="status-note">Players are writing their responses · {responses.length} locked in</p>
          <button className="wide" onClick={() => onAction("finalStop")}>Stop the clock now</button>
        </>
      ) : (
        <p className="status-note">
          {game.reveal ? "Correct answer is on the main screen." : allRevealed ? "Every response is revealed. Reveal the correct answer when you’re ready." : `Time’s up. Reveal each player’s response first (${revealedCount} of ${responses.length} shown).`}
        </p>
      )}
      <button className={"wide" + (game.reveal ? " on" : "")} disabled={!game.reveal && !(timeUp && allRevealed)} onClick={() => onAction("reveal")}>
        {game.reveal ? "Hide final answer" : "Reveal final answer"}
      </button>
      <div className="controller-answer">
        <span>Correct response</span>
        {game.activeQuestion?.question?.answer}
      </div>
      {game.players.map((p) => {
        const r = responses.find((x) => x.playerId === p.id);
        return (
          <div className="judgement" key={p.id}>
            <h2>
              {p.name} <small>{r ? (r.revealed ? "Shown on screen" : "Submitted") : timeUp ? "No response" : "Waiting"}</small>
            </h2>
            {r && (
              <>
                <p>Wager: <b>${r.wager}</b></p>
                <button className="wide" disabled={!timeUp || (r.revealed && game.reveal)} onClick={() => onAction("revealFinalPlayer", { playerId: p.id })}>
                  {r.revealed ? "Hide response" : "Reveal response on screen"}
                </button>
                {r.revealed && <p className="final-response">{r.response}</p>}
                <div className="verdict">
                  <button onClick={() => onAction("score", { playerId: p.id, amount: r.wager })}>Correct +${r.wager}</button>
                  <button onClick={() => onAction("score", { playerId: p.id, amount: -r.wager })}>Incorrect −${r.wager}</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}
function FinalPlayer({ game, playerId, p }) {
  const [wager, setWager] = useState("0"),
    [response, setResponse] = useState(""),
    [error, setError] = useState(""),
    [confirming, setConfirming] = useState(false);
  const submitted = game.finalResponses.find((x) => x.playerId === playerId);
  if (p.score < 1)
    return <p className="status-card">You need a positive score to play Final Jeopardy.</p>;
  if (submitted && game.hostless && game.reveal)
    return <div className="status-card"><p>The answer was <b>{game.activeQuestion?.question?.answer}</b></p><p className={submitted.correct ? "final-correct" : "final-incorrect"}>{submitted.correct ? `Correct! +$${submitted.wager}` : `Incorrect. −$${submitted.wager}`}</p></div>;
  if (submitted)
    return (
      <p className="status-card">
        Response locked in · wager ${submitted.wager}
        {!game.hostless && game.finalTimeUp && <><br />{submitted.revealed ? "Your response is on the main screen." : "Waiting for the host to reveal responses."}</>}
      </p>
    );
  if (game.finalTimeUp || game.reveal)
    return <p className="status-card">Time’s up! No response was locked in.</p>;
  const hold = (on) => socket.emit("player:holdClock", { code: game.code, playerId, hold: on });
  const ask = () => {
    if (!response.trim()) return setError("Type your response first.");
    setError(""); setConfirming(true); hold(true);
  };
  const cancel = () => { setConfirming(false); hold(false); };
  const submit = () =>
    socket.emit(
      "player:finalSubmit",
      { code: game.code, playerId, wager, response },
      (r) => { if (!r.ok) { setError(r.error); cancel(); } },
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
      <button className="primary" onClick={ask}>
        Lock in response
      </button>
      {error && <p className="notice">{error}</p>}
      {confirming && <ConfirmSubmit game={game} playerId={playerId} answer={response} onConfirm={submit} onCancel={cancel} />}
    </div>
  );
}
function DailyWager({ game, playerId, player }) {
  const [wager,setWager]=useState("5"); const max=Math.max(player.score,...(game.board||[]).flatMap((c)=>c.questions.map((q)=>q.value||0)),5)
  if(game.activeQuestion.dailyReady) return <><p className="status-card">Wager locked: ${game.activeQuestion.dailyWager.toLocaleString()}</p><p className="player-status">{game.buzzedPlayer ? "You buzzed in." : game.buzzerOpen ? "Buzz in!" : game.hostless ? "Your buzzer opens in 10 seconds." : "Waiting for the host to open your buzzer."}</p><button className={"buzzer " + (game.buzzerOpen ? "ready" : "")} disabled={!!game.buzzedPlayer || !game.buzzerOpen} onClick={()=>socket.emit("player:buzz",{code:game.code,playerId})}>BUZZ!</button></>
  return <div className="final-form"><p className="daily-title">Daily Double!</p><label className="field"><span>Wager ($5 to ${max.toLocaleString()})</span><input type="number" inputMode="numeric" min="5" max={max} value={wager} onChange={e=>setWager(e.target.value)}/></label><button className="primary" onClick={()=>socket.emit("player:dailyWager",{code:game.code,playerId,wager})}>Lock wager</button></div>
}
function HostlessBoard({ game, playerId }) {
  const chooser=game.players.find((player)=>player.id===game.turnPlayerId), canSelect=chooser?.id===playerId;
  return <div className="hostless-board"><p className={"player-status" + (canSelect ? " is-you" : "")}>{canSelect ? "Your turn — pick a clue" : `${chooser?.name || "Another player"} is picking a clue`}</p><div className="board" style={{ "--cols-small": Math.min(3, game.board.length) }}>{game.board.map((category,categoryIndex)=><div className="column" key={categoryIndex}><div className="cat">{category.name}</div>{category.questions.map((question,questionIndex)=><button key={question.id} disabled={question.used || !canSelect} className={question.used ? "used" : ""} aria-label={question.used ? `${category.name} $${question.value}, already played` : `${category.name} for $${question.value}`} onClick={()=>socket.emit("player:select",{code:game.code,playerId,categoryIndex,questionIndex})}>${question.value}</button>)}</div>)}</div></div>
}
function HostlessAnswer({ game, playerId }) {
  const [response,setResponse]=useState(""), [confirming,setConfirming]=useState(false);
  const hold=(on)=>socket.emit("player:holdClock",{code:game.code,playerId,hold:on});
  const ask=()=>{ if(confirming) return; setConfirming(true); hold(true); };
  const cancel=()=>{ setConfirming(false); hold(false); };
  const send=()=>socket.emit("player:answer",{code:game.code,playerId,response});
  return <div className="final-form">
    <label className="field"><span>You buzzed in — type your response</span><input autoFocus={!confirming} autoComplete="off" autoCapitalize="off" enterKeyHint="send" value={response} onChange={(event)=>setResponse(event.target.value)} placeholder="Your response" onKeyDown={(event)=>{ if(event.key==='Enter'){ event.preventDefault(); ask(); } }}/></label>
    <button className="primary" onClick={ask}>Submit response</button>
    {confirming && <ConfirmSubmit game={game} playerId={playerId} answer={response} onConfirm={send} onCancel={cancel} />}
  </div>
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
  useClueMusic(game.buzzerOpen || game.status === "final" || game.fastMoney?.phase === "playing");
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
      ) : game.status === "fastmoney" ? (
        <FastMoneyPlayer game={game} playerId={playerId} />
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
function SkipTally({ game }) {
  const votes = game.skipVotes || [];
  if (game.activeQuestion?.dailyDouble || game.reveal || !votes.length) return null;
  const needed = game.players.filter((player) => player.connected && !game.incorrectPlayerIds?.includes(player.id));
  const count = needed.filter((player) => votes.includes(player.id)).length;
  return <p className="status-note">{count} of {needed.length} players voted to skip this clue. It skips when everyone votes.</p>;
}
function SkipVote({ game, playerId }) {
  const active = game.activeQuestion;
  if (!active || active.final || active.dailyDouble || game.reveal) return null;
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
// Opened from a QR code (?join=CODE), the code is already filled in and only the name is asked for.
function Join({ onJoined, initialError, presetCode = "" }) {
  const [code, setCode] = useState(presetCode),
    [editCode, setEditCode] = useState(!presetCode),
    [name, setName] = useState(sessionStorage.playerName || ""),
    [error, setError] = useState(initialError || ""),
    [busy, setBusy] = useState(false);
  const join = (event) => {
    event.preventDefault();
    tone(1,.01,"sine",.001); setBusy(true); setError("");
    socket.timeout(8000).emit("player:join", { code: code.trim(), name, returningPlayerId: sessionStorage.playerId }, (err, r) => {
      setBusy(false);
      if (err) return setError("Couldn’t reach the game server. Check your connection and try again.");
      if (r.ok) return onJoined(r.game, r.playerId);
      setError(r.error === "Game not found" ? `There’s no game with the code ${code.trim() || "—"}. Check the code on the main screen.` : r.error);
      if (r.error === "Game not found") setEditCode(true);
    });
  };
  return (
    <main className="join">
      <div className="brand hub-brand">GAME NIGHT</div>
      <h1>{editCode ? "Join a game" : "What’s your name?"}</h1>
      <form onSubmit={join}>
        {!editCode && (
          <p className="join-code-line">
            Joining game <span className="code-chip">{code}</span>
            <button type="button" className="link-btn" onClick={() => setEditCode(true)}>Different code?</button>
          </p>
        )}
        {editCode && <label className="field">
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
        </label>}
        <label className="field">
          <span>Your name</span>
          <input
            autoFocus={!editCode}
            enterKeyHint="go"
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
      <p className="muted">Jeopardy! takes up to 6 players, Spin &amp; Solve 6 (or 12 in teams), Fib or Fact and Price Check 8, and Survey Says! 12. You can join after a game starts.</p>
      <a href="./">← Game Night</a>
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
        <button className="primary" onClick={() => { sessionStorage.removeItem("displayCode"); location.assign("./"); }}>
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
    controller = params.has("controller"),
    joining = params.has("join"),
    joinCode = (params.get("join") || "").trim().toUpperCase().slice(0, 6);
  // Choosing a game to set up starts fresh, rather than reopening a game this tab hosted earlier.
  if (host && params.has("game")) sessionStorage.removeItem("displayCode");
  // A QR code for a different game replaces this phone's saved session instead of reconnecting to the old one.
  if (joinCode && sessionStorage.gameCode && sessionStorage.gameCode !== joinCode) clearPlayerSession();
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
      return <main className="join"><div className="brand hub-brand">GAME NIGHT</div>{controller && !restoring ? <button className="primary" onClick={() => location.reload()}>Enter game code</button> : <p className="player-status">Reconnecting to your game…</p>}</main>;
    if (host) {
      const create = (config, fail) =>
        socket.timeout(10000).emit("host:create", config, (err, r) => {
              if (err) return fail("Couldn’t reach the game server. Check your connection and try again.");
              if (!r?.ok) return fail(r?.error || "Couldn’t create the game.");
              sessionStorage.displayCode = r.code;
              setGame(r.game);
              history.replaceState({}, "", "?host");
            });
      const pick = params.get("game");
      if (pick === "survey") return <SurveySetup onCreate={create} />;
      if (pick === "wheel") return <WheelSetup onCreate={create} />;
      if (pick === "fib") return <FibSetup onCreate={create} />;
      if (pick === "price") return <PriceSetup onCreate={create} />;
      if (pick === "jeopardy") return <Setup onCreate={create} />;
      return <Hub />;
    }
    if (!joining && !joinError) return <Hub />;
    return (
      <Join
        initialError={joinError}
        presetCode={joinCode}
        onJoined={(g, p) => {
          sessionStorage.playerId = p;
          sessionStorage.gameCode = g.code;
          sessionStorage.playerName = g.players.find((player) => player.id === p)?.name || "";
          setPlayerId(p);
          setGame(g);
          history.replaceState({}, "", location.pathname);
        }}
      />
    );
  }
  if (game.kind === "survey") {
    if (game.status === "complete") return <>{banner}<SurveyEnd game={game} host={host || controller} display={host} onAction={action} /></>;
    if (controller) return <>{banner}<SurveyController game={game} onAction={action} /></>;
    if (host) return <>{banner}<SurveyDisplay game={game} onAction={action} /></>;
    return <>{banner}<SurveyPlayer game={game} playerId={playerId} /></>;
  }
  if (game.kind === "wheel") {
    if (game.status === "complete") return <>{banner}<WheelEnd game={game} host={host || controller} display={host} onAction={action} /></>;
    if (controller) return <>{banner}<WheelController game={game} onAction={action} /></>;
    if (host) return <>{banner}<WheelDisplay game={game} onAction={action} /></>;
    return <>{banner}<WheelPlayer game={game} playerId={playerId} /></>;
  }
  if (game.kind === "fib") {
    if (game.status === "complete") return <>{banner}<FibEnd game={game} host={host || controller} display={host} onAction={action} /></>;
    if (controller) return <>{banner}<FibController game={game} onAction={action} /></>;
    if (host) return <>{banner}<FibDisplay game={game} onAction={action} /></>;
    return <>{banner}<FibPlayer game={game} playerId={playerId} /></>;
  }
  if (game.kind === "price") {
    if (game.status === "complete") return <>{banner}<PriceEnd game={game} host={host || controller} display={host} onAction={action} /></>;
    if (controller) return <>{banner}<PriceController game={game} onAction={action} /></>;
    if (host) return <>{banner}<PriceDisplay game={game} onAction={action} /></>;
    return <>{banner}<PricePlayer game={game} playerId={playerId} /></>;
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
