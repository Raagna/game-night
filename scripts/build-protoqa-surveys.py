"""Turn the ProtoQA dataset into an extra Survey Says! question pack.

Usage:  python3 scripts/build-protoqa-surveys.py path/to/protoqa-data [--report report.txt]
        (the folder holds train.jsonl, dev.scraped.jsonl and dev.crowdsourced.jsonl from
        https://github.com/iesl/protoqa-data, either flat or in its data/train and data/dev folders)
Writes: public/data/surveys-protoqa.json

The file is {"source": ..., "license": ..., "surveys": [[id, question, [[text, points, [alts]] x4-8]]]},
answers ranked highest first. The client expands it into the same shape as src/surveys.json.

ProtoQA has two kinds of question:
  scraped       Family Feud boards transcribed by fans: one string per answer, counts are the show's points.
  crowdsourced  about 100 people answered each question and the answers were clustered by hand; a cluster
                is shown as its most common answer, and its other answers (given by two or more people, or sharing
                a word with it) become accepted alternatives. The clusters are loose and many answers aren't
                native English, so each board was read by hand and only those in KEEP_CROWDSOURCED are used.

Only answers worth at least MIN_POINTS are kept, the top MAX_ANSWERS of them, and a question needs
MIN_ANSWERS of those. Boards whose counts add up to less than MIN_TOTAL (most of the board is missing)
or more than 100 (a bad transcription) are left out, as are questions with cut-off ("..") or garbled text,
questions already in src/surveys.json, repeats, and anything matching BLOCKED (not for a party).
Pass --report to list everything that was left out and why.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "surveys-protoqa.json"
HAND_WRITTEN = json.loads((ROOT / "src" / "surveys.json").read_text(encoding="utf-8"))
FILES = {"train.jsonl": "scraped", "dev.scraped.jsonl": "scraped", "dev.crowdsourced.jsonl": "crowdsourced"}

MIN_ANSWERS, MAX_ANSWERS, MIN_POINTS, MIN_TOTAL = 4, 8, 2, 70
MAX_QUESTION, MAX_ANSWER, MAX_ALTS = 200, 40, 12

# Checked against the question, every kept answer and every alternative. Whole words, plural endings allowed.
BLOCKED = re.compile(r"(?<![a-z])(?:" + "|".join("""
sex sexy sexual sexually naked nude nudist nudity topless virgin virginity orgasm condom porn porno pornography
stripper erection viagra vibrator dildo groupsex pervert perverted penis vagina breast boob nipple crotch genital testicle kinky horny foreplay
lingerie thong hooker prostitute pimp brothel affair mistress adultery seduce seduction hickey
cocaine heroin marijuana meth stoned murder rape raped rapist suicide molest abuse abusive terrorist terrorism kidnap massacre
gay fag faggot homosexual lesbian transvestite tranny retard retarded midget
bitch ass asshole shit fuck piss damn bastard whore slut
""".split()) + r")(?:s|es)?(?![a-z])")
BLOCKED_PHRASES = re.compile(r"(?<![a-z])(?:" + "|".join(re.escape(p) for p in [
    "cheat on", "strip club", "one night stand", "make love", "making love", "lap dance", "crack cocaine",
    "drug dealer", "get high", "getting high", "in bed with", "strip joint", "in the mood", "wedding night",
    "girly magazine", "the pill", "birth control", "pole dancer", "playboy", "hugh hefner", "nookie", "get intimate",
    "birthday suit",
]) + r")(?![a-z])")
# Questions read by hand and left out: stereotypes, innuendo or questions that only work with a picture.
DROP_IDS = {"train_q690", "train_q2255", "train_q3856", "train_q4097", "train_q4332"}
KEEP_CROWDSOURCED = {f"r{i}" for i in """1q2 1q6 1q7 1q9 1q10 1q16 1q17 1q18 1q20 2q3 2q4 2q5 2q6 2q14 2q15 2q19 2q20 2q21 2q23 2q25
2q26 2q27 2q32 2q40 2q42 2q46 2q47""".split()}

# A word starts with a letter that doesn't follow a digit, so "4th" and "10am" stay lowercase.
WORD = r"(?<![0-9])[A-Za-z][A-Za-z'\u2019]*"
ACRONYMS = set("tv ceo dvd cd atm usa fbi cia ufo pc bbq suv vip iq gps nfl nba mlb nhl abc nbc cbs cnn mtv hbo espn dj mri er icu pta pda mp3 rv".split())
STOP = set("a an the of to in on at for with and or your you my is are be do does that this it".split())
GENERIC = set("name something someone somewhere thing things people person might would could can most often usually always really probably typically commonly frequently many they them their he she him his her we our us i when what where who which why how there will have has am was give me tell find found see expect lot lots youd".split())
WH_WORDS = ("what", "what's", "how", "who", "where", "when", "why", "which", "would", "do", "does", "is", "are", "can", "if", "at what")
CONTRACTIONS = {w.replace("'", ""): w for w in """you're don't can't won't isn't doesn't didn't wouldn't shouldn't couldn't aren't wasn't
weren't haven't hasn't they're i'm i've you've you'll you'd what's that's there's she's let's who's""".split()}
# Words to keep capitalised when a Title Case Question Is Made Sentence Case, on top of those learned from the data.
PROPER = set("""i american americans america christmas halloween thanksgiving easter valentine's hawaii mexico canada
california florida texas york vegas las paris france italy italian england english french spanish mexican
monday tuesday wednesday thursday friday saturday sunday january february march april june july august september
october november december santa claus disney disneyland superman batman elvis hollywood god""".split())
# "New" is only a name in front of these ("New York", "New Year's"), not in "a new car".
NEW_NAMES = set("york yorks jersey orleans england zealand mexico hampshire year year's years".split())


def words(text):
    return [w for w in re.findall(r"[a-z0-9]+", text.lower().replace("'", "")) if w not in STOP]


def key(text):
    return " ".join(words(text))


def gist(text):
    """The question's content words, without "name something people might..." and plural endings."""
    text = re.sub(r"\bcan(?:'|no)t\b", "can not", text.lower().replace("\u2019", "'"))
    for short, long in [("won't", "will not"), ("n't", " not"), ("'re", " are"), ("'ll", " will"), ("'ve", " have"), ("'d", " would"), ("'m", " am")]:
        text = text.replace(short, long)
    return tuple(re.sub(r"(?<=[a-z]{3})s$", "", w) for w in words(text) if w not in GENERIC)


def same_question(a, b):
    """Mostly the same words, in any order ("Name an animal you'd see at the zoo" / "...you expect to see at a zoo")."""
    if "".join(a) == "".join(b):
        return True  # tool box / toolbox
    alike = lambda x, y: x == y or (min(len(x), len(y)) >= 5 and abs(len(x) - len(y)) <= 2 and (x.startswith(y) or y.startswith(x)))
    shared = sum(any(alike(x, y) for y in b) for x in set(a))
    return shared >= 0.75 * (len(set(a)) + len(set(b)) - shared)


def blocked(text):
    text = re.sub(r"breast[- ]?(?:feed|fed)|chicken breast", "", text.lower())
    return BLOCKED.search(text) or BLOCKED_PHRASES.search(text)


def unmangle(text):
    """Undo the scrape's damage: lost curly quotes, doubled spaces, missing apostrophes."""
    text = re.sub(r"(?<=\w)\ufffd(?=\w)", "'", text).replace("\ufffd", '"')
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\b(" + "|".join(CONTRACTIONS) + r")\b", lambda m: match_case(CONTRACTIONS[m.group(1).lower()], m.group(1)), text, flags=re.I)
    return text


def match_case(word, like):
    return word[0].upper() + word[1:] if like[0].isupper() else word


def learn_proper_nouns(questions):
    """Words that are capitalised mid-sentence more often than not, in the questions that aren't Title Case."""
    votes = defaultdict(Counter)
    for text in questions:
        tokens = re.findall(WORD, text)
        if is_title_case(tokens):
            continue
        for word in tokens[1:]:
            votes[word.lower()][word[0].isupper()] += 1
    return {w for w, v in votes.items() if v[True] >= 2 and v[True] > v[False]} | PROPER


def is_title_case(tokens):
    return len(tokens) >= 3 and sum(t[0].isupper() for t in tokens) / len(tokens) > 0.7


def tidy_question(text, proper):
    text = unmangle(text)
    text = re.sub(r"^ame\b", "Name", text)
    text = re.sub(r"\s*\((?:new set|wording not exact)\s*\)", "", text, flags=re.I)
    tokens = re.findall(WORD, text)
    if is_title_case(tokens):
        def recase(m):
            word = m.group(0)
            lower = word.lower()
            if (len(word) > 1 and word.isupper()) or lower in ACRONYMS:
                return word.upper()  # TV, USA
            if lower == "new":
                after = re.match(r"\s+([A-Za-z'’]+)", m.string[m.end():])
                return "New" if after and after.group(1).lower().replace("’", "'") in NEW_NAMES else "new"
            return word[0].upper() + lower[1:] if lower in proper or lower.split("'")[0] in proper else lower
        text = re.sub(WORD, recase, text)
    text = re.sub(r"\bi\b", "I", text)
    text = text[0].upper() + text[1:]
    text = re.sub(r"\s*[:;,]$", "", text)
    if not re.search(r"[.?!][\"'\u201d\u2019]*$", text):
        text += "?" if text.lower().startswith(WH_WORDS) else "."
    return text.replace(" ?", "?")


def display(answer):
    """Survey boards show answers in Title Case, like src/surveys.json."""
    answer = unmangle(answer)
    def recase(m):
        word = m.group(0)
        if word.lower() in ACRONYMS:
            return word.upper()
        return re.sub(r"^(Mc)([a-z])", lambda mc: mc.group(1) + mc.group(2).upper(), word[0].upper() + word[1:]) if len(word) > 4 else word[0].upper() + word[1:]
    return re.sub(WORD, recase, answer)


def garbled(text):
    return ".." in text or "\u2026" in text or re.search(r"[\x00-\x1f\x7f-\x9f\ufffd]", text)


def scraped_answers(row):
    answers = []
    for cluster in row["answers"]["clusters"].values():
        text = cluster["answers"][0]
        parts = [p.strip() for p in text.split("/") if p.strip()]
        answers.append({"text": display(text), "points": cluster["count"], "alts": parts if len(parts) > 1 else [], "raw": [text]})
    return answers, sum(a["points"] for a in answers)


def crowdsourced_answers(row):
    raw = row["answers"]["raw"]
    clusters = list(row["answers"]["clusters"].values())
    total = sum(c["count"] for c in clusters)
    scale = 100 / total if total > 100 else 1
    answers = []
    for cluster in clusters:
        strings = sorted(set(cluster["answers"]), key=lambda s: (len(s) > MAX_ANSWER or bool(garbled(s)), -raw.get(s, 1), len(s), s))
        label = strings[0]
        # One person's odd answer ("party" in the Fight cluster) shouldn't count as a hit unless it echoes the label.
        alts, seen, label_words = [], {key(label)}, set(words(label))
        for s in strings:
            if (raw.get(s, 1) >= 2 or set(words(s)) & label_words) and key(s) not in seen and len(s) <= MAX_ANSWER:
                seen.add(key(s))
                alts.append(s)
        answers.append({"text": display(label), "points": max(1, round(cluster["count"] * scale)), "alts": alts[:MAX_ALTS], "raw": strings})
    return answers, total


def build(rows, proper, report):
    kept = []
    for kind, row in rows:
        qid = row["metadata"]["id"]
        original = row["question"]["original"]
        why = lambda reason, note="": report[reason].append(f"{qid}: {original.strip()}{note}")
        answers, total = (crowdsourced_answers if kind == "crowdsourced" else scraped_answers)(row)
        if qid in DROP_IDS or (kind == "crowdsourced" and qid not in KEEP_CROWDSOURCED):
            why("picked out by hand")
            continue
        if total > 100 and kind == "scraped":
            why("counts add up to more than 100")
            continue
        if total < MIN_TOTAL:
            why(f"fewer than {MIN_TOTAL} people answered")
            continue
        answers = sorted([a for a in answers if a["points"] >= MIN_POINTS], key=lambda a: -a["points"])[:MAX_ANSWERS]
        if len(answers) < MIN_ANSWERS:
            why(f"fewer than {MIN_ANSWERS} answers worth {MIN_POINTS}+ points")
            continue
        question = tidy_question(original, proper)
        if garbled(question) or any(garbled(a["text"]) for a in answers) or any(len(a["text"]) > MAX_ANSWER for a in answers) or len(question) > MAX_QUESTION:
            why("cut-off or garbled text")
            continue
        if len({key(a["text"]) for a in answers}) < len(answers):
            why("the same answer twice")
            continue
        hit = next((m.group(0) for t in [question] + [a["text"] for a in answers] for m in [blocked(t)] if m), None)
        if hit:
            why("not for a party", f"  [{hit}]")
            continue
        for a in answers:
            a["alts"] = [alt for alt in a["alts"] if not garbled(alt) and not blocked(alt)]
        kept.append({"id": f"pq-{qid}", "kind": kind, "question": question, "answers": answers, "total": total})
    return kept


def dedupe(surveys, report):
    """One board per question: the crowdsourced one if there is one, otherwise the most complete."""
    groups = defaultdict(list)
    for survey in surveys:
        groups[gist(survey["question"])].append(survey)
    existing = [gist(s["question"]) for s in HAND_WRITTEN]
    kept = []
    for k, group in groups.items():
        group.sort(key=lambda s: (s["kind"] == "crowdsourced", len(s["answers"]), s["total"]), reverse=True)
        for repeat in group[1:]:
            report["repeat of another ProtoQA question"].append(f"{repeat['id']}: {repeat['question']}")
        if any(same_question(k, e) for e in existing):
            report["already in src/surveys.json"].append(f"{group[0]['id']}: {group[0]['question']}")
            continue
        kept.append(group[0])
    return kept


def load(folder):
    rows = []
    for name, kind in FILES.items():
        path = next((p for p in [folder / name, *folder.glob(f"data/*/{name}")] if p.exists()), None)
        if path is None:
            sys.exit(f"Couldn't find {name} in {folder}")
        rows += [(kind, json.loads(line)) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return rows


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rows = load(Path(sys.argv[1]))
    report = defaultdict(list)
    proper = learn_proper_nouns(row["question"]["original"] for _, row in rows)
    surveys = dedupe(build(rows, proper, report), report)
    surveys.sort(key=lambda s: (s["kind"] != "crowdsourced", int(re.sub(r"\D", "", s["id"]) or 0)))
    data = {
        "source": "ProtoQA (Boratko et al., 2020), https://github.com/iesl/protoqa-data",
        "license": "CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ (questions re-cased, boards trimmed to the top answers)",
        "surveys": [[s["id"], s["question"], [[a["text"], a["points"], a["alts"]] if a["alts"] else [a["text"], a["points"]] for a in s["answers"]]] for s in surveys],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rows)} ProtoQA questions -> {len(surveys)} surveys ({sum(s['kind'] == 'crowdsourced' for s in surveys)} crowdsourced) in {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    for reason, items in sorted(report.items(), key=lambda item: -len(item[1])):
        print(f"  left out, {reason}: {len(items)}")
    if "--report" in sys.argv:
        out = Path(sys.argv[sys.argv.index("--report") + 1])
        out.write_text("\n".join(f"## {reason} ({len(items)})\n" + "\n".join(items) + "\n" for reason, items in report.items()), encoding="utf-8")


if __name__ == "__main__":
    main()
