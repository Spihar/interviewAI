-- Research data for the LLM-vs-human scoring study.
-- participant_code: anonymised, stable per user (services/participant.py, HMAC of user_id with PARTICIPANT_SALT).
alter table interviews add column if not exists participant_code text;
-- Interview start time. Existing rows get their consent time (when the interview was started), older rows stay null.
alter table interviews add column if not exists created_at timestamptz;
update interviews set created_at = consent_at where created_at is null and consent_at is not null;
alter table interviews alter column created_at set default now();
-- How the answer was given: 'typed', 'voice' (transcript sent unchanged) or 'voice_edited' (transcript edited before sending).
alter table chat_history add column if not exists input_mode text;
