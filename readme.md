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

⚠️ Never commit your .env file or API keys to GitHub.

Add .env to .gitignore:

.env
venv/
__pycache__/

**5. Start the FastAPI server using Uvicorn:**

uvicorn server:app --reload

**To run Frontend**
open new terminal
change the directory to frontend

cd frontend
python -m http.server 5500



