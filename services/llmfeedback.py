from google import genai
import os
from dotenv import load_dotenv
load_dotenv()
def llmfeedback(history):
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    response = client.models.generate_content(
        model="gemini-2.5-flash", contents=
        f"""
        You are a professional AI interviewer.
        You have interviewed the user with the following conversation:
        {history}
        Instructions:
        - give the feedback for the overall session
        - be as honest as possible

        respond strictly in JSON format:
        {{
            "feedback":"feedback here",
            "score":number,
            "improvements":"areas of improvement here"
        }}
        """
    )
    return response.text