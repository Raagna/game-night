"""Turn the Jeopardy season archive into the compact per-season files the setup screen loads.

Usage:  python3 scripts/build-question-data.py path/to/jeopardy_dataset_seasons_1-42.zip
Writes: public/data/seasons.json and public/data/season<N>.json

Each season file is {"season": N, "categories": [...], "finals": [...]}:
  categories: [category, air_date, round (1 = Jeopardy!, 2 = Double Jeopardy!), [[clue, response] x5]]
              (the five clues are in board order, lowest value first)
  finals:     [category, air_date, clue, response]

Only complete five-clue categories are kept, and categories whose clues depend on a picture,
video or audio the game can't show ("seen here", "Clue Crew", ...) are left out.
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
OUT = Path(__file__).resolve().parent.parent / "public" / "data"


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
        categories.append([category, air_date, round_number, [[clue, response] for _, clue, response in clues]])
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
