-- Table grants for the Supabase Data API.
-- From 30 Oct 2026, Supabase no longer grants API access automatically to tables created in "public".
-- Tables that already exist keep their grants, so on the current database this file changes nothing.
-- Run it after creating interviews, chat_history and reports on a fresh database, or the API returns "permission denied".
-- service_role: the backend (server.py, scripts/export_for_raters.py) uses the secret key. It bypasses RLS but still needs grants.
grant select, insert, update, delete on public.interviews to service_role;
grant select, insert, update, delete on public.chat_history to service_role;
grant select, insert, update, delete on public.reports to service_role;
-- authenticated: signed-in users may only read their own rows (see the select policies in 006_rls.sql).
-- The frontend doesn't query these tables today, but this keeps the policies usable.
grant select on public.interviews to authenticated;
grant select on public.chat_history to authenticated;
grant select on public.reports to authenticated;
-- anon (signed-out visitors) gets nothing: no policy lets it read or write these tables.
-- Add a grant here, in the same file, for any new table the backend or frontend needs.
