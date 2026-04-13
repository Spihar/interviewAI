import fastapi
from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf
from pydantic import BaseModel # For defining data models for request and response bodies in FastAPI.
import os


app = fastapi.FastAPI()

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.post("/upload_resume")
async def upload_resume(file: fastapi.UploadFile = fastapi.File(...)):
    file_location = f"temp/{file.filename}"
    with open(file_location, "wb") as f:
        f.write(await file.read())
    text = extract_text_pymupdf(file_location)
    os.remove(file_location)  # Clean up the temporary file
    return {"extracted_text": text}

class InterviewRequest(BaseModel):
    context: str
    history: str

@app.post("/interview")
def interview(request: InterviewRequest):
    context=request.context
    history=request.history
    res=llmcalling(context)
    return {"response": res}
