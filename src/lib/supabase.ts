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
  memo_history?: unknown[];
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
      memo_history: data.memo_history ?? [],
    },
    updatedAt: data.updated_at ?? null,
  };
}

export async function pushCloud(snapshot: CloudSnapshot): Promise<void> {
  if (!supabase) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return;
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        ...snapshot,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
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
