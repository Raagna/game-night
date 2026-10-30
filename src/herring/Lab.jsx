// The lab's phone tasks. Each finished sample fills a little more of the lab bar on the TV.
// Fingerprints: the sample print and four on file; tap the match. The prints are drawn from a number the server
// sends, so the server knows the answer without sending it.
// Tubes: the rack lights its tubes one after another; tap them back in the same order.
import React, { useEffect, useMemo, useRef, useState } from "react";

// A small seeded random, so a print number always draws the same print.
function prng(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}
const TAU = Math.PI * 2;
// One ridge: a closed or open curve around the print's core, wobbling a little, broken where the print has a gap.
function ridge(cx, cy, rx, ry, tilt, wobble, phase, from, to) {
  const points = [];
  for (let i = 0; i <= 48; i++) {
    const a = from + ((to - from) * i) / 48;
    const w = 1 + wobble * Math.sin(3 * a + phase) + wobble * 0.6 * Math.sin(5 * a - phase);
    const x = rx * w * Math.cos(a), y = ry * w * Math.sin(a);
    points.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
  }
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}
// Whorls (rings round a core), loops (ridges that come in from one side and turn back) and arches (ridges that
// rise over the middle), each with its own tilt, spacing, breaks and ridge endings.
function printPaths(seed) {
  const rand = prng(seed), kind = ["whorl", "loop", "arch"][Math.floor(rand() * 3)];
  const cx = 50 + (rand() - 0.5) * 14, cy = 56 + (rand() - 0.5) * 14, tilt = (rand() - 0.5) * 0.9;
  const rings = 7 + Math.floor(rand() * 4), gap = 4.6 + rand() * 1.4, paths = [];
  for (let i = 1; i <= rings; i++) {
    const rx = i * gap * (0.9 + rand() * 0.2), ry = rx * (1.2 + rand() * 0.15), wobble = 0.02 + rand() * 0.05, phase = rand() * TAU;
    if (kind === "whorl") {
      const breakAt = rand() * TAU, size = 0.25 + rand() * 0.5;
      paths.push(ridge(cx, cy, rx, ry, tilt, wobble, phase, breakAt + size, breakAt + TAU - 0.15));
    } else if (kind === "loop") {
      paths.push(ridge(cx, cy - 6, rx * 0.8, ry, tilt, wobble, phase, Math.PI * (0.62 + rand() * 0.1), Math.PI * (2.38 - rand() * 0.1)));
    } else {
      const y = 90 - i * gap * 1.25, h = 6 + i * (1.4 + rand() * 1.6);
      paths.push(`M${8 + rand() * 6} ${y}Q${cx + (rand() - 0.5) * 18} ${y - h * 2.2} ${92 - rand() * 6} ${y + (rand() - 0.5) * 6}`);
    }
  }
  // Ridge endings and dots: the small details that set one print apart from another.
  for (let i = 0; i < 5; i++) {
    const a = rand() * TAU, r = 10 + rand() * 30, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a) * 1.2;
    paths.push(i % 2 ? `M${x.toFixed(1)} ${y.toFixed(1)}h0.1` : `M${x.toFixed(1)} ${y.toFixed(1)}l${(rand() * 6 - 3).toFixed(1)} ${(rand() * 6 - 3).toFixed(1)}`);
  }
  return paths;
}
export function Fingerprint({ seed, className = "", label }) {
  const paths = useMemo(() => printPaths(seed), [seed]);
  return (
    <svg className={`rh-print ${className}`} viewBox="0 0 100 110" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : "true"}>
      <defs><clipPath id={`rh-pad-${seed}`}><ellipse cx="50" cy="56" rx="40" ry="50" /></clipPath></defs>
      <ellipse className="rh-print-pad" cx="50" cy="56" rx="41" ry="51" />
      <g clipPath={`url(#rh-pad-${seed})`} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
        {paths.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  );
}

function PrintTask({ task, onAnswer, busy }) {
  return (
    <div className="rh-task rh-task-print">
      <p className="rh-task-ask">Which print on file matches the sample?</p>
      <div className="rh-print-sample"><span className="label">Sample</span><Fingerprint seed={task.target} label="The sample print" /></div>
      <div className="rh-print-options">
        {task.options.map((seed, i) => (
          <button key={seed} disabled={busy} onClick={() => onAnswer(i)} aria-label={`Print ${i + 1}`}><Fingerprint seed={seed} /></button>
        ))}
      </div>
    </div>
  );
}

// The rack shows its order once (a tube lights up every 650 ms), then waits for taps; Show again replays it.
function TubesTask({ task, onAnswer, busy }) {
  const [lit, setLit] = useState(-1), [showing, setShowing] = useState(true), [taps, setTaps] = useState([]), timers = useRef([]);
  const play = () => {
    timers.current.forEach(clearTimeout); setTaps([]); setShowing(true);
    timers.current = task.order.flatMap((tube, i) => [setTimeout(() => setLit(tube), 500 + i * 650), setTimeout(() => setLit(-1), 500 + i * 650 + 450)]);
    timers.current.push(setTimeout(() => setShowing(false), 500 + task.order.length * 650));
  };
  useEffect(() => { play(); return () => timers.current.forEach(clearTimeout); }, [task.id]);
  const tap = (tube) => {
    if (showing || busy) return;
    const next = [...taps, tube];
    setTaps(next); setLit(tube); setTimeout(() => setLit(-1), 180);
    if (next.length === task.order.length) onAnswer(next);
  };
  const levels = [0.72, 0.5, 0.86, 0.6, 0.4];
  return (
    <div className="rh-task rh-task-tubes">
      <p className="rh-task-ask">{showing ? "Watch the order the samples light up…" : `Tap them in the same order (${taps.length} of ${task.order.length})`}</p>
      <div className="rh-rack" role="group" aria-label="Sample tubes">
        {Array.from({ length: task.tubes }, (_, tube) => (
          <button key={tube} className={"rh-tube" + (lit === tube ? " is-lit" : "")} style={{ "--level": levels[tube % levels.length] }} disabled={showing || busy} onClick={() => tap(tube)} aria-label={`Tube ${tube + 1}`}>
            <span className="rh-tube-glass"><span className="rh-tube-liquid" /></span>
            <span className="rh-tube-num">{tube + 1}</span>
          </button>
        ))}
      </div>
      <button className="chip-btn" disabled={showing || busy} onClick={play}>Show again</button>
    </div>
  );
}

// result: null while working, "right" or "wrong" for a moment after an answer.
export function LabTask({ task, onAnswer }) {
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(false); }, [task?.id]);
  if (!task) return <p className="muted">Lab work opens during the investigation.</p>;
  const answer = (value) => {
    setBusy(true);
    onAnswer(task.id, value, (right) => { setResult(right ? "right" : "wrong"); setTimeout(() => { setResult(null); setBusy(false); }, 900); });
  };
  return (
    <div className={"rh-lab-task" + (result ? ` is-${result}` : "")}>
      {task.type === "print" ? <PrintTask key={task.id} task={task} onAnswer={answer} busy={busy} /> : <TubesTask key={task.id} task={task} onAnswer={answer} busy={busy} />}
      {result && <p className="rh-task-result" role="status">{result === "right" ? "Sample logged" : "Spoiled — try the next one"}</p>}
    </div>
  );
}
