# Credits

## Survey Says! ProtoQA pack

`public/data/surveys-protoqa.json` is built from the ProtoQA dataset:

> Michael Boratko, Xiang Lorraine Li, Rajarshi Das, Tim O'Gorman, Dan Le and Andrew McCallum.
> "ProtoQA: A Question Answering Dataset for Prototypical Common-Sense Reasoning." EMNLP 2020.
> https://github.com/iesl/protoqa-data

ProtoQA is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes made for this game:
questions are re-cased and lightly cleaned up, each board keeps only its top 4 to 8 answers (worth 2 points or more),
and questions that were incomplete, repeated, already in the hand-written pack or not suitable for a party were
left out. `scripts/build-protoqa-surveys.py` rebuilds the file from the original data and documents every rule.

## Survey Says! Feud Sheet pack

`public/data/surveys-sheet.json` is built from a publicly shared Google Sheet titled "Family Feud Question Database":
https://docs.google.com/spreadsheets/d/1y5TtM4rXHfv_9BktCiJEW621939RzJucXxhJidJZbfQ/htmlview

The sheet doesn't name its author, its source or a licence, and we don't know them, so no licence is claimed
for this data. If you're the author and want it credited differently or removed, get in touch through this GitHub repository. Only the tabs
with answers and points were used (3 Answers to 7 Answers, and Sheet1); the answers and point values are
kept as they are in the sheet. Questions are re-cased, and boards that repeat a question already in another
pack, add up to more than 100 points or aren't suitable for a party were left out.
`scripts/build-sheet-surveys.py` rebuilds the file from CSV exports of those tabs.

## Game Night pack

The hand-written Game Night pack (`src/surveys.json`) is original to this project; its answers and points are invented.

## Survey Says! sounds

The buzzer, the answer ding, the round fanfare and the winners tune are synthesized in the browser by
`src/survey/sounds.js` (Web Audio). There are no recordings or samples, and the tune is an original composition,
not the TV show's music.

## Spin & Solve puzzles and sounds

The puzzles, bonus puzzles, gifts and trips in `src/wheel/puzzles.json` (the Game Night pack) were written for
this project. Most are everyday phrases and figures of speech; the rest name well-known places, people,
public-domain characters and titles. None is copied from the TV show.

## Spin & Solve Fan Database pack

`public/data/puzzles-fans.json` is built from https://wheeloffortuneanswer.com/, a player-maintained list of
answers from the official Wheel of Fortune game, collected from its category pages on 2026-10-26. The site doesn't
name an author or a licence, and we don't know them, so no licence is claimed for this data. If you're the
author and want it credited differently or removed, get in touch through this GitHub repository.

The answers are kept as written, with their categories (some renamed, like "Food and Drink" to "Food & Drink").
The categories made of other people's words (Song Lyrics, Movie Quotes, Quotation, Slogan) were not collected,
and Headline was left out. Answers that don't fit the board, use characters it can't show, have notes attached,
have fewer than 5 letters, break their category's rule or repeat a Game Night puzzle were left out.
`scripts/build-fan-puzzles.mjs` rebuilds the file from the collected answers and documents every rule.

The peg clicks, letter dings, Bankrupt slide, fanfares and bonus clock are synthesized in the browser by
`src/wheel/sounds.js`, using the building blocks in `src/survey/sounds.js` (and the same winners tune). There are
no recordings or samples.

## Price Check Open Prices pack

`public/data/prices-openprices.json` (United States) and `public/data/prices-openprices-ca.json` (Canada) are built from [Open Prices](https://prices.openfoodfacts.org), an
[Open Food Facts](https://world.openfoodfacts.org) project that collects prices from shop receipts and price tags,
contributed by its community.

- The price data is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  The pack is a derived database and is released under the ODbL too.
- Product names, brands and sizes come from the Open Food Facts database (ODbL), and product photos, loaded from
  `images.openfoodfacts.org`, are under [CC BY-SA](https://creativecommons.org/licenses/by-sa/3.0/) by their contributors.

The data was downloaded from the public Open Prices API (`https://prices.openfoodfacts.org/api/v1/prices`), one
request a second.

Changes made for this game: the US pack keeps only US-dollar prices paid at US shops, and the Canada pack only
Canadian-dollar prices paid at Canadian shops (no price is converted between currencies, and a product with no
Canadian receipt is left out of the Canada pack); only whole products, not on sale, bought one at a time, from the
two years before the newest price, and between 0.50 and 80 dollars are kept; produce sold by weight ("$ per kg",
"varies") is dropped; products need a name, a photo and a brand or a size; emoji are removed from names and only
the first brand is kept; each product's price is the median of its receipts; products that look the same are
merged; all-caps names are put in title case. `scripts/build-openprices-pack.py` rebuilds either file
(`--country US` or `--country CA`) and documents every rule.

## Price Check showcase pack

The big-ticket items in `src/price/showcase.json` were written for this project. Each has a US price and a
Canadian price, both our own estimates of typical 2026 prices in that country, not quotes from any shop; the
Canadian prices were estimated separately, not converted from the US ones.

