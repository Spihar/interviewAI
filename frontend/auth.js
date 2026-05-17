const SUPABASE_URL  = "https://hincwkkvpdhaoyciailp.supabase.co";
const SUPABASE_ANON = "sb_publishable_RyzMJZWK_hBE9qHpubmsIg_1LJNyHPp";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  let mode = "login";

  // CHECK IF ALREADY LOGGED IN
  // Every time this page loads, we ask the Supabase SDK:
  // "hey, is there a valid token already saved in localStorage?"
  // If yes — skip this page, go straight to the app.
  window.onload = async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) window.location.href = "index.html";
  };

  // This fires when Google OAuth redirects back to this page.
  // Supabase parses the token from the URL automatically.
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) window.location.href = "index.html";
  });

  function switchTab(tab) {
    mode = tab;
    document.getElementById("tabLogin").classList.toggle("active",  tab === "login");
    document.getElementById("tabSignup").classList.toggle("active", tab === "signup");
    document.getElementById("nameField").style.display = tab === "signup" ? "block" : "none";
    document.getElementById("btnLabel").textContent = tab === "login" ? "Sign In" : "Create Account";
    document.getElementById("passwordInput").autocomplete = tab === "login" ? "current-password" : "new-password";
    hideAlert();
  }

  async function handleSubmit() {
    const email    = document.getElementById("emailInput").value.trim();
    const password = document.getElementById("passwordInput").value;
    const name     = document.getElementById("nameInput").value.trim();

    if (!email || !password) { showAlert("Please fill in all fields.", "error"); return; }
    if (mode === "signup" && password.length < 6) {
      showAlert("Password must be at least 6 characters.", "error"); return;
    }

    setLoading(true);

    try {
      if (mode === "login") {
        // Supabase checks credentials against auth.users table.
        // On success it returns a session object containing:
        //   session.access_token  — the JWT we'll send to FastAPI
        //   session.user.id       — the user's UUID
        // The SDK saves this token to localStorage automatically.
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) { showAlert(error.message, "error"); setLoading(false); return; }
        // onAuthStateChange above fires → redirects to index.html

      } else {
        // Creates user in Supabase Auth.
        // full_name goes into user_metadata — our DB trigger (handle_new_user)
        // reads this and inserts a row into public.profiles automatically.
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { full_name: name } }
        });
        if (error) { showAlert(error.message, "error"); setLoading(false); return; }

        // If email confirmation is required (check Supabase Auth settings),
        // session will be null here — show a message to check email.
        if (!data.session) {
          showAlert("Account created! Check your email to confirm, then sign in.", "success");
          setLoading(false);
          return;
        }
        // If confirmation OFF → onAuthStateChange fires → redirect
      }
    } catch (err) {
      showAlert("Something went wrong. Try again.", "error");
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    // Opens Google's OAuth consent screen.
    // After user approves, Google redirects back here with a code.
    // Supabase exchanges that code for a JWT automatically.
    // NOTE: For Google OAuth to work, you need to enable it in:
    // Supabase Dashboard → Authentication → Providers → Google
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/index.html" }
    });
    if (error) showAlert(error.message, "error");
  }

  function setLoading(on) {
    const btn = document.getElementById("submitBtn");
    btn.classList.toggle("loading", on);
    btn.disabled = on;
  }
  function showAlert(msg, type) {
    const box = document.getElementById("alertBox");
    box.textContent = msg;
    box.className = `alert ${type} show`;
  }
  function hideAlert() { document.getElementById("alertBox").className = "alert"; }

  document.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSubmit(); });