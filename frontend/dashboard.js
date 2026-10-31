// Dashboard: loads /dashboard and renders stats, the skill trend chart, weak topics,
// suggested practice and past interviews.
let DATA = null;
const shownSkills = {};

window.onload = async () => {
  document.getElementById("today").textContent =
    new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const user = await requireSession();
  if (!user) return;

  try {
    DATA = await api("/dashboard");
  } catch (err) {
    showError("Couldn't load your interviews. Check that the backend is running, then refresh. (" + err.message + ")");
    document.getElementById("headline").textContent = "";
    return;
  }

  if (!DATA.interviews.length) {
    document.getElementById("stats").hidden = true;
    document.getElementById("welcome").hidden = false;
    document.getElementById("headline").textContent = "You haven't finished an interview yet.";
    return;
  }

  DATA.skills.forEach((s) => (shownSkills[s] = true));
  renderHeadline();
  renderKpis();
  renderLegend();
  renderTrend();
  renderSkillsNow();
  renderWeakTopics();
  renderImproved();
  renderSuggested();
  renderHistory();
};

document.addEventListener("themechange", () => DATA && DATA.interviews.length && renderTrend());
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => DATA && DATA.interviews.length && renderTrend());

function showError(msg) {
  const bar = document.getElementById("errorBar");
  bar.textContent = msg;
  bar.hidden = false;
}

// rankedSkills returns the skills that have a current average, best first.
function rankedSkills() {
  return DATA.skills
    .filter((s) => DATA.skills_now[s].avg !== null)
    .sort((a, b) => DATA.skills_now[b].avg - DATA.skills_now[a].avg);
}

function renderHeadline() {
  const n = DATA.interviews.length;
  const ranked = rankedSkills();
  const weakest = ranked[ranked.length - 1];
  let text = `${n} interview${n === 1 ? "" : "s"} so far.`;
  if (weakest && ranked.length > 1) text += ` ${skillLabel(weakest)} is your weakest skill right now.`;
  document.getElementById("headline").textContent = text;

  const topic = DATA.weak_topics[0]?.topic || DATA.suggested_topics[0]?.title || (weakest && skillLabel(weakest));
  if (topic) {
    const btn = document.getElementById("practiceWeakBtn");
    btn.href = practiceUrl(topic);
    btn.hidden = false;
    btn.title = "Practice: " + topic;
  }
}

function renderKpis() {
  const list = DATA.interviews;
  const last = list[list.length - 1];
  const prev = list[list.length - 2];
  const weekAgo = Date.now() - 7 * 864e5;
  const thisWeek = list.filter((i) => i.date && new Date(i.date).getTime() >= weekAgo).length;
  const ranked = rankedSkills();
  const best = ranked[0], worst = ranked[ranked.length - 1];
  const lastScore = parseFloat(last.avg_score);
  const delta = prev ? lastScore - parseFloat(prev.avg_score) : null;

  document.getElementById("kpis").innerHTML = `
    <div class="kpi"><span class="eyebrow">Interviews</span><span class="v num">${list.length}</span><span class="delta flat">${thisWeek} this week</span></div>
    <div class="kpi"><span class="eyebrow">Latest score</span><span class="v num">${fmtScore(lastScore)}<small>/10</small></span>${prev ? deltaHtml(delta, " vs previous") : '<span class="delta flat">First interview</span>'}</div>
    <div class="kpi"><span class="eyebrow">Strongest skill</span><span class="v word">${best ? skillLabel(best) : "–"}</span><span class="delta up">${best ? "avg " + fmtScore(DATA.skills_now[best].avg) : ""}</span></div>
    <div class="kpi"><span class="eyebrow">Needs work</span><span class="v word">${worst && worst !== best ? skillLabel(worst) : "–"}</span><span class="delta down">${worst && worst !== best ? "avg " + fmtScore(DATA.skills_now[worst].avg) : ""}</span></div>`;
}

function renderLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = "";
  DATA.skills.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", shownSkills[s]);
    b.innerHTML = `<i style="background:var(--skill-${s})"></i>${skillLabel(s)}`;
    b.onclick = () => { shownSkills[s] = !shownSkills[s]; renderLegend(); renderTrend(); };
    el.appendChild(b);
  });
}

// renderTrend draws one line per skill across interviews, on a fixed 0-10 scale.
// Interviews that didn't assess a skill leave a gap in that skill's line.
function renderTrend() {
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const list = DATA.interviews.slice(-12);
  const W = 640, H = 240, pl = 30, pr = 16, pt = 12, pb = 26;
  const n = list.length;
  const x = (i) => (n === 1 ? (pl + W - pr) / 2 : pl + i * (W - pl - pr) / (n - 1));
  const y = (v) => pt + (10 - v) * (H - pt - pb) / 10;
  const step = Math.max(1, Math.ceil(n / 8));   // thin out date labels when there are many interviews
  let h = "";
  [0, 2, 4, 6, 8, 10].forEach((t) => {
    h += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  });
  list.forEach((row, i) => {
    if (i % step === 0 || i === n - 1) h += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${fmtDate(row.date)}</text>`;
  });
  DATA.skills.forEach((s) => {
    if (!shownSkills[s]) return;
    const col = css(`--skill-${s}`);
    let seg = [];
    const flush = () => {
      if (seg.length > 1) h += `<polyline fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${seg.join(" ")}"/>`;
      seg = [];
    };
    list.forEach((row, i) => {
      const v = row.skills[s];
      if (v === null || v === undefined) { flush(); return; }
      seg.push(`${x(i)},${y(v)}`);
    });
    flush();
    list.forEach((row, i) => {
      const v = row.skills[s];
      if (v === null || v === undefined) return;
      const lastPt = i === n - 1;
      h += `<circle cx="${x(i)}" cy="${y(v)}" r="${lastPt ? 4.5 : 3}" fill="${lastPt ? col : css("--surface")}" stroke="${col}" stroke-width="2" data-t="${escHtml(skillLabel(s))}: ${fmtScore(v)} on ${fmtDate(row.date)}"/>`;
    });
  });
  document.getElementById("trend").innerHTML = h;
}

// Tooltip for chart points
(function () {
  const box = document.getElementById("chartBox");
  let tip = null;
  const hide = () => { if (tip) tip.remove(); tip = null; };
  box.addEventListener("mousemove", (e) => {
    const c = e.target.closest("circle");
    if (!c) return hide();
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; box.appendChild(tip); }
    const r = box.getBoundingClientRect(), cr = c.getBoundingClientRect();
    tip.textContent = c.dataset.t;
    tip.style.left = cr.left - r.left + cr.width / 2 + "px";
    tip.style.top = cr.top - r.top + "px";
  });
  box.addEventListener("mouseleave", hide);
})();

function renderSkillsNow() {
  document.getElementById("skillsNow").innerHTML = DATA.skills.map((s) => {
    const now = DATA.skills_now[s];
    const width = now.avg === null ? 0 : now.avg * 10;
    return `<div class="skill-row">
      <span class="name"><i style="background:var(--skill-${s})"></i>${skillLabel(s)}</span>
      <span class="num"><b>${now.avg === null ? "–" : fmtScore(now.avg)}</b> ${deltaHtml(now.delta)}</span>
      <div class="bar"><span style="width:${width}%;background:var(--skill-${s})"></span></div>
    </div>`;
  }).join("");
}

function renderWeakTopics() {
  const el = document.getElementById("weakTopics");
  if (DATA.weak_topics.length) {
    el.innerHTML = DATA.weak_topics.map((t) => `
      <div class="list-item">
        <strong>${escHtml(t.topic)}</strong>
        <span class="chip ${t.count > 1 ? "bad" : "warn"}">${t.count > 1 ? `In ${t.count} interviews` : skillLabel(t.skill)}</span>
        ${t.why ? `<p>${escHtml(t.why)}</p>` : ""}
      </div>`).join("");
    return;
  }
  if (DATA.low_answers.length) {
    document.getElementById("weakHint").textContent = "Your lowest-scored answers";
    el.innerHTML = DATA.low_answers.map((a) => `
      <div class="list-item">
        <strong>${escHtml(a.question)}</strong>
        <span class="chip bad num">${fmtScore(a.score)}/10</span>
        ${a.justification ? `<p>${escHtml(a.justification)}</p>` : ""}
      </div>`).join("");
    return;
  }
  el.innerHTML = `<div class="empty">No weak topics yet. Answers scored below 5 show up here.</div>`;
}

function renderImproved() {
  const el = document.getElementById("improved");
  const rows = DATA.skills
    .filter((s) => DATA.skills_now[s].since_first !== null)
    .sort((a, b) => DATA.skills_now[b].since_first - DATA.skills_now[a].since_first);
  if (!rows.length) {
    el.innerHTML = `<div class="empty">Finish another interview to see how each skill changes.</div>`;
    return;
  }
  el.innerHTML = rows.map((s) => {
    const d = DATA.skills_now[s].since_first;
    const cls = d > 0.05 ? "good" : d < -0.05 ? "bad" : "neutral";
    const word = d > 0.05 ? "Improved" : d < -0.05 ? "Dropped" : "Steady";
    return `<div class="list-item"><strong>${skillLabel(s)}</strong><span class="chip ${cls} num">${word} ${d > 0 ? "+" : ""}${d.toFixed(1)}</span></div>`;
  }).join("");
}

function renderSuggested() {
  let items = DATA.suggested_topics.map((t) => ({ title: t.title, skill: t.skill, why: t.why }));
  if (!items.length) {
    // Reports from before suggested topics existed: suggest the two weakest skills instead.
    items = rankedSkills().reverse().slice(0, 2).map((s) => ({
      title: skillLabel(s), skill: s, why: `Your average here is ${fmtScore(DATA.skills_now[s].avg)}. A focused interview gives you more practice on it.`,
    }));
  }
  if (!items.length) { document.getElementById("suggestPanel").hidden = true; return; }
  document.getElementById("suggested").innerHTML = items.map((t) => {
    const avg = t.skill ? DATA.skills_now[t.skill]?.avg : null;
    return `<div class="sugg-card">
      ${t.skill ? `<span class="chip ${scoreClass(avg)}">${skillLabel(t.skill)}</span>` : ""}
      <h3>${escHtml(t.title)}</h3>
      <p>${escHtml(t.why || "")}</p>
      <a class="btn sm primary" href="${practiceUrl(t.title)}">Practice this</a>
    </div>`;
  }).join("");
}

function renderHistory() {
  const rows = DATA.interviews.slice().reverse();
  const body = document.getElementById("historyRows");
  body.innerHTML = rows.map((r) => {
    const assessed = DATA.skills.filter((s) => r.skills[s] !== null);
    const weakest = assessed.sort((a, b) => r.skills[a] - r.skills[b])[0];
    return `<tr data-href="report.html?id=${encodeURIComponent(r.interview_id)}" tabindex="0">
      <td>${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })}</td>
      <td class="num">${r.questions || "–"}</td>
      <td><span class="chip ${scoreClass(r.avg_score)} num">${fmtScore(r.avg_score)}</span></td>
      <td>${weakest ? skillLabel(weakest) : "–"}</td>
      <td>${r.focus_topic ? escHtml(r.focus_topic) : '<span style="color:var(--muted)">Full interview</span>'}</td>
    </tr>`;
  }).join("");
  const open = (tr) => tr && (window.location.href = tr.dataset.href);
  body.addEventListener("click", (e) => open(e.target.closest("tr[data-href]")));
  body.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e.target.closest("tr[data-href]")); });
}
