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
