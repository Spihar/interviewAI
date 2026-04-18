from google import genai
import os
from dotenv import load_dotenv
load_dotenv()
def llmcalling(context,user,history):
    
    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    response = client.models.generate_content(
        model="gemini-2.5-flash", contents=
        f"""
        You are a professional AI interviewer.

        Your job:
        - Ask one interview question at a time.
        - give feedback on users previous response.
        - give a score out of 10.

        Candidate Resume:
        {context}

        Conversation so far:
        {history}

        Latest user answer:
        {user}

        Instructions:
        - If no history, ask an introduction question and set feedback="" and score=0
        - Otherwise:
            - Give feedback on the user's answer
            - Give a score from 1 to 10
            - Ask the next relevant question
        - Do NOT repeat questions


        respond strictly in JSON format:
        {{
            "question:"next question here",
            "feedback":"feedback here",
            "score":number
        }}

        do not add anything else.
        """
)
    return response.text
