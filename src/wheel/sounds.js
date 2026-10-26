// Spin & Solve sound effects for the TV screen, synthesized with Web Audio from the same building blocks and
// the same sound on/off switch as Survey Says!: no audio files, and nothing taken from the TV show.
import { useEffect, useRef } from "react";
import { output, note, noise, hz, isMuted, playBuzz, playTick } from "../survey/sounds";

const ready = () => { const sound = output(); return sound && !isMuted() ? sound : null; };
// An oscillator that glides from one pitch to another, for slides and swoops.
function slide(ctx, out, { from, to, at = 0, dur = 0.5, type = "sawtooth", gain = 0.08, filter = 2000 }) {
  const t = ctx.currentTime + at, osc = ctx.createOscillator(), amp = ctx.createGain(), lp = ctx.createBiquadFilter();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  lp.type = "lowpass"; lp.frequency.value = filter;
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  amp.gain.setValueAtTime(gain, t + dur * 0.8);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(lp).connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
// A struck bell: inharmonic partials over a bright fundamental.
function bell(ctx, out, freq, at = 0, gain = 0.12) {
  [[1, gain, 1.1], [2.76, gain * 0.35, 0.6], [5.4, gain * 0.18, 0.3]].forEach(([ratio, g, dur]) => note(ctx, out, { freq: freq * ratio, at, dur, gain: g, attack: 0.002 }));
}

// The pegs flicking the pointer as the wheel goes round: a short, dry click at each of `times` (seconds from
// now), all scheduled at once on the audio clock so they stay in step with the wheel and slow down with it.
export function playPegs(times) {
  const sound = ready();
  if (!sound) return;
  // While the wheel is fastest the pegs pass faster than a pointer could click: keep the clicks 30 ms apart.
  let last = -1;
  for (const at of times) {
    if (at - last < 0.03) continue;
    last = at;
    noise(sound.ctx, sound.out, { at, dur: 0.018, gain: 0.07, highpass: 2500 });
    note(sound.ctx, sound.out, { freq: 1900, at, dur: 0.02, type: "square", gain: 0.02, attack: 0.001, filter: 3500 });
  }
}
// A letter lighting up on the board: one ding per tile, timed to the tiles turning one after another.
export function playLetters(count, step = 0.35) {
  const sound = ready();
  if (!sound) return;
  for (let i = 0; i < count; i++) bell(sound.ctx, sound.out, hz(91), 0.15 + i * step, 0.1);
}
// A toss-up tile turning on its own: a soft blip.
export function playBlip() {
  const sound = ready();
  if (sound) note(sound.ctx, sound.out, { freq: hz(84), dur: 0.12, type: "triangle", gain: 0.06 });
}
// Bankrupt: a long falling slide that sags at the bottom.
export function playBankrupt() {
  const sound = ready();
  if (!sound) return;
  slide(sound.ctx, sound.out, { from: 420, to: 140, dur: 0.55, gain: 0.08 });
  slide(sound.ctx, sound.out, { from: 220, to: 70, at: 0.5, dur: 0.9, gain: 0.09, filter: 900 });
}
// Lose a Turn: two low, flat notes.
export function playLoseTurn() {
  const sound = ready();
  if (!sound) return;
  [hz(55), hz(50)].forEach((freq, i) => note(sound.ctx, sound.out, { freq, at: i * 0.22, dur: 0.3, type: "square", gain: 0.05, filter: 1200 }));
}
// Something special picked up (a gift, the Wild Card, the Million Dollar wedge) or a special wedge landed on.
export function playSparkle() {
  const sound = ready();
  if (!sound) return;
  [84, 88, 91, 96, 100].forEach((midi, i) => note(sound.ctx, sound.out, { freq: hz(midi), at: i * 0.06, dur: 0.25, type: "triangle", gain: 0.05 }));
  noise(sound.ctx, sound.out, { at: 0.05, dur: 0.4, gain: 0.025, highpass: 7000 });
}
// Somebody buzzed in on a toss-up.
export function playBuzzIn() {
  const sound = ready();
  if (sound) note(sound.ctx, sound.out, { freq: hz(76), dur: 0.35, type: "square", gain: 0.06, filter: 2500 });
}
// The speed-up starts: a bell rung three times.
export function playSpeedUpBell() {
  const sound = ready();
  if (!sound) return;
  for (let i = 0; i < 3; i++) bell(sound.ctx, sound.out, hz(88), i * 0.3, 0.13);
}
// A puzzle solved: a bright rising fanfare that lands on a held chord.
export function playSolve() {
  const sound = ready();
  if (!sound) return;
  const { ctx, out } = sound;
  [67, 72, 76, 79].forEach((midi, i) => {
    note(ctx, out, { freq: hz(midi), at: i * 0.1, dur: 0.14, type: "square", gain: 0.05, filter: 3000 });
    note(ctx, out, { freq: hz(midi + 12), at: i * 0.1, dur: 0.14, type: "triangle", gain: 0.04 });
  });
  for (const midi of [72, 76, 79, 84]) note(ctx, out, { freq: hz(midi), at: 0.42, dur: 0.9, type: "sawtooth", gain: 0.025, attack: 0.02, filter: 2600 });
  noise(ctx, out, { at: 0.42, dur: 0.8, gain: 0.04, highpass: 6000 });
}
// The bonus envelope opened on a miss: a slow, sad slide.
export function playSoClose() {
  const sound = ready();
  if (!sound) return;
  [[hz(67), hz(66)], [hz(66), hz(65)], [hz(65), hz(58)]].forEach(([from, to], i) => slide(sound.ctx, sound.out, { from, to, at: i * 0.4, dur: i === 2 ? 0.9 : 0.36, type: "triangle", gain: 0.07 }));
}

// Plays each new event from the server once, in order. Events already there when the screen opened (a reload
// or reconnect) are only noted, so they don't replay.
export function useWheelSounds(game) {
  const seen = useRef(null), latest = game.events?.at(-1)?.id || 0;
  useEffect(() => {
    if (seen.current == null || latest < seen.current) { seen.current = latest; return; }
    for (const e of game.events || []) if (e.id > seen.current) playEvent(e);
    seen.current = latest;
  }, [latest]);
}
const SPECIAL_LANDINGS = new Set(["gift", "million", "mystery", "express"]);
function playEvent(e) {
  switch (e.type) {
    case "land":
      if (e.kind === "bankrupt") playBankrupt();
      else if (e.kind === "loseTurn") playLoseTurn();
      else if (SPECIAL_LANDINGS.has(e.kind) || e.wild) playSparkle();
      break;
    // The board turns the letters one after another (at most 2.4 s for the lot); a ding goes with each.
    case "hit": playLetters(e.count, Math.min(0.35, 2.4 / Math.max(1, e.count))); break;
    case "bonusLetters": playLetters(e.found.length, 0.35); break;
    case "miss": case "wrongSolve": case "timeout": playBuzz(); break;
    case "bankrupt": playBankrupt(); break;
    case "mysteryFlip": if (e.won) playSolve(); else playBankrupt(); break;
    case "gift": case "million": case "wild": playSparkle(); break;
    case "tile": playBlip(); break;
    case "buzz": playBuzzIn(); break;
    case "speedUp": playSpeedUpBell(); break;
    case "solve": playSolve(); break;
    case "envelope": if (e.solved) playSolve(); else playSoClose(); break;
    default:
  }
}

// Ticks for the last few seconds of a clock (all ten of the bonus round's), counted from the server's deadline.
export function useClockTicks(deadline, serverNow, seconds = 3) {
  useEffect(() => {
    if (!deadline) return;
    const end = Date.now() + (deadline - serverNow);
    const timers = Array.from({ length: seconds }, (_, i) => i + 1)
      .filter((n) => end - n * 1000 - Date.now() > -200)
      .map((n) => setTimeout(() => playTick(n === 1), end - n * 1000 - Date.now()));
    return () => timers.forEach(clearTimeout);
  }, [deadline]);
}
