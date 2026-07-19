-- SmartMemo Supabase schema
--
-- Supabase SQL Editor で実行してください。冪等なので何度でも再実行可能。
-- Auth で Email + (任意で Google) プロバイダを有効化しておく必要があります。

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

-- PostgreSQL の CREATE POLICY は IF NOT EXISTS をサポートしていないので、
-- 既存ポリシーを DROP してから CREATE する形にする。
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
