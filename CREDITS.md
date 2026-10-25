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

The hand-written Game Night pack (`src/surveys.json`) is original to this project; its answers and points are invented.
