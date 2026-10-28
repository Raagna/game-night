// The split-flap board's one moving part. Data on Game Night (codes, scores, clocks, answers, titles) is set on
// flap cells: one cell per character, a hairline across the middle where the two flaps meet. When the text
// changes, the changed cells flip left to right, each running through a character or two from the drum before it
// lands, with a clack from the TV. With reduced motion the new text simply fades in.
import React, { useEffect, useRef, useState } from "react";
import { playClack } from "./survey/sounds";

const DRUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HOP = 55; // ms each intermediate character stays up
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
// Only the shared screen clacks; phones and the setup screen flip silently.
const onTv = () => document.body.classList.contains("is-tv");

// Each changed cell starts a little after the one to its left, and runs through 1–3 drum characters first.
function plan(from, to) {
  const length = Math.max(from.length, to.length), stagger = Math.max(18, Math.min(45, 900 / Math.max(1, length)));
  const cells = [];
  for (let i = 0; i < length; i++) {
    const a = from[i] || " ", b = to[i] || " ";
    if (a === b) { cells.push(null); continue; }
    const hops = Array.from({ length: 1 + ((i * 7 + b.charCodeAt(0)) % 3) }, (_, k) => DRUM[(b.charCodeAt(0) * 3 + i * 5 + k * 11) % DRUM.length]);
    cells.push({ start: i * stagger, steps: [...hops, b] });
  }
  return cells;
}

function useCascade(target, { intro, still, strip }) {
  const [state, setState] = useState(() => ({ shown: intro && !still && !reducedMotion() ? "" : target, moving: false, fading: false }));
  const shownRef = useRef(state.shown), frame = useRef(0), fadeTimer = useRef(0);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    cancelAnimationFrame(frame.current); clearTimeout(fadeTimer.current);
    if (still) { shownRef.current = target; setState({ shown: target, moving: false, fading: false }); return; }
    if (strip && !reducedMotion()) {
      // A whole-word flap turns over once.
      shownRef.current = target; setState({ shown: target, moving: true, fading: false });
      if (onTv()) playClack(1);
      fadeTimer.current = setTimeout(() => setState((s) => ({ ...s, moving: false })), 220);
      return;
    }
    if (reducedMotion()) {
      shownRef.current = target; setState({ shown: target, moving: false, fading: true });
      fadeTimer.current = setTimeout(() => setState((s) => ({ ...s, fading: false })), 260);
      return;
    }
    const cells = plan(from, target), length = cells.length, sound = onTv();
    const end = Math.max(0, ...cells.map((c) => (c ? c.start + c.steps.length * HOP : 0)));
    const began = performance.now();
    let last = from;
    const tick = (now) => {
      const t = now - began;
      let next = "", flipped = 0;
      for (let i = 0; i < length; i++) {
        const c = cells[i];
        if (!c) { next += target[i] || " "; continue; }
        const step = Math.floor((t - c.start) / HOP);
        const ch = step < 0 ? from[i] || " " : c.steps[Math.min(step, c.steps.length - 1)];
        if (ch !== (last[i] || " ")) flipped++;
        next += ch;
      }
      next = next.replace(/ +$/, "") === target.replace(/ +$/, "") && t >= end ? target : next;
      if (next !== last) { last = next; shownRef.current = next; setState({ shown: next, moving: true, fading: false }); if (sound && flipped) playClack(flipped); }
      if (t < end) frame.current = requestAnimationFrame(tick);
      else { shownRef.current = target; setState({ shown: target, moving: false, fading: false }); }
    };
    frame.current = requestAnimationFrame(tick);
  }, [target, still, strip]);
  useEffect(() => () => { cancelAnimationFrame(frame.current); clearTimeout(fadeTimer.current); }, []);
  return state;
}

// text: what the cells say. cells: pad to this many cells (blanks on the right, or the left with align="right").
// wrap: break between words onto more lines. strip: one wide flap for the whole text, as for a destination name.
// intro: flip in from blank when it first appears. still: change without flipping (a clock's early seconds).
// label: what a screen reader hears instead of the text.
export default function Flap({ text, cells = 0, align = "left", wrap = false, strip = false, intro = false, still = false, label, className = "" }) {
  let target = String(text ?? "").toUpperCase();
  if (cells && target.length < cells) target = align === "right" ? target.padStart(cells) : target.padEnd(cells);
  const { shown, moving, fading } = useCascade(target, { intro, still, strip });
  const anim = moving ? " f" : fading ? " x" : "";
  const spoken = label ?? String(text ?? "");
  if (strip) {
    return (
      <span className={`flap flap-strip${className ? ` ${className}` : ""}`}>
        <span className="sr-only">{spoken}</span>
        <span className="flap-c" aria-hidden="true"><span className={"fg" + anim} key={moving || fading ? shown : undefined}>{shown.trim() || " "}</span></span>
      </span>
    );
  }
  const padded = shown.padEnd(target.length);
  const cell = (ch, i) => <span className={"flap-c" + (ch === " " ? " is-blank" : "")} key={i}><span className={"fg" + anim} key={moving || fading ? `${i}${ch}` : undefined}>{ch === " " ? " " : ch}</span></span>;
  let body;
  if (wrap) {
    // Words keep their cells together; the board breaks between them.
    const words = [];
    let at = 0;
    for (const word of target.split(" ")) { words.push([at, word.length]); at += word.length + 1; }
    body = words.filter(([, n]) => n).map(([start, n]) => <span className="flap-w" key={start}>{Array.from({ length: n }, (_, k) => cell(padded[start + k] || " ", start + k))}</span>);
  } else body = Array.from(padded, cell);
  const longest = wrap ? Math.max(3, ...target.split(" ").map((w) => w.length)) : target.length;
  return (
    <span className={`flap${wrap ? " flap-wrap" : ""}${className ? ` ${className}` : ""}`} style={{ "--n": Math.max(1, target.length), "--w": longest }}>
      <span className="sr-only">{spoken}</span>
      <span className="flap-cells" aria-hidden="true">{body}</span>
    </span>
  );
}

// A game's name as the board's header row: its lamp, then the name on flap cells.
export function Brand({ text, className = "", intro = false }) {
  return (
    <div className={`brand${className ? ` ${className}` : ""}`}>
      <i className="lamp" aria-hidden="true" />
      <Flap text={text} intro={intro} />
    </div>
  );
}

// A score or amount that clacks when it changes.
export function Money({ value, prefix = "", className = "", cells = 0 }) {
  const text = `${prefix}${typeof value === "number" ? value.toLocaleString() : value}`;
  return <Flap className={`money${className ? ` ${className}` : ""}`} text={text} cells={cells} align="right" />;
}
