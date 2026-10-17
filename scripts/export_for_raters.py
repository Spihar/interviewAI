# Blind export for the LLM-vs-human scoring study.
#
# Run from the project folder:  python scripts/export_for_raters.py
# It reads Supabase with SUPABASE_KEY from .env (the secret key, which bypasses row-level security)
# and writes three files to exports/ (git-ignored):
#   raters_blind.csv   one row per scored answer for the human raters: no LLM score, band or justification,
#                      no names or emails, rows shuffled with a fixed seed, empty rater_score/rater_band columns
#   key_llm_scores.csv the LLM's scores for the same item_ids, kept away from raters and joined back for analysis
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

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
# a run of digits, spaces, brackets, dots or dashes; only redacted when it has 10+ digits,
# so years ("2019-2023") and scores aren't mistaken for phone numbers
PHONE = re.compile(r"\+?\d[\d\s().-]{6,}\d")


def redact(text):
    text = EMAIL.sub("[email]", text or "")
    return PHONE.sub(lambda m: "[phone]" if sum(c.isdigit() for c in m.group()) >= 10 else m.group(), text)


def fetch_all(table, columns):
    rows, start = [], 0
    while True:
        page = supabase.table(table).select(columns).range(start, start + PAGE - 1).execute().data or []
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
    args = parser.parse_args()

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
            "participant_code": code,
            "turn": row.get("turn_index"),
            "assessed_skill": row.get("assessed_skill"),
            "question": redact(row.get("question")),
            "answer": redact(row.get("answer")),
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
              ["item_id", "participant_code", "turn", "assessed_skill", "question", "answer", "rater_score", "rater_band"], blind)
    write_csv(os.path.join(args.out, "key_llm_scores.csv"), list(key_rows[0].keys()) if key_rows else ["item_id"], key_rows)
    with open(os.path.join(args.out, "rubric.txt"), "w", encoding="utf-8") as f:
        f.write(f"Rubric {RUBRIC_VERSION}. Give each answer a rater_score from 0 to 10 for its assessed_skill, "
                "and the rater_band that score falls in.\n\n" + rubric_text() + "\n")

    participants = len({code for code, _ in items})
    print(f"Exported {len(items)} answers from {participants} participants to {args.out}/ (seed {args.seed}).")
    print("Give raters raters_blind.csv and rubric.txt only. Keep key_llm_scores.csv away from them.")


if __name__ == "__main__":
    main()
