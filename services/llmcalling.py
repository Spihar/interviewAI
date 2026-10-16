from google import genai
import os
from dotenv import load_dotenv
load_dotenv()
# rubric: the rubric text (bands + criteria) the answer is scored against
# assessed_skill: the skill the latest answer is scored on (None on the first interaction)
# target_skill: the skill the next question should assess
# The server keeps the per-skill evidence and decides when to stop, so the LLM only scores and asks.
def llmcalling(context,user,history,rubric,assessed_skill,target_skill):

    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    response = client.models.generate_content(
        model="gemini-2.5-flash", contents=
        f"""
        You are a adaptive AI interviewer.

        You evaluate the candidate on four skills:
        1. communication
        2. technical depth
        3. problem solving
        4. project experience

        Scoring rubric:
        {rubric}

        rules:
        - Score the latest answer strictly against the rubric, only for the skill: {assessed_skill}
        - Pick the band that matches the answer, then give a score inside that band.
        - The justification is one sentence that refers to the criteria of that skill.
        - Ask exactly one next question, and it must assess the skill: {target_skill}
        - Base the question on the candidate's resume and earlier answers where possible.
        - avoid repeating topics that are already covered.

        Candidate Resume:
        {context}

        Conversation so far:
        {history}

        Latest user answer:
        {user}

        If this is first interaction (conversation so far is empty):
        - start with the basic introduction and ask the candidate to briefly introduce themselves and their background.
        - set score to 0, band to "", justification to ""

        respond strictly in JSON format:
        {{
            "question":"next question here",
            "feedback":"feedback on the latest answer here",
            "score":number,
            "band":"0-2" or "3-4" or "5-6" or "7-8" or "9-10",
            "justification":"one sentence referencing the criteria"
        }}

        do not add anything else.
        """
)
    return response.text
