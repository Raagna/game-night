"""Turn the "Family Feud Question Database" Google Sheet into a Survey Says! question pack.

Usage:  python3 scripts/build-sheet-surveys.py path/to/sheet-csvs [--report report.txt]
Writes: public/data/surveys-sheet.json

The folder holds one CSV per tab, named after the tab with spaces as hyphens (3-Answers.csv, ...), from
https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=<the tab's gid>
Only the tabs in POINT_TABS are read: each row is a question followed by answer, points pairs. The other
tabs have no points ("No Points 3".."No Points 7") or only the top one or two answers ("Fast Money",
"Broken Fast Money"), so they can't make a full board.

The sheet's own answers and point values are kept. A board is left out if a pair is missing its answer or
points, if its points add up to more than 100, or if fewer than MIN_ANSWERS answers are left after dropping
an answer the row repeats; answers are sorted highest first. Questions and answers are tidied, checked for
party-fitness, and deduplicated (against each other, src/surveys.json and the ProtoQA pack) with the same
rules as scripts/build-protoqa-surveys.py, so run that one first if the ProtoQA pack changes.
Same file format as the ProtoQA pack: {"source", "license", "surveys": [[id, question, [[text, points, [alts]]]]]}.
"""
import csv
import hashlib
import importlib.util
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "surveys-sheet.json"
PROTOQA = ROOT / "public" / "data" / "surveys-protoqa.json"
SHEET_URL = "https://docs.google.com/spreadsheets/d/1y5TtM4rXHfv_9BktCiJEW621939RzJucXxhJidJZbfQ"
POINT_TABS = ["3-Answers", "4-Answers", "5-Answers", "6-Answers", "7-Answers", "Sheet1"]
MIN_ANSWERS = 3

# The tidying, blocklist and duplicate rules live in the ProtoQA script; reuse them so both packs match.
sys.dont_write_bytecode = True  # no __pycache__ folder in scripts/
spec = importlib.util.spec_from_file_location("protoqa", Path(__file__).with_name("build-protoqa-surveys.py"))
pq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pq)


def unmojibake(text):
    """Curly quotes that went through the wrong encoding ("â€™") back to what they were, when that's possible."""
    if "â€" not in text:
        return text
    try:
        return text.encode("cp1252").decode("utf-8")
    except UnicodeError:
        return text


def board(row):
    """[(answer, points)] from a row's answer/points pairs, or None if a pair is half empty."""
    cells = [unmojibake(c.strip()) for c in row[1:]]
    pairs = [(cells[i], cells[i + 1] if i + 1 < len(cells) else "") for i in range(0, len(cells), 2)]
    pairs = [(a, p) for a, p in pairs if a or p]
    if any(not a or not re.fullmatch(r"\d+", p) for a, p in pairs):
        return None
    return [(a, int(p)) for a, p in pairs]


def build(folder, proper, report):
    kept = []
    for tab in POINT_TABS:
        path = folder / f"{tab}.csv"
        if not path.exists():
            sys.exit(f"Couldn't find {path.name} in {folder}")
        for line, row in enumerate(list(csv.reader(path.open(encoding="utf-8")))[1:], start=2):
            original = unmojibake((row[0] if row else "").strip())
            why = lambda reason, note="": report[reason].append(f"{tab}:{line}: {original}{note}")
            if not original:
                why("blank question")
                continue
            pairs = board(row)
            if pairs is None:
                why("an answer without points, or points without an answer")
                continue
            answers, seen = [], set()
            for text, points in pairs:
                text = pq.display(text)
                if pq.key(text) in seen:
                    report["repeated answer dropped (board kept)"].append(f"{tab}:{line}: {text}")
                    continue
                seen.add(pq.key(text))
                parts = [p.strip() for p in text.split("/") if p.strip()]
                answers.append({"text": text, "points": points, "alts": parts if len(parts) > 1 else []})
            if [a["points"] for a in answers] != sorted((a["points"] for a in answers), reverse=True):
                report["answers re-sorted by points (board kept)"].append(f"{tab}:{line}: {original}")
                answers.sort(key=lambda a: -a["points"])
            total = sum(a["points"] for a in answers)
            if total > 100:
                why("points add up to more than 100", f"  [{total}]")
                continue
            if len(answers) < MIN_ANSWERS:
                why(f"fewer than {MIN_ANSWERS} answers")
                continue
            question = pq.tidy_question(original, proper)
            garbled = lambda text: pq.garbled(text) or "â€" in text
            if garbled(question) or any(garbled(a["text"]) or len(a["text"]) > pq.MAX_ANSWER for a in answers) or len(question) > pq.MAX_QUESTION:
                why("cut-off or garbled text")
                continue
            hit = next((m.group(0) for t in [question] + [a["text"] for a in answers] for m in [pq.blocked(t)] if m), None)
            if hit:
                why("not for a party", f"  [{hit}]")
                continue
            kept.append({"id": "fs-" + hashlib.sha1(pq.key(question).encode()).hexdigest()[:10], "where": f"{tab}:{line}", "question": question, "answers": answers})
    return kept


def dedupe(surveys, existing, report):
    """One board per question (the one with the most answers), and nothing already in another pack."""
    groups = defaultdict(list)
    for survey in surveys:
        groups[pq.gist(survey["question"])].append(survey)
    # Index the other packs by each word's first five letters: same_question needs most words in common,
    # and its loose match only joins words that share those letters.
    index = defaultdict(set)
    for i, (gist, _) in enumerate(existing):
        for word in set(gist):
            index[word[:5]].add(i)
    kept = []
    for gist, group in groups.items():
        group.sort(key=lambda s: len(s["answers"]), reverse=True)
        for repeat in group[1:]:
            report["repeat of another question in the sheet"].append(f"{repeat['where']}: {repeat['question']}")
        candidates = set().union(*(index[word[:5]] for word in set(gist))) if gist else set()
        twin = next((existing[i][1] for i in candidates if pq.same_question(gist, existing[i][0])), None)
        if twin:
            report[f"already in the {twin} pack"].append(f"{group[0]['where']}: {group[0]['question']}")
            continue
        kept.append(group[0])
    return kept


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    protoqa = json.loads(PROTOQA.read_text(encoding="utf-8"))["surveys"]
    existing = [(pq.gist(s["question"]), "Game Night") for s in pq.HAND_WRITTEN] + [(pq.gist(q), "ProtoQA") for _, q, _ in protoqa]
    # The other packs' questions are already sentence case, so they teach which words are proper nouns.
    proper = pq.learn_proper_nouns([s["question"] for s in pq.HAND_WRITTEN] + [q for _, q, _ in protoqa])
    report = defaultdict(list)
    built = build(Path(sys.argv[1]), proper, report)
    surveys = dedupe(built, existing, report)
    data = {
        "source": f'"Family Feud Question Database" Google Sheet (author unknown), {SHEET_URL}',
        "license": "Unknown: shared publicly with no author or licence named. Questions re-cased; answers and points as in the sheet.",
        "surveys": [[s["id"], s["question"], [[a["text"], a["points"], a["alts"]] if a["alts"] else [a["text"], a["points"]] for a in s["answers"]]] for s in surveys],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    rows = len(built) + sum(len(v) for k, v in report.items() if "board kept" not in k and not k.startswith(("repeat", "already")))
    print(f"{rows} sheet rows -> {len(surveys)} surveys in {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    for reason, items in sorted(report.items(), key=lambda item: -len(item[1])):
        print(f"  {'' if 'board kept' in reason else 'left out, '}{reason}: {len(items)}")
    if "--report" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--report") + 1])
        out.write_text("\n".join(f"## {reason} ({len(items)})\n" + "\n".join(items) + "\n" for reason, items in report.items()), encoding="utf-8")


if __name__ == "__main__":
    main()
