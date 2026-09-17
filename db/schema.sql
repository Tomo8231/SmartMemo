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
  -- memo_history はアプリから読み書きしていない（端末ローカルのみ）。
  -- 既存環境との互換のため列は残すが、常に空。
  memo_history jsonb       not null default '[]'::jsonb,
  deleted_ids  jsonb       not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- 既存テーブルにも後から追加できるようにする（冪等）
alter table public.user_data add column if not exists deleted_ids jsonb not null default '{}'::jsonb;

alter table public.user_data enable row level security;

-- RLS を有効化しても、テーブルへの GRANT が無いと
-- 「permission denied for table user_data」(SQLSTATE 42501) で拒否される。
-- Supabase では通常 default privileges で付与されるが、環境によっては
-- 欠けていることがあるため明示的に付与する（冪等）。
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_data to authenticated;

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

-- ─────────────────────────────────────────────────────────────
-- 共有ボックス（複数の TODO / ナレッジを他ユーザーと共有する）
--
-- 参加はメールではなく「共有コード」方式にしている。
-- クライアントからは auth.users を検索できないため、メールで招待しようとすると
-- profiles テーブルの同期など余計な仕組みが要る。コードなら RLS だけで完結する。
-- ─────────────────────────────────────────────────────────────
create table if not exists public.shares (
  id         uuid        primary key default gen_random_uuid(),
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  code       text        not null unique,
  title      text        not null default '共有',
  -- 共有された中身。user_data と同じく JSONB のかたまりで持ち、
  -- 楽観的排他制御（updated_at 一致）＋マージで複数端末・複数人の同時更新に耐える。
  items      jsonb       not null default '{"todos":[],"ideas":[],"deleted_ids":{}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.share_members (
  share_id  uuid        not null references public.shares(id) on delete cascade,
  user_id   uuid        not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (share_id, user_id)
);

create index if not exists share_members_user_idx on public.share_members(user_id);

-- shares と share_members のポリシーが互いを参照すると無限再帰になるため、
-- メンバー判定は security definer 関数に逃がす（RLS を経由しない）。
create or replace function public.is_share_member(p_share uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.share_members m
    where m.share_id = p_share and m.user_id = p_user
  );
$$;

-- 作成者は自動的にメンバーになる（クライアントからの二度手間をなくす）
create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.share_members(share_id, user_id)
  values (new.id, new.owner_id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists shares_add_owner on public.shares;
create trigger shares_add_owner
  after insert on public.shares
  for each row execute function public.add_owner_as_member();

-- 共有コードで参加する。share_members への直接 INSERT は許可していないので、
-- 参加はこの関数経由だけ（＝ UUID を総当たりしても入れない）。
create or replace function public.join_share(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select id into v_id from public.shares where code = upper(btrim(p_code));
  if v_id is null then
    raise exception 'share_not_found';
  end if;
  insert into public.share_members(share_id, user_id)
  values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end;
$$;

alter table public.shares         enable row level security;
alter table public.share_members  enable row level security;

grant select, insert, update, delete on public.shares        to authenticated;
grant select, delete                 on public.share_members to authenticated;
grant execute on function public.join_share(text)             to authenticated;
grant execute on function public.is_share_member(uuid, uuid)  to authenticated;

-- shares: メンバーなら読める。中身の更新もメンバー全員に許可（共同編集のため）。
-- 作成は自分がオーナーのものだけ、削除はオーナーだけ。
drop policy if exists "Members read shares" on public.shares;
create policy "Members read shares"
  on public.shares for select
  using (owner_id = auth.uid() or public.is_share_member(id, auth.uid()));

drop policy if exists "Users create own shares" on public.shares;
create policy "Users create own shares"
  on public.shares for insert
  with check (owner_id = auth.uid());

drop policy if exists "Members update shares" on public.shares;
create policy "Members update shares"
  on public.shares for update
  using (owner_id = auth.uid() or public.is_share_member(id, auth.uid()))
  with check (owner_id = auth.uid() or public.is_share_member(id, auth.uid()));

drop policy if exists "Owner deletes share" on public.shares;
create policy "Owner deletes share"
  on public.shares for delete
  using (owner_id = auth.uid());

-- share_members: 同じ共有のメンバー同士は見える。抜けるのは自分の行だけ、
-- オーナーは誰でも外せる。INSERT は join_share 経由のみ（ポリシー無し＝拒否）。
drop policy if exists "Members read members" on public.share_members;
create policy "Members read members"
  on public.share_members for select
  using (user_id = auth.uid() or public.is_share_member(share_id, auth.uid()));

drop policy if exists "Leave or owner removes" on public.share_members;
create policy "Leave or owner removes"
  on public.share_members for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.shares s where s.id = share_id and s.owner_id = auth.uid())
  );
