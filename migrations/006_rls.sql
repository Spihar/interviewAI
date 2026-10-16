-- Row-level security: a signed-in user can only read their own interviews, answers and reports.
-- The backend uses the secret (service_role) key, which bypasses RLS, so its inserts and updates keep working.
-- No insert/update/delete policies are added, so browser clients using the publishable (anon) key can't write.
-- If interviews.user_id is text rather than uuid, use (select auth.uid())::text in the three policies below.
-- (select auth.uid()) is evaluated once per query instead of once per row.
alter table interviews enable row level security;
alter table chat_history enable row level security;
alter table reports enable row level security;

drop policy if exists "own interviews" on interviews;
create policy "own interviews" on interviews
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "own chat history" on chat_history;
create policy "own chat history" on chat_history
  for select to authenticated
  using (exists (select 1 from interviews i where i.id = chat_history.interview_id and i.user_id = (select auth.uid())));

drop policy if exists "own reports" on reports;
create policy "own reports" on reports
  for select to authenticated
  using (exists (select 1 from interviews i where i.id = reports.interview_id and i.user_id = (select auth.uid())));

-- The policies (and the dashboard queries) look rows up by interview_id.
create index if not exists chat_history_interview_id_idx on chat_history (interview_id);
create index if not exists reports_interview_id_idx on reports (interview_id);
