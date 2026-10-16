-- Research consent on each interview (set by /start_interview, which rejects requests without consent),
-- and speech-to-text time on each turn (latency_ms, parse_ok and model are added in 002_chat_history_per_turn.sql).
alter table interviews add column if not exists consent_given boolean not null default false;
alter table interviews add column if not exists consent_at timestamptz;
alter table chat_history add column if not exists stt_ms int;
