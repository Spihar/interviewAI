// API_BASE, the Supabase client (sb), accessToken, escHtml, initials, SKILL_LABELS and logout come from common.js,
// which index.html loads first, so the backend address and Supabase keys live in one place.
let session_id = "";
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let questionCount = 0;
let totalScore = 0;
let pendingSttMs = null;   // how long the last transcription took, sent with the next answer
let pendingTranscript = null;   // the transcription itself, to tell "voice" from "voice_edited" answers
// Read AI questions aloud; defaults to on, and localStorage can throw in private windows.
let voiceOn = true;
try { voiceOn = localStorage.getItem("voiceOn") !== "false"; } catch (e) { voiceOn = true; }

// ── Supabase session ──────────────────────────────────────────────────────────
// Supabase is our authentication provider; the client (sb) is created in common.js with the publishable key,
// because Supabase is only used for auth here and all sensitive operations happen in the backend, which verifies the JWT.
// The onAuthStateChange listener keeps our frontend in sync with the user's auth status (e.g. if they log out in another tab).
let currentUser  = null;
// ── Session init ──────────────────────────────────────────────────────────────
// This runs before anything else.
// If the user is not logged in, they get kicked to auth.html immediately.
// The page will appear blank for a split second — that's normal and correct.
window.onload = async() => {
  // getSession() reads the token from localStorage (Supabase stored it there
  // when the user logged in on auth.html). It also auto-refreshes expired tokens.
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    // No session = not logged in. Hard redirect.
    window.location.href = "auth.html";
    return; // stop everything below from running
  }
  // We have a valid session. Store what we need.
  currentUser = session.user;
  accessToken = session.access_token; // JWT we'll attach to every API call
  // Show the user's name in the topbar
  const name = currentUser.user_metadata?.full_name || currentUser.email.split("@")[0];
  document.getElementById("userNameLabel").textContent = name;
  document.getElementById("userNameNav").textContent = name;
  document.getElementById("userInitials").textContent = initials(name);
  // Keep accessToken fresh if Supabase refreshes the session in the background
  sb.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) {
      accessToken = newSession.access_token;
    } else {
      // Session died (user deleted, token revoked, etc) — redirect to login
      window.location.href = "auth.html";
    }
  }); 

  renderCoverage(null);
  // The interview starts only after the privacy note is accepted (acceptConsent), so the controls wait until then.
  setInterviewControls(false);
  // Auto-resize textarea
  const ta = document.getElementById("history");
  ta.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  });
  // Send on Ctrl+Enter / Cmd+Enter
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      askAI();
    }
  });
};
// ── LOGOUT ────────────────────────────────────────────────────────────────────
// logout() in common.js clears the JWT from localStorage and ends the Supabase session.
// After this, getSession() will return null — auth guard kicks them out.
// ------------------------important note about auth-------------------------
// The JWT (accessToken) is stored in localStorage by the Supabase SDK when the user logs in.
// We read this token on page load and attach it to every API call in the authHeaders() function below.
// FastAPI verifies this token on each request to authenticate the user.
// If the token is missing/invalid/expired, the backend will reject the request and we can handle that in the frontend (e.g. show an error or redirect to login).
// ── HELPER: attach auth header to every API call ──────────────────────────────
// Instead of copy-pasting the Authorization header everywhere, use this.
// FastAPI reads this header, verifies the JWT with Supabase, and gets user_id.
function authHeaders(extra = {}) {
  return {
    "Authorization": `Bearer ${accessToken}`,  // JWT goes here
    ...extra
  };
}

// ── Consent ───────────────────────────────────────────────────────────────────
// The server rejects /start_interview without consent: true, and stores when it was given.
async function acceptConsent() {
  if (!document.getElementById("consentBox").checked) { shakeElement("consentCard"); return; }
  document.getElementById("consentBtn").disabled = true;
  await startSession();
}

function setInterviewControls(enabled) {
  ["sendBtn", "recordBtn"].forEach((id) => { document.getElementById(id).disabled = !enabled; });
}

async function startSession() {
  try {
    // A practice interview from the dashboard passes its topic as ?focus=
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) {
      const chip = document.getElementById("focusChip");
      chip.textContent = "Practice focus: " + focus;
      chip.hidden = false;
    }
    const res = await fetch(`${API_BASE}/start_interview`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ focus_topic: focus || null, consent: true }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.detail || data.error);

    session_id = data.session_id;
    document.getElementById("sessionIdLabel").textContent = "Session " + session_id.slice(0, 8);
    document.getElementById("sessionBadge").classList.add("active");
    document.getElementById("consentCard").remove();
    document.getElementById("emptyState").hidden = false;
    // Only the resume upload (or starting without one) is possible until the first question arrives.
    document.getElementById("uploadBtn").disabled = false;
    document.getElementById("skipResumeBtn").disabled = false;
    setStatus("Session active — upload your resume, or start without one");
  } catch (err) {
    document.getElementById("consentBtn").disabled = false;   // let them try again
    document.getElementById("sessionIdLabel").textContent = "Connection failed";
    setStatus("⚠ Could not connect to backend. Is it running?");
  }
}

// ── Resume upload ──────────────────────────────────────────────────────────────
function handleFileSelect() {
  const file = document.getElementById("resumeFile").files[0];
  if (!file) return;
  const zone = document.getElementById("resumeZone");
  document.getElementById("resumeZoneText").innerHTML =
    `<strong>${escHtml(file.name)}</strong><br/><small style="font-size:11px;">Ready to upload</small>`;
}

async function uploadResume() {
  const fileInput = document.getElementById("resumeFile");
  const file = fileInput.files[0];
  if (!file) {
    shakeElement("resumeZone");
    return;
  }
  const btn = document.getElementById("uploadBtn");
  btn.textContent = "Uploading…";
  btn.disabled = true;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(`${API_BASE}/upload_resume?session_id=${session_id}`, {
      method: "POST",
      headers: authHeaders(), // Attach auth header with JWT
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.detail || data.error || "Upload failed");

    const zone = document.getElementById("resumeZone");
    zone.classList.add("uploaded");
    zone.style.cursor = "default";
    document.getElementById("resumeZoneText").innerHTML =
      `✅ <strong>${escHtml(file.name)}</strong><br/><small style="font-size:11px;">Resume uploaded</small>`;

    btn.textContent = "✓ Uploaded";
    btn.style.borderColor = "var(--success)";
    btn.style.color = "var(--success)";
    await openInterview();
  } catch (err) {
    btn.textContent = "Upload Failed";
    btn.style.borderColor = "var(--danger)";
    btn.style.color = "var(--danger)";
    btn.disabled = false;
    setStatus("Resume upload failed: " + err.message);
    console.error(err);
  }
}

// ── Opening question ─────────────────────────────────────────────────────────────
// The opening /interview call has no answer yet (user is ""), so the server saves no chat_history row
// and returns the AI's intro question. The candidate's reply to it is then the first scored turn.
let interviewOpened = false;
async function openInterview() {
  if (interviewOpened) return;
  interviewOpened = true;
  document.getElementById("uploadBtn").disabled = true;
  document.getElementById("skipResumeBtn").disabled = true;
  const typingId = addTypingIndicator();
  setStatus("Preparing your first question…");
  try {
    const res = await fetch(`${API_BASE}/interview`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ session_id, user: "" }),
    });
    const data = await res.json();
    removeTypingIndicator(typingId);
    if (!res.ok || data.error) throw new Error(data.error || data.detail || "please try again");
    addAIMessage(data.question);
    if (data.skill_state) renderCoverage(data.skill_state, data.target_skill, data.settled);
    setInterviewControls(true);
    document.getElementById("skipResumeBtn").hidden = true;
    setStatus("Interview started — answer the question above");
  } catch (err) {
    removeTypingIndicator(typingId);
    interviewOpened = false;   // let them try again
    const retry = document.getElementById("skipResumeBtn");
    retry.textContent = "Try again";   // any uploaded resume is already saved, so this keeps it
    retry.disabled = false;
    addAIMessage("Couldn't get the first question: " + err.message, false);
    setStatus("Couldn't start — press Try again");
    console.error(err);
  }
}

// ── Ask AI ─────────────────────────────────────────────────────────────────────
async function askAI() {
  const ta = document.getElementById("history");
  const user = ta.value.trim();
  if (!user) { shakeElement("history"); return; }
  // Saved with the turn for the research data: was this answer spoken, and was the transcript edited?
  const inputMode = pendingTranscript === null ? "typed" : user === pendingTranscript.trim() ? "voice" : "voice_edited";

  // Show user bubble
  addUserMessage(user);
  ta.value = "";
  ta.style.height = "auto";
  document.getElementById("charCount").textContent = "0";
  document.getElementById("sendBtn").disabled = true;

  // Show typing indicator
  const typingId = addTypingIndicator();
  setStatus("AI is thinking…");

  try {
    const res = await fetch(`${API_BASE}/interview`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }), // Attach auth header with JWT
      body: JSON.stringify({ session_id, user, stt_ms: pendingSttMs, input_mode: inputMode }),
    });
    const data = await res.json();
    removeTypingIndicator(typingId);

    if (!res.ok || data.error) {
      // Errors are shown but not read aloud. The answer wasn't saved, so put it back for resending.
      addAIMessage("Sorry, something went wrong: " + (data.error || data.detail || "please try again"), false);
      ta.value = user;
      document.getElementById("charCount").textContent = user.length;
      setStatus("Error occurred");
    } else {
      // The answer is saved, so a typed follow-up answer has no transcription time.
      // (On an error the answer is put back for resending and keeps its voice details.)
      pendingSttMs = null;
      pendingTranscript = null;
      // Add AI question bubble
      addAIMessage(data.question);
      // Add feedback card
      addFeedbackCard(data.feedback, data.score);
      if (data.skill_state) renderCoverage(data.skill_state, data.target_skill, data.settled);

      // Update stats — only for answers the server counts towards the final report
      // (not the opening turn or unparseable AI responses), so the numbers match the report.
      // Done before the stop check so the last answer is included.
      if (data.counted) {
        questionCount++;
        totalScore += parseFloat(data.score) || 0;
        document.getElementById("statQ").textContent = questionCount;
        document.getElementById("statScore").innerHTML =
          (totalScore / questionCount).toFixed(1) + '<span>/10</span>';
      }

      if (data.decision === "stop") {
        setStatus("Interview completed — generating final report...");
        await endInterview();
        return;
      }

      if (data.counted) {
        setStatus(`Question ${questionCount} answered — keep going!`);
      } else if (questionCount === 0) {
        setStatus("Interview started — answer the question above");
      } else {
        setStatus("Couldn't score that answer — keep going!");
      }
    }
  } catch (err) {
    removeTypingIndicator(typingId);
    addAIMessage("Connection error. Please check the backend is running.", false);
    setStatus("Connection error");
    console.error(err);
  }

  document.getElementById("sendBtn").disabled = false;
}

// ── End interview ──────────────────────────────────────────────────────────────
async function endInterview() {
  if (questionCount === 0) {
    shakeElement("emptyState");
    return;
  }
  setStatus("Generating your final report…");
  const typingId = addTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/end_interview`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }), // Attach auth header with JWT
      body: JSON.stringify({ session_id, user: "" }),
    });
    const data = await res.json();
    // On success the server returns total_questions, average_score, llm_score, feedback, improvements,
    // skill_scores, weak_topics, suggested_topics and interview_id (see report_response in server.py).
    if (!res.ok || data.error) throw new Error(data.error || data.detail || "Report failed");
    removeTypingIndicator(typingId);
    addReportCard(data);
    setStatus("Interview complete — check your report below");
  } catch (err) {
    removeTypingIndicator(typingId);
    addAIMessage("Couldn't generate report. " + err.message, false);
    console.error(err);
  }
}

// ── Recording ──────────────────────────────────────────────────────────────────
async function toggleRecording() {
  if (!isRecording) {
    await startRecording();
  } else {
    stopRecording();
  }
}

async function startRecording() {
  try {
    audioChunks = [];
    stopSpeaking(); // don't let the mic pick up the AI's voice
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.start();
    isRecording = true;

    const btn = document.getElementById("recordBtn");
    btn.classList.add("recording");
    document.getElementById("recordLabel").textContent = "Stop";
    setStatus("🔴 Recording… click Stop when done");
  } catch (err) {
    alert("Microphone access denied. Please allow mic access in browser.");
  }
}

function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;

  const btn = document.getElementById("recordBtn");
  btn.classList.remove("recording");
  document.getElementById("recordLabel").textContent = "Speak";
  setStatus("Transcribing audio…");

  mediaRecorder.onstop = async () => {
    try {
      mediaRecorder.stream.getTracks().forEach((t) => t.stop());
      // Safari records mp4 and Firefox ogg, so keep the recorder's real type and a matching extension.
      const mimeType = mediaRecorder.mimeType || "audio/webm";
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      const formData = new FormData();
      formData.append("file", audioBlob, `recording.${ext}`);

      document.getElementById("history").value = "Transcribing…";

      const res = await fetch(`${API_BASE}/speech_to_text?session_id=${encodeURIComponent(session_id)}`, { method: "POST", headers: authHeaders(), body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Transcription failed");
      pendingSttMs = Number.isFinite(data.stt_ms) ? data.stt_ms : null;
      pendingTranscript = data.text;
      document.getElementById("history").value = data.text;
      document.getElementById("charCount").textContent = data.text.length;
      setStatus("Transcription done — review and send");
    } catch (err) {
      document.getElementById("history").value = "";
      pendingSttMs = null;
      pendingTranscript = null;
      setStatus("Transcription failed");
      console.error(err);
    }
    audioChunks = [];
  };
}

// ── DOM helpers ────────────────────────────────────────────────────────────────
function hideEmptyState() {
  const es = document.getElementById("emptyState");
  if (es) es.remove();
}

function addUserMessage(text) {
  hideEmptyState();
  const chat = document.getElementById("chat");
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `
    <div class="bubble user">${escHtml(text)}</div>
    <div class="avatar user">You</div>
  `;
  chat.appendChild(row);
  scrollToBottom();
}

// addAIMessage shows an AI bubble; questions are read aloud, errors pass speakIt=false.
function addAIMessage(text, speakIt = true) {
  hideEmptyState();
  const chat = document.getElementById("chat");
  const row = document.createElement("div");
  row.className = "msg-row";
  row.innerHTML = `
    <div class="avatar ai">AI</div>
    <div class="bubble ai">${escHtml(text)}</div>
  `;
  chat.appendChild(row);
  scrollToBottom();
  if (speakIt) speak(text);
}

// ── Read-aloud (browser text-to-speech) ───────────────────────────────────────
// Uses the browser's built-in speechSynthesis, so it costs nothing and needs no server.
function speak(text) {
  if (!voiceOn || !("speechSynthesis" in window)) return;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((v) => v.lang.startsWith("en") && /natural|google|online/i.test(v.name))
    || voices.find((v) => v.lang.startsWith("en")) || null;
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function toggleVoice() {
  voiceOn = !voiceOn;
  try { localStorage.setItem("voiceOn", voiceOn); } catch (e) { /* storage blocked: keep the choice for this page only */ }
  if (!voiceOn) stopSpeaking();
  renderVoiceBtn();
}

function renderVoiceBtn() {
  const btn = document.getElementById("voiceBtn");
  if (!btn) return;
  btn.classList.toggle("off", !voiceOn);
  btn.title = voiceOn ? "AI reads questions aloud (click to mute)" : "Voice muted (click to turn on)";
  document.getElementById("voiceLabel").textContent = voiceOn ? "Voice on" : "Voice off";
}

// Chrome loads its voice list asynchronously and getVoices() is empty until it has; assigning a handler makes it
// start loading now, so the first question can usually use a natural English voice instead of the default one.
if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = () => {};
document.addEventListener("DOMContentLoaded", renderVoiceBtn);

function addFeedbackCard(feedback, score) {
  const chat = document.getElementById("chat");
  const s = parseFloat(score) || 0;
  const pillClass = s >= 7 ? "good" : s >= 4 ? "ok" : "low";
  const card = document.createElement("div");
  card.className = "feedback-card";
  card.innerHTML = `
    <div class="feedback-card-header">
      <span class="feedback-label">Feedback</span>
      <span class="score-pill ${pillClass}">${s}/10</span>
    </div>
    <div>${escHtml(feedback)}</div>
  `;
  chat.appendChild(card);
  scrollToBottom();
}

function addReportCard(data) {
  const chat = document.getElementById("chat");
  const avg = parseFloat(data.average_score) || 0;
  const llm = parseFloat(data.llm_score) || 0;
  const pillClass = avg >= 7 ? "good" : avg >= 4 ? "ok" : "low";

  const card = document.createElement("div");
  card.className = "report-card";
  card.innerHTML = `
    <h3>Interview Complete</h3> 
    <div class="report-row">
      <span class="report-row-label">Total Questions</span>
      <span class="report-row-val">${data.total_questions}</span>
    </div>
    <div class="report-row">
      <span class="report-row-label">Average Score</span>
      <span class="report-row-val"><span class="score-pill ${pillClass}">${avg.toFixed(1)}/10</span></span>
    </div>
    <div class="report-row">
      <span class="report-row-label">Final AI Score</span>
      <span class="report-row-val">
        <span class="score-pill ${pillClass}">${llm}/10</span>
      </span>
    </div>

    <div class="report-row">
      <span class="report-row-label">Status</span>
      <span class="report-row-val">${escHtml(data.status)}</span>
    </div>

    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border2);">
      <div style="font-size:10.5px; font-weight:600; letter-spacing:.8px; text-transform:uppercase; color:var(--accent-dark); margin-bottom:6px;">Feedback</div>
      <div style="font-size:13.5px; color:var(--text-primary); line-height:1.65;">${escHtml(data.feedback)}</div>
    </div>

    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border2);">
      <div style="font-size:10.5px; font-weight:600; letter-spacing:.8px; text-transform:uppercase; color:var(--accent-dark); margin-bottom:6px;">Areas to Improve</div>
      <div style="font-size:13.5px; color:var(--text-primary); line-height:1.65;">${escHtml(data.improvements)}</div>
    </div>

    <div class="report-actions">
      ${data.interview_id ? `<a class="btn primary" href="report.html?id=${encodeURIComponent(data.interview_id)}">Open full report</a>` : ""}
      <a class="btn" href="dashboard.html">Back to dashboard</a>
    </div>
  `;
  chat.appendChild(card);
  scrollToBottom();
}

// ── Skill coverage panel ──────────────────────────────────────────────────────
// Shows how many scored answers each rubric skill has (the server's evaluation state),
// whether the server considers it settled (services/rubric.py is_settled), and which skill the next question assesses.
const COVERAGE_SKILLS = Object.entries(SKILL_LABELS);   // [key, label] pairs, from common.js
const EVIDENCE_NEEDED = 2;   // dots drawn per skill, MIN_EVIDENCE_PER_SKILL in services/rubric.py

function renderCoverage(state, nextSkill, settledBySkill) {
  const el = document.getElementById("coverage");
  if (!el) return;
  el.innerHTML = COVERAGE_SKILLS.map(([key, label]) => {
    const entry = (state && state[key]) || { count: 0, avg: 0 };
    const settled = Boolean(settledBySkill && settledBySkill[key]);
    const cls = settled ? "done" : key === nextSkill ? "next" : "";
    const status = settled ? "settled" : key === nextSkill ? "next" : `${entry.count}/${EVIDENCE_NEEDED}`;
    const dots = Array.from({ length: EVIDENCE_NEEDED }, (_, i) =>
      `<i class="${i < Math.min(entry.count, EVIDENCE_NEEDED) || settled ? "on" : ""}"></i>`).join("");
    return `<div class="cov-row ${cls}"><span>${label}</span><span class="state">${status}</span><div class="dots">${dots}</div></div>`;
  }).join("");
}

function addTypingIndicator() {
  hideEmptyState();
  const chat = document.getElementById("chat");
  const id = "typing-" + Date.now();
  const row = document.createElement("div");
  row.className = "msg-row";
  row.id = id;
  row.innerHTML = `
    <div class="avatar ai">AI</div>
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  chat.appendChild(row);
  scrollToBottom();
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function setStatus(msg) {
  document.getElementById("chatStatusBar").innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
    ${escHtml(msg)}
  `;
}

function onInputChange(el) {
  document.getElementById("charCount").textContent = el.value.length;
}

function scrollToBottom() {
  const chat = document.getElementById("chat");
  chat.scrollTop = chat.scrollHeight;
}

function shakeElement(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.animation = "none";
  el.offsetHeight; // reflow
  el.style.animation = "shake .35s ease";
  setTimeout(() => (el.style.animation = ""), 400);
}

// Shake keyframe injected once
const shakeStyle = document.createElement("style");
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }`;
document.head.appendChild(shakeStyle);