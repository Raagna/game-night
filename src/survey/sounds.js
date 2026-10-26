// Survey Says! sound effects for the TV screen, synthesized with Web Audio: no audio files, and nothing taken
// from the TV show. The tune on the winners screen is original.
import { useEffect, useRef, useState } from "react";
import { audioContext } from "../shared";

// ---------- Mute ----------
const MUTE_KEY = "gameNight.survey.muted";
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } })();
const listeners = new Set();
let master = null;
function output() {
  const ctx = audioContext();
  if (!ctx) return null;
  if (!master || master.context !== ctx) { master = ctx.createGain(); master.connect(ctx.destination); }
  master.gain.value = muted ? 0 : 1;
  return { ctx, out: master };
}
export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(MUTE_KEY, value ? "1" : "0"); } catch {}
  if (master) master.gain.setTargetAtTime(value ? 0 : 1, master.context.currentTime, 0.02);
  listeners.forEach((listener) => listener(value));
}
// [muted, toggle, waiting]: waiting is true while the browser still blocks sound (nobody has tapped the page).
export function useSound() {
  const [isMuted, setIsMuted] = useState(muted), [waiting, setWaiting] = useState(() => audioContext()?.state !== "running");
  useEffect(() => {
    listeners.add(setIsMuted);
    const ctx = audioContext(), check = () => setWaiting(ctx?.state !== "running");
    ctx?.addEventListener?.("statechange", check);
    check();
    return () => { listeners.delete(setIsMuted); ctx?.removeEventListener?.("statechange", check); };
  }, []);
  return [isMuted, () => { audioContext(); setMuted(!muted); }, waiting];
}

// ---------- Building blocks ----------
// An oscillator with a quick attack and an exponential fade, starting `at` seconds from now.
function note(ctx, out, { freq, at = 0, dur = 0.2, type = "sine", gain = 0.1, attack = 0.005, filter }) {
  const t = ctx.currentTime + at, osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let chain = osc;
  if (filter) { const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = filter; chain = osc.connect(lp); }
  chain.connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}
let noiseBuffer = null;
function noise(ctx, out, { at = 0, dur = 0.1, gain = 0.1, highpass = 1000 }) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at, src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), amp = ctx.createGain();
  src.buffer = noiseBuffer;
  hp.type = "highpass"; hp.frequency.value = highpass;
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(amp).connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
}
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// ---------- Effects ----------
// Wrong answer: a low, harsh two-tone buzzer held for most of a second.
export function playBuzz() {
  const sound = output();
  if (!sound || muted) return;
  const { ctx, out } = sound;
  for (const freq of [92, 97.5]) note(ctx, out, { freq, dur: 0.85, type: "sawtooth", gain: 0.11, attack: 0.01, filter: 1500 });
  note(ctx, out, { freq: 46, dur: 0.85, type: "square", gain: 0.05, attack: 0.01, filter: 600 });
}

// Answer on the board: a bright bell, then a quick run of ticks that grows with the answer's points.
export function playDing(points = 20) {
  const sound = output();
  if (!sound || muted) return;
  const { ctx, out } = sound;
  // Inharmonic partials are what make a struck bell sound like a bell rather than a beep.
  [[1, 0.16, 1.4], [2.76, 0.06, 0.7], [5.4, 0.03, 0.35], [8.93, 0.015, 0.2]].forEach(([ratio, gain, dur]) =>
    note(ctx, out, { freq: 1318.5 * ratio, dur, gain, attack: 0.002 }));
  const ticks = Math.max(2, Math.min(12, Math.round(points / 6)));
  for (let i = 0; i < ticks; i++) note(ctx, out, { freq: 1568 + i * 40, at: 0.28 + i * 0.045, dur: 0.035, type: "square", gain: 0.035, filter: 4000 });
}

// A team banks the round: a short rising fanfare.
export function playRoundWon() {
  const sound = output();
  if (!sound || muted) return;
  const { ctx, out } = sound;
  [72, 76, 79, 84].forEach((midi, i) => {
    note(ctx, out, { freq: hz(midi), at: i * 0.11, dur: i === 3 ? 0.6 : 0.16, type: "square", gain: 0.06, filter: 2800 });
    note(ctx, out, { freq: hz(midi - 12), at: i * 0.11, dur: i === 3 ? 0.6 : 0.16, type: "triangle", gain: 0.06 });
  });
  noise(ctx, out, { at: 0.33, dur: 0.5, gain: 0.04, highpass: 6000 });
}

// ---------- Winners tune ----------
// An original, upbeat 8-bar tune (C major, 150 bpm): brassy lead, oom-pah bass, off-beat chords and drums.
// Plays once (about 13 seconds) and rings out on the last chord.
const BEAT = 0.4;
// [midi note or null for a rest, beats]
const MELODY = [
  [67, .5], [72, .5], [76, 1], [79, 1], [76, 1],
  [77, .5], [76, .5], [74, .5], [72, .5], [69, 1], [72, 1],
  [74, 1], [79, .5], [77, .5], [76, 1], [74, 1],
  [76, .5], [74, .5], [72, 1], [67, 1], [null, 1],
  [69, .5], [72, .5], [76, 1], [81, 1], [79, 1],
  [77, .5], [79, .5], [81, 1], [77, 1], [72, 1],
  [71, .5], [74, .5], [79, 1], [81, .5], [83, .5], [86, 1],
  [84, 3], [null, 1],
];
// Chord root and triad for each bar: C F G C Am F G C.
const BARS = [[48, [60, 64, 67]], [53, [60, 65, 69]], [55, [59, 62, 67]], [48, [60, 64, 67]], [45, [57, 60, 64]], [53, [60, 65, 69]], [55, [59, 62, 67]], [48, [60, 64, 67]]];

export function playWinnersTune() {
  const sound = output();
  if (!sound || muted) return () => {};
  const { ctx } = sound, tune = ctx.createGain();
  tune.gain.value = 0.9;
  tune.connect(sound.out);
  const start = 0.1;
  let t = start;
  for (const [midi, beats] of MELODY) {
    if (midi) {
      const dur = beats * BEAT * 0.92;
      note(ctx, tune, { freq: hz(midi), at: t, dur, type: "sawtooth", gain: 0.05, attack: 0.02, filter: 2600 });
      note(ctx, tune, { freq: hz(midi) * 1.004, at: t, dur, type: "square", gain: 0.025, attack: 0.02, filter: 1800 });
    }
    t += beats * BEAT;
  }
  BARS.forEach(([root, chord], bar) => {
    const barStart = start + bar * 4 * BEAT, last = bar === BARS.length - 1;
    for (let beat = 0; beat < 4; beat++) {
      const at = barStart + beat * BEAT;
      if (last && beat > 0) break;
      // Bass: root on the strong beats, the fifth in between; the last bar holds the root.
      note(ctx, tune, { freq: hz(beat % 2 ? root + 7 : root), at, dur: last ? 1.6 : BEAT * 0.8, type: "triangle", gain: 0.12 });
      if (beat % 2 === 0) note(ctx, tune, { freq: 120, at, dur: 0.18, gain: 0.18 }); // kick
      else noise(ctx, tune, { at, dur: 0.12, gain: 0.07, highpass: 1800 }); // snare
      noise(ctx, tune, { at: at + BEAT / 2, dur: 0.04, gain: 0.025, highpass: 7000 }); // hi-hat
      // Off-beat chord stabs.
      for (const tone of chord) note(ctx, tune, { freq: hz(tone), at: at + BEAT / 2, dur: 0.14, type: "square", gain: 0.012, filter: 2000 });
    }
    if (last) {
      for (const tone of chord) note(ctx, tune, { freq: hz(tone), at: barStart, dur: 1.8, type: "sawtooth", gain: 0.02, attack: 0.02, filter: 2200 });
      noise(ctx, tune, { at: barStart, dur: 1.4, gain: 0.05, highpass: 5000 }); // cymbal
    }
  });
  // Stop early (leaving the screen): fade out over a third of a second.
  return () => {
    const now = ctx.currentTime;
    tune.gain.cancelScheduledValues(now);
    tune.gain.setValueAtTime(tune.gain.value, now);
    tune.gain.linearRampToValueAtTime(0, now + 0.3);
    setTimeout(() => tune.disconnect(), 400);
  };
}

// ---------- Playing a game's events ----------
// Plays each new event from the server once. The events seen when the screen opens (a reload or reconnect)
// are only noted, so they don't replay.
export function useEventSounds(game, onEvent) {
  const seen = useRef(null);
  useEffect(() => {
    const events = game.events || [];
    const latest = events.length ? events[events.length - 1].id : 0;
    if (seen.current == null || latest < seen.current) { seen.current = latest; return; }
    for (const e of events) {
      if (e.id <= seen.current) continue;
      if (e.type === "strike") playBuzz();
      else if (e.type === "hit") playDing(e.points);
      else if (e.type === "roundWon") setTimeout(playRoundWon, 700);
      onEvent?.(e);
    }
    seen.current = latest;
  }, [game.events?.[game.events.length - 1]?.id]);
}
