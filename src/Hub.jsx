// Game Night: the site's main page, built as the departure board. Each game is a row (its lamp, its name on
// flaps, how many play, and a Set up cell); players with a code key it into the six cells under the board (most
// players skip this page entirely by scanning the QR code on the host's screen).
import React, { useState } from "react";
import Flap, { Brand } from "./Flap";

const GAMES = [
  {
    id: "jeopardy",
    name: "Jeoparty!",
    tag: "Up to 6 players",
    blurb: "Every season of the show built in, plus your own boards. Buzz in from your phone, wager on Daily Doubles, finish with Final Jeoparty or Fast Money.",
  },
  {
    id: "survey",
    name: "Survey Says!",
    tag: "Two teams · up to 12 players",
    blurb: "We asked 100 people… Face off for control, guess the top answers, and don’t get three strikes — or the other team steals the points.",
  },
  {
    id: "wheel",
    name: "Spin & Solve",
    tag: "2–6 players, or teams of up to 12",
    blurb: "Spin the wheel, call a letter and cash in for every time it shows up. Buy vowels, dodge Bankrupt, and solve the puzzle to bank the round.",
  },
  {
    id: "fib",
    name: "Fib or Fact",
    tag: "2–8 players",
    blurb: "Write a fake answer to a real Jeopardy clue, then spot the real one among everyone’s fakes. Score for finding the fact — and for every friend your fib fools.",
  },
  {
    id: "price",
    name: "Price Check",
    tag: "2–8 players",
    blurb: "Bid on real products at real store prices — closest without going over wins. Call prices higher or lower, fill a cart on a budget, then the leaders bid on a showcase.",
  },
  {
    id: "tongue",
    name: "Tip of the Tongue",
    tag: "Teams of two · up to 12 players",
    blurb: "One partner sees the word, the other guesses. Clue as many as you can in 45 seconds — and clear all seven for a bonus on every second left.",
  },
  {
    id: "budget",
    name: "Word Budget",
    tag: "Two teams · 4–16 players",
    blurb: "Five words, one budget. Bid down to the fewest clue words you need, then get your team to say all five while the other side counts every word. Blow it and they can steal.",
  },
];

// The arrow, drawn in the same stroke as the table glyphs.
export function Arrow({ back = false }) {
  return (
    <svg className="arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={back ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BackToHub() {
  return <a className="back-to-hub" href="./"><Arrow back /> Game Night</a>;
}

// Six flap cells for a game code. The real input sits over the cells, so typing, pasting and the phone's keyboard
// all work; each letter flips into its cell.
export function CodeEntry({ id, value, onChange, describedBy, autoFocus = false }) {
  return (
    <div className={"code-entry" + (value.length >= 6 ? " is-full" : "")} style={{ "--at": Math.min(value.length, 5) }}>
      <input
        id={id}
        aria-describedby={describedBy}
        value={value}
        maxLength="6"
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="go"
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/\s+/g, ""))}
      />
      <Flap text={value} cells={6} />
      <span className="code-at" aria-hidden="true" />
    </div>
  );
}

// Under the board: key in a code and join.
function JoinBox() {
  const [code, setCode] = useState("");
  const go = (event) => {
    event.preventDefault();
    if (code.trim()) location.assign(`?join=${encodeURIComponent(code.trim())}`);
  };
  return (
    <form className="hub-join" onSubmit={go}>
      <p className="hub-join-note" id="hub-code-note"><b>Joining a game?</b> Scan the QR code on the main screen, or key in its code.</p>
      <label className="sr-only" htmlFor="hub-code">Game code</label>
      <CodeEntry id="hub-code" value={code} onChange={setCode} describedBy="hub-code-note" />
      <button className="primary" disabled={!code.trim()}>Join</button>
    </form>
  );
}

export default function Hub() {
  return (
    <main className="hub">
      <header className="hub-head">
        <h1 id="hub-title" className="sr-only">Game Night</h1>
        <Brand text="GAME NIGHT" className="hub-title" intro />
        <p className="hub-tagline">Party games for a TV and everyone’s phones</p>
      </header>
      <section className="hub-board" aria-labelledby="hub-board-title">
        <h2 id="hub-board-title" className="sr-only">Host a game on this screen</h2>
        <div className="hub-cols label" aria-hidden="true"><span>Game</span><span>Players</span></div>
        <ul className="hub-rows">
          {GAMES.map((game) => (
            <li key={game.id}>
              <a className={`hub-row row--${game.id}`} href={`?host&game=${game.id}`} aria-label={`Set up ${game.name}, ${game.tag}`}>
                <i className="lamp" aria-hidden="true" />
                <Flap className="hub-name" text={game.name} cells={17} />
                <span className="hub-count">{game.tag}</span>
                <span className="hub-go"><span className="hub-go-text">Set up</span><Arrow /></span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <JoinBox />
      <section className="instruction-card" aria-labelledby="how-title">
        <div>
          <h2 id="how-title">How to play</h2>
          <ol>
            <li><span><b>Open Game Night on the screen everyone can see</b> — a TV, a laptop or a projector — and set up a game.</span></li>
            <li><span><b>Everyone joins on their phone</b> by scanning the QR code in the lobby, or keying in its code here. No app, no account.</span></li>
            <li><span><b>Play with a host or without one.</b> A host runs the game from the controller on their phone; without one, the game runs itself.</span></li>
          </ol>
        </div>
        <div>
          <h2>The games</h2>
          <dl>
            {GAMES.map((game) => (
              <div key={game.id} className={`row--${game.id}`}>
                <dt>{game.name} <small>{game.tag}</small></dt>
                <dd>{game.blurb}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
