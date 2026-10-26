---
name: Game Night
description: TV game shows for a shared screen and a room of phones, built as a pinball cabinet.
colors:
  cabinet: "#120a22"
  cabinet-deep: "#08040f"
  panel: "#170d2b"
  panel-raised: "#22143d"
  field: "#0f0820"
  line: "rgb(214 196 255 / 0.14)"
  line-strong: "rgb(214 196 255 / 0.3)"
  text: "#f7f1ff"
  text-muted: "#b9abd6"
  chrome-hi: "#f4f6fa"
  chrome: "#c4cad4"
  chrome-lo: "#6d7380"
  chrome-dark: "#343844"
  art-magenta: "#ff2f8e"
  art-violet: "#7a1fd0"
  art-night: "#1a0b3d"
  dmd: "#ff8a24"
  dmd-dim: "rgb(255 138 36 / 0.16)"
  dmd-bg: "#140800"
  dmd-hurry: "#ff5a3c"
  gold: "#ffd23f"
  on-gold: "#1f1300"
  jeopardy-art: "#1d3bd6"
  jeopardy-cell: "#0b1f8c"
  jeopardy-cell-hover: "#1430a8"
  jeopardy-board: "#020722"
  survey-lamp: "#ff8a3d"
  on-survey-lamp: "#2a1205"
  survey-art: "#c2410c"
  wheel-lamp: "#ff4fa3"
  on-wheel-lamp: "#2a0718"
  wheel-art: "#b0177a"
  fib-lamp: "#3ddc97"
  on-fib-lamp: "#04261a"
  fib-art: "#0e7a55"
  price-lamp: "#46b6ff"
  on-price-lamp: "#031a2e"
  price-art: "#0b4f9e"
  tongue-lamp: "#b8f04a"
  on-tongue-lamp: "#1a2600"
  tongue-art: "#4d7a00"
  green: "#17a35f"
  green-text: "#6ff0b0"
  red: "#e0303e"
  red-text: "#ff9aa2"
  card-paper: "#f4ecd9"
  card-ink: "#22132f"
typography:
  display:
    fontFamily: "Archivo Black, Arial Black, sans-serif"
    fontSize: "clamp(2.5rem, 9vw, 7rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Archivo Black, Arial Black, sans-serif"
    fontSize: "clamp(2rem, 4.6vw, 4.4rem)"
    fontWeight: 400
    lineHeight: 1.14
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Archivo Black, Arial Black, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
  dmd:
    fontFamily: "Doto, ui-monospace, monospace"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0"
    fontFeature: "\"tnum\""
rounded:
  cell: "4px"
  dmd: "6px"
  sm: "10px"
  md: "14px"
  card: "18px"
  lamp: "999px"
spacing:
  dot: "0.1em"
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "24px"
  2xl: "28px"
components:
  button-start:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.lamp}"
    padding: "0 24px"
    height: "48px"
  button-start-disabled:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text-muted}"
  chip-button:
    backgroundColor: "{colors.panel-raised}"
    typography: "{typography.label}"
    rounded: "{rounded.lamp}"
    padding: "0 14px"
    height: "36px"
  input-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "10px 13px"
    height: "46px"
  dmd-readout:
    backgroundColor: "{colors.dmd-bg}"
    textColor: "{colors.dmd}"
    typography: "{typography.dmd}"
    rounded: "{rounded.dmd}"
    padding: "0.1em 0.3em"
  code-input:
    backgroundColor: "{colors.dmd-bg}"
    textColor: "{colors.dmd}"
    typography: "{typography.dmd}"
    padding: "0.2em 0.3em"
  arrow-insert:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.text-muted}"
    padding: "0 24px 0 20px"
    height: "40px"
  arrow-insert-lit:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.on-gold}"
  table-lamp-lens:
    rounded: "{rounded.lamp}"
    width: "220px"
  score-plate:
    backgroundColor: "{colors.panel}"
    rounded: "12px"
    padding: "10px 14px 12px"
  setup-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "28px"
  jeopardy-cell:
    backgroundColor: "{colors.jeopardy-cell}"
    textColor: "{colors.gold}"
    rounded: "{rounded.cell}"
    padding: "8px"
---

# Design System: Game Night

## Overview

**Creative North Star: "The Pinball Cabinet"**

Game Night is a pinball cabinet. The shared screen is the backglass: airbrushed art glowing down from the top, rays fanning up from below, the whole screen framed in a chrome bezel. Every score, clock, code and verdict sits on an orange dot-matrix display. Choices are lit playfield inserts: arrows and round lenses that are dark when off and lit in the table's colour when on. Each phone carries the cabinet's domed start and flipper buttons. Each game is its own table, with its own lamp colour and its own backglass art, set on the cabinet's black-violet wood.

The TV and the home hub are where the show happens: chrome lettering, deep glass, lamps that brighten under the cursor. Phones, setup and the host controller are the cabinet's apron: dark glass panels with one obvious lit button at a time. Jeopardy!'s blue-and-gold board and Survey Says!' answer board keep their show looks inside the cabinet's chrome, because each game should still evoke its show.

The system rejects flat, rounded party cards on a purple ground. Depth here comes from physical materials (chrome, glass, lenses, plasma dots), not from floating cards.

**Key Characteristics:**
- Black-violet cabinet ground with a violet glow at the top.
- Chrome trim drawn as a stepped metal ramp, used for bezels and display lettering.
- One orange dot-matrix display for every score, clock, code and verdict, and nowhere else.
- Lamp states (off, lit, flashing) that never rely on colour alone.
- Per-game tables that swap one lamp colour and one art colour.

## Colors

A dark cabinet of violet-black glass, lit by one orange plasma display and one lamp colour per table, with chrome around everything that frames.

### Primary
- **Table Lamp Gold** (gold): the default lamp colour and Jeopardy!'s money. Lights the start button, selected tabs and chips, the whose-turn plate, focus rings and the connection banner. On other tables, the table's own lamp colour replaces it through `--table`.
- **Plasma Orange** (dmd): the dot-matrix display's lit dots. Used only on Doto readouts on their dark grille (dmd-bg), with unlit dots in dmd-dim. When a clock is in its last five seconds it turns Hurry-Up Red (dmd-hurry) and flashes.

### Secondary
- **Chrome** (chrome-hi, chrome, chrome-lo, chrome-dark): solid steps of polished metal. chrome-lo and chrome ring readouts and lenses, chrome-dark is the skirt under domed buttons. The full chrome ramp (a gradient with a hard reflection line just past the middle) paints bezels and the chrome face paints lettering; both live in the sidecar.

### Tertiary
- **House Art** (art-magenta, art-violet, art-night): Game Night's own backglass, a magenta burst over violet night. art-magenta is also the text selection colour; art-night is the outline of the chrome lettering.
- **Table colours**: each game pairs a lamp, the ink on that lamp and an art field. Jeopardy! is gold on Show Blue (jeopardy-art), Survey Says! is survey-lamp on survey-art, Spin & Solve is wheel-lamp on wheel-art, Fib or Fact is fib-lamp on fib-art, Price Check is price-lamp (sky blue) on price-art, and Tip of the Tongue is tongue-lamp (lime) on tongue-art. Survey teams (#ff6b6b, #4cc9f0) and Spin & Solve contestant colours are game-local and stay in their game stylesheets.
- **Show Blue Board** (jeopardy-cell, jeopardy-cell-hover, jeopardy-board): Jeopardy!'s board, kept from the show. Survey Says! slots and Fib or Fact options use the same blue family.

### Neutral
- **Cabinet** (cabinet, cabinet-deep): the page ground, a vertical fade from cabinet to cabinet-deep under a violet glow at the top.
- **Glass** (panel, panel-raised, field): panel for cards and plates, panel-raised for pills, unlit buttons and list rows, field for inputs and inset wells.
- **Lines** (line, line-strong): hairlines in a lilac tint. line-strong outlines inputs and chips.
- **Text** (text, text-muted): near-white lilac and a muted lavender for secondary copy.
- **Instruction Card** (card-paper, card-ink): the printed card on the apron, the only light surface in the system.
- **Verdicts** (green, green-text, red, red-text): green and red fill buttons and marks; their -text tints carry the words.

### Named Rules
**The One Display Rule.** Plasma orange on a dot grille means "the machine is telling you something": a score, clock, code, round or verdict. Never use Doto or dmd orange for body text, headings or buttons. The one exception is the JOIN lamp, which closes the join strip's code display.

**The Table Swap Rule.** A game recolours the cabinet only through `--table`, `--on-table` and `--table-art` on its root. Components read those variables. They never hard-code a game's colour.

## Typography

**Display Font:** Archivo Black (with Arial Black, sans-serif)
**Body Font:** DM Sans (with system-ui, sans-serif)
**Label/Mono Font:** Doto 800 (with ui-monospace, monospace), the dot-matrix

**Character:** Archivo Black is the backglass's heavy chrome lettering. DM Sans is the cabinet's printed small type. Doto is the plasma display, uppercase and tabular.

### Hierarchy
- **Display** (Archivo Black, clamp(2.5rem, 9vw, 7rem), 1): the GAME NIGHT title and game brands, always as chrome lettering. Brand lockups in setup and display bars run 1.35rem to 2.6rem.
- **Headline** (Archivo Black, clamp(2rem, 4.6vw, 4.4rem), 1.14, -0.015em): the clue on the TV, Survey questions, Fib clues, balanced wrapping.
- **Title** (Archivo Black, 1.5rem, -0.01em): round titles (in the table colour), setup and join headings, confirm dialogs.
- **Body** (DM Sans 400–500, 1rem, 1.45): instructions, hints, status cards. The tagline stays under 46ch.
- **Label** (DM Sans 700, 0.875rem): field labels, chips, tabs, player names. Buttons use 700–800.
- **DMD** (Doto 800, uppercase, line-height 1.2, tabular numbers): readouts from 1rem (code chip) to clamp(3.6rem, 9vw, 6rem) (lobby code).

### Named Rules
**The Whole-Dot Rule.** Doto draws on a 0.1em dot grid. Each glyph's dot centres sit half a pitch in from the pen origin and the baseline, with an ascent of 0.95em and a descent of 0.25em. So every readout sets its grille to `background-size: 0.1em 0.1em` at `background-position: 0 0.05em`, uses `line-height: 1.2` and `letter-spacing` in 0.1em steps, pads in 0.1em steps (0.1em 0.3em is standard) and shrink-wraps its box (`inline-block` or `width: fit-content`). Lit dots then land exactly on grille dots. Never centre-stretch a readout or pad it in px.

**The Chrome Lettering Rule.** Display type that names the show or a table is chrome: the chrome face clipped into the letters, a 1px art-night stroke, stacked 1px drop steps (#9aa1ad, #5c6270, #2a2e38) for the bevelled edge and a soft shadow underneath, skewed -6° to -7°. Per-game brands swap the face for one built from the table colour.

## Layout

Each surface has its own column. The hub is up to 1240px wide, setup 1180px, the lobby 820px, the host controller 560px and player and join phones 480px. The TV display fills the viewport with 24px 32px 44px padding inside a fixed 10px chrome frame. Spacing steps observed in the build are 6, 10, 14, 18, 24 and 28px. Dot-matrix readouts use their own 0.1em step.

The hub's first viewport is the backglass, holding the chrome title, a tagline and four table lamps in a row of four. Below the glass sit the join strip and then the printed instruction card. Below 1020px the lamps become a 2×2 grid. Below 760px they become rows (small lens, name and count, arrow), so the join strip rises close to the top for players.

**The 720p Rule.** On TV screens shorter than 800px, the display tightens. Top padding drops to 14px and score plates become one row (name and score side by side). The lobby QR code and code scale with viewport height (24vh, 11vh). Spin & Solve's podiums turn to single rows and its board steps down a size. A whole board plus its scores must fit at 1280×720 without scrolling.

Below 760px, setup collapses to one column, the Jeopardy board drops to `--cols-small` columns and the display bar wraps the join hint under the brand.

## Elevation & Depth

Depth is physical, not floating. Chrome bezels frame glass. Readouts are recessed: an inner shadow (inset 0 2px 6px at 0.8 black) cut into the panel, then a dark gasket and a chrome-lo ring. Lamps and lenses are lit from inside, with radial gradients that have a hot centre and a darkened rim. Domed buttons sit on a 3px chrome-dark skirt directly below them, so they press down 2px when active. Ambient drop shadows are soft and dark (the cabinet `--shadow`) and appear only under framed objects.

### Shadow Vocabulary
- **Cabinet shadow** (`0 2px 4px rgb(0 0 0 / 0.4), 0 14px 34px rgb(0 0 0 / 0.45)`): under bezels, dialogs and the QR card.
- **Bezel** (`inset 0 1px 0 rgb(255 255 255 / 0.1), 0 0 0 1px #0a0b10` plus the cabinet shadow): chrome-bordered panels such as the setup card and the board.
- **Readout recess** (`inset 0 2px 6px rgb(0 0 0 / 0.8), 0 0 0 2px #2a2a2e, 0 0 0 3px var(--chrome-lo)`): every framed dot-matrix readout.
- **Domed button** (`inset 0 2px 0 rgb(255 255 255 / 0.45), inset 0 -4px 0 rgb(0 0 0 / 0.22), 0 3px 0 var(--chrome-dark), 0 6px 14px rgb(0 0 0 / 0.5)`): the start button and lit lamps.

### Named Rules
**The Lit-From-Inside Rule.** A lit lamp glows through its lens, with a lighter centre and a darker rim. It does not get a halo around it. At rest, hub lenses sit at brightness 0.86. Hover or focus lights them full and lifts them 4px.

**The Vertical Skirt Rule.** The only hard-edged offsets are vertical steps directly below an object: the skirt of a domed button and the bevel of chrome lettering. They read as metal thickness. Never offset them sideways.

## Shapes

The cabinet uses four shapes. Lamps are round: lenses, the buzzer, Survey round lenses and the whose-turn dot. Buttons and chips are domed pills (999px). Glass panels have softly rounded corners (10–18px). The backglass is 30px 30px 12px 12px, wider at the top like a real backglass. Playfield arrow inserts are square-cut and clipped to an arrow point (`clip-path` with a 14px point and a 10px notch). Show boards use tight 4px cells inside a chrome bezel. Chrome borders are drawn as a 6–11px transparent border with the chrome ramp painted into `border-box`.

## Components

### Buttons
Domed cabinet buttons, physical and pressable.
- **Shape:** full pill (999px), min-height 48px. On phones, lobby and join, 54–58px.
- **Start (primary):** the table lamp colour with the on-table ink, weight 800, on the domed-button shadow.
- **Hover / Active:** brightness 1.1 on hover. Active presses down 2px and the skirt shrinks to 1px.
- **Disabled (unlit):** the colour drains to panel-raised glass with a line-strong ring, so "not yet" never reads as a faded "yes".
- **Secondary:** a 10px-radius outline in line-strong that fills with panel-raised on hover.
- **Chip button:** a 36px pill on panel-raised. Add is green and subtract or danger is a red-text outline.
- **Phone wide buttons:** full-width 58px pills. The "on" state is a green dome lit from inside.
- **Buzzer:** a round dome (290px max) set in a chrome ring stack. Its ready state is red lit from inside.

### Chips
- **Style:** pills with a line hairline and muted text. Pressed chips fill with gold and gold ink.
- **Tabs:** pills. The active tab is lit in the table colour with an inset highlight. Randomize uses a dashed edge.

### Cards / Containers
- **Setup card (the apron):** dark panel glass inside a 6px chrome-ramp border, 18px radius, bezel shadow, 28px padding (20px 16px on mobile).
- **Score plate:** panel, line-strong hairline, 12px radius, name above a framed DMD score. On the current turn the plate is gold-edged with a 14% gold wash and a filled gold dot before the name. An away player's plate is 0.55 opacity with a dashed edge.
- **Instruction card:** printed paper (card-paper and card-ink), 6px radius, uppercase Archivo Black headings with a 2px ink rule.

### Inputs / Fields
- **Style:** field glass, a line-strong 1px border, 10px radius, min-height 46px, 16px text, a dmd caret.
- **Focus:** the border turns the table colour. Global focus is a 3px gold outline offset 3px.
- **Code input:** keyed straight into the dot-matrix. Doto at 1.9rem (2.4rem on the hub), 0.3em letter-spacing, a recessed dmd-bg well, and placeholder dots at 0.32 alpha.

### Navigation
- **Back to hub:** muted DM Sans 700 with the drawn arrow. Hover brightens it to text.
- **Hub tables:** the table lamps (below) are the main navigation.

### Dot-Matrix Readout (signature)
Plasma orange Doto on a dmd-bg ground with a 0.1em radial dot grille in dmd-dim, set in the readout recess with a 6px radius. Clocks, scores, codes, round labels, categories and verdicts all use it. A secondary value inside a readout (a clue's dollar value, a round's points) switches to gold. In the last five seconds a clock turns hurry red and flashes in two steps per second. A paused clock dims to 0.45 alpha.

### Table Lamp (signature)
The hub's game picker. A round lens up to 220px across, lit from below with a hot centre and a dark bevelled edge, framed by a 4px gasket and chrome rings. It holds the table's drawn glyph (a 48-unit SVG, 3px round stroke). The table name is set over the lens in Archivo Black, with the player count printed on the glass beneath. The Jeopardy! lens uses Show Blue with gold lettering. At rest the lens is dimmed. Hover and focus light it full and lift it 4px.

### Playfield Inserts (signature)
Setup choices are inserts. Arrow inserts (question packs, game length, rounds) are clipped to an arrow shape, in dark violet glass when off and lit with the table colour's radial glow when on. Each holds a 10px lamp ring that is hollow when off and filled when on, so state never rests on colour alone. Because the arrow clip hides any outside outline, keyboard focus is drawn inside it (3px gold, offset -6px, brightness 1.25). Survey round lenses are 60px round lamps: a dark lens with a thin chrome-lo ring when off, and lit with a thick chrome ring when on.

### Join Grille (signature)
The strip under the backglass: a 7px chrome-ramp border around near-black glass, holding the code input and the JOIN lamp. The lamp is an orange dome lettered in Doto. It stays unlit (dark, with dots at 0.3 alpha) until a code is keyed.

### Show Boards
The Jeopardy! board is a grid of 4px-radius blue cells (a #1029a3 to jeopardy-cell gradient) inside a 6px chrome bezel on jeopardy-board. Values are Archivo Black in gold with a 2px dark drop. Used cells go dark. The Survey Says! answer board is blue slots on navy inside a gold rule, with a white oval rank and gold points. Revealed slots flip in, and a team's colour shows as a 4px inner edge.

## Do's and Don'ts

### Do:
- **Do** put every score, clock, code, round label and verdict on a dot-matrix readout, sized and padded in whole 0.1em dots with the grille at `0 0.05em`.
- **Do** recolour a game only through `--table`, `--on-table` and `--table-art` on its root.
- **Do** pair every lamp state with a non-colour cue: a hollow versus filled lamp ring, a dashed edge for away or missed, a dot before the active name.
- **Do** frame anything that is the machine (boards, the setup apron, the join strip, the TV edge) in the chrome ramp painted into a transparent border.
- **Do** make unlit states dark glass, not faded colour.
- **Do** draw icons as inline SVG in the table glyphs' stroke (round caps and joins, 2.6–3px on a 24–48 unit box).
- **Do** keep Jeopardy!'s blue-and-gold board and the Survey answer board in their show looks inside the cabinet's chrome.
- **Do** compact the TV layout under 800px tall so a full board and its scores fit at 720p.

### Don't:
- **Don't** use Doto or plasma orange for prose, headings or ordinary buttons.
- **Don't** fake chrome with a flat grey or a single two-stop gradient. Use the ramp with its reflection line.
- **Don't** light a lamp or button with an outer halo. Light it from inside its lens. Show-moment flashes (the Survey strike X, the final countdown) are effects, not lamps, and are exempt.
- **Don't** offset a hard shadow sideways. The only hard steps are vertical skirts and lettering bevels.
- **Don't** let colour alone carry a state, team, or right versus wrong.
- **Don't** fall back to flat rounded party cards floating on a purple ground.
