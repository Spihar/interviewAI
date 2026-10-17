# Blind export for the LLM-vs-human scoring study.
#
# Run from the project folder:  python scripts/export_for_raters.py
# It reads Supabase with SUPABASE_KEY from .env (the secret key, which bypasses row-level security)
# and writes three files to exports/ (git-ignored):
#   raters_blind.csv   one row per scored answer for the human raters (item_id, assessed_skill, question, answer):
#                      no LLM score, band or justification, no participant code or turn number; emails, phone numbers,
#                      links and ID numbers (register/roll numbers) redacted; rows shuffled with a fixed seed; empty rater_score/rater_band columns
#   key_llm_scores.csv participant_code, turn and the LLM's scores for the same item_ids, kept away from raters
#                      and joined back for analysis
#   rubric.txt         the rubric the LLM scored against, to hand to the raters
# Only interviews with consent_given, and answers the LLM scored (parse_ok), are exported.
# Resume text is left out: it holds names and contact details that a regex can't reliably remove.
import argparse
import csv
import os
import random
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from db import supabase                                 # noqa: E402  (needs the project folder on sys.path)
from services.participant import participant_code       # noqa: E402
from services.rubric import rubric_text, RUBRIC_VERSION # noqa: E402

PAGE = 1000   # Supabase returns at most 1000 rows per request

# links first, so a profile URL is replaced as a whole and not split into email or phone pieces
LINK = re.compile(r"(https?://\S+|www\.\S+|(github|linkedin)\.com/\S+)", re.IGNORECASE)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
# a run of digits, spaces, brackets, dots or dashes; only redacted when it has 10+ digits,
# so years ("2019-2023") and scores aren't mistaken for phone numbers; digits inside a word (a roll number
# like "RA2111003010123") are left to ID_MIXED below
PHONE = re.compile(r"(?<![A-Za-z0-9])\+?\d[\d\s().-]{6,}\d")

# ID numbers (college register / roll numbers, student IDs), replaced with [id]. Three patterns, applied in order:
# 1. a cue phrase ("register number is", "roll no.", "reg no:", "student id", "USN") followed by a number or code,
#    redacted at any length: only the value is replaced, the cue words are kept
ID_CUE = re.compile(
    r"(\b(?:(?:register|registration|reg|roll|enrol?ment|enrollment|admission|student|college|university)"
    r"\s*(?:number|num|no|id)|usn|prn)\b\.?\s*(?:is\s*)?[:#-]?\s*)"
    r"([A-Za-z0-9]*\d[A-Za-z0-9]*(?:[ -]\d+)*)",
    re.IGNORECASE)
# 2. 6+ digits, optionally in groups of 3+ digits split by a single space or hyphen ("4373 3047", "1234567"),
#    not part of a decimal, version or percentage; runs made only of 4-digit years ("2019-2023") are kept
ID_DIGITS = re.compile(r"(?<![\w.])\d{3,}(?:[ -]\d{3,})*(?![\w%]|\.\d|\s%)")
YEAR = re.compile(r"(19|20)\d\d")
# 3. letters and digits mixed in one token of 6+ characters ("21CS1234", "22BCE0456", "RA2111003010123"):
#    4+ digits when it starts with a digit, 6+ digits when it starts with letters, so names like "RTX4090" are kept
ID_MIXED = re.compile(r"\b(?=[A-Za-z0-9]*[A-Za-z])(?:\d(?=(?:[A-Za-z]*\d){3})|[A-Za-z]+(?=(?:[A-Za-z]*\d){6}))[A-Za-z0-9]{5,}\b")


# only_years is true for runs like "2019-2023" or "2019 2020 2021", which are kept
def only_years(run):
    groups = [g for g in re.split(r"\D+", run) if g]
    return all(YEAR.fullmatch(g) for g in groups)


def redact_phone(match):
    run = match.group()
    return "[phone]" if sum(c.isdigit() for c in run) >= 10 and not only_years(run) else run


def redact_id_digits(match):
    run = match.group()
    groups = re.split(r"[ -]", run)
    if sum(len(g) for g in groups) < 6 or only_years(run):
        return run
    return "[id]"


def redact(text):
    text = LINK.sub("[link]", text or "")
    text = EMAIL.sub("[email]", text)
    text = PHONE.sub(redact_phone, text)
    text = ID_CUE.sub(lambda m: m.group(1) + "[id]", text)
    text = ID_DIGITS.sub(redact_id_digits, text)
    return ID_MIXED.sub("[id]", text)


# selftest checks redact() on ID numbers that must be removed and ordinary numbers that must stay.
# Run it with:  python scripts/export_for_raters.py --selftest
REDACTED = [
    "my register number is 4373304",
    "my register number is 4373304.",
    "4373 3047",
    "43733047",
    "1234567",
    "roll no. 1234",
    "reg no: 12345",
    "Register Number: 21CS1234",
    "21CS1234",
    "RA2111003010123",
    "22BCE0456",
    "student id is 98765",
    "my USN is 1MS21CS001",
]
KEPT = [
    "100 strings",
    "2019-2023",
    "2019 2020 2021",
    "3.5 years",
    "top 10",
    "O(n log n)",
    "Python 3.11",
    "8 GB",
    "1080p",
    "in 2023",
    "version 1.2.3",
    "v2.10.4",
    "95%",
    "99.95%",
    "RTX4090",
    "ResNet50",
    "x86 and ES2015",
]


def selftest():
    failures = []
    for text in REDACTED:
        out = redact(text)
        if "[id]" not in out or any(c.isdigit() for c in out):
            failures.append(f"not redacted: {text!r} -> {out!r}")
    for text in KEPT:
        out = redact(text)
        if out != text:
            failures.append(f"changed: {text!r} -> {out!r}")
    for line in failures:
        print("FAIL", line)
    print(f"{len(REDACTED) + len(KEPT) - len(failures)}/{len(REDACTED) + len(KEPT)} redaction checks passed")
    return not failures


# safe_cell stops spreadsheet apps from treating a cell that starts with = + - @ (or a tab / carriage return) as a formula.
def safe_cell(text):
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def fetch_all(table, columns):
    rows, start = [], 0
    while True:
        # ordered by id so pages don't overlap or skip rows
        page = supabase.table(table).select(columns).order("id").range(start, start + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        start += PAGE


def write_csv(path, fieldnames, rows):
    # utf-8-sig so Excel opens non-English characters correctly
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Export scored answers for blind human rating.")
    parser.add_argument("--out", default="exports", help="output folder (default: exports)")
    parser.add_argument("--seed", type=int, default=2026, help="shuffle seed, keep it fixed for a reproducible order")
    parser.add_argument("--exclude", action="append", default=[], metavar="P-XXXXXXXX",
                        help="participant_code to leave out, e.g. your own test interviews (repeatable)")
    parser.add_argument("--selftest", action="store_true", help="only check the redaction patterns, export nothing")
    args = parser.parse_args()

    if args.selftest:
        sys.exit(0 if selftest() else 1)

    if not os.getenv("PARTICIPANT_SALT"):
        sys.exit("PARTICIPANT_SALT is not set in .env, so participant codes can't be made. Set it (and never change it) first.")

    interviews = {row["id"]: row for row in fetch_all("interviews", "id, user_id, consent_given")}
    turns = fetch_all("chat_history", "*")

    items, seen = [], set()
    for row in sorted(turns, key=lambda r: (r.get("created_at") or "")):
        interview = interviews.get(row.get("interview_id"))
        if not interview or not interview.get("consent_given"):
            continue                                    # no consent, never exported
        if not row.get("parse_ok") or row.get("score") is None or not row.get("question"):
            continue                                    # the LLM didn't score this answer, the question is asked again
        key = (row["interview_id"], row.get("turn_index"))
        if key in seen:
            continue                                    # a turn saved twice (retried request): keep the first
        seen.add(key)
        # The code is recomputed from user_id with PARTICIPANT_SALT (the same function the server uses) instead of
        # read from interviews.participant_code, so interviews from before migration 008 get the same code too.
        code = participant_code(interview["user_id"])
        if code in args.exclude:
            continue
        items.append((code, row))

    # Shuffle so raters can't follow one interview in order, then number the items in that shuffled order.
    random.Random(args.seed).shuffle(items)

    blind, key_rows = [], []
    for n, (code, row) in enumerate(items, start=1):
        item_id = f"item_{n:04d}"
        blind.append({
            "item_id": item_id,
            "assessed_skill": row.get("assessed_skill"),
            "question": safe_cell(redact(row.get("question"))),
            "answer": safe_cell(redact(row.get("answer"))),
            "rater_score": "",
            "rater_band": "",
        })
        key_rows.append({
            "item_id": item_id,
            "chat_history_id": row.get("id"),
            "interview_id": row.get("interview_id"),
            "participant_code": code,
            "turn": row.get("turn_index"),
            "assessed_skill": row.get("assessed_skill"),
            "llm_score": row.get("score"),
            "llm_band": row.get("band"),
            "llm_justification": row.get("justification"),
            "llm_feedback": row.get("feedback"),
            "model": row.get("model"),
            "rubric_version": row.get("rubric_version"),
            "input_mode": row.get("input_mode"),
            "latency_ms": row.get("latency_ms"),
            "stt_ms": row.get("stt_ms"),
            "created_at": row.get("created_at"),
        })

    os.makedirs(args.out, exist_ok=True)
    write_csv(os.path.join(args.out, "raters_blind.csv"), list(blind[0].keys()) if blind else
              ["item_id", "assessed_skill", "question", "answer", "rater_score", "rater_band"], blind)
    write_csv(os.path.join(args.out, "key_llm_scores.csv"), list(key_rows[0].keys()) if key_rows else ["item_id"], key_rows)
    with open(os.path.join(args.out, "rubric.txt"), "w", encoding="utf-8") as f:
        f.write(f"Rubric {RUBRIC_VERSION}. Give each answer a rater_score from 0 to 10 for its assessed_skill, "
                "and the rater_band that score falls in.\n\n" + rubric_text() + "\n")

    participants = len({code for code, _ in items})
    print(f"Exported {len(items)} answers from {participants} participants to {args.out}/ (seed {args.seed}).")
    print("Give raters raters_blind.csv and rubric.txt only. Keep key_llm_scores.csv away from them.")


if __name__ == "__main__":
    main()
