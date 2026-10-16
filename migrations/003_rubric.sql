-- Rubric-based scoring: which rubric/skill each answer was scored on, its band and justification,
-- and the per-skill scores on the final report.
alter table chat_history add column if not exists rubric_version text;
alter table chat_history add column if not exists assessed_skill text;
alter table chat_history add column if not exists band text;
alter table chat_history add column if not exists justification text;
alter table reports add column if not exists rubric_version text;
alter table reports add column if not exists skill_scores jsonb;
