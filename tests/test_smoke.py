# Smoke test: checks that the server starts and answers, without touching Supabase, Gemini or Groq.
# Run from the project folder:  pip install pytest  then  python -m pytest
# GitHub runs this on every push (see .github/workflows/ci.yml).
import os

# Placeholder keys, set before server.py is imported. load_dotenv() never overrides a variable that is
# already set, so even on a laptop with a real .env these placeholders win and no real service is called.
# Creating the clients makes no network call; only real requests would, and these tests make none.
for name, value in {
    "SUPABASE_URL": "https://ci-placeholder.supabase.co",
    "SUPABASE_KEY": "sb_secret_ci_placeholder",
    "GEMINI_API_KEY": "ci-placeholder",
    "GROQ_API_KEY": "ci-placeholder",
    "PARTICIPANT_SALT": "ci-placeholder",
}.items():
    os.environ[name] = value

from fastapi.testclient import TestClient  # noqa: E402  (must come after the keys above)

import server  # noqa: E402

client = TestClient(server.app)


def test_health_answers_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_home_page_opens_sign_in():
    # "/" sends visitors to auth.html, which the server serves from frontend/.
    response = client.get("/")
    assert response.status_code == 200
    assert response.url.path == "/auth.html"
    assert "text/html" in response.headers["content-type"]


def test_api_needs_sign_in():
    # Without a token the server must refuse before reaching Supabase.
    response = client.get("/dashboard")
    assert response.status_code == 401
