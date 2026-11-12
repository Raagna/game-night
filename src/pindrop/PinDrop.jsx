// Pin Drop screens: host setup, the shared TV display, players' phones, the host controller and the final standings.
// The look is a traveller's atlas pinned to a cork board (pindrop.css): a paper map sheet with a faint graticule,
// push pins in each player's colour, distances typed like a travel document, and points as passport stamps. It is
// deliberately not the split-flap board of the Game Night menu.
//
// The map is Leaflet over NASA's Blue Marble shaded relief, with coastlines and borders on top but no place names
// (they'd give answers away). Tiles load in the browser from NASA GIBS, which needs no key; see CREDITS.md.
import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@fontsource/barlow-condensed/800.css";
import { socket, clockText } from "../shared";
import { QRCode, useJoinBase, joinLink, displayAddress } from "../JoinQR";
import { BackToHub } from "../Hub";
import { useSound, useEventSounds, playWinnersTune } from "../survey/sounds";
import { useClockTicks } from "../wheel/sounds";
import { playClue, playPop, playFact } from "../fib/sounds";
import { Coach } from "../Tutorial";
import {
  PINDROP_PACKS, PINDROP_ROUNDS, PINDROP_TIMERS, DEFAULT_TIMER, PINDROP_TIMES, PINDROP_PRACTICE_TIMES, MAX_POINTS, CLOSEST_BONUS,
  dealClues, defaultUnit, formatDistance, wrapLng,
} from "../../server/pindrop.js";
import PLACE_DATA from "./places.json";
import "./pindrop.css";

const PLACES = PLACE_DATA.places;

// ---------- The map ----------
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
// Blue Marble shaded relief and bathymetry (no labels), native to zoom 8; coastlines and borders (no labels) to 9.
const BASE_TILES = `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`;
const BORDER_TILES = `${GIBS}/Reference_Features/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`;
const ATTRIBUTION = 'Imagery: <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noreferrer">NASA GIBS</a>, Blue Marble · Borders © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const MAX_ZOOM = 10;
// How close the TV flies in on the answer before pulling back to show every pin.
const ANSWER_ZOOM = { world: 5, usa: 6, canada: 5 };
// Ten push-pin colours, one per player (the server hands out the index). Every pin also carries its player's name.
export const PIN_HEX = ["#d8432b", "#2f6fd1", "#e8b222", "#2e9d5b", "#8a4fc7", "#ee7b26", "#16a3a8", "#d6559c", "#8a5a33", "#5d6b82"];
const pinHex = (player) => PIN_HEX[(player?.color ?? 0) % PIN_HEX.length];

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
// The same longitude moved by whole turns to sit within 180° of `near`, so a pin and its line show on the same copy of
// the world as the answer.
const nearLng = (lng, near) => lng + 360 * Math.round((near - lng) / 360);
// Points along the great circle from a to b, for the line from a pin to the answer (the shortest way round).
function greatCircle(a, b, steps = 64) {
  const vec = ({ lat, lng }) => [Math.cos(rad(lat)) * Math.cos(rad(lng)), Math.cos(rad(lat)) * Math.sin(rad(lng)), Math.sin(rad(lat))];
  const A = vec(a), B = vec(b), d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (d < 1e-6 || d > Math.PI - 1e-3) return [[a.lat, a.lng], [b.lat, b.lng]];
  const points = [];
  let last = a.lng;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d);
    const v = [A[0] * s1 + B[0] * s2, A[1] * s1 + B[1] * s2, A[2] * s1 + B[2] * s2];
    const lng = nearLng(deg(Math.atan2(v[1], v[0])), last);
    points.push([deg(Math.atan2(v[2], Math.hypot(v[0], v[1]))), lng]);
    last = lng;
  }
  return points;
}

const PIN_SVG = '<svg viewBox="0 0 32 46" width="32" height="46" aria-hidden="true"><path d="M16 25v19" stroke="#2b2b2b" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="16" cy="24.5" rx="7" ry="2.4" fill="rgb(0 0 0 / .25)"/><circle cx="16" cy="13" r="11.5" fill="var(--pin)" stroke="rgb(0 0 0 / .5)" stroke-width="1.4"/><circle cx="12" cy="9" r="3.6" fill="#fff" opacity=".6"/></svg>';
function pinIcon(color, label = "", detail = "", extra = "") {
  const tag = label ? `<span class="pd-pin-tag"><b>${esc(label)}</b>${detail ? `<small>${esc(detail)}</small>` : ""}</span>` : "";
  return L.divIcon({ className: `pd-pin${extra}`, html: `<span class="pd-pin-body" style="--pin:${color}">${PIN_SVG}${tag}</span>`, iconSize: [32, 46], iconAnchor: [16, 44] });
}
function targetIcon(label) {
  const tag = label ? `<span class="pd-target-tag">${esc(label)}</span>` : "";
  return L.divIcon({
    className: "pd-target",
    html: `<span class="pd-target-body"><svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="none" stroke="#fff" stroke-width="5"/><circle cx="20" cy="20" r="17" fill="none" stroke="#c4452a" stroke-width="3"/><circle cx="20" cy="20" r="9" fill="none" stroke="#fff" stroke-width="4"/><circle cx="20" cy="20" r="9" fill="none" stroke="#c4452a" stroke-width="2.4"/><circle cx="20" cy="20" r="3.2" fill="#c4452a" stroke="#fff" stroke-width="1.4"/></svg>${tag}</span>`,
    iconSize: [40, 40], iconAnchor: [20, 20],
  });
}

// A Leaflet map on the atlas sheet. On a phone it takes the player's pin (tap to drop, drag or tap again to move);
// at a reveal it shows the answer, every pin and a line from each pin to the answer.
//   pin / onPin / locked: the phone's own pin.  reveal: { key, answer: {lat, lng, label}, pins: [{ id, lat, lng, color, name, detail }] }
//   flight: fly in on the answer, then drop the pins one by one (the TV); otherwise show it all at once.
function AtlasMap({ pack, className = "", interactive = true, pin = null, pinColor = PIN_HEX[0], onPin = null, locked = false, reveal = null, flight = false, label = "World map" }) {
  const el = useRef(null), map = useRef(null), marker = useRef(null), layer = useRef(null), props = useRef({});
  props.current = { onPin, locked };
  useEffect(() => {
    const m = L.map(el.current, {
      worldCopyJump: true, minZoom: 1, maxZoom: MAX_ZOOM, zoomSnap: 0.25, zoomDelta: 1, wheelPxPerZoomLevel: 90,
      maxBounds: [[-85, -720], [85, 720]], maxBoundsViscosity: 1, zoomControl: interactive, attributionControl: true,
      dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive, scrollWheelZoom: interactive, boxZoom: false, keyboard: interactive,
    });
    L.tileLayer(BASE_TILES, { maxNativeZoom: 8, maxZoom: MAX_ZOOM, className: "pd-base", attribution: ATTRIBUTION }).addTo(m);
    L.tileLayer(BORDER_TILES, { maxNativeZoom: 9, maxZoom: MAX_ZOOM, className: "pd-borders" }).addTo(m);
    m.fitBounds(PINDROP_PACKS[pack]?.view || PINDROP_PACKS.world.view);
    m.on("click", (event) => { const { onPin, locked } = props.current; if (onPin && !locked) onPin(event.latlng); });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(el.current);
    return () => { resize.disconnect(); m.remove(); map.current = null; };
  }, []);

  // The phone's own pin.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!pin || reveal) { marker.current?.remove(); marker.current = null; return; }
    const at = [pin.lat, nearLng(pin.lng, m.getCenter().lng)];
    if (!marker.current) {
      marker.current = L.marker(at, { icon: pinIcon(pinColor, "", "", " is-mine"), draggable: true, autoPan: true, keyboard: false }).addTo(m);
      marker.current.on("dragend", () => { const { onPin, locked } = props.current; if (onPin && !locked) onPin(marker.current.getLatLng()); });
    } else marker.current.setLatLng(at);
    marker.current.setIcon(pinIcon(pinColor, "", "", locked ? " is-mine is-locked" : " is-mine"));
    if (locked || !onPin) marker.current.dragging?.disable(); else marker.current.dragging?.enable();
  }, [pin?.lat, pin?.lng, locked, pinColor, !!reveal, !!onPin]);

  // The reveal.
  useEffect(() => {
    const m = map.current, group = layer.current;
    if (!m) return;
    group.clearLayers();
    if (!reveal) { m.fitBounds(PINDROP_PACKS[pack]?.view || PINDROP_PACKS.world.view, { animate: false }); return; }
    const answer = { lat: reveal.answer.lat, lng: reveal.answer.lng };
    const placed = reveal.pins.map((p) => ({ ...p, lng: nearLng(p.lng, answer.lng) }));
    const bounds = L.latLngBounds([[answer.lat, answer.lng], ...placed.map((p) => [p.lat, p.lng])]);
    const timers = [];
    const showTarget = () => L.marker([answer.lat, answer.lng], { icon: targetIcon(reveal.answer.label), zIndexOffset: 1000, keyboard: false, interactive: false }).addTo(group);
    const showPin = (p) => {
      const line = greatCircle(p, answer);
      L.polyline(line, { color: "#fffaf0", weight: 6, opacity: 0.85, interactive: false, className: "pd-line-casing" }).addTo(group);
      L.polyline(line, { color: p.color, weight: 3.5, dashArray: "9 7", interactive: false, className: "pd-line" }).addTo(group);
      L.marker([p.lat, p.lng], { icon: pinIcon(p.color, p.name, p.detail, " is-dropped"), keyboard: false, interactive: false }).addTo(group);
    };
    const fitAll = (animate) => { if (placed.length) m.flyToBounds(bounds.pad(0.12), { maxZoom: 7, padding: [40, 40], duration: animate ? 1.6 : 0, animate }); };
    if (!flight) {
      showTarget(); placed.forEach(showPin);
      if (placed.length) m.fitBounds(bounds.pad(0.15), { maxZoom: 7, padding: [24, 24], animate: false }); else m.setView([answer.lat, answer.lng], ANSWER_ZOOM[pack] || 5, { animate: false });
      return;
    }
    // Fly to the answer, mark it, drop the pins one by one, then pull back to show them all.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    m.flyTo([answer.lat, answer.lng], ANSWER_ZOOM[pack] || 5, { duration: reduced ? 0 : 2.2, animate: !reduced });
    timers.push(setTimeout(() => {
      showTarget();
      placed.forEach((p, i) => timers.push(setTimeout(() => showPin(p), 500 + i * 380)));
      timers.push(setTimeout(() => fitAll(!reduced), 900 + placed.length * 380));
    }, reduced ? 0 : 2300));
    return () => timers.forEach(clearTimeout);
  }, [reveal?.key]);

  return <div ref={el} className={`pd-map ${className}`} role="application" aria-label={label} />;
}

// ---------- Small helpers ----------
const nameOf = (game, id) => game.players.find((player) => player.id === id)?.name || "A player";
const playerOf = (game, id) => game.players.find((player) => player.id === id);
const points = (value) => (value || 0).toLocaleString("en-US");
const ranked = (game) => [...game.players].sort((a, b) => b.score - a.score);
const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || "th"}`;
const clearPlayerSession = () => ["playerId", "gameCode", "playerName"].forEach((key) => sessionStorage.removeItem(key));
const roundLabel = (game) => (game.tutorial ? "Practice" : `Round ${game.index + 1} of ${game.roundCount}`);
const distance = (game, km) => formatDistance(km, game.unit);
// A word for how close a pin was, so the stamp never relies on its colour.
const verdict = (pin) => !pin ? "No pin" : pin.points >= 950 ? "Bullseye" : pin.points >= 750 ? "Close" : pin.points >= 400 ? "Warm" : pin.points > 0 ? "Far off" : "Way off";
const tier = (pin) => !pin ? "none" : pin.points >= 750 ? "close" : pin.points >= 400 ? "warm" : "far";
// "48.86° N, 2.29° E"
const coords = ({ lat, lng }) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(wrapLng(lng)).toFixed(2)}° ${wrapLng(lng) >= 0 ? "E" : "W"}`;
// How long the current clock ran from the start, for the dial.
function phaseMs(game) {
  const round = game.round;
  if (!round) return 0;
  if (game.practice?.done) return PINDROP_PRACTICE_TIMES.endMs;
  if (round.phase === "answer") return game.tutorial ? PINDROP_PRACTICE_TIMES.answerMs : game.answerMs;
  return game.tutorial ? PINDROP_PRACTICE_TIMES.revealMs : PINDROP_TIMES.revealMs;
}
// The reveal's rows, closest first: every player, their pin's distance, points and closest bonus.
function resultRows(game, results = game.round?.results) {
  const pins = results?.pins || {};
  return game.players.map((player) => ({ player, pin: pins[player.id] || null, closest: results?.closest?.includes(player.id) }))
    .sort((a, b) => (a.pin ? a.pin.km : Infinity) - (b.pin ? b.pin.km : Infinity) || a.player.name.localeCompare(b.player.name));
}
const answerLabel = (answer) => String(answer || "").split(",")[0];
// What a map needs for the reveal: the answer and every pin, in each player's colour.
function revealFor(game, only = null) {
  const round = game.round;
  if (round?.phase !== "reveal" || round.clue.lat == null) return null;
  const pins = Object.entries(round.results?.pins || {})
    .filter(([id]) => !only || id === only)
    .map(([id, pin]) => ({ id, lat: pin.lat, lng: pin.lng, km: pin.km, color: pinHex(playerOf(game, id)), name: only ? "You" : nameOf(game, id), detail: distance(game, pin.km) }));
  return { key: `${game.code}-${game.tutorial ? "p" : game.index}-${round.clue.id}-${only || "all"}`, answer: { lat: round.clue.lat, lng: round.clue.lng, label: answerLabel(round.clue.answer) }, pins };
}

// ---------- The practice round's coach (see docs/tutorial.md) ----------
// The steps come from the server (practiceStep in server/pindrop.js): drop and lock a pin, the reveal, then done.
const lockedIn = (game, me) => game.round?.locked?.includes(me);
const PINDROP_COACH = {
  drop: {
    tv: "Practice clue! Find the place on your phone’s map: drag to look around and pinch to zoom. Tap to drop your pin, drag it or tap again to move it, then tap Lock in.",
    controller: "Players are placing pins on their phones. The answer is below. Tap Reveal now if they’re slow.",
    phone: ({ game, me }) => lockedIn(game, me) ? "Locked in! The reveal comes once everyone’s locked in, or when the clock runs out."
      : "Drag the map to look around and pinch to zoom. Tap to drop your pin, drag it or tap again to move it, then Lock in.",
  },
  reveal: {
    tv: ({ game }) => `The reveal: the map flies to the real place and every pin gets a line to it. A pin on the spot scores ${MAX_POINTS}, fewer the further off it is, and the closest pin earns ${CLOSEST_BONUS} more.${game.hostless ? " Round one is next." : ""}`,
    controller: "Give everyone a moment with the reveal, then tap Finish the practice.",
    phone: "Your pin and the real place are on your map. Closer scores more, and the closest pin gets a bonus. The TV shows everyone’s.",
  },
  done: {
    tv: ({ game }) => `That’s the practice! Every round works the same way. Scores start at 0, and ${game.hostless ? "round one starts in a few seconds." : "the host starts round one."}`,
    controller: "That’s the practice. Tap Start the game when everyone’s ready: round one starts, scores at 0.",
    phone: ({ game }) => `That’s the practice! Scores start at 0, and ${game.hostless ? "round one starts in a few seconds." : "the host starts round one."}`,
    skip: "Start the game",
  },
};

// The answer for host controllers, caught when the module loads (as Price Check does with its prices).
let lastSecret = null;
const secretListeners = new Set();
socket.on("pindrop:secret", (secret) => { lastSecret = secret; secretListeners.forEach((listener) => listener(secret)); });
function useSecret(game) {
  const [secret, setSecret] = useState(lastSecret);
  useEffect(() => { secretListeners.add(setSecret); return () => secretListeners.delete(setSecret); }, []);
  return secret?.code === game.code && secret.clueId === game.round?.clue.id ? secret : null;
}

function useTvSounds(game) {
  useEventSounds(game, (e) => {
    if (e.type === "round") playClue();
    else if (e.type === "locked") playPop();
    else if (e.type === "reveal") setTimeout(playFact, 2200);
  });
}

// ---------- Atlas pieces ----------
const PinGlyph = ({ color = "#d8432b", size = 22 }) => (
  <svg className="pd-glyph" viewBox="0 0 32 46" width={size * 0.7} height={size} aria-hidden="true" style={{ "--pin": color }}>
    <path d="M16 25v19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    <circle cx="16" cy="13" r="11.5" fill="var(--pin)" stroke="rgb(0 0 0 / .45)" strokeWidth="1.4" />
    <circle cx="12" cy="9" r="3.6" fill="#fff" opacity=".6" />
  </svg>
);
// The game's name: a push pin dropping into a dotted route.
function Logo({ small = false }) {
  return (
    <div className={`pd-logo${small ? " is-small" : ""}`}>
      <PinGlyph size={small ? 22 : 40} />
      <span className="pd-logo-text">Pin Drop</span>
    </div>
  );
}
// Points as a passport stamp: the points, a word for how close, and the distance.
function Stamp({ pin, game, practice = false, bonus = false }) {
  const kind = tier(pin);
  return (
    <span className={`pd-stamp is-${kind}`}>
      <b>{pin ? (practice ? verdict(pin) : `+${points(pin.points)}`) : "—"}</b>
      <small>{practice ? (pin ? distance(game, pin.km) : "No pin") : verdict(pin)}</small>
      {bonus && <i>+{CLOSEST_BONUS} closest</i>}
    </span>
  );
}
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
    <div className={`pd-clock${seconds <= 10 && game.round?.phase === "answer" ? " is-low" : ""}`} role="timer" aria-label={`${seconds} seconds left`} style={{ "--left": left }}>
      <b>{clockText(seconds)}</b>
    </div>
  );
}
const SpeakerIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
    <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
  </svg>
);
function SoundToggle() {
  const [muted, toggle, waiting] = useSound();
  return <button className="sv-sound" aria-pressed={!muted} onClick={toggle}><SpeakerIcon off={muted} />{muted ? "Sound off" : waiting ? "Click for sound" : "Sound on"}</button>;
}
function JoinCorner({ code }) {
  const base = useJoinBase();
  return (
    <div className="pd-join-corner">
      <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} />
      <span><small>Join at {displayAddress(base)}</small><b aria-label={`code ${code.split("").join(" ")}`}>{code}</b></span>
    </div>
  );
}
const UNIT_NAMES = { km: "kilometres", mi: "miles" };
const DIFFICULTY_NAMES = { easy: "Easy", mixed: "Mixed", hard: "Hard" };
const settingsLine = (game) => `${PINDROP_PACKS[game.pack]?.name || "World"} · ${game.roundCount} rounds · ${DIFFICULTY_NAMES[game.difficulty] || "Mixed"} · ${Math.round(game.answerMs / 1000)} s a pin · ${game.unit === "mi" ? "miles" : "km"}`;

// ---------- The TV ----------
function Lobby({ game, onAction }) {
  const base = useJoinBase(), ready = game.players.some((player) => player.connected);
  return (
    <div className="pd-lobby">
      <div className="pd-lobby-join">
        <div className="pd-ticket">
          <span className="pd-ticket-label">Room code</span>
          <b className="pd-code" aria-label={`Room code ${game.code.split("").join(" ")}`}>{game.code}</b>
          <span className="pd-ticket-url">Scan the code, or open <b>{displayAddress(base)}</b> and key it in.</span>
        </div>
        <figure className="pd-qr-card">
          <QRCode value={joinLink(base, game.code)} label={`QR code to join game ${game.code}`} />
          <figcaption>Scan to join</figcaption>
        </figure>
      </div>
      <p className="pd-settings-line">{settingsLine(game)}</p>
      <ul className="pd-travellers" aria-label="Players">
        {game.players.map((player) => <li key={player.id} className={player.connected ? "" : "is-away"}><PinGlyph color={pinHex(player)} /><span>{player.name}</span><small>{player.connected ? "Ready" : "Reconnecting"}</small></li>)}
        {game.players.length < 10 && <li className="is-open"><PinGlyph color="#b9ab8b" /><span>Your name here</span><small>Up to 10 players</small></li>}
      </ul>
      <p className="pd-lobby-note">{ready ? "Everyone drops a pin on the map on their phone. Closest to the real place scores most." : "Pin Drop needs at least one player."}</p>
      <button className="primary pd-start" disabled={!ready} onClick={() => onAction("start")}>Start game</button>
    </div>
  );
}
// The clue as a postcard on the sheet.
function ClueCard({ game, reveal }) {
  const clue = game.round.clue;
  return (
    <section className={`pd-clue${reveal ? " is-reveal" : ""}`} aria-label="Clue">
      <p className="pd-clue-label">{roundLabel(game)}{clue.difficulty && !game.tutorial ? ` · ${clue.difficulty}` : ""}</p>
      <h1 className="pd-clue-text">{clue.clue}</h1>
      {reveal && clue.answer && <p className="pd-answer"><span className="pd-answer-label">The answer</span><b>{clue.answer}</b><small>{coords(clue)}</small></p>}
    </section>
  );
}
// While pins go in: who has placed one, and who has locked in.
function PinStatus({ game }) {
  const round = game.round;
  return (
    <ol className="pd-status" aria-label="Who’s locked in">
      {game.players.map((player) => {
        const locked = round.locked.includes(player.id), placed = round.placed.includes(player.id);
        return (
          <li key={player.id} className={`${locked ? "is-locked" : placed ? "is-placed" : ""}${player.connected ? "" : " is-away"}`}>
            <PinGlyph color={pinHex(player)} />
            <span className="pd-status-name">{player.name}</span>
            <span className="pd-status-word">{!player.connected ? "Away" : locked ? "Locked in" : placed ? "Pin placed…" : "Searching…"}</span>
          </li>
        );
      })}
    </ol>
  );
}
// The reveal's breakdown: every player, closest first, with distance and points.
function Breakdown({ game }) {
  const rows = resultRows(game), practice = !!game.tutorial;
  return (
    <ol className="pd-breakdown" aria-label="This round">
      {rows.map(({ player, pin, closest }, i) => (
        <li key={player.id} className={`is-${tier(pin)}${closest ? " is-closest" : ""}`}>
          <span className="pd-rank">{pin ? i + 1 : "–"}</span>
          <PinGlyph color={pinHex(player)} />
          <span className="pd-bd-name">{player.name}{pin && !pin.locked && <small> · not locked, still counted</small>}</span>
          <span className="pd-bd-km">{pin ? distance(game, pin.km) : "No pin"}</span>
          <Stamp pin={pin} game={game} practice={practice} bonus={closest && !practice} />
        </li>
      ))}
    </ol>
  );
}
function Standings({ game }) {
  const round = game.round, reveal = round?.phase === "reveal" && !game.tutorial;
  return (
    <section className="pd-standings" aria-label="Scores">
      <h2>Standings</h2>
      <ol>
        {ranked(game).map((player) => {
          const pin = reveal ? round.results?.pins?.[player.id] : null, gain = pin ? pin.points + pin.bonus : 0;
          return <li key={player.id} className={player.connected ? "" : "is-away"}><PinGlyph color={pinHex(player)} size={18} /><span>{player.name}</span><b>{points(player.score)}</b>{gain > 0 && <small>+{points(gain)}</small>}</li>;
        })}
      </ol>
    </section>
  );
}
function PlayerTools({ game, onAction }) {
  const [amount, setAmount] = useState("100");
  const step = Math.max(1, Math.trunc(Number(amount) || 0));
  return (
    <div className="sv-team-tools fib-player-tools pd-player-tools">
      <label className="inline-field">Adjust scores by <input aria-label="Score adjustment amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <ul>
        {game.players.map((player) => (
          <li key={player.id}>
            <input aria-label={`${player.name}’s name`} defaultValue={player.name} key={player.name} maxLength="20" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== player.name && onAction("renamePlayer", { playerId: player.id, name: e.target.value })} />
            <b className="pd-tool-score">{points(player.score)}</b>
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
  return (
    <div className="sv-round-controls pd-round-controls">
      <button className="chip-btn" onClick={() => onAction("skip")}>Skip this round</button>
      <button className="chip-btn danger" onClick={() => onAction("endGame")}>End game early</button>
    </div>
  );
}
const lastRound = (game) => !game.tutorial && game.index >= game.roundCount - 1;
function nextLabel(game) {
  const round = game.round, step = game.tutorial?.step;
  if (round.phase === "answer") return "Reveal now";
  if (step === "reveal") return "Finish the practice";
  return lastRound(game) ? "See final standings" : "Next round";
}

export function PinDropDisplay({ game, onAction }) {
  const round = game.round, reveal = round?.phase === "reveal", step = game.tutorial?.step;
  useTvSounds(game);
  useClockTicks(round?.phase === "answer" ? round.deadline : null, game.serverNow);
  const revealed = useMemo(() => revealFor(game), [game.round?.phase, game.round?.clue?.id, game.index, !!game.tutorial, game.round?.results]);
  const lobby = game.status === "lobby" || !round;
  return (
    <main className={`display pd pd-tv${reveal ? " is-reveal" : ""}${lobby ? " is-lobby" : ""}`}>
      <SoundToggle />
      <header className="pd-tv-bar">
        <Logo />
        {lobby ? <h1 className="pd-lobby-title">Join the game</h1> : <p className="pd-tv-round">{roundLabel(game)}<small>{settingsLine(game)}</small></p>}
        <Clock game={game} />
        {!lobby && <JoinCorner code={game.code} />}
      </header>
      <Coach game={game} coach={PINDROP_COACH} place="tv" />
      {lobby ? <Lobby game={game} onAction={onAction} /> : (
        <div className="pd-stage">
          <div className="pd-sheet">
            <AtlasMap pack={game.pack} interactive={false} reveal={revealed} flight label={reveal ? `Map: the answer and every pin` : "Map"} />
            <span className="pd-sheet-corner" aria-hidden="true">{PINDROP_PACKS[game.pack]?.name} sheet</span>
          </div>
          <aside className="pd-side">
            <ClueCard game={game} reveal={reveal} />
            {reveal ? <Breakdown game={game} /> : <PinStatus game={game} />}
            {!game.hostless && step !== "done" && <button className={`${reveal ? "primary" : "secondary"} pd-next`} onClick={() => onAction("next")}>{nextLabel(game)}</button>}
            {!game.tutorial && <Standings game={game} />}
          </aside>
        </div>
      )}
      {game.hostless && game.players.length > 0 && (
        <details className="host-tools sv-host-tools pd-host-tools">
          <summary>Host tools</summary>
          {game.status === "playing" && !game.tutorial && <RoundControls game={game} onAction={onAction} />}
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
const SETUP_KEY = "gameNight.pindrop.setup.v1";
const PLAYED_KEY = "gameNight.pindrop.played.v1";
const readPlayed = () => { try { return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY)) || []); } catch { return new Set(); } };
const rememberPlayed = (ids) => { try { localStorage.setItem(PLAYED_KEY, JSON.stringify([...new Set([...readPlayed(), ...ids])].slice(-1000))); } catch {} };
const SETUP_DEFAULTS = { pack: "world", rounds: 8, difficulty: "mixed", timer: DEFAULT_TIMER, unit: "km" };
function readSetup() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY)) || {};
    return {
      pack: Object.hasOwn(PINDROP_PACKS, saved.pack) ? saved.pack : SETUP_DEFAULTS.pack,
      rounds: PINDROP_ROUNDS.includes(saved.rounds) ? saved.rounds : SETUP_DEFAULTS.rounds,
      difficulty: Object.hasOwn(DIFFICULTY_NAMES, saved.difficulty) ? saved.difficulty : SETUP_DEFAULTS.difficulty,
      timer: PINDROP_TIMERS.includes(saved.timer) ? saved.timer : SETUP_DEFAULTS.timer,
      unit: saved.unit === "mi" || saved.unit === "km" ? saved.unit : defaultUnit(saved.pack),
    };
  } catch { return { ...SETUP_DEFAULTS }; }
}
const PACK_NOTES = {
  world: "Landmarks, cities and wonders anywhere on Earth. The scoring is gentle: a few hundred km off is still a good guess.",
  usa: "Places across the United States, Alaska and Hawaii included. The scoring is tighter, so a state away costs you.",
  canada: "Places from coast to coast to coast. The scoring is tighter than the world map’s.",
};
const DIFFICULTY_NOTES = { easy: "Famous places most people know.", mixed: "Easy places first, then harder ones as the game goes on.", hard: "Remote spots and trickier facts." };
function Choices({ label, value, options, onChange }) {
  return (
    <fieldset className="pd-fieldset">
      <legend>{label}</legend>
      <div className="pd-choices" role="radiogroup" aria-label={label}>
        {options.map(([id, text, small]) => <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}><span>{text}</span>{small && <small>{small}</small>}</button>)}
      </div>
    </fieldset>
  );
}
export function PinDropSetup({ onCreate }) {
  const [setup, setSetup] = useState(readSetup), [hostless, setHostless] = useState(false), [practice, setPractice] = useState(true);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const change = (patch) => setSetup((current) => {
    // Choosing a pack switches the unit to that pack's usual one (miles for the USA); the host can change it back.
    const next = { ...current, ...patch, ...(patch.pack && patch.pack !== current.pack ? { unit: defaultUnit(patch.pack) } : {}) };
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(next)); } catch {}
    return next;
  });
  const counts = useMemo(() => Object.fromEntries(Object.keys(PINDROP_PACKS).map((pack) => [pack, PLACES.filter((place) => place.pack === pack).length])), []);
  const start = () => {
    setNotice(""); setBusy(true);
    const { clues, practice: practiceClue } = dealClues(PLACES, setup, Math.random, readPlayed());
    rememberPlayed(clues.map((clue) => clue.id));
    onCreate({ game: "pindrop", clues, pack: setup.pack, difficulty: setup.difficulty, timer: setup.timer, unit: setup.unit, hostless, tutorial: practice && !!practiceClue, practice: practiceClue }, (e) => { setBusy(false); setNotice(e); });
  };
  return (
    <main className="setup pd-setup">
      <BackToHub />
      <Logo />
      <section className="pd-setup-card">
        <h1>Set up Pin Drop</h1>
        <p className="pd-setup-intro">A clue for a place goes up on the TV. Everyone drops a pin on the map on their phone, then the map flies to the real spot: the closer your pin, the more points.</p>
        <Choices label="Map" value={setup.pack} onChange={(pack) => change({ pack })} options={Object.entries(PINDROP_PACKS).map(([id, pack]) => [id, pack.name, `${counts[id]} places`])} />
        <p className="pd-hint">{PACK_NOTES[setup.pack]}</p>
        <div className="pd-setup-grid">
          <Choices label="Rounds" value={setup.rounds} onChange={(rounds) => change({ rounds })} options={PINDROP_ROUNDS.map((n) => [n, String(n)])} />
          <Choices label="Difficulty" value={setup.difficulty} onChange={(difficulty) => change({ difficulty })} options={Object.entries(DIFFICULTY_NAMES)} />
          <Choices label="Time to drop a pin" value={setup.timer} onChange={(timer) => change({ timer })} options={PINDROP_TIMERS.map((s) => [s, `${s} s`])} />
          <Choices label="Distances in" value={setup.unit} onChange={(unit) => change({ unit })} options={[["km", "Kilometres"], ["mi", "Miles"]]} />
        </div>
        <p className="pd-hint">{DIFFICULTY_NOTES[setup.difficulty]} Each round scores up to {MAX_POINTS.toLocaleString("en-US")} points, falling off with distance, and the closest pin earns {CLOSEST_BONUS} more. Clues stay hidden here so you can play too.</p>
        <section className="game-options pd-options" aria-labelledby="pd-options-title">
          <h2 id="pd-options-title">Game options</h2>
          <label className="game-mode">
            <input type="checkbox" checked={hostless} onChange={(e) => setHostless(e.target.checked)} />
            <span><b>Play without a host</b><small>The game runs itself: {setup.timer} seconds to drop a pin, and each reveal stays up for {Math.round(PINDROP_TIMES.revealMs / 1000)} seconds. With a host, the host’s screens show the answer early and move the game along.</small></span>
          </label>
          <label className="game-mode">
            <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} />
            <span><b>Practice round first</b><small>One easy clue before round one, with tips on the TV and every phone: how to move the map, drop and lock a pin, and how a reveal scores. Nothing scores. {hostless ? "Players can vote to skip it." : "The host can skip it."}</small></span>
          </label>
        </section>
        <div className="pd-final-row">
          <p className="pd-summary">{PINDROP_PACKS[setup.pack].name} · {setup.rounds} rounds · {DIFFICULTY_NAMES[setup.difficulty]} · {setup.timer} s · {UNIT_NAMES[setup.unit]} · up to 10 players</p>
          <button className="primary" disabled={busy} onClick={start}>{busy ? "Creating…" : "Create lobby"}</button>
        </div>
        {notice && <p className="notice" role="alert">{notice}</p>}
        <p className="pd-hint pd-credit">Map imagery: NASA Blue Marble through <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noreferrer">NASA GIBS</a>. Coastlines and borders © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Maps by <a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>. Clues written for Game Night.</p>
      </section>
    </main>
  );
}

// ---------- Player phone ----------
const DRAFT_KEY = "gameNight.pindrop.draft";
const roundKey = (game) => `${game.code}:${game.tutorial ? "practice" : game.index}:${game.round?.clue.id}`;
function readDraft(key) { try { const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY)); return draft?.key === key ? { lat: draft.lat, lng: draft.lng } : null; } catch { return null; } }
function saveDraft(key, spot) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ key, ...spot })); } catch {} }

function PinPicker({ game, playerId, player }) {
  const key = roundKey(game), locked = lockedIn(game, playerId);
  const [draft, setDraft] = useState(() => readDraft(key)), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const send = (payload, done) => socket.timeout(5000).emit("pindrop:pin", { code: game.code, playerId, ...payload }, (err, result) => {
    if (err) setError("Couldn’t reach the game. Try again.");
    else if (!result?.ok) setError(result?.error || "That didn’t go through.");
    else setError("");
    done?.(!err && result?.ok);
  });
  const place = (latlng) => {
    const spot = { lat: Math.max(-85, Math.min(85, latlng.lat)), lng: wrapLng(latlng.lng) };
    setDraft(spot); saveDraft(key, spot);
    send(spot);
    try { navigator.vibrate?.(15); } catch {}
  };
  const lock = () => { if (!draft) return; setBusy(true); send({ ...draft, lock: true }, () => setBusy(false)); };
  const waiting = game.round.locked.length, live = game.players.filter((p) => p.connected).length;
  return (
    <>
      <div className="pd-phone-map">
        <AtlasMap pack={game.pack} pin={draft} pinColor={pinHex(player)} onPin={locked ? null : place} locked={locked} label="Map: tap to drop your pin" />
        {!draft && !locked && <p className="pd-map-hint" aria-hidden="true">Tap the map to drop your pin</p>}
      </div>
      {error && <p className="notice pd-phone-error" role="alert">{error}</p>}
      {locked ? <p className="pd-locked" role="status"><PinGlyph color={pinHex(player)} size={20} />Locked in · {waiting} of {live} in</p>
        : <button className="primary pd-lock" disabled={!draft || busy} onClick={lock}>{busy ? "Locking in…" : draft ? "Lock in my pin" : "Drop a pin first"}</button>}
    </>
  );
}
function MyResult({ game, playerId }) {
  const results = game.round.results, pin = results?.pins?.[playerId], closest = results?.closest?.includes(playerId), practice = !!game.tutorial;
  const me = playerOf(game, playerId), place = 1 + game.players.filter((p) => p.score > (me?.score ?? 0)).length;
  const revealed = useMemo(() => revealFor(game, playerId), [game.round?.clue?.id, game.index, !!game.tutorial, results]);
  return (
    <>
      <div className={`pd-my-result is-${tier(pin)}`}>
        <Stamp pin={pin} game={game} practice={practice} bonus={closest && !practice} />
        <div>
          <p className="pd-my-answer">{game.round.clue.answer}</p>
          <p className="pd-my-line">{pin ? `You were ${distance(game, pin.km)} off${closest ? ", the closest pin!" : "."}` : "You didn’t drop a pin."}</p>
          <p className="pd-my-line">{practice ? "Practice: nothing scores." : <>You’re in {ordinal(place)} place. Eyes on the TV!</>}</p>
        </div>
      </div>
      <div className="pd-phone-map is-reveal"><AtlasMap pack={game.pack} reveal={revealed} label="Map: your pin and the answer" /></div>
    </>
  );
}

export function PinDropPlayer({ game, playerId }) {
  const player = playerOf(game, playerId), round = game.round;
  const mapping = game.status === "playing" && !!round;
  const myTurn = round?.phase === "answer" && !lockedIn(game, playerId);
  useEffect(() => { if (myTurn) { try { navigator.vibrate?.(120); } catch {} } }, [myTurn, round?.clue?.id]);
  if (!player) return <main className="player pd pd-phone"><p className="pd-status-line">You’re no longer in this game.</p></main>;
  return (
    <main className={`player pd pd-phone${mapping ? " is-mapping" : ""}`}>
      <header className="pd-phone-bar">
        <Logo small />
        <span className="pd-phone-name"><PinGlyph color={pinHex(player)} size={18} />{player.name}<b>{points(player.score)}</b></span>
      </header>
      {!mapping ? <p className="pd-status-line">You’re in! The game starts when everyone’s here.</p> : (
        <>
          <Coach game={game} coach={PINDROP_COACH} place="phone" playerId={playerId} />
          <div className="pd-phone-clue">
            <p className="pd-clue-label">{roundLabel(game)}</p>
            <p className="pd-phone-clue-text">{round.clue.clue}</p>
            {round.phase === "answer" && <Clock game={game} />}
          </div>
          {round.phase === "reveal" ? <MyResult game={game} playerId={playerId} /> : <PinPicker key={roundKey(game)} game={game} playerId={playerId} player={player} />}
        </>
      )}
    </main>
  );
}

// ---------- Host controller ----------
export function PinDropController({ game, onAction }) {
  const round = game.round, secret = useSecret(game), step = game.tutorial?.step;
  const header = <header className="pd-phone-bar"><Logo small /><b className="pd-ctrl-code" aria-label={`Game code ${game.code}`}>{game.code}</b></header>;
  if (game.status === "lobby" || !round)
    return (
      <main className="controller pd pd-phone pd-ctrl">
        {header}
        <h1>Lobby</h1>
        <p className="pd-hint">Start the game from the main screen once players have joined. {settingsLine(game)}.</p>
        <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
      </main>
    );
  const answer = round.phase === "reveal" ? round.clue : secret;
  return (
    <main className="controller pd pd-phone pd-ctrl">
      {header}
      <Coach game={game} coach={PINDROP_COACH} place="controller" />
      <p className="pd-clue-label">{roundLabel(game)}</p>
      <p className="pd-ctrl-clue">{round.clue.clue}</p>
      <div className="pd-ctrl-status" role="status"><b>{round.phase === "answer" ? `${round.locked.length} of ${game.players.filter((p) => p.connected).length} locked in` : "Reveal"}</b><Clock game={game} /></div>
      <section className="pd-ctrl-answer">
        <h2>Answer</h2>
        {answer?.answer ? <p><b>{answer.answer}</b><small>{coords(answer)}</small></p> : <p className="pd-hint">Waiting for the answer…</p>}
      </section>
      {step !== "done" && <button className="wide on" onClick={() => onAction("next")}>{nextLabel(game)}</button>}
      {!game.tutorial && <RoundControls game={game} onAction={onAction} />}
      <section className="controller-players"><h2>Players</h2><PlayerTools game={game} onAction={onAction} /></section>
    </main>
  );
}

// ---------- End of game ----------
// Final standings, a round-by-round breakdown (each round's place and every player's points and distance), and Play
// again with new clues from the same map.
export function PinDropEnd({ game, host, display, onAction }) {
  const [busy, setBusy] = useState(false);
  const standings = ranked(game), tie = standings.length > 1 && standings[0].score === standings[1].score;
  const place = (p) => 1 + standings.filter((q) => q.score > p.score).length;
  useEffect(() => {
    const finished = game.events?.findLast((e) => e.type === "complete");
    if (display && finished && game.serverNow - finished.at < 15000) return playWinnersTune();
  }, [display]);
  const playAgain = () => {
    setBusy(true);
    const { clues } = dealClues(PLACES, { pack: game.pack, difficulty: game.difficulty, rounds: game.roundCount }, Math.random, readPlayed());
    rememberPlayed(clues.map((clue) => clue.id));
    onAction("replay", { clues });
  };
  const best = (round) => Math.max(0, ...Object.values(round.pins).map((pin) => pin.points + pin.bonus));
  return (
    <main className={`end pd pd-end${display ? " pd-tv" : " pd-phone"}`}>
      {display && <SoundToggle />}
      <Logo small={!display} />
      <h1 className="pd-winner">{!standings.length ? "Game over" : tie ? "It’s a tie!" : <><span>{standings[0].name}</span> wins!</>}</h1>
      <ol className="pd-podium">
        {standings.map((p) => (
          <li key={p.id} className={`is-place-${Math.min(place(p), 4)}`}>
            <span className="pd-podium-rank">{ordinal(place(p))}</span>
            <PinGlyph color={pinHex(p)} size={display ? 30 : 22} />
            <b>{p.name}</b>
            <span className="pd-podium-score">{points(p.score)}</span>
          </li>
        ))}
      </ol>
      {game.history.length > 0 && (
        <section className="pd-rounds" aria-label="Round by round">
          <h2>Round by round</h2>
          <div className="pd-rounds-scroll">
            <table>
              <thead><tr><th scope="col">Round</th>{standings.map((p) => <th key={p.id} scope="col"><PinGlyph color={pinHex(p)} size={16} />{p.name}</th>)}</tr></thead>
              <tbody>
                {game.history.map((round) => (
                  <tr key={round.index}>
                    <th scope="row"><span className="pd-round-num">{round.index + 1}</span>{answerLabel(round.clue.answer)}</th>
                    {standings.map((p) => {
                      const pin = round.pins[p.id], total = pin ? pin.points + pin.bonus : 0;
                      return <td key={p.id} className={pin && total === best(round) && total > 0 ? "is-best" : ""}>{pin ? <><b>{points(total)}</b><small>{distance(game, pin.km)}{round.closest.includes(p.id) ? " · closest" : ""}</small></> : <span className="pd-none">no pin</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {host ? (
        <div className="pd-end-buttons">
          <button className="primary" disabled={busy} onClick={playAgain}>{busy ? "Dealing clues…" : "Play again with new places"}</button>
          <a href="./" onClick={() => sessionStorage.removeItem("displayCode")}>Back to Game Night</a>
        </div>
      ) : (
        <div className="pd-end-buttons"><p>Thanks for playing!</p><button className="primary" onClick={() => { clearPlayerSession(); location.assign("./"); }}>Join another game</button></div>
      )}
    </main>
  );
}
