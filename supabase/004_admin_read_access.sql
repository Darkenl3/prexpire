-- 004: Let the admin site read what it shows, and nothing more.
--
-- The admin site (Cloudflare Pages project prexpire-admin) reads these two
-- tables on the server with the Supabase secret key (role service_role).
-- This project does not grant table rights to service_role by default, so
-- reads failed with "permission denied". Read-only, server role only:
-- app users (anon, authenticated) still get nothing, and RLS stays on.
--
-- Run once in Supabase -> SQL Editor. Safe to run again.

grant usage on schema public to service_role;
grant select on public.account_deletions to service_role;
grant select on public.user_seen to service_role;
