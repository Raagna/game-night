// Fib or Fact sound effects for the TV screen, synthesized with Web Audio like the other games' (and sharing
// their sound on/off switch). Nothing here comes from a TV show.
import { output, isMuted, note, noise, hz, playDing, playRoundWon, useEventSounds } from "../survey/sounds";

// A fib or a vote arrives: a soft, short pop.
export function playPop() {
  const sound = output();
  if (!sound || isMuted()) return;
  const { ctx, out } = sound;
  note(ctx, out, { freq: 880, dur: 0.08, type: "triangle", gain: 0.07 });
  note(ctx, out, { freq: 1320, at: 0.05, dur: 0.1, type: "triangle", gain: 0.05 });
}

// A new clue: a quick rising sweep of notes.
export function playClue() {
  const sound = output();
  if (!sound || isMuted()) return;
  const { ctx, out } = sound;
  [67, 71, 74, 79].forEach((midi, i) => note(ctx, out, { freq: hz(midi), at: i * 0.06, dur: 0.18, type: "square", gain: 0.035, filter: 2400 }));
}

// Somebody fell for a fib: a sliding "wah-wah" that drops a little lower for each player fooled.
export function playFooled(voters = 1) {
  const sound = output();
  if (!sound || isMuted()) return;
  const { ctx, out } = sound;
  const steps = [62, 61, 60, 57 - Math.min(voters, 4)];
  steps.forEach((midi, i) => note(ctx, out, { freq: hz(midi), at: i * 0.3, dur: i === 3 ? 0.8 : 0.28, type: "sawtooth", gain: 0.06, attack: 0.03, filter: 900 }));
}

// The fact is revealed: a bell, then a short fanfare.
export function playFact() {
  playDing(30);
  setTimeout(playRoundWon, 450);
}

// The scores come up: a brushed cymbal swell.
export function playScores() {
  const sound = output();
  if (!sound || isMuted()) return;
  noise(sound.ctx, sound.out, { dur: 0.9, gain: 0.05, highpass: 5000 });
}

export function useFibSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "clue") playClue();
    else if (e.type === "fib" || e.type === "voted") playPop();
    else if (e.type === "fooled") playFooled(e.voters);
    else if (e.type === "fact") playFact();
    else if (e.type === "scores") playScores();
  });
}
