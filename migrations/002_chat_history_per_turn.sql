-- Save each interview turn to chat_history as it happens, with timing, parse status and a skill-score snapshot.
alter table chat_history add column if not exists turn_index int;
alter table chat_history add column if not exists evaluation_state jsonb;
alter table chat_history add column if not exists latency_ms int;
alter table chat_history add column if not exists parse_ok boolean;
alter table chat_history add column if not exists raw_response text;
alter table chat_history add column if not exists model text;
alter table chat_history add column if not exists created_at timestamptz not null default now();
