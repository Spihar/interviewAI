-- Row-level security: a signed-in user can only read their own interviews, answers and reports.
-- The backend uses the secret (service_role) key, which bypasses RLS, so its inserts and updates keep working.
-- No insert/update/delete policies are added, so browser clients using the publishable (anon) key can't write.
alter table interviews enable row level security;
alter table chat_history enable row level security;
alter table reports enable row level security;

drop policy if exists "own interviews" on interviews;
create policy "own interviews" on interviews
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own chat history" on chat_history;
create policy "own chat history" on chat_history
  for select to authenticated
  using (exists (select 1 from interviews i where i.id = chat_history.interview_id and i.user_id = auth.uid()));

drop policy if exists "own reports" on reports;
create policy "own reports" on reports
  for select to authenticated
  using (exists (select 1 from interviews i where i.id = reports.interview_id and i.user_id = auth.uid()));
