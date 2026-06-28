-- SmartMemo Supabase schema
--
-- Run this once in the Supabase SQL editor (idempotent — safe to re-run).
-- Auth must be enabled (Email + Google OAuth providers).

create table if not exists public.user_data (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  ideas        jsonb       not null default '[]'::jsonb,
  todos        jsonb       not null default '[]'::jsonb,
  todo_sets    jsonb       not null default '[]'::jsonb,
  trash        jsonb       not null default '[]'::jsonb,
  memo_mons    jsonb       not null default '[]'::jsonb,
  settings     jsonb       not null default '{}'::jsonb,
  memo_history jsonb       not null default '[]'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- PostgreSQL の CREATE POLICY は IF NOT EXISTS を持たないので、
-- 既存のポリシーを一度 DROP してから再作成する。
drop policy if exists "Users select own data" on public.user_data;
create policy "Users select own data"
  on public.user_data
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own data" on public.user_data;
create policy "Users insert own data"
  on public.user_data
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own data" on public.user_data;
create policy "Users update own data"
  on public.user_data
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own data" on public.user_data;
create policy "Users delete own data"
  on public.user_data
  for delete
  using (auth.uid() = user_id);
