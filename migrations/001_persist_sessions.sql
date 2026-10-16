-- Persist interview session state so server restarts don't lose in-progress interviews.
-- resume_text already exists on interviews and is used as the interview context.
alter table interviews add column if not exists history jsonb not null default '[]'::jsonb;
alter table interviews add column if not exists evaluation_state jsonb not null default '{"technical_depth":0,"communication":0,"problem_solving":0,"project_experience":0}'::jsonb;
alter table interviews add column if not exists completed boolean not null default false;
