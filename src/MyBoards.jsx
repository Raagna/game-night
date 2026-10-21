import React, { useState } from "react";
import { boardStats, exportBoard, fastMoneyFromBoard, hasFinal, importFromJeopardyLabs, readBoardFile, roundShape } from "./boards";

const formatDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
};

export default function MyBoards({ boards, selectedId, storageOk, onSelect, onNew, onEdit, onDelete, onImported }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const importLink = async (event) => {
    event.preventDefault();
    if (!url.trim()) return setMessage("Paste a JeopardyLabs game link first.");
    setBusy(true); setMessage("");
    try {
      const { board, notes } = await importFromJeopardyLabs(url);
      const extra = [
        notes.trimmedCategories && `${notes.trimmedCategories} extra categor${notes.trimmedCategories === 1 ? "y was" : "ies were"} left off (6 max)`,
        notes.trimmedRows && `${notes.trimmedRows} extra row${notes.trimmedRows === 1 ? " was" : "s were"} left off (6 max)`,
        notes.pictureClues && `${notes.pictureClues} picture clue${notes.pictureClues === 1 ? " has" : "s have"} no text and will be blank`,
      ].filter(Boolean);
      setUrl("");
      onImported(board, `Imported “${board.title}” from JeopardyLabs. Check it over, then save.${extra.length ? ` Note: ${extra.join("; ")}.` : ""}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { onImported(await readBoardFile(file), `Loaded “${file.name}”. Check it over, then save.`); }
    catch (error) { setMessage(error.message); }
  };

  return (
    <div className="my-boards">
      <div className="my-boards-tools">
        <button type="button" className="primary" onClick={onNew}>New board</button>
        <label className="secondary file-button">
          Import board file
          <input type="file" accept=".json,application/json" onChange={importFile} />
        </label>
      </div>
      <form className="jl-import" onSubmit={importLink}>
        <label className="field">
          <span>Import from JeopardyLabs</span>
          <input type="url" inputMode="url" placeholder="https://jeopardylabs.com/play/your-game" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <button className="secondary" disabled={busy}>{busy ? "Importing…" : "Import"}</button>
      </form>
      {message && <p className="notice" role="alert">{message}</p>}
      {!storageOk && <p className="notice">This browser isn’t letting the site save boards (a private window can do this). Use “Export” to keep a copy as a file.</p>}

      {boards.length ? (
        <ul className="board-list">
          {boards.map((board) => {
            const stats = boardStats(board), selected = board.id === selectedId, fm = fastMoneyFromBoard(board).length;
            return (
              <li key={board.id} className={selected ? "is-selected" : ""}>
                <button type="button" className="board-pick" aria-pressed={selected} onClick={() => onSelect(selected ? null : board.id)}>
                  <span className="board-name">{board.title || "Untitled board"}</span>
                  <small>
                    {board.rounds.length} round{board.rounds.length === 1 ? "" : "s"} ({board.rounds.map(roundShape).join(", ")}) · {stats.filled} clues
                    {hasFinal(board) ? " · Final" : ""}{fm ? ` · ${fm} Fast Money` : ""}
                    {board.updatedAt ? ` · saved ${formatDate(board.updatedAt)}` : ""}
                  </small>
                </button>
                <div className="board-actions">
                  <button type="button" onClick={() => onEdit(board)}>Edit</button>
                  <button type="button" onClick={() => exportBoard(board)}>Export</button>
                  <button type="button" className="danger-link" onClick={() => window.confirm(`Delete “${board.title || "Untitled board"}”? This can’t be undone.`) && onDelete(board.id)}>Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty-boards">No saved boards yet. Make one from scratch, or paste a JeopardyLabs link above.</p>
      )}
    </div>
  );
}
