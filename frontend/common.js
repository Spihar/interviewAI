// Shared helpers for the dashboard and report pages:
// Supabase session, authenticated API calls, nav user info and formatting.
const API_BASE = "http://127.0.0.1:8000";
const SUPABASE_URL  = "https://hincwkkvpdhaoyciailp.supabase.co";
const SUPABASE_ANON = "sb_publishable_RyzMJZWK_hBE9qHpubmsIg_1LJNyHPp";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let accessToken = null;

const SKILL_LABELS = {
  communication: "Communication",
  technical_depth: "Technical depth",
  problem_solving: "Problem solving",
  project_experience: "Project experience",
};

// requireSession sends the user to the sign-in page if they aren't logged in,
// otherwise fills in the nav with their name and returns the Supabase user.
async function requireSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "auth.html";
    return null;
  }
  accessToken = session.access_token;
  sb.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) accessToken = newSession.access_token;
    else window.location.href = "auth.html";
  });
  const user = session.user;
  const name = user.user_metadata?.full_name || user.email.split("@")[0];
  document.querySelectorAll("[data-user-name]").forEach((el) => (el.textContent = name));
  document.querySelectorAll("[data-user-initials]").forEach((el) => (el.textContent = initials(name)));
  return user;
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = "auth.html";
}

// api calls the FastAPI backend with the user's JWT and returns the parsed JSON, throwing on errors.
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Authorization": `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.detail) || `Request failed (${res.status})`);
  return data;
}

function initials(name) {
  return name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
}

function skillLabel(skill) {
  return SKILL_LABELS[skill] || (skill ? skill.replace(/_/g, " ") : "General");
}

// scoreClass maps a 0-10 score to the chip colour: 7+ good, 5-7 warn, below 5 bad.
function scoreClass(score) {
  const s = parseFloat(score);
  if (isNaN(s)) return "neutral";
  return s >= 7 ? "good" : s >= 5 ? "warn" : "bad";
}

function fmtScore(score) {
  const s = parseFloat(score);
  return isNaN(s) ? "–" : s.toFixed(1);
}

function fmtDate(iso, opts = { day: "numeric", month: "short" }) {
  if (!iso) return "–";
  const d = new Date(iso);
  return isNaN(d) ? "–" : d.toLocaleDateString(undefined, opts);
}

function deltaHtml(delta, suffix = "") {
  if (delta === null || delta === undefined) return "";
  const cls = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  const sign = delta > 0 ? "+" : "";
  return `<span class="delta ${cls}">${sign}${delta.toFixed(1)}${suffix}</span>`;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// practiceUrl returns the interview room URL for a practice interview focused on one topic.
function practiceUrl(topic) {
  return "index.html?focus=" + encodeURIComponent(topic);
}
