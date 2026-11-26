-- 005: Total time in the app, for the admin page.
--
-- One number per account on the existing user_seen row: the total seconds
-- the app was on screen while signed in. The app counts on-screen time only
-- (not in the background, not while the phone is locked) and adds it in
-- small batches, at most every 15 minutes or when it goes to the background.
-- Storage stays one row per account.
--
-- Security, same as 003:
-- * RLS stays on with no policies; app users can't read or change the table.
-- * The only way in is add_time_in_app(seconds), which adds to the caller's
--   own row (auth.uid()) and caps each batch at 15 minutes and 0 minimum,
--   so a broken or tampered app can't inflate anyone's total by much.
-- * The admin site reads it with the server key (grant from 004).
--
-- Run once in Supabase -> SQL Editor. Safe to run again.

alter table public.user_seen add column if not exists seconds_in_app bigint not null default 0;

create or replace function public.add_time_in_app(seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  add_s integer := least(greatest(coalesce(seconds, 0), 0), 900);
  today date := (now() at time zone 'utc')::date;
begin
  if me is null or add_s = 0 then
    return;
  end if;
  insert into public.user_seen as s (user_id, first_seen, last_seen, active_days, seconds_in_app)
  values (me, today, today, 1, add_s)
  on conflict (user_id) do update
    set seconds_in_app = s.seconds_in_app + add_s;
end;
$$;

revoke all on function public.add_time_in_app(integer) from public, anon;
grant execute on function public.add_time_in_app(integer) to authenticated;
