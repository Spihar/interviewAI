from google import genai
import os
from dotenv import load_dotenv
load_dotenv()
# history: the answered turns of the interview (question, answer, score, feedback, assessed skill, justification)
# skills: the rubric skill names, so weak and suggested topics can be tagged with one of them
def llmfeedback(history, skills):
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
        - weak_topics: up to 3 specific topics the candidate struggled with (low scores, missing details),
          each with the skill it belongs to and one sentence on what was missing
        - suggested_topics: up to 3 topics to practice next, each with the skill, a short title
          and one sentence on what to practice
        - skill must be one of: {", ".join(skills)}

        respond strictly in JSON format:
        {{
            "feedback":"feedback here",
            "score":number,
            "improvements":"areas of improvement here",
            "weak_topics":[{{"topic":"short topic name","skill":"skill name","why":"one sentence"}}],
            "suggested_topics":[{{"title":"short title","skill":"skill name","why":"one sentence"}}]
        }}
        """
    )
    return response.text
