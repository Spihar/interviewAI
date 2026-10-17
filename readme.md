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

**Exporting answers for human raters**

python scripts/export_for_raters.py

This writes three files to exports/ (git-ignored, never commit them):
- raters_blind.csv: one row per scored answer (item_id, assessed_skill, question, answer)
  with empty rater_score and rater_band columns. No LLM scores, participant codes or turn numbers; emails, phone numbers,
  links and ID numbers (register/roll numbers, 6+ digit runs, codes like 21CS1234) in the text are redacted,
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

**Voice**

Speech-to-text uses Groq Whisper. Add GROQ_API_KEY=your_groq_api_key to .env (get a free key at console.groq.com).
Without it, run pip install faster-whisper to transcribe locally instead.
The AI's questions are read aloud by the browser; turn this on or off with the Voice button.



