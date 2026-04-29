const API_BASE = "http://127.0.0.1:8000";
let session_id = "";
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let questionCount = 0;
let totalScore = 0;

// ── Session init ──────────────────────────────────────────────────────────────
window.onload = () => {
  startSession();
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

async function startSession() {
  try {
    const res = await fetch(`${API_BASE}/start_interview`, { method: "POST" });
    const data = await res.json();
    session_id = data.session_id;
    document.getElementById("sessionIdLabel").textContent = "Session " + session_id.slice(0, 8);
    document.getElementById("sessionBadge").classList.add("active");
    setStatus("Session active — upload your resume or start answering");
  } catch (err) {
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
    `<strong>${file.name}</strong><br/><small style="font-size:11px;">Ready to upload</small>`;
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
      body: formData,
    });
    const data = await res.json();

    const zone = document.getElementById("resumeZone");
    zone.classList.add("uploaded");
    zone.style.cursor = "default";
    document.getElementById("resumeZoneText").innerHTML =
      `✅ <strong>${file.name}</strong><br/><small style="font-size:11px;">Resume uploaded</small>`;

    btn.textContent = "✓ Uploaded";
    btn.style.borderColor = "var(--success)";
    btn.style.color = "var(--success)";
    setStatus("Resume uploaded — start answering questions below");
    addAIMessage("Great! I've read your resume. Let's begin. Tell me a bit about yourself and your background.");
  } catch (err) {
    btn.textContent = "Upload Failed";
    btn.style.borderColor = "var(--danger)";
    btn.style.color = "var(--danger)";
    btn.disabled = false;
    console.error(err);
  }
}

// ── Ask AI ─────────────────────────────────────────────────────────────────────
async function askAI() {
  const ta = document.getElementById("history");
  const user = ta.value.trim();
  if (!user) { shakeElement("history"); return; }

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, user }),
    });
    const data = await res.json();
    removeTypingIndicator(typingId);

    if (data.error) {
      addAIMessage("Sorry, something went wrong: " + data.error);
      setStatus("Error occurred");
    } else {
      // Add AI question bubble
      addAIMessage(data.question);
      // Add feedback card
      addFeedbackCard(data.feedback, data.score);

      // Update stats
      questionCount++;
      totalScore += parseFloat(data.score) || 0;
      document.getElementById("statQ").textContent = questionCount;
      document.getElementById("statScore").innerHTML =
        (totalScore / questionCount).toFixed(1) + '<span>/10</span>';

      setStatus(`Question ${questionCount} answered — keep going!`);
    }
  } catch (err) {
    removeTypingIndicator(typingId);
    addAIMessage("Connection error. Please check the backend is running.");
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, user: "" }),
    });
    const data = await res.json();
    //data from server
    //"total_questions":len(history),
    //    "average_score":avg_score,
    //    "llm_score":parsed.get("score",0),
    //    "feedback":parsed.get("feedback","No feedback provided"),
    //    "improvements":parsed.get("improvements","No improvements provided"),
    //    "status":"interview completed"
    removeTypingIndicator(typingId);
    addReportCard(data);
    setStatus("Interview complete — check your report below");
  } catch (err) {
    removeTypingIndicator(typingId);
    addAIMessage("Couldn't generate report. Please try again.");
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
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");

      document.getElementById("history").value = "Transcribing…";

      const res = await fetch(`${API_BASE}/speech_to_text`, { method: "POST", body: formData });
      const data = await res.json();
      document.getElementById("history").value = data.text;
      document.getElementById("charCount").textContent = data.text.length;
      setStatus("Transcription done — review and send");
    } catch (err) {
      document.getElementById("history").value = "";
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

function addAIMessage(text) {
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
}

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
  `;
  chat.appendChild(card);
  scrollToBottom();
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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