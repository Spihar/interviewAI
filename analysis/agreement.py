"""Numbers and charts for the InterviewAI paper.

Reads the files made by scripts/export_for_raters.py:
  exports/key_llm_scores.csv   the AI's scores (keep away from raters)
  exports/raters_blind.csv     the blind questions and answers
  exports/raters/*.csv         one filled-in copy of raters_blind.csv per human rater,
                               named after the rater (for example exports/raters/guide.csv)

Writes analysis/out/results.md plus PNG charts. Works before the raters are done too:
then it only reports the AI side (score spread, timings, answer length).

Run from the project folder:
  pip install -r analysis/requirements.txt
  python analysis/agreement.py
"""

import argparse
import csv
import glob
import math
import os
import random
from collections import defaultdict
from statistics import mean, median

import numpy as np

SKILLS = ["communication", "technical_depth", "problem_solving", "project_experience"]
SCORE_MIN, SCORE_MAX = 0, 10
BOOTSTRAP_ROUNDS = 2000


def read_csv(path):
    # utf-8-sig drops the byte-order mark that Excel and the export script add.
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def round_half_up(x):
    """6.5 -> 7 and 7.5 -> 8. Python's round() would give 6 and 8 (it rounds halves to even)."""
    return math.floor(x + 0.5)


def to_score(value):
    """Turn a cell into an int score from 0 to 10, or None if it's empty or not a valid score.
    A half point such as 6.5 is rounded up."""
    try:
        score = round_half_up(float(str(value).strip()))
    except (ValueError, OverflowError):  # OverflowError: a cell like "inf"
        return None
    return score if SCORE_MIN <= score <= SCORE_MAX else None


def to_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------- agreement measures ----------

def quadratic_weighted_kappa(a, b):
    """Cohen's kappa with quadratic weights, for two lists of 0-10 scores on the same items.
    1 means perfect agreement, 0 means no better than chance."""
    k = SCORE_MAX - SCORE_MIN + 1
    observed = np.zeros((k, k))
    for x, y in zip(a, b):
        observed[x - SCORE_MIN, y - SCORE_MIN] += 1
    expected = np.outer(observed.sum(axis=1), observed.sum(axis=0)) / observed.sum()
    idx = np.arange(k)
    weights = (idx[:, None] - idx[None, :]) ** 2 / (k - 1) ** 2
    denominator = (weights * expected).sum()
    if denominator == 0:  # both lists are one constant score: kappa is undefined
        return float("nan")
    return 1 - (weights * observed).sum() / denominator


def ranks(values):
    """Ranks starting at 1, with tied values sharing their average rank."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    result = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for t in range(i, j + 1):
            result[order[t]] = (i + j) / 2 + 1
        i = j + 1
    return result


def spearman(a, b):
    ra, rb = np.array(ranks(list(a))), np.array(ranks(list(b)))
    if ra.std() == 0 or rb.std() == 0:
        return float("nan")
    return float(np.corrcoef(ra, rb)[0, 1])


def bootstrap_ci(a, b, groups, measure, seed=0):
    """95% confidence interval for measure(a, b) from a participant-level (cluster) bootstrap.

    Answers from the same participant are related (same speaker, same resume), so we resample
    whole participants with replacement and take all of their answers, not single answers."""
    rng = random.Random(seed)
    by_group = defaultdict(list)
    for idx, g in enumerate(groups):
        by_group[g].append(idx)
    keys = list(by_group)
    values = []
    for _ in range(BOOTSTRAP_ROUNDS):
        pick = [idx for _ in keys for idx in by_group[rng.choice(keys)]]
        v = measure([a[i] for i in pick], [b[i] for i in pick])
        if not np.isnan(v):
            values.append(v)
    if len(values) < BOOTSTRAP_ROUNDS / 2:
        return float("nan"), float("nan")
    return float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))


def krippendorff_alpha_interval(units):
    """Krippendorff's alpha (interval) across all human raters.
    units: one list of scores per answer (only answers scored by 2 or more raters count)."""
    units = [u for u in units if len(u) >= 2]
    values = [v for u in units for v in u]
    n = len(values)
    if n < 2:
        return float("nan")
    observed = sum(sum((x - y) ** 2 for x in u for y in u) / (len(u) - 1) for u in units) / n
    arr = np.array(values, dtype=float)
    expected = ((arr[:, None] - arr[None, :]) ** 2).sum() / (n * (n - 1))
    return float("nan") if expected == 0 else 1 - observed / expected


def compare(a, b, groups, b_exact=None):
    """All the numbers for one pair of scorers, on items both scored.

    a is always whole scores. b may be an unrounded average of raters (for example 6.5); then
    b_exact holds b rounded half up, used for kappa and for "exact" agreement."""
    a, b = list(a), list(b)
    b_int = list(b_exact) if b_exact is not None else b
    kappa = quadratic_weighted_kappa(a, b_int)
    lo, hi = bootstrap_ci(a, b_int, groups, quadratic_weighted_kappa)
    return {
        "n": len(a),
        "qwk": kappa, "qwk_lo": lo, "qwk_hi": hi,
        "spearman": spearman(a, b),
        "mad": mean(abs(x - y) for x, y in zip(a, b)),
        "bias": mean(x - y for x, y in zip(a, b)),  # positive: the first scorer gives higher scores
        "exact": mean(x == y for x, y in zip(a, b_int)),
        "within1": mean(abs(x - y) <= 1 for x, y in zip(a, b)),
    }


# ---------- formatting ----------

def fmt(x, digits=2):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.{digits}f}"


def pair_row(name, r):
    return (f"| {name} | {r['n']} | {fmt(r['qwk'])} [{fmt(r['qwk_lo'])}, {fmt(r['qwk_hi'])}] | "
            f"{fmt(r['spearman'])} | {fmt(r['mad'])} | {r['bias']:+.2f} | {r['exact']:.0%} | {r['within1']:.0%} |")


PAIR_HEADER = ("| Pair | Answers | Weighted kappa [95% CI] | Spearman ρ | Mean abs. diff. | Bias (first − second) "
               "| Exact | Within 1 |\n|---|---|---|---|---|---|---|---|")


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exports", default="exports", help="folder with the export files (default: exports)")
    parser.add_argument("--out", default=os.path.join("analysis", "out"), help="where to write results")
    args = parser.parse_args()

    key = read_csv(os.path.join(args.exports, "key_llm_scores.csv"))
    blind = {r["item_id"]: r for r in read_csv(os.path.join(args.exports, "raters_blind.csv"))}
    items = {}
    for r in key:
        score = to_score(r.get("llm_score"))
        if score is None:  # unscored turn (the AI's reply could not be read)
            continue
        answer = blind.get(r["item_id"], {}).get("answer", "")
        items[r["item_id"]] = {
            "skill": r.get("assessed_skill"),
            "mode": r.get("input_mode") or "unknown",
            "participant": r.get("participant_code"),
            "llm": score,
            "latency_ms": to_number(r.get("latency_ms")),
            "stt_ms": to_number(r.get("stt_ms")),
            "words": len(answer.split()),
        }

    raters = {}
    for path in sorted(glob.glob(os.path.join(args.exports, "raters", "*.csv"))):
        name = os.path.splitext(os.path.basename(path))[0]
        scores, bad, seen = {}, [], set()
        for r in read_csv(path):
            item_id = r.get("item_id", "")
            if item_id in seen:
                print(f"WARNING: {name}: {item_id} appears more than once; keeping the last score.")
            seen.add(item_id)
            score = to_score(r.get("rater_score"))
            if score is not None:
                scores[item_id] = score
            elif str(r.get("rater_score", "")).strip():
                bad.append(item_id)
        raters[name] = {k: v for k, v in scores.items() if k in items}
        # A file saved with the wrong delimiter or half filled in shows up here as a low count.
        print(f"{name}: {len(raters[name])} of {len(items)} items scored")
        if bad:
            print(f"WARNING: {name}: scores that aren't 0 to 10 were skipped: {', '.join(bad)}")

    os.makedirs(args.out, exist_ok=True)
    lines = ["# InterviewAI results", ""]

    # Sample description
    participants = {v["participant"] for v in items.values()}
    lines += [f"**Scored answers:** {len(items)} from **{len(participants)}** participants.", "",
              "| Skill | Answers | Mean AI score |", "|---|---|---|"]
    for skill in SKILLS:
        s = [v["llm"] for v in items.values() if v["skill"] == skill]
        lines.append(f"| {skill} | {len(s)} | {fmt(mean(s)) if s else 'n/a'} |")
    lines += ["", "| Input mode | Answers | Mean AI score | Median words |", "|---|---|---|---|"]
    for mode in sorted({v["mode"] for v in items.values()}):
        rows = [v for v in items.values() if v["mode"] == mode]
        lines.append(f"| {mode} | {len(rows)} | {fmt(mean(r['llm'] for r in rows))} | "
                     f"{median(r['words'] for r in rows):.0f} |")

    # Timings
    lat = [v["latency_ms"] / 1000 for v in items.values() if v["latency_ms"]]
    stt = [v["stt_ms"] / 1000 for v in items.values() if v["stt_ms"]]
    lines += ["", "## Response time per turn", "", "| Step | Turns | Median (s) | 95th percentile (s) |", "|---|---|---|---|"]
    for label, xs in (("AI scoring + next question", lat), ("Speech to text", stt)):
        if xs:
            lines.append(f"| {label} | {len(xs)} | {median(xs):.2f} | {np.percentile(xs, 95):.2f} |")

    # Does the AI give longer answers higher scores?
    ids = list(items)
    rho_len = spearman([items[i]["words"] for i in ids], [items[i]["llm"] for i in ids])
    lines += ["", f"**Answer length vs AI score:** Spearman ρ = {fmt(rho_len)} (n = {len(ids)})."]

    # Agreement
    lines += ["", "Confidence intervals: participant-level (cluster) bootstrap, "
              f"{BOOTSTRAP_ROUNDS} resamples. Answer length is counted on the redacted text, "
              "where [name], [link] and so on count as one word.", "", "## Agreement", ""]
    if not raters:
        lines.append("No rater files yet. Put each rater's filled-in CSV in exports/raters/ and run this again.")
    else:
        names = list(raters)
        lines += [PAIR_HEADER]
        for name in names:
            common = [i for i in ids if i in raters[name]]
            if common:
                lines.append(pair_row(f"AI vs {name}", compare([items[i]["llm"] for i in common],
                                                              [raters[name][i] for i in common],
                                                              [items[i]["participant"] for i in common])))
        for i_a in range(len(names)):
            for i_b in range(i_a + 1, len(names)):
                a, b = names[i_a], names[i_b]
                common = [i for i in ids if i in raters[a] and i in raters[b]]
                if common:
                    lines.append(pair_row(f"{a} vs {b}", compare([raters[a][i] for i in common],
                                                                 [raters[b][i] for i in common],
                                                                 [items[i]["participant"] for i in common])))
        if len(names) >= 2:
            alpha = krippendorff_alpha_interval([[raters[n][i] for n in names if i in raters[n]] for i in ids])
            lines += ["", f"**Agreement among all human raters:** Krippendorff's alpha (interval) = {fmt(alpha)}."]

        # AI vs the average of all raters, overall and per skill. The average stays unrounded
        # for the differences, Spearman and charts; kappa and "exact" use it rounded half up.
        all_rated = [i for i in ids if all(i in raters[n] for n in names)]
        human = {i: mean(raters[n][i] for n in names) for i in all_rated}

        def vs_human(subset):
            return compare([items[i]["llm"] for i in subset], [human[i] for i in subset],
                           [items[i]["participant"] for i in subset],
                           b_exact=[round_half_up(human[i]) for i in subset])

        if all_rated:
            lines += ["", "AI vs the average human score, overall and by skill "
                      "(kappa and exact use the average rounded half up):", "", PAIR_HEADER]
            lines.append(pair_row("AI vs human average", vs_human(all_rated)))
            for skill in SKILLS:
                sk = [i for i in all_rated if items[i]["skill"] == skill]
                if len(sk) >= 5:
                    lines.append(pair_row(f"  {skill}", vs_human(sk)))
            make_charts(items, human, args.out)
            lines += ["", "Charts: scatter.png (AI vs human), difference_by_skill.png."]

    path = os.path.join(args.out, "results.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\nSaved to {path}")


def make_charts(items, human, out):
    # matplotlib is only needed once there are human scores to plot.
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ids = list(human)
    x = np.array([human[i] for i in ids], dtype=float)
    y = np.array([items[i]["llm"] for i in ids], dtype=float)
    # Small random jitter so identical score pairs don't hide each other.
    rng = np.random.default_rng(0)
    fig, ax = plt.subplots(figsize=(3.4, 3.2), dpi=300)
    ax.scatter(x + rng.uniform(-0.15, 0.15, len(x)), y + rng.uniform(-0.15, 0.15, len(y)),
               s=12, alpha=0.6, color="#2b6cb0", edgecolors="none")
    ax.plot([0, 10], [0, 10], color="#888", linewidth=0.8, linestyle="--")
    ax.set_xlim(-0.5, 10.5)
    ax.set_ylim(-0.5, 10.5)
    ax.set_xlabel("Average human score")
    ax.set_ylabel("AI score")
    ax.set_xticks(range(0, 11, 2))
    ax.set_yticks(range(0, 11, 2))
    fig.tight_layout()
    fig.savefig(os.path.join(out, "scatter.png"))
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(3.4, 2.6), dpi=300)
    data, labels = [], []
    for skill in SKILLS:
        d = [items[i]["llm"] - human[i] for i in ids if items[i]["skill"] == skill]
        if d:
            data.append(d)
            labels.append(skill.replace("_", "\n"))
    ax.boxplot(data, widths=0.5)
    ax.set_xticks(range(1, len(labels) + 1), labels, fontsize=7)
    ax.axhline(0, color="#888", linewidth=0.8, linestyle="--")
    ax.set_ylabel("AI − human score")
    fig.tight_layout()
    fig.savefig(os.path.join(out, "difference_by_skill.png"))
    plt.close(fig)


if __name__ == "__main__":
    main()
