---
version: 1
slug: "src-hub-jsx"
primary_target: "src/Hub.jsx"
related_targets: ["src/styles.css","src/main.jsx","src/shared.jsx","src/survey/SurveySays.jsx","src/wheel/SpinSolve.jsx","src/fib/FibOrFact.jsx","src/price/PriceCheck.jsx","src/tongue/TipOfTheTongue.jsx","src/budget/WordBudget.jsx"]
---

# Game Night: every surface

Scope: the whole client: home hub, join, each game's setup, TV display, phone, host controller and end screens, plus dialogs, Back to settings and the sound button. Mode: Experience on the TV and home hub (the show leads), Operate on phones, setup and the controller (one obvious action, precise details).

Audience and job: adult friends at a party; the host sets up on a shared screen (TV, laptop or projector, often dim), players act on their phones.

Memorable moment: the board clacking a reveal into place, flap by flap, left to right.

User's binding answers (direction round): remove chrome lettering, sunburst rays, dot-matrix numbers, neon game colours and glowing lamps; keep each game's show feel, big moments that still pop, and quiet per-game colour; avoid corporate/flat, childish/cartoony and generic "AI website" looks. Build path: code-led (user's choice).

## Direction contract

THESIS: Game Night is the departure board in a quiet station concourse at night. The shared screen is one matte split-flap board where codes, scores, clocks, categories and answers clack into place; phones are the ticket-machine keypad. Refuses the pinball cabinet it replaces (chrome lettering, sunburst rays, dot-matrix, neon lamps) and the category default of rounded party cards on purple.

OWN-WORLD: Flap black (#0b0b0d) cells on a steel-frame ground (#2a2d31 / #5b5e63 / #a7aaaf), painted letter white (#f2f2f2), one condensed grotesk for flaps and labels (self-hosted, uppercase, tracked), plain condensed sans for prose. Each game keeps ONE quiet row-lamp colour in place of the reference's single amber (Jeoparty gold on show-blue flaps, Survey orange, Spin & Solve magenta, Fib mint, Price sky, Tongue lime, Word Budget its own); red only for strikes, fouls and "cancelled". No glow, no chrome bevels, no bolts. Flaps only carry data (codes, scores, clocks, answers, titles); instructions and prose are set type, never flaps. State is row state: waiting (dim letters), ready/live (white), your turn (lamp-coloured status cell plus a filled row marker), struck/out (red, with an X cell), never colour alone.

STORY: The host picks a game from the board, the board flips to that game's lobby, players key the code from the six flap cells into their phones, and every reveal, score and win lands as a cascade of flaps with a clack.

FIRST VIEWPORT: TV lobby at 1440x900 (the chosen sketch): steel frame around one flap-black board; header row = game name in flap cells with its lamp dot; room code as six large flap cells (~160px tall) with the QR beside them; players as departure rows (player / team / status) below; Start game as the one lit cell bottom-centre, Sound / Back to settings / Host controller as quiet steel labels along the bottom rail.

FORM: challenger "split-flap concourse board" (catalog signals-instruments-split-flap-concourse, verdict competitive), chosen by the user over the assigned direction (candidate 6 of 7, Two-Ink Party Bill); seed:d349e39043ae1066. Signature interaction: the per-character flap cascade (staggered left to right, 30-60ms per cell, with the synthesized clack), used for reveals, score changes, clocks' last ten seconds and the room code; reduced-motion collapses it to a single crossfade. Survey Says! answers, the Spin & Solve puzzle board and the Jeoparty board are literal flap modules; the wheel stays a wheel, framed in steel.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
