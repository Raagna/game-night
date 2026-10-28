---
name: Game Night
description: TV game shows for a shared screen and a room of phones, set on a split-flap departure board.
colors:
  board: "#16171a"
  flap-face: "#222327"
  flap-face-lo: "#1d1e21"
  flap-gap: "#0b0b0d"
  well: "#0e0f11"
  frame-hi: "#9da1a8"
  frame-lo: "#6f737a"
  steel-hi: "#a7aaaf"
  steel: "#8b8f96"
  steel-mid: "#5b5e63"
  steel-lo: "#2a2d31"
  rule: "#303237"
  rule-strong: "#45484e"
  paint: "#f2f2ee"
  paint-dim: "#6b6e75"
  lamp-house: "#e8a23a"
  on-lamp-house: "#1a1205"
  lamp-jeopardy: "#e2b54a"
  on-lamp-jeopardy: "#1c1405"
  lamp-survey: "#e08a3c"
  on-lamp-survey: "#1f1004"
  lamp-wheel: "#d4699d"
  on-lamp-wheel: "#22070f"
  lamp-fib: "#5fc9a0"
  on-lamp-fib: "#04201a"
  lamp-price: "#63ade0"
  on-lamp-price: "#041827"
  lamp-tongue: "#a9c94d"
  on-lamp-tongue: "#172005"
  lamp-budget: "#a993e3"
  on-lamp-budget: "#170c2e"
  show-blue: "#1b2a7a"
  show-blue-lo: "#172468"
  show-blue-used: "#0f1641"
  tile-face: "#e9e8e2"
  tile-face-lo: "#dcdbd4"
  tile-ink: "#131417"
  team-1: "#74a9d8"
  team-2: "#93c48b"
  contestant-3: "#d6bf72"
  contestant-4: "#b3a2dc"
  contestant-5: "#6cc3bd"
  contestant-6: "#c9a68a"
  number-ink: "#0d0e10"
  red: "#c6463c"
  red-text: "#ee7a6f"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.4rem, 6.4vw, 5.6rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
  flap:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1em"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2rem, 4.4vw, 4.1rem)"
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: "0.02em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.04em"
  body:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 400
    lineHeight: 1.45
  input:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "1.06rem"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "0.82rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.2em"
  key:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  flap: "0.06em"
  cell: "2px"
  sm: "3px"
  md: "4px"
  buzzer: "6px"
spacing:
  row-gap: "6px"
  sm: "10px"
  md: "16px"
  lg: "26px"
  frame: "clamp(8px, 2.9vmin, 26px)"
components:
  flap-cell:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.paint}"
    typography: "{typography.flap}"
    rounded: "{rounded.flap}"
    width: "0.74em"
    height: "1.18em"
  button-primary:
    backgroundColor: "{colors.lamp-house}"
    textColor: "{colors.on-lamp-house}"
    typography: "{typography.key}"
    rounded: "{rounded.sm}"
    padding: "0 30px"
    height: "50px"
  button-primary-disabled:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.paint-dim}"
    rounded: "{rounded.sm}"
  button-secondary:
    textColor: "{colors.paint}"
    rounded: "{rounded.sm}"
    padding: "0 20px"
    height: "46px"
  button-secondary-hover:
    backgroundColor: "{colors.flap-face}"
  choice-cell:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.steel-hi}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "42px"
  choice-cell-active:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.lamp-house}"
  input-field:
    backgroundColor: "{colors.well}"
    textColor: "{colors.paint}"
    typography: "{typography.input}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
    height: "48px"
  departure-row:
    backgroundColor: "{colors.well}"
    textColor: "{colors.paint}"
    rounded: "{rounded.cell}"
    padding: "0 14px"
    height: "52px"
  phone-key:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.paint}"
    rounded: "{rounded.sm}"
    height: "58px"
  phone-key-on:
    backgroundColor: "{colors.lamp-house}"
    textColor: "{colors.on-lamp-house}"
  buzzer:
    backgroundColor: "{colors.flap-face}"
    textColor: "{colors.paint-dim}"
    rounded: "{rounded.buzzer}"
    size: "min(76vw, 300px)"
  buzzer-ready:
    backgroundColor: "{colors.lamp-house}"
    textColor: "{colors.on-lamp-house}"
  jeopardy-cell:
    backgroundColor: "{colors.show-blue}"
    textColor: "{colors.lamp-jeopardy}"
    rounded: "{rounded.cell}"
---

# Design System: Game Night

## Overview

**Creative North Star: "The Concourse Departure Board"**

Every screen in Game Night is one matte split-flap board in a brushed steel frame, the departure board of a quiet station concourse at night. The shared screen is the board itself: codes, scores, clocks, categories, answers, titles and winners are set on flap cells that clack over, left to right, when they change. Phones are the ticket machine beside it: a small board on top carrying your score, and one big key at a time below. The ground values were taken from the user-chosen first-viewport sketch (`splitflap.html`, the TV lobby) and that is what shipped: a dark charcoal board rather than pure black, with lighter flap faces sitting on it.

The board is quiet so the data can be loud. There is no glow, no chrome bevel, no bolts, no gradients beyond the flap's two halves and the frame's brushed steel. Each game keeps exactly one lamp colour, the way a real board has one row-lamp colour; the house lamp is amber. Big moments are big because flaps get big (the six-cell room code, the winner's name), not because anything shines. Red is held back for strikes, fouls and fails only.

The system rejects the pinball cabinet it replaced (chrome lettering, sunburst rays, dot-matrix numbers, neon lamps and glows) and the category default of rounded party cards on purple.

**Key Characteristics:**
- One charcoal board (#16171a) inside a brushed steel frame on every screen.
- Data rides on split-flap cells; instructions and prose are set type, never flaps.
- One quiet lamp colour per game, set as `--table` on the game's root; red only for strikes, fouls and fails.
- State is row state: dim letters, white letters, lamp-coloured status plus a filled marker; never colour alone.
- Barlow Condensed for flaps and labels, Barlow Semi Condensed for prose, both self-hosted.

## Colors

A near-black charcoal board with lighter matte flap faces, steel greys for the frame and labels, one warm painted white for letters, and a single lamp colour per game.

### Primary
- **House Lamp Amber** (`lamp-house`): the default `--table`. Lights the screen's one main action, the turn marker, the timer's last seconds, ready status cells, selection and the caret. Ink on it is `on-lamp-house`.
- **Per-Game Lamps** (each game root re-sets `--table` / `--on-table`): Jeoparty Gold (`lamp-jeopardy`), Survey Orange (`lamp-survey`), Spin & Solve Magenta (`lamp-wheel`), Fib Mint (`lamp-fib`), Price Sky (`lamp-price`), Tongue Lime (`lamp-tongue`), Word Budget Lilac (`lamp-budget`), each with its own dark `on-lamp-*` ink. The same classes (`.row--survey` and so on) light the hub's departure rows. Components always read `--table`, never a game's literal hex.

### Secondary
- **Show Blue** (`show-blue` / `show-blue-lo`): the Jeoparty board only, a flap module in two halves of show blue with gold values; a played clue goes to blank `show-blue-used` cells. It is a game-specific module, not a house colour.
- **Puzzle Tile Pale** (`tile-face` / `tile-face-lo`, ink `tile-ink`): Spin & Solve's puzzle board only, the show's lit-but-blank tile.

### Tertiary
- **Team and Contestant Colours** (`team-1` steel blue, `team-2` sage; contestants add `contestant-3` straw, `contestant-4` lavender, `contestant-5` teal, `contestant-6` tan): quiet, desaturated and never red. They appear as a 3px top edge on a team's panel or podium and as the fill of a small number cell (ink `number-ink`). A team or contestant is always also carried by its number and name.

### Neutral
- **Board Charcoal** (`board`): the ground of every screen and dialog.
- **Flap Face** (`flap-face`, lower half `flap-face-lo`): the two matte halves of every flap cell, and the fill of choice cells, phone keys, status cards and disabled main actions.
- **Flap Gap** (`flap-gap`): the hairline across the middle of every flap where the halves meet, the board's 1px outer edge, and the dark ground behind flap modules (Jeoparty board, editor grid). It is a hairline and gap colour, not the cell colour.
- **Well** (`well`): recessed rows and fields: departure rows, hub rows, inputs, team panels, host tools.
- **Steel Frame** (`frame-hi` to `frame-lo`): the body background, a top-to-bottom gradient with a faint brushed line texture, visible as the frame around the board.
- **Steel Greys** (`steel-hi`, `steel`, `steel-mid`, `steel-lo`): secondary text, labels, hollow markers and outlines, and the 5px ring around flap modules.
- **Rules** (`rule`, `rule-strong`): 2px dividers between board sections; 1px field and hover borders.
- **Paint White** (`paint`): letters on flaps and primary text; also the QR card's ground.
- **Dim Paint** (`paint-dim`): waiting, away, empty and disabled letters.

### Red
- **Strike Red** (`red`) and **Red Text** (`red-text`): strikes, fouls, fails, over-budget, Bankrupt, wrong verdicts, danger keys and the incorrect flash. Red always comes with a mark (an X cell, a strike count, a struck-through response), never as colour alone.

### Named Rules
**The One Lamp Rule.** A game has one lamp colour, set once as `--table` on its root. Everything lit on that game's screens uses `var(--table)`; a second accent is a defect.

**The Red Is Bad News Rule.** Red appears only for strikes, fouls, fails and destructive actions. Teams, contestants and lamps are never red.

**The Charcoal Not Black Rule.** The board is `board` charcoal and flap faces are lighter than the board. `flap-gap` black is reserved for hairlines, edges and gaps; it is never the fill of a cell.

## Typography

**Flap and Label Font:** Barlow Condensed 500 / 600 / 700 (with Arial Narrow, sans-serif)
**Body Font:** Barlow Semi Condensed 400 / 500 / 600 (with Arial Narrow, sans-serif)

Both are self-hosted through `@fontsource` packages imported in `src/main.jsx`; no font loads from a CDN.

**Character:** a condensed grotesk in tracked capitals, like the painted letters on a station board, paired with its semi-condensed sibling for anything that is read rather than glanced at.

### Hierarchy
- **Display** (600, up to clamp(2.4rem, 6.4vw, 5.6rem), on flaps): the winner's name, the hub title, the six-cell room code (clamp(64px, 15vh, 138px)). Big moments are big flaps.
- **Flap** (600, 1em, line-height 1, uppercase, no tracking): the type on every cell. Its size comes from wherever the flap sits, because a cell is sized in em (0.74em by 1.18em).
- **Headline** (600, clamp(2rem, 4.4vw, 4.1rem), 1.14, 0.02em, uppercase, balanced, max 26ch): a clue or question on the TV, set type.
- **Title** (600, 1.7rem to 2rem, 1.1, 0.04em, uppercase): setup, join and controller headings.
- **Body** (Semi Condensed 400, about 1.06rem, 1.45, max about 68ch): instructions, how-to-play, hints and notes, in steel-hi or paint.
- **Label** (600, 0.82rem, 0.2em tracking, uppercase, steel): board legends beside a datum (Bank, Clock, Total, Words left), column heads of departure rows, field labels.
- **Key** (700, about 1.05rem, 0.12 to 0.16em, uppercase): the text on main actions, phone keys and the buzzer.

### Named Rules
**The Flaps Carry Data Rule.** Codes, scores, clocks, answers, titles and names-in-lights go on flap cells. Instructions, prose and clue text are set type, never flaps.

**The Tracked Capitals Rule.** Barlow Condensed is always uppercase; tracking widens as size drops (0 on flaps, 0.02 to 0.06em on headings and row names, 0.1 to 0.24em on labels and keys). Barlow Semi Condensed stays in sentence case.

## Layout

The steel frame is body padding (`frame`, clamp(8px, 2.9vmin, 26px)); every screen root fills the viewport inside it as one board. Board sections are divided by 2px `rule` lines, not boxes.

- **TV display:** a header row (game name on flaps with its lamp, the join corner, the clock) over a 2px rule, the game's stage, and scores along the foot of the board. A bottom rail carries Sound, Back to settings and Host controller as quiet steel labels, with Start game as the one lit cell bottom-centre in the lobby. At heights of 800px and below the display tightens (smaller code and QR, slimmer rows) so a 720p TV fits without scrolling.
- **Lobby:** the room code on six big flaps with the QR card beside it, then players as departure rows (player, team, status), two columns when the room is full.
- **Hub:** a departure board of games (lamp, name on flaps, how many play, a Set up cell), the code entry under it, and how-to-play in set type below. On phones the code entry moves to the top.
- **Phone and join:** a single column, max 480px, centred; a small board on top and one big key at a time. The host controller is max 560px.
- **Setup:** max 1180px content with the game's name as the header row, settings as set type and choice cells.
- **Rhythm:** rows stack with a 6px gap (`row-gap`) like board rows; component padding sits at 10 to 16px; section breaks at 22 to 26px. Narrow breakpoints at 760px (and 720px for the TV rail, 1020px for the hub's columns).

## Elevation & Depth

The board is flat. Depth comes from tone (well below board below flap face), from the flap's two-tone halves and its hairline, and from ring outlines rather than drop shadows.

### Shadow Vocabulary
- **Board edge** (`box-shadow: 0 0 0 1px #0b0b0d, inset 0 1px 0 rgb(255 255 255 / 0.04), 0 1px 0 1px rgb(255 255 255 / 0.12)`): every screen root, seating the board in the frame.
- **Flap module ring** (`box-shadow: 0 0 0 1px #000, 0 0 0 5px var(--steel-lo)`): the Jeoparty board and other modules, a steel band around a `flap-gap` ground.
- **Key underside** (`box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.22)` on main actions, `inset 0 -6px 0 rgb(0 0 0 / 0.35)` on the buzzer): a pressed-plastic lip; press moves the key down 1 to 3px.
- **Lit outline** (`box-shadow: inset 0 0 0 2px var(--table)`): the winner's row, the team in control, the hovered Jeoparty cell.
- **Dialog** (`box-shadow: 0 0 0 1px #0b0b0d, 0 0 0 9px var(--frame-lo), 0 0 0 10px var(--frame-hi), var(--shadow)`): a small board in its own steel frame; the only place `--shadow` is used.

### Named Rules
**The No Glow Rule.** Lamps are flat fills. No outer glow, no blur halo, no neon text-shadow. The only brightness change is the momentary flash on a falling flap (`brightness(1.6)` at the start of the fall).

## Shapes

Nearly square. Flap cells round by 0.06em; board cells and rows by 2px; buttons and fields by 3px; cards by 4px; the buzzer by 6px. The only circles are lamps (the game's lamp dot in its name and hub row). Row markers are small squares, hollow when off and filled when on, so selection never depends on colour alone; dashed borders mean away, passed or empty.

## Components

### Flap Cell (signature)
The board's one moving part (`src/Flap.jsx`). One cell per character, two matte halves (`flap-face` over `flap-face-lo`) with a `flap-gap` hairline at the middle, paint letters, uppercase.
- **Cascade:** only changed cells flip. Each starts a stagger after its left neighbour (18 to 45ms, 900ms divided by length), runs 1 to 3 drum characters at 55ms each, then lands; each step falls from the hinge in 70ms.
- **Strip:** a whole-word flap (a destination name) turns over once in 200ms.
- **Reduced motion:** a single 240ms crossfade, no cascade.
- **Sound:** a synthesized clack (`playClack` in `src/survey/sounds.js`) only on the TV, through the TV's own mute; phones and setup flip silently.
- **Modules:** the Jeoparty board (show-blue cells, gold values), the Survey Says! answer board and the Spin & Solve puzzle board (pale tiles) are literal flap modules.

### Brand
The game's lamp dot followed by its name on flaps; the header row of every board.

### Buttons
- **Shape:** gently squared (3px).
- **Primary (the one lit cell):** lamp fill with on-lamp ink, Key type, 50px tall, 0 30px padding. Hover brightens 7%; press drops 1px. One per screen.
- **Disabled:** a dark flap-face cell with dim letters and a rule-strong inset ring, so "not yet" never reads as a faded "yes".
- **Secondary:** transparent with a 1px steel-mid border, 46px; hover fills flap-face.
- **Chip button:** 36px, the same outline; `add` takes the lamp, `danger` and `subtract` take red text with a red border.

### Choice Cells
Tabs, packs, rounds and options: flap-face cells with a square row marker, steel-hi letters. Selected: lamp letters, lamp border, a 9% lamp tint and a filled marker.

### Inputs / Fields
- **Style:** well fill, 1px rule-strong border, 3px radius, 48px tall, Semi Condensed 500.
- **Focus:** border and a 1px ring in the lamp colour; caret in the lamp colour.
- **Code entry:** six flap cells with the real input laid over them; a lamp bar marks the next cell.

### Departure Rows
Lobby players and hub games as board rows: well fill, 52px tall, each datum on its own flap cells. Ready: white letters, lamp-coloured status cell with a filled marker. Away: dim letters, dashed marker. Open seat: dim letters, hollow marker. Hub rows light their Set up cell in the game's lamp on hover and focus.

### Scores
Along the foot of the board: a tracked name with a square marker, then the score on flaps. Whose turn: lamp name and filled marker. Away: dim letters and a dashed marker. Team panels and podiums carry the team or contestant colour as a 3px top edge and a number cell; the team in control adds the lamp outline.

### Phone Keys and Buzzer
Ticket-machine keys: full-width 58px flap-face keys with a steel border and an underside lip; lit keys take the lamp. The buzzer is a big square key (min(76vw, 300px)) inside a well ring and a steel ring; dark with dim letters until live, lamp-lit when ready.

### Dialogs
A small board (`board` fill, 2px radius) in its own steel frame over an 80% dark backdrop.

## Do's and Don'ts

### Do:
- **Do** set every screen on the `board` charcoal inside the steel frame, with flap faces lighter than the board.
- **Do** put data on flap cells and prose in Barlow Semi Condensed set type.
- **Do** read the lamp through `var(--table)` / `var(--on-table)` and set each game's pair once on its root.
- **Do** carry every state with a second cue: filled versus hollow markers, dim versus white letters, number cells for teams, X cells and strike counts for misses.
- **Do** flip only the cells that change, and collapse the cascade to one 240ms crossfade under reduced motion.
- **Do** keep the clack on the TV only, behind the TV's mute.

### Don't:
- **Don't** use `flap-gap` (#0b0b0d) as a cell fill; it is the hairline, edge and gap colour.
- **Don't** use red for anything but strikes, fouls, fails and destructive actions; never for a team, contestant or lamp.
- **Don't** add glow, chrome lettering, sunburst rays, dot-matrix numbers or neon lamps (the pinball cabinet this replaced).
- **Don't** use rounded party cards on purple.
- **Don't** give a game a second accent alongside its lamp.
- **Don't** set instructions or paragraphs on flaps.
