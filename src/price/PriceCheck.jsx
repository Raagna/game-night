// Price Check screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
import React, { useEffect, useState } from "react";
import { socket, ClueTimer } from "../shared";
import { LobbyJoin, JoinCorner, Departures } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, useEventSounds, playWinnersTune, playBuzz, playDing } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { playClue, playPop, playFact } from "../fib/sounds";
import SHOWCASE from "./showcase.json";
import "./price.css";
import Flap, { Brand, Money } from "../Flap";
import { CheckIcon } from "../survey/SurveySays";

// ---------- The packs ----------
// Real prices: public/data/prices-openprices.json, built from Open Prices by scripts/build-openprices-pack.py
// and fetched when setup opens. Showcase items: src/price/showcase.json, written for this project.
const PLAYED_KEY = "gameNight.price.played.v1";
const LENGTH_KEY = "gameNight.price.length.v1";
const LENGTHS = {
  short: { label: "Short", plan: ["bid", "higherLower", "bid", "priciest"], note: "Four rounds and the showcase, about 20 minutes." },
  classic: { label: "Classic", plan: ["bid", "higherLower", "bid", "priciest", "bid", "order", "bid", "grocery"], note: "Eight rounds and the showcase, about 35 minutes." },
};
const ROUND_NAMES = { bid: "Closest Bid", higherLower: "Higher or Lower", priciest: "Pick the Priciest", order: "Price Order", grocery: "Grocery Run", showcase: "The Showcase" };
const ROUND_RULES = {
  bid: "Bid on the price. Closest without going over wins.",
  higherLower: "Is the real price higher or lower than the one shown?",
  priciest: "Pick the most expensive of the three.",
  order: "Put them in order, cheapest first.",
  grocery: "Fill your cart as close to the budget as you can without going over.",
  showcase: "Bid on your showcase. Closest without going over wins.",
};
const readPlayed = () => { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY)) || []); } catch { return new Set(); } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-3000))); } catch {} };
const readLength = () => { try { return LENGTHS[localStorage.getItem(LENGTH_KEY)] ? localStorage.getItem(LENGTH_KEY) : "classic"; } catch { return "classic"; } };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

let packRequest = null;
function loadPack() {
  packRequest ||= fetch(`${import.meta.env.BASE_URL}data/prices-openprices.json`)
    .then((response) => { if (!response.ok) throw new Error("Couldn’t load the prices. Check your connection and try again."); return response.json(); })
    .then(({ imageBase, built, items }) => ({
      built,
      items: items.map(([id, name, brand, size, cents, receipts, month, image]) => ({ id, name, brand, size, cents, receipts, month, image: imageBase + image })),
    }))
    .catch((error) => { packRequest = null; throw error; });
  return packRequest;
}

// Products this browser hasn't played come first. `taken` keeps one product from appearing twice in a game.
function draw(pool, count, taken, test = () => true) {
  const played = readPlayed(), picks = [];
  for (const item of shuffle(pool).sort((a, b) => played.has(a.id) - played.has(b.id))) {
    if (picks.length === count) break;
    if (taken.has(item.id) || !test(item, picks)) continue;
    picks.push(item); taken.add(item.id);
  }
  return picks.length === count ? picks : null;
}
// Prices far enough apart to tell apart: each at least `gap` (as a fraction) from the others.
const apart = (gap) => (item, picks) => picks.every((other) => Math.abs(item.cents - other.cents) >= gap * Math.min(item.cents, other.cents));
function dealSegment(type, pool, taken) {
  if (type === "bid") { const [item] = draw(pool, 1, taken, (i) => i.cents >= 200) || []; return item && { type, item }; }
  if (type === "higherLower") { const items = draw(pool, 5, taken); return items && { type, items }; }
  if (type === "priciest") {
    const sets = [0, 1, 2].map(() => draw(pool, 3, taken, apart(0.25)));
    return sets.every(Boolean) && { type, sets };
  }
  if (type === "order") { const items = draw(pool, 4, taken, apart(0.2)); return items && { type, items }; }
  if (type === "grocery") {
    const items = draw(pool, 6, taken, (i) => i.cents >= 150 && i.cents <= 1200);
    if (!items) return null;
    // The budget is what a real handful of these costs, rounded up to the dollar, so a perfect cart exists.
    const handful = shuffle(items).slice(0, 3 + Math.floor(Math.random() * 2));
    return { type, items, budget: Math.ceil(handful.reduce((sum, i) => sum + i.cents, 0) / 100) * 100 };
  }
  return null;
}
// Two showcases, three items each, each item from a different kind.
function dealShowcases() {
  const items = shuffle(SHOWCASE.items.map(([name, cents, kind], i) => ({ id: `sc${i}`, name, cents, kind })));
  const used = new Set();
  return [0, 1].map(() => {
    const kinds = new Set(), bundle = [];
    for (const item of items) {
      if (bundle.length === 3) break;
      if (used.has(item.id) || kinds.has(item.kind)) continue;
      bundle.push(item); used.add(item.id); kinds.add(item.kind);
    }
    return bundle.map(({ kind, ...item }) => item);
  });
}
function dealGame(length, pool) {
  const taken = new Set();
  const segments = LENGTHS[length].plan.map((type) => dealSegment(type, pool, taken)).filter(Boolean);
  return { segments, showcases: dealShowcases(), ids: [...taken] };
}

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || "A player";
const points = (value) => (value || 0).toLocaleString();
export const money = (cents) => (cents == null ? "" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents >= 10000 ? 0 : 2, maximumFractionDigits: cents >= 10000 ? 0 : 2 })}`);
// "$4.99", "4,99", "1234" → cents.
export function parseMoney(value) {
  const clean = String(value || "").replace(/[$\s,]/g, "");
  if (!/^\d*\.?\d{0,2}$/.test(clean) || !/\d/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}
const ranked = (game) => [...game.players].sort((a, b) => b.score - a.score);
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th"}`;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const roundLabel = (game) => (game.round?.type === "showcase" ? "Finale" : `Round ${game.index + 1} of ${game.segmentCount}`);
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));

// The real prices for host controllers, caught when the module loads (as Fib or Fact does with its answers).
let lastSecret = null;
const secretListeners = new Set();
socket.on("price:secret", (secret) => { lastSecret = secret; secretListeners.forEach((listener) => listener(secret)); });
function useSecret(game) {
  const [secret, setSecret] = useState(lastSecret);
  useEffect(() => { secretListeners.add(setSecret); return () => secretListeners.delete(setSecret); }, []);
  return secret?.code === game.code && secret.index === game.index ? secret : null;
}

function useTvSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "segment") playClue();
    else if (e.type === "answered") playPop();
    else if (e.type === "allOver") playBuzz();
    else if (e.type === "reveal") (["bid", "grocery", "showcase"].includes(e.round) ? playFact : playDing)();
  });
}

// ---------- Setup ----------
export function PriceSetup({ onCreate }) {
  const [length, setLength] = useState(readLength),
    [pack, setPack] = useState(null),
    [deal, setDeal] = useState(null),
    [error, setError] = useState(""),
    [hostless, setHostless] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    loadPack().then((loaded) => { if (!live) return; setPack(loaded); setDeal(dealGame(length, loaded.items)); }, (e) => live && setError(e.message));
    return () => { live = false; };
  }, []);
  const choose = (id) => { setLength(id); try { localStorage.setItem(LENGTH_KEY, id); } catch {} if (pack) setDeal(dealGame(id, pack.items)); };
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed(deal.ids);
    onCreate({ game: "price", segments: deal.segments, showcases: deal.showcases, hostless }, (e) => { setBusy(false); setNotice(e); });
  };
  return (
    <main className="setup pc-setup">
      <BackToHub />
      <Brand text="PRICE CHECK" className="pc-brand" />
      <section className="setup-card">
        <div className="setup-top">
          <div>
            <h1>Set up Price Check</h1>
            <p className="muted">Real prices from real shop receipts. Everyone bids, guesses and fills carts on their phone, then the two leaders bid on a showcase.</p>
          </div>
        </div>
        <fieldset className="ws-fieldset">
          <legend>Game length</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Game length">
            {Object.entries(LENGTHS).map(([id, { label }]) => <button key={id} role="radio" aria-checked={length === id} onClick={() => choose(id)}>{label}</button>)}
          </div>
          <p className="muted sv-hint">{LENGTHS[length].note}</p>
        </fieldset>
        <div className="sv-questions-head">
          <h2>Rounds</h2>
          <button className="chip-btn" disabled={!pack} onClick={() => setDeal(dealGame(length, pack.items))}>New products</button>
        </div>
        {error ? <p className="notice" role="alert">{error} <button className="chip-btn" onClick={() => location.reload()}>Try again</button></p>
          : !deal ? <p className="muted sv-hint">Loading prices…</p>
          : (
            <ol className="sv-question-list pc-round-list">
              {deal.segments.map((segment, i) => (
                <li key={i}><span className="sv-q-round">Round {i + 1}</span><span className="sv-q-text">{ROUND_NAMES[segment.type]}</span><span className="muted">{ROUND_RULES[segment.type]}</span></li>
              ))}
              <li><span className="sv-q-round">Finale</span><span className="sv-q-text">{ROUND_NAMES.showcase}</span><span className="muted">The top two each bid on a bundle of big-ticket prizes.</span></li>
            </ol>
          )}
        <p className="muted sv-hint">
          Products stay hidden here so you can play too.{pack && ` ${pack.items.length.toLocaleString()} products in the pack.`}
        </p>
        <p className="muted sv-hint sv-credit">
          Prices from <a href="https://prices.openfoodfacts.org" target="_blank" rel="noreferrer">Open Prices</a>, an Open Food Facts project:
          what shoppers paid at US stores, under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>.
          Product photos from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>, CC BY-SA.
          Showcase prices are our own estimates of typical US prices.
        </p>
        <section className="game-options" aria-labelledby="pc-options-title">
          <h2 id="pc-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The game runs itself: 25 seconds to bid, 40–50 for the bigger rounds, and the reveals move on by themselves. With a host, the host controller shows every real price and moves the reveals along.</small></span>
          </label>
        </section>
        <div className="final-row">
          <p className="muted start-summary">{LENGTHS[length].label} · 2 to 8 players</p>
          <button className="primary" disabled={busy || !deal} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
    </main>
  );
}

// ---------- Shared pieces ----------
const SpeakerIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);
function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return (
    <button className="sv-sound" aria-pressed={!muted} onClick={toggle}>
      <SpeakerIcon off={muted} />
      {muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}
    </button>
  );
}
const Check = () => <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const XIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
const Arrow = ({ up }) => <svg className="pc-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d={up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
// A row's result cell: a lit check for the winner, red with an X for anyone over, a hollow cell otherwise.
const Mark = ({ won, over }) => <span className={`pc-mark${won ? " is-won" : over ? " is-over" : ""}`} aria-hidden="true">{won ? <Check /> : over ? <XIcon /> : null}</span>;

// A product as it sits on the shelf: photo, brand, name and size, with an optional price tag on flaps. A tag of ""
// is a row of blank cells (the price is still hidden), so the real price clacks into them at the reveal.
function Product({ item, tag, small = false, children }) {
  return (
    <figure className={`pc-product${small ? " is-small" : ""}`}>
      <div className="pc-photo">{item.image ? <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true">?</span>}</div>
      <figcaption>
        {item.brand && <span className="pc-brandname">{item.brand}</span>}
        <span className="pc-name">{item.name}</span>
        {item.size && <span className="pc-size">{item.size}</span>}
        {tag != null && <span className={`pc-tag${tag ? "" : " is-blank"}`}><Money value={tag} cells={5} /></span>}
        {children}
      </figcaption>
    </figure>
  );
}

function Scoreboard({ game }) {
  const round = game.round, waiting = round?.phase === "answer" ? round.answered : null, awards = round?.awards || {};
  return (
    <section className="fib-scoreboard" aria-label="Scores">
      <h2>Scores</h2>
      <ol>
        {ranked(game).map((player) => (
          <li key={player.id} className={`${player.connected ? "" : "is-away"}${waiting?.includes(player.id) ? " is-done" : ""}`}>
            <span className="fib-sb-name">{player.name}{!player.connected && <small> · reconnecting</small>}</span>
            {waiting && <span className="fib-sb-check" aria-label={waiting.includes(player.id) ? "locked in" : "still going"}>{waiting.includes(player.id) && <CheckIcon />}</span>}
            {awards[player.id] && <span className="pc-gain"><span aria-hidden="true">+</span><Flap text={points(awards[player.id].points)} label={`plus ${points(awards[player.id].points)}`} intro /></span>}
            <Money value={points(player.score)} />
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- What the TV shows for each round ----------
function BidStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  const bids = reveal ? Object.entries(round.bids || {}).sort((a, b) => b[1] - a[1]) : [];
  return (
    <div className="pc-bid">
      <Product item={round.item} tag={reveal ? money(round.item.cents) : ""} />
      {round.below != null && !reveal && <p className="pc-callout is-over"><Mark over /><span className="label">Everyone went over · bid under</span><Money value={money(round.below)} /></p>}
      {reveal && (
        <ol className="pc-bids">
          {bids.map(([id, bid]) => {
            const over = bid > round.item.cents, won = round.results.winners.includes(id);
            return <li key={id} className={won ? "is-won" : over ? "is-over" : ""}><Mark won={won} over={over} /><span className="pc-row-name">{nameOf(game, id)}</span><Money value={money(bid)} cells={6} /><em>{won ? (bid === round.item.cents ? "Exact!" : "Closest") : over ? "Over" : ""}</em></li>;
          })}
          {!bids.length && <li className="muted">Nobody bid</li>}
        </ol>
      )}
    </div>
  );
}
function HigherLowerStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  return (
    <ul className="pc-shelf count-5 pc-hl-shelf">
      {round.items.map((item, i) => (
        <li key={item.id}>
          <Product item={item} small tag={money(item.shownCents)}>
            {reveal && <span className={`pc-verdict is-${round.results.truth[i]}`}><span className="pc-verdict-call"><Arrow up={round.results.truth[i] === "higher"} />{round.results.truth[i] === "higher" ? "Higher" : "Lower"}</span><Money value={money(item.cents)} /></span>}
          </Product>
        </li>
      ))}
    </ul>
  );
}
function PriciestStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  return (
    <>
      <p className="pc-callout"><Flap text={`Set ${round.set + 1} of ${round.setCount}`} /></p>
      <ul className="pc-shelf count-3">
        {round.items.map((item) => {
          const top = reveal && round.results.priciest === item.id;
          const pickers = reveal ? Object.entries(round.picks || {}).filter(([, pick]) => pick === item.id).map(([id]) => nameOf(game, id)) : [];
          return (
            <li key={item.id} className={top ? "is-lit" : reveal ? "is-dim" : ""}>
              <Product item={item} tag={reveal ? money(item.cents) : ""}>
                {reveal && <span className="pc-pickers">{top && <b>Priciest</b>}<span>{pickers.join(", ") || "Nobody picked it"}</span></span>}
              </Product>
            </li>
          );
        })}
      </ul>
    </>
  );
}
function OrderStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal", items = byId(round.items);
  const shelf = reveal ? round.results.truth.map((id) => items[id]) : round.items;
  return (
    <>
      <ol className={`pc-shelf count-4${reveal ? " is-ordered" : ""}`}>
        {shelf.map((item, i) => <li key={item.id}>{reveal && <span className="pc-rank" aria-label={`number ${i + 1}`}><Flap text={String(i + 1)} /></span>}<Product item={item} small tag={reveal ? money(item.cents) : ""} /></li>)}
      </ol>
      {reveal && (
        <ul className="pc-placed">
          {Object.entries(round.results.placed).map(([id, n]) => <li key={id} className={n === 4 ? "is-won" : ""}><span className="pc-row-name">{nameOf(game, id)}</span><Flap text={`${n}/4`} label={`${n} of 4 in place`} /></li>)}
          {!Object.keys(round.results.placed).length && <li className="muted">Nobody answered</li>}
        </ul>
      )}
    </>
  );
}
function GroceryStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  const totals = reveal ? Object.entries(round.results.totals).sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <p className="pc-callout"><span className="label">Budget</span><Money value={money(round.budget)} /></p>
      <ul className="pc-shelf count-6">
        {round.items.map((item) => <li key={item.id}><Product item={item} small tag={reveal ? money(item.cents) : ""} /></li>)}
      </ul>
      {reveal && (
        <ol className={`pc-bids is-carts${totals.length > 4 ? " is-many" : ""}`}>
          {totals.map(([id, sum]) => {
            const won = round.results.winners.includes(id), over = sum > round.budget;
            return <li key={id} className={won ? "is-won" : over ? "is-over" : ""}><Mark won={won} over={over} /><span className="pc-row-name">{nameOf(game, id)}</span><Money value={money(sum)} cells={6} /><em>{won ? "Closest" : over ? "Over" : ""}</em></li>;
          })}
        </ol>
      )}
    </>
  );
}
function ShowcaseStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  return (
    <>
    <div className="pc-showcases">
      {round.contestants.map((id, i) => {
        const won = reveal && round.results.winners.includes(id), bid = reveal ? round.bids[id] : null;
        const over = reveal && bid != null && bid > round.totals[i], locked = round.bidIn.includes(id);
        return (
          <section key={id} className={`pc-showcase${won ? " is-won" : ""}${over ? " is-over" : ""}`}>
            <h2><span className="pc-showcase-num" aria-hidden="true">{i + 1}</span>{nameOf(game, id)}’s showcase</h2>
            <ul>{round.bundles[i].map((item) => <li key={item.id}><span>{item.name}</span><Money value={reveal ? money(item.cents) : ""} cells={4} /></li>)}</ul>
            {reveal ? (
              <dl>
                <div><dt>Bid</dt><dd>{bid == null ? <span className="pc-no-bid">No bid</span> : <Money value={money(bid)} />}</dd></div>
                <div><dt>Actual</dt><dd><Money value={money(round.totals[i])} /></dd></div>
                <div className="pc-diff"><dt>{over && <Mark over />}{over ? "Over by" : "Under by"}</dt><dd>{bid == null ? <span className="pc-no-bid">–</span> : <Money value={money(Math.abs(round.totals[i] - bid))} />}</dd></div>
              </dl>
            ) : <p className={`pc-status-line${locked ? " is-in" : ""}`}>{locked ? <><Mark won />Bid locked in</> : <><Mark />Bidding…</>}</p>}
            {won && <p className="pc-win"><Flap text={round.results.both ? "Wins both showcases!" : "Wins the showcase!"} wrap intro /></p>}
          </section>
        );
      })}
    </div>
    {reveal && !round.results.winners.length && <p className="pc-win is-none">{Object.keys(round.bids).length ? "Both went over. Nobody wins the showcase." : "No bids. Nobody wins the showcase."}</p>}
    </>
  );
}
const STAGES = { bid: BidStage, higherLower: HigherLowerStage, priciest: PriciestStage, order: OrderStage, grocery: GroceryStage, showcase: ShowcaseStage };

function Lobby({ game, onAction }) {
  const ready = game.players.filter((player) => player.connected).length >= 2;
  return (
    <div className="lobby fib-lobby pc-lobby">
      <h1>Join the game</h1>
      <LobbyJoin code={game.code} />
      <Departures
        head={["Player", "Status"]}
        cols="1fr 0.42fr"
        rows={game.players.map((player) => ({
          key: player.id,
          state: player.connected ? "ready" : "away",
          label: `${player.name}, ${player.connected ? "ready" : "reconnecting"}`,
          cells: [player.name, player.connected ? "Ready" : "Away"],
        }))}
        openCells={game.players.length < 8 ? ["— — —", "Waiting"] : null}
      />
      <p className="muted">{ready ? "Everyone bids on their phone. The top two bid on the showcase at the end." : "Price Check needs at least 2 players."}</p>
      <button className="primary" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
    </div>
  );
}

function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("100");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="sv-team-tools fib-player-tools">
      <label className="inline-field">Adjust scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            <Money value={points(player.score)} />
            <button className="chip-btn add" onClick={() => onAction("adjustScore", { playerId: player.id, amount: step })}>+{step}</button>
            <button className="chip-btn subtract" onClick={() => onAction("adjustScore", { playerId: player.id, amount: -step })}>−{step}</button>
            <button className="chip-btn danger" onClick={() => onAction("kickPlayer", { playerId: player.id })}>Kick</button>
          </li>
        ))}
        {!game.players.length && <li className="muted">No players yet</li>}
      </ul>
    </div>
  );
}
function RoundControls({ game, onAction }) {
  const last = game.round?.type === "showcase";
  return (
    <div className="sv-round-controls">
      {game.round && !last && <button className="chip-btn" onClick={() => onAction("skip")}>Skip this round</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>{last ? "End game" : "End game early"}</button>
    </div>
  );
}

export function PriceDisplay({ game, onAction }) {
  const round = game.round, Stage = round && STAGES[round.type];
  useTvSounds(game);
  useClockTicks(round?.phase === "answer" ? round.deadline : null, game.serverNow);
  const next = !game.hostless && round?.phase === "reveal" && !(round.type === "priciest" && round.set < round.setCount - 1);
  return (
    <main className="display pc">
      <SoundToggle />
      <header className="display-bar">
        <Brand text="PRICE CHECK" className="pc-brand" />
        {game.status !== "lobby" ? <JoinCorner code={game.code} /> : <span />}
        <ClueTimer deadline={round?.deadline} serverNow={game.serverNow} />
      </header>
      {game.status === "lobby" || !round ? <Lobby game={game} onAction={onAction} /> : (
        <div className="fib-stage">
          <div className="fib-center pc-center">
            <p className="sv-round-label pc-round-label"><Flap text={roundLabel(game)} /><Flap className="sv-multiplier" text={ROUND_NAMES[round.type]} /></p>
            <h1 className="pc-rule">{ROUND_RULES[round.type]}</h1>
            <Stage game={game} />
            {next && <button className="primary sv-next" onClick={() => onAction("next")}>{round.type === "showcase" ? "See final scores" : "Next round"}</button>}
          </div>
          <Scoreboard game={game} />
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools sv-host-tools">
          <summary>Host tools</summary>
          {game.status === "playing" && <RoundControls game={game} onAction={onAction} />}
          <PlayerTools game={game} onAction={onAction} />
        </details>
      )}
      {!game.hostless && (
        <a className="controller-link" href="?controller" onClick={(event) => { event.preventDefault(); sessionStorage.hostCode = game.code; window.open("?controller", "_blank"); }}>
          Open host controller
        </a>
      )}
    </main>
  );
}

// ---------- Player phone ----------
function useSend(game, playerId) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const send = (payload) => {
    setBusy(true); setError("");
    socket.timeout(5000).emit("price:answer", { code: game.code, playerId, ...payload }, (err, result) => {
      setBusy(false);
      if (err) setError("Couldn’t reach the game. Try again.");
      else if (!result?.ok) setError(result?.error || "That didn’t go through.");
    });
  };
  return [send, busy, error];
}
function Timer({ game }) { return <ClueTimer deadline={game.round.deadline} serverNow={game.serverNow} />; }

function BidForm({ game, playerId, label = "Your bid" }) {
  const [value, setValue] = useState(""), [send, busy, error] = useSend(game, playerId), amount = parseMoney(value);
  const below = game.round.below;
  return (
    <form className="final-form pc-bid-form" onSubmit={(e) => { e.preventDefault(); if (amount) send({ cents: amount }); }}>
      <div className="sv-guess-top"><span className={`sv-guess-label${below != null ? " is-over" : ""}`}>{below != null ? `Everyone went over! Bid under ${money(below)}` : label}</span><Timer game={game} /></div>
      <label className="pc-money-input"><span className="pc-dollar" aria-hidden="true">$</span><input autoFocus aria-label={label} inputMode="decimal" autoComplete="off" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary" disabled={!amount || busy}>{busy ? "Sending…" : amount ? `Lock in ${money(amount)}` : "Lock in my bid"}</button>
    </form>
  );
}
function HigherLowerForm({ game, playerId }) {
  const items = game.round.items, [calls, setCalls] = useState(() => items.map(() => null)), [send, busy, error] = useSend(game, playerId);
  const call = (i, value) => setCalls((list) => list.map((c, j) => (j === i ? value : c)));
  return (
    <div className="pc-form">
      <div className="sv-guess-top"><span className="sv-guess-label">Is the real price higher or lower?</span><Timer game={game} /></div>
      <ul className="pc-hl">
        {items.map((item, i) => (
          <li key={item.id}>
            <Product item={item} small tag={money(item.shownCents)} />
            <div className="pc-calls" role="radiogroup" aria-label={`${item.name}: higher or lower than ${money(item.shownCents)}`}>
              {["higher", "lower"].map((value) => <button key={value} role="radio" aria-checked={calls[i] === value} onClick={() => call(i, value)}>{value === "higher" ? "Higher" : "Lower"}<Arrow up={value === "higher"} /></button>)}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary" disabled={calls.some((c) => !c) || busy} onClick={() => send({ calls })}>{calls.some((c) => !c) ? `Call all five (${calls.filter(Boolean).length} of 5)` : "Lock in my calls"}</button>
    </div>
  );
}
function PriciestForm({ game, playerId }) {
  const [send, busy, error] = useSend(game, playerId);
  return (
    <div className="pc-form">
      <div className="sv-guess-top"><span className="sv-guess-label">Set {game.round.set + 1} of {game.round.setCount}: tap the priciest</span><Timer game={game} /></div>
      <ul className="pc-picks">
        {game.round.items.map((item) => <li key={item.id}><button disabled={busy} onClick={() => send({ pick: item.id })}><Product item={item} small /></button></li>)}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
function OrderForm({ game, playerId }) {
  const [order, setOrder] = useState([]), [send, busy, error] = useSend(game, playerId), items = game.round.items;
  const tap = (id) => setOrder((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  return (
    <div className="pc-form">
      <div className="sv-guess-top"><span className="sv-guess-label">Tap them cheapest first</span><Timer game={game} /></div>
      <ul className="pc-picks">
        {items.map((item) => {
          const place = order.indexOf(item.id);
          return <li key={item.id}><button aria-pressed={place >= 0} onClick={() => tap(item.id)}>{place >= 0 && <span className="pc-place">{place + 1}</span>}<Product item={item} small /></button></li>;
        })}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
      <div className="pc-form-row">
        <button className="secondary" disabled={!order.length} onClick={() => setOrder([])}>Start over</button>
        <button className="primary" disabled={order.length !== items.length || busy} onClick={() => send({ order })}>Lock in my order</button>
      </div>
    </div>
  );
}
function GroceryForm({ game, playerId }) {
  const [cart, setCart] = useState([]), [send, busy, error] = useSend(game, playerId);
  const tap = (id) => setCart((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  return (
    <div className="pc-form">
      <div className="sv-guess-top"><span className="sv-guess-label pc-budget-label">Fill your cart · budget <Money value={money(game.round.budget)} /></span><Timer game={game} /></div>
      <ul className="pc-picks">
        {game.round.items.map((item) => <li key={item.id}><button aria-pressed={cart.includes(item.id)} onClick={() => tap(item.id)}>{cart.includes(item.id) && <span className="pc-place"><Check /></span>}<Product item={item} small /></button></li>)}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary" disabled={!cart.length || busy} onClick={() => send({ cart })}>{cart.length ? `Check out ${cart.length} item${cart.length > 1 ? "s" : ""}` : "Put something in your cart"}</button>
    </div>
  );
}
function ShowcaseForm({ game, playerId }) {
  const round = game.round, mine = round.contestants.indexOf(playerId), [send, busy, error] = useSend(game, playerId);
  if (mine >= 0)
    return (
      <div className="pc-form">
        <ul className="pc-showcase-list">{round.bundles[mine].map((item) => <li key={item.id}>{item.name}</li>)}</ul>
        <BidForm game={game} playerId={playerId} label="Your showcase bid" />
      </div>
    );
  return (
    <div className="pc-form">
      <div className="sv-guess-top"><span className="sv-guess-label">Who’ll win the showcase?</span><Timer game={game} /></div>
      <div className="pc-calls is-big">{round.contestants.map((id) => <button key={id} disabled={busy} onClick={() => send({ winner: id })}>{nameOf(game, id)}</button>)}</div>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
const FORMS = { bid: BidForm, higherLower: HigherLowerForm, priciest: PriciestForm, order: OrderForm, grocery: GroceryForm, showcase: ShowcaseForm };

function PlayerAction({ game, playerId }) {
  const round = game.round;
  if (round.phase === "reveal") {
    const award = round.awards?.[playerId], place = ranked(game).findIndex((p) => p.id === playerId) + 1;
    return (
      <div className="fib-my-result">
        <p className="player-status">{award ? `+${points(award.points)} this round` : "No points this round."}</p>
        <p className="muted">You’re in {ordinal(place)} place. Eyes on the TV!</p>
      </div>
    );
  }
  if (round.answered.includes(playerId)) return <p className="player-status">Locked in. Waiting for everyone else…</p>;
  if (round.type === "showcase" && round.contestants.includes(playerId) && round.bidIn.includes(playerId)) return <p className="player-status">Bid locked in. Fingers crossed!</p>;
  const Form = FORMS[round.type];
  return <Form key={`${game.index}-${round.set ?? 0}-${round.rebids ?? 0}`} game={game} playerId={playerId} />;
}

export function PricePlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), round = game.round;
  const myTurn = round?.phase === "answer" && !round.answered.includes(playerId);
  useEffect(() => { if (myTurn) { try { navigator.vibrate?.(120); } catch {} } }, [myTurn, round?.type, round?.set]);
  if (!player) return <main className="player pc"><p className="status-card">You’re no longer in this game.</p></main>;
  return (
    <main className="player pc">
      <header className="player-bar">
        <Brand text="PRICE CHECK" className="pc-brand" />
        <span className="player-name">{player.name}</span>
      </header>
      <div className="player-score"><Money value={points(player.score)} /></div>
      {game.status === "lobby" || !round ? <p className="player-status">You’re in! The game starts when everyone’s here.</p> : (
        <>
          <p className="player-clue-meta">{roundLabel(game)} · {ROUND_NAMES[round.type]}</p>
          {round.type === "bid" && round.phase === "answer" && <Product item={round.item} />}
          <PlayerAction game={game} playerId={playerId} />
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
export function PriceController({ game, onAction }) {
  const round = game.round, secret = useSecret(game);
  const header = <header className="controller-bar"><Brand text="PRICE CHECK" className="pc-brand" /><Flap className="code-chip" text={game.code} label={`Game code ${game.code}`} /></header>;
  if (game.status === "lobby" || !round)
    return (
      <main className="controller pc">
        {header}
        <h1>Lobby</h1>
        <p className="muted">Start the game from the main screen once at least two players have joined.</p>
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
    );
  const items = round.type === "bid" ? [round.item] : round.type === "showcase" ? [] : round.items;
  const nextLabel = round.phase === "answer" ? "Stop the clock and reveal" : round.type === "showcase" ? "See final scores" : round.type === "priciest" && round.set < round.setCount - 1 ? "Next set" : "Next round";
  return (
    <main className="controller pc">
      {header}
      <p className="player-clue-meta">{roundLabel(game)} · {ROUND_NAMES[round.type]}</p>
      <div className="sv-ctrl-status" role="status"><b>{round.phase === "answer" ? `${round.answered.length} of ${game.players.filter((p) => p.connected).length} locked in` : "Reveal"}</b><span>{ROUND_RULES[round.type]}</span></div>
      <section className="pc-ctrl-prices">
        <h2>Real prices</h2>
        <ul>
          {items.map((item) => <li key={item.id}><span>{item.name}</span><Money value={money(secret?.prices?.[item.id])} /></li>)}
          {round.type === "showcase" && secret?.totals && round.contestants.map((id, i) => <li key={id}><span>{nameOf(game, id)}’s showcase</span><Money value={money(secret.totals[i])} /></li>)}
        </ul>
      </section>
      <button className="wide on" onClick={() => onAction("next")}>{nextLabel}</button>
      <RoundControls game={game} onAction={onAction} />
      <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
export function PriceEnd({ game, host, display, onAction }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const standings = ranked(game), top = standings.slice(0, 3), rest = standings.slice(3);
  const tie = standings.length > 1 && standings[0].score === standings[1].score;
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  const playAgain = () => {
    setBusy(true); setError("");
    loadPack().then((pack) => {
      const length = game.segmentCount > 4 ? "classic" : "short", deal = dealGame(length, pack.items);
      rememberPlayed(deal.ids);
      onAction("replay", { segments: deal.segments, showcases: deal.showcases });
    }, (e) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <main className="end pc">
      {display && <SoundToggle />}
      <Brand text="PRICE CHECK" className="pc-brand" />
      <h1><Flap text={!standings.length ? "Game over" : tie ? "It’s a tie!" : `${standings[0].name} wins!`} wrap intro /></h1>
      <ol className="podium">{top.map((p, i) => <li className={`place place-${i + 1}`} key={p.id}><span className="rank">{i + 1}</span><b>{p.name}</b><Flap className="money" text={points(p.score)} intro /></li>)}</ol>
      {rest.length > 0 && <ol className="remaining-players" start="4">{rest.map((p) => <li key={p.id}><span>{p.name}</span><Money value={points(p.score)} /></li>)}</ol>}
      {host ? (
        <div className="sv-end-buttons">
          <button className="primary" disabled={busy} onClick={playAgain}>{busy ? "Dealing products…" : "Play again with new products"}</button>
          {error && <p className="notice" role="alert">{error}</p>}
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="player-end"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
