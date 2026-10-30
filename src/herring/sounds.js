// Red Herring sound effects for the TV screen, synthesized with Web Audio like the other games' (and sharing their
// sound on/off switch): a clock-tower bell for nightfall, a low sting for a body, a gavel for the trial.
import { output, isMuted, note, noise, hz, playDing, playRoundWon, useEventSounds } from "../survey/sounds";

const sound = () => { const s = output(); return s && !isMuted() ? s : null; };

// Night falls: two slow bell tolls, a fifth below each other.
export function playNightfall() {
  const s = sound();
  if (!s) return;
  [[45, 0], [40, 1.3]].forEach(([midi, at]) => {
    note(s.ctx, s.out, { freq: hz(midi), at, dur: 2.6, type: "sine", gain: 0.14, attack: 0.01 });
    note(s.ctx, s.out, { freq: hz(midi) * 2.76, at, dur: 1.4, type: "sine", gain: 0.035, attack: 0.01 });
    note(s.ctx, s.out, { freq: hz(midi) * 5.4, at, dur: 0.6, type: "sine", gain: 0.015, attack: 0.005 });
  });
}
// A body is found: a low cluster that swells and a high string scrape over it.
export function playBody() {
  const s = sound();
  if (!s) return;
  [36, 37, 43].forEach((midi) => note(s.ctx, s.out, { freq: hz(midi), dur: 2.2, type: "sawtooth", gain: 0.05, attack: 0.25, filter: 600 }));
  note(s.ctx, s.out, { freq: hz(88), at: 0.15, dur: 1.2, type: "triangle", gain: 0.03, attack: 0.3 });
}
// An attack foiled, or a quiet night: a small rising chime.
export function playRelief() {
  const s = sound();
  if (!s) return;
  [72, 76, 79, 84].forEach((midi, i) => note(s.ctx, s.out, { freq: hz(midi), at: i * 0.09, dur: 0.6, type: "triangle", gain: 0.05 }));
}
// A clue pinned up: a typewriter clack and a bell.
export function playClue() {
  const s = sound();
  if (!s) return;
  [0, 0.08, 0.15].forEach((at) => noise(s.ctx, s.out, { at, dur: 0.03, gain: 0.08, highpass: 2500 }));
  setTimeout(() => playDing(25), 260);
}
// A lab sample finished: a soft bubble.
export function playSample() {
  const s = sound();
  if (!s) return;
  note(s.ctx, s.out, { freq: hz(79), dur: 0.12, type: "sine", gain: 0.04 });
  note(s.ctx, s.out, { freq: hz(86), at: 0.06, dur: 0.1, type: "sine", gain: 0.03 });
}
// A contaminated sample: a sour, sliding buzz.
export function playContaminated() {
  const s = sound();
  if (!s) return;
  [56, 55, 54].forEach((midi, i) => note(s.ctx, s.out, { freq: hz(midi), at: i * 0.16, dur: 0.22, type: "square", gain: 0.04, filter: 1200 }));
}
// The gavel: three wooden knocks.
export function playGavel(knocks = 3) {
  const s = sound();
  if (!s) return;
  for (let i = 0; i < knocks; i++) {
    note(s.ctx, s.out, { freq: hz(50), at: i * 0.32, dur: 0.12, type: "triangle", gain: 0.2, attack: 0.002 });
    noise(s.ctx, s.out, { at: i * 0.32, dur: 0.04, gain: 0.12, highpass: 800 });
  }
}
// A vote is cast: a short tick.
export function playVote() {
  const s = sound();
  if (!s) return;
  note(s.ctx, s.out, { freq: hz(84), dur: 0.05, type: "square", gain: 0.03, filter: 3000 });
}
// Jailed: a heavy cell door. Released: an open, unresolved pair of notes.
export function playJailed() {
  const s = sound();
  if (!s) return;
  noise(s.ctx, s.out, { dur: 0.35, gain: 0.16, highpass: 200 });
  note(s.ctx, s.out, { freq: hz(33), dur: 0.9, type: "sawtooth", gain: 0.09, filter: 300 });
  note(s.ctx, s.out, { freq: hz(64), at: 0.05, dur: 0.6, type: "square", gain: 0.02, filter: 1500 });
}
export function playReleased() {
  const s = sound();
  if (!s) return;
  [67, 66].forEach((midi, i) => note(s.ctx, s.out, { freq: hz(midi), at: i * 0.35, dur: 0.6, type: "triangle", gain: 0.05 }));
}

export function useHerringSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "night") playNightfall();
    else if (e.type === "body") playBody();
    else if (e.type === "foiled" || e.type === "quiet") playRelief();
    else if (e.type === "clue") setTimeout(playClue, 1800);
    else if (e.type === "sample") playSample();
    else if (e.type === "labDone") playDing(40);
    else if (e.type === "contaminated") playContaminated();
    else if (e.type === "trial") playGavel(3);
    else if (e.type === "voted") playVote();
    else if (e.type === "jailed") playJailed();
    else if (e.type === "caught") { playJailed(); setTimeout(playRoundWon, 900); }
    else if (e.type === "released" || e.type === "noTrial") playReleased();
    else if (e.type === "lastWords") playGavel(1);
  });
}
