# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Adult friends at a party or hangout. One person hosts: they open the site on the shared screen, set a game up and either run it from the host controller or let it run itself. Everyone else joins on their own phone by scanning a QR code and plays from the phone while watching the shared screen.

## Product Purpose

Game Night turns any screen and a room of phones into TV game shows: Jeopardy!, Survey Says! (Family Feud-style), Spin & Solve (Wheel of Fortune-style) and Fib or Fact (bluffing trivia), with a price-guessing game and a team word game planned. Success is a night where setup takes a minute, nobody needs an account or an app, and the room is watching the game, not fiddling with it.

## Positioning

Free and self-hosted. The phones are private screens: buzzers, secret inputs, votes and answers stay on each phone while the shared screen shows the show. Huge built-in content (every Jeopardy season, thousands of survey boards and puzzles), and every game plays with or without a human host.

## Operating Context

- Shared screen: varies night to night: a TV across the room, a laptop on a table, or a projector. It must read from a couch and in a dim room.
- Phones: whatever the guests bring, on the host's Wi-Fi, often locked or backgrounded mid-game (the app reconnects).
- The host may be playing too, so setup screens keep answers hidden.
- Sessions run an evening; games last 20–40 minutes.

## Capabilities and Constraints

- React + Vite client (GitHub Pages) and an Express + Socket.IO server; surfaces per game: setup, TV display, phone player, host controller, end screen; plus the Game Night home hub and the join screen.
- Sounds are synthesized in the browser; no audio files from the shows.
- Fan project, not affiliated with the shows: no show logos, trademarks or audio. Game names stay generic except Jeopardy!, which the app already uses.

## Brand Commitments

- Names: Game Night, Jeopardy!, Survey Says!, Spin & Solve, Fib or Fact.
- Each game should still evoke its show (the Jeopardy blue board, the survey answer board, the wheel); the user prefers this but has said everything visual is open to change.

## Evidence on Hand

No logos, photos or illustrations exist; everything visual is CSS and inline SVG. No testimonials or usage numbers.

## Product Principles

1. The shared screen is a stage: readable from across a room, dramatic at the moments that matter (reveals, wins).
2. The phone is a controller: one obvious action at a time, big touch targets, works one-handed.
3. Setup gets out of the way: sensible defaults, one button to a lobby.
4. Every game works with or without a host.
5. Never spoil: answers stay off every screen that players can see until the reveal.

## Accessibility & Inclusion

Text and contrast must hold up on a TV or projector viewed from a distance; colour is never the only signal for team, correct or wrong.
