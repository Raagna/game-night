import React, { useMemo, useRef, useState } from "react";
import { FAST_MONEY_CLUES, MAX_ROUNDS, MAX_SIZE, boardStats, newRound } from "./boards";

const clone = (value) => JSON.parse(JSON.stringify(value));

function Stepper({ label, value, min, max, onChange }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <span>{label}</span>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <b aria-live="polite">{value}</b>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export default function BoardEditor({ initial, notes, onSave, onCancel }) {
  const [board, setBoard] = useState(() => clone(initial));
  const [roundIndex, setRoundIndex] = useState(0);
  const [cell, setCell] = useState(null); // { category, row } in the current round
  const [error, setError] = useState("");
  const startingPoint = useRef(JSON.stringify(initial));
  const round = board.rounds[roundIndex];
  const stats = useMemo(() => boardStats(board), [board]);
  const update = (change) => setBoard((current) => { const next = clone(current); change(next); return next; });
  const updateRound = (change) => update((next) => change(next.rounds[roundIndex]));

  const setCategoryCount = (count) => {
    updateRound((r) => {
      while (r.categories.length < count) r.categories.push({ name: "", clues: r.values.map(() => ({ question: "", answer: "" })) });
      r.categories.length = count;
    });
    if (cell && cell.category >= count) setCell(null);
  };
  const setRowCount = (count) => { if (cell && cell.row >= count) setCell(null); updateRound((r) => {
    const step = r.values.length > 1 ? r.values[1] - r.values[0] : r.values[0] || 200;
    while (r.values.length < count) r.values.push((r.values.at(-1) || 0) + (step || 200));
    r.values.length = count;
    r.categories.forEach((category) => {
      while (category.clues.length < count) category.clues.push({ question: "", answer: "" });
      category.clues.length = count;
    });
  }); };
  const addRound = () => { update((next) => next.rounds.push(newRound(next.rounds.length, round.categories.length, round.values.length))); setRoundIndex(board.rounds.length); setCell(null); };
  const removeRound = () => { update((next) => next.rounds.splice(roundIndex, 1)); setRoundIndex(0); setCell(null); };

  const save = () => {
    if (!board.title.trim()) return setError("Give your board a name before saving.");
    if (!stats.filled) return setError("Add at least one clue and its answer before saving.");
    onSave(board);
  };
  const cancel = () => {
    if (JSON.stringify(board) !== startingPoint.current && !window.confirm("Discard your changes to this board?")) return;
    onCancel();
  };
  const active = cell && round.categories[cell.category];
  const activeClue = active?.clues[cell.row];
  const fastMoney = Array.from({ length: FAST_MONEY_CLUES }, (_, i) => board.fastMoney[i] || { category: "", question: "", answer: "" });
  const empty = stats.cells - stats.filled;

  return (
    <div className="editor">
      <div className="editor-head">
        <label className="field editor-title">
          <span>Board name</span>
          <input value={board.title} maxLength="80" placeholder="e.g. Friday trivia night" onChange={(e) => update((next) => { next.title = e.target.value; })} />
        </label>
        <div className="editor-actions">
          <button type="button" className="secondary" onClick={cancel}>Cancel</button>
          <button type="button" className="primary" onClick={save}>Save board</button>
        </div>
      </div>
      {notes && <p className="editor-note" role="status">{notes}</p>}

      <div className="round-tabs" role="tablist" aria-label="Rounds">
        {board.rounds.map((r, i) => (
          <button key={i} role="tab" aria-selected={i === roundIndex} className={i === roundIndex ? "active" : ""} onClick={() => { setRoundIndex(i); setCell(null); }}>
            {r.name || `Round ${i + 1}`}
          </button>
        ))}
        {board.rounds.length < MAX_ROUNDS && <button type="button" className="add-round" onClick={addRound}>+ Add a second round</button>}
      </div>

      <div className="round-bar">
        <label className="field round-name">
          <span>Round name</span>
          <input value={round.name} maxLength="40" onChange={(e) => updateRound((r) => { r.name = e.target.value; })} />
        </label>
        <Stepper label="Categories" value={round.categories.length} min={1} max={MAX_SIZE} onChange={setCategoryCount} />
        <Stepper label="Rows" value={round.values.length} min={1} max={MAX_SIZE} onChange={setRowCount} />
        {board.rounds.length > 1 && <button type="button" className="text-danger" onClick={removeRound}>Remove this round</button>}
      </div>

      <div className="editor-grid-wrap">
        <div className="editor-grid" style={{ gridTemplateColumns: `76px repeat(${round.categories.length}, minmax(140px, 1fr))` }}>
          <span className="corner">Points</span>
          {round.categories.map((category, c) => (
            <input key={c} className="category-input" aria-label={`Category ${c + 1} name`} placeholder={`Category ${c + 1}`} maxLength="80" value={category.name}
              onChange={(e) => updateRound((r) => { r.categories[c].name = e.target.value; })} />
          ))}
          {round.values.map((value, row) => (
            <React.Fragment key={row}>
              <input className="value-input" type="number" inputMode="numeric" min="0" aria-label={`Points for row ${row + 1}`} value={value}
                onChange={(e) => updateRound((r) => { r.values[row] = Math.max(0, Math.trunc(Number(e.target.value)) || 0); })} />
              {round.categories.map((category, c) => {
                const clue = category.clues[row], done = clue.question.trim() && clue.answer.trim();
                const selected = cell?.category === c && cell?.row === row;
                return (
                  <button key={c} type="button" className={"editor-cell" + (done ? " is-done" : clue.question || clue.answer ? " is-partial" : "") + (selected ? " is-selected" : "")}
                    aria-label={`${category.name || `Category ${c + 1}`} for ${value}: ${done ? clue.question : "empty"}`}
                    onClick={() => setCell(selected ? null : { category: c, row })}>
                    {clue.question || <span className="placeholder">Add clue</span>}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {activeClue && (
        <div className="cell-editor">
          <p className="cell-editor-title">{active.name || `Category ${cell.category + 1}`} · ${round.values[cell.row].toLocaleString()}</p>
          <label className="field">
            <span>Clue (what the host reads)</span>
            <textarea autoFocus rows="3" value={activeClue.question} onChange={(e) => updateRound((r) => { r.categories[cell.category].clues[cell.row].question = e.target.value; })} />
          </label>
          <label className="field">
            <span>Correct response</span>
            <input value={activeClue.answer} maxLength="200" onChange={(e) => updateRound((r) => { r.categories[cell.category].clues[cell.row].answer = e.target.value; })} />
          </label>
          <div className="cell-editor-actions">
            <button type="button" className="secondary" onClick={() => {
              const total = round.categories.length * round.values.length, at = cell.row * round.categories.length + cell.category + 1;
              setCell(at < total ? { category: at % round.categories.length, row: Math.floor(at / round.categories.length) } : null);
            }}>Next square</button>
            <button type="button" className="secondary" onClick={() => setCell(null)}>Done</button>
          </div>
        </div>
      )}

      <section className="editor-section">
        <h3>Final Jeoparty <small>optional</small></h3>
        <div className="editor-fields">
          <label className="field"><span>Category</span><input value={board.final.category} maxLength="80" onChange={(e) => update((next) => { next.final.category = e.target.value; })} /></label>
          <label className="field field-wide"><span>Clue</span><input value={board.final.question} onChange={(e) => update((next) => { next.final.question = e.target.value; })} /></label>
          <label className="field"><span>Correct response</span><input value={board.final.answer} maxLength="200" onChange={(e) => update((next) => { next.final.answer = e.target.value; })} /></label>
        </div>
      </section>

      <section className="editor-section">
        <h3>Fast Money clues <small>optional · leave blank to use random archive clues</small></h3>
        {fastMoney.map((clue, i) => (
          <div className="editor-fields" key={i}>
            <label className="field"><span>Category {i + 1}</span><input value={clue.category} maxLength="80" onChange={(e) => update((next) => { next.fastMoney[i] = { ...fastMoney[i], ...next.fastMoney[i], category: e.target.value }; })} /></label>
            <label className="field field-wide"><span>Quick clue</span><input value={clue.question} onChange={(e) => update((next) => { next.fastMoney[i] = { ...fastMoney[i], ...next.fastMoney[i], question: e.target.value }; })} /></label>
            <label className="field"><span>Answer</span><input value={clue.answer} maxLength="200" onChange={(e) => update((next) => { next.fastMoney[i] = { ...fastMoney[i], ...next.fastMoney[i], answer: e.target.value }; })} /></label>
          </div>
        ))}
      </section>

      <div className="editor-foot">
        <p className="muted">
          {stats.filled} of {stats.cells} squares filled{empty ? ` · ${empty} empty square${empty === 1 ? "" : "s"} will show blank and be skipped` : ""}
        </p>
        {error && <p className="notice" role="alert">{error}</p>}
        <div className="editor-actions">
          <button type="button" className="secondary" onClick={cancel}>Cancel</button>
          <button type="button" className="primary" onClick={save}>Save board</button>
        </div>
      </div>
    </div>
  );
}
