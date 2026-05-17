from google import genai
import os
from dotenv import load_dotenv
load_dotenv()
def llmcalling(context,user,history,evaluation_state):
    
    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    response = client.models.generate_content(
        model="gemini-2.5-flash", contents=
        f"""
        You are a adaptive AI interviewer.

        your goals are to evaluate the candidate:
        1. technical depth
        2. communication
        3. problem solving
        4. project experience

        rules:
        - Ask one interview question at a time.
        - avoid repeating topics that are already covered.
        - Track which skills have enough evidence.
        - If enough evidence exists across all evaluation areas, stop the interview.
        - Stop when additional questions are unlikely to improve evaluation quality.
        - Prefer targeted follow-up questions for weak areas.

        Interview Evaluation State:
        {evaluation_state}

        Candidate Resume:
        {context}

        Conversation so far:
        {history}

        Latest user answer:
        {user}

        If this is first interaction:
        - start with the basic introduction and ask the candidate to briefly introduce themselves and their background.
        - set score to 0
        - decision = "continue"

        Do not stop the interview before at least 5 questions have been asked.


        respond strictly in JSON format:
        {{
            "decision":"continue" or "stop",
            "question":"next question here",
            "feedback":"feedback here",
            "score":number,
            "evaluation_update":{{
                "technical_depth":number,
                "communication":number,
                "problem_solving":number,
                "project_experience":number
            }},
            "reason":"why continue or stop"
        }}

        do not add anything else.
        """
)
    return response.text
