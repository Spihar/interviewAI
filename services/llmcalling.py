from google import genai
def llmcalling(context,user,history):
    
    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key="AIzaSyDN0mLUk_pe4y9FH79OveFJeJNY1yQOhY8")

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite", contents=
        f"""
        You are a professional AI interviewer.

        Your job:
        - Ask one interview question at a time.
        - Base questions on the candidate's resume and previous answers.
        - Do NOT give explanations.
        - Do NOT answer for the user.
        - Always continue the interview.

        Candidate Resume:
        {context}

        Conversation so far:
        {history}

        Latest user answer:
        {user}

        Instructions:
        - If no history, start with a basic introduction question.
        - Otherwise, ask a follow-up or new relevant question.
        - Keep questions clear and professional.
        - Do not repeat previous questions.

        Ask the next interview question:
        and also give feedback based on the user response
        """
)
    return response.text
