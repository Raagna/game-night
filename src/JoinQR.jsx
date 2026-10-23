// QR codes that take a phone straight to the "type your name" join screen for one game.
import React, { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { SERVER } from "./shared";

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
      <path d={path} fill="#030a2a" />
    </svg>
  );
}

// The lobby's join panel: a big QR code, plus the address and code for anyone who'd rather type.
export function LobbyJoin({ code }) {
  const base = useJoinBase();
  return (
    <div className="lobby-join">
      <figure className="qr-card">
        <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} />
        <figcaption>Scan with your phone camera</figcaption>
      </figure>
      <div className="lobby-join-text">
        <p className="lobby-url">or open <b>{displayAddress(base)}</b> and enter</p>
        <div className="lobby-code">{code}</div>
      </div>
    </div>
  );
}

// The small "join" corner shown on the main screen once a game is under way, for late arrivals.
export function JoinCorner({ code }) {
  const base = useJoinBase();
  return (
    <div className="join-hint">
      <QRCode value={joinLink(base, code)} label={`QR code to join game ${code}`} className="qr-small" />
      <span>Join at <b>{displayAddress(base)}</b> <span className="code-chip">{code}</span></span>
    </div>
  );
}
