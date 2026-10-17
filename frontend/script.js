// Interview room. API_BASE, the Supabase client (sb), accessToken, escHtml, initials and logout come from common.js,
// which index.html loads first, so the backend address and Supabase keys live in one place.
//
// Flow: consent (step 1) -> resume (step 2) -> voice-first interview -> report.
// In voice mode the interviewer reads each question aloud, then the mic opens on its own. The answer is sent after
// SILENCE_MS of silence (once the person has started talking), or when they press Done. Pause stops the silence timer.
// "Type instead" switches to a text box. Per-answer scores and feedback are saved by the server but not shown
// until the report, so they can't influence later answers.

const SILENCE_MS = 2500;      // silence after speech that sends the answer
const MIN_SPEECH_MS = 300;    // voiced time needed before silence can send (so a cough or click doesn't)
const INTERIM_MS = 5000;      // how often the live transcript is refreshed while answering
const REVIEW_MS = 2000;       // time to press Edit before a transcribed answer is sent
const MIN_QUESTIONS = 5, MAX_QUESTIONS = 12;   // MIN_QUESTIONS / MAX_QUESTIONS in services/rubric.py
const SKILL_COUNT = 4;

let session_id = "";
let currentUser = null;
let questionCount = 0;        // answers the server counted towards the report
let settledCount = 0;         // skills the server considers settled
let pendingSttMs = null;      // how long the last transcription took, sent with the answer
let pendingTranscript = null; // the transcription itself, to tell "voice" from "voice_edited" answers
let phase = "idle";           // thinking | speaking | listening | paused | transcribing | review | typing | error | done
let interviewOpened = false;

let voiceOn = readPref("voiceOn", "true") !== "false";          // read questions aloud
let mode = readPref("answerMode", "voice") === "type" ? "type" : "voice";

// Mic and recording state
let micStream = null, audioCtx = null, analyser = null, levelBuf = null;
let recorder = null, chunks = [];
let answerGen = 0;            // bumps for each answer, so late interim transcripts are ignored
let heardMs = 0, lastVoiceAt = 0, listenStartedAt = 0, lastFrameAt = 0, noiseFloor = null;
let rafId = 0, interimTimer = 0, interimBusy = false, reviewTimer = 0;

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage blocked: keep the choice for this page only */ }
}
const $ = (id) => document.getElementById(id);

// ── Session init ──────────────────────────────────────────────────────────────
// Not signed in: go to auth.html straight away.
window.onload = async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = "auth.html"; return; }
  currentUser = session.user;
  accessToken = session.access_token;   // JWT attached to every API call
  const name = currentUser.user_metadata?.full_name || currentUser.email.split("@")[0];
  $("userNameLabel").textContent = name;
  $("userNameNav").textContent = name;
  $("userInitials").textContent = initials(name);
  sb.auth.onAuthStateChange((_event, newSession) => {
    if (newSession) accessToken = newSession.access_token;
    else window.location.href = "auth.html";
  });

  // A practice interview from the dashboard passes its topic as ?focus=
  const focus = new URLSearchParams(window.location.search).get("focus");
  if (focus) { $("focusChip").textContent = "Practice focus: " + focus; $("focusChip").hidden = false; }

  renderVoiceBtn();
  const ta = $("history");
  ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); sendTyped(); }
  });
};

function authHeaders(extra = {}) {
  return { "Authorization": `Bearer ${accessToken}`, ...extra };
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok || data.error) throw new Error(data.error || data.detail || `Server error ${res.status}`);
  return data;
}

// ── Step 1: consent ───────────────────────────────────────────────────────────
// The server rejects /start_interview without consent: true, and stores when it was given.
async function acceptConsent() {
  if (!$("consentBox").checked) { shakeElement("stepConsent"); return; }
  const btn = $("consentBtn");
  btn.disabled = true;
  $("consentMsg").textContent = "Starting…";
  try {
    const focus = new URLSearchParams(window.location.search).get("focus");
    const data = await postJson("/start_interview", { focus_topic: focus || null, consent: true });
    session_id = data.session_id;
    $("sessionIdLabel").textContent = "Session " + session_id.slice(0, 8);
    $("sessionBadge").classList.add("active");
    $("stepConsent").hidden = true;
    $("stepResume").hidden = false;
  } catch (err) {
    btn.disabled = false;
    $("consentMsg").textContent = "Couldn't connect to the server. Is the backend running? " + err.message;
  }
}

// ── Step 2: resume ────────────────────────────────────────────────────────────
function handleFileSelect() {
  const file = $("resumeFile").files[0];
  if (!file) return;
  $("resumeZoneText").innerHTML = `<strong>${escHtml(file.name)}</strong><br/><small>Ready to upload</small>`;
  $("resumeMsg").textContent = "";
}

async function uploadResume() {
  const file = $("resumeFile").files[0];
  if (!file) { shakeElement("resumeZone"); $("resumeMsg").textContent = "Choose a PDF first, or start without a resume."; return; }
  const btn = $("uploadBtn");
  btn.disabled = true; $("skipResumeBtn").disabled = true;
  btn.textContent = "Uploading…";
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`${API_BASE}/upload_resume?session_id=${encodeURIComponent(session_id)}`, {
      method: "POST", headers: authHeaders(), body: formData,
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.detail || data.error || "Upload failed");
    $("resumeZone").classList.add("uploaded");
    $("resumeZoneText").innerHTML = `<strong>${escHtml(file.name)}</strong><br/><small>Resume uploaded</small>`;
    await openInterview();
  } catch (err) {
    btn.textContent = "Upload and start";
    btn.disabled = false; $("skipResumeBtn").disabled = false;
    $("resumeMsg").textContent = "Resume upload failed: " + err.message;
  }
}

// ── Opening question ─────────────────────────────────────────────────────────
// The opening /interview call has no answer yet (user is ""), so the server saves no chat_history row
// and returns the AI's intro question. A repeated opening call gets the same stored question back.
async function openInterview() {
  if (interviewOpened) return;
  interviewOpened = true;
  $("uploadBtn").disabled = true; $("skipResumeBtn").disabled = true;
  // Ask for the mic now, while the click still counts as the user's action, so the prompt appears before the first question.
  if (mode === "voice" && !(await ensureMic())) mode = "type";
  $("stepResume").hidden = true;
  $("stepRoom").hidden = false;
  $("endBtn").hidden = false;
  applyMode();
  updateProgress();
  setPhase("thinking", "Getting your first question…");
  try {
    const data = await postJson("/interview", { session_id, user: "" });
    if (data.settled) settledCount = Object.values(data.settled).filter(Boolean).length;
    askQuestion(data.question);
  } catch (err) {
    interviewOpened = false;
    setPhase("error", "Couldn't get the first question: " + err.message, openInterview);
  }
}

// ── Asking a question ─────────────────────────────────────────────────────────
function askQuestion(text) {
  $("caption").textContent = text;
  $("liveTranscript").textContent = "";
  $("liveTranscript").classList.remove("final");
  addLog("ai", text);
  if (!voiceOn || !("speechSynthesis" in window)) { afterQuestion(); return; }
  setPhase("speaking", "Interviewer is speaking…");
  speak(text, afterQuestion);
}

function afterQuestion() {
  if (phase === "done") return;
  if (mode === "voice") startListening();
  else setPhase("typing", "Type your answer below");
}

// ── Read-aloud (browser text-to-speech) ───────────────────────────────────────
// Uses the browser's built-in speechSynthesis, so it costs nothing and needs no server.
// Text is spoken sentence by sentence because Chrome can stop long utterances part way, and a timer covers
// browsers that never fire onend, so the mic always opens.
let speechToken = 0;
function speak(text, onDone) {
  stopSpeaking();
  const token = ++speechToken;
  let finished = false;
  const done = () => {
    if (finished || token !== speechToken) return;
    finished = true; clearTimeout(safety); onDone && onDone();
  };
  const words = text.split(/\s+/).length;
  const safety = setTimeout(done, (words / 2.2) * 1000 + 4000);
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang.startsWith("en") && /natural|google|online/i.test(v.name))
    || voices.find((v) => v.lang.startsWith("en")) || null;
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part.trim());
    u.voice = voice; u.rate = 1;
    if (i === parts.length - 1) { u.onend = done; }
    u.onerror = done;
    window.speechSynthesis.speak(u);
  });
}

function stopSpeaking() {
  speechToken++;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function toggleVoice() {
  voiceOn = !voiceOn;
  savePref("voiceOn", voiceOn);
  if (!voiceOn && phase === "speaking") { stopSpeaking(); afterQuestion(); }
  renderVoiceBtn();
}

function renderVoiceBtn() {
  const btn = $("voiceBtn");
  btn.classList.toggle("off", !voiceOn);
  btn.setAttribute("aria-pressed", String(voiceOn));
  btn.title = voiceOn ? "The interviewer reads questions aloud (click to mute)" : "Questions are not read aloud (click to turn on)";
  $("voiceLabel").textContent = voiceOn ? "Voice on" : "Voice off";
}

// Chrome loads its voice list asynchronously; assigning a handler starts loading it now.
if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = () => {};

// ── Microphone ────────────────────────────────────────────────────────────────
// One mic stream for the whole interview, so the browser asks only once.
async function ensureMic() {
  if (micStream && micStream.getAudioTracks().some((t) => t.readyState === "live")) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    levelBuf = new Float32Array(analyser.fftSize);
    audioCtx.createMediaStreamSource(micStream).connect(analyser);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function releaseMic() {
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
}

async function startListening() {
  if (!(await ensureMic())) {
    setMode("type", "Your microphone is blocked, so type your answer. Allow the mic in your browser to answer by voice.");
    return;
  }
  if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
  answerGen++;
  chunks = [];
  recorder = new MediaRecorder(micStream);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start(1000);   // a chunk every second, so the live transcript can use what's recorded so far
  heardMs = 0; lastVoiceAt = 0; noiseFloor = null;
  listenStartedAt = lastFrameAt = performance.now();
  $("liveTranscript").textContent = "";
  $("liveTranscript").classList.remove("final");
  setPhase("listening", "Listening… answer out loud");
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(levelLoop);
  clearInterval(interimTimer);
  interimTimer = setInterval(refreshLiveTranscript, INTERIM_MS);
}

// Reads the mic level each frame: drives the orb, and sends the answer after SILENCE_MS of silence.
function levelLoop(now) {
  if (phase !== "listening" && phase !== "paused") { setLevel(0); return; }
  const dt = now - lastFrameAt; lastFrameAt = now;
  analyser.getFloatTimeDomainData(levelBuf);
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
  const rms = Math.sqrt(sum / levelBuf.length);
  setLevel(phase === "paused" ? 0 : Math.min(1, rms / 0.12));

  // Background level: drops straight to any quieter moment and creeps up slowly, so speech doesn't raise it.
  noiseFloor = noiseFloor === null || rms < noiseFloor ? rms : noiseFloor + (rms - noiseFloor) * 0.002;
  if (phase === "listening" && now - listenStartedAt > 300) {
    const threshold = Math.min(0.06, Math.max(0.012, noiseFloor * 2.5));
    if (rms > threshold) { heardMs += dt; lastVoiceAt = now; }
    if (heardMs >= MIN_SPEECH_MS) {
      const quiet = now - lastVoiceAt;
      if (quiet >= SILENCE_MS) { finishAnswer(); return; }
      $("stageState").textContent = quiet > 900 ? "Sending when you stay quiet… keep talking to continue" : "Listening…";
    }
  }
  rafId = requestAnimationFrame(levelLoop);
}

function setLevel(v) {
  $("orbWrap").style.setProperty("--level", v.toFixed(3));
}

function togglePause() {
  if (phase === "listening") {
    if (recorder && recorder.state === "recording") recorder.pause();
    setPhase("paused", "Paused. Take your time, then press Resume or Done.");
  } else if (phase === "paused") {
    if (recorder && recorder.state === "paused") recorder.resume();
    lastVoiceAt = performance.now();   // the silence timer starts again from now
    setPhase("listening", "Listening… answer out loud");
    rafId = requestAnimationFrame(levelLoop);
  }
}

function stopRecorder() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === "inactive") { resolve(null); return; }
    const type = recorder.mimeType || "audio/webm";
    recorder.onstop = () => resolve(new Blob(chunks, { type }));
    recorder.stop();
  });
}

function stopListening() {
  clearInterval(interimTimer);
  cancelAnimationFrame(rafId);
  answerGen++;
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  setLevel(0);
}

async function transcribe(blob) {
  // Safari records mp4 and Firefox ogg, so keep the recorder's real type and a matching extension.
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
  const formData = new FormData();
  formData.append("file", blob, `recording.${ext}`);
  const res = await fetch(`${API_BASE}/speech_to_text?session_id=${encodeURIComponent(session_id)}`, {
    method: "POST", headers: authHeaders(), body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Transcription failed");
  return data;
}

// Shows what has been heard so far, faintly, so a misheard word can be caught. Failures are ignored.
async function refreshLiveTranscript() {
  if (interimBusy || phase !== "listening" || heardMs < MIN_SPEECH_MS || !chunks.length) return;
  interimBusy = true;
  const gen = answerGen;
  try {
    const data = await transcribe(new Blob(chunks, { type: recorder ? recorder.mimeType || "audio/webm" : "audio/webm" }));
    if (gen === answerGen && (phase === "listening" || phase === "paused")) $("liveTranscript").textContent = data.text;
  } catch (e) { /* the final transcript is what counts */ }
  interimBusy = false;
}

// Done, or SILENCE_MS of silence: transcribe the whole answer, show it briefly, then send.
async function finishAnswer() {
  if (phase !== "listening" && phase !== "paused") return;
  clearInterval(interimTimer);
  cancelAnimationFrame(rafId);
  setLevel(0);
  setPhase("transcribing", "Transcribing your answer…");
  const gen = ++answerGen;
  const blob = await stopRecorder();
  recorder = null;
  try {
    const data = blob && blob.size ? await transcribe(blob) : { text: "" };
    if (gen !== answerGen || phase !== "transcribing") return;   // ended or switched to typing meanwhile
    const text = (data.text || "").trim();
    if (!text) { setPhase("error", "I didn't catch anything. Try again, a little closer to the mic.", startListening); return; }
    pendingTranscript = data.text;
    pendingSttMs = Number.isFinite(data.stt_ms) ? data.stt_ms : null;
    $("liveTranscript").textContent = text;
    $("liveTranscript").classList.add("final");
    setPhase("review", "Sending your answer… press Edit if a word is wrong");
    reviewTimer = setTimeout(sendReviewed, REVIEW_MS);
  } catch (err) {
    if (gen !== answerGen) return;
    setPhase("error", "Couldn't transcribe that: " + err.message, startListening);
  }
}

function sendReviewed() {
  clearTimeout(reviewTimer);
  if (phase !== "review") return;
  submitAnswer(pendingTranscript.trim(), "voice");
}

function editTranscript() {
  clearTimeout(reviewTimer);
  const text = pendingTranscript;   // kept, so sending it unchanged still counts as "voice"
  setMode("type", "Fix any words, then send");
  $("history").value = text;
  onInputChange($("history"));
}

// ── Typing ────────────────────────────────────────────────────────────────────
function sendTyped() {
  const ta = $("history");
  const text = ta.value.trim();
  if (!text) { shakeElement("history"); return; }
  if (phase === "thinking" || phase === "done") return;
  // Saved with the turn for the research data: was this answer spoken, and was the transcript edited?
  const inputMode = pendingTranscript === null ? "typed" : text === pendingTranscript.trim() ? "voice" : "voice_edited";
  submitAnswer(text, inputMode);
}

function setMode(next, message) {
  clearTimeout(reviewTimer);
  mode = next;
  savePref("answerMode", next);
  applyMode();
  if (next === "type") {
    if (phase === "listening" || phase === "paused" || phase === "transcribing" || phase === "review" || phase === "error") {
      stopListening();
      setPhase("typing", message || "Type your answer below");
    }
    $("history").focus();
  } else {
    $("history").value = "";
    onInputChange($("history"));
    pendingTranscript = null; pendingSttMs = null;
    if (phase === "typing" || phase === "error") startListening();
  }
}

function applyMode() {
  $("composer").hidden = mode !== "type";
}

// ── Sending an answer ─────────────────────────────────────────────────────────
async function submitAnswer(text, inputMode) {
  stopSpeaking();
  addLog("user", text);
  $("history").value = "";
  onInputChange($("history"));
  $("liveTranscript").textContent = "";
  setPhase("thinking", "Thinking about your answer…");
  try {
    const data = await postJson("/interview", {
      session_id, user: text, stt_ms: inputMode === "typed" ? null : pendingSttMs, input_mode: inputMode,
    });
    if (phase === "done") return;
    pendingSttMs = null; pendingTranscript = null;
    if (data.counted) questionCount++;
    if (data.settled) settledCount = Object.values(data.settled).filter(Boolean).length;
    if (data.decision === "stop") { await endInterview(true); return; }
    updateProgress();
    askQuestion(data.question);
  } catch (err) {
    if (phase === "done") return;
    // The answer wasn't saved: put it back for resending, keeping its voice details.
    removeLastLog();
    setMode("type", "Your answer wasn't sent (" + err.message + "). Press send to try again.");
    $("history").value = text;
    onInputChange($("history"));
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────
// A soft bar: the question count, nudged forward as skills settle (the interview can end anywhere from 5 to 12).
function updateProgress() {
  const n = Math.min(questionCount + 1, MAX_QUESTIONS);
  $("progressText").textContent = `Question ${n}`;
  const byCount = questionCount / MAX_QUESTIONS;
  const bySkills = (settledCount / SKILL_COUNT) * Math.min(1, questionCount / MIN_QUESTIONS);
  $("progressFill").style.width = Math.round(Math.min(1, Math.max(byCount, bySkills)) * 100) + "%";
}

// ── Stage state ───────────────────────────────────────────────────────────────
function setPhase(next, text, retry) {
  phase = next;
  $("orbWrap").dataset.state = next;
  $("stageState").textContent = text || "";
  $("stageNote").textContent = "";
  $("voiceActions").hidden = !(next === "listening" || next === "paused");
  $("reviewActions").hidden = next !== "review";
  $("retryActions").hidden = next !== "error";
  if (retry) $("retryBtn").onclick = () => retry();
  $("retryActions").querySelectorAll(".btn").forEach((b) => { b.hidden = false; });
  $("pauseLabel").textContent = next === "paused" ? "Resume" : "Pause";
  $("sendBtn").disabled = next === "thinking" || next === "done";
}

// ── Chat log (hidden unless "Show chat") ──────────────────────────────────────
function toggleChat() {
  const log = $("chat");
  log.hidden = !log.hidden;
  $("stepRoom").classList.toggle("with-chat", !log.hidden);
  $("chatToggle").setAttribute("aria-pressed", String(!log.hidden));
  $("chatToggle").querySelector("span").textContent = log.hidden ? "Show chat" : "Hide chat";
  if (!log.hidden) log.scrollTop = log.scrollHeight;
}

function addLog(who, text) {
  const row = document.createElement("div");
  row.className = "msg-row" + (who === "user" ? " user" : "");
  row.innerHTML = who === "user"
    ? `<div class="bubble user">${escHtml(text)}</div><div class="avatar user">You</div>`
    : `<div class="avatar ai">AI</div><div class="bubble ai">${escHtml(text)}</div>`;
  $("chat").appendChild(row);
  $("chat").scrollTop = $("chat").scrollHeight;
}

function removeLastLog() {
  const last = $("chat").lastElementChild;
  if (last && last.classList.contains("user")) last.remove();
}

// ── End interview ─────────────────────────────────────────────────────────────
async function endInterview(auto = false) {
  if (phase === "done") return;
  if (!auto) {
    if (questionCount === 0) { $("stageNote").textContent = "Answer at least one question before ending."; shakeElement("endBtn"); return; }
    if (!confirm("End the interview now and see your report?")) return;
  }
  clearTimeout(reviewTimer);
  stopSpeaking();
  stopListening();
  $("endBtn").hidden = true;
  setPhase("thinking", "Writing your report…");
  $("caption").textContent = "";
  try {
    // On success the server returns total_questions, average_score, llm_score, feedback, improvements,
    // skill_scores, weak_topics, suggested_topics and interview_id (see report_response in server.py).
    const data = await postJson("/end_interview", { session_id, user: "" });
    releaseMic();
    phase = "done";
    showReport(data);
  } catch (err) {
    setPhase("error", "Couldn't create the report: " + err.message, () => endInterview(true));
    $("retryActions").querySelector(".btn:not(.primary)").hidden = true;   // no "Type instead" here
  }
}

function showReport(data) {
  const avg = parseFloat(data.average_score) || 0;
  const llm = parseFloat(data.llm_score) || 0;
  $("stepRoom").hidden = true;
  const el = $("stepDone");
  el.hidden = false;
  el.innerHTML = `
    <div class="panel report-card">
      <div class="eyebrow">Interview complete</div>
      <h2 class="step-title">Here's how it went</h2>
      <div class="result-scores">
        <div class="stat-card"><div class="stat-card-label">Questions</div><div class="stat-card-val num">${escHtml(String(data.total_questions))}</div></div>
        <div class="stat-card"><div class="stat-card-label">Average score</div><div class="stat-card-val num">${avg.toFixed(1)}<span>/10</span></div></div>
        <div class="stat-card"><div class="stat-card-label">Interviewer's score</div><div class="stat-card-val num">${fmtScore(llm)}<span>/10</span></div></div>
      </div>
      <div class="result-block"><div class="eyebrow">Feedback</div><p>${escHtml(data.feedback || "")}</p></div>
      <div class="result-block"><div class="eyebrow">Areas to improve</div><p>${escHtml(data.improvements || "")}</p></div>
      <div class="report-actions">
        ${data.interview_id ? `<a class="btn primary" href="report.html?id=${encodeURIComponent(data.interview_id)}">Open full report</a>` : ""}
        <a class="btn" href="dashboard.html">Back to dashboard</a>
      </div>
    </div>`;
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function onInputChange(el) {
  $("charCount").textContent = el.value.length;
}

function shakeElement(id) {
  const el = $(id);
  if (!el) return;
  el.style.animation = "none";
  el.offsetHeight; // reflow
  el.style.animation = "shake .35s ease";
  setTimeout(() => (el.style.animation = ""), 400);
}

const shakeStyle = document.createElement("style");
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }`;
document.head.appendChild(shakeStyle);
