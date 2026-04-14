from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf
from text_to_speech import tts
file_path = 'present/harthik_resume.pdf'
extracted_text = extract_text_pymupdf(file_path)
print(extracted_text)

def interview_loop():
    history = []
    while True:
        response = llmcalling(extracted_text)
        print("AI: ", response)
        tts(response)
        user_input = input("You: ")
        print("input captured")

        if user_input.lower() in ["exit", "quit"]:
            break
        history.append({"role": "user", "content": user_input})
        history.append({"role": "assistant", "content": response})
interview_loop()