import fastapi
from fastapi import Header, HTTPException, Depends
from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf
#from services.speech_to_text import speech_to_text
from services.llmfeedback import llmfeedback
from services.stt import sst
from pydantic import BaseModel # For defining data models for request and response bodies in FastAPI.
import os
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import uuid 
import json
import re
from typing import Optional

from datetime import datetime, timezone
from db import supabase

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

# ── JWT VERIFICATION ──────────────────────────────────────────────────────────
# Frontend sends: Authorization: Bearer <jwt>  in every request.
# This function:
#   1. Extracts the token from the header
#   2. Calls supabase.auth.get_user(token) — Supabase validates it server-side
#   3. Returns the real user object if valid
#   4. Raises 401 if token is missing, fake, or expired
#
# Any endpoint with `user=Depends(get_current_user)` is automatically protected.
async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
 
    token = authorization.split(" ")[1]
 
    try:
        response = supabase.auth.get_user(token)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return response.user
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Auth error: {str(e)}")
    

@app.get("/")
async def read_root():
    return {"Hello": "World"}

@app.post("/upload_resume")
async def upload_resume(session_id: str, file: fastapi.UploadFile = fastapi.File(...), user=Depends(get_current_user)):

    session = interview_sessions.get(session_id)
    # We first check if the provided session_id exists in our interview_sessions dictionary.
    # If it doesn't exist, we return an error response indicating that the session ID is invalid.
    if not session:                                 
        return {"error": "Invalid session ID"}
    # Next, we verify that the user making the request is the same user associated with the interview session.
    # If the user IDs do not match, we raise an HTTP 403 Forbidden error, indicating that the user is unauthorized to upload a resume for this session.
    if session["user_id"] != user.id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    # We also check if the interview session has been properly initialized in the database by verifying that the interview_id exists in the session data.
    interview_id=session.get("interview_id") 
    # We check if the provided session_id exists in our interview_sessions dictionary.
    if not session:
        return {"error": "Invalid session ID"}
    

    if not interview_id:
        return {"error": "Interview session not properly initialized in the database"}

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
    
    try:
        supabase.table("interviews").update({
            "resume_text": text
        }).eq("id", interview_id).execute()
    except Exception as e:
        print(f"error saving resume text to database: {e}")

    return {"extracted_text": text}

# The /start_interview endpoint is responsible for initiating a new interview session.
# When a client makes a POST request to this endpoint, we generate a unique session ID using the uuid library,
# create a new entry in the interview_sessions dictionary with an empty context and history,
@app.post("/start_interview")
async def start_interview(user=Depends(get_current_user)):
    session_id = str(uuid.uuid4()) # Generate a unique session ID for the interview session
    #user_id = str(uuid.uuid4())  # Generate a unique user ID for the interview session
    user_id = user.id
    try:
        response=supabase.table("interviews").insert({
            "user_id": user_id,
            "role": "candidate",
            "status": "active"
        }).execute()
    except Exception as e:
        return {"error": f"Failed to create interview session in the database: {e}"}
    
    if not response.data or len(response.data) == 0:
        return {"error": "Failed to create interview session in the database: No data returned"}
    # Generate a unique session ID using uuid4, which creates a random UUID

    interview_id=response.data[0]["id"] if response.data else None

    if not interview_id:
        return {"error": "Failed to create interview session in the database"}

    interview_sessions[session_id] = {
        "user_id": user_id,
        "context": "",
        "history": [],
        "completed":False,
        "interview_id": interview_id # Store the interview ID from the database in the session data for later reference
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
async def interview(request: InterviewRequest, user=Depends(get_current_user)):

    session = interview_sessions.get(request.session_id)
    if not session:
        return {"error": "Invalid session ID"}
    if session["completed"]:
        return {"error": "Interview already ended"}
    if session["user_id"] != user.id:                  # ownership check
        raise HTTPException(status_code=403, detail="Unauthorized")

    
    # We retrieve the context and history for the given session ID, 
    # and then call the llmcalling function to get a response based on the context, user input, and conversation history.
    # The response from the llmcalling function is then appended to the session's history, 
    # and finally returned in the response to the client.
    context=session["context"]
    user_answer=request.user
    history=session["history"]
    res=llmcalling(context,user_answer,history)
    cleaned=re.sub(r"```json|```", "", res).strip()
    try:
        parsed=json.loads(cleaned)
    except:
        parsed = {
        "question": res,
        "feedback": "Could not parse feedback",
        "score": 0
    }
    history.append({"user": user_answer, "ai": parsed})
    print(f"Session {request.session_id} history: {history}")
    return parsed


@app.post("/end_interview")
async def end_interview(request: InterviewRequest, user=Depends(get_current_user)):
    session = interview_sessions.get(request.session_id)
    if not session:
        return {"error": "Invalid session ID"}
    history =session["history"]
    if not history:
        return {'ai':'no interview data found'}
    scores=[]
    for cnvo in history:
        scores.append(cnvo["ai"].get("score",0))
    session["completed"]=True
    avg_score=round((sum(scores)/len(scores)),2) if scores else 0

    #change to llm feedbacking
    feedbackdata=llmfeedback(history)
    cleaned=re.sub(r"```json|```", "", feedbackdata).strip()
    try:
        parsed=json.loads(cleaned)
    except:
        parsed={
            "feedback":feedbackdata,
            "score":0,
            "improvements":"Could not parse response"
        }

    interview_id=session.get("interview_id")
    chat_rows=[
        {
            "interview_id": interview_id,
            "question": cnvo["ai"].get("question", ""),
            "answer": cnvo["user"],
            "feedback": cnvo["ai"].get("feedback", ""),
            "score": cnvo["ai"].get("score", 0)
        }
        for cnvo in history
    ]
    try:
        supabase.table("chat_history").insert(chat_rows).execute()
    except Exception as e:
        print(f"error saving chat history to database: {e}")
    
    try:
        supabase.table("reports").insert({
            "interview_id": session["interview_id"],
            "avg_score": avg_score,
            "llm_score": parsed.get("score",0),
            "feedback": parsed.get("feedback","No feedback provided"),
            "improvements": parsed.get("improvements","No improvements provided"),
    }).execute()
    except Exception as e:
        print(f"error saving report to database: {e}")


    try:
        supabase.table("interviews").update({
            "status": "completed",
            "ended_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", session["interview_id"]).execute()
    except Exception as e:
        print(f"error updating interview status: {e}")

    return {
        "total_questions":len(history),
        "average_score":avg_score,
        "llm_score":parsed.get("score",0),
        "feedback":parsed.get("feedback","No feedback provided"),
        "improvements":parsed.get("improvements","No improvements provided"),
        "status":"interview completed"
    }


@app.post("/speech_to_text")
async def speech_to_text(file: fastapi.UploadFile = fastapi.File(...)):
    file_location = f"temp/{file.filename}"
    with open(file_location, "wb") as f:
        f.write(await file.read())
    text = sst(file_location)
    os.remove(file_location)  # Clean up the temporary file
    return {"text": text}