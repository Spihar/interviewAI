Setup and Installation
**1. Clone the Repository**
git clone https://github.com/Spihar/interviewAI
cd InterviewAI

**2. create vertual env**
 python -m venv venv

**3. activate venv**
**Command Prompt**
venv\Scripts\activate
**PowerShell**
venv\Scripts\Activate.ps1
After activation, you should see something similar to:
(venv) C:\...\InterviewAI>
**Linux / macOS**
python3 -m venv venv
source venv/bin/activate

**4.Install Backend Dependencies**

Make sure the virtual environment is activated.

pip install -r requirements.txt

**5. Create a .env file inside the backend directory.**

Example:

GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
PARTICIPANT_SALT=a_long_random_string

Replace the values with your actual API credentials.

SUPABASE_KEY must be the **secret** key (sb_secret_…, from Supabase Project settings → API keys), not the publishable key.
The backend writes to tables protected by row-level security, which only the secret key can bypass.
Use the secret key on any deploy host too, and never put it in the frontend.

PARTICIPANT_SALT turns each user id into an anonymised participant code (services/participant.py).
Generate it once, for example with python -c "import secrets; print(secrets.token_hex(16))", keep it secret,
and never change it once data collection has started, or the same person gets a new code.

⚠️ Never commit your .env file or API keys to GitHub.

Add .env to .gitignore:

.env
venv/
__pycache__/

**Database migrations**

Run the files in migrations/ in the Supabase SQL editor, in number order, before starting the new server code.
005_consent_timing.sql must be run before 006_rls.sql.

Before running 006_rls.sql, check the type of interviews.user_id:

select data_type from information_schema.columns where table_name='interviews' and column_name='user_id';

If it is text, change (select auth.uid()) to (select auth.uid())::text in the three policies in 006_rls.sql.

After running 006_rls.sql, list any public tables still without row-level security:

select tablename from pg_tables where schemaname='public' and not rowsecurity;

**Study setup (keep fixed during data collection)**

Rubric v1 (services/rubric.py), model gemini-2.5-flash, and the interview prompt in services/llmcalling.py.
Prompt change on 2026-10-19, before the pilot: the AI never uses the candidate's name or personal details, and the
opening question asks candidates to introduce their background without giving their name. Interviews from before this
date used the earlier prompt.

**Exporting answers for human raters**

python scripts/export_for_raters.py

This writes three files to exports/ (git-ignored, never commit them):
- raters_blind.csv: one row per scored answer (item_id, assessed_skill, question, answer)
  with empty rater_score and rater_band columns. No LLM scores, participant codes or turn numbers; emails, phone numbers,
  links, ID numbers (register/roll numbers, codes like 21CS1234) and each participant's own name
  (from their sign-in profile and the first line of their resume) in the text are redacted,
  and the rows are shuffled with a fixed seed (--seed, default 2026).
- key_llm_scores.csv: the participant_code, turn and the LLM's score, band, justification, model and timing for each item_id, to join back after rating.
- rubric.txt: the rubric to give the raters.

Only interviews with consent and answers the LLM scored are exported. Leave out your own test interviews with
--exclude P-XXXXXXXX (repeatable). Give raters only raters_blind.csv and rubric.txt.
Questions are generated from resumes, so skim raters_blind.csv for names or company details before sharing it.
Check the redaction patterns with: python scripts/export_for_raters.py --selftest

**5. Start the FastAPI server using Uvicorn:**

uvicorn server:app --reload

**To run Frontend**
open new terminal
change the directory to frontend

cd frontend
python -m http.server 5500

**Run with Docker (one container serves the API and the pages)**

Install Docker Desktop, then from this folder:

docker build -t interviewai .
docker run --rm -p 8000:8000 -v "${PWD}/.env:/app/.env:ro" interviewai

(That is PowerShell; in Command Prompt use %cd% instead of ${PWD}.)
In Git Bash, which rewrites paths that start with /, use:
MSYS_NO_PATHCONV=1 docker run --rm -p 8000:8000 -v "$(pwd -W)/.env:/app/.env:ro" interviewai
If port 8000 is already in use (for example by uvicorn), stop that first or use -p 8001:8000 and open localhost:8001.
Open http://localhost:8000. The server also serves frontend/, so you don't need the port 5500 server.
.env is mounted read-only when the container starts and is never copied into the image (see .dockerignore).
Don't use --env-file .env: it keeps quotes around values, so KEY="abc" reaches the app as "abc" with the quotes,
which breaks the API keys and changes the participant codes made from PARTICIPANT_SALT.
In Docker, voice needs GROQ_API_KEY: faster-whisper isn't installed in the image.
For Google sign-in, add http://localhost:8000/dashboard.html to the Redirect URLs in Supabase (Authentication → URL Configuration).
Running uvicorn on its own also serves the pages at http://127.0.0.1:8000.
The separate frontend server must use port 5500: on any other port, the pages send API calls to the wrong server (see API_BASE in frontend/common.js).

**Run on a server with HTTPS (AWS Lightsail or any Linux server with Docker)**

docker-compose.yml starts the app and Caddy, which serves it on https with a free certificate it renews by itself.
Ports 80 and 443 must be open in the server's firewall. Copy .env to the server next to docker-compose.yml
(for example scp -i key.pem .env ubuntu@<ip>:~/interviewai/) and let only the container's user (uid 10001) read it:

sudo chown 10001:10001 .env && sudo chmod 400 .env     (edit it later with sudo nano .env)

With chmod 600 owned by your own user, the app can't read it and keeps restarting behind a 502 error.
Then create deploy.env with the server's address (git-ignored). Without a domain, use the static IP with dashes and .sslip.io:

SITE_ADDRESS=13-232-10-5.sslip.io

docker compose --env-file deploy.env up -d --build     (start, or rebuild after pulling new code)
docker compose --env-file deploy.env logs -f caddy     (watch the certificate being fetched)

Every docker compose command needs --env-file deploy.env. Without it, compose tries to read .env itself
and stops with "open .env: permission denied", because .env belongs to uid 10001.

Then add https://<SITE_ADDRESS> as the Site URL and https://<SITE_ADDRESS>/dashboard.html as a Redirect URL in Supabase,
and https://<SITE_ADDRESS> as an authorized JavaScript origin in Google Cloud if it asks for one.
Keep the same PARTICIPANT_SALT as on your laptop, or the same person gets a new participant code.

**Voice**

Speech-to-text uses Groq Whisper. Add GROQ_API_KEY=your_groq_api_key to .env (get a free key at console.groq.com).
Without it, run pip install faster-whisper to transcribe locally instead.
The AI's questions are read aloud by the browser; turn this on or off with the Voice button.



