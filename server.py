import fastapi
from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf
from pydantic import BaseModel # For defining data models for request and response bodies in FastAPI.
import os
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import uuid

interview_sessions = {} 
# A dictionary to store interview sessions, 
# where each session is identified by a unique session ID.
# This allows us to manage multiple interview sessions concurrently, 
# keeping track of the context and history for each session separately.


app = fastapi.FastAPI()

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
async def upload_resume(session_id: str, file: fastapi.UploadFile = fastapi.File(...)):

    session = interview_sessions.get(session_id)
    # We check if the provided session_id exists in our interview_sessions dictionary.
    if not session:
        return {"error": "Invalid session ID"}
    # If the session ID is valid, we proceed to save the uploaded file temporarily, 
    # extract text from it using our PDF reading service, 
    # and then clean up the temporary file. Finally, we return the extracted text in the response.

    file_location = f"temp/{file.filename}"
    with open(file_location, "wb") as f:
        f.write(await file.read())
    text = extract_text_pymupdf(file_location)
    os.remove(file_location)  # Clean up the temporary file

    # We store the extracted text in the session's context for later use during the interview process.
    session["context"] = text
    print(f"Extracted text for session {session_id}: {text}")

    return {"extracted_text": text}

# The /start_interview endpoint is responsible for initiating a new interview session.
# When a client makes a POST request to this endpoint, we generate a unique session ID using the uuid library,
# create a new entry in the interview_sessions dictionary with an empty context and history,
@app.post("/start_interview")
def start_interview():
    session_id = str(uuid.uuid4()) 
    # Generate a unique session ID using uuid4, which creates a random UUID.
    interview_sessions[session_id] = {
        "context": "",
        "history": []
    }
    return {"session_id": session_id}

# We define a Pydantic model called InterviewRequest to represent 
# the expected structure of the request body for the /interview endpoint.
# This model includes two fields: session_id (a string representing the session ID) 
# and user (a string representing the user's input).
class InterviewRequest(BaseModel):
    session_id:str
    user:str


@app.post("/interview")
def interview(request: InterviewRequest):

    session = interview_sessions.get(request.session_id)
    if not session:
        return {"error": "Invalid session ID"}
    
    # We retrieve the context and history for the given session ID, 
    # and then call the llmcalling function to get a response based on the context, user input, and conversation history.
    # The response from the llmcalling function is then appended to the session's history, 
    # and finally returned in the response to the client.
    context=session["context"]
    user=request.user
    history=session["history"]
    res=llmcalling(context,user,history)
    history.append({"user": user, "ai": res})
    print(f"Session {request.session_id} history: {history}")
    return {"response": res}