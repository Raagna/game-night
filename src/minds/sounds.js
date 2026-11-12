// Great Minds sound effects for the TV screen, synthesized with Web Audio like the other games' (and sharing their
// sound on/off switch). Soft, bouncy and warm: marimba-ish notes, a snap when answers click together, and a little
// howl for the Lone Wolf. Nothing here comes from a TV show.
import { output, isMuted, note, noise, hz } from "../survey/sounds";

const play = (fn) => { const sound = output(); if (!sound || isMuted()) return; fn(sound.ctx, sound.out); };

// A new prompt: a rising three-note "ding-ding-ding".
export const playPrompt = () => play((ctx, out) => {
  [72, 76, 79].forEach((midi, i) => note(ctx, out, { freq: hz(midi), at: i * 0.09, dur: 0.35, type: "sine", gain: 0.09 }));
  [84, 88].forEach((midi, i) => note(ctx, out, { freq: hz(midi), at: 0.27 + i * 0.05, dur: 0.25, type: "triangle", gain: 0.03 }));
});

// Someone locked in an answer: a soft wooden blip.
export const playLockIn = () => play((ctx, out) => {
  note(ctx, out, { freq: hz(79), dur: 0.09, type: "triangle", gain: 0.08 });
  note(ctx, out, { freq: hz(86), at: 0.04, dur: 0.07, type: "sine", gain: 0.04 });
});

// Everyone's in: a quick drum roll before the first group.
export const playAllIn = () => play((ctx, out) => {
  for (let i = 0; i < 14; i++) noise(ctx, out, { at: i * 0.055, dur: 0.06, gain: 0.025 + i * 0.003, highpass: 1800 });
});

// A group comes up. One answer alone is a low, lonely plink; the bigger the group, the higher and fuller the chord.
export const playGroup = (size = 1, last = false) => play((ctx, out) => {
  if (size <= 1) { note(ctx, out, { freq: hz(55), dur: 0.5, type: "triangle", gain: 0.08 }); return; }
  const root = 60 + Math.min(size, 8) * 2, chord = [0, 4, 7, 12].slice(0, Math.min(4, size));
  chord.forEach((step, i) => note(ctx, out, { freq: hz(root + step), at: i * 0.05, dur: last ? 0.9 : 0.45, type: "sine", gain: 0.07 }));
  noise(ctx, out, { dur: 0.04, gain: 0.05, highpass: 3500 });
  if (last) [0, 7, 12, 16].forEach((step, i) => note(ctx, out, { freq: hz(root + 12 + step), at: 0.25 + i * 0.07, dur: 0.5, type: "triangle", gain: 0.035 }));
});

// Two groups merge: a snap, and a quick upward slide.
export const playSnap = () => play((ctx, out) => {
  noise(ctx, out, { dur: 0.03, gain: 0.12, highpass: 2500 });
  const osc = note(ctx, out, { freq: hz(67), at: 0.02, dur: 0.22, type: "triangle", gain: 0.08 });
  osc.frequency.exponentialRampToValueAtTime(hz(79), ctx.currentTime + 0.18);
});

// A merge idea turned down: two falling notes.
export const playNope = () => play((ctx, out) => {
  [67, 62].forEach((midi, i) => note(ctx, out, { freq: hz(midi), at: i * 0.14, dur: 0.18, type: "triangle", gain: 0.06 }));
});

// The Lone Wolf changes hands: a short, soft howl that slides up and falls away.
export const playHowl = () => play((ctx, out) => {
  const t = ctx.currentTime, osc = ctx.createOscillator(), amp = ctx.createGain(), lp = ctx.createBiquadFilter();
  osc.type = "sawtooth"; lp.type = "lowpass"; lp.frequency.value = 1300;
  osc.frequency.setValueAtTime(hz(57), t);
  osc.frequency.exponentialRampToValueAtTime(hz(69), t + 0.35);
  osc.frequency.setValueAtTime(hz(69), t + 0.8);
  osc.frequency.exponentialRampToValueAtTime(hz(60), t + 1.4);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.06, t + 0.2);
  amp.gain.setValueAtTime(0.06, t + 0.9);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  osc.connect(lp).connect(amp).connect(out);
  osc.start(t); osc.stop(t + 1.6);
});

// The scores lock: a bright little run.
export const playScores = () => play((ctx, out) => {
  [72, 74, 76, 79, 84].forEach((midi, i) => note(ctx, out, { freq: hz(midi), at: i * 0.06, dur: 0.22, type: "sine", gain: 0.06 }));
});
