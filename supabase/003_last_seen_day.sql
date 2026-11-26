-- 003: "Last seen" for the admin page, by DAY only.
--
-- One row per account, never more: the first and last day the app was open
-- while signed in, and how many different days that was. The app asks once a
-- day; a second call on the same day changes nothing (no write at all), so the
-- table stays tiny and no times of day are kept.
--
-- Security:
-- * RLS is on and there are NO policies, and anon/authenticated have no table
--   rights: nobody can read or change rows through the API with an app key.
-- * The only way in is mark_seen(), which writes the caller's own row
--   (auth.uid()), nothing else, and returns nothing.
-- * The admin page reads the table on the server with the service_role key,
--   which never leaves Cloudflare.
-- * Rows disappear with the account (on delete cascade).
--
-- Run once in Supabase -> SQL Editor. Safe to run again.

create table if not exists public.user_seen (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  first_seen  date not null default (now() at time zone 'utc')::date,
  last_seen   date not null default (now() at time zone 'utc')::date,
  active_days integer not null default 1
);

alter table public.user_seen enable row level security;
revoke all on public.user_seen from anon, authenticated;

create or replace function public.mark_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
begin
  if me is null then
    return;
  end if;
  insert into public.user_seen as s (user_id, first_seen, last_seen, active_days)
  values (me, today, today, 1)
  on conflict (user_id) do update
    set last_seen = excluded.last_seen,
        active_days = s.active_days + 1
    where s.last_seen < excluded.last_seen;
end;
$$;

revoke all on function public.mark_seen() from public, anon;
grant execute on function public.mark_seen() to authenticated;
