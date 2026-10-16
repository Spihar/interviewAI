// Report page: loads /reports/{id} for report.html?id=<interview id>.
window.onload = async () => {
  const user = await requireSession();
  if (!user) return;
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) { showError("No report selected. Open one from the dashboard."); return; }

  let r;
  try {
    r = await api("/reports/" + encodeURIComponent(id));
  } catch (err) {
    showError("Couldn't load this report. " + err.message);
    document.getElementById("title").textContent = "Report unavailable";
    return;
  }
  render(r);
};

function showError(msg) {
  const bar = document.getElementById("errorBar");
  bar.textContent = msg;
  bar.hidden = false;
}

const SKILLS = ["communication", "technical_depth", "problem_solving", "project_experience"];

function render(r) {
  const assessed = SKILLS.filter((s) => r.skills[s] !== null);
  const ranked = assessed.slice().sort((a, b) => r.skills[b] - r.skills[a]);
  const best = ranked[0], worst = ranked[ranked.length - 1];

  document.getElementById("meta").textContent =
    `Interview ${r.number} of ${r.total} · ${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })} · ${r.answers.length || r.questions} questions` +
    (r.focus_topic ? ` · Focus: ${r.focus_topic}` : "");
  let title = "Interview report";
  if (best && worst && best !== worst) title = `Strongest in ${skillLabel(best).toLowerCase()}, weakest in ${skillLabel(worst).toLowerCase()}`;
  document.getElementById("title").textContent = title;

  const score = parseFloat(r.avg_score) || 0;
  document.getElementById("ringVal").textContent = fmtScore(score);
  requestAnimationFrame(() => document.getElementById("ringArc").setAttribute("stroke-dasharray", `${(score / 10) * 97.4} 97.4`));
  document.getElementById("feedback").textContent = r.feedback || "No feedback was saved for this interview.";
  document.getElementById("improvements").textContent = r.improvements || "–";

  const chips = [];
  if (r.previous) {
    const d = score - (parseFloat(r.previous.avg_score) || 0);
    chips.push(`<span class="chip ${d > 0.05 ? "good" : d < -0.05 ? "bad" : "neutral"} num">${d > 0 ? "+" : ""}${d.toFixed(1)} vs previous interview</span>`);
  }
  if (r.llm_score !== null && r.llm_score !== undefined) chips.push(`<span class="chip neutral num">Interviewer's overall score ${fmtScore(r.llm_score)}/10</span>`);
  document.getElementById("summaryChips").innerHTML = chips.join("");

  // Per-skill comparison with the previous interview
  if (!r.previous) document.getElementById("prevLegend").hidden = true;
  document.getElementById("cmp").innerHTML = SKILLS.map((s) => {
    const now = r.skills[s], prev = r.previous ? r.previous.skills[s] : null;
    const d = now !== null && prev !== null ? now - prev : null;
    return `<div class="cmp">
      <span>${skillLabel(s)}</span>
      <div class="bars">
        <span style="width:${(now || 0) * 10}%;background:var(--accent)"></span>
        ${r.previous ? `<span style="width:${(prev || 0) * 10}%;background:var(--line)"></span>` : ""}
      </div>
      <span class="val num"><b>${now === null ? "–" : fmtScore(now)}</b> ${deltaHtml(d)}</span>
    </div>`;
  }).join("");

  // Focus next: weak topics, then suggested topics, then the lowest answers
  const focus = document.getElementById("focusNext");
  const items = [
    ...r.weak_topics.map((t) => ({ name: t.topic, chip: skillLabel(t.skill), cls: "bad", why: t.why })),
    ...r.suggested_topics.map((t) => ({ name: t.title, chip: "Practice", cls: "neutral", why: t.why, practice: true })),
  ];
  if (!items.length) {
    r.answers.map((a, i) => ({ ...a, i })).filter((a) => a.score !== null && a.score < 5).slice(0, 3)
      .forEach((a) => items.push({ name: a.question, chip: `Q${a.i + 1}`, cls: "bad", why: a.justification }));
  }
  focus.innerHTML = items.length ? items.map((t) => `
    <div class="list-item">
      <strong>${escHtml(t.name)}</strong>
      ${t.practice ? `<a class="btn sm" href="${practiceUrl(t.name)}">Practice</a>` : `<span class="chip ${t.cls}">${escHtml(t.chip)}</span>`}
      ${t.why ? `<p>${escHtml(t.why)}</p>` : ""}
    </div>`).join("") : `<div class="empty">Nothing stood out as weak in this interview.</div>`;

  const practiceTopic = r.weak_topics[0]?.topic || r.suggested_topics[0]?.title || (worst && skillLabel(worst));
  if (practiceTopic) {
    const btn = document.getElementById("practiceBtn");
    btn.href = practiceUrl(practiceTopic);
    btn.textContent = "Practice weak topics";
  }

  // Question by question; the lowest-scored one starts open
  const scores = r.answers.map((a) => (a.score === null ? 11 : a.score));
  const lowest = scores.length ? scores.indexOf(Math.min(...scores)) : -1;
  document.getElementById("answers").innerHTML = r.answers.length ? r.answers.map((a, i) => `
    <details ${i === lowest ? "open" : ""}>
      <summary>
        <span class="n">Q${i + 1}</span>
        <span class="q">${escHtml(a.question)}</span>
        <span class="chip neutral skill-chip">${skillLabel(a.skill)}</span>
        <span class="chip ${scoreClass(a.score)} num">${a.score === null ? "Not scored" : fmtScore(a.score) + "/10"}</span>
      </summary>
      <div class="body">
        <div class="answer">${escHtml(a.answer)}</div>
        ${a.justification ? `<div><b>Why this score.</b> ${escHtml(a.justification)}</div>` : ""}
        ${a.feedback ? `<div><b>Feedback.</b> ${escHtml(a.feedback)}</div>` : ""}
        ${a.band ? `<div><b>Band.</b> ${escHtml(a.band)}</div>` : ""}
      </div>
    </details>`).join("") : `<div class="empty">No answers were saved for this interview.</div>`;

  document.getElementById("body").hidden = false;
}
