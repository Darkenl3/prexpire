-- Prexpire: backup and sync, and in-app account deletion.
-- Run once in Supabase: SQL Editor → New query → paste all of this → Run.
-- Safe to run again (everything is "if not exists" / "or replace").

-- 1. One row per synced thing: an item, a shopping entry, or a small
--    document (categories, settings, waste-stats history…).
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('item', 'shopping', 'doc')),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

create index if not exists records_user_updated on public.records (user_id, updated_at);

-- The server sets the time of every change, so phones with wrong clocks
-- can't confuse which change is newer.
create or replace function public.records_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
before insert or update on public.records
for each row execute function public.records_touch();

-- 2. Row Level Security: each person sees and changes only their own rows.
alter table public.records enable row level security;

drop policy if exists "own records: read"   on public.records;
drop policy if exists "own records: add"    on public.records;
drop policy if exists "own records: change" on public.records;
drop policy if exists "own records: remove" on public.records;

create policy "own records: read"   on public.records for select to authenticated using (user_id = (select auth.uid()));
create policy "own records: add"    on public.records for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own records: change" on public.records for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own records: remove" on public.records for delete to authenticated using (user_id = (select auth.uid()));

-- New tables aren't exposed automatically in this project: open this one to
-- signed-in people only (never to anonymous visitors).
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- 3. Delete account (Apple requires it in apps that create accounts).
--    Deletes the signed-in person's account; their records go with it
--    (on delete cascade). Runs with the owner's rights, but only ever on
--    the caller's own account.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
