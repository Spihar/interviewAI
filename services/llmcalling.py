from google import genai
def llmcalling(context,history):
    
    # The client gets the API key from the environment variable `GEMINI_API_KEY`.
    client = genai.Client(api_key="AIzaSyCvxo-bdTwpJPuY67x_rRU_BX42KNQ47xU")

    response = client.models.generate_content(
        model="gemini-3-flash-preview", contents=
        f"""
        You are an AI interviewer.
        Candidate Resume:
        {context}
        Conversation History:
        {history}
        Ask next question or respond accordingly.
        """
)
    return response.text
