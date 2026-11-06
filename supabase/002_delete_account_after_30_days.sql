-- Prexpire: account deletion with a 30-day grace period.
-- Run once in Supabase, after 001: SQL Editor → New query → paste all of
-- this → Run. Safe to run again.
--
-- Deleting an account (in the app, or on app.prexpire.com/delete-account)
-- schedules it. The person is signed out and their phone is cleared. If they
-- sign back in within 30 days they can restore the account, with everything
-- in it. After 30 days a daily job deletes the account and all its data for
-- good.

-- 1. Accounts waiting to be deleted.
create table if not exists public.account_deletions (
  user_id      uuid        primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  purge_after  timestamptz not null default now() + interval '30 days'
);

alter table public.account_deletions enable row level security;
drop policy if exists "own deletion: read" on public.account_deletions;
create policy "own deletion: read" on public.account_deletions for select to authenticated using (user_id = (select auth.uid()));
-- Changes only go through the functions below.
revoke all on public.account_deletions from anon, authenticated;
grant select on public.account_deletions to authenticated;

-- 2. While an account is waiting to be deleted, nothing new is saved to it.
drop policy if exists "own records: add"    on public.records;
drop policy if exists "own records: change" on public.records;
create policy "own records: add" on public.records for insert to authenticated
  with check (user_id = (select auth.uid())
    and not exists (select 1 from public.account_deletions d where d.user_id = (select auth.uid())));
create policy "own records: change" on public.records for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
    and not exists (select 1 from public.account_deletions d where d.user_id = (select auth.uid())));

-- 3. Schedule deletion of the signed-in account. Returns the date it will be
--    deleted for good. Asking again keeps the first date.
create or replace function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  purge timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.account_deletions (user_id) values (auth.uid())
  on conflict (user_id) do nothing;
  select purge_after into purge from public.account_deletions where user_id = auth.uid();
  return purge;
end;
$$;

-- 4. Restore: cancel the scheduled deletion of the signed-in account.
create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from public.account_deletions where user_id = auth.uid();
end;
$$;

-- 5. When the signed-in account will be deleted (null when it won't).
create or replace function public.account_deletion_status()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select purge_after from public.account_deletions where user_id = auth.uid();
$$;

-- 6. Older app versions call delete_account(): it now schedules too.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.request_account_deletion();
end;
$$;

revoke execute on function public.request_account_deletion() from public, anon;
revoke execute on function public.cancel_account_deletion()  from public, anon;
revoke execute on function public.account_deletion_status()  from public, anon;
revoke execute on function public.delete_account()           from public, anon;
grant  execute on function public.request_account_deletion() to authenticated;
grant  execute on function public.cancel_account_deletion()  to authenticated;
grant  execute on function public.account_deletion_status()  to authenticated;
grant  execute on function public.delete_account()           to authenticated;

-- 7. The permanent deletion: accounts past their 30 days, with everything
--    in them (records go with the account: on delete cascade). Nobody can
--    call this from the app; only the daily job below runs it.
create or replace function public.purge_deleted_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from auth.users u
  using public.account_deletions d
  where d.user_id = u.id and d.purge_after <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.purge_deleted_accounts() from public, anon, authenticated;

-- 8. Run it every day at 03:17 UTC (pg_cron; scheduling by name replaces an
--    earlier schedule of the same job, so running this file again is fine).
create extension if not exists pg_cron;
select cron.schedule('prexpire-purge-deleted-accounts', '17 3 * * *', 'select public.purge_deleted_accounts()');
