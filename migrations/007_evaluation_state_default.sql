-- New interviews get the rubric's evaluation_state shape by default: {skill: {"count": n, "avg": x}} (see services/rubric.py).
-- The server always writes empty_state() itself, so this only matters for rows inserted some other way.
alter table interviews alter column evaluation_state set default
  '{"communication":{"count":0,"avg":0},"technical_depth":{"count":0,"avg":0},"problem_solving":{"count":0,"avg":0},"project_experience":{"count":0,"avg":0}}'::jsonb;
