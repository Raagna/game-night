// Game Night: the site's main page, built as a pinball cabinet's backglass. Hosts pick a game ("table") by
// lighting one of its lamps; players with a code key it into the dot-matrix strip below the glass (most
// players skip this page entirely by scanning the QR code on the host's screen).
import React, { useState } from "react";

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
];

// One drawn glyph per table, in the same stroke: the clue board, the survey board, the wheel, the two answers,
// the price tag, the speech bubbles.
function TableGlyph({ id }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" };
  return (
    <svg className="table-glyph" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      {id === "jeopardy" && <g {...common}>{[6, 19, 32].flatMap((x) => [8, 22].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="10" height="10" rx="1.5" />))}<path d="M8 40h32" /></g>}
      {id === "survey" && <g {...common}><rect x="6" y="7" width="36" height="34" rx="3" /><path d="M12 15h16M12 22h20M12 29h12" /><path d="M33 27l6 6M39 27l-6 6" /></g>}
      {id === "wheel" && <g {...common}><circle cx="24" cy="25" r="16" />{[0, 45, 90, 135].map((a) => <path key={a} d="M24 9v32" transform={`rotate(${a} 24 25)`} />)}<path d="M20 4h8l-4 5z" fill="currentColor" /></g>}
      {id === "tongue" && <g {...common}><path d="M8 10h20v14H17l-6 5v-5H8z" /><path d="M24 30v4h9l6 5v-5h3V20h-8" /><path d="M14 17h8" /></g>}
      {id === "price" && <g {...common}><path d="M6 24V8h16l20 20-14 14z" /><circle cx="14" cy="16" r="3" /><path d="M22 30l8-8" /></g>}
      {id === "fib" && <g {...common}><path d="M6 10h22v14H15l-6 5v-5H6z" /><path d="M20 28v6h13l6 5v-5h3V20h-8" /><path d="M14 15.5l4 4M18 15.5l-4 4" /><path d="M27 30l2.5 2.5L34 28" /></g>}
    </svg>
  );
}

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

// Under the glass: the dot-matrix strip. The code is keyed straight into the display, and JOIN is the lit lamp
// at its end.
function JoinBox() {
  const [code, setCode] = useState("");
  const go = (event) => {
    event.preventDefault();
    if (code.trim()) location.assign(`?join=${encodeURIComponent(code.trim())}`);
  };
  return (
    <form className="hub-join" onSubmit={go}>
      <p className="hub-join-note" id="hub-code-note"><b>Joining a game?</b> Scan the QR code on the main screen, or key in its code.</p>
      <div className="join-grille">
        <label className="sr-only" htmlFor="hub-code">Game code</label>
        <input
          id="hub-code"
          className="code-input"
          aria-describedby="hub-code-note"
          value={code}
          maxLength="6"
          placeholder="CODE"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="go"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="join-lamp" disabled={!code.trim()}>Join</button>
      </div>
    </form>
  );
}

export default function Hub() {
  return (
    <main className="hub">
      <section className="backglass" aria-labelledby="hub-title">
        <h1 id="hub-title" className="brand hub-title">GAME NIGHT</h1>
        <p className="hub-tagline">Party games for a TV and everyone’s phones. Light up a table to host it on this screen.</p>
        <ul className="hub-tables" aria-label="Host a game">
          {GAMES.map((game) => (
            <li key={game.id}>
              <a className={`table-lamp table-insert--${game.id}`} href={`?host&game=${game.id}`} aria-label={`Set up ${game.name}, ${game.tag}`}>
                <span className="lens"><TableGlyph id={game.id} /></span>
                <span className="lens-name">{game.name}</span>
                <span className="table-count">{game.tag}</span>
                <span className="table-arrow"><Arrow /></span>
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
            <li><b>Open Game Night on the screen everyone can see</b> — a TV, a laptop or a projector — and light up a table.</li>
            <li><b>Everyone joins on their phone</b> by scanning the QR code in the lobby, or keying in its code here. No app, no account.</li>
            <li><b>Play with a host or without one.</b> A host runs the game from the controller on their phone; without one, the game runs itself.</li>
          </ol>
        </div>
        <div>
          <h2>The tables</h2>
          <dl>
            {GAMES.map((game) => (
              <div key={game.id}>
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
