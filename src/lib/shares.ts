// 共有ボックス: 複数の TODO / ナレッジを他のユーザーと共有する。
//
// 参加は「共有コード」方式。クライアントからは auth.users を検索できないので、
// メール招待にすると profiles の同期などが要る。コードなら RLS だけで完結する。
//
// 中身（items）は user_data と同じく JSONB のかたまりで持ち、
// 楽観的排他制御（updated_at 一致）＋マージで同時更新に耐える。
import { supabase } from './supabase';

export type ShareItems = {
  todos: any[];
  ideas: any[];
  // 削除済み ID の墓標（id -> 削除時刻ms）。これが無いとマージで削除が復活する。
  deleted_ids: Record<string, number>;
};

export type ShareRow = {
  id: string;
  owner_id: string;
  code: string;
  title: string;
  items: ShareItems;
  created_at: string;
  updated_at: string;
};

export const emptyShareItems = (): ShareItems => ({ todos: [], ideas: [], deleted_ids: {} });

function normalizeItems(raw: any): ShareItems {
  return {
    todos: Array.isArray(raw?.todos) ? raw.todos : [],
    ideas: Array.isArray(raw?.ideas) ? raw.ideas : [],
    deleted_ids: raw?.deleted_ids && typeof raw.deleted_ids === 'object' ? raw.deleted_ids : {},
  };
}

function normalizeRow(r: any): ShareRow {
  return { ...r, items: normalizeItems(r?.items) } as ShareRow;
}

function requireClient() {
  if (!supabase) throw new Error('Supabase 未設定');
  return supabase;
}

async function currentUserId(): Promise<string | null> {
  const c = requireClient();
  const { data } = await c.auth.getSession();
  return data.session?.user?.id ?? null;
}

// 紛らわしい文字（0/O, 1/I）を除いた 6 桁のコード
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len = 6): string {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

// ── マージ ──
// どちらか片方にしか無い項目は必ず残す（union）。両方にある項目は mtime が
// 新しい方を採用。削除は墓標で表す。user_data 側のマージと同じ考え方。
function mergeById(remote: any[], local: any[], tomb: Record<string, number>): any[] {
  const out = new Map<string, any>();
  const put = (arr: any[]) => {
    for (const it of arr || []) {
      const k = String(it?.id ?? '');
      if (!k) continue;
      const prev = out.get(k);
      if (!prev) { out.set(k, it); continue; }
      if (Number(it.mtime ?? 0) >= Number(prev.mtime ?? 0)) out.set(k, it);
    }
  };
  put(remote);
  put(local);
  return Array.from(out.entries()).filter(([k]) => !tomb[k]).map(([, v]) => v);
}

export function mergeShareItems(remote: ShareItems, local: ShareItems): ShareItems {
  const tomb = { ...(remote.deleted_ids || {}), ...(local.deleted_ids || {}) };
  return {
    todos: mergeById(remote.todos, local.todos, tomb),
    ideas: mergeById(remote.ideas, local.ideas, tomb),
    deleted_ids: tomb,
  };
}

// ── API ──

/** 自分が入っている共有の一覧（新しい順） */
export async function listShares(): Promise<ShareRow[]> {
  const c = requireClient();
  const uid = await currentUserId();
  if (!uid) return [];
  // RLS でメンバーの共有だけが返る
  const { data, error } = await c
    .from('shares')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeRow);
}

/** 共有を新しく作る。コードが衝突したら引き直す。 */
export async function createShare(title: string, items: ShareItems): Promise<ShareRow> {
  const c = requireClient();
  const uid = await currentUserId();
  if (!uid) throw new Error('ログインが必要です');
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const { data, error } = await c
      .from('shares')
      .insert({ owner_id: uid, code: randomCode(), title: title.trim() || '共有', items })
      .select('*')
      .single();
    if (!error) return normalizeRow(data);
    // 23505 = unique_violation（コード衝突）のときだけ引き直す
    if ((error as { code?: string }).code !== '23505') throw error;
    lastErr = error;
  }
  throw lastErr ?? new Error('共有コードを発行できませんでした');
}

/** 共有コードで参加する。参加した共有の id を返す。 */
export async function joinShare(code: string): Promise<string> {
  const c = requireClient();
  const { data, error } = await c.rpc('join_share', { p_code: code });
  if (error) throw error;
  return data as string;
}

/** 1 件取得（最新の updated_at も返す） */
export async function fetchShare(id: string): Promise<ShareRow | null> {
  const c = requireClient();
  const { data, error } = await c.from('shares').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? normalizeRow(data) : null;
}

/**
 * 中身を書き戻す。baseUpdatedAt を条件にするので、他の人が先に更新していたら
 * conflict を返す。呼び出し側は「取得 → マージ → 再送」する。
 */
export async function pushShareItems(
  id: string, items: ShareItems, baseUpdatedAt: string,
): Promise<{ conflict: boolean; row: ShareRow | null }> {
  const c = requireClient();
  const { data, error } = await c
    .from('shares')
    .update({ items, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('updated_at', baseUpdatedAt)
    .select('*');
  if (error) throw error;
  if (!data || data.length === 0) return { conflict: true, row: null };
  return { conflict: false, row: normalizeRow(data[0]) };
}

/** 競合したら取り込んでマージし、最大 4 回まで再送する */
export async function saveShareItems(
  id: string, items: ShareItems, baseUpdatedAt: string,
): Promise<ShareRow> {
  let next = items;
  let base = baseUpdatedAt;
  for (let i = 0; i < 4; i++) {
    const res = await pushShareItems(id, next, base);
    if (!res.conflict) return res.row!;
    const fresh = await fetchShare(id);
    if (!fresh) throw new Error('共有が見つかりません（削除された可能性があります）');
    next = mergeShareItems(fresh.items, next);
    base = fresh.updated_at;
  }
  throw new Error('他の人の更新と競合しました。もう一度お試しください。');
}

/** タイトルを変える（メンバーなら誰でも） */
export async function renameShare(id: string, title: string): Promise<void> {
  const c = requireClient();
  const { error } = await c.from('shares').update({ title: title.trim() || '共有' }).eq('id', id);
  if (error) throw error;
}

/** 共有から抜ける（自分のメンバー行を消す） */
export async function leaveShare(id: string): Promise<void> {
  const c = requireClient();
  const uid = await currentUserId();
  if (!uid) return;
  const { error } = await c.from('share_members').delete().eq('share_id', id).eq('user_id', uid);
  if (error) throw error;
}

/** 共有ごと削除する（オーナーのみ。RLS で他人は弾かれる） */
export async function deleteShare(id: string): Promise<void> {
  const c = requireClient();
  const { error } = await c.from('shares').delete().eq('id', id);
  if (error) throw error;
}

/** 参加人数（メンバー行の件数） */
export async function countMembers(id: string): Promise<number> {
  const c = requireClient();
  const { count, error } = await c
    .from('share_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('share_id', id);
  if (error) throw error;
  return count ?? 0;
}

/** 共有まわりのエラーを日本語にする */
export function describeShareError(e: unknown): string {
  const raw = (() => {
    if (e instanceof Error) return e.message;
    if (e && typeof e === 'object') {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string' && m) return m;
      try { return JSON.stringify(e); } catch { return '不明なエラー'; }
    }
    return String(e ?? '');
  })();
  const code = (e as { code?: string })?.code;
  if (/share_not_found/.test(raw)) return 'その共有コードは見つかりませんでした。';
  if (/not_authenticated/.test(raw)) return 'ログインが必要です。';
  if (code === '42P01' || /relation .* does not exist/i.test(raw)) {
    return '共有用のテーブルがありません。Supabase の SQL Editor で最新の db/schema.sql を実行してください。';
  }
  if (code === 'PGRST202' || /Could not find the function/i.test(raw)) {
    return '共有用の関数（join_share）がありません。Supabase の SQL Editor で最新の db/schema.sql を実行してください。';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(raw)) {
    return '権限がありません。最新の db/schema.sql を実行したうえで、ログインし直してください。';
  }
  return raw || '不明なエラー';
}
