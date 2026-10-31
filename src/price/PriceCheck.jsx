// Price Check screens: host setup, the shared TV display, players' phones, the host controller and the final scores.
// The look is a bright '70s pricing-game showroom (price.css): marquee bulbs, price tags and big price readouts,
// not the split-flap board the rest of Game Night uses.
import React, { useEffect, useState } from "react";
import "@fontsource/barlow-condensed/700-italic.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "@fontsource/barlow-condensed/800.css";
import { socket, clockText } from "../shared";
import { QRCode, useJoinBase, joinLink, displayAddress } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, useEventSounds, playWinnersTune, playBuzz, playDing } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { playClue, playPop, playFact } from "../fib/sounds";
import { PRICE_TIMES, POINTS, PRICE_COUNTRIES, formatPrice } from "../../server/price.js";
import SHOWCASE from "./showcase.json";
import "./price.css";

// ---------- The packs ----------
// Real prices, one pack per country, built from Open Prices by scripts/build-openprices-pack.py and fetched when
// setup opens: public/data/prices-openprices.json (US shops, US dollars) and prices-openprices-ca.json (Canadian
// shops, Canadian dollars). Showcase items: src/price/showcase.json, written for this project, priced per country.
const PACK_FILES = { US: "prices-openprices.json", CA: "prices-openprices-ca.json" };
const COUNTRY_NOTES = {
  US: "What shoppers paid at US stores, in US dollars.",
  CA: "What shoppers paid at Canadian stores, in Canadian dollars. A smaller pack: Canadian receipts are newer to Open Prices.",
};
const PLAYED_KEY = "gameNight.price.played.v1";
const LENGTH_KEY = "gameNight.price.length.v1";
const COUNTRY_KEY = "gameNight.price.country.v1";
const LENGTHS = {
  short: { label: "Short", plan: ["bid", "higherLower", "bid", "priciest"], note: "Four rounds and the showcase, about 20 minutes." },
  classic: { label: "Classic", plan: ["bid", "higherLower", "bid", "priciest", "bid", "order", "bid", "grocery"], note: "Eight rounds and the showcase, about 40 minutes." },
};
const ROUND_NAMES = { bid: "Closest Bid", higherLower: "Higher or Lower", priciest: "Pick the Priciest", order: "Price Order", grocery: "Grocery Run", showcase: "The Showcase" };
const ROUND_RULES = {
  bid: "Bid on the price. Closest without going over wins.",
  higherLower: "Is the real price higher or lower than the one on the tag?",
  priciest: "Pick the most expensive of the three.",
  order: "Put them in order, cheapest first.",
  grocery: "Fill your cart as close to the budget as you can without going over.",
  showcase: "Bid on your showcase. Closest without going over wins.",
};
const ANSWER_MS = { bid: "bidMs", higherLower: "higherLowerMs", priciest: "priciestMs", order: "orderMs", grocery: "groceryMs", showcase: "showcaseMs" };
const secs = (key) => Math.round(PRICE_TIMES[key] / 1000);
const readPlayed = () => { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY)) || []); } catch { return new Set(); } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-3000))); } catch {} };
const readSetting = (key, options, fallback) => { try { const value = localStorage.getItem(key); return Object.hasOwn(options, value) ? value : fallback; } catch { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

const packRequests = {};
function loadPack(country) {
  packRequests[country] ||= fetch(`${import.meta.env.BASE_URL}data/${PACK_FILES[country]}`)
    .then((response) => { if (!response.ok) throw new Error("Couldn’t load the prices. Check your connection and try again."); return response.json(); })
    .then(({ imageBase, built, items }) => ({
      built,
      items: items.map(([id, name, brand, size, cents, receipts, month, image]) => ({ id, name, brand, size, cents, receipts, month, image: imageBase + image })),
    }))
    .catch((error) => { packRequests[country] = null; throw error; });
  return packRequests[country];
}

// Two products are alike when their names share a telling word ("eggs", "granola"), so a set of three isn't three
// cartons of eggs. Small packs (Canada's) need this most; if it can't be met, the deal falls back to any products.
const PLAIN_WORDS = new Set("organic original large medium small free range whole grain premium natural classic brown white dark value with flavour flavor style pure fresh mixed sweet light extra size pack family sans avec great".split(" "));
const wordsOf = (item) => new Set(item.name.toLowerCase().normalize("NFD").replace(/[^a-z ]/g, " ").split(" ").map((w) => w.replace(/s$/, "")).filter((w) => w.length >= 4 && !PLAIN_WORDS.has(w)));
const unlike = (item, picks) => { const mine = wordsOf(item); return picks.every((other) => ![...wordsOf(other)].some((w) => mine.has(w))); };
// Products this browser hasn't played come first. `taken` keeps one product from appearing twice in a game.
function draw(pool, count, taken, test = () => true) {
  const played = readPlayed(), order = shuffle(pool).sort((a, b) => played.has(a.id) - played.has(b.id));
  for (const strict of [true, false]) {
    const picks = [];
    for (const item of order) {
      if (picks.length === count) break;
      if (taken.has(item.id) || !test(item, picks) || (strict && !unlike(item, picks))) continue;
      picks.push(item);
    }
    if (picks.length === count) { picks.forEach((item) => taken.add(item.id)); return picks; }
  }
  return null;
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
// Two showcases, three items each, each item from a different kind, named and priced for the game's country.
function dealShowcases(country) {
  const items = shuffle(SHOWCASE.items.flatMap(({ kind, ...prices }, i) => (prices[country] ? [{ id: `sc${i}`, name: prices[country][0], cents: prices[country][1], kind }] : [])));
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
function dealGame(length, pool, country) {
  const taken = new Set();
  const segments = LENGTHS[length].plan.map((type) => dealSegment(type, pool, taken)).filter(Boolean);
  return { segments, showcases: dealShowcases(country), ids: [...taken] };
}

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || "A player";
const points = (value) => (value || 0).toLocaleString("en-US");
const price = (game, cents) => formatPrice(cents, game.country);
// "$4.99", "4,99", "1234" → cents.
export function parseMoney(value) {
  const clean = String(value || "").replace(/[$\s,]|[A-Z]{2}\$/gi, "");
  if (!/^\d*\.?\d{0,2}$/.test(clean) || !/\d/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}
const ranked = (game) => [...game.players].sort((a, b) => b.score - a.score);
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th"}`;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const roundLabel = (game) => (game.round?.type === "showcase" ? "Finale" : `Round ${game.index + 1} of ${game.segmentCount}`);
const byId = (items) => Object.fromEntries(items.map((item) => [item.id, item]));
// How long the current clock ran from the start, for the clock's ring.
function phaseMs(game) {
  const round = game.round;
  if (!round) return 0;
  if (round.phase === "answer") return PRICE_TIMES[ANSWER_MS[round.type]];
  if (round.type === "priciest" && round.set < round.setCount - 1) return PRICE_TIMES.priciestRevealMs;
  return round.type === "showcase" ? PRICE_TIMES.showcaseRevealMs : PRICE_TIMES.revealMs;
}

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

// ---------- Showroom pieces ----------
// The show's sign: the name in heavy italic capitals on a lit marquee.
function Sign({ small = false }) {
  return <div className={`pc-sign${small ? " is-small" : ""}`}><span className="pc-sign-text">Price<br />Check</span></div>;
}
// A price readout: the currency small, the amount big. Hidden prices show as question marks until the reveal.
function Readout({ cents, country, hidden = false, className = "" }) {
  const { symbol } = PRICE_COUNTRIES[country] || PRICE_COUNTRIES.US;
  const full = formatPrice(cents, country);
  return (
    <span className={`pc-readout${hidden ? " is-hidden" : ""}${className ? ` ${className}` : ""}`} role="img" aria-label={hidden ? "Price hidden" : full}>
      <small aria-hidden="true">{symbol}</small>
      <b aria-hidden="true">{hidden ? "?.??" : full.slice(symbol.length)}</b>
    </span>
  );
}
// A hanging price tag with a readout on it.
const Tag = ({ cents, country, hidden, className = "" }) => <span className={`pc-tag${className ? ` ${className}` : ""}`}><Readout cents={cents} country={country} hidden={hidden} /></span>;
const Check = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const XIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>;
const Arrow = ({ up }) => <svg className="pc-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d={up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
// Right, wrong, partly right, or no answer: a coloured stamp that also carries an icon and a word.
const KIND_ICON = { right: <Check />, wrong: <XIcon />, part: <Check />, miss: <span className="pc-dash" />, none: <span className="pc-dash" /> };
const Mark = ({ kind }) => <span className={`pc-mark is-${kind}`} aria-hidden="true">{KIND_ICON[kind]}</span>;
const Stamp = ({ kind, children }) => <span className={`pc-stamp is-${kind}`}><Mark kind={kind} />{children}</span>;

// A product on its showroom card: photo, brand, name and size, with an optional price tag.
function Product({ item, country, cents, hidden = false, small = false, className = "", children }) {
  const tag = hidden || cents != null;
  return (
    <figure className={`pc-product${small ? " is-small" : ""}${className ? ` ${className}` : ""}`}>
      <div className="pc-photo"><Photo src={item.image} /></div>
      <figcaption>
        {item.brand && <span className="pc-brandname">{item.brand}</span>}
        <span className="pc-name">{item.name}</span>
        {item.size && <span className="pc-size">{item.size}</span>}
        {tag && <Tag cents={cents} country={country} hidden={hidden} />}
        {children}
      </figcaption>
    </figure>
  );
}
// A product photo, or a big "?" when the product has none or it fails to load (the photos come from Open Food Facts).
function Photo({ src }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span aria-hidden="true">?</span>;
}
const Thumb = ({ item, kind }) => (
  <span className={`pc-thumb${kind ? ` is-${kind}` : ""}`} title={item.name}>
    <Photo src={item.image} />
    {kind && <Mark kind={kind} />}
  </span>
);

function Clock({ game }) {
  const deadline = game.round?.deadline, serverNow = game.serverNow, total = phaseMs(game);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const startedAt = Date.now(), startRemaining = Math.max(0, deadline - serverNow);
    const update = () => setRemaining(Math.max(0, startRemaining - (Date.now() - startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline, serverNow]);
  if (!deadline) return null;
  const seconds = Math.ceil(remaining / 1000), left = total ? Math.min(1, remaining / total) : 1;
  return (
    <div className={`pc-clock${seconds <= 10 ? " is-low" : ""}`} role="timer" aria-label={`${seconds} seconds left`} style={{ "--left": left }}>
      <b>{clockText(seconds)}</b>
    </div>
  );
}

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
// The small join corner for late arrivals: a QR code and the room code.
function JoinCorner({ code }) {
  const base = useJoinBase();
  return (
    <div className="pc-join-corner">
      <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} />
      <span><small>Join at {displayAddress(base)}</small><b aria-label={`code ${code.split("").join(" ")}`}>{code}</b></span>
    </div>
  );
}

// ---------- Who got what ----------
// One row per player for the reveal: their answer, a right/wrong kind, a word for it, how close, and the points
// it earned. Sorted best first. The TV shows every row; a phone shows its own.
function resultRows(game) {
  const round = game.round, awards = round.awards || {}, country = game.country;
  const earned = (id) => awards[id]?.points || 0;
  const rows = game.players.map((player) => ({ id: player.id, name: player.name, away: !player.connected }));
  const none = (row, word = "No answer") => Object.assign(row, { kind: "none", verdict: word, detail: "", points: 0, rank: [9, 0] });
  if (round.type === "bid") {
    const real = round.item.cents;
    for (const row of rows) {
      const bid = round.bids?.[row.id];
      if (bid == null) { none(row, "No bid"); continue; }
      const won = round.results.winners.includes(row.id), over = bid > real, gap = Math.abs(real - bid);
      Object.assign(row, {
        answer: <Readout cents={bid} country={country} />, answerText: formatPrice(bid, country),
        kind: won ? "right" : over ? "wrong" : "miss", verdict: won ? (gap === 0 ? "Exact!" : "Closest") : over ? "Over" : "Under",
        detail: gap === 0 ? "Right on the money" : over ? `Over by ${formatPrice(gap, country)}` : `${formatPrice(gap, country)} under`,
        points: earned(row.id), rank: [won ? 0 : over ? 2 : 1, gap],
      });
    }
  } else if (round.type === "higherLower") {
    const { truth, calls } = round.results;
    for (const row of rows) {
      const mine = calls?.[row.id];
      if (!mine) { none(row); row.calls = null; continue; }
      const right = mine.filter((call, i) => call === truth[i]).length;
      Object.assign(row, {
        calls: mine.map((call, i) => ({ call, right: call === truth[i] })),
        kind: right === truth.length ? "right" : right ? "part" : "wrong", verdict: `${right} of ${truth.length}`,
        detail: right === truth.length ? "All five right" : `${right} right, ${truth.length - right} wrong`, points: earned(row.id), rank: [0, -right],
      });
    }
  } else if (round.type === "priciest") {
    const items = byId(round.items), top = items[round.results.priciest];
    for (const row of rows) {
      const pick = items[round.picks?.[row.id]];
      if (!pick) { none(row); continue; }
      const right = pick.id === top.id, gap = top.cents - pick.cents;
      Object.assign(row, {
        answer: <span className="pc-pick"><Thumb item={pick} /><span>{pick.name}</span></span>, answerText: pick.name,
        kind: right ? "right" : "wrong", verdict: right ? "Priciest" : "Not it",
        detail: right ? `${formatPrice(top.cents, country)}, the top price` : `${formatPrice(gap, country)} cheaper than the priciest`,
        points: right ? POINTS.priciest : 0, rank: [right ? 0 : 1, gap],
      });
    }
  } else if (round.type === "order") {
    const items = byId(round.items), { truth, placed, orders } = round.results;
    for (const row of rows) {
      const order = orders?.[row.id];
      if (!order) { none(row); continue; }
      const n = placed[row.id];
      Object.assign(row, {
        answer: <span className="pc-order-answer">{order.map((id, i) => <Thumb key={id} item={items[id]} kind={id === truth[i] ? "right" : "wrong"} />)}</span>,
        answerText: order.map((id) => items[id].name).join(", "),
        kind: n === truth.length ? "right" : n ? "part" : "wrong", verdict: `${n} of ${truth.length}`,
        detail: n === truth.length ? "Perfect order" : `${n} in the right place`, points: earned(row.id), rank: [0, -n],
      });
    }
  } else if (round.type === "grocery") {
    const items = byId(round.items), { totals, winners, carts } = round.results, budget = round.budget;
    for (const row of rows) {
      const cart = carts?.[row.id];
      if (!cart) { none(row, "No cart"); continue; }
      const sum = totals[row.id], won = winners.includes(row.id), over = sum > budget, gap = Math.abs(budget - sum);
      Object.assign(row, {
        answer: <span className="pc-cart-answer"><Readout cents={sum} country={country} /><span className="pc-cart-thumbs">{cart.map((id) => <Thumb key={id} item={items[id]} />)}</span><small className="pc-cart-count">{cart.length} item{cart.length > 1 ? "s" : ""}</small></span>,
        answerText: `${formatPrice(sum, country)} for ${cart.length} item${cart.length > 1 ? "s" : ""}`,
        kind: won ? "right" : over ? "wrong" : "miss", verdict: won ? (gap === 0 ? "Exact!" : "Closest") : over ? "Over" : "Under",
        detail: gap === 0 ? "Exactly on budget" : over ? `Over budget by ${formatPrice(gap, country)}` : `${formatPrice(gap, country)} under budget`,
        points: earned(row.id), rank: [won ? 0 : over ? 2 : 1, gap],
      });
    }
  } else if (round.type === "showcase") {
    const { winners, diffs } = round.results;
    for (const row of rows) {
      const seat = round.contestants.indexOf(row.id);
      if (seat >= 0) {
        const bid = round.bids?.[row.id];
        if (bid == null) { none(row, "No bid"); row.contestant = true; continue; }
        const won = winners.includes(row.id), over = diffs[seat] == null, gap = Math.abs(round.totals[seat] - bid);
        Object.assign(row, {
          contestant: true, answer: <Readout cents={bid} country={country} />, answerText: `bid ${formatPrice(bid, country)}`,
          kind: won ? "right" : over ? "wrong" : "miss", verdict: won ? (round.results.both ? "Won both!" : "Won") : over ? "Over" : "Under",
          detail: over ? `Over by ${formatPrice(gap, country)}` : `${formatPrice(gap, country)} under`, points: earned(row.id), rank: [won ? 0 : 1, gap],
        });
        continue;
      }
      const pick = round.predictions?.[row.id];
      if (!pick) { none(row, "No pick"); continue; }
      const right = winners.includes(pick), won = winners.map((id) => nameOf(game, id)).join(" and ");
      Object.assign(row, {
        answer: <span className="pc-pick-name">{nameOf(game, pick)}</span>, answerText: `picked ${nameOf(game, pick)}`,
        kind: right ? "right" : "wrong", verdict: right ? "Called it" : "Missed",
        detail: winners.length ? `${won} won the showcase` : "Nobody won the showcase", points: earned(row.id), rank: [right ? 0 : 1, 0],
      });
    }
  }
  return rows.sort((a, b) => b.points - a.points || a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
}

// The reveal's results table on the TV: player, their answer, right or wrong, how close, points this round.
function Results({ game, rows, title = "Who got what", className = "" }) {
  return (
    <section className={`pc-results${rows.length > 4 ? " is-many" : ""}${className ? ` ${className}` : ""}`} aria-label={title}>
      <ol>
        {rows.map((row) => (
          <li key={row.id} className={`pc-res is-${row.kind}`}>
            <span className="pc-res-name">{row.name}</span>
            <span className="pc-res-answer">{row.answer || <span className="pc-res-none">—</span>}</span>
            <Stamp kind={row.kind}>{row.verdict}</Stamp>
            <span className="pc-res-detail">{row.detail}</span>
            <span className={`pc-res-points${row.points ? "" : " is-zero"}`}>{row.points ? `+${points(row.points)}` : "0"}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// The contestants down the side of the TV: name plate, score, and this round's points or whether they're in.
function Scoreboard({ game }) {
  const round = game.round, answering = round?.phase === "answer", awards = round?.awards || {};
  const isIn = (id) => (round?.type === "showcase" && round.contestants.includes(id) ? round.bidIn.includes(id) : round?.answered.includes(id));
  return (
    <section className="pc-scores" aria-label="Scores">
      <h2>Scores</h2>
      <ol>
        {ranked(game).map((player) => (
          <li key={player.id} className={`${player.connected ? "" : "is-away"}${answering && isIn(player.id) ? " is-in" : ""}`}>
            <span className="pc-score-name">{player.name}{!player.connected && <small> · away</small>}</span>
            <span className="pc-score-points">{points(player.score)}</span>
            {answering && <span className="pc-score-status">{isIn(player.id) ? <><Mark kind="right" />Locked in</> : "Thinking…"}</span>}
            {!answering && awards[player.id] && <span className="pc-score-gain">+{points(awards[player.id].points)}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- What the TV shows for each round ----------
function BidStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  return (
    <div className={`pc-bid${reveal ? " is-reveal" : round.overBids ? " is-rebid" : ""}`}>
      <Product item={round.item} country={game.country} cents={reveal ? round.item.cents : null} hidden={!reveal} />
      {!reveal && round.overBids && (
        <div className="pc-over">
          <p className="pc-callout is-over"><Mark kind="wrong" />Everyone went over! Bid again under <Readout cents={round.below} country={game.country} /></p>
          <ul>{Object.entries(round.overBids).sort((a, b) => a[1] - b[1]).map(([id, bid]) => <li key={id}><span>{nameOf(game, id)}</span><Readout cents={bid} country={game.country} /></li>)}</ul>
        </div>
      )}
      {reveal && <Results game={game} rows={resultRows(game)} />}
    </div>
  );
}
function HigherLowerStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  if (!reveal)
    return (
      <ul className="pc-shelf count-5">
        {round.items.map((item) => <li key={item.id}><Product item={item} country={game.country} cents={item.shownCents} small /></li>)}
      </ul>
    );
  // Every player's call on every product: the products across the top, a row per player.
  const rows = resultRows(game), truth = round.results.truth;
  return (
    <div className="pc-hl-table" role="table" aria-label="Higher or lower calls">
      <div className="pc-hl-head" role="row">
        <span role="columnheader" className="pc-hl-corner">Real price</span>
        {round.items.map((item, i) => (
          <span key={item.id} role="columnheader" className="pc-hl-product">
            <Thumb item={item} />
            <span className="pc-hl-name">{item.name}</span>
            <span className="pc-hl-shown">Tag <s>{price(game, item.shownCents)}</s></span>
            <span className={`pc-hl-truth is-${truth[i]}`}><Arrow up={truth[i] === "higher"} /><Readout cents={item.cents} country={game.country} /></span>
          </span>
        ))}
        <span role="columnheader" className="pc-hl-total">Points</span>
      </div>
      {rows.map((row) => (
        <div key={row.id} role="row" className={`pc-hl-row is-${row.kind}`}>
          <span role="rowheader" className="pc-res-name">{row.name}</span>
          {row.calls ? row.calls.map(({ call, right }, i) => (
            <span key={i} role="cell" className={`pc-hl-call is-${right ? "right" : "wrong"}`} aria-label={`${call}, ${right ? "right" : "wrong"}`}>
              <Arrow up={call === "higher"} /><span>{call === "higher" ? "Higher" : "Lower"}</span><Mark kind={right ? "right" : "wrong"} />
            </span>
          )) : <span role="cell" className="pc-hl-none">No answer</span>}
          <span role="cell" className="pc-hl-score"><b>{row.verdict}</b><span className={`pc-res-points${row.points ? "" : " is-zero"}`}>{row.points ? `+${points(row.points)}` : "0"}</span></span>
        </div>
      ))}
    </div>
  );
}
function PriciestStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  return (
    <>
      <p className="pc-callout">Set {round.set + 1} of {round.setCount}</p>
      <ul className={`pc-shelf count-3${reveal ? " is-compact" : ""}`}>
        {round.items.map((item) => {
          const top = reveal && round.results.priciest === item.id;
          return (
            <li key={item.id} className={top ? "is-lit" : reveal ? "is-dim" : ""}>
              {top && <span className="pc-banner">Priciest!</span>}
              <Product item={item} country={game.country} cents={reveal ? item.cents : null} hidden={!reveal} small={reveal} />
            </li>
          );
        })}
      </ul>
      {reveal && <Results game={game} rows={resultRows(game)} />}
    </>
  );
}
function OrderStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal", items = byId(round.items);
  const shelf = reveal ? round.results.truth.map((id) => items[id]) : round.items;
  return (
    <>
      <ol className={`pc-shelf count-4${reveal ? " is-ordered is-compact" : ""}`}>
        {shelf.map((item, i) => <li key={item.id}>{reveal && <span className="pc-rank" aria-label={`number ${i + 1}`}>{i + 1}</span>}<Product item={item} country={game.country} cents={reveal ? item.cents : null} hidden={!reveal} small /></li>)}
      </ol>
      {reveal && <Results game={game} rows={resultRows(game)} />}
    </>
  );
}
function GroceryStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal";
  return (
    <>
      <p className="pc-callout">Budget <Readout cents={round.budget} country={game.country} /></p>
      <ul className={`pc-shelf count-6${reveal ? " is-compact" : ""}`}>
        {round.items.map((item) => <li key={item.id}><Product item={item} country={game.country} cents={reveal ? item.cents : null} hidden={!reveal} small /></li>)}
      </ul>
      {reveal && <Results game={game} rows={resultRows(game)} />}
    </>
  );
}
function ShowcaseStage({ game }) {
  const round = game.round, reveal = round.phase === "reveal", rows = reveal ? resultRows(game) : [];
  const watchers = rows.filter((row) => !round.contestants.includes(row.id));
  return (
    <>
      <div className="pc-showcases">
        {round.contestants.map((id, i) => {
          const row = rows.find((r) => r.id === id), bid = reveal ? round.bids[id] : null, locked = round.bidIn.includes(id);
          return (
            <section key={id} className={`pc-showcase${row ? ` is-${row.kind}` : ""}`}>
              <h2><span className="pc-showcase-num" aria-hidden="true">{i + 1}</span>{nameOf(game, id)}’s showcase</h2>
              <ul>{round.bundles[i].map((item) => <li key={item.id}><span>{item.name}</span>{reveal && <Readout cents={item.cents} country={game.country} />}</li>)}</ul>
              {reveal ? (
                <dl>
                  <div><dt>Bid</dt><dd>{bid == null ? <span className="pc-res-none">No bid</span> : <Readout cents={bid} country={game.country} />}</dd></div>
                  <div><dt>Actual</dt><dd><Readout cents={round.totals[i]} country={game.country} /></dd></div>
                  <div className="pc-showcase-result"><Stamp kind={row.kind}>{row.verdict}</Stamp><span className="pc-res-detail">{row.detail}</span><span className={`pc-res-points${row.points ? "" : " is-zero"}`}>{row.points ? `+${points(row.points)}` : "0"}</span></div>
                </dl>
              ) : <p className={`pc-status-line${locked ? " is-in" : ""}`}><Mark kind={locked ? "right" : "none"} />{locked ? "Bid locked in" : "Bidding…"}</p>}
            </section>
          );
        })}
      </div>
      {reveal && !round.results.winners.length && <p className="pc-callout is-over">{Object.keys(round.bids).length ? "Both went over. Nobody wins the showcase." : "No bids. Nobody wins the showcase."}</p>}
      {reveal && watchers.length > 0 && <Results game={game} rows={watchers} title="Who called the winner" className="is-watchers" />}
    </>
  );
}
const STAGES = { bid: BidStage, higherLower: HigherLowerStage, priciest: PriciestStage, order: OrderStage, grocery: GroceryStage, showcase: ShowcaseStage };

function Lobby({ game, onAction }) {
  const ready = game.players.filter((player) => player.connected).length >= 2, base = useJoinBase();
  const { name, symbol } = PRICE_COUNTRIES[game.country] || PRICE_COUNTRIES.US;
  return (
    <div className="pc-lobby">
      <div className="pc-lobby-join">
        <div className="pc-code-board">
          <span className="pc-code-label">Room code</span>
          <b className="pc-code" aria-label={`Room code ${game.code.split("").join(" ")}`}>{game.code}</b>
          <span className="pc-lobby-url">Scan the code, or open <b>{displayAddress(base)}</b> and key it in.</span>
        </div>
        <figure className="pc-qr-card">
          <QRCode value={joinLink(base, game.code)} label={`QR code to join game ${game.code}`} />
          <figcaption>Scan to join</figcaption>
        </figure>
      </div>
      <p className="pc-edition">{name} prices, in {symbol}</p>
      <ul className="pc-name-tags" aria-label="Players">
        {game.players.map((player) => <li key={player.id} className={player.connected ? "" : "is-away"}><span>{player.name}</span><small>{player.connected ? "Ready" : "Reconnecting"}</small></li>)}
        {game.players.length < 8 && <li className="is-open"><span>Your name here</span><small>Up to 8 players</small></li>}
      </ul>
      <p className="pc-lobby-note">{ready ? "Everyone bids on their phone. The top two bid on the showcase at the end." : "Price Check needs at least 2 players."}</p>
      <button className="primary pc-start" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
    </div>
  );
}

function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("100");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="sv-team-tools fib-player-tools pc-player-tools">
      <label className="inline-field">Adjust scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            <b className="pc-tool-score">{points(player.score)}</b>
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
    <div className="sv-round-controls pc-round-controls">
      {game.round && !last && <button className="chip-btn" onClick={() => onAction("skip")}>Skip this round</button>}
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>{last ? "End game" : "End game early"}</button>
    </div>
  );
}

export function PriceDisplay({ game, onAction }) {
  const round = game.round, Stage = round && STAGES[round.type], reveal = round?.phase === "reveal";
  useTvSounds(game);
  useClockTicks(round?.phase === "answer" ? round.deadline : null, game.serverNow);
  const next = !game.hostless && reveal && !(round.type === "priciest" && round.set < round.setCount - 1);
  return (
    <main className={`display pc pc-tv${reveal ? " is-reveal" : ""}`}>
      <div className="pc-bulbs" aria-hidden="true" />
      <SoundToggle />
      <header className="pc-tv-bar">
        <Sign />
        {round && game.status !== "lobby" ? (
          <div className="pc-round-banner">
            <span className="pc-round-num">{roundLabel(game)}</span>
            <h1 className="pc-round-name">{ROUND_NAMES[round.type]}</h1>
            <p className="pc-rule">{reveal ? (round.type === "higherLower" ? "Every call, product by product" : "The real price, and who got what") : ROUND_RULES[round.type]}</p>
          </div>
        ) : <h1 className="pc-lobby-title">Join the game</h1>}
        <Clock game={game} />
        {game.status !== "lobby" && <JoinCorner code={game.code} />}
      </header>
      {game.status === "lobby" || !round ? <Lobby game={game} onAction={onAction} /> : (
        <div className="pc-stage">
          <div className={`pc-center is-${round.type}`}>
            <Stage game={game} />
            {next && <button className="primary pc-next" onClick={() => onAction("next")}>{round.type === "showcase" ? "See final scores" : "Next round"}</button>}
          </div>
          <Scoreboard game={game} />
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools sv-host-tools pc-host-tools">
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

// ---------- Setup ----------
export function PriceSetup({ onCreate }) {
  const [length, setLength] = useState(() => readSetting(LENGTH_KEY, LENGTHS, "classic")),
    [country, setCountry] = useState(() => readSetting(COUNTRY_KEY, PRICE_COUNTRIES, "US")),
    [pack, setPack] = useState(null),
    [deal, setDeal] = useState(null),
    [error, setError] = useState(""),
    [hostless, setHostless] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setPack(null); setDeal(null); setError("");
    loadPack(country).then((loaded) => { if (!live) return; setPack(loaded); setDeal(dealGame(length, loaded.items, country)); }, (e) => live && setError(e.message));
    return () => { live = false; };
  }, [country]);
  const chooseLength = (id) => { setLength(id); saveSetting(LENGTH_KEY, id); if (pack) setDeal(dealGame(id, pack.items, country)); };
  const chooseCountry = (id) => { if (id === country) return; setCountry(id); saveSetting(COUNTRY_KEY, id); };
  const start = () => {
    setNotice(""); setBusy(true);
    rememberPlayed(deal.ids);
    onCreate({ game: "price", segments: deal.segments, showcases: deal.showcases, hostless, country }, (e) => { setBusy(false); setNotice(e); });
  };
  const { name, symbol } = PRICE_COUNTRIES[country];
  return (
    <main className="setup pc-setup">
      <BackToHub />
      <Sign small />
      <section className="pc-setup-card">
        <h1>Set up Price Check</h1>
        <p className="pc-setup-intro">Real prices from real shop receipts. Everyone bids, guesses and fills carts on their phone, then the two leaders bid on a showcase.</p>
        <fieldset className="pc-fieldset">
          <legend>Prices from</legend>
          <div className="pc-choices is-country" role="radiogroup" aria-label="Prices from">
            {Object.entries(PRICE_COUNTRIES).map(([id, c]) => <button key={id} role="radio" aria-checked={country === id} onClick={() => chooseCountry(id)}><span>{c.name}</span><small>{c.symbol}</small></button>)}
          </div>
          <p className="pc-hint">{COUNTRY_NOTES[country]}{pack && ` ${pack.items.length.toLocaleString("en-US")} products in the pack.`}</p>
        </fieldset>
        <fieldset className="pc-fieldset">
          <legend>Game length</legend>
          <div className="pc-choices" role="radiogroup" aria-label="Game length">
            {Object.entries(LENGTHS).map(([id, { label }]) => <button key={id} role="radio" aria-checked={length === id} onClick={() => chooseLength(id)}><span>{label}</span></button>)}
          </div>
          <p className="pc-hint">{LENGTHS[length].note}</p>
        </fieldset>
        <div className="pc-rounds-head">
          <h2>Rounds</h2>
          <button className="chip-btn" disabled={!pack} onClick={() => setDeal(dealGame(length, pack.items, country))}>New products</button>
        </div>
        {error ? <p className="notice" role="alert">{error} <button className="chip-btn" onClick={() => location.reload()}>Try again</button></p>
          : !deal ? <p className="pc-hint">Loading {name} prices…</p>
          : (
            <ol className="pc-round-list">
              {deal.segments.map((segment, i) => (
                <li key={i}><span className="pc-round-tag">Round {i + 1}</span><b>{ROUND_NAMES[segment.type]}</b><span>{ROUND_RULES[segment.type]}</span></li>
              ))}
              <li><span className="pc-round-tag is-finale">Finale</span><b>{ROUND_NAMES.showcase}</b><span>The top two each bid on a bundle of big-ticket prizes.</span></li>
            </ol>
          )}
        <p className="pc-hint">Products stay hidden here so you can play too.</p>
        <p className="pc-hint pc-credit">
          Prices from <a href="https://prices.openfoodfacts.org" target="_blank" rel="noreferrer">Open Prices</a>, an Open Food Facts project:
          what shoppers paid at {country === "CA" ? "Canadian" : "US"} stores, under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>.
          Product photos from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>, CC BY-SA.
          Showcase prices are our own estimates of typical {country === "CA" ? "Canadian" : "US"} prices.
        </p>
        <section className="game-options pc-options" aria-labelledby="pc-options-title">
          <h2 id="pc-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The game runs itself: {secs("bidMs")} seconds to bid, {secs("higherLowerMs")} for Higher or Lower, {secs("orderMs")}–{secs("groceryMs")} for the other big rounds, and each reveal stays up for {secs("revealMs")} seconds. With a host, the host controller shows every real price and moves the reveals along.</small></span>
          </label>
        </section>
        <div className="pc-final-row">
          <p className="pc-summary">{name} · {symbol} · {LENGTHS[length].label} · 2 to 8 players</p>
          <button className="primary" disabled={busy || !deal} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
      </section>
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
const FormTop = ({ game, children, over = false }) => <div className="pc-form-top"><span className={`pc-form-label${over ? " is-over" : ""}`}>{children}</span><Clock game={game} /></div>;

function BidForm({ game, playerId, label = "Your bid" }) {
  const [value, setValue] = useState(""), [send, busy, error] = useSend(game, playerId), amount = parseMoney(value);
  const below = game.round.below, { symbol } = PRICE_COUNTRIES[game.country] || PRICE_COUNTRIES.US;
  return (
    <form className="pc-form pc-bid-form" onSubmit={(e) => { e.preventDefault(); if (amount) send({ cents: amount }); }}>
      <FormTop game={game} over={below != null}>{below != null ? `Everyone went over! Bid under ${price(game, below)}` : label}</FormTop>
      <label className="pc-money-input"><span className="pc-dollar" aria-hidden="true">{symbol}</span><input autoFocus aria-label={`${label} in ${symbol}`} inputMode="decimal" autoComplete="off" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary" disabled={!amount || busy}>{busy ? "Sending…" : amount ? `Lock in ${price(game, amount)}` : "Lock in my bid"}</button>
    </form>
  );
}
function HigherLowerForm({ game, playerId }) {
  const items = game.round.items, [calls, setCalls] = useState(() => items.map(() => null)), [send, busy, error] = useSend(game, playerId);
  const call = (i, value) => setCalls((list) => list.map((c, j) => (j === i ? value : c)));
  const done = calls.filter(Boolean).length;
  return (
    <div className="pc-form">
      <FormTop game={game}>Is the real price higher or lower than the tag?</FormTop>
      <ul className="pc-hl">
        {items.map((item, i) => (
          <li key={item.id} className={calls[i] ? "is-called" : ""}>
            <Product item={item} country={game.country} cents={item.shownCents} small />
            <div className="pc-calls" role="radiogroup" aria-label={`${item.name}: higher or lower than ${price(game, item.shownCents)}`}>
              {["higher", "lower"].map((value) => <button key={value} role="radio" aria-checked={calls[i] === value} onClick={() => call(i, value)}><Arrow up={value === "higher"} />{value === "higher" ? "Higher" : "Lower"}</button>)}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary pc-sticky" disabled={done < items.length || busy} onClick={() => send({ calls })}>{done < items.length ? `Call all five (${done} of 5)` : "Lock in my calls"}</button>
    </div>
  );
}
function PriciestForm({ game, playerId }) {
  const [send, busy, error] = useSend(game, playerId);
  return (
    <div className="pc-form">
      <FormTop game={game}>Set {game.round.set + 1} of {game.round.setCount}: tap the priciest</FormTop>
      <ul className="pc-picks">
        {game.round.items.map((item) => <li key={item.id}><button aria-label={item.name} disabled={busy} onClick={() => send({ pick: item.id })}><Product item={item} country={game.country} small /></button></li>)}
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
      <FormTop game={game}>Tap them cheapest first</FormTop>
      <ul className="pc-picks">
        {items.map((item) => {
          const place = order.indexOf(item.id);
          return <li key={item.id}><button aria-label={place >= 0 ? `${item.name}, number ${place + 1}` : item.name} aria-pressed={place >= 0} onClick={() => tap(item.id)}>{place >= 0 && <span className="pc-place">{place + 1}</span>}<Product item={item} country={game.country} small /></button></li>;
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
      <FormTop game={game}>Fill your cart · budget <Readout cents={game.round.budget} country={game.country} /></FormTop>
      <ul className="pc-picks">
        {game.round.items.map((item) => <li key={item.id}><button aria-label={item.name} aria-pressed={cart.includes(item.id)} onClick={() => tap(item.id)}>{cart.includes(item.id) && <span className="pc-place"><Check /></span>}<Product item={item} country={game.country} small /></button></li>)}
      </ul>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="primary pc-sticky" disabled={!cart.length || busy} onClick={() => send({ cart })}>{cart.length ? `Check out ${cart.length} item${cart.length > 1 ? "s" : ""}` : "Put something in your cart"}</button>
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
      <FormTop game={game}>Who’ll win the showcase?</FormTop>
      <div className="pc-calls is-big">{round.contestants.map((id) => <button key={id} disabled={busy} onClick={() => send({ winner: id })}>{nameOf(game, id)}</button>)}</div>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  );
}
const FORMS = { bid: BidForm, higherLower: HigherLowerForm, priciest: PriciestForm, order: OrderForm, grocery: GroceryForm, showcase: ShowcaseForm };

// A phone's own line of the reveal: what you answered, whether it was right, how close, and the points.
function MyResult({ game, playerId }) {
  const round = game.round, row = resultRows(game).find((r) => r.id === playerId), me = game.players.find((p) => p.id === playerId);
  const place = 1 + game.players.filter((p) => p.score > (me?.score ?? 0)).length, tied = game.players.some((p) => p.id !== playerId && p.score === me?.score);
  const real = round.type === "bid" ? round.item.cents : round.type === "showcase" && round.contestants.includes(playerId) ? round.totals[round.contestants.indexOf(playerId)] : null;
  return (
    <div className={`pc-my-result is-${row?.kind || "none"}`}>
      <p className="pc-my-points">{row?.points ? `+${points(row.points)}` : "No points"}<small>{round.type === "priciest" ? "this set" : "this round"}</small></p>
      {row && <Stamp kind={row.kind}>{row.verdict}</Stamp>}
      {real != null && <p className="pc-my-line">Real price <Readout cents={real} country={game.country} /></p>}
      {row?.answerText && <p className="pc-my-line">You: {row.answerText}</p>}
      {row?.detail && <p className="pc-my-line">{row.detail}</p>}
      {round.type === "higherLower" && row?.calls && (
        <ul className="pc-my-calls">
          {round.items.map((item, i) => <li key={item.id} className={`is-${row.calls[i].right ? "right" : "wrong"}`}><Mark kind={row.calls[i].right ? "right" : "wrong"} /><span>{item.name}</span><span>You said {row.calls[i].call} than {price(game, item.shownCents)} · real price {price(game, item.cents)}</span></li>)}
        </ul>
      )}
      <p className="pc-my-place">You’re {tied ? "tied for" : "in"} {ordinal(place)} place. Eyes on the TV!</p>
    </div>
  );
}

function PlayerAction({ game, playerId }) {
  const round = game.round;
  if (round.phase === "reveal") return <MyResult game={game} playerId={playerId} />;
  if (round.answered.includes(playerId)) return <p className="pc-status">Locked in. Waiting for everyone else…</p>;
  if (round.type === "showcase" && round.contestants.includes(playerId) && round.bidIn.includes(playerId)) return <p className="pc-status">Bid locked in. Fingers crossed!</p>;
  const Form = FORMS[round.type];
  return <Form key={`${game.index}-${round.set ?? 0}-${round.rebids ?? 0}`} game={game} playerId={playerId} />;
}

export function PricePlayer({ game, playerId }) {
  const player = game.players.find((p) => p.id === playerId), round = game.round;
  const myTurn = round?.phase === "answer" && !round.answered.includes(playerId);
  useEffect(() => { if (myTurn) { try { navigator.vibrate?.(120); } catch {} } }, [myTurn, round?.type, round?.set]);
  if (!player) return <main className="player pc pc-phone"><p className="pc-status">You’re no longer in this game.</p></main>;
  return (
    <main className="player pc pc-phone">
      <header className="pc-phone-bar">
        <Sign small />
        <span className="pc-phone-name">{player.name}<b>{points(player.score)}</b></span>
      </header>
      {game.status === "lobby" || !round ? <p className="pc-status">You’re in! The game starts when everyone’s here.</p> : (
        <>
          <p className="pc-phone-round">{roundLabel(game)} · <b>{ROUND_NAMES[round.type]}</b></p>
          {round.type === "bid" && round.phase === "answer" && <Product item={round.item} country={game.country} hidden />}
          <PlayerAction game={game} playerId={playerId} />
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
export function PriceController({ game, onAction }) {
  const round = game.round, secret = useSecret(game);
  const header = <header className="pc-phone-bar"><Sign small /><b className="pc-ctrl-code" aria-label={`Game code ${game.code}`}>{game.code}</b></header>;
  if (game.status === "lobby" || !round)
    return (
      <main className="controller pc pc-phone">
        {header}
        <h1>Lobby</h1>
        <p className="pc-hint">Start the game from the main screen once at least two players have joined. {PRICE_COUNTRIES[game.country]?.name} prices.</p>
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
    );
  const items = round.type === "bid" ? [round.item] : round.type === "showcase" ? [] : round.items;
  const nextLabel = round.phase === "answer" ? "Stop the clock and reveal" : round.type === "showcase" ? "See final scores" : round.type === "priciest" && round.set < round.setCount - 1 ? "Next set" : "Next round";
  return (
    <main className="controller pc pc-phone">
      {header}
      <p className="pc-phone-round">{roundLabel(game)} · <b>{ROUND_NAMES[round.type]}</b></p>
      <div className="pc-ctrl-status" role="status"><b>{round.phase === "answer" ? `${round.answered.length} of ${game.players.filter((p) => p.connected).length} locked in` : "Reveal"}</b><span>{ROUND_RULES[round.type]}</span><Clock game={game} /></div>
      <section className="pc-ctrl-prices">
        <h2>Real prices</h2>
        <ul>
          {items.map((item) => <li key={item.id}><span>{item.name}</span>{secret?.prices?.[item.id] != null && <Readout cents={secret.prices[item.id]} country={game.country} />}</li>)}
          {round.type === "showcase" && secret?.totals && round.contestants.map((id, i) => <li key={id}><span>{nameOf(game, id)}’s showcase</span><Readout cents={secret.totals[i]} country={game.country} /></li>)}
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
  const place = (p) => 1 + standings.filter((q) => q.score > p.score).length; // tied scores share a place
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  const playAgain = () => {
    setBusy(true); setError("");
    const country = PRICE_COUNTRIES[game.country] ? game.country : "US";
    loadPack(country).then((pack) => {
      const length = game.segmentCount > 4 ? "classic" : "short", deal = dealGame(length, pack.items, country);
      rememberPlayed(deal.ids);
      onAction("replay", { segments: deal.segments, showcases: deal.showcases });
    }, (e) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <main className={`end pc pc-end${display ? " pc-tv" : " pc-phone"}`}>
      {display && <div className="pc-bulbs" aria-hidden="true" />}
      {display && <SoundToggle />}
      <Sign small={!display} />
      <h1 className="pc-winner">{!standings.length ? "Game over" : tie ? "It’s a tie!" : <><span>{standings[0].name}</span> wins!</>}</h1>
      <ol className="pc-podium">{top.map((p) => <li className={`is-place-${place(p)}`} key={p.id}><span className="pc-podium-rank">{place(p)}</span><b>{p.name}</b><span className="pc-podium-score">{points(p.score)}</span></li>)}</ol>
      {rest.length > 0 && <ol className="pc-rest" start="4">{rest.map((p) => <li key={p.id}><span>{p.name}</span><b>{points(p.score)}</b></li>)}</ol>}
      {host ? (
        <div className="pc-end-buttons">
          <button className="primary" disabled={busy} onClick={playAgain}>{busy ? "Dealing products…" : "Play again with new products"}</button>
          {error && <p className="notice" role="alert">{error}</p>}
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="pc-end-buttons"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
