# Fixed scoring rubric for the interview.
# The LLM scores each answer against these bands/criteria, and the server (not the LLM)
# keeps the per-skill evidence and decides when the interview has enough to stop.

RUBRIC_VERSION = "v1"   # saved with every chat_history row and report, bump it when the rubric changes

SKILLS = ["communication", "technical_depth", "problem_solving", "project_experience"]

# Score bands (0-10), the same for every skill
SCORE_BANDS = [
    ("0-2", "No answer, off-topic or incorrect"),
    ("3-4", "Superficial: generic statements, no specifics"),
    ("5-6", "Adequate: relevant and mostly correct, limited depth or examples"),
    ("7-8", "Strong: specific, correct, with concrete examples or reasoning"),
    ("9-10", "Excellent: deep, precise, discusses trade-offs or alternatives"),
]

# What each skill looks for
SKILL_CRITERIA = {
    "communication": "clear structure, answers the question asked, concise, understandable",
    "technical_depth": "correctness of concepts, understanding of how/why, appropriate terminology",
    "problem_solving": "breaks the problem down, reasons step by step, considers edge cases and trade-offs",
    "project_experience": "concrete personal contribution, decisions made and why, outcomes/impact, tools used",
}

MIN_QUESTIONS = 5             # never stop before this many answered questions
MAX_QUESTIONS = 12            # always stop at this many answered questions
MAX_TURNS = MAX_QUESTIONS + 3 # hard stop counting unscored turns too, so repeated LLM parse failures can't run forever
MIN_EVIDENCE_PER_SKILL = 2    # scored answers needed before a skill is settled
DECISIVE_LOW = 3              # a single answer scoring this or lower settles a skill
DECISIVE_HIGH = 8             # a single answer scoring this or higher settles a skill


# rubric_text formats the bands and criteria for the LLM prompt.
def rubric_text():
    lines = ["Score bands (0-10, same for every skill):"]
    for band, meaning in SCORE_BANDS:
        lines.append(f"- {band}: {meaning}")
    lines.append("")
    lines.append("Skill criteria:")
    for skill in SKILLS:
        lines.append(f"- {skill}: {SKILL_CRITERIA[skill]}")
    return "\n".join(lines)


# empty_state is the evaluation state of a new interview: no scored answers for any skill.
def empty_state():
    return {skill: {"count": 0, "avg": 0.0} for skill in SKILLS}


# normalize_state makes sure the evaluation state has the {skill: {"count", "avg"}} shape.
# Interviews saved before the rubric used a flat {skill: number} shape, those are reset to zero counts.
def normalize_state(state):
    normalized = empty_state()
    if not isinstance(state, dict):
        return normalized
    for skill in SKILLS:
        value = state.get(skill)
        if isinstance(value, dict):
            try:
                normalized[skill] = {"count": int(value.get("count", 0)), "avg": float(value.get("avg", 0))}
            except (TypeError, ValueError):
                pass
    return normalized


# add_score updates the running count/average of a skill with one scored answer.
def add_score(state, skill, score):
    entry = state[skill]
    total = entry["avg"] * entry["count"] + score
    entry["count"] += 1
    entry["avg"] = round(total / entry["count"], 2)


# pick_target_skill returns the skill with the fewest scored answers (ties go by SKILLS order).
def pick_target_skill(state):
    return min(SKILLS, key=lambda skill: (state[skill]["count"], SKILLS.index(skill)))


# A skill is settled when it has enough answers, or one clearly low/high answer is enough to judge it.
def is_settled(entry):
    if entry["count"] >= MIN_EVIDENCE_PER_SKILL:
        return True
    return entry["count"] >= 1 and (entry["avg"] <= DECISIVE_LOW or entry["avg"] >= DECISIVE_HIGH)


# band_for returns the rubric band a 0-10 score falls in, e.g. 6.5 -> "5-6".
def band_for(score):
    if score < 3:
        return "0-2"
    if score < 5:
        return "3-4"
    if score < 7:
        return "5-6"
    if score < 9:
        return "7-8"
    return "9-10"


# should_stop decides whether the interview has enough evidence, returning (stop, reason).
# answered counts scored answers; total_turns counts every turn, including ones the LLM response couldn't be parsed for.
def should_stop(state, answered, total_turns=0):
    if answered >= MAX_QUESTIONS:
        return True, f"Reached maximum of {MAX_QUESTIONS} questions"
    if total_turns >= MAX_TURNS:
        return True, f"Reached maximum of {MAX_TURNS} turns"
    unsettled = [skill for skill in SKILLS if not is_settled(state[skill])]
    if answered < MIN_QUESTIONS:
        return False, f"Answered {answered} questions, need at least {MIN_QUESTIONS}"
    if not unsettled:
        return True, "Enough evidence for every skill"
    return False, f"Need more evidence for: {', '.join(unsettled)}"
