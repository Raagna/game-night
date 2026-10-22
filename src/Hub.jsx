// Game Night: the host's starting page, where they pick which game to set up.
import React from "react";
import { JOIN_URL } from "./shared";

const GAMES = [
  {
    id: "jeopardy",
    name: "Jeopardy!",
    tag: "Up to 6 players",
    blurb: "Every season of the show built in, plus your own boards. Buzz in from your phone, wager on Daily Doubles, finish with Final Jeopardy or Fast Money.",
    className: "hub-card--jeopardy",
  },
  {
    id: "survey",
    name: "Survey Says!",
    tag: "Two teams · up to 12 players",
    blurb: "We asked 100 people… Face off for control, guess the top answers, and don’t get three strikes — or the other team steals the points.",
    className: "hub-card--survey",
  },
];

export function BackToHub() {
  return <a className="back-to-hub" href="?host">← All games</a>;
}

export default function Hub() {
  return (
    <main className="hub">
      <header className="hub-header">
        <div className="brand hub-brand">GAME NIGHT</div>
        <p className="muted">Pick a game to host. Everyone else joins on their phone at <b>{JOIN_URL}</b>.</p>
      </header>
      <ul className="hub-games">
        {GAMES.map((game) => (
          <li key={game.id}>
            <a className={`hub-card ${game.className}`} href={`?host&game=${game.id}`}>
              <span className="hub-card-name">{game.name}</span>
              <span className="hub-card-tag">{game.tag}</span>
              <span className="hub-card-blurb">{game.blurb}</span>
              <span className="hub-card-go">Set up a game →</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
