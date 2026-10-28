// QR codes that take a phone straight to the "type your name" join screen for one game.
import React, { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { SERVER } from "./shared";
import Flap from "./Flap";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const stripProtocol = (url) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
// This page's address without the query string, e.g. https://raagna.github.io/jeopardy-party/
const pageBase = (host = location.host) => `${location.protocol}//${host}${location.pathname}`;

// The address phones should open. On localhost that's this computer's Wi-Fi address (phones can't open "localhost").
export function useJoinBase() {
  const local = LOCAL_HOSTS.has(location.hostname);
  const [base, setBase] = useState(() => pageBase());
  useEffect(() => {
    if (!local) return;
    let cancelled = false;
    fetch(`${SERVER}/lan`)
      .then((response) => response.json())
      .then(({ addresses }) => {
        // Prefer a typical home/office network address over VPN or virtual adapters.
        const pick = addresses.find((ip) => ip.startsWith("192.168.")) || addresses.find((ip) => ip.startsWith("10.")) || addresses[0];
        if (pick && !cancelled) setBase(pageBase(`${pick}${location.port ? `:${location.port}` : ""}`));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [local]);
  return base;
}
export const joinLink = (base, code) => `${base}?join=${encodeURIComponent(code)}`;
export const displayAddress = (base) => stripProtocol(base);

export function QRCode({ value, label, className = "" }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++)
      for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col + 4},${row + 4}h1v1h-1z`;
    return { size: count + 8, path: d };
  }, [value]);
  return (
    <svg className={`qr ${className}`} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#0b0b0d" />
    </svg>
  );
}

// The lobby's join row: the room code on six big flaps beside a QR code, and the address for anyone who'd rather
// type. The code flips in when the lobby opens.
export function LobbyJoin({ code }) {
  const base = useJoinBase();
  return (
    <>
      <div className="lobby-join">
        <p className="lobby-code-label" aria-hidden="true">Room code</p>
        <Flap className="lobby-code" text={code} intro label={`Room code ${code.split("").join(" ")}`} />
        <figure className="qr-card">
          <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} />
          <figcaption>Scan to join</figcaption>
        </figure>
      </div>
      <p className="lobby-url">Or open <b>{displayAddress(base)}</b> on your phone and key in the code.</p>
    </>
  );
}

// The small "join" corner shown on the main screen once a game is under way, for late arrivals.
export function JoinCorner({ code }) {
  const base = useJoinBase();
  return (
    <div className="join-hint">
      <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} className="qr-small" />
      <span>Join at <b>{displayAddress(base)}</b> <Flap className="code-chip" text={code} label={`code ${code.split("").join(" ")}`} /></span>
    </div>
  );
}

// Players in a lobby as departure rows: one row per player (name, then any other columns, then their status),
// and an open seat in dim letters while there's room. state: "ready", "away" or "open".
export function Departures({ head, rows, openCells, many = 4, cols }) {
  const all = openCells ? [...rows, { key: "open", state: "open", label: "An open seat", cells: openCells }] : rows;
  const isMany = all.length > many, style = cols ? { "--dep-cols": cols } : undefined;
  const heading = (key) => <div className="departures-head" key={key}>{head.map((h) => <span key={h}>{h}</span>)}</div>;
  return (
    <div className={"departures-wrap" + (isMany ? " is-many" : "")} style={style}>
      <div className="departures-heads label" aria-hidden="true">{isMany ? [heading(0), heading(1)] : heading(0)}</div>
      <ol className={"departures" + (isMany ? " is-many" : "")}>
        {all.map((row) => (
          <li key={row.key} className={`is-${row.state}`} aria-label={row.label}>
            {row.cells.map((cell, i) => (cell?.type === "button" ? <React.Fragment key={i}>{cell}</React.Fragment> : <span key={i} className={i === row.cells.length - 1 ? "dep-status" : undefined}>{cell}</span>))}
          </li>
        ))}
      </ol>
    </div>
  );
}
