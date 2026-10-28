// Pieces shared by the main app and the custom-board / Fast Money screens.
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import Flap from "./Flap";

export const SERVER =
  import.meta.env.VITE_SERVER_URL ||
  `${location.protocol}//${location.hostname}:3001`;
export const JOIN_URL = "raagna.github.io/jeopardy-party";
export const socket = io(SERVER, { autoConnect: true });
export const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
let soundContext;
// One AudioContext for every sound in the app. Browsers keep it silent until the page has been clicked or
// tapped, so the first click or key press anywhere wakes it up.
export function audioContext() { try { const Audio=window.AudioContext||window.webkitAudioContext; soundContext ||= new Audio(); if(soundContext.state === "suspended") soundContext.resume(); return soundContext } catch { return null } }
const unlockAudio = () => { audioContext(); if(soundContext?.state === "running") ["pointerdown","keydown"].forEach((type)=>window.removeEventListener(type,unlockAudio,true)) };
["pointerdown","keydown"].forEach((type)=>window.addEventListener(type,unlockAudio,true));
export function tone(frequency, duration = .16, type = "sine", volume = .12) { try { audioContext(); const osc=soundContext.createOscillator(), gain=soundContext.createGain(); osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(volume,soundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+duration);osc.connect(gain).connect(soundContext.destination);osc.start();osc.stop(soundContext.currentTime+duration) } catch {} }
export function useClueMusic(active) { useEffect(()=>{ if(!active) return; let step=0; const notes=[262,330,392,330,294,349,440,349]; const play=()=>tone(notes[step++%notes.length],.3,"triangle",.035); play(); const id=setInterval(play,420); return()=>clearInterval(id) },[active]) }
// Seconds under a minute show as "42"; longer clocks (Fast Money's 2:30) show minutes and seconds.
export const clockText = (seconds) => seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : String(seconds);
export function ClueTimer({ deadline, serverNow, frozenMs = null }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const startedAt=Date.now(), startRemaining=Math.max(0,deadline-serverNow);
    const update=()=>setRemaining(Math.max(0,startRemaining-(Date.now()-startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline,serverNow]);
  if (frozenMs != null) {
    const left = Math.ceil(frozenMs / 1000);
    return <div className={"clue-timer is-paused" + (left >= 60 ? " is-long" : "")} role="timer" aria-label={`Clock paused with ${left} seconds left`}><Flap text={clockText(left)} cells={left >= 60 ? 4 : 2} align="right" still /><small>Paused</small></div>;
  }
  if (!deadline) return null;
  const seconds = Math.ceil(remaining / 1000);
  // The clock turns over quietly until its last ten seconds, then every second clacks.
  return <div className={"clue-timer" + (seconds <= 5 ? " is-low" : "") + (seconds >= 60 ? " is-long" : "")} role="timer" aria-label={`${seconds} seconds left`}><Flap text={clockText(seconds)} cells={seconds >= 60 ? 4 : 2} align="right" still={seconds > 10} /></div>;
}

// "Submit this answer?" step. The server pauses the clock while it is open; "Go back" resumes it from the same point.
// The submit button ignores taps for a moment after opening so a double tap can't confirm by accident.
export function ConfirmSubmit({ game, playerId, answer, blankNote = "Blank — counts as a wrong answer", onConfirm, onCancel }) {
  const [armed, setArmed] = useState(false), [sawPause, setSawPause] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setArmed(true), 450); return () => clearTimeout(timer); }, []);
  useEffect(() => { if (game.clockPaused) setSawPause(true); }, [game.clockPaused]);
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const left = Math.ceil((game.pausedRemaining || 0) / 1000);
  const outOfPauses = (game.holdsUsed?.[playerId] || 0) >= 3 && !game.clockPaused && !sawPause;
  const clock = game.clockPaused ? `Clock paused · ${left}s left` : outOfPauses ? "No pauses left — the clock is running" : sawPause ? "Pause used up — the clock is running again" : "Pausing the clock…";
  return (
    <div className="confirm-backdrop">
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-answer">
        <h2 id="confirm-title">Submit this answer?</h2>
        <p id="confirm-answer" className={"confirm-answer" + (answer.trim() ? "" : " is-blank")}>{answer.trim() || blankNote}</p>
        <p className={"confirm-clock" + (game.clockPaused ? "" : " is-running")} role="status">{clock}</p>
        <div className="confirm-buttons">
          <button type="button" className="secondary" autoFocus onClick={onCancel}>Go back</button>
          <button type="button" className="primary" disabled={!armed} onClick={onConfirm}>Yes, submit</button>
        </div>
      </div>
    </div>
  );
}
