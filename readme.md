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

Replace the values with your actual API credentials.

SUPABASE_KEY must be the **secret** key (sb_secret_…, from Supabase Project settings → API keys), not the publishable key.
The backend writes to tables protected by row-level security, which only the secret key can bypass.
Use the secret key on any deploy host too, and never put it in the frontend.

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



