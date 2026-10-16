import os
import httpx
from dotenv import load_dotenv
load_dotenv()

# Groq's hosted Whisper is fast and light enough for a free host.
# Without GROQ_API_KEY we fall back to running faster-whisper locally (pip install faster-whisper).
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"

_local_model = None

def _local_sst(file_path):
    global _local_model
    if _local_model is None:
        from faster_whisper import WhisperModel
        _local_model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _ = _local_model.transcribe(file_path, beam_size=5)
    return " ".join(seg.text.strip() for seg in segments)

def sst(file_path):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return _local_sst(file_path)
    with open(file_path, "rb") as f:
        response = httpx.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (os.path.basename(file_path), f)},
            data={"model": GROQ_MODEL, "language": "en", "response_format": "json"},
            timeout=60,
        )
    response.raise_for_status()
    return response.json()["text"].strip()
