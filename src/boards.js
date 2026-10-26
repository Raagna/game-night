// Custom boards: the saved format, browser storage, file export/import, JeopardyLabs import,
// and turning a board into the game config the server expects.
import { SERVER } from "./shared";

export const MAX_ROUNDS = 2;
export const MAX_SIZE = 6;
export const FAST_MONEY_CLUES = 5;
const STORAGE_KEY = "jeopardyParty.boards.v1";
const FILE_FORMAT = "jeopardy-party-board";
const ROUND_NAMES = ["Jeoparty!", "Double Jeoparty!"];

const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const str = (value, max = 500) => String(value ?? "").slice(0, max);
const emptyClue = () => ({ question: "", answer: "" });
export const defaultValues = (rows, roundIndex) => Array.from({ length: rows }, (_, i) => (i + 1) * (roundIndex === 0 ? 200 : 400));

export function newRound(roundIndex, categories = 6, rows = 5) {
  return {
    name: ROUND_NAMES[roundIndex] || `Round ${roundIndex + 1}`,
    values: defaultValues(rows, roundIndex),
    categories: Array.from({ length: categories }, () => ({ name: "", clues: Array.from({ length: rows }, emptyClue) })),
  };
}
export function newBoard() {
  return { id: newId(), title: "", updatedAt: null, rounds: [newRound(0)], final: { category: "", question: "", answer: "" }, fastMoney: [] };
}

// Coerce anything board-shaped (saved data, an imported file) into a valid board, or throw.
export function normalizeBoard(input) {
  const raw = input?.format === FILE_FORMAT ? input.board : input;
  const rounds = (Array.isArray(raw?.rounds) ? raw.rounds : []).slice(0, MAX_ROUNDS).map((round, roundIndex) => {
    const categories = (Array.isArray(round?.categories) ? round.categories : []).slice(0, MAX_SIZE);
    const rows = Math.min(MAX_SIZE, Math.max(1, ...categories.map((category) => (Array.isArray(category?.clues) ? category.clues.length : 0)), 1));
    const values = Array.from({ length: rows }, (_, i) => Math.max(0, Math.trunc(Number(round?.values?.[i] ?? categories[0]?.clues?.[i]?.value)) || defaultValues(rows, roundIndex)[i]));
    return {
      name: str(round?.name, 40) || ROUND_NAMES[roundIndex] || `Round ${roundIndex + 1}`,
      values,
      categories: categories.map((category) => ({
        name: str(category?.name, 80),
        clues: Array.from({ length: rows }, (_, i) => ({ question: str(category?.clues?.[i]?.question), answer: str(category?.clues?.[i]?.answer, 200) })),
      })),
    };
  }).filter((round) => round.categories.length);
  if (!rounds.length) throw new Error("That file doesn’t contain a board with any categories.");
  const final = raw?.final || {};
  return {
    id: str(raw?.id, 40) || newId(),
    title: str(raw?.title, 80),
    updatedAt: raw?.updatedAt || null,
    rounds,
    final: { category: str(final.category, 80), question: str(final.question), answer: str(final.answer, 200) },
    fastMoney: (Array.isArray(raw?.fastMoney) ? raw.fastMoney : []).slice(0, FAST_MONEY_CLUES).map((clue) => ({ category: str(clue?.category, 80), question: str(clue?.question), answer: str(clue?.answer, 200) })),
  };
}

// ---------- Browser storage ----------
// Storage can be missing or blocked (private windows, strict settings), so every access is guarded.
export function loadBoards() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return (Array.isArray(saved) ? saved : []).flatMap((board) => { try { return [normalizeBoard(board)]; } catch { return []; } });
  } catch {
    return [];
  }
}
function writeBoards(boards) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(boards)); return true; } catch { return false; }
}
export function saveBoard(boards, board) {
  const saved = { ...board, updatedAt: new Date().toISOString() };
  const next = [saved, ...boards.filter((b) => b.id !== board.id)];
  return { boards: next, stored: writeBoards(next) };
}
export function deleteBoard(boards, id) {
  const next = boards.filter((b) => b.id !== id);
  return { boards: next, stored: writeBoards(next) };
}

// ---------- Files ----------
const slug = (text) => (text || "board").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board";
export function exportBoard(board) {
  const blob = new Blob([JSON.stringify({ format: FILE_FORMAT, version: 1, board }, null, 2)], { type: "application/json" });
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${slug(board.title)}.jeopardy-board.json` });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
export async function readBoardFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("That file isn’t a board file (it isn’t valid JSON)."); }
  return { ...normalizeBoard(data), id: newId() };
}

// ---------- JeopardyLabs ----------
export async function importFromJeopardyLabs(url) {
  let response;
  try {
    response = await fetch(`${SERVER}/import/jeopardylabs?url=${encodeURIComponent(url.trim())}`);
  } catch {
    throw new Error("Couldn’t reach the game server to import. Check your connection and try again.");
  }
  const result = await response.json().catch(() => ({ ok: false, error: "The import failed. Try again." }));
  if (!result.ok) throw new Error(result.error);
  const board = normalizeBoard({ ...result.board, id: newId() });
  return { board, notes: result.board.notes || {} };
}

// ---------- Summaries and game config ----------
const filled = (clue) => clue.question.trim() && clue.answer.trim();
export function boardStats(board) {
  const cells = board.rounds.flatMap((round) => round.categories.flatMap((category) => category.clues));
  return { cells: cells.length, filled: cells.filter(filled).length };
}
export const roundShape = (round) => `${round.categories.length}×${round.values.length}`;
export const hasFinal = (board) => Boolean(board.final?.question.trim() && board.final?.answer.trim());
export const fastMoneyFromBoard = (board) => board.fastMoney.filter(filled);

export function boardToConfig(board) {
  return {
    roundNames: board.rounds.map((round) => round.name),
    boards: board.rounds.map((round, roundIndex) =>
      round.categories.map((category, categoryIndex) => ({
        name: category.name.trim() || `Category ${categoryIndex + 1}`,
        questions: category.clues.map((clue, rowIndex) => ({
          id: `${board.id}-${roundIndex}-${categoryIndex}-${rowIndex}`,
          category: category.name.trim(),
          question: clue.question.trim(),
          answer: clue.answer.trim(),
          value: round.values[rowIndex],
        })),
      })),
    ),
  };
}

// Five short, easy archive clues from different categories for a Fast Money round. Rapid-fire clues have to
// stand on their own, so skip wordplay categories (topic 13) and clues that lean on their category's title.
const WORDPLAY_TOPIC = 13;
const needsCategory = (q) =>
  /["“”…?]|\.\.\./.test(q.category) || /^[^ ]{1,12}:/.test(q.question) || /\b(this|the) category\b|\b(letter|rhymes?|anagram)\b/i.test(q.question);
export function pickFastMoneyClues(questions, count = FAST_MONEY_CLUES) {
  const pool = questions
    .filter((q) => q.round === "Jeopardy!" && (q.value || 0) <= 400 && q.question.length <= 100 && q.answer.length <= 30 && q.answer.split(" ").length <= 4)
    .filter((q) => !q.topics?.includes(WORDPLAY_TOPIC) && !needsCategory(q) && /\b(this|these)\b/i.test(q.question))
    .sort(() => Math.random() - 0.5);
  const seen = new Set(), picks = [];
  for (const q of pool) {
    if (seen.has(q.category)) continue;
    seen.add(q.category);
    picks.push({ category: q.category, question: q.question, answer: q.answer });
    if (picks.length === count) break;
  }
  return picks;
}
