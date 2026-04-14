from google import genai
def llmcalling(context):
    
    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key="")

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite", contents=
        f"""
        You are an AI interviewer.
        Candidate Resume:
        {context}
        
        Ask next question or respond accordingly.
        """
)
    return response.text
