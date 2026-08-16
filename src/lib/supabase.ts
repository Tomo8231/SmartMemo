import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export type CloudSnapshot = {
  ideas?: unknown[];
  todos?: unknown[];
  todo_sets?: unknown[];
  trash?: unknown[];
  memo_mons?: unknown[];
  settings?: Record<string, unknown>;
  // メモ履歴は同期しない。添付を base64 で抱えるので転送量が跳ね上がるうえ、
  // 端末ごとの下書き置き場という性質上そろえる必要が薄いため。
  // サーバ側の memo_history 列は過去バージョンの名残（db/schema.sql 参照）。
  // 削除済み ID の墓標（id -> 削除時刻ms）。
  // これが無いと、複数端末のマージで削除した項目が復活してしまう。
  deleted_ids?: Record<string, number>;
};

const TABLE = 'user_data';

export async function fetchCloud(): Promise<{ data: CloudSnapshot | null; updatedAt: string | null }> {
  if (!supabase) return { data: null, updatedAt: null };
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { data: null, updatedAt: null };
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { data: null, updatedAt: null };
  return {
    data: {
      ideas:        data.ideas        ?? [],
      todos:        data.todos        ?? [],
      todo_sets:    data.todo_sets    ?? [],
      trash:        data.trash        ?? [],
      memo_mons:    data.memo_mons    ?? [],
      settings:     data.settings     ?? {},
      deleted_ids:  data.deleted_ids  ?? {},
    },
    updatedAt: data.updated_at ?? null,
  };
}

// deleted_ids 列がまだ無いサーバ（schema.sql 未適用）かどうか。
// 一度そう判定したら以降は送信対象から外し、同期自体は動かし続ける。
let deletedIdsUnsupported = false;
export const isDeletedIdsUnsupported = () => deletedIdsUnsupported;

// PostgREST は未知の列を PGRST204 で返す
function isMissingColumnError(err: unknown, column: string): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = typeof e.message === 'string' ? e.message : '';
  return e.code === 'PGRST204' && msg.includes(column);
}

// 楽観的排他制御つきの書き込み。
// baseUpdatedAt（＝自分が最後に見たサーバの更新時刻）を条件に更新するので、
// その間に他の端末が書き込んでいた場合は 0 件更新となり conflict を返す。
// 呼び出し側はそれを検知して「取得 → マージ → 再送」する。
export async function pushCloud(
  snapshot: CloudSnapshot,
  baseUpdatedAt?: string | null,
): Promise<{ conflict: boolean; updatedAt: string | null }> {
  if (!supabase) return { conflict: false, updatedAt: null };
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return { conflict: false, updatedAt: null };
  const nowIso = new Date().toISOString();

  const payload = () => {
    const p: Record<string, unknown> = { ...snapshot, updated_at: nowIso };
    if (deletedIdsUnsupported) delete p.deleted_ids;
    return p;
  };

  const attempt = async () => {
    if (baseUpdatedAt) {
      return supabase!
        .from(TABLE)
        .update(payload())
        .eq('user_id', userId)
        .eq('updated_at', baseUpdatedAt)
        .select('updated_at');
    }
    // 初回（サーバに行が無い / 基準が不明）だけ upsert する
    return supabase!
      .from(TABLE)
      .upsert({ user_id: userId, ...payload() }, { onConflict: 'user_id' })
      .select('updated_at');
  };

  let { data, error } = await attempt();
  // deleted_ids 列が無いサーバでも同期が止まらないよう、その列を外して一度だけ再送する
  if (error && !deletedIdsUnsupported && isMissingColumnError(error, 'deleted_ids')) {
    console.warn('[cloud] deleted_ids 列がないため、削除の同期を無効にして続行します。db/schema.sql を実行してください。');
    deletedIdsUnsupported = true;
    ({ data, error } = await attempt());
  }
  if (error) throw error;

  if (baseUpdatedAt) {
    // 0 件 = 自分が知らない更新がサーバ側にある（＝競合）
    if (!data || data.length === 0) return { conflict: true, updatedAt: null };
    return { conflict: false, updatedAt: data[0].updated_at ?? nowIso };
  }
  return { conflict: false, updatedAt: data?.[0]?.updated_at ?? nowIso };
}

export async function signUpWithEmail(email: string, password: string) {
  if (!supabase) throw new Error('Supabase 未設定');
  return supabase.auth.signUp({ email, password });
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) throw new Error('Supabase 未設定');
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithGoogle() {
  if (!supabase) throw new Error('Supabase 未設定');
  const redirectTo = window.location.origin + window.location.pathname;
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
