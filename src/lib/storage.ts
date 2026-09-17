// localStorage の読み書きとバックアップ（エクスポート / インポート）。

export const LS_SETTINGS = 'smartmemo:settings';

// AI プロバイダの API キーは端末ローカルにだけ置く。クラウドへ送ると
// user_data.settings の jsonb 列に平文で残り、DB のバックアップやダッシュボード
// にも露出してしまう。送信前・受信後の両方でこのキーを落とす。
export const SECRET_SETTING_KEYS = ['geminiApiKey', 'openaiApiKey', 'anthropicApiKey'] as const;
export function stripSecretSettings(s: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...((s as Record<string, unknown>) || {}) };
  for (const k of SECRET_SETTING_KEYS) delete out[k];
  return out;
}

export function loadStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
// 保存失敗のトーストは連発しがち（複数キーが同時にあふれる）なので間引く
let lastSaveFailAt = 0;
export function saveStored<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
    console.error('[SmartMemo] save failed for', key, e);
    // 黙って握りつぶすと、画面上は保存できたように見えて再読み込みで消える。
    // 原因のほとんどは容量超過なので、何をすれば直るかまで伝える。
    const now = Date.now();
    if (now - lastSaveFailAt > 10_000) {
      lastSaveFailAt = now;
      window.dispatchEvent(new CustomEvent('app-toast', {
        detail: '保存できませんでした。端末の空き容量が足りません。メモ履歴の削除や添付ファイルの削減をお試しください',
      }));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Backup: export / import all SmartMemo data
// ─────────────────────────────────────────────────────────────
export const SMARTMEMO_PREFIX = 'smartmemo:';
export const BACKUP_VERSION = 1;

export function collectSmartmemoKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(SMARTMEMO_PREFIX)) keys.push(k);
  }
  return keys;
}

export function exportAllData(): void {
  const data: Record<string, unknown> = {};
  for (const key of collectSmartmemoKeys()) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try { data[key] = JSON.parse(raw); }
    catch { data[key] = raw; }
  }
  // バックアップファイルは端末の外（クラウドストレージやメール）へ持ち出されやすい。
  // API キーが平文で入っていると漏えいにつながるので書き出さない。
  if (data[LS_SETTINGS] && typeof data[LS_SETTINGS] === 'object') {
    data[LS_SETTINGS] = stripSecretSettings(data[LS_SETTINGS]);
  }
  const payload = {
    app: 'SmartMemo',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartmemo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importAllData(file: File): Promise<{ ok: boolean; msg: string }> {
  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, msg: 'JSON として読み込めませんでした' };
  }
  if (!parsed || parsed.app !== 'SmartMemo' || typeof parsed.data !== 'object' || parsed.data === null) {
    return { ok: false, msg: 'SmartMemo のバックアップファイルではありません' };
  }
  const entries = Object.entries(parsed.data).filter(([k]) => k.startsWith(SMARTMEMO_PREFIX));
  if (entries.length === 0) {
    return { ok: false, msg: 'インポートできるデータが見つかりませんでした' };
  }
  // エクスポートには API キーを含めないので、そのまま置き換えると
  // この端末で設定済みのキーが消える。ファイル側に無いキーは端末のものを引き継ぐ。
  const importedSettings = parsed.data[LS_SETTINGS];
  if (importedSettings && typeof importedSettings === 'object') {
    const localSettings = loadStored<Record<string, unknown>>(LS_SETTINGS, {});
    const merged: Record<string, unknown> = { ...importedSettings };
    for (const k of SECRET_SETTING_KEYS) {
      if (!merged[k] && localSettings[k]) merged[k] = localSettings[k];
    }
    const i = entries.findIndex(([k]) => k === LS_SETTINGS);
    entries[i] = [LS_SETTINGS, merged];
  }
  // Snapshot current data so a write failure can be rolled back.
  const snapshot: Record<string, string> = {};
  for (const key of collectSmartmemoKeys()) {
    const raw = localStorage.getItem(key);
    if (raw != null) snapshot[key] = raw;
  }
  try {
    Object.keys(snapshot).forEach(k => localStorage.removeItem(k));
    for (const [k, v] of entries) {
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  } catch (e: any) {
    // Roll back to the snapshot on quota/other failure.
    collectSmartmemoKeys().forEach(k => localStorage.removeItem(k));
    Object.entries(snapshot).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch {} });
    return { ok: false, msg: '保存に失敗しました（容量不足の可能性）。データは元のままです' };
  }
  return { ok: true, msg: 'インポートしました。再読み込みします…' };
}
