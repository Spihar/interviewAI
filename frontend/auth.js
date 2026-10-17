const SUPABASE_URL  = "https://hincwkkvpdhaoyciailp.supabase.co";
const SUPABASE_ANON = "sb_publishable_RyzMJZWK_hBE9qHpubmsIg_1LJNyHPp";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let mode = "login";   // "login" or "signup"

// Text that changes between signing in and creating an account
const COPY = {
  login: {
    heading: "Welcome back",
    sub: "Sign in to see your progress and start a new interview.",
    submit: "Sign in",
    switchText: "New to InterviewAI?",
    switchBtn: "Create an account",
    password: "Your password",
  },
  signup: {
    heading: "Create your account",
    sub: "Track your interview scores and get topics to practice.",
    submit: "Create account",
    switchText: "Already have an account?",
    switchBtn: "Sign in",
    password: "At least 6 characters",
  },
};

// CHECK IF ALREADY LOGGED IN
// Every time this page loads, we ask the Supabase SDK whether a valid token is saved in localStorage.
// If yes, skip this page and go straight to the dashboard.
window.onload = async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { window.location.href = "dashboard.html"; return; }

  // Supabase sends OAuth errors back in the URL, e.g. when Google sign-in isn't enabled.
  const params = new URLSearchParams(window.location.search + "&" + window.location.hash.slice(1));
  const oauthError = params.get("error_description");
  if (oauthError) showAlert(friendlyError(oauthError), "error");

  document.getElementById("authForm").addEventListener("submit", (e) => {
    e.preventDefault();
    handleSubmit();
  });
  ["nameInput", "emailInput", "passwordInput"].forEach((id) =>
    document.getElementById(id).addEventListener("input", () => clearFieldError(id.replace("Input", ""))));
};

// This fires after a successful sign-in, including when Google OAuth redirects back.
sb.auth.onAuthStateChange((_event, session) => {
  if (session) window.location.href = "dashboard.html";
});

function switchMode() {
  mode = mode === "login" ? "signup" : "login";
  const c = COPY[mode];
  document.getElementById("heading").textContent = c.heading;
  document.getElementById("subheading").textContent = c.sub;
  document.getElementById("btnLabel").textContent = c.submit;
  document.getElementById("switchText").textContent = c.switchText;
  document.getElementById("switchBtn").textContent = c.switchBtn;
  document.getElementById("nameField").hidden = mode !== "signup";
  document.getElementById("passwordHint").hidden = mode !== "signup";
  const pw = document.getElementById("passwordInput");
  pw.placeholder = c.password;
  pw.autocomplete = mode === "login" ? "current-password" : "new-password";
  document.title = "InterviewAI · " + (mode === "login" ? "Sign in" : "Create account");
  ["name", "email", "password"].forEach(clearFieldError);
  hideAlert();
  document.getElementById(mode === "signup" ? "nameInput" : "emailInput").focus();
}

// validate shows an error under each field that needs fixing and returns whether the form is OK.
function validate(name, email, password) {
  let ok = true;
  if (mode === "signup" && !name) { setFieldError("name", "Enter your name."); ok = false; }
  if (!email) { setFieldError("email", "Enter your email."); ok = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError("email", "Enter a valid email address."); ok = false; }
  if (!password) { setFieldError("password", "Enter your password."); ok = false; }
  else if (mode === "signup" && password.length < 6) { setFieldError("password", "Use at least 6 characters."); ok = false; }
  return ok;
}

async function handleSubmit() {
  const email    = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value;
  const name     = document.getElementById("nameInput").value.trim();
  hideAlert();
  if (!validate(name, email, password)) return;

  setLoading("submitBtn", true);
  try {
    if (mode === "login") {
      // Supabase checks the credentials and saves the session (JWT) to localStorage.
      // onAuthStateChange above then redirects to dashboard.html.
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { showAlert(friendlyError(error.message), "error"); setLoading("submitBtn", false); return; }
    } else {
      // Creates the user in Supabase Auth. full_name is saved in user_metadata,
      // and the dashboard reads it from there to greet the user.
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
      });
      if (error) { showAlert(friendlyError(error.message), "error"); setLoading("submitBtn", false); return; }

      // With email confirmation on (Supabase Auth settings), there's no session yet.
      if (!data.session) {
        showAlert(`Account created. We sent a confirmation link to ${email}. Open it, then sign in here.`, "success");
        setLoading("submitBtn", false);
        switchMode();
        document.getElementById("emailInput").value = email;
        return;
      }
      // With confirmation off, onAuthStateChange fires and redirects.
    }
  } catch (err) {
    showAlert("Couldn't reach the sign-in service. Check your connection and try again.", "error");
    setLoading("submitBtn", false);
  }
}

async function signInWithGoogle() {
  // Opens Google's consent screen. Google redirects back to dashboard.html,
  // and Supabase exchanges the code for a session automatically.
  // Google must be enabled in Supabase Dashboard → Authentication → Providers → Google.
  hideAlert();
  setLoading("googleBtn", true);
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/dashboard.html" }
    });
    if (error) {
      showAlert(friendlyError(error.message), "error");
      setLoading("googleBtn", false);
    }
  } catch (err) {
    showAlert("Couldn't reach Google sign-in. Check your connection and try again.", "error");
    setLoading("googleBtn", false);
  }
}

// friendlyError turns Supabase's error messages into something a user can act on.
function friendlyError(msg) {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match. Check them and try again.";
  if (m.includes("email not confirmed")) return "Confirm your email first. Open the link we sent you, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Sign in instead.";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "Google sign-in isn't turned on yet. Use your email for now.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  return msg || "Something went wrong. Try again.";
}

function togglePassword() {
  const pw = document.getElementById("passwordInput");
  const btn = document.getElementById("showBtn");
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  btn.textContent = show ? "Hide" : "Show";
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
}

function setFieldError(field, msg) {
  const input = document.getElementById(field + "Input");
  document.getElementById(field + "Error").textContent = msg;
  input.closest(".field").classList.add("invalid");
  input.setAttribute("aria-invalid", "true");
}
function clearFieldError(field) {
  const input = document.getElementById(field + "Input");
  document.getElementById(field + "Error").textContent = "";
  input.closest(".field").classList.remove("invalid");
  input.removeAttribute("aria-invalid");
}

// While one button is working, both are disabled so the user can't start two sign-ins at once.
function setLoading(id, on) {
  document.getElementById(id).classList.toggle("loading", on);
  ["submitBtn", "googleBtn"].forEach((b) => (document.getElementById(b).disabled = on));
}
function showAlert(msg, type) {
  const box = document.getElementById("alertBox");
  box.textContent = msg;
  box.className = `alert ${type} show`;
  box.setAttribute("role", type === "error" ? "alert" : "status");   // errors are announced right away
}
function hideAlert() { document.getElementById("alertBox").className = "alert"; }
