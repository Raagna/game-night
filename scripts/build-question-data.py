"""Turn the Jeopardy season archive into the compact per-season files the setup screen loads.

Usage:  python3 scripts/build-question-data.py path/to/jeopardy_dataset_seasons_1-42.zip
Writes: public/data/seasons.json and public/data/season<N>.json

Each season file is {"season": N, "categories": [...], "finals": [...]}:
  categories: [category, air_date, round (1 = Jeopardy!, 2 = Double Jeopardy!), [[clue, response] x5], [topic ids]]
              (the five clues are in board order, lowest value first; topic ids come from src/topics.json)
  finals:     [category, air_date, clue, response]

Only complete five-clue categories are kept, and categories whose clues depend on a picture,
video or audio the game can't show ("seen here", "Clue Crew", ...) are left out.

Topics: each category gets up to three broad topics (Sports, Science, ...) so searching "sports"
finds sports categories whose names don't say so. A keyword in the category name counts 5 points,
each clue that mentions a topic keyword counts 1; topics scoring at least 2 and at least 40% of
the best score are kept. Edit src/topics.json to tune the keyword lists, then re-run this script.
"""
import csv
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

MEDIA = re.compile(r"seen here|shown here|heard here|pictured here|clue crew|\(video|\[video|\(audio|this sound|you hear|on the monitor", re.I)
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
TOPICS = json.loads((ROOT / "src" / "topics.json").read_text(encoding="utf-8"))


def word_pattern(words):
    alternatives = "|".join(re.escape(w.lower()) for w in sorted(words, key=len, reverse=True))
    return re.compile(r"(?<![a-z0-9])(?:" + alternatives + r")(?:s|es)?(?![a-z0-9])")


TOPIC_PATTERNS = [(t["id"], word_pattern(t["keywords"]), word_pattern(t["aliases"] + [t["label"]])) for t in TOPICS]


def classify(name, clues):
    name = name.lower()
    scores = {}
    for topic_id, keywords, aliases in TOPIC_PATTERNS:
        score = 5 if (aliases.search(name) or keywords.search(name)) else 0
        score += sum(1 for clue, response in clues if keywords.search(f"{clue} {response}".lower()))
        if score:
            scores[topic_id] = score
    if not scores or max(scores.values()) < 2:
        return []
    best = max(scores.values())
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    return [topic_id for topic_id, score in ranked if score >= max(2, 0.4 * best)][:3]


def tidy(text):
    text = re.sub(r"<[^>]*>", "", text or "")
    text = re.sub(r"\\(['\"])", r"\1", text)
    return text.strip()


def season_rows(zf, name):
    with zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE)


def build(zf, name, season):
    groups, finals = defaultdict(list), []
    for row in season_rows(zf, name):
        clue, response, category = tidy(row["answer"]), tidy(row["question"]), tidy(row["category"]).upper()
        if not (clue and response and category):
            continue
        if row["round"] == "3":
            if not MEDIA.search(clue):
                finals.append([category, row["air_date"], clue, response])
            continue
        if row["round"] not in ("1", "2"):
            continue
        try:
            value = int(row["clue_value"] or 0)
        except ValueError:
            continue
        groups[(row["air_date"], int(row["round"]), category)].append((value, clue, response))
    categories = []
    for (air_date, round_number, category), clues in groups.items():
        values = sorted({value for value, _, _ in clues})
        if len(clues) != 5 or len(values) != 5 or 0 in values:
            continue
        if any(MEDIA.search(clue) for _, clue, _ in clues):
            continue
        clues.sort()
        pairs = [[clue, response] for _, clue, response in clues]
        categories.append([category, air_date, round_number, pairs, classify(category, pairs)])
    categories.sort(key=lambda c: (c[1], c[2]), reverse=True)
    finals.sort(key=lambda f: f[1], reverse=True)
    return {"season": season, "categories": categories, "finals": finals}


def main(zip_path):
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if re.search(r"seasons/season(\d+)\.tsv$", n)]
        for name in sorted(names, key=lambda n: int(re.search(r"(\d+)\.tsv$", n).group(1))):
            season = int(re.search(r"(\d+)\.tsv$", name).group(1))
            data = build(zf, name, season)
            (OUT / f"season{season}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            dates = sorted({c[1] for c in data["categories"]} | {f[1] for f in data["finals"]})
            index.append({"season": season, "from": dates[0], "to": dates[-1], "categories": len(data["categories"]), "finals": len(data["finals"])})
            print(f"season {season:>2}: {len(data['categories']):>5} categories, {len(data['finals']):>3} finals")
    (OUT / "seasons.json").write_text(json.dumps(sorted(index, key=lambda s: -s["season"]), separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
