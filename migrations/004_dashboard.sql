-- Dashboard: weak and suggested topics on each report, and an optional focus topic on practice interviews.
alter table reports add column if not exists weak_topics jsonb;
alter table reports add column if not exists suggested_topics jsonb;
alter table interviews add column if not exists focus_topic text;
