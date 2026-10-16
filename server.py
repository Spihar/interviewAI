import fastapi
from fastapi import Header, HTTPException, Depends
from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf
from services.llmfeedback import llmfeedback
from services.rubric import RUBRIC_VERSION, rubric_text, empty_state, normalize_state, add_score, pick_target_skill, should_stop
from services.stt import sst
from pydantic import BaseModel # For defining data models for request and response bodies in FastAPI.
import os
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import uuid 
import json
import re
import time
from typing import Optional

from datetime import datetime, timezone
from db import supabase

LLM_MODEL = "gemini-2.5-flash"   # model used by services/llmcalling.py, saved with each chat_history row

# Interview sessions are stored in the interviews table (history, evaluation_state, completed),
# and the interviews row id is used as the session ID.
# This keeps interviews alive across server restarts instead of losing them from memory.


app = fastapi.FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
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


# ── SESSION STORAGE ───────────────────────────────────────────────────────────
# load_session reads the interview row for the given session ID and returns it shaped like a session dict.
# Returns None if the session doesn't exist (or the ID isn't a valid UUID),
# and raises 403 if the interview belongs to a different user.
def load_session(session_id, user):
    try:
        response = supabase.table("interviews").select(
            "id, user_id, resume_text, history, evaluation_state, completed"
        ).eq("id", session_id).limit(1).execute()
    except Exception as e:
        print(f"error loading session {session_id}: {e}")
        return None
    if not response or not response.data:
        return None
    row = response.data[0]
    if row["user_id"] != user.id:                      # ownership check
        raise HTTPException(status_code=403, detail="Unauthorized")
    return {
        "user_id": row["user_id"],
        "context": row.get("resume_text") or "",
        "history": row.get("history") or [],
        "evaluation_state": normalize_state(row.get("evaluation_state")),   # old flat-shaped states reset to zero counts
        "completed": row.get("completed") or False,
        "interview_id": row["id"]
    }

# save_session writes the session's history, evaluation state and completed flag back to the interviews row.
def save_session(session):
    try:
        supabase.table("interviews").update({
            "history": session["history"],
            "evaluation_state": session["evaluation_state"],
            "completed": session["completed"]
        }).eq("id", session["interview_id"]).execute()
    except Exception as e:
        print(f"error saving session {session['interview_id']}: {e}")


@app.get("/")
async def read_root():
    return {"Hello": "World"}

@app.post("/upload_resume")
async def upload_resume(session_id: str, file: fastapi.UploadFile = fastapi.File(...), user=Depends(get_current_user)):

    session = load_session(session_id, user)
    # We first check if the provided session_id exists in the interviews table.
    # If it doesn't exist, we return an error response indicating that the session ID is invalid.
    # load_session also verifies that the user making the request owns the interview session,
    # raising an HTTP 403 Forbidden error if they don't.
    if not session:
        return {"error": "Invalid session ID"}

    # We also check if the interview session has been properly initialized in the database by verifying that the interview_id exists in the session data.
    interview_id=session.get("interview_id")


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

    # We store the extracted text as the interview's resume_text, which load_session uses as the session's context.
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
# When a client makes a POST request to this endpoint, we create a new row in the interviews table
# with an empty history and evaluation state, and return its id as the session ID.
@app.post("/start_interview")
async def start_interview(user=Depends(get_current_user)):
    #user_id = str(uuid.uuid4())  # Generate a unique user ID for the interview session
    user_id = user.id
    try:
        response=supabase.table("interviews").insert({
            "user_id": user_id,
            "role": "candidate",
            "status": "active",
            "history": [],
            "evaluation_state": empty_state(),   # {skill: {"count", "avg"}}, kept by the server
            "completed":False
        }).execute()
    except Exception as e:
        return {"error": f"Failed to create interview session in the database: {e}"}
    
    if not response.data or len(response.data) == 0:
        return {"error": "Failed to create interview session in the database: No data returned"}

    interview_id=response.data[0]["id"] if response.data else None

    if not interview_id:
        return {"error": "Failed to create interview session in the database"}

    # The interview ID from the database is used as the session ID
    return {"session_id": interview_id}

# We define a Pydantic model called InterviewRequest to represent 
# the expected structure of the request body for the /interview endpoint.
# This model includes two fields: session_id (a string representing the session ID) 
# and user (a string representing the user's input).
class InterviewRequest(BaseModel):
    session_id:str
    user:str

@app.post("/interview")
async def interview(request: InterviewRequest, user=Depends(get_current_user)):

    session = load_session(request.session_id, user)   # also does the ownership check
    if not session:
        return {"error": "Invalid session ID"}
    if session["completed"]:
        return {"error": "Interview already ended"}

    
    # We retrieve the context and history for the given session ID, 
    # and then call the llmcalling function to get a response based on the context, user input, and conversation history.
    # The response from the llmcalling function is then appended to the session's history, 
    # and finally returned in the response to the client.
    context=session["context"]
    user_answer=request.user
    history=session["history"]
    evaluation_state=session["evaluation_state"]
    # The question this answer responds to is the one the AI asked in the previous turn
    # (parsed["question"] below is the NEXT question, while parsed["score"]/["feedback"] grade THIS answer).
    asked_question=history[-1]["ai"].get("question","") if history else ""

    # The server, not the LLM, decides which skill each question assesses.
    # The answer is assessed on the skill its question was asked for (the intro question is communication).
    # The next question targets the skill with the least evidence, counting this answer.
    if asked_question:
        assessed_skill=history[-1].get("target_skill") or "communication"
        projected={skill: dict(entry) for skill, entry in evaluation_state.items()}
        projected[assessed_skill]["count"]+=1
        target_skill=pick_target_skill(projected)
    else:
        assessed_skill=None                  # opening call, nothing to score yet
        target_skill="communication"         # the intro question

    started=time.perf_counter()
    res=llmcalling(context,user_answer,history,rubric_text(),assessed_skill,target_skill)
    latency_ms=int((time.perf_counter()-started)*1000)
    cleaned=re.sub(r"```json|```", "", res).strip()
    try:
        parsed=json.loads(cleaned)
        # clamp the score to the 0-10 rubric scale, a missing/non-numeric score counts as a parse failure
        parsed["score"]=max(0, min(10, float(parsed.get("score"))))
        parse_ok=True
    except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
        parse_ok=False
        parsed = {
        "question": res,
        "feedback": "Could not parse feedback",
        "score": 0
    }

    if parse_ok and assessed_skill:
        add_score(evaluation_state, assessed_skill, parsed["score"])
    history.append({ "user": user_answer, "ai": parsed, "question": asked_question, "parse_ok": parse_ok,
                     "assessed_skill": assessed_skill, "target_skill": target_skill })

    # The server decides when the interview has enough evidence, using the rubric thresholds.
    stop, reason=should_stop(evaluation_state, len(answered_turns(history)))
    parsed["decision"]="stop" if stop else "continue"
    parsed["reason"]=reason
    if stop:
        session["completed"]=True
        # the generated next question is never asked, so a closing line replaces it (also in history)
        parsed["question"]="Thanks, that's all the questions I have. Generating your report…"

    # Save this turn to chat_history right away, so per-question data isn't lost if the interview is never ended.
    # The opening call (no previous question yet) only produces the intro question, so there's nothing to save.
    if asked_question:
        try:
            supabase.table("chat_history").insert({
                "interview_id": session["interview_id"],
                "turn_index": len(history),
                "question": asked_question,
                "answer": user_answer,
                "feedback": parsed.get("feedback", ""),
                "score": parsed.get("score", 0) if parse_ok else None,   # None so parse failures aren't mistaken for a real 0
                "evaluation_state": session["evaluation_state"],
                "rubric_version": RUBRIC_VERSION,
                "assessed_skill": assessed_skill,
                "band": parsed.get("band") if parse_ok else None,
                "justification": parsed.get("justification") if parse_ok else None,
                "latency_ms": latency_ms,
                "parse_ok": parse_ok,
                "raw_response": res,
                "model": LLM_MODEL
            }).execute()
        except Exception as e:
            print(f"error saving chat history to database: {e}")

    save_session(session)   # persist history/evaluation state so the interview survives restarts
    print(f"Session {request.session_id} history: {history}")
    # Tell the frontend whether this answer counts towards the score (same rule as answered_turns),
    # on a copy so it isn't stored in history and doesn't end up in the LLM prompt.
    return {**parsed, "counted": bool(asked_question) and parse_ok}


# answered_turns pairs each answer with the question it actually responds to.
# In history, entry["ai"]["question"] is the NEXT question, so the question being answered is
# entry["question"], or the previous entry's ai question for interviews saved before that key existed.
# The opening turn (no question asked yet) and turns where the LLM response couldn't be parsed are skipped.
def answered_turns(history):
    turns=[]
    for i, entry in enumerate(history):
        if "question" in entry:
            question=entry["question"]
        else:
            question=history[i-1]["ai"].get("question","") if i>0 else ""
        parse_ok=entry.get("parse_ok", entry["ai"].get("feedback") != "Could not parse feedback")
        if not question or not parse_ok:
            continue
        turns.append({
            "question": question,
            "answer": entry["user"],
            "score": entry["ai"].get("score",0),
            "feedback": entry["ai"].get("feedback","")
        })
    return turns


@app.post("/end_interview")
async def end_interview(request: InterviewRequest, user=Depends(get_current_user)):
    session = load_session(request.session_id, user)   # also does the ownership check
    if not session:
        return {"error": "Invalid session ID"}
    history =session["history"]
    # Only answers to a real question that the LLM graded properly count towards the final score and feedback.
    turns=answered_turns(history)
    if not turns:
        return {'ai':'no interview data found'}
    scores=[]
    for turn in turns:
        try:
            scores.append(float(turn["score"]))
        except (TypeError, ValueError):
            scores.append(0)
    session["completed"]=True
    avg_score=round((sum(scores)/len(scores)),2) if scores else 0

    #change to llm feedbacking
    feedbackdata=llmfeedback(turns)
    cleaned=re.sub(r"```json|```", "", feedbackdata).strip()
    try:
        parsed=json.loads(cleaned)
    except:
        parsed={
            "feedback":feedbackdata,
            "score":0,
            "improvements":"Could not parse response"
        }

    # chat_history rows are saved per turn in /interview, so there's nothing to bulk insert here.
    try:
        supabase.table("reports").insert({
            "interview_id": session["interview_id"],
            "avg_score": avg_score,
            "rubric_version": RUBRIC_VERSION,
            "skill_scores": session["evaluation_state"],
            "llm_score": parsed.get("score",0),
            "feedback": parsed.get("feedback","No feedback provided"),
            "improvements": parsed.get("improvements","No improvements provided"),
    }).execute()
    except Exception as e:
        print(f"error saving report to database: {e}")


    try:
        supabase.table("interviews").update({
            "status": "completed",
            "completed": True,
            "ended_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", session["interview_id"]).execute()
    except Exception as e:
        print(f"error updating interview status: {e}")

    return {
        "total_questions":len(turns),
        "average_score":avg_score,
        "llm_score":parsed.get("score",0),
        "feedback":parsed.get("feedback","No feedback provided"),
        "improvements":parsed.get("improvements","No improvements provided"),
        "skill_scores":session["evaluation_state"],
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