import hashlib
import hmac
import os
from dotenv import load_dotenv
load_dotenv()

# participant_code turns a Supabase user id into a short, stable, anonymised code (e.g. "P-3f9a2c1b")
# for the research data. It is an HMAC with PARTICIPANT_SALT from .env, so the same user always gets
# the same code, but the code can't be traced back to the user without the salt.
# Keep PARTICIPANT_SALT secret and never change it once data collection starts, or the codes change.
# Returns None when the salt isn't set.
def participant_code(user_id):
    salt = os.getenv("PARTICIPANT_SALT")
    if not salt or not user_id:
        return None
    digest = hmac.new(salt.encode(), str(user_id).encode(), hashlib.sha256).hexdigest()
    return "P-" + digest[:8]
