import fastapi
from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf

app = fastapi.FastAPI()

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.post("/interview")
def start_interview(file_path: str):
    extracted_text = extract_text_pymupdf(file_path)
    return {"extracted_text": extracted_text}