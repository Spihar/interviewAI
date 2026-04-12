from google import genai
def llmcalling(context):
    
    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key="AIzaSyDTmRUobUat16PLSWT4EkMme9v_eG0QcQM")

    response = client.models.generate_content(
        model="gemini-3-flash-preview", contents=
        f"""
        You are an AI interviewer.
        Candidate Resume:
        {context}
        
        Ask next question or respond accordingly.
        """
)
    return response.text
