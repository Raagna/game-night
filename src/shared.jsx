// Pieces shared by the main app and the custom-board / Fast Money screens.
import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

export const SERVER =
  import.meta.env.VITE_SERVER_URL ||
  `${location.protocol}//${location.hostname}:3001`;
export const JOIN_URL = "raagna.github.io/jeopardy-party";
export const socket = io(SERVER, { autoConnect: true });
export const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
let soundContext;
export function tone(frequency, duration = .16, type = "sine", volume = .12) { try { const Audio=window.AudioContext||window.webkitAudioContext; soundContext ||= new Audio(); if(soundContext.state === "suspended") soundContext.resume(); const osc=soundContext.createOscillator(), gain=soundContext.createGain(); osc.type=type;osc.frequency.value=frequency;gain.gain.setValueAtTime(volume,soundContext.currentTime);gain.gain.exponentialRampToValueAtTime(.001,soundContext.currentTime+duration);osc.connect(gain).connect(soundContext.destination);osc.start();osc.stop(soundContext.currentTime+duration) } catch {} }
export function useClueMusic(active) { useEffect(()=>{ if(!active) return; let step=0; const notes=[262,330,392,330,294,349,440,349]; const play=()=>tone(notes[step++%notes.length],.3,"triangle",.035); play(); const id=setInterval(play,420); return()=>clearInterval(id) },[active]) }
export function ClueTimer({ deadline, serverNow }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const startedAt=Date.now(), startRemaining=Math.max(0,deadline-serverNow);
    const update=()=>setRemaining(Math.max(0,startRemaining-(Date.now()-startedAt)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [deadline,serverNow]);
  if (!deadline) return null;
  const seconds = Math.ceil(remaining / 1000);
  return <div className={"clue-timer" + (seconds <= 5 ? " is-low" : "")} role="timer" aria-label={`${seconds} seconds left`}>{seconds}</div>;
}
