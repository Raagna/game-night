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
  {
    id: "herring",
    name: "Red Herring",
    tag: "5–12 players",
    blurb: "A body at the manor, and one of the detectives did it. Everyone holds a secret alibi card; the killer has to lie, and the ledger on the TV counts every guest. Investigate, run the lab, and put a suspect on trial.",
  },
];

// Each game's row carries a small motif of its own show in the lamp cell, drawn in the colours of that game's look:
// the quiz board's gold dollar on a blue screen, the survey's numbered answer bars and strike, the wheel's wedges,
// a '70s sunrise, a price tag, word tiles, a fanned hand of cards, and a moon over a case file. The board itself stays
// a split-flap board; only the motif, the row's edge and its lit Set up cell change.
const MOTIFS = {
  jeopardy: <><rect x="2" y="3" width="20" height="18" rx="1" fill="#1d3ad6" /><rect x="2" y="3" width="20" height="18" rx="1" fill="none" stroke="#000" strokeOpacity=".5" /><text x="12" y="17.5" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="700" fontSize="15" fill="#f5c542">$</text></>,
  survey: <><rect x="1.5" y="3" width="21" height="7.5" rx="1" fill="#0f2a8a" stroke="#f2b33d" strokeWidth="1.2" /><circle cx="6" cy="6.75" r="2.4" fill="#f2b33d" /><rect x="1.5" y="13.5" width="13" height="7.5" rx="1" fill="#0f2a8a" stroke="#f2b33d" strokeWidth="1.2" /><path d="M17.5 14.5l4 5.5M21.5 14.5l-4 5.5" stroke="#e0473b" strokeWidth="2.2" strokeLinecap="round" /></>,
  wheel: <>{["#e8483f", "#f5a623", "#f2d43a", "#45c26b", "#2f8fe0", "#8b5cf6", "#ec4899", "#14b8a6"].map((color, i) => { const a = (i * Math.PI) / 4, b = ((i + 1) * Math.PI) / 4; return <path key={color} d={`M12 12L${12 + 10 * Math.cos(a)} ${12 + 10 * Math.sin(a)}A10 10 0 0 1 ${12 + 10 * Math.cos(b)} ${12 + 10 * Math.sin(b)}Z`} fill={color} />; })}<circle cx="12" cy="12" r="2.6" fill="#f5c542" stroke="#000" strokeOpacity=".4" /></>,
  fib: <><path d="M2 20a10 10 0 0 1 20 0" fill="none" stroke="#f08a3c" strokeWidth="3" /><path d="M6 20a6 6 0 0 1 12 0" fill="none" stroke="#e0607e" strokeWidth="3" /><path d="M10 20a2 2 0 0 1 4 0" fill="none" stroke="#a46ae0" strokeWidth="3" /></>,
  price: <><path d="M3 6.5l6-4h12v19H9l-6-4z" transform="rotate(-12 12 12)" fill="#f7c93c" stroke="#f05aa0" strokeWidth="1.4" strokeLinejoin="round" /><circle cx="7.6" cy="12.6" r="1.6" fill="#16171a" /><text x="15" y="15.5" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="700" fontSize="9" fill="#c2410c" transform="rotate(-12 12 12)">$</text></>,
  tongue: <><rect x="1.5" y="6" width="10" height="12" rx="1.2" fill="#f2b33d" /><rect x="12.5" y="6" width="10" height="12" rx="1.2" fill="#2f6fd6" /><path d="M4.5 14.5l2-6 2 6M5.2 12.6h2.6" stroke="#16171a" strokeWidth="1.3" fill="none" strokeLinecap="round" /><path d="M15.5 8.5h4M17.5 8.5v6" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" /></>,
  budget: <><rect x="3" y="5" width="11" height="15" rx="1.6" transform="rotate(-14 8.5 12.5)" fill="#ff5b6e" /><rect x="9" y="4" width="11" height="15" rx="1.6" transform="rotate(10 14.5 11.5)" fill="#ffd23f" stroke="#16171a" strokeWidth="1" /><text x="14.6" y="15.6" textAnchor="middle" fontFamily="Barlow Condensed, Arial Narrow, sans-serif" fontWeight="700" fontSize="8" fill="#16171a" transform="rotate(10 14.5 11.5)">5</text></>,
  herring: <><path d="M3 10h7l1.5 1.8H21V21H3z" fill="#e9e6dc" /><path d="M3 13h18" stroke="#b9b3a2" strokeWidth=".8" /><path d="M17.5 2.5a4.2 4.2 0 1 0 3.8 6 3.4 3.4 0 1 1-3.8-6z" fill="#b8c4f4" /></>,
};
function Motif({ id }) {
  return <svg className="hub-motif" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">{MOTIFS[id]}</svg>;
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
                <Motif id={game.id} />
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
                <dt>{game.name}</dt>
                <dd>{game.blurb}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
