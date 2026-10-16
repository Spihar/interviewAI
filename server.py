import fastapi
from fastapi import Header, HTTPException, Depends
from services.llmcalling import llmcalling
from services.pdfreading import extract_text_pymupdf
from services.llmfeedback import llmfeedback
from services.rubric import RUBRIC_VERSION, SKILLS, rubric_text, empty_state, normalize_state, add_score, pick_target_skill, should_stop, is_settled
from services.stt import sst
from pydantic import BaseModel # For defining data models for request and response bodies in FastAPI.
import os
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
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
        # select * so optional columns (focus_topic) don't break loading before their migration is run
        response = supabase.table("interviews").select("*").eq("id", session_id).limit(1).execute()
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
        "focus_topic": row.get("focus_topic"),
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

# StartRequest is the optional body of /start_interview.
# focus_topic is set when the user starts a practice interview from a suggested topic on the dashboard.
class StartRequest(BaseModel):
    focus_topic: Optional[str] = None

# The /start_interview endpoint is responsible for initiating a new interview session.
# When a client makes a POST request to this endpoint, we create a new row in the interviews table
# with an empty history and evaluation state, and return its id as the session ID.
@app.post("/start_interview")
async def start_interview(request: Optional[StartRequest] = None, user=Depends(get_current_user)):
    #user_id = str(uuid.uuid4())  # Generate a unique user ID for the interview session
    user_id = user.id
    row={
        "user_id": user_id,
        "role": "candidate",
        "status": "active",
        "history": [],
        "evaluation_state": empty_state(),   # {skill: {"count", "avg"}}, kept by the server
        "completed":False
    }
    focus_topic=(request.focus_topic or "").strip()[:120] if request else ""
    if focus_topic:
        row["focus_topic"]=focus_topic       # needs migrations/004_dashboard.sql
    try:
        response=supabase.table("interviews").insert(row).execute()
    except Exception as e:
        if "focus_topic" not in row:
            return {"error": f"Failed to create interview session in the database: {e}"}
        # most likely migrations/004_dashboard.sql hasn't been run yet, so start a normal interview instead
        print(f"error saving focus topic, starting without it: {e}")
        row.pop("focus_topic")
        try:
            response=supabase.table("interviews").insert(row).execute()
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
    res=llmcalling(context,user_answer,history,rubric_text(),assessed_skill,target_skill,session.get("focus_topic"))
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
    # and the per-skill evidence for the coverage panel,
    # on a copy so it isn't stored in history and doesn't end up in the LLM prompt.
    return {**parsed, "counted": bool(asked_question) and parse_ok,
            "skill_state": evaluation_state, "target_skill": target_skill,
            "settled": {skill: is_settled(entry) for skill, entry in evaluation_state.items()}}


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
            "feedback": entry["ai"].get("feedback",""),
            "assessed_skill": entry.get("assessed_skill"),
            "justification": entry["ai"].get("justification","")
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
    feedbackdata=llmfeedback(turns, SKILLS)
    cleaned=re.sub(r"```json|```", "", feedbackdata).strip()
    try:
        parsed=json.loads(cleaned)
    except:
        parsed={
            "feedback":feedbackdata,
            "score":0,
            "improvements":"Could not parse response"
        }

    weak_topics=clean_topics(parsed.get("weak_topics"), "topic")
    suggested_topics=clean_topics(parsed.get("suggested_topics"), "title")

    # chat_history rows are saved per turn in /interview, so there's nothing to bulk insert here.
    report_row={
        "interview_id": session["interview_id"],
        "avg_score": avg_score,
        "rubric_version": RUBRIC_VERSION,
        "skill_scores": session["evaluation_state"],
        "llm_score": parsed.get("score",0),
        "feedback": parsed.get("feedback","No feedback provided"),
        "improvements": parsed.get("improvements","No improvements provided"),
    }
    try:
        supabase.table("reports").insert({**report_row, "weak_topics": weak_topics, "suggested_topics": suggested_topics}).execute()
    except Exception as e:
        # most likely migrations/004_dashboard.sql hasn't been run yet, so save the report without the topic columns
        print(f"error saving report with topics, retrying without them: {e}")
        try:
            supabase.table("reports").insert(report_row).execute()
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
        "weak_topics":weak_topics,
        "suggested_topics":suggested_topics,
        "interview_id":session["interview_id"],
        "status":"interview completed"
    }


# clean_topics keeps the well-formed entries of the LLM's weak/suggested topic lists (at most 3),
# so the dashboard never has to deal with missing keys or unknown skills.
def clean_topics(items, name_key):
    cleaned=[]
    if not isinstance(items, list):
        return cleaned
    for item in items:
        if not isinstance(item, dict) or not str(item.get(name_key) or "").strip():
            continue
        skill=item.get("skill") if item.get("skill") in SKILLS else None
        cleaned.append({name_key: str(item[name_key]).strip(), "skill": skill, "why": str(item.get("why") or "").strip()})
    return cleaned[:3]


# ── DASHBOARD & REPORTS ───────────────────────────────────────────────────────
# interview_time is the best timestamp we have for a finished interview, used for sorting and display.
def interview_time(interview, report):
    return (interview.get("ended_at") or (report or {}).get("created_at") or interview.get("created_at") or "")

# skill_avg returns a skill's average from a report's skill_scores, or None if it wasn't assessed.
def skill_avg(skill_scores, skill):
    entry=(skill_scores or {}).get(skill)
    if isinstance(entry, dict) and entry.get("count"):
        return round(float(entry.get("avg", 0)), 2)
    return None

def mean(values):
    values=[v for v in values if v is not None]
    return round(sum(values)/len(values), 2) if values else None

# finished_interviews returns the user's interviews that have a report, oldest first,
# each with its report merged in: [{"interview": row, "report": row}, ...]
def finished_interviews(user_id):
    # Only the columns the dashboard needs, not every interview's history and resume.
    # focus_topic comes from migrations/004_dashboard.sql, so load without it if that hasn't been run yet.
    try:
        interviews=supabase.table("interviews").select("id, created_at, ended_at, focus_topic").eq("user_id", user_id).execute().data or []
    except Exception as e:
        print(f"error loading interviews with focus_topic, retrying without it: {e}")
        interviews=supabase.table("interviews").select("id, created_at, ended_at").eq("user_id", user_id).execute().data or []
    ids=[row["id"] for row in interviews]
    reports=supabase.table("reports").select("*").in_("interview_id", ids).execute().data if ids else []
    by_interview={}
    for report in reports or []:
        by_interview[report["interview_id"]]=report    # one report per interview, the last one wins
    finished=[{"interview": row, "report": by_interview[row["id"]]} for row in interviews if row["id"] in by_interview]
    finished.sort(key=lambda item: interview_time(item["interview"], item["report"]))
    return finished

def summarize(item):
    interview, report=item["interview"], item["report"]
    skill_scores=report.get("skill_scores") or {}
    return {
        "interview_id": interview["id"],
        "date": interview_time(interview, report),
        "avg_score": report.get("avg_score"),
        "llm_score": report.get("llm_score"),
        "questions": sum(int((skill_scores.get(skill) or {}).get("count", 0)) for skill in SKILLS),
        "skills": {skill: skill_avg(skill_scores, skill) for skill in SKILLS},
        "focus_topic": interview.get("focus_topic"),
    }


# /dashboard returns everything the home page shows: past interviews, per-skill trend,
# current skill levels, weak topics and suggested practice topics.
@app.get("/dashboard")
async def dashboard(user=Depends(get_current_user)):
    try:
        finished=finished_interviews(user.id)
    except Exception as e:
        print(f"error loading dashboard: {e}")
        raise HTTPException(status_code=500, detail="Could not load your interviews")

    interviews=[summarize(item) for item in finished]

    # Skill level now = average over the last 3 interviews that assessed it, delta = vs the 3 before those.
    skills_now={}
    for skill in SKILLS:
        values=[row["skills"][skill] for row in interviews if row["skills"][skill] is not None]
        now, before=mean(values[-3:]), mean(values[-6:-3])
        first=values[0] if values else None
        skills_now[skill]={
            "avg": now,
            "delta": round(now-before, 2) if now is not None and before is not None else None,
            "since_first": round(values[-1]-first, 2) if len(values)>1 else None,
        }

    # Weak topics come from the last 5 reports, grouped by name, most frequent first.
    weak={}
    for item in finished[-5:]:
        for topic in item["report"].get("weak_topics") or []:
            key=topic.get("topic","").strip().lower()
            if not key:
                continue
            entry=weak.setdefault(key, {**topic, "count": 0})
            entry["count"]+=1
            entry["last_seen"]=interview_time(item["interview"], item["report"])   # finished is oldest first, so this ends as the latest
            entry["why"]=topic.get("why") or entry["why"]     # keep the most recent explanation
    weak_topics=sorted(weak.values(), key=lambda t: t["last_seen"], reverse=True)   # newest first among ties
    weak_topics=sorted(weak_topics, key=lambda t: t["count"], reverse=True)[:5]

    # Older reports have no weak topics, so fall back to the lowest-scored answers.
    low_answers=[]
    if not weak_topics and finished:
        ids=[item["interview"]["id"] for item in finished[-5:]]
        try:
            rows=supabase.table("chat_history").select("question, score, assessed_skill, justification, interview_id") \
                .in_("interview_id", ids).lt("score", 5).execute().data or []
            low_answers=sorted(rows, key=lambda r: r.get("score") or 0)[:5]
        except Exception as e:
            print(f"error loading low answers: {e}")

    # Suggestions come from the most recent report that has them.
    suggested=next((item["report"]["suggested_topics"] for item in reversed(finished) if item["report"].get("suggested_topics")), [])

    return {
        "skills": SKILLS,
        "interviews": interviews,
        "skills_now": skills_now,
        "weak_topics": weak_topics,
        "low_answers": low_answers,
        "suggested_topics": suggested,
    }


# /reports/{interview_id} returns one finished interview: its report, every scored answer,
# and the previous interview's skill averages for comparison.
@app.get("/reports/{interview_id}")
async def get_report(interview_id: str, user=Depends(get_current_user)):
    try:
        finished=finished_interviews(user.id)    # only the user's own interviews, so this is also the ownership check
    except Exception as e:
        print(f"error loading report {interview_id}: {e}")
        raise HTTPException(status_code=500, detail="Could not load this report")
    index=next((i for i, item in enumerate(finished) if item["interview"]["id"]==interview_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Report not found")
    item=finished[index]
    report=item["report"]
    try:
        answers=supabase.table("chat_history").select("*").eq("interview_id", interview_id).execute().data or []
    except Exception as e:
        print(f"error loading answers for {interview_id}: {e}")
        answers=[]
    answers.sort(key=lambda r: (r.get("turn_index") or 0, r.get("created_at") or ""))
    return {
        **summarize(item),
        "feedback": report.get("feedback"),
        "improvements": report.get("improvements"),
        "weak_topics": report.get("weak_topics") or [],
        "suggested_topics": report.get("suggested_topics") or [],
        "previous": summarize(finished[index-1]) if index>0 else None,
        "number": index+1,
        "total": len(finished),
        "answers": [{
            "question": r.get("question"),
            "answer": r.get("answer"),
            "score": r.get("score"),
            "band": r.get("band"),
            "skill": r.get("assessed_skill"),
            "feedback": r.get("feedback"),
            "justification": r.get("justification"),
        } for r in answers],
    }


@app.post("/speech_to_text")
async def speech_to_text(file: fastapi.UploadFile = fastapi.File(...), user=Depends(get_current_user)):
    # A unique name per upload so two people speaking at once don't overwrite each other's audio.
    os.makedirs("temp", exist_ok=True)
    file_location = f"temp/{uuid.uuid4().hex}.webm"
    with open(file_location, "wb") as f:
        f.write(await file.read())
    try:
        text = await run_in_threadpool(sst, file_location)
    except Exception as e:
        print("Transcription failed:", e)
        raise HTTPException(status_code=502, detail="Transcription failed, please try again or type your answer")
    finally:
        os.remove(file_location)  # Clean up the temporary file
    return {"text": text}