// A host's double tap: the same ruling (same action, same details) sent twice within TAP_MS, from either host screen.
// The second is ignored, so one tap on Strike, Got it, Next or a reveal can't count twice. Deliberate repeats (two
// wrong answers in a row) are never that close together. Score adjustments and renames aren't rulings, and tapping
// +100 three times means +300, so they always go through.
export const TAP_MS = 700
const ALWAYS = new Set(['adjustScore', 'renamePlayer', 'renameTeam'])

export function isRepeatTap(last, action, payload, now) {
  return !ALWAYS.has(action) && !!last && last.key === tapKey(action, payload) && now - last.at < TAP_MS
}
export const tapKey = (action, payload) => `${action}:${JSON.stringify(payload ?? {})}`

// Records this host action on the game and says whether it's a repeat to ignore.
export function repeatHostTap(game, action, payload, now = Date.now()) {
  const repeat = isRepeatTap(game.lastHostTap, action, payload, now)
  game.lastHostTap = { key: tapKey(action, payload), at: now }
  return repeat
}
