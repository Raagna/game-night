// Game Night: the site's main page. Hosts pick a game to set up; players with a code can join from here
// (most players skip this page entirely by scanning the QR code on the host's screen).
import React, { useState } from "react";

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
  {
    id: "wheel",
    name: "Spin & Solve",
    tag: "2–6 players",
    blurb: "Spin the wheel, call a letter and cash in for every time it shows up. Buy vowels, dodge Bankrupt, and solve the puzzle to bank the round.",
    className: "hub-card--wheel",
  },
];

export function BackToHub() {
  return <a className="back-to-hub" href="./">← Game Night</a>;
}

function JoinBox() {
  const [code, setCode] = useState("");
  const go = (event) => {
    event.preventDefault();
    if (code.trim()) location.assign(`?join=${encodeURIComponent(code.trim())}`);
  };
  return (
    <form className="hub-join" onSubmit={go}>
      <label htmlFor="hub-code">
        <b>Joining a game?</b>
        <span>Scan the QR code on the main screen, or type its code.</span>
      </label>
      <div className="hub-join-row">
        <input
          id="hub-code"
          className="code-input"
          value={code}
          maxLength="6"
          placeholder="CODE"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="go"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="primary" disabled={!code.trim()}>Join</button>
      </div>
    </form>
  );
}

export default function Hub() {
  return (
    <main className="hub">
      <header className="hub-header">
        <div className="brand hub-brand">GAME NIGHT</div>
        <p className="muted">Party games for a TV and everyone’s phones.</p>
      </header>
      <JoinBox />
      <h2 className="hub-section">Host a game</h2>
      <p className="muted hub-section-note">Open this on the screen everyone can see, then players scan the QR code to join.</p>
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
