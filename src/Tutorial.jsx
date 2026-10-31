// The shared pieces of a game's tutorial (its practice round): the coach banner that explains each step on the TV,
// the host controller and the phones, and the skip control. The server side is server/tutorial.js; the whole
// contract is in docs/tutorial.md.
//
// A game passes its coach: one entry per step id, each with the text for every place it shows.
//   { pick: { tv, phone, controller, skip }, ... }
// tv / phone / controller: a string, or ({ game, me, name }) => string. `me` is the phone's player id; name(id) is a
// player's name. controller falls back to tv. skip (optional): the host's skip button label on that step
// ("Start the game" once the practice is over).
import React from "react";
import { socket } from "./shared";

const nameIn = (game) => (id) => game.players?.find((player) => player.id === id)?.name || "A player";
function coachText(entry, place, context) {
  const text = entry?.[place] ?? (place === "controller" ? entry?.tv : null);
  return typeof text === "function" ? text(context) : text || "";
}
// "2 of 5 want to skip": votes from connected players, out of the connected players.
const tally = (tutorial) => `${tutorial.votes.length} of ${tutorial.connected} want to skip`;

// The skip control for this place. With a host: a button on the TV and the controller, and nothing on the phones.
// Without one: a vote on every phone (a second tap takes it back) and the count on the TV.
// A step's own label (the coach's `skip`, like "Start the game" at the end) makes the host's button the lit one.
export function TutorialSkip({ game, place, playerId, label }) {
  const tutorial = game.tutorial;
  if (!tutorial) return null;
  if (!game.hostless) {
    if (place === "phone") return <p className="tutorial-skip-note">The host can skip the practice.</p>;
    return <button type="button" className={(label ? "primary" : "secondary") + " tutorial-skip"} onClick={() => socket.emit("tutorial:skip", { code: game.code })}>{label || "Skip tutorial"}</button>;
  }
  const count = <p className="tutorial-tally" role="status">{tutorial.votes.length ? tally(tutorial) : "Vote on your phone to skip"}<small>Skips at {tutorial.needed}</small></p>;
  if (place !== "phone") return count;
  const voted = tutorial.votes.includes(playerId);
  return (
    <div className="tutorial-vote">
      <button type="button" className={"secondary tutorial-skip" + (voted ? " is-voted" : "")} aria-pressed={voted} onClick={() => socket.emit("tutorial:vote", { code: game.code, playerId })}>
        {voted ? "Undo skip vote" : "Skip tutorial"}
      </button>
      <p className="tutorial-tally" role="status">{tally(tutorial)}<small>Skips at {tutorial.needed}</small></p>
    </div>
  );
}

// The coach banner: "Practice round", what to do now, and the skip control. place: "tv", "phone" or "controller".
export function Coach({ game, coach, place, playerId, title = "Practice round · nothing scores" }) {
  if (!game.tutorial) return null;
  const entry = coach[game.tutorial.step];
  const text = coachText(entry, place, { game, me: playerId, name: nameIn(game) });
  return (
    <section className={`coach is-${place}`} aria-label="Tutorial">
      <div className="coach-body">
        <p className="coach-label">{title}</p>
        <p className="coach-text" aria-live="polite">{text}</p>
      </div>
      <TutorialSkip game={game} place={place} playerId={playerId} label={entry?.skip} />
    </section>
  );
}
