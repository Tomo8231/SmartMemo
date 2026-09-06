import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  supabase, isSupabaseConfigured,
  fetchCloud, pushCloud, isDeletedIdsUnsupported, retryDeletedIds,
  signUpWithEmail, signInWithEmail, signInWithGoogle, signOut,
  type CloudSnapshot,
} from './lib/supabase';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type Todo = {
  id: number | string;
  title: string;
  startDate: string;
  endDate: string;
  time: string;
  tags: string[];
  done: boolean;
  addedAt?: number;
  completedAt?: string; // YYYY-MM-DD when marked done; used for displaying done todos
  coinReward?: number;
  recurring?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  recurringDay?: number;
  recurringGroupId?: string;
  attachments?: Attachment[];
  mtime?: number; // 端末間マージ用の最終更新時刻
};
type Idea = {
  id: number | string;
  projectName: string;
  summary: string;
  details: string[];
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  addedAt?: number;
  subTab?: string;
  coinReward?: number;
  attachments?: Attachment[];
  mtime?: number; // 端末間マージ用の最終更新時刻
};
type Settings = {
  colorIdx: number;
  fontIdx: number;
  notifEnabled: boolean;
  autoTag: boolean;
  autoDate: boolean;
  completeSound: boolean;
  customTags: string[];
  geminiApiKey: string;
  aiProvider?: 'gemini' | 'openai' | 'anthropic';
  openaiApiKey?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  soundType?: string;
  ideaTabs?: string[];
  coins?: number;
  darkMode?: boolean;
  bgIdx?: number;
  infiniteCoins?: boolean;
  infiniteCoinsUnlocked?: boolean;
  gachaUnlocked?: { sounds: string[]; bgs: number[]; mons?: string[] };
  memoMonVisible?: boolean;
  hiddenMons?: string[];
  activeMonUid?: string;
  memoMonSize?: 'small' | 'medium' | 'large';
  memoMonSpeech?: boolean;
  usedGiftCodes?: string[];
  notifAdvanceMin?: number;  // minutes before task time (0/15/30/60)
  notifDailyTime?: string;   // "HH:MM" for todos without a time
  holidayWeekends?: boolean;
  holidayJpHolidays?: boolean;
  customHolidays?: string[];
  splitReflectButtons?: boolean;
  foodInventory?: Record<string, number>;
  glassUI?: boolean;
  itemInventory?: Record<string, number>;
};
type AnimState = 'sit' | 'walk' | 'happy' | 'dislike' | 'sleep' | 'surprise';
type MemoMonDef = { id: string; name: string; pixels: string[]; palette: Record<string, string>; rarity: string; desc: string; monW: number; monH: number; imageUrl?: string; spriteFacing?: 'l' | 'r'; sprites?: Partial<Record<AnimState, { frames: string[]; fps: number; loop: boolean }>>; favoriteFoods?: string[]; dislikedFoods?: string[]; };
// 庭のメモモンが出す「おねだり」。応えるとなつき度が上がる。
type MonRequestKind = 'food' | 'toilet' | 'play';
type MemoMonInstance = { uid: string; defId: string; hunger: number; lastFed: number; activity?: 'active' | 'lazy'; affection?: number; lastPetAt?: number; lastSeenAt?: number; request?: MonRequestKind; requestAt?: number; lastRequestDoneAt?: number; mtime?: number; };
type GachaPrize = {
  type: 'miss' | 'sound' | 'bg' | 'memomon' | 'food';
  label: string; rarity: string; stars: string; color: string;
  soundType?: string; bgIdx?: number; monDefId?: string; foodId?: string;
  flavor?: string;
};
type TodoDraft = {
  id?: number | string;
  title: string;
  startDate: string;
  endDate: string;
  time: string;
  tags: string[];
  done?: boolean;
  coinReward?: number;
  recurring?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  recurringDay?: number;
  attachments?: Attachment[];
};
type TrashedTodo = Todo & { trashedAt: number };
type IdeaDraft = {
  id?: number | string;
  projectName: string;
  summary: string;
  details: string[];
  tags: string[];
  subTab?: string;
  coinReward?: number;
  attachments?: Attachment[];
};
type ParseResult = { todos: TodoDraft[]; ideas: IdeaDraft[] };
type Pending = { todos: (TodoDraft & { id: string; done: false })[]; ideas: (IdeaDraft & { id: string })[] };
type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };
type Tab = 'memo' | 'todo' | 'idea' | 'zukan' | 'settings';
type Attachment = { id: string; name: string; mime: string; data: string };
type MemoHistoryItem = { id: number; text: string; savedAt: number; attachments?: Attachment[] };
type TodoSetItem = { title: string; tags: string[]; coinReward?: number; };
type TodoSet = { id: string; name: string; items: TodoSetItem[]; createdAt: number; mtime?: number; };

// ─────────────────────────────────────────────────────────────
// App version — bump on every change (see CLAUDE.md versioning rule)
//   patch: バグ修正 / minor: 機能追加 / major: 破壊的変更
//   PWA (vite-plugin-pwa) がビルドごとにキャッシュを自動更新する
// ─────────────────────────────────────────────────────────────
const APP_VERSION = '1.40.2';

// ─────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────
const LS_TODOS    = 'smartmemo:todos';
const LS_IDEAS    = 'smartmemo:ideas';
const LS_SETTINGS = 'smartmemo:settings';
const LS_TRASH    = 'smartmemo:trash';
const LS_DELETIONS = 'smartmemo:deletions';
// サーバに deleted_ids 列が無いときの案内。
// 列が無くても削除の記録は settings 列に間借りして同期されるので、
// 動作に支障は無い。あくまで「本来の形ではない」ことの通知に留める。
const DELETED_IDS_NOTICE = `サーバに deleted_ids 列が無いため、削除の記録を settings 列に入れて同期しています。
同期は正常に動いており、そのままお使いいただけます。

本来の形にするには、Supabase で user_data テーブルに次の列を追加してください。
  列名: deleted_ids / 型: jsonb / 既定値: {}
Table Editor の「New column」からでも追加できます。

追加したあと下の「送信」を押すと、この端末で再確認します。`;

// 墓標の保持期間。これを過ぎたら捨てる（無限に増えないように）。
const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
function pruneTombstones(t: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t || {})) if (Number(v) >= cutoff) out[k] = Number(v);
  return out;
}
const LS_TODO_SETS = 'smartmemo:todosets';

// AI プロバイダの API キーは端末ローカルにだけ置く。クラウドへ送ると
// user_data.settings の jsonb 列に平文で残り、DB のバックアップやダッシュボード
// にも露出してしまう。送信前・受信後の両方でこのキーを落とす。
const SECRET_SETTING_KEYS = ['geminiApiKey', 'openaiApiKey', 'anthropicApiKey'] as const;
function stripSecretSettings(s: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...((s as Record<string, unknown>) || {}) };
  for (const k of SECRET_SETTING_KEYS) delete out[k];
  return out;
}

function loadStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
// 保存失敗のトーストは連発しがち（複数キーが同時にあふれる）なので間引く
let lastSaveFailAt = 0;
function saveStored<T>(key: string, value: T): void {
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
const SMARTMEMO_PREFIX = 'smartmemo:';
const BACKUP_VERSION = 1;

function collectSmartmemoKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(SMARTMEMO_PREFIX)) keys.push(k);
  }
  return keys;
}

function exportAllData(): void {
  const data: Record<string, unknown> = {};
  for (const key of collectSmartmemoKeys()) {
    const raw = localStorage.getItem(key);
    if (raw == null) continue;
    try { data[key] = JSON.parse(raw); }
    catch { data[key] = raw; }
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

async function importAllData(file: File): Promise<{ ok: boolean; msg: string }> {
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

// ─────────────────────────────────────────────────────────────
// Gemini API integration
// ─────────────────────────────────────────────────────────────
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

async function callGemini(apiKey: string, parts: GeminiPart[]): Promise<string> {
  if (!apiKey) throw new Error('no_api_key');
  const res = await fetch(GEMINI_URL(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Gemini ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
const callGeminiText = (key: string, text: string) =>
  callGemini(key, [{ text }]);
const callGeminiVision = (key: string, prompt: string, base64: string, mime: string) =>
  callGemini(key, [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }]);
const callGeminiAudio = (key: string, base64: string, mime: string) =>
  callGemini(key, [
    { text: '以下の音声を日本語で文字起こししてください。テキストのみを返してください。' },
    { inline_data: { mime_type: mime, data: base64 } },
  ]);

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(((r.result as string) || '').split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ─────────────────────────────────────────────────────────────
// Unified AI layer — Gemini / OpenAI(GPT) / Anthropic(Claude)
// ─────────────────────────────────────────────────────────────
type AiProvider = 'gemini' | 'openai' | 'anthropic';
type AiCfg = {
  provider: AiProvider;
  geminiKey: string;
  openaiKey: string;
  anthropicKey: string;
  anthropicModel: string;
};

const OPENAI_TEXT_MODEL = 'gpt-4o-mini';
// Claude はモデルを設定画面でテキスト指定できる。未指定時はこれをデフォルトに使う。
const ANTHROPIC_TEXT_MODEL = 'claude-haiku-4-5';
const OPENAI_AUDIO_MODEL = 'whisper-1';

const AI_LABEL: Record<AiProvider, string> = { gemini: 'Gemini', openai: 'GPT (OpenAI)', anthropic: 'Claude (Anthropic)' };

function aiCfgFromSettings(s: { aiProvider?: AiProvider; geminiApiKey?: string; openaiApiKey?: string; anthropicApiKey?: string; anthropicModel?: string }): AiCfg {
  return {
    provider: s.aiProvider || 'gemini',
    geminiKey: s.geminiApiKey || '',
    openaiKey: s.openaiApiKey || '',
    anthropicKey: s.anthropicApiKey || '',
    anthropicModel: (s.anthropicModel || '').trim() || ANTHROPIC_TEXT_MODEL,
  };
}
function aiActiveKey(cfg: AiCfg): string {
  return cfg.provider === 'openai' ? cfg.openaiKey : cfg.provider === 'anthropic' ? cfg.anthropicKey : cfg.geminiKey;
}
function aiConfigured(cfg: AiCfg): boolean {
  return !!aiActiveKey(cfg);
}
// 音声の直接文字起こしに対応するのは Gemini / OpenAI(Whisper) のみ。
function aiAudioSupported(cfg: AiCfg): boolean {
  return (cfg.provider === 'gemini' && !!cfg.geminiKey) || (cfg.provider === 'openai' && !!cfg.openaiKey);
}

// ── OpenAI (GPT) ──
async function callOpenAIChat(key: string, content: any): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: OPENAI_TEXT_MODEL, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    let d = ''; try { d = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`OpenAI ${res.status}${d ? ': ' + d : ''}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
async function callOpenAIAudio(key: string, blob: Blob, mime: string): Promise<string> {
  const ext = mime.includes('mp4') || mime.includes('aac') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', blob, `audio.${ext}`);
  form.append('model', OPENAI_AUDIO_MODEL);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    let d = ''; try { d = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`OpenAI(Whisper) ${res.status}${d ? ': ' + d : ''}`);
  }
  const data = await res.json();
  return data.text || '';
}

// ── Anthropic (Claude) ──
async function callAnthropicMessages(key: string, content: any, model?: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    // メモ全体を1回で解析するため出力が長くなりうる。JSON が途中で切れると
    // 解析に失敗してローカル解析へ落ちてしまうので上限に余裕を持たせる。
    body: JSON.stringify({ model: (model || '').trim() || ANTHROPIC_TEXT_MODEL, max_tokens: 8192, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    let d = ''; try { d = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Anthropic ${res.status}${d ? ': ' + d : ''}`);
  }
  const data = await res.json();
  return (Array.isArray(data.content) ? data.content.map((c: any) => c?.text || '').join('') : '') || '';
}

// ── Unified entry points ──
async function aiText(cfg: AiCfg, prompt: string): Promise<string> {
  const key = aiActiveKey(cfg);
  if (!key) throw new Error('no_api_key');
  if (cfg.provider === 'openai')    return callOpenAIChat(key, prompt);
  if (cfg.provider === 'anthropic') return callAnthropicMessages(key, [{ type: 'text', text: prompt }], cfg.anthropicModel);
  return callGeminiText(key, prompt);
}
async function aiVision(cfg: AiCfg, prompt: string, base64: string, mime: string): Promise<string> {
  const key = aiActiveKey(cfg);
  if (!key) throw new Error('no_api_key');
  if (cfg.provider === 'openai') {
    return callOpenAIChat(key, [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
    ]);
  }
  if (cfg.provider === 'anthropic') {
    return callAnthropicMessages(key, [
      { type: 'text', text: prompt },
      { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
    ], cfg.anthropicModel);
  }
  return callGeminiVision(key, prompt, base64, mime);
}
async function aiAudio(cfg: AiCfg, blob: Blob, mime: string): Promise<string> {
  if (cfg.provider === 'openai') {
    if (!cfg.openaiKey) throw new Error('no_api_key');
    return callOpenAIAudio(cfg.openaiKey, blob, mime);
  }
  if (cfg.provider === 'gemini') {
    if (!cfg.geminiKey) throw new Error('no_api_key');
    const base64 = await blobToBase64(blob);
    return callGeminiAudio(cfg.geminiKey, base64, mime);
  }
  throw new Error('audio_unsupported');
}

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES  = 3 * 1024 * 1024; // 3 MB for non-image files
// 画像は compressImage で縮小するので上限は緩めでよいが、無制限だと
// 縮小前の data URL 化（元サイズの約 1.33 倍の文字列）でタブが落ちる。
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function compressImage(dataUrl: string, maxW = 1400): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      (canvas.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────
// Attachment preview helpers
// ─────────────────────────────────────────────────────────────
function dataUrlToObjectUrl(dataUrl: string, mime: string): string {
  const b64 = dataUrl.split(',')[1] || '';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}

function getLinkLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url.length > 28 ? url.slice(0, 28) + '…' : url; }
}

// ─────────────────────────────────────────────────────────────
// Unified Attachment Lightbox (image / PDF / text)
// ─────────────────────────────────────────────────────────────
function AttachmentLightbox({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  useDismissable(onClose);
  const [blobUrl,     setBlobUrl]     = useState('');
  const [textContent, setTextContent] = useState('');
  const isImage = attachment.mime.startsWith('image/');
  const isPdf   = attachment.mime === 'application/pdf';
  const isText  = (attachment.mime === 'text/plain' || attachment.mime === 'text/csv');

  useEffect(() => {
    if (isPdf) {
      const url = dataUrlToObjectUrl(attachment.data, attachment.mime);
      setBlobUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (isText) {
      try { setTextContent(atob(attachment.data.split(',')[1] || '')); }
      catch { setTextContent('テキストの読み込みに失敗しました'); }
    }
  }, [attachment.id]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-header" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <span className="lightbox-name">{attachment.name}</span>
        <div style={{ display:'flex', gap:8 }}>
          {(isPdf || isText) && (
            <button className="lightbox-dl-btn" onClick={() => downloadFile(attachment)} title="ダウンロード">↓</button>
          )}
          <button className="lightbox-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className={`lightbox-body${isText ? ' text' : ''}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {isImage && <img src={attachment.data} alt={attachment.name} className="lightbox-img" />}
        {isPdf && blobUrl && <iframe src={blobUrl} className="lightbox-iframe" title={attachment.name} />}
        {isText && <pre className="lightbox-text">{textContent}</pre>}
      </div>
    </div>
  );
}

function downloadFile(a: Attachment) {
  const el = document.createElement('a');
  el.href = a.data; el.download = a.name;
  document.body.appendChild(el); el.click(); document.body.removeChild(el);
}

// ─────────────────────────────────────────────────────────────
// Attachment Section (reusable in modals)
// ─────────────────────────────────────────────────────────────
function canPreview(mime: string) {
  return mime.startsWith('image/') || mime === 'application/pdf' || mime === 'text/plain' || mime === 'text/csv';
}

function openOrPreview(a: Attachment, setLightbox: (a: Attachment) => void) {
  if (a.mime === 'text/x-url') { window.open(a.data, '_blank'); return; }
  if (canPreview(a.mime)) { setLightbox(a); return; }
  downloadFile(a);
}

function attFileIco(mime: string): string {
  if (mime === 'application/pdf') return '📕';
  if (mime === 'text/csv') return '📊';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  return '📄';
}

function AttachmentSection({ attachments, onChange, toast }: {
  attachments: Attachment[];
  onChange: (a: Attachment[]) => void;
  toast?: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [lightbox,       setLightbox]       = useState<Attachment | null>(null);
  const [showLinkInput,  setShowLinkInput]  = useState(false);
  const [linkUrl,        setLinkUrl]        = useState('');

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) { toast?.('添付ファイルは最大5件です'); return; }
    const toAdd: Attachment[] = [];
    for (const file of files.slice(0, remaining)) {
      const isImage = file.type.startsWith('image/');
      const limit   = isImage ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      if (file.size > limit) {
        toast?.(`${file.name} はサイズが大きすぎます（最大${isImage ? '20' : '3'}MB）`); continue;
      }
      const raw = await readFileAsDataUrl(file);
      const data = isImage ? await compressImage(raw) : raw;
      toAdd.push({ id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: file.name, mime: file.type, data });
    }
    if (toAdd.length) onChange([...attachments, ...toAdd]);
  }

  function addLink() {
    const raw = linkUrl.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    const label = getLinkLabel(url);
    onChange([...attachments, { id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: label, mime: 'text/x-url', data: url }]);
    setLinkUrl(''); setShowLinkInput(false);
  }

  const canAdd = attachments.length < MAX_ATTACHMENTS;

  return (
    <div className="modal-field">
      <label>添付ファイル・リンク</label>
      {lightbox && <AttachmentLightbox attachment={lightbox} onClose={() => setLightbox(null)} />}
      <div className="attachment-list">
        {attachments.map(a => (
          <div key={a.id} className="attachment-chip">
            {a.mime.startsWith('image/')
              ? <img src={a.data} className="attachment-thumb" onClick={() => openOrPreview(a, setLightbox)} alt={a.name} />
              : a.mime === 'text/x-url'
              ? (
                <div className="attachment-link-chip" onClick={() => window.open(a.data, '_blank')}>
                  <span className="attachment-file-ico">🔗</span>
                  <span className="attachment-file-label">{a.name || getLinkLabel(a.data)}</span>
                </div>
              )
              : (
                <div className="attachment-file-chip" onClick={() => openOrPreview(a, setLightbox)}>
                  <span className="attachment-file-ico">{attFileIco(a.mime)}</span>
                  <span className="attachment-file-label">{a.name}</span>
                  {canPreview(a.mime) && <span className="attachment-preview-badge">プレビュー</span>}
                </div>
              )
            }
            <button className="attachment-remove" onClick={() => onChange(attachments.filter(x => x.id !== a.id))}>✕</button>
          </div>
        ))}
        {canAdd && (
          <button className="attachment-add-btn" onClick={() => fileRef.current?.click()}>
            <span className="attachment-add-ico">📎</span>
            <span className="attachment-add-label">ファイル</span>
          </button>
        )}
        {canAdd && !showLinkInput && (
          <button className="attachment-add-btn" onClick={() => { setShowLinkInput(true); setTimeout(() => linkInputRef.current?.focus(), 50); }}>
            <span className="attachment-add-ico">🔗</span>
            <span className="attachment-add-label">リンク</span>
          </button>
        )}
      </div>
      {showLinkInput && (
        <div className="attachment-link-input-row">
          <input ref={linkInputRef} type="url" className="attachment-link-url" placeholder="https://..."
            value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => {
              if (e.key === 'Enter') addLink();
              // 伝播を止めないと、この入力欄を閉じるつもりの Escape で
              // 外側のモーダルまで閉じてしまう（useDismissable が window で拾うため）
              if (e.key === 'Escape') { e.stopPropagation(); setShowLinkInput(false); setLinkUrl(''); }
            }} />
          <button className="attachment-link-confirm" onClick={addLink}>追加</button>
          <button className="attachment-link-cancel" onClick={() => { setShowLinkInput(false); setLinkUrl(''); }}>✕</button>
        </div>
      )}
      <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFiles} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Attachment thumbnails row (shown in todo/idea list items)
// ─────────────────────────────────────────────────────────────
function AttachmentRow({ attachments }: { attachments: Attachment[] }) {
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  if (!attachments || !attachments.length) return null;
  const imgs  = attachments.filter(a => a.mime.startsWith('image/'));
  const files = attachments.filter(a => !a.mime.startsWith('image/') && a.mime !== 'text/x-url');
  const links = attachments.filter(a => a.mime === 'text/x-url');
  return (
    <div className="attachment-row">
      {lightbox && <AttachmentLightbox attachment={lightbox} onClose={() => setLightbox(null)} />}
      {imgs.slice(0, 3).map(a => (
        <img key={a.id} src={a.data} className="attachment-row-thumb" alt={a.name}
          onClick={e => { e.stopPropagation(); setLightbox(a); }} />
      ))}
      {imgs.length > 3 && <span className="attachment-row-more">+{imgs.length - 3}</span>}
      {files.slice(0, 2).map(a => (
        <span key={a.id} className="attachment-row-file" onClick={e => { e.stopPropagation(); openOrPreview(a, setLightbox); }}>
          {attFileIco(a.mime)} {a.name}
        </span>
      ))}
      {links.slice(0, 2).map(a => (
        <span key={a.id} className="attachment-row-link" onClick={e => { e.stopPropagation(); window.open(a.data, '_blank'); }}>
          🔗 {a.name || getLinkLabel(a.data)}
        </span>
      ))}
    </div>
  );
}

// Sound types for task completion.
// File-based sounds (mp3 in public/sounds). key → 表示ラベル / ファイル名。
const FILE_SOUNDS: Record<string, { label: string; file: string }> = {
  'snd_level_up':   { label: '🆙 レベルアップ',       file: 'level-up.mp3' },
  'snd_trumpet':    { label: '📯 ラッパ',             file: 'trumpet-fanfare.mp3' },
  'snd_decision4':  { label: '✅ 決定音 A',           file: 'decision-4.mp3' },
  'snd_decision12': { label: '✅ 決定音 B',           file: 'decision-12.mp3' },
  'snd_decision13': { label: '✅ 決定音 C',           file: 'decision-13.mp3' },
  'snd_decision16': { label: '✅ 決定音 D',           file: 'decision-16.mp3' },
  'snd_decision17': { label: '✅ 決定音 E',           file: 'decision-17.mp3' },
  'snd_men_yay':    { label: '🙌 男衆「イエーイ！」', file: 'men-yay.mp3' },
  'snd_men_yahoo':  { label: '🙌 男衆「イヤッホー！」', file: 'men-yahoo.mp3' },
  'snd_men_ou':     { label: '🙌 男衆「オウ！」',     file: 'men-ou.mp3' },
  'snd_women_ou':   { label: '🙌 女衆「おう！」',     file: 'women-ou.mp3' },
};
const SOUND_FILE_BASE = `${import.meta.env.BASE_URL}sounds/`;

const SOUND_TYPES = [
  { key: 'doremi',   label: 'ドレミ' },
  { key: 'pop',      label: 'ポップ' },
  { key: 'chime',    label: 'チャイム' },
  { key: 'coin',     label: 'コイン' },
  { key: 'mario',    label: '🍄 マリオ' },
  { key: '8bit',     label: '🎮 8ビット' },
  { key: 'bell',     label: '🎶 ベル' },
  { key: 'fanfare',  label: '🎺 ファンファーレ' },
  { key: 'special',  label: '🎵 特製メロディ' },
  ...Object.entries(FILE_SOUNDS).map(([key, v]) => ({ key, label: v.label })),
];
// 最初から選べるサウンド。これ以外はガチャで当ててから選択可能になる。
const DEFAULT_SOUNDS = ['doremi'];
let _audioCtx: AudioContext | undefined;
function _getAudioCtx(): AudioContext {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  if (!_audioCtx) _audioCtx = new Ctx();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
// Cache <audio> elements per file sound to avoid re-fetching.
const _audioCache: Record<string, HTMLAudioElement> = {};
function playSound(type: string) {
  const fileSound = FILE_SOUNDS[type];
  if (fileSound) {
    try {
      let el = _audioCache[type];
      if (!el) {
        el = new Audio(SOUND_FILE_BASE + fileSound.file);
        el.preload = 'auto';
        _audioCache[type] = el;
      }
      el.currentTime = 0;
      el.play().catch(() => {});
    } catch {}
    return;
  }
  try {
    const ctx = _getAudioCtx();
    const now = ctx.currentTime;
    if (type === 'pop') {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'chime') {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = now + i * 0.12;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.45);
      });
    } else if (type === 'coin') {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(988, now);
      osc.frequency.exponentialRampToValueAtTime(1319, now + 0.06);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.16);
    } else if (type === 'fanfare') {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        const t = now + i * 0.09;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.4);
      });
    } else if (type === 'mario') {
      // Classic coin: square wave step up (B5 → E6)
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(988, now);
      osc.frequency.setValueAtTime(1319, now + 0.075);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now); osc.stop(now + 0.3);
    } else if (type === '8bit') {
      // Chiptune ascending arpeggio
      [261.63, 329.63, 392, 523.25].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'square'; osc.frequency.value = freq;
        const t = now + i * 0.05;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.07);
      });
    } else if (type === 'bell') {
      // Bell with rich harmonics
      [880, 1760, 2640].forEach((freq, j) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const amp = [0.16, 0.07, 0.03][j];
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(amp, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now); osc.stop(now + 1.0);
      });
    } else if (type === 'special') {
      [523.25, 659.25, 783.99, 880, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        const t = now + i * 0.09;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.45);
      });
    } else {
      // doremi (default)
      [659.25, 987.77].forEach((freq, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = now + i * 0.07;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.27);
      });
    }
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// モーダル・シートを「閉じられるもの」にする
//
// これが無いと、モーダルを開いた状態で Android の戻るボタンを押したときに
// モーダルではなく PWA 自体が終了し、書きかけの内容が失われる。
// 開いている間だけ履歴エントリを 1 つ積み、閉じるときに取り除く。
// Escape キーでの閉じる操作もここでまとめて面倒を見る。
//
// 使い方: モーダルのコンポーネント先頭で useDismissable(onClose) を呼ぶ。
// 「マウントされている＝開いている」前提なので、開閉フラグは渡さない。
// ─────────────────────────────────────────────────────────────
type DismissEntry = { close: () => void };
// 開いているモーダルのスタック。閉じるのは常に最前面だけ。
const dismissStack: DismissEntry[] = [];
// UI から閉じるときは自分で history.back() を呼んで積んだエントリを取り除くが、
// その戻りで発生する popstate は「ユーザーが戻るを押した」わけではないので握りつぶす。
let suppressPop = 0;
let dismissGlobalsInstalled = false;

// popstate と Escape のリスナーは、アプリの生存期間を通じて 1 本だけ張る。
// モーダルごとに付け外しすると、最後のモーダルを閉じた直後に飛んでくる
// popstate を受け取る者が誰もいなくなり、suppressPop が減らないまま残って
// 次の「戻る」を食ってしまう。
function installDismissGlobals() {
  if (dismissGlobalsInstalled) return;
  dismissGlobalsInstalled = true;
  window.addEventListener('popstate', () => {
    if (suppressPop > 0) { suppressPop--; return; }
    dismissStack[dismissStack.length - 1]?.close();
  });
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // 入力欄など内側の Escape 処理が stopPropagation していれば ここには来ない
    if (e.key !== 'Escape') return;
    dismissStack[dismissStack.length - 1]?.close();
  });
}

function useDismissable(onClose: () => void) {
  const entryRef = useRef<DismissEntry>({ close: onClose });
  entryRef.current.close = onClose;

  useEffect(() => {
    installDismissGlobals();
    const entry = entryRef.current;
    dismissStack.push(entry);
    const depth = dismissStack.length;
    window.history.pushState({ smModal: depth }, '');

    return () => {
      const i = dismissStack.indexOf(entry);
      if (i >= 0) dismissStack.splice(i, 1);
      // 戻るボタンで閉じたなら、自分のエントリは既に消費されている。
      // 現在の履歴の深さを見て、まだ残っているときだけ取り除く。
      // （入れ子のとき、内側を戻るで閉じた直後は state が外側のものになる）
      const cur = (window.history.state as { smModal?: number } | null)?.smModal ?? 0;
      if (cur >= depth) { suppressPop++; window.history.back(); }
    };
  }, []);
}

// コンポーネントに切り出されていない、その場書きのモーダル用。
// フックは条件付きで呼べないので、開いている間だけマウントされる
// ラッパーとして包む。
function Dismissable({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useDismissable(onClose);
  return <>{children}</>;
}

// 永続化は useEffect で行う。setState の updater は純粋である必要があり、
// React 18 の並行レンダリングでは複数回呼ばれうるため、その中で
// localStorage へ書くと余計な書き込みが走る。
// 書き込みが 1 フレーム遅れるぶんは、pagehide / visibilitychange の
// flush（SmartMemoApp 内）が受け持つ。
function usePersistedState<T>(key: string, defaultValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => loadStored(key, defaultValue));
  useEffect(() => { saveStored(key, state); }, [key, state]);
  return [state, setState];
}

const pad = (n: number) => String(n).padStart(2, '0');
const today = new Date();
const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = formatDate(today);

// Returns the calendar date range used to PLACE a todo:
//  - Done todos: their completion date (single day). Falls back to end/start
//    for legacy items completed before completedAt was tracked.
//  - Open todos: their startDate ~ endDate range.
//  - No date at all: null (rendered in the undated section).
function todoDisplayRange(t: Todo): { start: string; end: string } | null {
  if (t.done) {
    if (t.completedAt) return { start: t.completedAt, end: t.completedAt };
    if (t.endDate)     return { start: t.endDate,     end: t.endDate };
    if (t.startDate)   return { start: t.startDate,   end: t.startDate };
    return null;
  }
  if (!t.startDate) return null;
  return { start: t.startDate, end: t.endDate || t.startDate };
}
const MONTH_JP = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const DOW = ['日','月','火','水','木','金','土'];
const JP_HOLIDAYS = new Set([
  // 2024
  '2024-01-01','2024-01-08','2024-02-11','2024-02-12','2024-02-23',
  '2024-03-20','2024-04-29','2024-05-03','2024-05-04','2024-05-05','2024-05-06',
  '2024-07-15','2024-08-11','2024-08-12','2024-09-16','2024-09-22','2024-09-23',
  '2024-10-14','2024-11-03','2024-11-04','2024-11-23',
  // 2025
  '2025-01-01','2025-01-13','2025-02-11','2025-02-23','2025-02-24',
  '2025-03-20','2025-04-29','2025-05-03','2025-05-04','2025-05-05','2025-05-06',
  '2025-07-21','2025-08-11','2025-09-15','2025-09-23',
  '2025-10-13','2025-11-03','2025-11-23','2025-11-24',
  // 2026
  '2026-01-01','2026-01-12','2026-02-11','2026-02-23',
  '2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06',
  '2026-07-20','2026-08-11','2026-09-21','2026-09-23',
  '2026-10-12','2026-11-03','2026-11-23',
  // 2027
  '2027-01-01','2027-01-11','2027-02-11','2027-02-23',
  '2027-03-21','2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05',
  '2027-07-19','2027-08-11','2027-09-20','2027-09-23',
  '2027-10-11','2027-11-03','2027-11-23',
]);
type HolidayConfig = { weekends: boolean; jpHolidays: boolean; custom: string[] };
const BUILTIN_TODO_TAGS = ['買い物','仕事','家事','健康','勉強','その他'];
const BUILTIN_IDEA_TAGS = ['アイデア','買い物','仕事','家事','健康','勉強','その他'];
const IDEA_TAG = 'アイデア';
const getTodoTagOptions = (customTags?: string[]) =>
  [...BUILTIN_TODO_TAGS, ...((customTags || []).filter(t => !BUILTIN_IDEA_TAGS.includes(t)))];
const getIdeaTagOptions = (customTags?: string[]) =>
  [...BUILTIN_IDEA_TAGS, ...((customTags || []).filter(t => !BUILTIN_IDEA_TAGS.includes(t)))];

const COLOR_PRESETS = [
  { name:'オレンジ',   value:'#D4622A', light:'rgba(212,98,42,.10)',  text:'#fff' },
  { name:'インディゴ', value:'#4A52C8', light:'rgba(74,82,200,.10)',  text:'#fff' },
  { name:'グリーン',   value:'#2A8C5A', light:'rgba(42,140,90,.10)',  text:'#fff' },
  { name:'ローズ',     value:'#C43660', light:'rgba(196,54,96,.10)',  text:'#fff' },
  { name:'スレート',   value:'#475569', light:'rgba(71,85,105,.10)',  text:'#fff' },
];
const FONT_SIZE_OPTS = [
  { label:'小', base:'12px', sm:'11px', xs:'10px' },
  { label:'中', base:'14px', sm:'12px', xs:'11px' },
  { label:'大', base:'16px', sm:'14px', xs:'12px' },
];

const GACHA_COST = 50;
const GACHA_COST_TEN = 500;
const GACHA_COST_MON = 300;
const BG_PRESETS = [
  { name: 'デフォルト', bg: '#fafaf9' },
  { name: 'クリーム',   bg: '#fdf8f0' },
  { name: 'ミント',     bg: '#f0faf5' },
  { name: 'ラベンダー', bg: '#f5f0ff' },
  { name: 'スカイ',     bg: '#f0f7ff' },
  { name: 'ナイト',     bg: '#1a1a2e' },
  { name: 'ローズ',     bg: '#fff0f5' },
];
const GACHA_ITEMS: (GachaPrize & { weight: number })[] = [
  { type: 'sound', label: '🔔 チャイム',         rarity: 'common', stars: '★★',    color: '#777',    soundType: 'chime',   weight: 20, flavor: '澄んだチーン音。学校の授業終わりみたいな「終わった！」解放感を、タスク完了のたびに味わえる。' },
  { type: 'sound', label: '💥 ポップ',           rarity: 'common', stars: '★★',    color: '#777',    soundType: 'pop',     weight: 18, flavor: '弾けるポン！という音。地味なタスクも、これが鳴ればなんかちょっと楽しくなる気がする。テンションが確実に上がる。' },
  { type: 'sound', label: '🎮 8ビット',          rarity: 'common', stars: '★★',    color: '#777',    soundType: '8bit',    weight: 16, flavor: 'レトロゲームの効果音。思い出補正で妙に懐かしい気分になる。タスク完了がRPGのレベルアップ感覚になって、不思議と達成感が増す。' },
  { type: 'bg',    label: '🎨 クリーム背景',     rarity: 'common', stars: '★★',    color: '#c8860a', bgIdx: 1,             weight: 14, flavor: '温かみのあるクリーム色。コーヒーでも飲みながらゆっくりタスクを整理したい気分になる。肩の力が抜ける、落ち着く一枚。' },
  { type: 'sound', label: '🎹 ドレミ',           rarity: 'rare',   stars: '★★★',   color: '#2e7bef', soundType: 'doremi',  weight: 10, flavor: '音楽室のピアノみたいな音。繰り返し聞いても全然うるさくない。落ち着きとちゃんとした達成感が共存する、バランス型サウンド。' },
  { type: 'sound', label: '🪙 コイン音',         rarity: 'rare',   stars: '★★★',   color: '#2e7bef', soundType: 'coin',    weight: 8,  flavor: 'チャリン！とコインが積み上がる音。財布が重くなった気がしてくる（しない）。でもテンションは本当に上がるから不思議。' },
  { type: 'bg',    label: '🌿 ミント背景',       rarity: 'rare',   stars: '★★★',   color: '#27ae60', bgIdx: 2,             weight: 8,  flavor: '爽やかなミントグリーン。これを背景にすると、なぜか集中できる気がする。朝のTODOリストが清々しく見えてくる不思議な色。' },
  { type: 'bg',    label: '🌸 スカイ背景',       rarity: 'rare',   stars: '★★★',   color: '#1a88d0', bgIdx: 4,             weight: 6,  flavor: '晴れた空みたいな青。タスクがどれだけ詰まっていても、見上げるような開放感がある。前向きな気持ちになれる一枚。' },
  { type: 'sound', label: '🍄 マリオ音',         rarity: 'super',  stars: '★★★★',  color: '#e53935', soundType: 'mario',   weight: 5,  flavor: 'あのゲームのコイン取得音。脳が一瞬子どもに戻る感覚がある。「牛乳を買う」を完了しただけでも、なんかヒーローになった気分になれる。' },
  { type: 'sound', label: '🎺 ファンファーレ',   rarity: 'super',  stars: '★★★★',  color: '#9c27b0', soundType: 'fanfare', weight: 4,  flavor: '堂々たる鼓舞系サウンド。「ゴミ出し」が終わっただけで式典になる。それが案外、毎日のやる気に効く。' },
  { type: 'bg',    label: '💜 ラベンダー背景',   rarity: 'super',  stars: '★★★★',  color: '#8e24aa', bgIdx: 3,             weight: 4,  flavor: 'やわらかい紫に包まれると落ち着く。夜中に積み上がったTODOを眺めるのに不思議と向いている色。' },
  { type: 'bg',    label: '🌙 ナイト背景',       rarity: 'super',  stars: '★★★★',  color: '#546e7a', bgIdx: 5,             weight: 3,  flavor: '深夜の静けさを切り取ったような色合い。目が疲れにくく、集中力が増す感じがする。夜型の人間のためのモードかもしれない。' },
  { type: 'sound', label: '🎵 特製メロディ',     rarity: 'ultra',  stars: '★★★★★', color: '#ff6f00', soundType: 'special', weight: 2,  flavor: 'どこか懐かしく、でも初めて聞く不思議な旋律。落ち着きとワクワクが同居していて、長く使っていると愛着が湧いてくる。' },
  { type: 'sound', label: '🎶 ベル',             rarity: 'ultra',  stars: '★★★★★', color: '#e91e63', soundType: 'bell',    weight: 1,  flavor: '透き通ったベルの音は、雑念をすっと消してくれる。「やった」という純粋な感覚だけが残る。シンプルなのに一番気持ちいいかもしれない。' },
  { type: 'bg',      label: '🌅 ローズ背景', rarity: 'ultra', stars: '★★★★★', color: '#c2185b', bgIdx: 6,            weight: 1, flavor: '情熱的なローズレッド。これを見たら「やる気ない」とは言えなくなる。テンションをブチ上げたいときのための一枚。' },
  // ── ファイルベースのサウンド（public/sounds） ──
  { type: 'sound', label: '✅ 決定音 A', rarity: 'common', stars: '★★',    color: '#777',    soundType: 'snd_decision4',  weight: 14, flavor: 'カチッと押し込むような決定音。タスクに「終わり」の区切りを付けてくれる。事務的なようでいて、地味に気持ちいい定番系。' },
  { type: 'sound', label: '✅ 決定音 B', rarity: 'common', stars: '★★',    color: '#777',    soundType: 'snd_decision12', weight: 13, flavor: '軽快なクリック音。リズムよくタスクを片付けたい日にぴったり。テンポ重視派のための、すっきりした一音。' },
  { type: 'sound', label: '✅ 決定音 C', rarity: 'common', stars: '★★',    color: '#777',    soundType: 'snd_decision13', weight: 12, flavor: '短くシャープな確定音。迷いを断ち切るような潔さがある。サクサク進めたいときの相棒。' },
  { type: 'sound', label: '✅ 決定音 D', rarity: 'rare',   stars: '★★★',   color: '#2e7bef', soundType: 'snd_decision16', weight: 9,  flavor: 'やや厚みのある決定音。押した感がしっかりあって、「ちゃんと完了した」という手応えが残る。安心感のある中音域。' },
  { type: 'sound', label: '✅ 決定音 E', rarity: 'rare',   stars: '★★★',   color: '#2e7bef', soundType: 'snd_decision17', weight: 7,  flavor: '少し高めの澄んだ確定音。耳に残りすぎず、それでいて満足感はしっかり。繊細さを求める人向けの一音。' },
  { type: 'sound', label: '🆙 レベルアップ', rarity: 'super', stars: '★★★★',  color: '#e53935', soundType: 'snd_level_up',  weight: 4,  flavor: 'おなじみの「強くなった！」音。タスク一個でステータスが上がった気分になれる。日々の小さな完了が、成長の実感に変わる魔法のサウンド。' },
  { type: 'sound', label: '📯 ラッパ',       rarity: 'super', stars: '★★★★',  color: '#9c27b0', soundType: 'snd_trumpet',   weight: 4,  flavor: '高らかに鳴り響くラッパのファンファーレ。完了の瞬間が一気にイベント化する。地味な作業も晴れ舞台に変える、堂々の鳴り物。' },
  { type: 'sound', label: '🙌 男衆「イエーイ！」', rarity: 'super', stars: '★★★★', color: '#e53935', soundType: 'snd_men_yay',   weight: 3, flavor: '完了するたび、どこからともなく沸き起こる歓声。一人で作業していても、なぜか祭りの中にいる気分になれる。テンション爆上げ系。' },
  { type: 'sound', label: '🙌 男衆「イヤッホー！」', rarity: 'ultra', stars: '★★★★★', color: '#ff6f00', soundType: 'snd_men_yahoo', weight: 2, flavor: '抑えきれない喜びが炸裂する掛け声。ささいなTODO一つでこの盛り上がり。完了が病みつきになる、中毒性の高い一発。' },
  { type: 'sound', label: '🙌 男衆「オウ！」', rarity: 'rare',  stars: '★★★',   color: '#2e7bef', soundType: 'snd_men_ou',     weight: 6, flavor: '短く力強い「オウ！」の一声。気合いが注入される感じがする。淡々と片付けたい日でも、背中を押してくれる頼れる掛け声。' },
  { type: 'sound', label: '🙌 女衆「おう！」', rarity: 'rare',  stars: '★★★',   color: '#2e7bef', soundType: 'snd_women_ou',   weight: 6, flavor: 'はつらつとした「おう！」の返事。完了のたびに小気味よい合いの手が入る。リズムに乗ってタスクを進めたくなる、元気の出る一音。' },
  { type: 'memomon', label: '💀 ドクロン',  rarity: 'ultra', stars: '★★★★★', color: '#52575e', monDefId: 'skullon',  weight: 2, flavor: '【生態】骨格のみからなる謎のモンスター。食事の記録は一切なし。タップされても平気なふりをしているが、実はちゃんと感じている。おばけとは幼なじみ。' },
  { type: 'memomon', label: '💧 スライム', rarity: 'super',  stars: '★★★★',  color: '#0288d1', monDefId: 'slime',    weight: 3, flavor: '【生態】液体と固体の中間に存在する不思議な生命体。体温は常に室温と同じ。メモに触れると若干粘度が上がる。ノートのすみっこで寝ているのをよく目撃される。' },
  { type: 'memomon', label: '🐥 ひよこ',   rarity: 'super',  stars: '★★★★',  color: '#f9a825', monDefId: 'hiyoko',   weight: 3, flavor: '【生態】生後3日で自力でスマホを操作できる知能を持つ。鳴き声は「ぴよ」のみだが、抑揚で複雑な感情を表現する。タスクが増えるほど元気になる珍しい性質。' },
  { type: 'memomon', label: '👻 おばけ',      rarity: 'ultra', stars: '★★★★★', color: '#616161', monDefId: 'obake',       weight: 2, flavor: '【生態】体長不定（伸縮自在）。正体不明。ドクロンとは幼なじみで、二匹が揃うと謎のダンスを踊り始める報告がある。TODO画面に出没しやすい。' },
  { type: 'memomon', label: '🦊 ゆきぎつね', rarity: 'ultra', stars: '★★★★★', color: '#90caf9', monDefId: 'yukigitsune', weight: 2, flavor: '【生態】9本の尾を持つ幻の狐の末裔。目撃確率はメモモン中最低クラス。現れた日のタスク完了率が統計的に高いという報告がある。' },
  { type: 'memomon', label: '🐕 しばいぬ',   rarity: 'super', stars: '★★★★',  color: '#e65100', monDefId: 'shibainu',    weight: 3, flavor: '【生態】メモの数に比例して元気になる珍しい性質を持つ。一日にTODO一覧の端から端まで何十往復もする。尻尾は常に高速回転中。' },
  { type: 'memomon', label: '🎩 マジシャン', rarity: 'super', stars: '★★★★',  color: '#1565c0', monDefId: 'magician',    weight: 3, flavor: '【生態】青い三角帽子を絶対に脱がない。帽子の中に何が入っているかは未解明。使うマジックはすべてメモに関連しており、忘れていたタスクを突然思い出させることがある。' },
  { type: 'memomon', label: '🐉 ドラゴン',   rarity: 'ultra', stars: '★★★★★', color: '#37474f', monDefId: 'dragon',      weight: 2, flavor: '【生態】本来の姿は伝説の大型龍とされるが、スマホに収まるよう自ら縮んでいる。炎は吐けないが、代わりに完了済みTODOを丁寧に整理してくれる。一度懐くと絶対的な忠誠を誓う。' },
  { type: 'memomon', label: '🤖 パイラーくん', rarity: 'super', stars: '★★★★',  color: '#1976d2', monDefId: 'pylar',        weight: 3, flavor: '【生態】両腕の筋肉は飾りではない。積み上がったTODOを一つずつ片付けていく力がある。「いいね！」ポーズは彼の挨拶であり、励ましであり、存在証明でもある。' },
  { type: 'memomon', label: '🌱 めためたわかるもん', rarity: 'super', stars: '★★★★', color: '#6d9e3f', monDefId: 'matameta', weight: 3, flavor: '【生態】ころんと丸い黄色いからだに、頭のてっぺんから3本の緑の芽が生えている。「めためたわかる」が口癖で、何でも知ってそうな顔をしているが、実はよくわかっていないことも多い。知識をため込むほど芽がぐんぐん育つという噂がある。' },
  { type: 'memomon', label: '🦭 ゴマちゃん', rarity: 'super', stars: '★★★★', color: '#a1887f', monDefId: 'gomachan', weight: 3, flavor: '【生態】まんまる体型のゴマフアザラシ。背中のゴマ模様は本人いわく「個性の証」。寝姿が美しいことで有名で、メモアプリ内で最も眠っている時間が長いメモモン。タスクが片付くと嬉しそうにヒレをぱたぱた動かす。' },
  // ── 餌（消費アイテム）──
  { type: 'food', label: '🍞 パン',           rarity: 'common', stars: '★★',    color: '#a1887f', foodId: 'pan',    weight: 18, flavor: '焼きたてのパン。香ばしくて朝食にもぴったり。誰にでも好かれやすい基本の餌。' },
  { type: 'food', label: '🌿 ハーブ',         rarity: 'common', stars: '★★',    color: '#7cb342', foodId: 'herb',   weight: 16, flavor: 'さわやかな香りの野草。あっさり派のメモモンに好まれがち。' },
  { type: 'food', label: '🍎 りんご',         rarity: 'rare',   stars: '★★★',   color: '#e53935', foodId: 'apple',  weight: 9,  flavor: 'みずみずしく真っ赤に熟したりんご。シャクシャクした食感がやみつき。' },
  { type: 'food', label: '🍪 クッキー',       rarity: 'rare',   stars: '★★★',   color: '#bf8a3d', foodId: 'cookie', weight: 8,  flavor: '甘くて香ばしいクッキー。一度食べたら忘れられない素朴な味。' },
  { type: 'food', label: '🍣 寿司',           rarity: 'super',  stars: '★★★★',  color: '#e91e63', foodId: 'sushi',  weight: 3,  flavor: '職人が握った極上の寿司。海育ち・肉食系のメモモンは大喜び。' },
  { type: 'food', label: '🍰 ケーキ',         rarity: 'super',  stars: '★★★★',  color: '#ff8a3d', foodId: 'cake',   weight: 3,  flavor: 'ふわふわ生クリームのホールケーキ。お祝い感の出る一品。' },
  { type: 'food', label: '🍖 ステーキ',       rarity: 'ultra',  stars: '★★★★★', color: '#bf2922', foodId: 'steak',  weight: 1,  flavor: 'ジューシーで肉厚な極上ステーキ。力強いタイプのメモモンが歓喜する逸品。' },
  { type: 'food', label: '🌟 メモモンフード', rarity: 'ultra',  stars: '★★★★★', color: '#ffd700', foodId: 'feed',   weight: 1,  flavor: '研究の末に開発された秘伝のフード。栄養価満点、誰にでも合うとされる伝説の餌。' },
];
const BOSS_TODOS = [
  '今日のタスクを3つ完了させよ！',
  'メモを書いてAI解析してみよ！',
  'ナレッジを新しく1つ追加せよ！',
  'ガチャを1回引け！',
  'タスクを新しく追加してみよ！',
  '週表示でカレンダーを確認せよ！',
  '設定のサウンドを変えてみよ！',
];

// ─────────────────────────────────────────────────────────────
// MemoMon System
// ─────────────────────────────────────────────────────────────
const MON_SCALE = 4;
const KURONEKO_PIXELS = [
  '.CC......CC.',
  '.CCCC..CCCC.',
  '.CCCCCCCCCC.',
  'CCCCCCCCCCCC',
  'CC.EE..EE.CC',
  'CC.EE..EE.CC',
  'CCCCCCCCCCCC',
  'CC..CCCC..CC',
  '.CCCCCCCCCC.',
  '.CC......CC.',
  '..CC....CC..',
];
const SKULLON_PIXELS = [
  '....BB....BB....',
  '...BBBB..BBBB...',
  '...BGGGBBGGGB...',
  '..BGGGGGGGGGBB..',
  '.BBGGGGGGGGGGGB.',
  '.BGGG.BB..BBGGB.',
  '.BGGG.BB..BBGGB.',
  '.BGGGGGGGGGGGB..',
  '.BGGGGGGGGGGGB..',
  '.BGG.GG.GG.GGB..',
  '.BBB.BB.BB.BBB..',
  '..BBBBBBBBBBB...',
];
const KN_ANIMS = ['sit','walk','happy','dislike','sleep','surprise'] as const;
const KN_SPRITES: NonNullable<MemoMonDef['sprites']> = Object.fromEntries(
  KN_ANIMS.map(a => [a, {
    frames: Array.from({length:6}, (_, i) => `./sprites/kn_${a}_${i}.png`),
    fps:    a === 'walk' ? 8 : a === 'surprise' ? 7 : a === 'dislike' ? 6 : a === 'happy' ? 6 : 2,
    loop:   a === 'walk' || a === 'sit' || a === 'sleep',
  }])
) as NonNullable<MemoMonDef['sprites']>;

const SL_ANIMS = ['sit','walk','happy','dislike','sleep','surprise'] as const;
const SL_SPRITES: NonNullable<MemoMonDef['sprites']> = Object.fromEntries(
  SL_ANIMS.map(a => [a, {
    frames: Array.from({length:6}, (_, i) => `./sprites/sl_${a}_${i}.png`),
    fps:    a === 'walk' ? 8 : a === 'surprise' ? 7 : a === 'dislike' ? 6 : a === 'happy' ? 6 : 2,
    loop:   a === 'walk' || a === 'sit' || a === 'sleep',
  }])
) as NonNullable<MemoMonDef['sprites']>;

const MON_ANIMS = ['sit','walk','happy','dislike','sleep','surprise'] as const;
function makeSprites(prefix: string): NonNullable<MemoMonDef['sprites']> {
  return Object.fromEntries(
    MON_ANIMS.map(a => [a, {
      frames: Array.from({length:6}, (_, i) => `./sprites/${prefix}_${a}_${i}.png`),
      fps:    a === 'walk' ? 8 : a === 'surprise' ? 7 : a === 'dislike' ? 6 : a === 'happy' ? 6 : 2,
      loop:   a === 'walk' || a === 'sit' || a === 'sleep',
    }])
  ) as NonNullable<MemoMonDef['sprites']>;
}
const SK_SPRITES = makeSprites('sk');
const HY_SPRITES = makeSprites('hy');
const OB_SPRITES = makeSprites('ob');
const YF_SPRITES = makeSprites('yf');
const SB_SPRITES = makeSprites('sb');
const MJ_SPRITES = makeSprites('mj');
const DR_SPRITES = makeSprites('dr');
const PY_SPRITES = makeSprites('py');
const MT_SPRITES = makeSprites('mt');
const GM_SPRITES = makeSprites('gm');

const MEMOMON_DEFS: MemoMonDef[] = [
  {
    id: 'kuroneko', name: 'クロネコ',
    pixels: [], palette: {},
    rarity: 'ultra',
    desc: '真夜中のメモ画面に突如現れる謎の黒猫。足音はなく、影すら落とさない。タップされると一瞬だけ目を細めるが、それ以上しつこくすると全力で逃げる。どこから来てどこへ去るのか、いまだ解明されていない。',
    monW: 56, monH: 60,
    spriteFacing: 'l',
    sprites: KN_SPRITES,
  },
  {
    id: 'skullon', name: 'ドクロン',
    pixels: [], palette: {},
    rarity: 'ultra',
    desc: 'メモのすみっこに住む神出鬼没なドクロモンスター。タップすると逃げ出す。',
    monW: 66, monH: 60,
    spriteFacing: 'l',
    sprites: SK_SPRITES,
  },
  {
    id: 'slime', name: 'スライム',
    pixels: [], palette: {},
    rarity: 'super',
    desc: 'まるくてかわいいスライム。つるつるしてそう。タップされると喜ぶが、しつこいと怒って逃げる。',
    monW: 60, monH: 50,
    spriteFacing: 'l',
    sprites: SL_SPRITES,
  },
  {
    id: 'hiyoko', name: 'ひよこ',
    pixels: [], palette: {},
    rarity: 'super',
    desc: 'ちっちゃくてふわふわのひよこ。ぴよぴよ鳴く。',
    monW: 65, monH: 60,
    spriteFacing: 'l',
    sprites: HY_SPRITES,
  },
  {
    id: 'obake', name: 'おばけ',
    pixels: [], palette: {},
    rarity: 'ultra',
    desc: 'ふわふわ漂う謎のおばけ。ドクロンとは友達らしい。',
    monW: 65, monH: 60,
    spriteFacing: 'l',
    sprites: OB_SPRITES,
  },
  {
    id: 'yukigitsune', name: 'ゆきぎつね',
    pixels: [], palette: {},
    rarity: 'ultra',
    desc: '雪のように白い神秘の狐。現れると幸運が訪れるとか。',
    monW: 65, monH: 65,
    spriteFacing: 'l',
    sprites: YF_SPRITES,
  },
  {
    id: 'shibainu', name: 'しばいぬ',
    pixels: [], palette: {},
    rarity: 'super',
    desc: '元気いっぱいのしば犬。メモが増えるほど喜んでくれる。',
    monW: 65, monH: 60,
    spriteFacing: 'l',
    sprites: SB_SPRITES,
  },
  {
    id: 'magician', name: 'マジシャン',
    pixels: [], palette: {},
    rarity: 'super',
    desc: '青いとんがり帽子をかぶった謎のマジシャン。手品でメモをサプライズしてくれる。',
    monW: 65, monH: 65,
    spriteFacing: 'l',
    sprites: MJ_SPRITES,
  },
  {
    id: 'dragon', name: 'ドラゴン',
    pixels: [], palette: {},
    rarity: 'ultra',
    desc: '漆黒のドラゴン。めったに姿を現さないが、一度懐くと絶対的な忠誠を誓う。',
    monW: 65, monH: 65,
    spriteFacing: 'l',
    sprites: DR_SPRITES,
  },
  {
    id: 'pylar', name: 'パイラーくん',
    pixels: [], palette: {},
    rarity: 'super',
    desc: '青いボディのがっちり系マスコット。指を立てて「いいね！」をしてくれる頼れるやつ。',
    monW: 65, monH: 70,
    sprites: PY_SPRITES,
  },
  {
    id: 'matameta', name: 'めためたわかるもん',
    pixels: [], palette: {},
    rarity: 'super',
    desc: 'ころんと丸い黄色いからだに、頭のてっぺんから3本の緑の芽が生えている。「めためたわかる」が口癖で、何でも知ってそうな顔をしているが、実はよくわかっていないことも多い。知識をため込むほど芽がぐんぐん育つという噂がある。',
    monW: 65, monH: 70,
    spriteFacing: 'l',
    sprites: MT_SPRITES,
  },
  {
    id: 'gomachan', name: 'ゴマちゃん',
    pixels: [], palette: {},
    rarity: 'super',
    desc: 'ゴマ模様がチャームポイントのまんまるアザラシ。眠るのが大好きで、メモ画面でうとうとしているところをよく目撃される。',
    monW: 65, monH: 60,
    spriteFacing: 'l',
    sprites: GM_SPRITES,
  },
];

// ─────────────────────────────────────────────────────────────
// Foods & feeding system
// ─────────────────────────────────────────────────────────────
type Food = { id: string; emoji: string; name: string; grade: 1 | 2 | 3 | 4; cost: number };
const FOODS: Food[] = [
  { id: 'pan',    emoji: '🍞', name: 'パン',           grade: 1, cost: 30  },
  { id: 'herb',   emoji: '🌿', name: 'ハーブ',         grade: 1, cost: 30  },
  { id: 'apple',  emoji: '🍎', name: 'りんご',         grade: 2, cost: 80  },
  { id: 'cookie', emoji: '🍪', name: 'クッキー',       grade: 2, cost: 80  },
  { id: 'sushi',  emoji: '🍣', name: '寿司',           grade: 3, cost: 200 },
  { id: 'cake',   emoji: '🍰', name: 'ケーキ',         grade: 3, cost: 200 },
  { id: 'steak',  emoji: '🍖', name: 'ステーキ',       grade: 4, cost: 500 },
  { id: 'feed',   emoji: '🌟', name: 'メモモンフード', grade: 4, cost: 500 },
];

const MEMOMON_FOOD_PREFS: Record<string, { fav: string[]; dis: string[] }> = {
  kuroneko:    { fav: ['sushi'],          dis: ['herb'] },
  skullon:     { fav: ['steak'],          dis: ['cake'] },
  slime:       { fav: ['cake'],           dis: ['steak'] },
  hiyoko:      { fav: ['herb', 'apple'],  dis: ['sushi'] },
  obake:       { fav: ['feed'],           dis: ['pan'] },
  yukigitsune: { fav: ['sushi'],          dis: ['cookie'] },
  shibainu:    { fav: ['steak', 'cookie'], dis: ['herb'] },
  magician:    { fav: ['cookie'],         dis: ['pan'] },
  dragon:      { fav: ['steak', 'feed'],  dis: ['herb'] },
  pylar:       { fav: ['apple'],          dis: ['cake'] },
  matameta:    { fav: ['herb', 'apple'],  dis: ['sushi'] },
  gomachan:    { fav: ['sushi', 'cake'],  dis: ['cookie'] },
};

// Rare collectible items dropped by each memomon at affection MAX.
// One unique item per memomon. Tapping shows the comment.
type MemoMonItem = { id: string; defId: string; name: string; imageUrl: string; comment: string };
const MEMOMON_ITEMS: MemoMonItem[] = [
  { id: 'kuroneko_hairball',   defId: 'kuroneko',    name: '毛玉',             imageUrl: './items/kuroneko_hairball.png',   comment: 'クロネコがふと吐き出した毛玉。「持っていけ」と無造作にくれた。触ると意外と温かく、なぜか落ち着く。' },
  { id: 'slime_liquid',        defId: 'slime',       name: '謎の液体',          imageUrl: './items/slime_liquid.png',        comment: 'スライムが「すきー！」と言いながらくれた小瓶。きれいな色だが、何で出来ているかは本人にも分かっていない。' },
  { id: 'hiyoko_feather',      defId: 'hiyoko',      name: '羽',               imageUrl: './items/hiyoko_feather.png',      comment: 'ひよこの綿毛のような、ふわふわで小さな羽。お守りにすると、ちょっとだけ気分が軽くなるらしい。' },
  { id: 'skullon_bone',        defId: 'skullon',     name: 'どこかの骨',         imageUrl: './items/skullon_bone.png',        comment: 'ドクロンが「我のものか不明だが、汝にやろう」と差し出した謎の骨。振ると「カラカラ」と乾いた音がする。' },
  { id: 'obake_skin',          defId: 'obake',       name: 'ぬけがら',          imageUrl: './items/obake_skin.png',          comment: 'おばけが脱皮（？）してできた半透明のぬけがら。ふわふわ漂うが、触ると微かにくすぐったい。' },
  { id: 'yukigitsune_acorn',   defId: 'yukigitsune', name: 'どんぐり',           imageUrl: './items/yukigitsune_acorn.png',   comment: 'ゆきぎつねが九尾でくるくる転がして遊んでいたどんぐり。手のひらサイズの幸運の象徴とされる。' },
  { id: 'shibainu_tooth',      defId: 'shibainu',    name: '乳歯',             imageUrl: './items/shibainu_tooth.png',      comment: 'しばいぬが「もう要らないわん！」と元気にくれた乳歯。成長の証。すこし誇らしげな表情で渡された。' },
  { id: 'dragon_claw',         defId: 'dragon',      name: '爪',               imageUrl: './items/dragon_claw.png',         comment: 'ドラゴンが脱皮の時に落とした漆黒の爪。鋭く頑丈で、お守りとしては最強クラスらしい。' },
  { id: 'pylar_gbadge',        defId: 'pylar',       name: 'Gバッチ',          imageUrl: './items/pylar_gbadge.png',        comment: '「Good!」のG。パイラーくんが「君にあげるぜ！」と渡してくれた金色のバッチ。胸につけると元気が湧いてくる（気がする）。' },
  { id: 'matameta_sheet',      defId: 'matameta',    name: 'めたしこうしーと',    imageUrl: './items/matameta_sheet.png',      comment: 'めためたが頭の芽の中から取り出した「めたしこうしーと」。何やら深そうな知識が書かれているが、めためた本人もよくわかっていないらしい。' },
  { id: 'gomachan_shell',      defId: 'gomachan',    name: '貝殻',             imageUrl: './items/gomachan_shell.png',      comment: 'ごまちゃんが夢の中で拾ってきた（と本人は言い張る）貝殻。耳に当てると、海の音がする…気がする。' },
  { id: 'magician_wand',       defId: 'magician',    name: 'ステッキ',          imageUrl: './items/magician_wand.png',       comment: 'マジシャンの予備のステッキ。振ると「アブラカタブラ」と微かに聞こえる気がする。本物の魔法は使えないので注意。' },
];
const ITEM_BY_DEFID: Record<string, MemoMonItem> = Object.fromEntries(MEMOMON_ITEMS.map(i => [i.defId, i]));
const ITEM_BY_ID: Record<string, MemoMonItem> = Object.fromEntries(MEMOMON_ITEMS.map(i => [i.id, i]));

// Drop chances when affection is at MAX (100)
const ITEM_DROP_CHANCE_PET = 0.05;     // 5% on pet (rare gift item)
const ITEM_DROP_CHANCE_FEED_FAV = 0.10; // 10% on favorite food (rare gift item)

// Basic bg/sound drops at MAX affection (fires when the gift drop didn't)
const BONUS_DROP_CHANCE_PET = 0.50;     // 50% on pet
const BONUS_DROP_CHANCE_FEED_FAV = 0.80; // 80% on favorite food

// Hunger decays 10 points per hour regardless of whether the mon is displayed
// (the mon gets hungry just by existing)
const HUNGER_DECAY_PER_HOUR = 10;

// なつき度は時間経過では下がらない。にわに出していない間も維持される。
// （以前は lastSeenAt からの経過時間で 4 時間ごとに 1 減っていた）
// 第2引数は呼び出し側の互換のために残している。
function effectiveAffection(mon: MemoMonInstance, _now: number = Date.now()): number {
  return Math.max(0, Math.min(100, mon.affection ?? 0));
}

// ── 庭のメモモンのおねだり ──
const MON_REQUEST_INTERVAL_MS = 20 * 60 * 1000; // 前回応えてから次のおねだりまで
const MON_REQUEST_AFFECTION = 3;                // 応えたときのなつき度上昇
const MON_REQUEST_COINS = 5;                    // 応えたときのコイン
const MON_REQUEST_FEED_HUNGER = 25;             // ごはんの要求に応えたときの満腹度回復
const MON_REQUEST_INFO: Record<MonRequestKind, { emoji: string; label: string; done: string }> = {
  food:   { emoji: '🍚', label: 'おなかすいた！', done: 'ごはんをあげた' },
  toilet: { emoji: '🚽', label: 'トイレ…！',      done: 'トイレをきれいにした' },
  play:   { emoji: '🎾', label: 'あそんで！',      done: 'いっしょに遊んだ' },
};
// お腹が空いているときは「ごはん」を出しやすくする
function pickMonRequest(hunger: number): MonRequestKind {
  if (hunger < 40 && Math.random() < 0.7) return 'food';
  const kinds: MonRequestKind[] = ['food', 'toilet', 'play'];
  return kinds[Math.floor(Math.random() * kinds.length)];
}

// "Effective" hunger considering decay since lastFed
function effectiveHunger(mon: MemoMonInstance, now: number = Date.now()): number {
  const stored = mon.hunger ?? 100;
  const last = mon.lastFed ?? now;
  const hours = Math.max(0, (now - last) / 3600000);
  return Math.max(0, Math.min(100, stored - hours * HUNGER_DECAY_PER_HOUR));
}

// Compute affection / hunger delta and reaction message for a feeding action
function computeFeedingEffect(defId: string, foodId: string): { affectionDelta: number; hungerDelta: number; reaction: 'fav' | 'dis' | 'normal' } {
  const food = FOODS.find(f => f.id === foodId);
  if (!food) return { affectionDelta: 0, hungerDelta: 0, reaction: 'normal' };
  const prefs = MEMOMON_FOOD_PREFS[defId] || { fav: [], dis: [] };
  if (prefs.fav.includes(foodId)) {
    return { affectionDelta: 10 + food.grade * 3, hungerDelta: 30 + food.grade * 10, reaction: 'fav' };
  }
  if (prefs.dis.includes(foodId)) {
    return { affectionDelta: -3, hungerDelta: 10, reaction: 'dis' };
  }
  return { affectionDelta: 2 + food.grade, hungerDelta: 20 + food.grade * 8, reaction: 'normal' };
}

function pixelToDataUrl(pixels: string[], palette: Record<string, string>, scale = MON_SCALE): string {
  const w = pixels[0].length * scale;
  const h = pixels.length * scale;
  const rects = pixels.flatMap((row, y) =>
    [...row].map((ch, x) => {
      const color = palette[ch];
      if (!color) return '';
      return `<rect x="${x*scale}" y="${y*scale}" width="${scale}" height="${scale}" fill="${color}"/>`;
    }).filter(Boolean)
  ).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`)}`;
}
const MEMOMON_IMGS: Record<string, string> = {};
MEMOMON_DEFS.forEach(def => {
  if (def.sprites) {
    MEMOMON_IMGS[def.id] = def.sprites.sit?.frames[0] ?? def.sprites.walk?.frames[0] ?? '';
  } else {
    MEMOMON_IMGS[def.id] = def.imageUrl ?? pixelToDataUrl(def.pixels, def.palette);
  }
});
// Preload all sprite frames
MEMOMON_DEFS.forEach(def => {
  if (!def.sprites) return;
  Object.values(def.sprites).forEach(anim => {
    anim.frames.forEach(src => { const img = new Image(); img.src = src; });
  });
});

function pickGacha(pool = GACHA_ITEMS): GachaPrize {
  const total = pool.reduce((s, i) => s + i.weight, 0);
  const r = Math.random() * total;
  let cum = 0;
  for (const item of pool) {
    cum += item.weight;
    if (r < cum) return item;
  }
  return pool[0];
}
function pickGachaMon(): GachaPrize {
  return pickGacha(GACHA_ITEMS.filter(i => i.type === 'memomon'));
}
function pickGachaUltra(): GachaPrize {
  const ultras = GACHA_ITEMS.filter(i => i.rarity === 'ultra');
  return pickGacha(ultras.length ? ultras : GACHA_ITEMS);
}

const IcoCoin = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--coin)">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
  </svg>
);

/* ヘッダー左のアプリマーク。public/icon.svg（罫線 3 本 + チェック）と
   同じ形。角丸の地は置かず、線だけをアクセント色で描く。 */
const IcoAppMark = () => (
  <svg className="app-mark" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <g stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" fill="none">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h11" />
    </g>
  </svg>
);

function CoinBadge({ coins, infinite, onGacha }: { coins: number; infinite?: boolean; onGacha: () => void }) {
  return (
    <button className="coin-badge" onClick={onGacha} title="ガチャを引く">
      <IcoCoin />
      {/* 3 桁区切り + tabular-nums。桁が増えても数字の幅が動かないので、
          コインが増減するたびに「ガチャ」ボタンが横へずれるのを防げる。 */}
      <span className="coin-badge-count">{infinite ? '∞' : coins.toLocaleString('ja-JP')}</span>
      <span className="coin-badge-gacha">ガチャ</span>
    </button>
  );
}

type GachaMode = 'single' | 'ten' | 'memomon';

const ORBIT_DOTS = [
  { color: '#ffd700', rot: '0deg',   dur: '1.5s', delay: '0s',     sz: '9px' },
  { color: '#ff6b35', rot: '60deg',  dur: '1.65s', delay: '-.26s', sz: '7px' },
  { color: '#e91e63', rot: '120deg', dur: '1.45s', delay: '-.5s',  sz: '9px' },
  { color: '#9c27b0', rot: '180deg', dur: '1.7s',  delay: '-.76s', sz: '7px' },
  { color: '#42a5f5', rot: '240deg', dur: '1.55s', delay: '-1s',   sz: '8px' },
  { color: '#4caf50', rot: '300deg', dur: '1.6s',  delay: '-1.2s', sz: '6px' },
];

function GachaParticles({ rarity }: { rarity: string }) {
  const palettes: Record<string, string[]> = {
    ultra: ['#ffd700','#ff6b35','#e91e63','#9c27b0','#fff','#42a5f5'],
    super: ['#ce93d8','#9c27b0','#ffd700','#fff','#e040fb'],
    rare:  ['#42a5f5','#1565c0','#90caf9','#fff'],
  };
  const colors = palettes[rarity] || palettes.rare;
  const count = rarity === 'ultra' ? 22 : rarity === 'super' ? 16 : 10;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * 360 + Math.random() * 20 - 10;
        const dist = 55 + Math.random() * 65;
        return (
          <div key={i} className="gacha-particle" style={{
            width: 6 + Math.random() * 6, height: 6 + Math.random() * 6,
            background: colors[i % colors.length],
            boxShadow: `0 0 5px ${colors[i % colors.length]}`,
            '--tx': `${Math.cos(angle * Math.PI / 180) * dist}px`,
            '--ty': `${Math.sin(angle * Math.PI / 180) * dist}px`,
            '--delay': `${i * 0.035}s`,
            '--dur': `${0.65 + Math.random() * 0.45}s`,
          } as any} />
        );
      })}
    </>
  );
}

function GachaModal({ coins, infinite, unlockedSounds, unlockedBgs, ownedMons, onClose, onResult }: {
  coins: number; infinite?: boolean;
  unlockedSounds: string[]; unlockedBgs: number[]; ownedMons: string[];
  onClose: () => void;
  onResult: (results: { prize: GachaPrize; dup: boolean }[], totalCost: number) => void;
}) {
  useDismissable(onClose);
  const [mode, setMode] = useState<GachaMode>('single');
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'flashing' | 'result'>('idle');
  const [singleResult, setSingleResult] = useState<GachaPrize | null>(null);
  const [singleDup, setSingleDup] = useState(false);
  const [tenResults, setTenResults] = useState<{ prize: GachaPrize; dup: boolean }[]>([]);
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [localCoins, setLocalCoins] = useState(coins);
  const [flashRarity, setFlashRarity] = useState<string | null>(null);
  const [revealCount, setRevealCount] = useState(-1);
  const [gachaFrame, setGachaFrame] = useState(0);
  const [monAnimFrame, setMonAnimFrame] = useState(0);

  useEffect(() => {
    if (phase !== 'result' || !singleResult || singleResult.type !== 'memomon' || !singleResult.monDefId) return;
    const def = MEMOMON_DEFS.find(d => d.id === singleResult.monDefId);
    if (!def?.sprites?.happy) return;
    const fps = def.sprites.happy.fps ?? 6;
    setMonAnimFrame(0);
    const id = setInterval(() => setMonAnimFrame(f => (f + 1) % def.sprites!.happy!.frames.length), 1000 / fps);
    return () => clearInterval(id);
  }, [phase, singleResult]);

  useEffect(() => {
    if (detailIdx === null) return;
    const prize = tenResults[detailIdx]?.prize;
    if (!prize || prize.type !== 'memomon' || !prize.monDefId) return;
    const def = MEMOMON_DEFS.find(d => d.id === prize.monDefId);
    if (!def?.sprites?.happy) return;
    const fps = def.sprites.happy.fps ?? 6;
    setMonAnimFrame(0);
    const id = setInterval(() => setMonAnimFrame(f => (f + 1) % def.sprites!.happy!.frames.length), 1000 / fps);
    return () => clearInterval(id);
  }, [detailIdx, tenResults]);

  useEffect(() => {
    if (phase === 'result' && mode === 'ten' && revealCount >= 0 && revealCount < 10) {
      const t = setTimeout(() => setRevealCount(c => c + 1), 175);
      return () => clearTimeout(t);
    }
  }, [phase, mode, revealCount]);

  useEffect(() => {
    if (phase !== 'spinning') return;
    setGachaFrame(0);
    const id = setInterval(() => setGachaFrame(f => (f + 1) % 15), 110);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'flashing') return;
    setGachaFrame(15);
    const t1 = setTimeout(() => setGachaFrame(16), 200);
    const t2 = setTimeout(() => setGachaFrame(17), 400);
    const t3 = setTimeout(() => setGachaFrame(18), 600);
    const t4 = setTimeout(() => {
      setGachaFrame(19);
      setFlashRarity(null);
      setPhase('result');
    }, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [phase]);

  const cost = mode === 'single' ? GACHA_COST : mode === 'ten' ? GACHA_COST_TEN : GACHA_COST_MON;
  const canAfford = infinite || localCoins >= cost;

  const rarityBg: Record<string, string> = {
    common: 'linear-gradient(135deg, #616161 0%, #9e9e9e 100%)',
    rare:   'linear-gradient(135deg, #0d47a1 0%, #1976d2 50%, #42a5f5 100%)',
    super:  'linear-gradient(135deg, #4a148c 0%, #7b1fa2 40%, #ce93d8 80%, #ffd700 100%)',
    ultra:  'linear-gradient(135deg, #ffd700 0%, #ff6b35 30%, #e91e63 60%, #9c27b0 100%)',
  };
  const rarityGlow: Record<string, string> = {
    common: '0 0 20px rgba(158,158,158,0.4), 0 4px 20px rgba(0,0,0,.5)',
    rare:   '0 0 30px rgba(66,165,245,0.8), 0 0 70px rgba(21,101,192,0.4), 0 4px 20px rgba(0,0,0,.5)',
    super:  '0 0 35px rgba(206,147,216,0.85), 0 0 80px rgba(106,27,154,0.5), 0 4px 20px rgba(0,0,0,.5)',
    ultra:  '0 0 50px rgba(255,215,0,1), 0 0 100px rgba(255,107,53,0.6), 0 4px 20px rgba(0,0,0,.5)',
  };

  function isDup(r: GachaPrize) {
    return (r.type === 'sound'   && !!r.soundType        && unlockedSounds.includes(r.soundType)) ||
           (r.type === 'bg'      && r.bgIdx !== undefined && unlockedBgs.includes(r.bgIdx)) ||
           (r.type === 'memomon' && !!r.monDefId          && ownedMons.includes(r.monDefId));
  }

  function pull() {
    if (!canAfford || phase === 'spinning') return;
    if (!infinite) setLocalCoins(c => c - cost);
    setPhase('spinning');
    setTimeout(() => {
      if (mode === 'ten') {
        const picks = Array.from({ length: 10 }, () => pickGacha());
        const hasUltra = picks.some(r => r.rarity === 'ultra');
        if (!hasUltra) picks[picks.length - 1] = pickGachaUltra();
        const results = picks.map(r => ({ prize: r, dup: isDup(r) }));
        const refund = results.filter(r => r.dup).length * 10;
        if (refund && !infinite) setLocalCoins(c => c + refund);
        setTenResults(results);
        setRevealCount(0);
        onResult(results, GACHA_COST_TEN);
        setFlashRarity(null);
        setPhase('flashing');
      } else {
        const r = mode === 'memomon' ? pickGachaMon() : pickGacha();
        const dup = isDup(r);
        setSingleResult(r); setSingleDup(dup);
        if (dup && !infinite) setLocalCoins(c => c + 10);
        onResult([{ prize: r, dup }], cost);
        setFlashRarity(r.rarity !== 'common' ? r.rarity : null);
        setPhase('flashing');
      }
    }, 1600);
  }

  function again() {
    setPhase('idle'); setSingleResult(null); setSingleDup(false);
    setTenResults([]); setRevealCount(-1); setFlashRarity(null); setGachaFrame(0);
    setDetailIdx(null);
  }
  function switchMode(m: GachaMode) { if (phase !== 'spinning') { setMode(m); again(); } }

  const labelParts = singleResult ? singleResult.label.split(' ') : [];
  const singleObtainedMsg = singleResult
    ? singleDup ? 'すでに解放済み！ コイン +10 獲得'
    : singleResult.type === 'memomon' ? `${labelParts.slice(1).join(' ')} がメモ画面を歩き回り始めた！`
    : singleResult.type === 'food' ? `${labelParts.slice(1).join(' ')} を 1個 ゲット！メモモンずかんで使えます`
    : `${labelParts.slice(1).join(' ')} をゲット！設定に反映されました`
    : '';
  const modeCostLabel: Record<GachaMode, string> = {
    single:  `${GACHA_COST}コインで1回`,
    ten:     `${GACHA_COST_TEN}コインで10連`,
    memomon: `${GACHA_COST_MON}コインでメモモン確定`,
  };

  return (
    <>
      {flashRarity && (
        <div className={`gacha-rarity-flash ${flashRarity}`} />
      )}
      <div className="modal-backdrop gacha-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="gacha-modal">
          <button className="gacha-close-btn" onClick={onClose}>✕</button>
          <div className="gacha-title">🎰 ガチャ</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', position: 'relative', zIndex: 1 }}>
            {(['single', 'ten', 'memomon'] as GachaMode[]).map(m => (
              <button key={m} onClick={() => switchMode(m)}
                className={`gacha-mode-btn${mode === m ? ' active' : ''}`}>
                {m === 'single' ? '単発' : m === 'ten' ? '10連' : 'メモモン'}
              </button>
            ))}
          </div>
          <div className="gacha-cost-info"><IcoCoin />&nbsp;{modeCostLabel[mode]}</div>

          {mode === 'ten' && phase === 'result' ? (
            <>
              <div className="gacha-ten-grid">
                {tenResults.map((r, i) => {
                  const revealed = i < revealCount;
                  const monImg = r.prize.type === 'memomon' && r.prize.monDefId
                    ? MEMOMON_IMGS[r.prize.monDefId]
                    : null;
                  return (
                    <div key={i} className={`gacha-ten-card${revealed ? ' show' : ''}`}
                      onClick={revealed ? () => setDetailIdx(i) : undefined}
                      style={{
                        background: rarityBg[r.prize.rarity] || rarityBg.common,
                        boxShadow: rarityGlow[r.prize.rarity],
                        cursor: revealed ? 'pointer' : 'default',
                      }}>
                      {monImg ? (
                        <img src={monImg} alt="" className="gacha-ten-card-mon" />
                      ) : (
                        <div style={{ fontSize: 22, lineHeight: 1.4 }}>{r.prize.label.split(' ')[0]}</div>
                      )}
                      <div style={{ fontSize: 10, color: '#fff', fontWeight: 700, opacity: .85 }}>{r.prize.stars}</div>
                      {r.dup && <div style={{ fontSize: 9, color: '#ffd700', fontWeight: 700 }}>+10</div>}
                    </div>
                  );
                })}
              </div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,.4)', position: 'relative', zIndex: 1 }}>
                重複 {tenResults.filter(r => r.dup).length}件 +{tenResults.filter(r => r.dup).length * 10} コイン返却
              </div>
            </>
          ) : (
            <>
              <div className="gacha-sprite-wrap">
                {phase === 'result' && singleResult && (singleResult.rarity === 'ultra' || singleResult.rarity === 'super') && (
                  <div className={`gacha-beam gacha-beam-${singleResult.rarity}`} />
                )}
                {phase === 'result' && singleResult && singleResult.rarity !== 'common' && (
                  <GachaParticles rarity={singleResult.rarity} />
                )}
                <img
                  className="gacha-sprite-img"
                  src={`./sprites/gacha_anim_${gachaFrame}.png`}
                  alt=""
                />
                {phase === 'result' && singleResult && (() => {
                  const monDef = singleResult.type === 'memomon' && singleResult.monDefId
                    ? MEMOMON_DEFS.find(d => d.id === singleResult.monDefId)
                    : null;
                  const happyFrames = monDef?.sprites?.happy?.frames;
                  return (
                    <div className="gacha-sprite-overlay">
                      <div className="gacha-result-rarity" style={{ color: singleResult.color }}>{singleResult.stars}</div>
                      {happyFrames ? (
                        <img
                          className="gacha-result-mon-anim"
                          src={happyFrames[monAnimFrame % happyFrames.length]}
                          alt=""
                        />
                      ) : (
                        <div className="gacha-result-label">{labelParts[0]}</div>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="gacha-result-area" style={{ visibility: phase === 'result' ? 'visible' : 'hidden' }}>
                <div className="gacha-result-name">{labelParts.slice(1).join(' ') || singleResult?.label || ' '}</div>
                <div className="gacha-result-desc">{singleObtainedMsg || ' '}</div>
                {singleResult?.flavor && (
                  <div className="gacha-flavor-box">{singleResult.flavor}</div>
                )}
              </div>
            </>
          )}

          <div className="gacha-coin-display">所持: <IcoCoin />&nbsp;{infinite ? '∞' : localCoins}</div>
          <button
            className="gacha-pull-btn"
            onClick={phase === 'result' ? again : pull}
            disabled={phase === 'spinning' || phase === 'flashing' || (phase === 'idle' && !canAfford)}
          >
            {phase === 'result'   ? '✨ もう一度引く'
             : phase === 'spinning' || phase === 'flashing' ? 'ガチャ中...'
             : !canAfford         ? 'コインが足りません'
             : mode === 'ten'     ? '🌟 10連ガチャ！'
             : mode === 'memomon' ? '🐾 メモモンガチャ！'
             : '✨ ガチャを引く！'}
          </button>

          {detailIdx !== null && tenResults[detailIdx] && (() => {
            const r = tenResults[detailIdx];
            const labelParts = r.prize.label.split(' ');
            const monDef = r.prize.type === 'memomon' && r.prize.monDefId
              ? MEMOMON_DEFS.find(d => d.id === r.prize.monDefId)
              : null;
            const happyFrames = monDef?.sprites?.happy?.frames;
            return (
              <div className="gacha-detail-overlay" onClick={() => setDetailIdx(null)}>
                <div
                  className="gacha-detail-card"
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: rarityBg[r.prize.rarity] || rarityBg.common,
                    boxShadow: rarityGlow[r.prize.rarity],
                  }}
                >
                  <button className="gacha-detail-close" onClick={() => setDetailIdx(null)}>✕</button>
                  <div className="gacha-detail-img-wrap">
                    {happyFrames ? (
                      <img
                        className="gacha-detail-mon-img"
                        src={happyFrames[monAnimFrame % happyFrames.length]}
                        alt=""
                      />
                    ) : (
                      <div className="gacha-detail-emoji">{labelParts[0]}</div>
                    )}
                  </div>
                  <div className="gacha-detail-rarity" style={{ color: r.prize.color }}>{r.prize.stars}</div>
                  <div className="gacha-detail-name">{labelParts.slice(1).join(' ') || r.prize.label}</div>
                  {r.dup && <div className="gacha-detail-dup">すでに解放済み（+10コイン返却）</div>}
                  {r.prize.flavor && <div className="gacha-flavor-box gacha-detail-flavor">{r.prize.flavor}</div>}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Local heuristic parser
// ─────────────────────────────────────────────────────────────
const TAG_KEYWORDS: Record<string, string[]> = {
  '買い物': ['買う','購入','買い','スーパー','コンビニ','注文'],
  '仕事':   ['会議','打ち合わせ','プレゼン','資料','メール','送付','クライアント','出張','報告','アポ','商談','提出','業務'],
  '家事':   ['掃除','洗濯','片付け','料理','ゴミ','炊事','整理'],
  '健康':   ['運動','ジム','ランニング','病院','診察','薬','歯医者','ヨガ'],
  '勉強':   ['勉強','学習','読書','講座','英語','復習','予習'],
  'アイデア': ['アイデア','思いつき','構想','企画','検討','コンセプト'],
};

const ACTION_VERB_RE = /(買う|購入|やる|行く|来る|帰る|完了|終わ(る|らせる)|確認|チェック|送る|送付|提出|連絡|電話|メール|会う|参加|準備|予約|予定|出発|到着|出張|締切|片付け|掃除|洗濯)/;
const DATE_TOKEN_RE  = /(今日|明日|明後日|昨日|来週.曜?|今週.曜?|来月|今月|\d{1,2}[/月]\d{1,2}日?|\d{1,2}月中|\d{4}[-/]\d{1,2}[-/]\d{1,2})/;
const RECURRING_RE   = /(毎日|毎週|毎月|隔週|週\d?回|月\d?回|定期|ルーティン|習慣)/;
const DEADLINE_RE    = /(\d{1,2}[月/]\d{1,2}日?まで|\d{4}[-/]\d{1,2}[-/]\d{1,2}まで|来週まで|今月中|月末まで|までに|まで[にの])/;
const TIME_TOKEN_RE  = /\d{1,2}[:時]\d{0,2}分?(に|から|まで)?/;
const IDEA_HINT_RE   = /(アイデア|構想|企画|思いつき|について|案$|コンセプト)/;

function normalizeDateChars(text: string) {
  return text
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[～〜]/g, '~');
}
function addDays(date: Date, n: number) { const d = new Date(date); d.setDate(d.getDate() + n); return d; }
function nextWeekday(from: Date, target: number) {
  const d = new Date(from); const cur = d.getDay();
  let diff = (target - cur + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff); return d;
}
function lastDayOfMonth(year: number, month1: number) { return new Date(year, month1, 0).getDate(); }

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function expandRecurringDraft(draft: TodoDraft, stamp: number, groupId?: string): Todo[] {
  if (!draft.recurring || !draft.startDate) {
    return [{
      id: stamp + Math.random(), title: draft.title,
      startDate: draft.startDate, endDate: draft.endDate,
      time: draft.time, tags: draft.tags,
      done: false, addedAt: stamp, coinReward: draft.coinReward,
      attachments: draft.attachments?.length ? draft.attachments : undefined,
    }];
  }
  const gid = groupId || `rg-${stamp}`;
  const start = new Date(draft.startDate + 'T00:00:00');
  const maxEnd = new Date(start);
  maxEnd.setMonth(maxEnd.getMonth() + 6);
  const declaredEnd = draft.endDate ? new Date(draft.endDate + 'T00:00:00') : null;
  const end = declaredEnd && declaredEnd < maxEnd ? declaredEnd : maxEnd;
  const todos: Todo[] = [];

  // Determine first occurrence considering recurringDay
  let cur = new Date(start);
  const rd = draft.recurringDay;
  if (rd !== undefined) {
    if (draft.recurring === 'weekly' || draft.recurring === 'biweekly') {
      // advance to first matching weekday on or after start
      while (cur.getDay() !== rd && cur <= end) cur.setDate(cur.getDate() + 1);
    } else if (draft.recurring === 'monthly') {
      // set to rd-th day of start month; if already passed, advance to next month
      cur = new Date(start.getFullYear(), start.getMonth(), rd);
      if (cur < start) { cur.setDate(1); cur.setMonth(cur.getMonth() + 1); cur.setDate(Math.min(rd, lastDayOfMonth(cur.getFullYear(), cur.getMonth() + 1))); }
    }
  }

  while (cur <= end && todos.length < 500) {
    const ds = localDateStr(cur);
    todos.push({
      id: stamp + Math.random(), title: draft.title,
      startDate: ds, endDate: ds,
      time: draft.time, tags: draft.tags,
      done: false, addedAt: stamp, coinReward: draft.coinReward,
      recurring: draft.recurring, recurringDay: draft.recurringDay,
      recurringGroupId: gid,
      attachments: draft.attachments?.length ? draft.attachments : undefined,
    });
    if (draft.recurring === 'daily') cur.setDate(cur.getDate() + 1);
    else if (draft.recurring === 'weekly') cur.setDate(cur.getDate() + 7);
    else if (draft.recurring === 'biweekly') cur.setDate(cur.getDate() + 14);
    else {
      // monthly: advance to same day next month (clamped to last day)
      cur.setDate(1); cur.setMonth(cur.getMonth() + 1);
      const day = rd !== undefined ? rd : start.getDate();
      cur.setDate(Math.min(day, lastDayOfMonth(cur.getFullYear(), cur.getMonth() + 1)));
    }
  }
  return todos;
}

function parseRelative(rawText: string): { startDate: string; endDate: string } {
  const text = normalizeDateChars(rawText);
  const dowMap: Record<string, number> = { '日':0,'月':1,'火':2,'水':3,'木':4,'金':5,'土':6 };
  const yy = today.getFullYear();

  const xmr = text.match(/(\d{1,2})[/月](\d{1,2})日?\s*(?:[~-]|から)\s*(\d{1,2})[/月](\d{1,2})日?\s*まで?/);
  if (xmr) return {
    startDate: `${yy}-${pad(+xmr[1])}-${pad(+xmr[2])}`,
    endDate:   `${yy}-${pad(+xmr[3])}-${pad(+xmr[4])}`,
  };

  const smr = text.match(/(\d{1,2})[/月](\d{1,2})日?\s*(?:[~-]|から)\s*(\d{1,2})日?\s*まで?/);
  if (smr) return {
    startDate: `${yy}-${pad(+smr[1])}-${pad(+smr[2])}`,
    endDate:   `${yy}-${pad(+smr[1])}-${pad(+smr[3])}`,
  };

  const mc = text.match(/(\d{1,2})月中/);
  if (mc) {
    const m = +mc[1];
    return {
      startDate: `${yy}-${pad(m)}-01`,
      endDate:   `${yy}-${pad(m)}-${pad(lastDayOfMonth(yy, m))}`,
    };
  }
  if (/今月中/.test(text)) {
    const m = today.getMonth() + 1;
    return {
      startDate: `${yy}-${pad(m)}-01`,
      endDate:   `${yy}-${pad(m)}-${pad(lastDayOfMonth(yy, m))}`,
    };
  }
  if (/来月中/.test(text)) {
    let m = today.getMonth() + 2, y = yy;
    if (m > 12) { m -= 12; y += 1; }
    return {
      startDate: `${y}-${pad(m)}-01`,
      endDate:   `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`,
    };
  }

  const rr = text.match(/(今日|明日|明後日|来週(.)曜?|今週(.)曜?)\s*から\s*(今日|明日|明後日|来週(.)曜?|今週(.)曜?)\s*まで/);
  if (rr) return { startDate: formatDate(resolveRel(rr[1])), endDate: formatDate(resolveRel(rr[4])) };

  const single = text.match(/(今日|明日|明後日|来週(.)曜?|今週(.)曜?)/);
  if (single) return { startDate: formatDate(resolveRel(single[1])), endDate: '' };

  const ymd = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) return { startDate: `${ymd[1]}-${pad(+ymd[2])}-${pad(+ymd[3])}`, endDate: '' };

  const md = text.match(/(\d{1,2})[/月](\d{1,2})日?/);
  if (md) return { startDate: `${yy}-${pad(+md[1])}-${pad(+md[2])}`, endDate: '' };

  return { startDate: '', endDate: '' };

  function resolveRel(s: string): Date {
    if (s === '今日')   return today;
    if (s === '明日')   return addDays(today, 1);
    if (s === '明後日') return addDays(today, 2);
    const wkM = s.match(/^(来週|今週)(.)曜?/);
    if (wkM) {
      const w = dowMap[wkM[2]];
      if (w === undefined) return today;
      const base = wkM[1] === '来週' ? addDays(today, 7) : today;
      return nextWeekday(base, w);
    }
    return today;
  }
}

function parseTime(rawText: string): string {
  const text = normalizeDateChars(rawText);
  const m = text.match(/(\d{1,2})[:時](\d{1,2})?/);
  if (!m) return '';
  return `${pad(+m[1])}:${pad(+(m[2] || 0))}`;
}

function stripDateTimeWords(rawText: string): string {
  let t = normalizeDateChars(rawText);
  t = t.replace(/(\d{1,2})[/月](\d{1,2})日?\s*(?:[~-]|から)\s*(\d{1,2})[/月](\d{1,2})日?\s*まで?/g, '');
  t = t.replace(/(\d{1,2})[/月](\d{1,2})日?\s*(?:[~-]|から)\s*(\d{1,2})日?\s*まで?/g, '');
  t = t.replace(/(\d{1,2}|今|来)月中/g, '');
  t = t.replace(/(今日|明日|明後日|来週.曜?|今週.曜?)\s*から\s*(今日|明日|明後日|来週.曜?|今週.曜?)\s*まで/g, '');
  t = t.replace(/(今日|明日|明後日|昨日|来週.曜?|今週.曜?|来月|今月)/g, '');
  t = t.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '');
  t = t.replace(/\d{1,2}[/月]\d{1,2}日?/g, '');
  t = t.replace(TIME_TOKEN_RE, '');
  t = t.replace(/^(に|から|まで|は|の|へ)\s*/, '');
  t = t.replace(/^[、,・\s]+|[、,・\s]+$/g, '').trim();
  return t;
}

function inferTags(text: string): string[] {
  const tags: string[] = [];
  for (const [tag, kws] of Object.entries(TAG_KEYWORDS)) {
    if (kws.some(k => text.includes(k))) tags.push(tag);
  }
  if (tags.length === 0) tags.push('その他');
  return tags;
}
const inferTagsForTodo = (text: string) => inferTags(text).filter(t => t !== IDEA_TAG);
const inferTagsForIdea = (text: string) => {
  const t = inferTags(text).filter(x => x !== 'その他');
  return t.length ? t : [IDEA_TAG];
};

const isTodoLine = (line: string) => {
  if (RECURRING_RE.test(line) || DEADLINE_RE.test(line)) return true;
  if (IDEA_HINT_RE.test(line) && !ACTION_VERB_RE.test(line)) return false;
  return ACTION_VERB_RE.test(line) || DATE_TOKEN_RE.test(line);
};

function estimateCoinReward(title: string, tags: string[]): number {
  let score = 30;
  const t = title;
  // Tag-based base
  if (tags.includes('仕事') || tags.includes('勉強')) score += 40;
  else if (tags.includes('家事') || tags.includes('健康')) score += 20;
  else if (tags.includes('買い物')) score += 0;
  // Keyword difficulty bumps
  if (/資料|企画|設計|開発|実装|レポート|報告書|プレゼン|調査|分析/.test(t)) score += 60;
  else if (/作成|準備|計画|手続き|申請|修正|編集/.test(t)) score += 30;
  else if (/確認|チェック|送付|連絡|返信|予約/.test(t)) score -= 10;
  else if (/買う|購入|注文/.test(t)) score -= 15;
  // Title length (longer = likely more complex)
  if (t.length > 20) score += 20;
  else if (t.length > 12) score += 10;
  // Clamp and snap to nearest 10
  score = Math.max(10, Math.min(200, score));
  return Math.round(score / 10) * 10;
}

function estimateIdeaCoinReward(summary: string, details: string[], tags: string[]): number {
  let score = 20;
  if (summary.length > 30) score += 20;
  else if (summary.length > 15) score += 10;
  if (details.length >= 5) score += 40;
  else if (details.length >= 3) score += 20;
  else if (details.length >= 1) score += 10;
  if (tags.includes('仕事')) score += 40;
  else if (tags.includes('勉強')) score += 30;
  if (/企画|設計|戦略|プロジェクト|計画|開発|実装|分析|調査|研究/.test(summary)) score += 50;
  else if (/アイデア|構想|案|提案|改善/.test(summary)) score += 20;
  score = Math.max(10, Math.min(200, score));
  return Math.round(score / 10) * 10;
}

function extractTodosFromLine(line: string): TodoDraft[] {
  const dates = parseRelative(line);
  const time = parseTime(line);
  const cleaned = stripDateTimeWords(line);
  const out: TodoDraft[] = [];

  const verbM = cleaned.match(/^(.+?)(?:を)?(買う|購入|チェック|確認|送る|完了|やる|提出|送付)$/);
  if (verbM && /[、,・]/.test(verbM[1])) {
    const nouns = verbM[1].split(/[、,・]/).map(s => s.trim()).filter(Boolean);
    const verb = verbM[2];
    const tags = inferTagsForTodo(line);
    for (const n of nouns) {
      const title = `${n}を${verb}`;
      out.push({ title, startDate: dates.startDate, endDate: dates.endDate, time, tags, coinReward: estimateCoinReward(title, tags) });
    }
    return out;
  }

  const parts = cleaned.split(/[、,]/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const p of parts) {
      const tags = inferTagsForTodo(p);
      out.push({ title: p, startDate: dates.startDate, endDate: dates.endDate, time, tags, coinReward: estimateCoinReward(p, tags) });
    }
  } else {
    const tags = inferTagsForTodo(line);
    out.push({ title: cleaned || line, startDate: dates.startDate, endDate: dates.endDate, time, tags, coinReward: estimateCoinReward(cleaned || line, tags) });
  }
  return out;
}

function extractIdeaFromLine(line: string, existingProjects: string[]): IdeaDraft {
  let projectName = '';
  let summary = line;

  const colonM = line.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
  if (colonM) {
    projectName = colonM[1].replace(/^[■◆●▼※【[]+|[】\]]+$/g, '').trim();
    projectName = projectName.replace(/(について|のアイデア|の話|のメモ|の構想|の企画|案|構想|企画)$/, '').trim();
    summary = colonM[2].trim();
  } else {
    const bracketM = line.match(/^[■◆●▼※【[]+(.+?)[】\]]+\s*(.*)$/);
    if (bracketM) {
      projectName = bracketM[1].trim();
      summary = bracketM[2].trim() || projectName;
    }
  }

  // 既存ナレッジへの追記は破壊的なので、部分一致での安易なマージはしない。
  // 以前は双方向の部分一致（pl.includes(c) || c.includes(pl)）だったため、
  // 「案」のような短い語が無関係な既存ナレッジに吸い込まれていた。
  const MIN_MATCH_LEN = 4;
  const tryMatch = (candidate: string) => {
    if (!candidate || !existingProjects.length) return null;
    const c = candidate.toLowerCase().trim();
    if (!c) return null;
    const exact = existingProjects.find(p => p && p.toLowerCase().trim() === c);
    if (exact) return exact;
    // 完全一致でない場合は、十分に長い名前が丸ごと含まれるときだけ許容
    if (c.length < MIN_MATCH_LEN) return null;
    return existingProjects.find(p => {
      if (!p || p.trim().length < MIN_MATCH_LEN) return false;
      return c.includes(p.toLowerCase().trim());
    }) || null;
  };
  if (projectName) {
    const matched = tryMatch(projectName);
    if (matched) projectName = matched;
  }
  if (!projectName) {
    const matched = existingProjects.find(p => p && p.trim().length >= MIN_MATCH_LEN && line.includes(p));
    if (matched) projectName = matched;
  }
  if (!projectName) {
    projectName = line.length <= 16 ? line : 'メモ';
  }

  return {
    projectName,
    summary: summary === projectName ? '' : summary,
    details: [],
    tags: inferTagsForIdea(line),
  };
}

function localParseAll(memo: string, existingProjects: string[] = []): ParseResult {
  const lines = memo.split(/[\n。]/).map(l => l.trim()).filter(Boolean);
  const todos: TodoDraft[] = [];
  const ideas: IdeaDraft[] = [];
  for (const line of lines) {
    if (isTodoLine(line)) todos.push(...extractTodosFromLine(line));
    else                   ideas.push(extractIdeaFromLine(line, existingProjects));
  }
  return { todos, ideas };
}

function mergeIdeas(existing: Idea[], incoming: IdeaDraft[]): Idea[] {
  const result: Idea[] = existing.map(e => ({ ...e, details: [...(e.details || [])], tags: [...(e.tags || [])] }));
  const todayDate = formatDate(new Date());
  for (const inc of incoming) {
    if (!inc || !inc.projectName) continue;
    const idx = result.findIndex(e =>
      (e.projectName || '').toLowerCase().trim() === (inc.projectName || '').toLowerCase().trim()
    );
    if (idx >= 0) {
      const cur = result[idx];
      const newDetails = [...cur.details];
      if (inc.summary && inc.summary !== cur.summary && !newDetails.includes(inc.summary)) {
        newDetails.push(inc.summary);
      }
      for (const d of (inc.details || [])) {
        if (d && !newDetails.includes(d)) newDetails.push(d);
      }
      const newTags = Array.from(new Set([...cur.tags, ...((inc.tags) || [])]));
      const mergedAtts = inc.attachments?.length
        ? [...(cur.attachments || []), ...inc.attachments.filter(a => !(cur.attachments || []).some(ca => ca.id === a.id))]
        : cur.attachments;
      result[idx] = {
        ...cur,
        summary: cur.summary || inc.summary || '',
        details: newDetails,
        tags: newTags,
        updatedAt: todayDate,
        addedAt: Date.now(),
        attachments: mergedAtts?.length ? mergedAtts : undefined,
      };
    } else {
      result.push({
        id: Date.now() + Math.random(),
        projectName: inc.projectName,
        summary: inc.summary || '',
        details: [...(inc.details || [])],
        tags: [...((inc.tags) || ['アイデア'])],
        createdAt: todayDate,
        updatedAt: todayDate,
        addedAt: Date.now(),
        attachments: inc.attachments?.length ? inc.attachments : undefined,
      });
    }
  }
  return result;
}

// 既存ナレッジの要約。projectName だけだと AI が主題の一致を判断できず、
// 名前が似ているだけの無関係なナレッジに追記されてしまうため概要も渡す。
type IdeaBrief = { name: string; summary?: string };
const MAX_IDEA_BRIEFS = 50;

async function parseMemoToItems(text: string, existingProjects: string[] = [], cfg: AiCfg, mode: 'todo' | 'idea' | 'both' = 'both', existingBriefs: IdeaBrief[] = []): Promise<ParseResult> {
  // 空行区切りは「話題の区切りの目安」として AI に伝える。
  // 以前は段落ごとに独立した AI 呼び出しを並列で行っていたため、AI がメモ全体を
  // 見られず「同じ主題なのに複数ナレッジに分割される」原因になっていた。
  // 1 回の呼び出しでメモ全体を渡し、まとめる判断を AI ができるようにする。
  const paragraphCount = text
    .split(/\n[ \t　]*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .length;

  return parseMemoWithAi(text, existingProjects, cfg, mode, paragraphCount, existingBriefs);
}

async function parseMemoWithAi(text: string, existingProjects: string[] = [], cfg: AiCfg, mode: 'todo' | 'idea' | 'both' = 'both', paragraphCount = 1, existingBriefs: IdeaBrief[] = []): Promise<ParseResult> {
  // 既存ナレッジは「名前: 概要」の形で渡す。多すぎるとプロンプトが薄まり
  // 誤マッチが増えるので直近 MAX_IDEA_BRIEFS 件までに制限する。
  const briefs: IdeaBrief[] = (existingBriefs.length
    ? existingBriefs
    : existingProjects.map((name): IdeaBrief => ({ name }))
  ).filter(b => b && b.name).slice(-MAX_IDEA_BRIEFS);
  const briefLines = briefs.length
    ? briefs.map(b => `   - ${b.name}${b.summary ? `: ${b.summary.slice(0, 60)}` : ''}`).join('\n')
    : '   （既存ナレッジなし → 必ず新規作成）';
  const modeInstruction =
    mode === 'todo'
      ? `あなたはメモをTODOに変換するアシスタントです。以下のメモをTODOのみに変換し、ideas は必ず空配列で返してください。\n\n`
      : mode === 'idea'
      ? `あなたはメモをナレッジ（アイデア・情報）に変換するアシスタントです。以下のメモをナレッジのみに変換し、todos は必ず空配列で返してください。\n\n`
      : `あなたはメモを解析するアシスタントです。以下のメモを「TODO」と「ナレッジ」に分類し、JSONのみを返してください。\n\n`;
  const prompt =
    modeInstruction +
    `【TODO vs ナレッジ 判定ルール】\n` +
    `TODO（以下のいずれかに該当すれば必ずTODO）:\n` +
    `  - 行動動詞がある（買う・連絡する・送る・提出する・行く・やる・確認する 等）\n` +
    `  - 日付・期限・締め切りがある（〇〇までに・来週・〇月〇日・明日 等）\n` +
    `  - 定期的・繰り返しの予定（毎日・毎週・毎月・隔週・週1 等）→ 必ずTODO\n` +
    `  - 習慣・ルーティン（朝ランニング・週次レビュー 等）→ 必ずTODO\n` +
    `ナレッジ（具体的な行動・日程・期限がなく、将来的な構想・着想のもの）:\n` +
    `  - 「〜したい」「〜はどうか」「〜を考えている」（実行日未定）\n` +
    `  - 企画・コンセプト・仕様検討など\n` +
    `  ※ 「〜のアイデアを考える」のように行動自体はTODO\n\n` +
    `【各フィールドのルール】\n` +
    `1. TODOの複数項目は分割。「明日、にんじん、玉ねぎを買う」→「にんじんを買う」「玉ねぎを買う」（「明日」はstartDateへ）\n` +
    `   ※この分割ルールはTODOのみに適用。ナレッジには適用しない（ナレッジは10を参照）\n` +
    `2. 日付は YYYY-MM-DD。期間は startDate と endDate 両方、単日は endDate=""\n` +
    `   - 「8月中」         → startDate=${today.getFullYear()}-08-01, endDate=${today.getFullYear()}-08-31\n` +
    `   - 「7月1日〜15日」  → startDate=${today.getFullYear()}-07-01, endDate=${today.getFullYear()}-07-15\n` +
    `   - 「〇月〇日まで」  → endDate=その日, startDate=本日\n` +
    `3. 時間は HH:MM か ""\n` +
    `4. TODOのtags: 買い物 / 仕事 / 家事 / 健康 / 勉強 / その他（「アイデア」タグは使わない）\n` +
    `   ナレッジのtags: アイデア / 買い物 / 仕事 / 家事 / 健康 / 勉強\n` +
    `5. coinReward（TODO・ナレッジ共通）: 10〜200の整数（10の倍数）\n` +
    `   TODO: 難易度・手間・所要時間で設定\n` +
    `   ナレッジ: 内容の深さ・独自性・有用性で設定\n` +
    `   10〜30=数分の簡単タスク、40〜80=30分〜1時間、90〜150=複雑な作業、160〜200=大型タスク\n` +
    `6. ナレッジの projectName（＝既存への追記か、新規作成かの判定）:\n` +
    `   - 既存ナレッジのいずれかと【主題が同じ】ときだけ、その名前を一字一句そのまま使う（＝追記される）\n` +
    `   - 主題が少しでも違う場合、迷った場合は【必ず新しい名前で新規作成】する（追記は破壊的なので慎重に）\n` +
    `   - 名前が似ている・同じ単語を含むだけでは追記しない\n` +
    `     例:「旅行の持ち物」と「旅行の予算」は別。「React最適化」と「Reactの学習計画」も別\n` +
    `   - 判定は下の一覧の「概要」まで読んで、内容が地続きかどうかで決めること\n` +
    `7. 既存ナレッジ一覧（名前: 概要）— ここに無い主題は必ず新規作成:\n${briefLines}\n` +
    `8. 本日: ${todayStr}（年未指定の月日は${today.getFullYear()}年とする）\n` +
    `9. 定期予定（毎日・毎週・隔週・毎月）は recurring + recurringDay を設定:\n` +
    `   recurring値: "daily" / "weekly" / "biweekly" / "monthly" / ""（非定期）\n` +
    `   recurringDay（曜日・日を指定している場合のみ設定）:\n` +
    `   - weekly/biweekly: 曜日番号 0=日 1=月 2=火 3=水 4=木 5=金 6=土\n` +
    `     例「毎週月曜日」→ recurring="weekly", recurringDay=1\n` +
    `     例「隔週金曜」  → recurring="biweekly", recurringDay=5\n` +
    `   - monthly: 日番号 1〜31\n` +
    `     例「毎月1日」   → recurring="monthly", recurringDay=1\n` +
    `     例「毎月15日」  → recurring="monthly", recurringDay=15\n` +
    `   - daily: recurringDay不要\n` +
    `   startDate=本日（または指定の開始日）、endDate=6ヶ月後（または指定の終了日）\n` +
    `10. 【重要】ナレッジのまとめ方（無駄に分割しないこと）:\n` +
    `   - 同じ主題の内容は必ず【1つのナレッジentry】にまとめる\n` +
    `   - 1つの主題の中の複数のポイントは details 配列の要素にする（entryを増やさない）\n` +
    `   - entryを分けてよいのは、主題が明確に別だと言い切れる場合のみ\n` +
    `   - 迷ったら「分ける」ではなく「まとめる」を選ぶ\n` +
    (paragraphCount > 1
      ? `11. このメモはユーザーが空行で ${paragraphCount} 個の段落に区切っています。空行は話題の区切りの目安なので、原則として段落ごとに別のナレッジにしてください。ただし複数の段落が明らかに同一主題の続きなら1つにまとめて構いません。1つの段落の中身は原則1つのナレッジにまとめます。\n\n`
      : `11. このメモは段落が1つです。ナレッジは原則【1件】にまとめてください（明確に無関係な複数トピックが混在する場合のみ分割可）。\n\n`) +
    `形式（JSONのみ、コードブロック不要）:\n` +
    `{"todos":[{"title":"","startDate":"","endDate":"","time":"","tags":[],"coinReward":10,"recurring":"","recurringDay":null}],"ideas":[{"projectName":"","summary":"","details":[],"tags":[],"coinReward":20}]}\n\n` +
    `メモ:\n${text}`;

  const tryParseJson = (res: string): ParseResult | null => {
    const m = (res || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const parsed = JSON.parse(m[0]);
      return {
        todos: Array.isArray(parsed.todos) ? parsed.todos : [],
        ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
      };
    } catch { return null; }
  };

  if (aiConfigured(cfg)) {
    try {
      const out = await aiText(cfg, prompt);
      const parsed = tryParseJson(out);
      if (parsed) return parsed;
    } catch (e) {
      console.warn('[AI] memo parse failed:', e);
    }
  }

  const claude = (typeof window !== 'undefined' && (window as any).claude && (window as any).claude.complete) as
    | ((p: string) => Promise<string>) | undefined;
  if (claude) {
    try {
      const out = await claude(prompt);
      const parsed = tryParseJson(out);
      if (parsed) return parsed;
    } catch {}
  }

  return localParseAll(text, existingProjects);
}

// ─────────────────────────────────────────────────────────────
// SVG icons
// ─────────────────────────────────────────────────────────────
const IcoMic = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
);
const IcoHistory = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IcoImg = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
  </svg>
);
const IcoSparkle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2zM19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3zM5 15l.7 2.1L8 18l-2.3.9L5 21l-.7-2.1L2 18l2.3-.9L5 15z"/>
  </svg>
);
const IcoCheck = ({ color = '#fff' }: { color?: string }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IcoCalSm = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
  </svg>
);
const IcoMemoNav = ({ active }: { active: boolean }) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill={active ? 'var(--accent)' : '#c0c0ba'}>
    <path d="M3 18h12v-2H3v2zm0-5h12v-2H3v2zm0-7v2h12V6H3zm14 9.17V23l5-5-5-.83z"/>
  </svg>
);
const IcoTodoNav = ({ active }: { active: boolean }) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill={active ? 'var(--accent)' : '#c0c0ba'}>
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
  </svg>
);
const IcoIdeaNav = ({ active }: { active: boolean }) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill={active ? 'var(--accent)' : '#c0c0ba'}>
    <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>
  </svg>
);
const IcoSettingsNav = ({ active }: { active: boolean }) => (
  <svg width="21" height="21" viewBox="0 0 24 24" fill={active ? 'var(--accent)' : '#c0c0ba'}>
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
  </svg>
);

const IcoChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const IcoChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
);
const IcoTrash = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
  </svg>
);
const IcoCalendar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/>
    <path d="M7 10h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zm-8 4h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/>
  </svg>
);
const IcoMicFab = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
);
const IcoPencilFab = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3l4 4L8 20l-5 1 1-5z"/>
  </svg>
);
const IcoHomeNav = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>
  </svg>
);
const IcoBookNav = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h7z"/>
  </svg>
);
const IcoEggNav = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3C8.5 3 5 9 5 13.5a7 7 0 0 0 14 0C19 9 15.5 3 12 3z"/>
  </svg>
);
const IcoGearNav = ({ active }: { active: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>
  </svg>
);

const IcoList = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.2 6.5h.1M4.2 12h.1M4.2 17.5h.1"/>
  </svg>
);
const IcoWarn = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 3 1.8 20.5h20.4L12 3Z" strokeLinejoin="round"/>
    <path d="M12 10v4.2M12 17.6v.1"/>
  </svg>
);
const IcoCopy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
  </svg>
);

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const el = document.createElement('textarea');
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
  });
  window.dispatchEvent(new CustomEvent('copy-success'));
}
function buildTodoCopyText(t: Todo): string {
  const lines = [t.title];
  if (t.startDate) lines.push(`📅 ${t.startDate}${t.endDate ? ` — ${t.endDate}` : ''}`);
  if (t.time) lines.push(`⏰ ${t.time}`);
  if ((t.tags || []).length > 0) lines.push(`🏷 ${t.tags.join(', ')}`);
  return lines.join('\n');
}
function buildIdeaCopyText(i: Idea): string {
  const lines = [i.projectName];
  if (i.summary) lines.push(i.summary);
  (i.details || []).forEach(d => lines.push(`・${d}`));
  return lines.join('\n');
}
// ナレッジ1件を Markdown に整形
function buildIdeaMarkdown(i: Idea): string {
  const lines: string[] = [`# ${i.projectName || '(無題)'}`, ''];
  if (i.summary) { lines.push(i.summary, ''); }
  (i.details || []).forEach(d => lines.push(`- ${d}`));
  if ((i.details || []).length) lines.push('');
  const meta: string[] = [];
  if ((i.tags || []).length) meta.push(`タグ: ${i.tags.join(', ')}`);
  if (i.updatedAt) meta.push(`更新: ${i.updatedAt}`);
  if (meta.length) lines.push(`> ${meta.join(' ／ ')}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// 複数のナレッジを1つの Markdown テキストに結合（--- で区切る）
function buildIdeasMarkdown(list: Idea[]): string {
  return list.map(buildIdeaMarkdown).join('\n\n---\n\n') + '\n';
}
// テキストをファイルとしてダウンロードさせる
function downloadTextFile(filename: string, text: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ─────────────────────────────────────────────────────────────
// Boss Item
// ─────────────────────────────────────────────────────────────
function BossItem({ boss, onComplete, onDismiss }: {
  boss: { id: string; title: string; spawnedAt: number };
  onComplete: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="boss-item">
      <div className="boss-crown">👑</div>
      <div className="boss-body">
        <div className="boss-title">ボスミッション: {boss.title}</div>
        <div className="boss-reward">達成で 🪙 +50コイン！</div>
      </div>
      <div className="boss-actions">
        <button className="boss-complete-btn" onClick={onComplete}>達成！</button>
        <button className="boss-dismiss-btn" onClick={onDismiss} title="後で">✕</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────
function Calendar({ todos, selectedDate, onSelect, mode = 'month', onModeChange, holidayConfig }: { todos: Todo[]; selectedDate: string; onSelect: (d: string) => void; mode?: 'month' | 'week'; onModeChange?: (m: 'month' | 'week') => void; holidayConfig?: HolidayConfig }) {
  const [vy, setVy] = useState(today.getFullYear());
  const [vm, setVm] = useState(today.getMonth());
  const [direction, setDirection] = useState<'prev' | 'next' | null>(null);
  const [entering,  setEntering]  = useState<'prev' | 'next' | null>(null);
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const cells: { date: Date; cur: boolean }[] = [];
  
  if (mode === 'week') {
    // 週表示：選択日付を基準に日～土曜日を表示
    const selectedDateObj = new Date(selectedDate + 'T00:00:00');
    const dayOfWeek = selectedDateObj.getDay();
    const weekStartDate = new Date(selectedDateObj);
    weekStartDate.setDate(selectedDateObj.getDate() - dayOfWeek);
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartDate);
      d.setDate(weekStartDate.getDate() + i);
      cells.push({ date: d, cur: true });
    }
  } else {
    // 月表示：従来の42日グリッド
    const firstDay = new Date(vy, vm, 1);
    const lastDay  = new Date(vy, vm + 1, 0);
    for (let i = firstDay.getDay() - 1; i >= 0; i--) cells.push({ date: new Date(vy, vm, -i), cur: false });
    for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ date: new Date(vy, vm, d), cur: true });
    while (cells.length < 42) {
      const l = cells[cells.length - 1].date;
      cells.push({ date: new Date(l.getTime() + 86400000), cur: false });
    }
  }

  const dotSet = new Set<string>();
  todos.forEach(t => {
    const r = todoDisplayRange(t);
    if (!r) return;
    const s = new Date(r.start), e = new Date(r.end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) dotSet.add(formatDate(new Date(d)));
  });

  function doTransition(dir: 'prev' | 'next', update: () => void) {
    setDirection(dir);
    setTimeout(() => {
      update();
      setDirection(null);
      setEntering(dir);
      setTimeout(() => setEntering(null), 220);
    }, 160);
  }

  const prev = () => {
    if (mode === 'week') {
      doTransition('prev', () => {
        const d = new Date(selectedDate + 'T00:00:00');
        d.setDate(d.getDate() - 7);
        onSelect(formatDate(d));
      });
    } else {
      doTransition('prev', () => {
        vm === 0 ? (setVm(11), setVy(y => y - 1)) : setVm(m => m - 1);
      });
    }
  };
  const next = () => {
    if (mode === 'week') {
      doTransition('next', () => {
        const d = new Date(selectedDate + 'T00:00:00');
        d.setDate(d.getDate() + 7);
        onSelect(formatDate(d));
      });
    } else {
      doTransition('next', () => {
        vm === 11 ? (setVm(0), setVy(y => y + 1)) : setVm(m => m + 1);
      });
    }
  };

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!swipeRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeRef.current.x;
    const dy = t.clientY - swipeRef.current.y;
    const dt = Date.now() - swipeRef.current.time;
    swipeRef.current = null;
    if (dt > 600) return;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (dx < 0) next(); else prev();
  }

  return (
    <div className="cal-wrapper" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="cal-head">
        <div className="calendar-mode-toggle">
          <button className={`mode-btn${mode === 'month' ? ' active' : ''}`} onClick={() => onModeChange?.('month')}>月</button>
          <button className={`mode-btn${mode === 'week' ? ' active' : ''}`} onClick={() => onModeChange?.('week')}>週</button>
        </div>
        <div className="cal-nav-center">
          <button className="cal-nav-btn" onClick={prev}>‹</button>
          <span className="cal-month-label">{mode === 'month'
            ? `${String(vy)}/${String(vm + 1).padStart(2, '0')}`
            : (() => {
                const sd = new Date(selectedDate + 'T00:00:00');
                const ws = new Date(sd); ws.setDate(sd.getDate() - sd.getDay());
                const we = new Date(ws); we.setDate(ws.getDate() + 6);
                const f = (d: Date) => `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
                return `${f(ws)}〜${f(we)}`;
              })()
          }</span>
          <button className="cal-nav-btn" onClick={next}>›</button>
        </div>
        <button className="cal-today-btn" onClick={() => { setVy(today.getFullYear()); setVm(today.getMonth()); onSelect(todayStr); }}>今日</button>
      </div>
      <div className="cal-dow">{DOW.map((d, i) => <div key={d} className={`cal-dow-cell${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{d}</div>)}</div>
      <div className={`cal-grid-rows${direction ? ` cal-slide-${direction}` : ''}${entering ? ` cal-enter-${entering}` : ''}`}>
        {((): React.ReactElement[] => {
          const MAX_LANES = 3;
          type LaneSlot = { cs: number; ce: number };
          type Placement = { todo: Todo; lane: number; cs: number; ce: number; isStart: boolean; isEnd: boolean };
          const rows: { date: Date; cur: boolean }[][] = [];
          for (let r = 0; r < cells.length / 7; r++) rows.push(cells.slice(r * 7, (r + 1) * 7));

          return rows.map((row, rowIdx) => {
            const rowStart = formatDate(row[0].date);
            const rowEnd   = formatDate(row[6].date);

            const rowTodos = todos
              .map(t => ({ t, r: todoDisplayRange(t) }))
              .filter(x => x.r && x.r.start <= rowEnd && x.r.end >= rowStart)
              .sort((a, b) => {
                if (a.t.done !== b.t.done) return a.t.done ? 1 : -1;
                const aS = a.r!.start < rowStart ? rowStart : a.r!.start;
                const bS = b.r!.start < rowStart ? rowStart : b.r!.start;
                const aE = a.r!.end > rowEnd ? rowEnd : a.r!.end;
                const bE = b.r!.end > rowEnd ? rowEnd : b.r!.end;
                const aSpan = row.findIndex(c => formatDate(c.date) === aE) - row.findIndex(c => formatDate(c.date) === aS);
                const bSpan = row.findIndex(c => formatDate(c.date) === bE) - row.findIndex(c => formatDate(c.date) === bS);
                if (bSpan !== aSpan) return bSpan - aSpan;
                return aS.localeCompare(bS);
              });

            const laneSlots: LaneSlot[][] = [];
            const placements: Placement[] = [];
            for (const { t, r } of rowTodos) {
              if (!r) continue;
              const effS = r.start < rowStart ? rowStart : r.start;
              const effE = r.end > rowEnd ? rowEnd : r.end;
              const ci0 = row.findIndex(c => formatDate(c.date) === effS);
              const ci1 = row.findIndex(c => formatDate(c.date) === effE);
              if (ci0 < 0 || ci1 < 0) continue;
              const cs = ci0 + 1, ce = ci1 + 2;
              let lane = 0;
              for (;;) {
                if (!laneSlots[lane]) { laneSlots[lane] = []; break; }
                if (!laneSlots[lane].some(s => cs < s.ce && ce > s.cs)) break;
                lane++;
              }
              laneSlots[lane] = laneSlots[lane] || [];
              laneSlots[lane].push({ cs, ce });
              placements.push({ todo: t, lane, cs, ce, isStart: r.start >= rowStart, isEnd: r.end <= rowEnd });
            }

            const visible = placements.filter(p => p.lane < MAX_LANES);
            const moreCounts = Array(7).fill(0);
            placements.filter(p => p.lane >= MAX_LANES).forEach(p => {
              for (let ci = p.cs - 1; ci < p.ce - 1; ci++) moreCounts[ci]++;
            });
            const hasMore = moreCounts.some(n => n > 0);

            return (
              <div key={rowIdx} className="cal-week-row">
                <div className="cal-week-cells">
                  {row.map((c, ci) => {
                    const ds = formatDate(c.date), isTd = ds === todayStr, isSel = ds === selectedDate;
                    const dow = c.date.getDay();
                    const isHol = !!holidayConfig && (
                      holidayConfig.custom.includes(ds) ||
                      (holidayConfig.weekends && dow === 0) ||
                      (holidayConfig.jpHolidays && JP_HOLIDAYS.has(ds))
                    );
                    const isSat = !!holidayConfig?.weekends && dow === 6;
                    return (
                      <div key={ci}
                        className={`cal-cell${!c.cur ? ' other-month' : ''}${isTd && !isSel ? ' today' : ''}${isSel ? ' selected' : ''}${isHol ? ' holiday' : isSat ? ' sat' : ''}`}
                        onClick={() => onSelect(ds)}
                      >
                        <span className="cal-num">{c.date.getDate()}</span>
                      </div>
                    );
                  })}
                </div>
                {(visible.length > 0 || hasMore) && (
                  <div className="cal-event-layer">
                    {visible.map(p => {
                      const multi = p.ce - p.cs > 1;
                      const showLabel = p.isStart || p.cs === 1;
                      return (
                        <div
                          key={`${p.todo.id}-${rowIdx}`}
                          className={`cal-span-bar${multi ? ' multi' : ' single'}${p.todo.done ? ' done' : ''}${!p.isStart ? ' no-l' : ''}${!p.isEnd ? ' no-r' : ''}`}
                          style={{ gridColumn: `${p.cs}/${p.ce}`, gridRow: `${p.lane + 1}` }}
                          onClick={ev => { ev.stopPropagation(); onSelect(formatDate(row[p.cs - 1].date)); }}
                        >
                          {showLabel && <span className="cal-span-label">{p.todo.title}</span>}
                        </div>
                      );
                    })}
                    {hasMore && moreCounts.map((n, ci) => n > 0 ? (
                      <div
                        key={`more-${rowIdx}-${ci}`}
                        className="cal-bar-more"
                        style={{ gridColumn: `${ci + 1}/${ci + 2}`, gridRow: `${MAX_LANES + 1}` }}
                        onClick={ev => { ev.stopPropagation(); onSelect(formatDate(row[ci].date)); }}
                      >+{n}</div>
                    ) : null)}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Edit Modal
// ─────────────────────────────────────────────────────────────
function EditModal({ todo, mode = 'edit', onSave, onDelete, onClose, customTags = [] }: {
  todo: Todo | (TodoDraft & { id: string });
  mode?: 'add' | 'edit';
  onSave: (t: any) => void;
  onDelete?: () => void;
  onClose: () => void;
  customTags?: string[];
}) {
  useDismissable(onClose);
  type RecurringVal = 'daily' | 'weekly' | 'biweekly' | 'monthly';
  const RECURRING_OPTS: { value: RecurringVal | ''; label: string }[] = [
    { value: '', label: 'なし' },
    { value: 'daily', label: '毎日' },
    { value: 'weekly', label: '毎週' },
    { value: 'biweekly', label: '隔週' },
    { value: 'monthly', label: '毎月' },
  ];
  const tagOptions = getTodoTagOptions(customTags);
  const [title,       setTitle]       = useState(todo.title);
  const [startDate,   setStartDate]   = useState(todo.startDate);
  const [endDate,     setEndDate]     = useState(todo.endDate);
  const [time,        setTime]        = useState(todo.time);
  const [tags,        setTags]        = useState<string[]>(todo.tags || []);
  const [recurring,   setRecurring]   = useState<RecurringVal | ''>((todo as any).recurring || '');
  const [recurringDay, setRecurringDay] = useState<number | undefined>((todo as any).recurringDay);
  const [attachments, setAttachments] = useState<Attachment[]>((todo as any).attachments || []);
  const [attToast,    setAttToast]    = useState('');
  const DOW_LABELS = ['日','月','火','水','木','金','土'];

  const toggleTag = (t: string) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  function showAttToast(msg: string) { setAttToast(msg); setTimeout(() => setAttToast(''), 2500); }
  function handleSave() {
    if (!title.trim()) return;
    onSave({ ...todo, title: title.trim(), startDate, endDate, time, tags, recurring: recurring || undefined, recurringDay: recurring ? recurringDay : undefined, attachments: attachments.length ? attachments : undefined });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div className="modal-title-row">
          <div className="modal-title">{mode === 'add' ? 'タスクを追加' : 'タスクを編集'}</div>
          {onDelete && (
            <button className="modal-title-delete" onClick={onDelete} aria-label="削除" title="削除">
              <IcoTrash />
            </button>
          )}
        </div>

        <div className="modal-field">
          <label>タイトル</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="タスク名" />
        </div>
        <div className="modal-row">
          <div className="modal-field">
            <label>開始日</label>
            <input type="date" value={startDate} onChange={e => {
              const sd = e.target.value;
              setStartDate(sd);
              if (endDate && sd > endDate) setEndDate(sd);
            }} />
          </div>
          <div className="modal-field">
            <label>終了日</label>
            <input type="date" value={endDate} onChange={e => {
              const ed = e.target.value;
              setEndDate(ed);
              if (startDate && ed < startDate) setStartDate(ed);
            }} />
          </div>
        </div>
        <div className="modal-field">
          <label>繰り返し</label>
          <div className="modal-tags">
            {RECURRING_OPTS.map(o => (
              <button key={o.value} className={`modal-tag${recurring === o.value ? ' sel' : ''}`} onClick={() => setRecurring(o.value)}>{o.label}</button>
            ))}
          </div>
          {(recurring === 'weekly' || recurring === 'biweekly') && (
            <div className="modal-field" style={{ marginTop: 8, marginBottom: 0 }}>
              <label>曜日</label>
              <div className="modal-tags">
                {DOW_LABELS.map((d, i) => (
                  <button key={i} className={`modal-tag${recurringDay === i ? ' sel' : ''}`} onClick={() => setRecurringDay(i)}>{d}</button>
                ))}
              </div>
            </div>
          )}
          {recurring === 'monthly' && (
            <div className="modal-field" style={{ marginTop: 8, marginBottom: 0 }}>
              <label>日</label>
              <div className="modal-day-picker">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <button key={d} className={`modal-day-btn${recurringDay === d ? ' sel' : ''}`} onClick={() => setRecurringDay(d)}>{d}</button>
                ))}
              </div>
            </div>
          )}
          {recurring && (
            <div className="modal-recurring-note">
              {startDate ? `${startDate} から` : '開始日'} {endDate ? `${endDate} まで` : '（終了日未設定 → 最大6ヶ月）'}に展開されます
            </div>
          )}
        </div>
        <div className="modal-field">
          <label>時間</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} />
        </div>
        <div className="modal-field">
          <label>タグ</label>
          <div className="modal-tags">
            {tagOptions.map(t => (
              <button key={t} className={`modal-tag${tags.includes(t) ? ' sel' : ''}`} onClick={() => toggleTag(t)}>{t}</button>
            ))}
          </div>
        </div>
        <AttachmentSection attachments={attachments} onChange={setAttachments} toast={showAttToast} />
        {attToast && <div className="modal-att-toast">{attToast}</div>}
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>キャンセル</button>
          <button className="modal-save" onClick={handleSave}>{mode === 'add' ? (recurring ? '展開して追加' : '追加') : (recurring ? '展開して保存' : '保存')}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Idea Edit Modal
// ─────────────────────────────────────────────────────────────
function IdeaEditModal({ idea, mode = 'edit', projects, onSave, onClose, customTags = [], ideaTabs = [] }: {
  idea: Idea | (IdeaDraft & { id: string });
  mode?: 'add' | 'edit';
  projects: string[];
  onSave: (i: any) => void;
  onClose: () => void;
  customTags?: string[];
  ideaTabs?: string[];
}) {
  useDismissable(onClose);
  const tagOptions = getIdeaTagOptions(customTags);
  const [projectName, setProjectName] = useState(idea.projectName || '');
  const [summary,     setSummary]     = useState(idea.summary || '');
  const [details,     setDetails]     = useState((idea.details || []).join('\n'));
  const [tags,        setTags]        = useState<string[]>(idea.tags || []);
  const [subTab,      setSubTab]      = useState((idea as any).subTab || '');
  const [attachments, setAttachments] = useState<Attachment[]>((idea as any).attachments || []);
  const [attToast,    setAttToast]    = useState('');

  const toggleTag = (t: string) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  function showAttToast(msg: string) { setAttToast(msg); setTimeout(() => setAttToast(''), 2500); }
  function handleSave() {
    if (!projectName.trim()) return;
    onSave({
      ...idea,
      projectName: projectName.trim(),
      summary: summary.trim(),
      details: details.split('\n').map(s => s.trim()).filter(Boolean),
      tags,
      subTab: subTab || undefined,
      attachments: attachments.length ? attachments : undefined,
    });
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div className="modal-title">{mode === 'add' ? 'ナレッジを追加' : 'ナレッジを編集'}</div>

        <div className="modal-field">
          <label>プロジェクト</label>
          <input list="idea-projects-dl" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="プロジェクト名" />
          <datalist id="idea-projects-dl">
            {projects.filter(p => p && p !== projectName).map(p => <option key={p} value={p} />)}
          </datalist>
        </div>
        <div className="modal-field">
          <label>概要</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="ナレッジの概要" />
        </div>
        <div className="modal-field">
          <label>詳細（1行1項目）</label>
          <textarea value={details} onChange={e => setDetails(e.target.value)} placeholder="箇条書きで詳細を..." rows={4} />
        </div>
        <div className="modal-field">
          <label>タグ</label>
          <div className="modal-tags">
            {tagOptions.map(t => (
              <button key={t} className={`modal-tag${tags.includes(t) ? ' sel' : ''}`} onClick={() => toggleTag(t)}>{t}</button>
            ))}
          </div>
        </div>
        {ideaTabs.length > 0 && (
          <div className="modal-field">
            <label>サブタブ</label>
            <select value={subTab} onChange={e => setSubTab(e.target.value)}>
              <option value="">（未分類）</option>
              {ideaTabs.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        <AttachmentSection attachments={attachments} onChange={setAttachments} toast={showAttToast} />
        {attToast && <div className="modal-att-toast">{attToast}</div>}
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>キャンセル</button>
          <button className="modal-save" onClick={handleSave}>{mode === 'add' ? '追加' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Todo Item
// ─────────────────────────────────────────────────────────────
const SPARK_POS = [
  { dx: 30, dy: 0, bg: 'var(--accent)' },
  { dx: 21, dy: -21, bg: '#FFD700' },
  { dx: 0, dy: -30, bg: 'var(--accent)' },
  { dx: -21, dy: -21, bg: '#FF69B4' },
  { dx: -30, dy: 0, bg: 'var(--accent)' },
  { dx: -21, dy: 21, bg: '#FFD700' },
  { dx: 0, dy: 30, bg: '#FF69B4' },
  { dx: 21, dy: 21, bg: 'var(--accent)' },
];

function TodoItem({ todo, onToggle, onDelete, onEdit, soundEnabled, soundType = 'doremi', overdue }: {
  todo: Todo;
  onToggle: (id: number | string) => void;
  onDelete: (id: number | string) => void;
  onEdit: (t: Todo) => void;
  soundEnabled: boolean;
  soundType?: string;
  overdue?: boolean;
}) {
  const [animating, setAnimating] = useState(false);
  const [sparkling, setSparkling] = useState(false);
  const justAdded = !!todo.addedAt && (Date.now() - todo.addedAt) < 800;

  function handleToggle() {
    if (!todo.done) {
      setAnimating(true);
      setSparkling(true);
      if (soundEnabled) playSound(soundType);
      setTimeout(() => setAnimating(false), 600);
      setTimeout(() => setSparkling(false), 700);
    }
    onToggle(todo.id);
  }
  return (
    <div className={`todo-item${todo.done ? ' done' : ''}${animating ? ' animate-fade' : ''}${justAdded ? ' just-added' : ''}${overdue ? ' overdue' : ''}`}>
      {sparkling && (
        <div className="todo-sparkle">
          {SPARK_POS.map(({ dx, dy, bg }, i) => (
            <span key={i} style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, background: bg, animationDelay: `${i * 20}ms` } as any} />
          ))}
        </div>
      )}
      <div className={`todo-check${todo.done ? ' checked' : ''}${animating ? ' animate-pop' : ''}`} onClick={handleToggle}>
        {todo.done && <IcoCheck />}
      </div>
      <div className="todo-body" onClick={() => onEdit(todo)}>
        <div className="todo-title">{todo.title}</div>
        <div className="todo-meta">
          {todo.startDate && (
            <span className="todo-date-str">
              <IcoCalSm />
              {todo.startDate}{todo.endDate ? ` — ${todo.endDate}` : ''}{todo.time ? `  ${todo.time}` : ''}
            </span>
          )}
          {(todo.tags || []).map(t => <span key={t} className="tag-pill">{t}</span>)}
          {todo.coinReward != null && (
            <span className="todo-coin-reward">🪙 +{todo.coinReward}</span>
          )}
        </div>
        <AttachmentRow attachments={todo.attachments || []} />
      </div>
      <button className="item-copy-btn" onClick={e => { e.stopPropagation(); copyToClipboard(buildTodoCopyText(todo)); }} title="コピー"><IcoCopy /></button>
      <button className="todo-del" onClick={() => onDelete(todo.id)}>✕</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirm Sheet
// ─────────────────────────────────────────────────────────────
function ConfirmSheet({
  pending, existingProjects, customTags, ideaTabs = [], swooshing,
  onUpdateTodo, onDeleteTodo, onUpdateIdea, onDeleteIdea, onConfirm, onCancel,
}: {
  pending: Pending;
  existingProjects: string[];
  customTags: string[];
  ideaTabs?: string[];
  swooshing: boolean;
  onUpdateTodo: (u: any) => void;
  onDeleteTodo: (id: string) => void;
  onUpdateIdea: (u: any) => void;
  onDeleteIdea: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useDismissable(onCancel);
  const [editingTodo, setEditingTodo] = useState<any>(null);
  const [editingIdea, setEditingIdea] = useState<any>(null);
  const total = pending.todos.length + pending.ideas.length;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={`confirm-sheet${swooshing ? ' swooshing' : ''}`}>
        <div className="modal-handle"/>
        <div className="confirm-header">
          <div className="confirm-title">追加内容を確認</div>
          <div className="confirm-sub">
            TODO {pending.todos.length}件・ナレッジ {pending.ideas.length}件 を抽出しました。タップで編集、✕で除外できます。
          </div>
        </div>
        <div className="confirm-list">
          {total === 0 && <div className="todo-empty">追加するアイテムがありません</div>}

          {pending.todos.length > 0 && <div className="confirm-section-head">TODO（{pending.todos.length}）</div>}
          {pending.todos.map(t => (
            <div key={t.id} className="todo-item">
              <div className="todo-body" onClick={() => setEditingTodo(t)}>
                <div className="todo-title">{t.title}</div>
                <div className="todo-meta">
                  {t.startDate && (
                    <span className="todo-date-str">
                      <IcoCalSm />
                      {t.startDate}{t.endDate && t.endDate !== t.startDate ? ` — ${t.endDate}` : ''}{t.time ? `  ${t.time}` : ''}
                    </span>
                  )}
                  {(t as any).recurring && (
                    <span className="tag-pill" style={{ background: '#e8f4fd', color: '#1565c0' }}>
                      ↻ {(t as any).recurring === 'daily' ? '毎日' : (t as any).recurring === 'weekly' ? '毎週' : (t as any).recurring === 'biweekly' ? '隔週' : '毎月'}
                    </span>
                  )}
                  {(t.tags || []).map(tag => <span key={tag} className="tag-pill">{tag}</span>)}
                  {t.coinReward != null && (
                    <span className="todo-coin-reward">🪙 +{t.coinReward}</span>
                  )}
                </div>
              </div>
              <button className="todo-del" onClick={() => onDeleteTodo(t.id)}>✕</button>
            </div>
          ))}

          {pending.ideas.length > 0 && <div className="confirm-section-head">ナレッジ（{pending.ideas.length}）</div>}
          {pending.ideas.map(i => {
            const isExisting = existingProjects.includes(i.projectName);
            return (
              <div key={i.id} className="todo-item">
                <div className="todo-body" onClick={() => setEditingIdea(i)}>
                  <div className="todo-title">{i.projectName}</div>
                  {isExisting && <span className="merge-indicator">既存『{i.projectName}』に追記</span>}
                  <div className="todo-meta">
                    {i.summary && <span className="todo-date-str" style={{ color: '#6a6a68' }}>{i.summary}</span>}
                    {(i.tags || []).map(tag => <span key={tag} className="tag-pill">{tag}</span>)}
                  </div>
                </div>
                <button className="todo-del" onClick={() => onDeleteIdea(i.id)}>✕</button>
              </div>
            );
          })}
        </div>
        <div className="confirm-actions">
          <button className="modal-cancel" onClick={onCancel}>キャンセル</button>
          <button className="modal-save" onClick={onConfirm} disabled={total === 0}>
            {total > 0 ? `${total}件を追加` : '追加'}
          </button>
        </div>
      </div>
      {editingTodo && (
        <EditModal
          todo={editingTodo}
          onSave={u => { onUpdateTodo(u); setEditingTodo(null); }}
          onClose={() => setEditingTodo(null)}
          customTags={customTags}
        />
      )}
      {editingIdea && (
        <IdeaEditModal
          idea={editingIdea}
          projects={existingProjects}
          onSave={u => { onUpdateIdea(u); setEditingIdea(null); }}
          onClose={() => setEditingIdea(null)}
          customTags={customTags}
          ideaTabs={ideaTabs}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sparkle Burst — fired on memo→items reflection success
// ─────────────────────────────────────────────────────────────
function SparkleBurst({ x, y }: { x: number; y: number }) {
  const sparks = Array.from({ length: 14 });
  return (
    <div className="sparkle-burst" style={{ left: x, top: y }}>
      {sparks.map((_, i) => {
        const angle = (i / sparks.length) * Math.PI * 2;
        const dist  = 70 + Math.random() * 30;
        const dx    = Math.cos(angle) * dist;
        const dy    = Math.sin(angle) * dist;
        const delay = Math.random() * 0.05;
        return (
          <span key={i} style={{
            ['--dx' as any]: `${dx}px`,
            ['--dy' as any]: `${dy}px`,
            animationDelay: `${delay}s`,
          }} />
        );
      })}
    </div>
  );
}

function formatHistoryDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (isToday) return `今日 ${t}`;
  if (isYest) return `昨日 ${t}`;
  return `${d.getMonth()+1}/${d.getDate()} ${t}`;
}

// ─────────────────────────────────────────────────────────────
// Memo Tab
// ─────────────────────────────────────────────────────────────
function MemoTab({ existingProjects, existingIdeaBriefs = [], customTags, aiCfg, ideaTabs = [], micTrigger = 0, splitReflectButtons = true, onCommit }: {
  existingProjects: string[];
  existingIdeaBriefs?: IdeaBrief[];
  customTags: string[];
  aiCfg: AiCfg;
  ideaTabs?: string[];
  micTrigger?: number;
  splitReflectButtons?: boolean;
  onCommit: (p: { todos: Todo[]; ideas: IdeaDraft[]; unlockCoins?: boolean }) => void;
}) {
  const [text,        setText]        = usePersistedState<string>('smartmemo:memo:draft', '');
  const [memoHistory, setMemoHistory] = usePersistedState<MemoHistoryItem[]>('smartmemo:memoHistory', []);
  const [showHistory, setShowHistory] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [loadingMsg,  setLMsg]        = useState('');
  const [recording,   setRec]         = useState(false);
  const [imgPrev,     setImgPrev]     = useState<string | null>(null);
  const [memoAttachments,  setMemoAttachments]  = useState<Attachment[]>([]);
  const [memoAttLightbox,  setMemoAttLightbox]  = useState<Attachment | null>(null);
  const [memoShowLink,     setMemoShowLink]     = useState(false);
  const [memoLinkUrl,      setMemoLinkUrl]      = useState('');
  const [toast,       setToast]       = useState<string | null>(null);
  const [pending,     setPending]     = useState<Pending | null>(null);
  const [swooshing,   setSwooshing]   = useState(false);
  const [burst,       setBurst]       = useState<{ x: number; y: number; key: number } | null>(null);
  const fileRef         = useRef<HTMLInputElement | null>(null);
  const memoAttRef      = useRef<HTMLInputElement | null>(null);
  const recRef          = useRef<any>(null);
  const tRef            = useRef<number | undefined>(undefined);
  const baseTextRef     = useRef('');
  const finalTextRef    = useRef('');
  const prevMicTriggerRef = useRef(micTrigger);
  useEffect(() => {
    if (micTrigger !== prevMicTriggerRef.current) {
      prevMicTriggerRef.current = micTrigger;
      toggleRec();
    }
  }, [micTrigger]);

  function showToast(msg: string) {
    setToast(msg);
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setToast(null), 2700);
  }

  async function toggleRec() {
    if (recording) {
      try {
        if (recRef.current?.kind === 'mediarecorder') recRef.current.recorder.stop();
        else recRef.current?.stop?.();
      } catch {}
      return;
    }

    const isSecure =
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
    if (!isSecure) {
      showToast('音声入力にはHTTPS接続が必要です（GitHub Pages等で公開すると使えます）');
      return;
    }

    if (aiAudioSupported(aiCfg)) {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        showToast('マイクの利用を許可してください');
        return;
      }

      const candidates = ['audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'];
      const mime = candidates.find(m =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)
      ) || '';
      let recorder: MediaRecorder;
      try {
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach(t => t.stop());
        showToast('録音を開始できませんでした');
        return;
      }

      const chunks: Blob[] = [];
      const captureMime = recorder.mimeType || mime || 'audio/webm';
      recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRec(false);
        const blob = new Blob(chunks, { type: captureMime });
        if (blob.size === 0) { showToast('音声が録音されませんでした'); return; }
        setLoading(true); setLMsg(`${AI_LABEL[aiCfg.provider]} で文字起こし中`);
        try {
          const transcript = await aiAudio(aiCfg, blob, captureMime);
          if (transcript) {
            setText(p => p ? p + '\n' + transcript : transcript);
            showToast('音声を文字起こししました');
          } else {
            showToast('文字起こし結果が空でした');
          }
        } catch (err) {
          console.error('[AI audio]', err);
          showToast('文字起こしに失敗しました');
        }
        setLoading(false);
      };

      try {
        recorder.start();
        recRef.current = { kind: 'mediarecorder', recorder, stream };
        setRec(true);
      } catch {
        stream.getTracks().forEach(t => t.stop());
        showToast('録音を開始できませんでした');
      }
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast('このブラウザは音声入力に未対応です（設定でAI APIキーを登録すると利用可能）');
      return;
    }
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch {
        showToast('マイクの利用を許可してください');
        return;
      }
    }
    let r: any;
    try {
      r = new SR();
      r.lang = 'ja-JP';
      r.interimResults = true;
      r.continuous = true;
    } catch {
      showToast('音声入力の起動に失敗しました');
      return;
    }
    baseTextRef.current  = text;
    finalTextRef.current = '';
    r.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTextRef.current += t;
        else interim += t;
      }
      const base = baseTextRef.current;
      const sep  = base && (finalTextRef.current || interim) ? '\n' : '';
      setText(base + sep + finalTextRef.current + interim);
    };
    r.onerror = (e: any) => {
      const map: Record<string, string> = {
        'no-speech':           '音声が検出されませんでした',
        'audio-capture':       'マイクが見つかりません',
        'not-allowed':         'マイクの利用が拒否されました',
        'network':             'ネットワーク接続が必要です（音声認識はオンライン必須）',
        'service-not-allowed': '音声認識サービスが利用できません',
      };
      const msg = map[e.error];
      if (msg) showToast(msg);
      setRec(false);
    };
    r.onend = () => {
      const base = baseTextRef.current;
      const sep  = base && finalTextRef.current ? '\n' : '';
      if (finalTextRef.current) setText(base + sep + finalTextRef.current);
      setRec(false);
    };
    try {
      r.start();
      recRef.current = r;
      setRec(true);
    } catch {
      showToast('音声入力を開始できませんでした');
    }
  }

  async function handleImg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const dataUrl = (ev.target?.result as string) || '';
      setImgPrev(dataUrl);
      const claude = (typeof window !== 'undefined' && (window as any).claude && (window as any).claude.complete);
      if (!aiConfigured(aiCfg) && !claude) {
        showToast('画像OCRには AI の APIキー（設定）が必要です');
        return;
      }
      setLoading(true);
      setLMsg(aiConfigured(aiCfg) ? `${AI_LABEL[aiCfg.provider]} で画像から文字を抽出中` : '画像からテキストを抽出中');
      try {
        const b64 = dataUrl.split(',')[1];
        let result = '';
        if (aiConfigured(aiCfg)) {
          result = await aiVision(
            aiCfg,
            'この画像に写っているテキストをすべて抽出してください。テキストのみを返してください。',
            b64,
            file.type
          );
        } else if (claude) {
          result = await (window as any).claude.complete({ messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
            { type: 'text',  text: 'この画像に写っているテキストをすべて抽出してください。テキストのみを返してください。' }
          ] }] });
        }
        if (result) {
          setText(p => p ? p + '\n' + result : result);
          showToast('画像からテキストを抽出しました');
        } else {
          showToast('テキストを抽出できませんでした');
        }
      } catch (err) {
        console.error('[OCR]', err);
        showToast('画像解析に失敗しました');
      }
      setLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function reflect(originX: number, originY: number, mode: 'todo' | 'idea' | 'both' = 'both') {
    if (!text.trim()) { showToast('メモを入力してください'); return; }
    setMemoHistory(h => [{ id: Date.now(), text: text.trim(), savedAt: Date.now(), attachments: memoAttachments.length ? memoAttachments : undefined }, ...h].slice(0, 100));
    setLoading(true);
    setLMsg(mode === 'todo' ? 'AI で TODO に変換中' : mode === 'idea' ? 'AI でナレッジに変換中' : 'AI で TODO とナレッジに自動分類中');
    try {
      const result = await parseMemoToItems(text, existingProjects, aiCfg, mode, existingIdeaBriefs);
      const todos = result.todos || [];
      const ideas = result.ideas || [];

      const ts = Date.now();
      const sharedAtts = memoAttachments.length ? memoAttachments : undefined;
      const todoDrafts = todos.map((t, i) => {
        const sd = t.startDate || '';
        const ed = t.endDate || '';
        const autoSD = sd || ed || todayStr;
        const autoED = ed || sd || todayStr;
        const rec = (['daily', 'weekly', 'biweekly', 'monthly'] as const).includes(t.recurring as any) ? t.recurring as TodoDraft['recurring'] : undefined;
        const rd = typeof t.recurringDay === 'number' && !isNaN(t.recurringDay) ? t.recurringDay : undefined;
        return {
          title: t.title || 'タスク',
          startDate: autoSD,
          endDate: autoED,
          time: t.time || '',
          tags: t.tags || [],
          id: `t_${ts}_${i}`,
          done: false as const,
          coinReward: t.coinReward,
          recurring: rec,
          recurringDay: rec ? rd : undefined,
          attachments: sharedAtts,
        };
      });
      const ideaDrafts = ideas.map((i, idx) => ({
        projectName: i.projectName || 'メモ',
        summary: i.summary || '',
        details: i.details || [],
        tags: (i.tags && i.tags.length ? i.tags : ['アイデア']),
        id: `i_${ts}_${idx}`,
        attachments: sharedAtts,
      }));

      if (!todoDrafts.length && !ideaDrafts.length) throw new Error('empty');
      setBurst({ x: originX, y: originY, key: ts });
      setTimeout(() => setBurst(null), 950);
      setPending({ todos: todoDrafts, ideas: ideaDrafts });
    } catch {
      showToast('解析に失敗しました。再試行してください。');
    }
    setLoading(false);
  }

  function confirmPending() {
    if (!pending) return;
    setSwooshing(true);
    const textSnapshot = text;
    // Clear memo immediately so it persists to localStorage before tab may switch
    setText(''); setImgPrev(null); setMemoAttachments([]);
    setTimeout(() => {
      const stamp = Date.now();
      const newTodos: Todo[] = pending.todos.flatMap(t => expandRecurringDraft(t, stamp));
      const newIdeas: IdeaDraft[] = pending.ideas.map(i => ({
        projectName: i.projectName,
        summary: i.summary,
        details: i.details,
        tags: i.tags,
        attachments: i.attachments,
        coinReward: i.coinReward,
      }));
      onCommit({ todos: newTodos, ideas: newIdeas, unlockCoins: textSnapshot.includes('coinzackzack') });
      showToast(`${newTodos.length + newIdeas.length}件を追加しました`);
      setPending(null); setSwooshing(false);
    }, 320);
  }

  return (
    <div className="memo-tab tab-pane">
      {loading && <div className="loading-overlay"><div className="spinner"/><div className="loading-text">{loadingMsg}</div><div className="loading-sub">少々お待ちください</div></div>}
      {toast && <div className="toast">{toast}</div>}
      {burst && <SparkleBurst key={burst.key} x={burst.x} y={burst.y} />}
      {pending && (
        <ConfirmSheet
          pending={pending}
          existingProjects={existingProjects}
          customTags={customTags}
          ideaTabs={ideaTabs}
          swooshing={swooshing}
          onUpdateTodo={u => setPending(p => p && ({ ...p, todos: p.todos.map(t => t.id === u.id ? u : t) }))}
          onDeleteTodo={id => setPending(p => p && ({ ...p, todos: p.todos.filter(t => t.id !== id) }))}
          onUpdateIdea={u => setPending(p => p && ({ ...p, ideas: p.ideas.map(t => t.id === u.id ? u : t) }))}
          onDeleteIdea={id => setPending(p => p && ({ ...p, ideas: p.ideas.filter(t => t.id !== id) }))}
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      <div className="memo-card">
        <div className="memo-card-top">
          <span className="memo-card-label">メモ</span>
          <span className="memo-char-count">{text.length}</span>
        </div>
        {imgPrev && (
          <div className="img-preview">
            <img src={imgPrev} alt="" />
            <button className="img-clear" onClick={() => setImgPrev(null)}>✕</button>
          </div>
        )}
        <div className="memo-textarea-wrap">
          <textarea className="memo-textarea" placeholder={"思いついたことを自由に入力\n例：来週月曜から水曜まで出張。にんじん・じゃがいも・玉ねぎを買う"} value={text} onChange={e => setText(e.target.value)} />
          {text.trim() && (
            <button
              className="memo-clear-btn"
              onClick={() => { setText(''); setImgPrev(null); setMemoAttachments([]); }}
              title="メモをクリア"
            >✕</button>
          )}
        </div>
        {memoAttLightbox && <AttachmentLightbox attachment={memoAttLightbox} onClose={() => setMemoAttLightbox(null)} />}
        {memoAttachments.length > 0 && (
          <div className="memo-att-list">
            {memoAttachments.map(a => (
              <div key={a.id} className="memo-att-chip">
                {a.mime.startsWith('image/')
                  ? <img src={a.data} className="memo-att-thumb" alt={a.name} onClick={() => setMemoAttLightbox(a)} />
                  : a.mime === 'text/x-url'
                  ? <div className="memo-att-file-chip" onClick={() => window.open(a.data, '_blank')}><span>🔗</span><span className="memo-att-file-name">{a.name || getLinkLabel(a.data)}</span></div>
                  : <div className="memo-att-file-chip" onClick={() => openOrPreview(a, setMemoAttLightbox)}><span>{attFileIco(a.mime)}</span><span className="memo-att-file-name">{a.name}</span></div>
                }
                <button className="memo-att-remove" onClick={() => setMemoAttachments(p => p.filter(x => x.id !== a.id))}>✕</button>
              </div>
            ))}
          </div>
        )}
        {memoShowLink && (
          <div className="attachment-link-input-row" style={{ margin: '0 0 0', padding: '6px 12px', borderTop: '1px solid #ebebea' }}>
            <input type="url" className="attachment-link-url" placeholder="https://..."
              value={memoLinkUrl} onChange={e => setMemoLinkUrl(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') {
                  const raw = memoLinkUrl.trim();
                  if (!raw) return;
                  const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
                  setMemoAttachments(p => [...p, { id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: getLinkLabel(url), mime: 'text/x-url', data: url }]);
                  setMemoLinkUrl(''); setMemoShowLink(false);
                }
                // 外側のモーダルまで閉じないよう伝播を止める
                if (e.key === 'Escape') { e.stopPropagation(); setMemoShowLink(false); setMemoLinkUrl(''); }
              }}
              autoFocus
            />
            <button className="attachment-link-confirm" onClick={() => {
              const raw = memoLinkUrl.trim();
              if (!raw) return;
              const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
              setMemoAttachments(p => [...p, { id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: getLinkLabel(url), mime: 'text/x-url', data: url }]);
              setMemoLinkUrl(''); setMemoShowLink(false);
            }}>追加</button>
            <button className="attachment-link-cancel" onClick={() => { setMemoShowLink(false); setMemoLinkUrl(''); }}>✕</button>
          </div>
        )}
        <div className="memo-actions">
          <button className={`action-btn${recording ? ' recording' : ''}`} onClick={toggleRec}>
            {recording ? <><span className="pulse-dot"/>録音停止</> : <><IcoMic />音声入力</>}
          </button>
          <button className="action-btn" onClick={() => fileRef.current?.click()}><IcoImg />画像から入力</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />
          <button className="action-btn" onClick={() => {
            if (memoAttachments.length >= MAX_ATTACHMENTS) { showToast('添付ファイルは最大5件です'); return; }
            memoAttRef.current?.click();
          }}>📎 添付{memoAttachments.length > 0 && <span className="memo-att-badge">{memoAttachments.length}</span>}</button>
          <input ref={memoAttRef} type="file" multiple accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx" style={{ display: 'none' }} onChange={async e => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            const remaining = MAX_ATTACHMENTS - memoAttachments.length;
            const toAdd: Attachment[] = [];
            for (const file of files.slice(0, remaining)) {
              if (!file.type.startsWith('image/') && file.size > MAX_FILE_BYTES) { showToast(`${file.name} はサイズが大きすぎます（最大3MB）`); continue; }
              const raw = await readFileAsDataUrl(file);
              const data = file.type.startsWith('image/') ? await compressImage(raw) : raw;
              toAdd.push({ id: `att_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: file.name, mime: file.type, data });
            }
            if (toAdd.length) setMemoAttachments(p => [...p, ...toAdd]);
          }} />
          <button className="action-btn" onClick={() => {
            if (memoAttachments.length >= MAX_ATTACHMENTS) { showToast('添付ファイルは最大5件です'); return; }
            setMemoShowLink(true);
          }}>🔗 リンク</button>
          <button className="action-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowHistory(true)}><IcoHistory />履歴</button>
        </div>
      </div>

      <div className="reflect-actions">
        {splitReflectButtons
          ? (['todo', 'idea'] as const).map(mode => (
              <button
                key={mode}
                className={`reflect-btn${mode === 'idea' ? ' reflect-btn-idea' : ''}`}
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const parent = (e.currentTarget.closest('.memo-tab') as HTMLElement | null)?.getBoundingClientRect();
                  const x = r.left + r.width / 2 - (parent?.left || 0);
                  const y = r.top  + r.height / 2 - (parent?.top  || 0);
                  reflect(x, y, mode);
                }}
                disabled={loading}
              >
                <IcoSparkle /> {mode === 'todo' ? 'TODOに反映' : 'ナレッジに反映'}
              </button>
            ))
          : (
              <button
                className="reflect-btn"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const parent = (e.currentTarget.closest('.memo-tab') as HTMLElement | null)?.getBoundingClientRect();
                  const x = r.left + r.width / 2 - (parent?.left || 0);
                  const y = r.top  + r.height / 2 - (parent?.top  || 0);
                  reflect(x, y, 'both');
                }}
                disabled={loading}
              >
                <IcoSparkle /> AI で TODO・ナレッジに反映
              </button>
            )}
      </div>
      {showHistory && (
        <Dismissable onClose={() => setShowHistory(false)}>
        <div className="modal-backdrop" onClick={() => setShowHistory(false)}>
          <div className="memo-history-sheet" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="memo-history-header">
              <span className="modal-title" style={{ marginBottom: 0 }}>メモ履歴</span>
              {memoHistory.length > 0 && (
                <button className="memo-history-clear" onClick={() => setMemoHistory([])}>全削除</button>
              )}
            </div>
            {memoHistory.length === 0 ? (
              <div className="memo-history-empty">履歴はありません</div>
            ) : (
              <div className="memo-history-list">
                {memoHistory.map(item => (
                  <div key={item.id} className="memo-history-item" onClick={() => { setText(item.text); if (item.attachments?.length) setMemoAttachments(item.attachments); setShowHistory(false); }}>
                    <div className="memo-history-info">
                      <div className="memo-history-date">{formatHistoryDate(item.savedAt)}{item.attachments?.length ? ` · 📎${item.attachments.length}` : ''}</div>
                      <div className="memo-history-text">{item.text.length > 100 ? item.text.slice(0, 100) + '…' : item.text}</div>
                    </div>
                    <button className="memo-history-del" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setMemoHistory(h => h.filter(x => x.id !== item.id)); }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </Dismissable>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TODO Tab
// ─────────────────────────────────────────────────────────────
function TrashModal({ trash, onRestore, onDelete, onEmpty, onClose }: {
  trash: TrashedTodo[];
  onRestore: (id: number | string) => void;
  onDelete: (id: number | string) => void;
  onEmpty: () => void;
  onClose: () => void;
}) {
  useDismissable(onClose);
  function formatTrashedDate(ts: number) {
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="memo-history-sheet">
        <div className="modal-handle"/>
        <div className="memo-history-header">
          <span className="modal-title" style={{ marginBottom: 0 }}>🗑 ゴミ箱</span>
          {trash.length > 0 && <button className="memo-history-clear" onClick={onEmpty}>全削除</button>}
        </div>
        {trash.length === 0
          ? <div className="memo-history-empty">ゴミ箱は空です</div>
          : <div className="memo-history-list">
              {trash.map(t => (
                <div key={t.id} className="trash-item">
                  <div className="trash-item-info" onClick={() => { onRestore(t.id); onClose(); }}>
                    <div className="trash-item-title">{t.title}</div>
                    <div className="memo-history-date">{formatTrashedDate(t.trashedAt)}{t.startDate ? ` · ${t.startDate}` : ''}</div>
                  </div>
                  <button className="trash-restore-btn" onClick={() => { onRestore(t.id); onClose(); }}>元に戻す</button>
                  <button className="memo-history-del" onClick={() => onDelete(t.id)}>✕</button>
                </div>
              ))}
            </div>
        }
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TodoSet Modals
// ─────────────────────────────────────────────────────────────
function TodoSetItemEditor({ item, onChange, onDelete, customTags }: {
  item: TodoSetItem;
  onChange: (item: TodoSetItem) => void;
  onDelete: () => void;
  customTags: string[];
}) {
  const tagOptions = getTodoTagOptions(customTags);
  const toggleTag = (t: string) =>
    onChange({ ...item, tags: item.tags.includes(t) ? item.tags.filter(x => x !== t) : [...item.tags, t] });
  return (
    <div className="ts-item-row">
      <input
        className="ts-item-input"
        value={item.title}
        onChange={e => onChange({ ...item, title: e.target.value })}
        placeholder="タスク名"
      />
      <div className="ts-item-tags">
        {tagOptions.map(t => (
          <button key={t} className={`ts-tag-btn${item.tags.includes(t) ? ' sel' : ''}`} onClick={() => toggleTag(t)}>{t}</button>
        ))}
      </div>
      <button className="ts-item-del" onClick={onDelete}>✕</button>
    </div>
  );
}

function TodoSetPickerModal({ todos, selectedIds, onToggle, onClose }: {
  todos: Todo[];
  selectedIds: Set<string>;
  onToggle: (id: string, title: string, tags: string[]) => void;
  onClose: () => void;
}) {
  useDismissable(onClose);
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-title">既存のTODOから選択</div>
        <div className="ts-picker-list">
          {todos.length === 0 && <div className="todo-empty">TODOがありません</div>}
          {todos.map(t => {
            const sid = String(t.id);
            const checked = selectedIds.has(sid);
            return (
              <div key={t.id} className={`ts-picker-row${checked ? ' sel' : ''}`} onClick={() => onToggle(sid, t.title, t.tags || [])}>
                <span className="ts-picker-check">{checked ? '✓' : ''}</span>
                <span className="ts-picker-title">{t.title}</span>
                <span className="ts-picker-tags">{(t.tags || []).map(tag => <span key={tag} className="tag-pill">{tag}</span>)}</span>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="modal-save" style={{ width:'100%' }} onClick={onClose}>完了</button>
        </div>
      </div>
    </div>
  );
}

function TodoSetEditModal({ set, allTodos, onSave, onClose, customTags }: {
  set?: TodoSet;
  allTodos: Todo[];
  onSave: (s: TodoSet) => void;
  onClose: () => void;
  customTags: string[];
}) {
  useDismissable(onClose);
  const [name, setName] = useState(set?.name ?? '');
  const [items, setItems] = useState<TodoSetItem[]>(set?.items ?? []);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());

  function addBlank() {
    setItems(p => [...p, { title: '', tags: [] }]);
  }
  function updateItem(idx: number, item: TodoSetItem) {
    setItems(p => p.map((x, i) => i === idx ? item : x));
  }
  function deleteItem(idx: number) {
    setItems(p => p.filter((_, i) => i !== idx));
  }
  function togglePicked(id: string, title: string, tags: string[]) {
    setPickedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setItems(p => p.filter(x => x.title !== title));
      } else {
        next.add(id);
        setItems(p => [...p, { title, tags: [...tags] }]);
      }
      return next;
    });
  }
  function handleSave() {
    if (!name.trim()) return;
    const validItems = items.filter(x => x.title.trim());
    if (validItems.length === 0) return;
    onSave({
      id: set?.id ?? `ts-${Date.now()}`,
      name: name.trim(),
      items: validItems,
      createdAt: set?.createdAt ?? Date.now(),
    });
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-title">{set ? 'セットを編集' : '新しいセットを作成'}</div>
        <div className="modal-field">
          <label>セット名</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例：朝のルーティン" />
        </div>
        <div className="modal-field">
          <label>タスク一覧</label>
          <div className="ts-items-list">
            {items.map((item, idx) => (
              <TodoSetItemEditor key={idx} item={item} onChange={it => updateItem(idx, it)} onDelete={() => deleteItem(idx)} customTags={customTags} />
            ))}
          </div>
          <div className="ts-add-btns">
            <button className="ts-add-btn" onClick={addBlank}>＋ タスクを追加</button>
            <button className="ts-add-btn ts-add-btn-pick" onClick={() => setShowPicker(true)}>📋 既存TODOから選択</button>
          </div>
        </div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>キャンセル</button>
          <button className="modal-save" onClick={handleSave} disabled={!name.trim() || items.filter(x => x.title.trim()).length === 0}>保存</button>
        </div>
      </div>
      {showPicker && (
        <TodoSetPickerModal
          todos={allTodos}
          selectedIds={pickedIds}
          onToggle={togglePicked}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

function TodoSetListModal({ sets, allTodos, onApply, onSave, onDelete, onClose, customTags }: {
  sets: TodoSet[];
  allTodos: Todo[];
  onApply: (s: TodoSet) => void;
  onSave: (s: TodoSet) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  customTags: string[];
}) {
  useDismissable(onClose);
  const [editing, setEditing] = useState<TodoSet | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet ts-list-sheet">
        <div className="modal-handle" />
        <div className="modal-title">TODOセット</div>
        {sets.length === 0 && (
          <div className="todo-empty" style={{ padding:'24px 0' }}>セットがまだありません</div>
        )}
        <div className="ts-set-list">
          {sets.map(s => (
            <div key={s.id} className="ts-set-card">
              <div className="ts-set-info">
                <span className="ts-set-name">📋 {s.name}</span>
                <span className="ts-set-count">{s.items.length}件</span>
              </div>
              <div className="ts-set-preview">
                {s.items.slice(0, 3).map((it, i) => <span key={i} className="ts-set-preview-item">{it.title}</span>)}
                {s.items.length > 3 && <span className="ts-set-preview-more">+{s.items.length - 3}件</span>}
              </div>
              <div className="ts-set-actions">
                <button className="ts-apply-btn" onClick={() => { onApply(s); onClose(); }}>適用</button>
                <button className="ts-edit-btn" onClick={() => setEditing(s)}>編集</button>
                <button className="ts-del-btn" onClick={() => { if (window.confirm(`「${s.name}」を削除しますか？`)) onDelete(s.id); }}>削除</button>
              </div>
            </div>
          ))}
        </div>
        <button className="ts-create-btn" onClick={() => setCreating(true)}>＋ 新しいセットを作成</button>
      </div>
      {(creating || editing) && (
        <TodoSetEditModal
          set={editing}
          allTodos={allTodos}
          customTags={customTags}
          onSave={s => { onSave(s); setEditing(undefined); setCreating(false); }}
          onClose={() => { setEditing(undefined); setCreating(false); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Garden World（にわ）— docs/smartmemo-garden-v4_1.html のUI
// ─────────────────────────────────────────────────────────────
const GW_SLOTS = [0.28, 0.56, 0.82, 0.15, 0.42, 0.70, 0.34];
const GW_FLOWER_MAPS: string[][] = [
  ['..R.R..', '.RRRRR.', '.RCCCR.', '.RRRRR.', '...G...', '...G...', '.G.G...'],
  ['..R.R..', '.RRRRR.', 'RRCCCRR', '.RRRRR.', '...G...', '..GG...'],
];
const GW_FLOWER_PALS: Record<string, string>[] = [
  { R: '#F58AB0', C: '#FFE9A0', G: '#4E9E42' },
  { R: '#F5C242', C: '#FFF4D0', G: '#4E9E42' },
  { R: '#E86A6A', C: '#FFE0E0', G: '#4E9E42' },
  { R: '#9A8AE8', C: '#F0ECFF', G: '#4E9E42' },
];

function GwPix({ map, pal, px = 4 }: { map?: string[]; pal?: Record<string, string>; px?: number }) {
  if (!map || map.length === 0) return null;
  const p = pal || {};
  return (
    <div style={{ position: 'relative', width: (map[0]?.length ?? 0) * px, height: map.length * px }}>
      {map.flatMap((row, y) => [...row].map((ch, x) => ch === '.' ? null : (
        <i key={`${x}-${y}`} style={{ position: 'absolute', left: x * px, top: y * px, width: px, height: px, background: p[ch] }} />
      )))}
    </div>
  );
}

type GwTime = 'morning' | 'day' | 'evening' | 'night';
const GW_TIMES: GwTime[] = ['morning', 'day', 'evening', 'night'];
const GW_TIME_EMOJI: Record<GwTime, string> = { morning: '🌅', day: '☀️', evening: '🌇', night: '🌙' };
function gwTimeNow(): GwTime {
  const h = new Date().getHours();
  return h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'evening' : 'night';
}

const LIB_SHELF_COLORS = ['#D96A4A', '#4A9BD9', '#5CB25C', '#8A6ACB', '#D9A24A', '#C46A9A', '#5CB2A5'];
function libShade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, v - 38);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function gwHash(id: number | string): number {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function completionStreak(todos: Todo[]): number {
  const days = new Set(todos.filter(t => t.done && t.completedAt).map(t => t.completedAt!));
  let streak = 0;
  const d = new Date();
  if (!days.has(localDateStr(d))) d.setDate(d.getDate() - 1);
  while (days.has(localDateStr(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function GardenWorld({ signTodos, flowerTodos, streak, onComplete, onEdit, monLayer, onOpenFocus }: {
  signTodos: Todo[];
  flowerTodos: Todo[];
  streak: number;
  onComplete: (t: Todo) => void;
  onEdit: (t: Todo) => void;
  monLayer?: React.ReactNode;
  onOpenFocus?: () => void;
}) {
  const [timeOverride, setTimeOverride] = useState<GwTime | null>(null);
  const [pop, setPop] = useState<Todo | null>(null);
  const stars = useMemo(() =>
    Array.from({ length: 26 }, () => ({ left: Math.random() * 100, top: Math.random() * 55, delay: Math.random() * 2.4 })), []);
  const time = timeOverride ?? gwTimeNow();

  // pop対象が消えたら（完了・削除）閉じる
  useEffect(() => {
    if (pop && !signTodos.some(t => t.id === pop.id)) setPop(null);
  }, [signTodos, pop]);

  const signs = signTodos.slice(0, GW_SLOTS.length);

  return (
    <div className={`gw t-${time}`}>
      <div className="gw-sun" />
      <div className="gw-cloud gw-cloud1" />
      <div className="gw-cloud gw-cloud2" />
      <div className="gw-stars">
        {stars.map((s, i) => (
          <i key={i} style={{ left: `${s.left}%`, top: `${s.top}%`, animationDelay: `${s.delay}s` }} />
        ))}
      </div>
      <div className="gw-hill" />
      <div className="gw-ground" />
      <div className="gw-tree gw-nightdim">
        <div className="gw-leaf gw-l1" /><div className="gw-leaf gw-l2" /><div className="gw-leaf gw-l3" />
        <div className="gw-trunk" />
        {streak > 0 && <div className="gw-wchip">🔥 {streak}日連続</div>}
      </div>
      {signs.map((t, i) => (
        <div
          key={t.id}
          className={`gw-sign gw-nightdim gw-sprout${t.startDate && (t.endDate || t.startDate) < todayStr ? ' gw-withered' : ''}`}
          style={{ left: `${GW_SLOTS[i] * 100}%` }}
          onClick={() => setPop(t)}
        >
          <div className="gw-cointag">🪙{t.coinReward ?? 10}</div>
          {(t.attachments?.length ?? 0) > 0 && <div className="gw-clip">📎</div>}
          <div className="gw-board gw-dot">{t.title}</div>
          <div className="gw-pole" />
        </div>
      ))}
      {flowerTodos.map(t => {
        const h = gwHash(t.id);
        return (
          <div key={t.id} className="gw-flower gw-nightdim" style={{ left: `${8 + (h % 84)}%` }}>
            <GwPix map={GW_FLOWER_MAPS[(h >>> 0) % GW_FLOWER_MAPS.length]} pal={GW_FLOWER_PALS[(h >>> 3) % GW_FLOWER_PALS.length]} px={4} />
          </div>
        );
      })}
      {monLayer}
      {onOpenFocus && (
        <button className="gw-focus-btn" onClick={onOpenFocus}>⏱ 集中モード</button>
      )}
      <button
        className="gw-time-btn"
        title="時間帯を切り替え"
        onClick={() => setTimeOverride(prev => GW_TIMES[(GW_TIMES.indexOf(prev ?? gwTimeNow()) + 1) % GW_TIMES.length])}
      >{GW_TIME_EMOJI[time]}</button>
      {pop && (
        <div className="gw-popcard">
          <button className="gw-pop-close" onClick={() => setPop(null)}>✕</button>
          <h3>{pop.title}</h3>
          <div className="gw-pop-meta">
            {(pop.tags || []).map(tg => <span key={tg} className="gw-pop-tag">{tg}</span>)}
            <span className="gw-pop-coin">🪙 +{pop.coinReward ?? 10}</span>
            {pop.time && <span className="gw-pop-time">🕐 {pop.time}</span>}
          </div>
          <div className="gw-pop-btns">
            <button className="gw-pop-done" onClick={() => { const t = pop; setPop(null); onComplete(t); }}>できた！</button>
            <button className="gw-pop-edit" onClick={() => { const t = pop; setPop(null); onEdit(t); }}>編集</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TodoTab({ todos, boss, onBossComplete, onBossDismiss, onToggle, onDelete, onUpdate, onAdd, trash, onTrashRestore, onTrashDelete, onTrashEmpty, soundEnabled, soundType = 'doremi', customTags, todoSets, onSaveTodoSet, onDeleteTodoSet, holidayConfig, monLayer, onOpenFocus }: {
  todos: Todo[];
  boss?: { id: string; title: string; spawnedAt: number } | null;
  onBossComplete?: () => void;
  onBossDismiss?: () => void;
  onToggle: (id: number | string) => void;
  onDelete: (id: number | string) => void;
  onUpdate: (t: Todo) => void;
  onAdd: (t: Todo) => void;
  trash: TrashedTodo[];
  onTrashRestore: (id: number | string) => void;
  onTrashDelete: (id: number | string) => void;
  onTrashEmpty: () => void;
  soundEnabled: boolean;
  soundType?: string;
  customTags: string[];
  todoSets: TodoSet[];
  onSaveTodoSet: (s: TodoSet) => void;
  onDeleteTodoSet: (id: string) => void;
  holidayConfig?: HolidayConfig;
  monLayer?: React.ReactNode;
  onOpenFocus?: () => void;
}) {
  const [sel,          setSel]        = useState<string>(todayStr);
  const [editPicking,  setEditPicking] = useState<Todo | null>(null);
  const [editing,      setEditing]    = useState<{todo: Todo; scope: 'single' | 'all'} | null>(null);
  const [adding,       setAdding]     = useState(false);
  const [showTrash,    setShowTrash]  = useState(false);
  // カレンダー（スケジュール）は既定で閉じておき、必要なときだけ開く
  const [showCalendar, setShowCalendar] = useState(false);
  const [selTagsArr,   setSelTagsArr] = usePersistedState<string[]>('smartmemo:ui:tags', []);
  const [calendarMode, setCalendarMode] = usePersistedState<'month' | 'week'>('smartmemo:ui:calMode', 'month');
  const [undatedOpen,  setUndatedOpen]  = useState(true);
  const [showSets,     setShowSets]    = useState(false);

  const selectedTags = new Set(selTagsArr);
  const tagOptions = getTodoTagOptions(customTags);

  const filteredTodos = todos.filter(t =>
    selectedTags.size === 0 || (t.tags || []).some(tag => selectedTags.has(tag))
  );

  const overdueTodos = filteredTodos.filter(t => {
    if (t.done || !t.startDate) return false;
    return (t.endDate || t.startDate) < todayStr;
  });
  const overdueIds = new Set(overdueTodos.map(t => t.id));

  const dateTodos = filteredTodos.filter(t => {
    if (overdueIds.has(t.id as string)) return false;
    const r = todoDisplayRange(t);
    if (!r) return false;
    return sel >= r.start && sel <= r.end;
  });
  const sortedDateTodos = [...dateTodos.filter(t => !t.done), ...dateTodos.filter(t => t.done)];

  const undated       = filteredTodos.filter(t => todoDisplayRange(t) === null);
  const sortedUndated = [...undated.filter(t => !t.done), ...undated.filter(t => t.done)];

  const toggleTag = (tag: string) => {
    setSelTagsArr(prev => {
      const s = new Set(prev);
      if (s.has(tag)) s.delete(tag); else s.add(tag);
      return Array.from(s);
    });
  };

  function handleEditStart(todo: Todo) {
    if (todo.recurringGroupId) {
      setEditPicking(todo);
    } else {
      setEditing({ todo, scope: 'single' });
    }
  }

  const gardenSigns   = [...overdueTodos, ...sortedDateTodos].filter(t => !t.done);
  const gardenFlowers = dateTodos.filter(t => t.done);
  const streak = useMemo(() => completionStreak(todos), [todos]);
  const doneOfDay = dateTodos.filter(t => t.done).length;

  function gardenComplete(t: Todo) {
    if (soundEnabled) playSound(soundType);
    onToggle(t.id);
  }

  // ── タスクシートのドラッグ（上に引くと庭の絵を覆い隠す）──
  // .gw（庭）は flex:none、.gw-sheet は flex:1 なので、シートの margin-top を
  // マイナス方向に伸ばすとシートがせり上がり、その分だけ高さも広がって
  // 庭（メモモンのいる絵）を覆う。
  const gardenRootRef = useRef<HTMLDivElement | null>(null);
  const [sheetLift, setSheetLift] = useState(0);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetDragRef = useRef<{ startY: number; startLift: number; maxLift: number; moved: boolean } | null>(null);

  // シートは既定で庭に 18px 重ねている（CSS の margin-top:-18px）。
  // 引き上げ量の上限はその重なり分を差し引いた値。これを超えるとシートが
  // 庭の上端より上に行き、つまみがヘッダーの裏に隠れて戻せなくなる。
  const GW_SHEET_OVERLAP = 18;
  const maxSheetLift = () => {
    const gw = gardenRootRef.current?.querySelector('.gw') as HTMLElement | null;
    return gw ? Math.max(0, gw.clientHeight - GW_SHEET_OVERLAP) : 0;
  };

  // 画面回転などで庭の高さが変わったら、はみ出さないよう丸める
  useEffect(() => {
    const onResize = () => setSheetLift(prev => Math.min(prev, maxSheetLift()));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  useEffect(() => {
    if (!sheetDragging) return;
    const move = (e: PointerEvent) => {
      const d = sheetDragRef.current;
      if (!d) return;
      const dy = d.startY - e.clientY; // 上方向を正にする
      if (Math.abs(dy) > 3) d.moved = true;
      setSheetLift(Math.max(0, Math.min(d.maxLift, d.startLift + dy)));
    };
    const end = () => {
      const d = sheetDragRef.current;
      sheetDragRef.current = null;
      setSheetDragging(false);
      if (!d) return;
      if (!d.moved) {
        // ドラッグせずタップしたときは開閉をトグル
        setSheetLift(d.startLift > d.maxLift / 2 ? 0 : d.maxLift);
        return;
      }
      // 離した位置でスナップ（3割以上引き上げていれば庭を覆いきる）
      setSheetLift(prev => (prev > d.maxLift * 0.35 ? d.maxLift : 0));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [sheetDragging]);

  function onSheetGrabDown(e: React.PointerEvent) {
    // ポインタをつまみに固定する。これをしないと、シートが指の下から動いた
    // 瞬間にイベントの送り先が変わり、途中でドラッグが止まってしまう。
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    // テキスト選択やネイティブのドラッグが割り込むのを防ぐ
    e.preventDefault();
    sheetDragRef.current = { startY: e.clientY, startLift: sheetLift, maxLift: maxSheetLift(), moved: false };
    setSheetDragging(true);
  }

  return (
    <div className="todo-tab garden" ref={gardenRootRef}>
      {editPicking && (
        <Dismissable onClose={() => setEditPicking(null)}>
        <div className="modal-backdrop" onClick={() => setEditPicking(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle"/>
            <div className="modal-title">編集方法を選択</div>
            <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'8px 0 16px' }}>
              <button className="modal-save" onClick={() => { setEditing({ todo: editPicking, scope: 'single' }); setEditPicking(null); }}>この予定のみ編集</button>
              <button className="modal-save" onClick={() => {
                const groupId = editPicking.recurringGroupId!;
                const groupTodos = todos.filter(t => t.recurringGroupId === groupId);
                const startDate = groupTodos.map(t => t.startDate).sort()[0] || editPicking.startDate;
                const endDate = groupTodos.map(t => t.endDate).sort().reverse()[0] || editPicking.endDate;
                setEditing({ todo: { ...editPicking, startDate, endDate }, scope: 'all' });
                setEditPicking(null);
              }}>繰り返し全体を編集</button>
              <button className="modal-cancel" onClick={() => setEditPicking(null)}>キャンセル</button>
            </div>
          </div>
        </div>
        </Dismissable>
      )}
      {editing && <EditModal todo={editing.todo} onSave={t => {
        if (editing.scope === 'all') {
          const groupId = editing.todo.recurringGroupId!;
          todos.filter(u => u.recurringGroupId === groupId).forEach(u => onDelete(u.id));
          const stamp = Date.now();
          expandRecurringDraft(t, stamp, groupId).forEach(onAdd);
        } else if (t.recurring) {
          onDelete(t.id);
          const stamp = Date.now();
          expandRecurringDraft(t, stamp).forEach(onAdd);
        } else {
          onUpdate(t);
        }
        setEditing(null);
      }} onDelete={() => {
        if (editing.scope === 'all' && editing.todo.recurringGroupId) {
          const groupId = editing.todo.recurringGroupId;
          todos.filter(t => t.recurringGroupId === groupId).forEach(t => onDelete(t.id));
        } else {
          onDelete(editing.todo.id);
        }
        setEditing(null);
      }} onClose={() => setEditing(null)} customTags={customTags} />}
      {adding && <EditModal mode="add" todo={{ id: Date.now(), title: '', startDate: sel, endDate: sel, time: '', tags: [], done: false, addedAt: Date.now() }} onSave={t => {
        const tWithCoin = { ...t, coinReward: t.coinReward ?? estimateCoinReward(t.title, t.tags) };
        if (tWithCoin.recurring) {
          const stamp = Date.now();
          expandRecurringDraft(tWithCoin, stamp).forEach(onAdd);
        } else {
          onAdd(tWithCoin);
        }
        setAdding(false);
      }} onClose={() => setAdding(false)} customTags={customTags} />}
      <GardenWorld
        signTodos={gardenSigns}
        flowerTodos={gardenFlowers}
        streak={streak}
        onComplete={gardenComplete}
        onEdit={handleEditStart}
        monLayer={monLayer}
        onOpenFocus={onOpenFocus}
      />
      <div
        className={`gw-sheet${sheetDragging ? ' dragging' : ''}${sheetLift > 0 ? ' lifted' : ''}`}
        style={{ marginTop: -(18 + sheetLift) }}
      >
      <div
        className="gw-grab-zone"
        onPointerDown={onSheetGrabDown}
        role="button"
        tabIndex={0}
        aria-label={sheetLift > 0 ? 'タスクシートを下げて庭を表示' : 'タスクシートを上げて庭を隠す'}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheetLift(sheetLift > 0 ? 0 : maxSheetLift()); }
        }}
      >
        <div className="gw-grab" />
        {/* 引き上げるとタスク一覧が全画面になる、という手がかり。
            つまみ 1 本だけでは操作できることが伝わらず、実装済みの機能が
            使われないままになっていた。 */}
        <span className="gw-grab-hint">
          {sheetLift > 0
            ? <><IcoChevronDown />にわを見る</>
            : <><IcoChevronUp />タスク一覧</>}
        </span>
      </div>
      <div className="gw-sheet-head">
        <h2>{sel === todayStr ? 'きょうのタスク' : `${sel.slice(5).replace('-', '/')}のタスク`}</h2>
        <span className="gw-prog">{doneOfDay} / {dateTodos.length}</span>
      </div>
      <div className="gw-sheet-body">
      <div className="todo-pane-left">
        <div className="todo-controls">
          <div className="filter-tags">
            {tagOptions.map(tag => (
              <button key={tag} className={`filter-tag${selectedTags.has(tag) ? ' active' : ''}`} onClick={() => toggleTag(tag)}>
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="todo-list-header">
          <div style={{ display:'flex', alignItems:'center', gap:'7px', flex:1, minWidth:0 }}>
            <span className="section-head-label">{sel.replace(/-/g, '/')}</span>
            {sortedDateTodos.length > 0 && <span className="section-count">{sortedDateTodos.length}</span>}
          </div>
          <button className="cal-toggle" onClick={() => setShowCalendar(v => !v)} title={showCalendar ? 'スケジュールを非表示' : 'スケジュールを表示'}>
            <IcoCalendar />
            {showCalendar ? <IcoChevronUp /> : <IcoChevronDown />}
          </button>
        </div>
        <div className={`calendar-section${showCalendar ? '' : ' hide'}`}>
          <Calendar todos={filteredTodos} selectedDate={sel} onSelect={setSel} mode={calendarMode} onModeChange={setCalendarMode} holidayConfig={holidayConfig} />
        </div>
      </div>
      <div className="todo-pane-right">
        <div className="todo-list-area">
          {boss && <BossItem boss={boss} onComplete={onBossComplete || (() => {})} onDismiss={onBossDismiss || (() => {})} />}
          {overdueTodos.length > 0 && <>
            <div className="overdue-head">
              <span className="section-head-label">期限切れ</span>
              <span className="section-count">{overdueTodos.length}</span>
            </div>
            {overdueTodos.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={handleEditStart} soundEnabled={soundEnabled} soundType={soundType} overdue />)}
            <div className="divider"/>
          </>}
          {sortedDateTodos.length === 0
            ? <div className="todo-empty">この日のタスクはありません</div>
            : sortedDateTodos.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={handleEditStart} soundEnabled={soundEnabled} soundType={soundType} />)
          }
          {sortedUndated.length > 0 && <>
            <div className="divider"/>
            <div className="section-head undated-head" onClick={() => setUndatedOpen(o => !o)}>
              <span className="section-head-label">日付未定</span>
              <span className="section-count">{sortedUndated.length}</span>
              <span className="undated-arrow">{undatedOpen ? <IcoChevronUp /> : <IcoChevronDown />}</span>
            </div>
            <div className={`undated-body${undatedOpen ? '' : ' closed'}`}>
              {sortedUndated.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={handleEditStart} soundEnabled={soundEnabled} soundType={soundType} />)}
            </div>
          </>}
          <button className="todo-add-row" onClick={() => setAdding(true)}>
            ＋ タスクを追加
          </button>
          {/* 絵文字は OS ごとに絵柄も色も変わり、自作の線画アイコンと並ぶと
              揃わない。既存の Ico* に寄せる。 */}
          <button className="todo-set-open-btn" onClick={() => setShowSets(true)}>
            <IcoList /> TODOセット{todoSets.length > 0 && <span className="todo-set-count">{todoSets.length}</span>}
          </button>
          <button className="trash-open-btn" onClick={() => setShowTrash(true)}>
            <IcoTrash /> ゴミ箱{trash.length > 0 && <span className="trash-count">{trash.length}</span>}
          </button>
        </div>
      </div>
      </div>
      </div>
      {showTrash && <TrashModal trash={trash} onRestore={onTrashRestore} onDelete={onTrashDelete} onEmpty={onTrashEmpty} onClose={() => setShowTrash(false)} />}
      {showSets && (
        <TodoSetListModal
          sets={todoSets}
          allTodos={todos}
          customTags={customTags}
          onApply={s => {
            const stamp = Date.now();
            s.items.forEach((item, i) => onAdd({
              id: stamp + i,
              title: item.title,
              startDate: '', endDate: '', time: '',
              tags: item.tags,
              done: false,
              addedAt: stamp + i,
              coinReward: item.coinReward,
            }));
          }}
          onSave={onSaveTodoSet}
          onDelete={onDeleteTodoSet}
          onClose={() => setShowSets(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ideas Tab
// ─────────────────────────────────────────────────────────────
function IdeasTab({ ideas, aiCfg, onUpdate, onDelete, onAdd, onReorder, customTags, ideaTabs = [], onUpdateIdeaTabs }: {
  ideas: Idea[];
  aiCfg: AiCfg;
  onUpdate: (i: Idea) => void;
  onDelete: (id: number | string) => void;
  onAdd: (i: Idea) => void;
  onReorder: (fromId: number | string, toId: number | string) => void;
  customTags: string[];
  ideaTabs?: string[];
  onUpdateIdeaTabs?: (tabs: string[]) => void;
}) {
  const [editing,        setEditing]        = useState<Idea | null>(null);
  const [addingIdea,     setAddingIdea]     = useState(false);
  const [showChat,       setShowChat]       = useState(false);
  const [selectMode,     setSelectMode]     = useState(false);
  const [selectedIds,    setSelectedIds]    = useState<Set<number | string>>(new Set());
  const [libView,        setLibView]        = usePersistedState<'shelf' | 'list'>('smartmemo:ui:libView', 'shelf');
  const [libQuery,       setLibQuery]       = useState('');
  const [activeSubTab,   setActiveSubTab]   = usePersistedState<string>('smartmemo:ui:subTab', 'all');
  const [addingTab,      setAddingTab]      = useState(false);
  const [newTabName,     setNewTabName]     = useState('');
  const [dragTabIdx,     setDragTabIdx]     = useState<number | null>(null);
  const [dragOverTabIdx, setDragOverTabIdx] = useState<number | null>(null);
  const [dragIdeaId,     setDragIdeaId]     = useState<number | string | null>(null);
  const [dragOverIdeaId, setDragOverIdeaId] = useState<number | string | null>(null);
  const [touchDragId,    setTouchDragId]    = useState<number | string | null>(null);
  const [touchDragOverId,setTouchDragOverId]= useState<string | null>(null);
  const touchTimerRef    = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchActiveRef   = React.useRef(false);
  const ideasListRef     = React.useRef<HTMLDivElement | null>(null);

  // Non-passive touchmove listener so e.preventDefault() actually blocks scroll during drag
  useEffect(() => {
    const el = ideasListRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => { if (touchActiveRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);
  const justDraggedRef   = React.useRef(false);
  const [dropTabTarget,  setDropTabTarget]  = useState<string | null>(null);
  const projectNames = ideas.map(i => i.projectName);

  const filteredIdeas = activeSubTab === 'all'
    ? ideas.filter(i => !i.subTab)
    : ideas.filter(i => i.subTab === activeSubTab);

  function addTab() {
    const name = newTabName.trim();
    if (!name || ideaTabs.includes(name) || !onUpdateIdeaTabs) return;
    onUpdateIdeaTabs([...ideaTabs, name]);
    setActiveSubTab(name);
    setNewTabName('');
    setAddingTab(false);
  }
  function deleteTab(tab: string) {
    if (!onUpdateIdeaTabs) return;
    if (!window.confirm(`「${tab}」タブを削除しますか？\nこのタブのナレッジは未分類になります。`)) return;
    onUpdateIdeaTabs(ideaTabs.filter(t => t !== tab));
    if (activeSubTab === tab) setActiveSubTab('all');
    ideas.forEach(i => { if (i.subTab === tab) onUpdate({ ...i, subTab: undefined }); });
  }

  function onTabDragStart(e: React.DragEvent, idx: number) {
    e.dataTransfer.effectAllowed = 'move';
    setDragTabIdx(idx);
  }
  function onTabDragOver(e: React.DragEvent, idx: number) {
    if (dragTabIdx === null) return;
    e.preventDefault();
    setDragOverTabIdx(idx);
  }
  function onTabDrop(idx: number) {
    if (dragTabIdx === null || dragTabIdx === idx || !onUpdateIdeaTabs) { setDragTabIdx(null); setDragOverTabIdx(null); return; }
    const arr = [...ideaTabs];
    const [moved] = arr.splice(dragTabIdx, 1);
    arr.splice(idx, 0, moved);
    onUpdateIdeaTabs(arr);
    setDragTabIdx(null);
    setDragOverTabIdx(null);
  }
  function onTabDragEnd() { setDragTabIdx(null); setDragOverTabIdx(null); }

  function onIdeaDragStart(e: React.DragEvent, id: number | string) {
    e.dataTransfer.effectAllowed = 'move';
    setDragIdeaId(id);
  }
  function onIdeaDragEnd() { setDragIdeaId(null); setDropTabTarget(null); }
  function dropIdeaOnTab(e: React.DragEvent, target: string) {
    e.preventDefault();
    if (dragIdeaId == null) return;
    const idea = ideas.find(i => i.id === dragIdeaId);
    if (idea) onUpdate({ ...idea, subTab: target === 'all' ? undefined : target });
    setDragIdeaId(null);
    setDropTabTarget(null);
  }

  function onIdeaDragOverCard(e: React.DragEvent, id: number | string) {
    if (dragIdeaId == null || dragIdeaId === id) return;
    e.preventDefault();
    setDragOverIdeaId(id);
  }
  function onIdeaDropCard(e: React.DragEvent, toId: number | string) {
    e.preventDefault();
    if (dragIdeaId == null || dragIdeaId === toId) { setDragOverIdeaId(null); return; }
    onReorder(dragIdeaId, toId);
    setDragIdeaId(null);
    setDragOverIdeaId(null);
  }

  function onIdeaTouchStart(e: React.TouchEvent, id: number | string) {
    touchTimerRef.current = setTimeout(() => {
      touchActiveRef.current = true;
      setTouchDragId(id);
      (navigator as any).vibrate?.(30);
    }, 500);
  }
  function onIdeaTouchMove(e: React.TouchEvent) {
    if (!touchActiveRef.current) { clearTimeout(touchTimerRef.current!); touchTimerRef.current = null; return; }
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el?.closest('[data-idea-id]') as HTMLElement | null;
    const subtab = el?.closest('[data-subtab]') as HTMLElement | null;
    if (card) { setTouchDragOverId(card.getAttribute('data-idea-id')); setDropTabTarget(null); }
    else if (subtab) { setDropTabTarget(subtab.getAttribute('data-subtab')); setTouchDragOverId(null); }
  }
  function onIdeaTouchEnd() {
    clearTimeout(touchTimerRef.current!);
    touchTimerRef.current = null;
    if (touchActiveRef.current) {
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 200);
      if (touchDragOverId && touchDragId != null && String(touchDragId) !== touchDragOverId) {
        const toIdea = ideas.find(i => String(i.id) === touchDragOverId);
        if (toIdea) onReorder(touchDragId, toIdea.id);
      } else if (dropTabTarget && touchDragId != null) {
        const idea = ideas.find(i => i.id === touchDragId);
        if (idea) onUpdate({ ...idea, subTab: dropTabTarget === 'all' ? undefined : dropTabTarget });
      }
    }
    touchActiveRef.current = false;
    setTouchDragId(null);
    setTouchDragOverId(null);
    setDropTabTarget(null);
  }

  const subtabBar = (
    <div className="ideas-subtabs">
      <span
        data-subtab="all"
        className={`ideas-subtab${activeSubTab === 'all' ? ' active' : ''}${dropTabTarget === 'all' ? ' drop-target' : ''}`}
        onClick={() => setActiveSubTab('all')}
        onDragOver={e => { if (dragIdeaId != null) { e.preventDefault(); setDropTabTarget('all'); } }}
        onDragLeave={() => setDropTabTarget(null)}
        onDrop={e => dropIdeaOnTab(e, 'all')}
      >未分類</span>
      {ideaTabs.map((t, idx) => (
        <span
          key={t}
          data-subtab={t}
          draggable
          className={[
            'ideas-subtab',
            activeSubTab === t ? 'active' : '',
            dragTabIdx === idx ? 'dragging' : '',
            dragOverTabIdx === idx && dragTabIdx !== null && dragTabIdx !== idx ? 'drag-over' : '',
            dropTabTarget === t ? 'drop-target' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => setActiveSubTab(t)}
          onDragStart={e => onTabDragStart(e, idx)}
          onDragOver={e => { onTabDragOver(e, idx); if (dragIdeaId != null) { e.preventDefault(); setDropTabTarget(t); } }}
          onDragLeave={() => { setDragOverTabIdx(null); setDropTabTarget(null); }}
          onDrop={e => { if (dragIdeaId != null) { dropIdeaOnTab(e, t); } else { onTabDrop(idx); } }}
          onDragEnd={onTabDragEnd}
        >
          {t}
          <button className="ideas-subtab-del" onClick={e => { e.stopPropagation(); deleteTab(t); }}>×</button>
        </span>
      ))}
      <span className="ideas-subtab-add" title="タブを追加" onClick={() => setAddingTab(true)}>＋</span>
    </div>
  );

  const subtabInput = addingTab ? (
    <div className="ideas-subtab-input">
      <input
        autoFocus
        value={newTabName}
        onChange={e => setNewTabName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') addTab();
          // 外側のモーダルまで閉じないよう伝播を止める
          if (e.key === 'Escape') { e.stopPropagation(); setAddingTab(false); setNewTabName(''); }
        }}
        placeholder="タブ名を入力"
        maxLength={16}
      />
      <button onClick={addTab} disabled={!newTabName.trim()}>追加</button>
      <button className="cancel-btn" onClick={() => { setAddingTab(false); setNewTabName(''); }}>取消</button>
    </div>
  ) : null;

  // 検索（本棚・リスト共通）
  const searchedIdeas = filteredIdeas.filter(i =>
    !libQuery.trim() ||
    (i.projectName + ' ' + (i.summary || '') + ' ' + (i.details || []).join(' ') + ' ' + (i.tags || []).join(' ')).includes(libQuery.trim())
  );

  // ── 出力（エクスポート）: 複数選択して1つのテキストにまとめる ──
  function enterSelectMode() { setSelectMode(true); setSelectedIds(new Set()); setLibView('list'); }
  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()); }
  function toggleSelect(id: number | string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  const selectedIdeas = searchedIdeas.filter(i => selectedIds.has(i.id));
  const allSelected = searchedIdeas.length > 0 && searchedIdeas.every(i => selectedIds.has(i.id));
  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(searchedIdeas.map(i => i.id)));
  }
  function handleCopySelected() {
    if (!selectedIdeas.length) return;
    copyToClipboard(buildIdeasMarkdown(selectedIdeas));
  }
  function handleDownloadSelected() {
    if (!selectedIdeas.length) return;
    const base = selectedIdeas.length === 1
      ? (selectedIdeas[0].projectName || 'knowledge').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
      : `ナレッジ_${todayStr}`;
    downloadTextFile(`${base}.md`, buildIdeasMarkdown(selectedIdeas));
    window.dispatchEvent(new CustomEvent('app-toast', { detail: `Markdown を保存しました（${selectedIdeas.length}件）✓` }));
  }

  const ideaCards = searchedIdeas.map(i => {
    const justAdded = !!i.addedAt && (Date.now() - i.addedAt) < 800;
    const isTouchDragging = touchDragId === i.id;
    const isDragOver = dragOverIdeaId === i.id || touchDragOverId === String(i.id);
    const isSelected = selectedIds.has(i.id);
    return (
      <div
        key={i.id}
        data-idea-id={String(i.id)}
        draggable={!selectMode}
        className={[
          'idea-card',
          justAdded ? 'just-added' : '',
          dragIdeaId === i.id ? 'dragging' : '',
          isTouchDragging ? 'touch-dragging' : '',
          isDragOver ? 'drag-over-top' : '',
          selectMode ? 'select-mode' : '',
          selectMode && isSelected ? 'selected' : '',
        ].filter(Boolean).join(' ')}
        onDragStart={e => onIdeaDragStart(e, i.id)}
        onDragEnd={onIdeaDragEnd}
        onDragOver={e => onIdeaDragOverCard(e, i.id)}
        onDrop={e => onIdeaDropCard(e, i.id)}
        onTouchStart={e => { if (!selectMode) onIdeaTouchStart(e, i.id); }}
        onTouchMove={onIdeaTouchMove}
        onTouchEnd={onIdeaTouchEnd}
        onClick={() => { if (selectMode) { toggleSelect(i.id); return; } if (justDraggedRef.current) return; setEditing(i); }}
      >
        {selectMode && (
          <div className={`idea-select-check${isSelected ? ' on' : ''}`} aria-hidden>{isSelected ? '✓' : ''}</div>
        )}
        <div className="idea-card-body">
          <div className="idea-project">{i.projectName}</div>
          {i.summary && <div className="idea-summary">{i.summary}</div>}
          {(i.details || []).length > 0 && (
            <ul className="idea-details">
              {i.details.map((d, idx) => <li key={idx} className="idea-detail">{d}</li>)}
            </ul>
          )}
          <div className="idea-meta">
            {(i.tags || []).map(t => <span key={t} className="tag-pill">{t}</span>)}
            {i.updatedAt && <span className="idea-updated">{i.updatedAt}</span>}
          </div>
          <AttachmentRow attachments={i.attachments || []} />
        </div>
        {!selectMode && <button className="item-copy-btn" onClick={e => { e.stopPropagation(); copyToClipboard(buildIdeaCopyText(i)); }} title="コピー"><IcoCopy /></button>}
        {!selectMode && <button className="todo-del" onClick={e => { e.stopPropagation(); onDelete(i.id); }}>✕</button>}
      </div>
    );
  });

  // ── 本棚ビュー（書庫）: タグごとの棚に背表紙として並べる ──
  const shelfGroups: { tag: string; items: Idea[] }[] = [];
  searchedIdeas.forEach(i => {
    const tag = (i.tags && i.tags[0]) || 'その他';
    let g = shelfGroups.find(s => s.tag === tag);
    if (!g) { g = { tag, items: [] }; shelfGroups.push(g); }
    g.items.push(i);
  });
  const shelves = shelfGroups.map((g, gi) => {
    const color = LIB_SHELF_COLORS[gi % LIB_SHELF_COLORS.length];
    return (
      <div className="lib-shelf" key={g.tag}>
        <div className="lib-plaque">{g.tag}</div>
        <div className="lib-books">
          {g.items.map(i => {
            const justAdded = !!i.addedAt && (Date.now() - i.addedAt) < 800;
            return (
              <div
                key={i.id}
                className={`lib-spine gw-dot${justAdded ? ' new' : ''}`}
                style={{ background: `linear-gradient(${color}, ${libShade(color)})` }}
                onClick={() => setEditing(i)}
                title={i.projectName}
              >
                {(i.attachments?.length ?? 0) > 0 && <span className="lib-mark" />}
                {i.projectName || i.summary || '(無題)'}
              </div>
            );
          })}
        </div>
      </div>
    );
  });

  return (
    <div className="ideas-wrapper">
      {editing && (
        <IdeaEditModal
          idea={editing}
          projects={projectNames.filter(p => p !== editing.projectName)}
          onSave={u => { onUpdate(u); setEditing(null); }}
          onClose={() => setEditing(null)}
          customTags={customTags}
          ideaTabs={ideaTabs}
        />
      )}
      {addingIdea && (
        <IdeaEditModal
          mode="add"
          idea={{ id: Date.now(), projectName: '', summary: '', details: [], tags: [], subTab: activeSubTab === 'all' ? undefined : activeSubTab, addedAt: Date.now(), updatedAt: todayStr } as Idea}
          projects={projectNames}
          onSave={i => { onAdd({ ...i, coinReward: i.coinReward ?? estimateIdeaCoinReward(i.summary, i.details || [], i.tags || []) }); setAddingIdea(false); }}
          onClose={() => setAddingIdea(false)}
          customTags={customTags}
          ideaTabs={ideaTabs}
        />
      )}
      <div className="lib-head">
        <div className="lib-tt">
          <h1>📖 メモモンの書庫</h1>
          <p>メモから育った知識が、本になって並びます</p>
        </div>
        <div className="lib-head-btns">
          <button className="lib-ask-btn" onClick={() => setShowChat(true)} aria-label="書庫にきく">💬 書庫にきく</button>
          {searchedIdeas.length > 0 && !selectMode && (
            <button className="lib-export-btn" onClick={enterSelectMode} aria-label="出力">📤 出力</button>
          )}
        </div>
      </div>
      {selectMode && (
        <div className="ideas-export-bar">
          <button className="ideas-export-all" onClick={toggleSelectAll}>{allSelected ? '全解除' : '全選択'}</button>
          <span className="ideas-export-count">{selectedIds.size} 件選択中</span>
          <button className="ideas-export-act" disabled={!selectedIds.size} onClick={handleCopySelected} title="コピー">📋 コピー</button>
          <button className="ideas-export-act" disabled={!selectedIds.size} onClick={handleDownloadSelected} title="Markdownで保存">⬇️ .md</button>
          <button className="ideas-export-cancel" onClick={exitSelectMode} aria-label="やめる">✕</button>
        </div>
      )}
      <div className="lib-search-row">
        <div className="lib-search">
          <span>🔍</span>
          <input value={libQuery} onChange={e => setLibQuery(e.target.value)} placeholder="書庫をさがす" />
        </div>
        <button
          className="lib-view-toggle"
          onClick={() => setLibView(v => v === 'shelf' ? 'list' : 'shelf')}
          title={libView === 'shelf' ? 'リスト表示に切り替え' : '本棚表示に切り替え'}
        >{libView === 'shelf' ? '☰' : '📚'}</button>
      </div>
      {subtabBar}
      {subtabInput}
      {libView === 'shelf' && !selectMode ? (
        <div className="ideas-tab tab-pane lib-body">
          {searchedIdeas.length === 0
            ? <div className="ideas-empty">{libQuery.trim() ? '見つかりませんでした' : 'まだ本がありません。メモから育てよう'}</div>
            : shelves
          }
          <div className="ideas-bottom-actions">
            <button className="ideas-add-row" onClick={() => setAddingIdea(true)}>
              ＋ 新しいナレッジを追加
            </button>
          </div>
        </div>
      ) : (
      <div ref={ideasListRef} className={`ideas-tab tab-pane${touchDragId != null ? ' touch-dragging' : ''}`}>
        {searchedIdeas.length === 0
          ? <div className="ideas-empty">まだナレッジがありません</div>
          : ideaCards
        }
        <div className="ideas-bottom-actions">
          <button className="ideas-add-row" onClick={() => setAddingIdea(true)}>
            ＋ 新しいナレッジを追加
          </button>
        </div>
      </div>
      )}
      {showChat && (
        <KnowledgeChat
          ideas={ideas}
          aiCfg={aiCfg}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Knowledge AI Chat Modal
// ─────────────────────────────────────────────────────────────
type ChatMessage = { role: 'user' | 'assistant'; text: string };

// ─────────────────────────────────────────────────────────────
// Account / Auth modal (Supabase)
// ─────────────────────────────────────────────────────────────
function AccountModal({ authUser, onClose }: { authUser: User | null; onClose: () => void }) {
  useDismissable(onClose);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);

  async function submitEmail() {
    if (!email.trim() || !password) {
      setMsg({ kind: 'err', text: 'メールアドレスとパスワードを入力してください' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const { error } = mode === 'signup'
        ? await signUpWithEmail(email.trim(), password)
        : await signInWithEmail(email.trim(), password);
      if (error) throw error;
      if (mode === 'signup') {
        setMsg({ kind: 'ok', text: '登録できました。確認メールが届いた場合はリンクをクリックしてください。' });
      } else {
        onClose();
      }
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function submitGoogle() {
    setBusy(true); setMsg(null);
    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
      // browser will redirect; nothing else to do
    } catch (e: any) {
      const raw = e?.message || String(e);
      const friendly = /provider is not enabled|Unsupported provider/i.test(raw)
        ? 'Google ログインがまだ有効化されていません。Supabase ダッシュボード → Authentication → Providers → Google を Enable にして、Google Cloud で取得した Client ID / Secret を貼り付けてください。詳細は docs/SUPABASE_SETUP.md を参照。'
        : raw;
      setMsg({ kind: 'err', text: friendly });
      setBusy(false);
    }
  }

  async function doSignOut() {
    setBusy(true); setMsg(null);
    try {
      await signOut();
      onClose();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop account-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="account-modal">
        <button className="knowchat-close" onClick={onClose} aria-label="閉じる" style={{ position: 'absolute', top: 12, right: 12 }}>✕</button>
        <div className="account-title">{authUser ? 'アカウント' : 'ログイン / 新規登録'}</div>

        {authUser ? (
          <div className="account-signedin">
            <div className="account-email">{authUser.email || '(メールなし)'}</div>
            <div className="account-help">
              データはサーバーに自動同期されます。複数端末で同じアカウントでログインすれば共有可能です。
            </div>
            <button className="account-signout" onClick={doSignOut} disabled={busy}>
              ログアウト
            </button>
          </div>
        ) : (
          <>
            <div className="account-mode-tabs">
              <button className={`account-mode-tab${mode === 'signin' ? ' active' : ''}`} onClick={() => { setMode('signin'); setMsg(null); }}>ログイン</button>
              <button className={`account-mode-tab${mode === 'signup' ? ' active' : ''}`} onClick={() => { setMode('signup'); setMsg(null); }}>新規登録</button>
            </div>

            <label className="account-field">
              <span>メール</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </label>
            <label className="account-field">
              <span>パスワード</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="6 文字以上" />
            </label>

            <button className="account-submit" onClick={submitEmail} disabled={busy}>
              {busy ? '送信中…' : (mode === 'signup' ? 'メールで登録' : 'メールでログイン')}
            </button>

            <div className="account-divider"><span>または</span></div>

            <button className="account-google" onClick={submitGoogle} disabled={busy}>
              <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M9 7.4v3.2h4.5c-.2 1.1-1.4 3.2-4.5 3.2A5 5 0 1 1 9 4a4.5 4.5 0 0 1 3.2 1.3l2.2-2.2C13 1.9 11.1 1 9 1a8 8 0 1 0 0 16c4.6 0 7.7-3.3 7.7-7.8 0-.6 0-1-.1-1.4H9z"/>
              </svg>
              <span>Google でログイン</span>
            </button>

            {msg && (
              <div className={`account-msg account-msg-${msg.kind}`}>{msg.text}</div>
            )}
            {!msg && mode === 'signup' && (
              <div className="account-help">
                初回ログインで、現在この端末に保存されているナレッジ・TODO・メモモンなどがサーバーへアップロードされます。
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function KnowledgeChat({ ideas, aiCfg, onClose }: { ideas: Idea[]; aiCfg: AiCfg; onClose: () => void }) {
  useDismissable(onClose);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // null = use all ideas; otherwise an explicit selected set
  const [selectedIds, setSelectedIds] = useState<Set<number | string> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const targetIdeas = selectedIds
    ? ideas.filter(i => selectedIds.has(i.id))
    : ideas;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  function formatIdea(i: Idea): string {
    const parts = [
      `■ ${i.projectName || '(無題)'}`,
      i.summary ? `要約: ${i.summary}` : '',
      i.details && i.details.length > 0 ? `詳細:\n  ・${i.details.join('\n  ・')}` : '',
      i.tags && i.tags.length > 0 ? `タグ: ${i.tags.join(', ')}` : '',
    ].filter(Boolean);
    return parts.join('\n');
  }

  async function send() {
    const q = input.trim();
    if (!q) return;
    if (!aiConfigured(aiCfg)) {
      setMessages(m => [...m, { role: 'assistant', text: `${AI_LABEL[aiCfg.provider]} の API キーが未設定です。設定タブで API キーを登録してください。` }]);
      return;
    }
    setMessages(m => [...m, { role: 'user', text: q }]);
    setInput('');
    setLoading(true);

    const knowledgeBlock = targetIdeas.length > 0
      ? targetIdeas.map(formatIdea).join('\n---\n')
      : '(参照可能なナレッジはありません)';

    const history = [...messages, { role: 'user' as const, text: q }];
    const conversation = history
      .map(m => `${m.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${m.text}`)
      .join('\n\n');

    const prompt =
      `あなたはユーザーのSmartMemoアプリに蓄積されたナレッジを元に質問に答えるアシスタントです。\n\n` +
      `回答方針:\n` +
      `- 以下の【ナレッジ】に書かれていることを最優先で参照し、根拠を簡潔に示しながら回答してください。\n` +
      `- ナレッジ内に明確な答えがない場合でも、関連する内容から推測できる範囲で示唆を返し、その旨を明示してください。\n` +
      `- 完全に範囲外なら「ナレッジに該当する情報が見つかりませんでした」と素直に答えてください。\n` +
      `- マークダウンは使わず、シンプルで読みやすい日本語で200〜400字程度を目安にしてください。\n\n` +
      `【ナレッジ（参照対象 ${targetIdeas.length} 件）】\n${knowledgeBlock}\n\n` +
      `【これまでの会話】\n${conversation}\n\n` +
      `上記のユーザー最新の発言に対して回答してください。`;

    try {
      const reply = await aiText(aiCfg, prompt);
      setMessages(m => [...m, { role: 'assistant', text: reply.trim() || '(回答が取得できませんでした)' }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', text: `エラー: ${e?.message || e}` }]);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: number | string) {
    setSelectedIds(prev => {
      const base = prev ? new Set(prev) : new Set(ideas.map(i => i.id));
      if (base.has(id)) base.delete(id);
      else base.add(id);
      return base;
    });
  }

  return (
    <div className="modal-backdrop knowchat-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="knowchat-modal">
        <div className="knowchat-header">
          <div className="knowchat-title">💬 ナレッジAIチャット</div>
          <button className="knowchat-close" onClick={onClose} aria-label="閉じる">✕</button>
        </div>
        <div className="knowchat-scope">
          <span className="knowchat-scope-label">参照:</span>
          <span className="knowchat-scope-count">
            {selectedIds ? `${targetIdeas.length} / ${ideas.length} 件` : `全 ${ideas.length} 件`}
          </span>
          <button className="knowchat-pick-btn" onClick={() => setShowPicker(s => !s)}>
            {showPicker ? '閉じる' : 'ナレッジを選ぶ'}
          </button>
          {selectedIds && (
            <button className="knowchat-clear-btn" onClick={() => setSelectedIds(null)}>全選択に戻す</button>
          )}
        </div>
        {showPicker && (
          <div className="knowchat-picker">
            {ideas.length === 0 ? (
              <div className="knowchat-picker-empty">まだナレッジがありません</div>
            ) : ideas.map(i => {
              const sel = selectedIds ? selectedIds.has(i.id) : true;
              return (
                <label key={i.id} className={`knowchat-picker-row${sel ? ' selected' : ''}`}>
                  <input type="checkbox" checked={sel} onChange={() => toggleSelect(i.id)} />
                  <span className="knowchat-picker-name">{i.projectName || '(無題)'}</span>
                  {i.summary && <span className="knowchat-picker-sub">{i.summary}</span>}
                </label>
              );
            })}
          </div>
        )}
        <div className="knowchat-messages" ref={scrollRef}>
          {messages.length === 0 && !loading && (
            <div className="knowchat-empty">
              <div>💡 ナレッジに基づいて質問できます。</div>
              <div className="knowchat-empty-examples">
                <div>例: 「先月のメモのまとめを教えて」</div>
                <div>例: 「○○について何かメモあった？」</div>
                <div>例: 「アイデアを 3 つ挙げて」</div>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`knowchat-msg knowchat-msg-${m.role}`}>
              <div className="knowchat-msg-bubble">{m.text}</div>
            </div>
          ))}
          {loading && (
            <div className="knowchat-msg knowchat-msg-assistant">
              <div className="knowchat-msg-bubble loading">
                <span className="knowchat-dot" /><span className="knowchat-dot" /><span className="knowchat-dot" />
              </div>
            </div>
          )}
        </div>
        <div className="knowchat-input-row">
          <textarea
            className="knowchat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !loading) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="ナレッジに質問してみよう…（Cmd/Ctrl+Enter で送信）"
            rows={2}
            disabled={loading}
          />
          <button className="knowchat-send" onClick={send} disabled={loading || !input.trim()}>
            送信
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings Tab
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Zukan Tab（メモモンずかん）
// ─────────────────────────────────────────────────────────────
const RARITY_STARS: Record<string, string> = { ultra: '★★★★★', super: '★★★★', rare: '★★★', common: '★★' };
const RARITY_LABEL: Record<string, string> = { ultra: 'ウルトラ', super: 'スーパー', rare: 'レア', common: 'ノーマル' };

function ZukanTab({ memoMons, onOpenPlayground }: {
  memoMons: MemoMonInstance[];
  onOpenPlayground: (uid?: string) => void;
}) {
  const [detail, setDetail] = useState<MemoMonDef | null>(null);
  const ownedByDef = new Map<string, MemoMonInstance>();
  memoMons.forEach(m => { if (!ownedByDef.has(m.defId)) ownedByDef.set(m.defId, m); });
  const ownedCount = MEMOMON_DEFS.filter(d => ownedByDef.has(d.id)).length;

  const detailInst = detail ? ownedByDef.get(detail.id) : undefined;
  const detailFlavor = detail
    ? (GACHA_ITEMS.find(i => i.type === 'memomon' && i.monDefId === detail.id)?.flavor || detail.desc)
    : '';

  return (
    <div className="zukan-tab tab-pane">
      <div className="zukan-head">
        <div className="zukan-tt">
          <h1>🥚 メモモンずかん</h1>
          <p>あつめたメモモン {ownedCount} / {MEMOMON_DEFS.length}</p>
        </div>
      </div>
      <div className="zukan-grid">
        {MEMOMON_DEFS.map(def => {
          const inst = ownedByDef.get(def.id);
          return (
            <div
              key={def.id}
              className={`zukan-card${inst ? '' : ' locked'}`}
              onClick={() => inst ? onOpenPlayground(inst.uid) : setDetail(def)}
            >
              <div className="zukan-sprite-box">
                <img src={MEMOMON_IMGS[def.id]} alt={inst ? def.name : '？？？'} className="zukan-sprite" />
              </div>
              <div className="zukan-name">{inst ? def.name : '???'}</div>
              <div className="zukan-rarity">{RARITY_STARS[def.rarity] || '★★★'}</div>
              <div className="zukan-sptag">{RARITY_LABEL[def.rarity] || def.rarity}</div>
            </div>
          );
        })}
      </div>
      {detail && (
        <Dismissable onClose={() => setDetail(null)}>
        <div className="modal-backdrop zukan-detail-backdrop" onClick={() => setDetail(null)}>
          <div className="zukan-detail" onClick={e => e.stopPropagation()}>
            <button className="gw-pop-close" onClick={() => setDetail(null)}>✕</button>
            <div className={`zukan-detail-sprite${detailInst ? '' : ' locked'}`}>
              <img src={MEMOMON_IMGS[detail.id]} alt="" />
            </div>
            <div className="zukan-detail-name">{detailInst ? detail.name : '？？？'}</div>
            <div className="zukan-detail-rarity">{RARITY_STARS[detail.rarity] || '★★★'}</div>
            {detailInst ? (
              <>
                {(() => { const lv = affectionLevel(effectiveAffection(detailInst)); return (
                  <div className="zukan-detail-bond">なかよし度 {lv.stars}（{lv.label}）</div>
                ); })()}
                <p className="zukan-detail-desc">{detailFlavor}</p>
              </>
            ) : (
              <p className="zukan-detail-desc">まだ出会っていないメモモン。ガチャのたまごから生まれるかも…</p>
            )}
          </div>
        </div>
        </Dismissable>
      )}
    </div>
  );
}

function SettingsTab({ settings, onChange, memoMons, onInsights, authUser, syncStatus, syncError, syncNotice, lastSyncAt, onOpenAccount, onPushNow, onPullNow }: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  memoMons: MemoMonInstance[];
  onInsights: () => void;
  authUser: User | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  syncError: string | null;
  syncNotice?: string | null;
  lastSyncAt: string | null;
  onOpenAccount: () => void;
  onPushNow: () => void;
  onPullNow: () => void;
}) {
  const { notifEnabled, notifAdvanceMin = 30, notifDailyTime = '09:00', autoTag, autoDate, completeSound, geminiApiKey, darkMode } = settings;
  // colorIdx / fontIdx は永続化やクラウド同期由来で undefined / 範囲外になりうる。
  // 存在しないプリセットを参照してクラッシュしないよう有効範囲へ丸める。
  const colorIdx = (settings.colorIdx != null && COLOR_PRESETS[settings.colorIdx]) ? settings.colorIdx : 0;
  const fontIdx  = (settings.fontIdx  != null && FONT_SIZE_OPTS[settings.fontIdx]) ? settings.fontIdx  : 0;
  const soundOn = completeSound !== false;
  const [newTag, setNewTag]             = useState('');
  const [keyInput, setKeyInput]         = useState(geminiApiKey || '');
  const [keyVisible, setKeyVisible]     = useState(false);
  const [apiStatus, setApiStatus]       = useState<{ kind: 'idle' | 'ok' | 'ng'; msg: string }>({ kind: 'idle', msg: '' });
  const [newHolidayDate,   setNewHolidayDate]   = useState('');
  const [giftCode, setGiftCode]             = useState('');
  const [giftMsg, setGiftMsg]               = useState<{ kind: 'idle' | 'ok' | 'ng'; msg: string }>({ kind: 'idle', msg: '' });
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? (Notification as any).permission : 'denied'
  );
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [backupStatus, setBackupStatus] = useState<{ kind: 'ok' | 'ng' | null; msg: string }>({ kind: null, msg: '' });

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('現在のすべてのデータ（TODO・アイデア・設定など）がバックアップの内容に置き換えられます。続行しますか？')) return;
    const result = await importAllData(file);
    setBackupStatus({ kind: result.ok ? 'ok' : 'ng', msg: result.msg });
    if (result.ok) setTimeout(() => window.location.reload(), 900);
  }

  async function requestNotifPermission() {
    if (typeof Notification === 'undefined') return;
    const result = await (Notification as any).requestPermission();
    setNotifPerm(result);
    if (result === 'granted') onChange('notifEnabled', true);
  }

  async function sendTestNotif() {
    await showSWNotification('SmartMemo テスト', '通知が正常に動作しています！', 'test-' + Date.now());
  }

  // 選択中の AI プロバイダとその APIキー保存先
  const aiProvider: AiProvider = settings.aiProvider || 'gemini';
  const providerKeyField: Record<AiProvider, 'geminiApiKey' | 'openaiApiKey' | 'anthropicApiKey'> = {
    gemini: 'geminiApiKey', openai: 'openaiApiKey', anthropic: 'anthropicApiKey',
  };
  const storedProviderKey = (settings[providerKeyField[aiProvider]] as string) || '';
  const providerKeyPlaceholder: Record<AiProvider, string> = {
    gemini: 'AIza...', openai: 'sk-...', anthropic: 'sk-ant-...',
  };
  // Claude はモデルをテキスト指定できる。未指定時はデフォルトを使う。
  const anthropicModel = (settings.anthropicModel || '').trim() || ANTHROPIC_TEXT_MODEL;
  const providerModel: Record<AiProvider, string> = {
    gemini: GEMINI_MODEL, openai: OPENAI_TEXT_MODEL, anthropic: anthropicModel,
  };

  // プロバイダ切替時は、その保存済みキーを入力欄に反映
  useEffect(() => { setKeyInput(storedProviderKey); }, [aiProvider, storedProviderKey]);

  function saveKey() {
    onChange(providerKeyField[aiProvider], keyInput.trim());
    setApiStatus({ kind: 'ok', msg: '保存しました' });
    setTimeout(() => setApiStatus({ kind: 'idle', msg: '' }), 2200);
  }
  async function testKey() {
    if (!keyInput.trim()) {
      setApiStatus({ kind: 'ng', msg: 'APIキーを入力してください' }); return;
    }
    setApiStatus({ kind: 'idle', msg: '接続テスト中...' });
    try {
      const testCfg: AiCfg = {
        provider: aiProvider,
        geminiKey: aiProvider === 'gemini' ? keyInput.trim() : '',
        openaiKey: aiProvider === 'openai' ? keyInput.trim() : '',
        anthropicKey: aiProvider === 'anthropic' ? keyInput.trim() : '',
        anthropicModel,
      };
      const out = await aiText(testCfg, 'Reply with the single word: OK');
      if (out) setApiStatus({ kind: 'ok', msg: `接続成功（${providerModel[aiProvider]}）` });
      else     setApiStatus({ kind: 'ng', msg: '応答が空でした' });
    } catch (e: any) {
      setApiStatus({ kind: 'ng', msg: String(e?.message || e).slice(0, 80) });
    }
  }
  const trimmed = newTag.trim();
  const canAdd =
    trimmed.length > 0 &&
    !BUILTIN_IDEA_TAGS.includes(trimmed) &&
    !(settings.customTags || []).includes(trimmed);
  const addTag = () => {
    if (!canAdd) return;
    onChange('customTags', [...(settings.customTags || []), trimmed]);
    setNewTag('');
  };

  const GIFT_CODES: Record<string, number> = { metameta: 50000 };
  function redeemGift() {
    const code = giftCode.trim().toLowerCase();
    const reward = GIFT_CODES[code];
    if (reward == null) {
      setGiftMsg({ kind: 'ng', msg: '無効なコードです' });
      return;
    }
    if ((settings.usedGiftCodes || []).includes(code)) {
      setGiftMsg({ kind: 'ng', msg: 'このコードはすでに使用済みです' });
      return;
    }
    onChange('coins', (settings.coins || 0) + reward);
    onChange('usedGiftCodes', [...(settings.usedGiftCodes || []), code]);
    setGiftCode('');
    setGiftMsg({ kind: 'ok', msg: `🎁 ${reward.toLocaleString()}コインをゲットしました！` });
    setTimeout(() => setGiftMsg({ kind: 'idle', msg: '' }), 4000);
  }

  return (
    <div className="settings-tab tab-pane">
      {isSupabaseConfigured && (
        <>
          <div className="settings-section-title">アカウント</div>
          <div className="settings-card">
            {authUser ? (
              <>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">ログイン中</div>
                    <div className="settings-row-sub">
                      {authUser.email || '(メールなし)'}
                      {lastSyncAt && (
                        <> ／ 最終同期: {new Date(lastSyncAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </div>
                  </div>
                  <button className="font-size-opt" onClick={onOpenAccount}>管理</button>
                </div>
                <div className="settings-row">
                  <div>
                    <div className="settings-row-label">同期</div>
                    <div className="settings-row-sub">
                      {syncStatus === 'syncing' ? '同期中…'
                       : syncStatus === 'error'   ? 'エラー（再試行できます）'
                       : '最新の状態'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="font-size-opt" onClick={onPullNow} disabled={syncStatus === 'syncing'}>取得</button>
                    <button className="font-size-opt" onClick={onPushNow} disabled={syncStatus === 'syncing'}>送信</button>
                  </div>
                </div>
                {syncStatus === 'error' && syncError && (
                  <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div
                      className="account-msg account-msg-err"
                      style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    >
                      {syncError}
                    </div>
                  </div>
                )}
                {syncStatus !== 'error' && syncNotice && (
                  <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div
                      className="account-msg"
                      style={{ width: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                    >
                      ⚠️ {syncNotice}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">未ログイン</div>
                  <div className="settings-row-sub">アカウントを作成すると複数端末でデータを同期できます</div>
                </div>
                <button className="font-size-opt" onClick={onOpenAccount}>ログイン</button>
              </div>
            )}
          </div>
        </>
      )}

      <div className="settings-section-title">表示</div>
      <div className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">ダークモード</div>
            <div className="settings-row-sub">画面を暗くする</div>
          </div>
          <button className={`toggle${darkMode ? ' on' : ' off'}`} onClick={() => onChange('darkMode', !darkMode)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">ガラス風デザイン</div>
            <div className="settings-row-sub">背景がふわっと透ける半透明 UI に切り替え</div>
          </div>
          <button className={`toggle${settings.glassUI ? ' on' : ' off'}`} onClick={() => onChange('glassUI', !settings.glassUI)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">ベースカラー</div>
            <div className="settings-row-sub">{COLOR_PRESETS[colorIdx].name}</div>
          </div>
          <div className="color-swatches">
            {COLOR_PRESETS.map((c, i) => (
              <div key={i} className={`color-swatch${colorIdx === i ? ' sel' : ''}`}
                style={{ background: c.value }}
                onClick={() => onChange('colorIdx', i)} />
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">背景テーマ</div>
            <div className="settings-row-sub">{BG_PRESETS[settings.bgIdx ?? 0]?.name}</div>
          </div>
          <div className="color-swatches">
            {BG_PRESETS.map((b, i) => (
              <div key={i} className={`color-swatch${(settings.bgIdx ?? 0) === i ? ' sel' : ''}`}
                style={{ background: b.bg, border: '1px solid #d0d0cc' }}
                onClick={() => onChange('bgIdx', i)} />
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">文字サイズ</div>
            <div className="settings-row-sub">{FONT_SIZE_OPTS[fontIdx].label}</div>
          </div>
          <div className="font-size-opts">
            {FONT_SIZE_OPTS.map((o, i) => (
              <button key={i} className={`font-size-opt${fontIdx === i ? ' sel' : ''}`}
                style={{ fontSize: i === 0 ? '11px' : i === 1 ? '13px' : '15px' }}
                onClick={() => onChange('fontIdx', i)}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section-title">カレンダー・休日</div>
      <div className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">土日を休日にする</div>
            <div className="settings-row-sub">カレンダーで土曜・日曜を色付け</div>
          </div>
          <button className={`toggle${settings.holidayWeekends !== false ? ' on' : ' off'}`}
            onClick={() => onChange('holidayWeekends', settings.holidayWeekends === false ? true : false)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">日本の祝日を休日にする</div>
            <div className="settings-row-sub">2024〜2027年の祝日に対応</div>
          </div>
          <button className={`toggle${settings.holidayJpHolidays !== false ? ' on' : ' off'}`}
            onClick={() => onChange('holidayJpHolidays', settings.holidayJpHolidays === false ? true : false)} />
        </div>
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div className="settings-row-label">追加の休日</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* 以前は background に var(--card-bg,#fff) を指定していたが --card-bg は
                存在しないトークンで、#fff にフォールバックしていた。そこへ color:inherit で
                ダークの文字色が乗り、「白地に白文字」で日付が読めなくなっていた。 */}
            <input
              type="date"
              value={newHolidayDate}
              onChange={e => setNewHolidayDate(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--rule-strong)', fontSize: 14, fontFamily: 'inherit', background: 'var(--surface)', color: 'var(--ink)' }}
            />
            <button
              onClick={() => {
                if (!newHolidayDate) return;
                const cur = settings.customHolidays || [];
                if (!cur.includes(newHolidayDate)) onChange('customHolidays', [...cur, newHolidayDate].sort());
                setNewHolidayDate('');
              }}
              style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            >追加</button>
          </div>
          {(settings.customHolidays || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(settings.customHolidays || []).map(d => (
                <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: '#fde8e8', color: '#c62828', fontSize: 13 }}>
                  {d}
                  <button onClick={() => onChange('customHolidays', (settings.customHolidays || []).filter(x => x !== d))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {settings.infiniteCoinsUnlocked && <>
        <div className="settings-section-title">テスト</div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">コイン無限モード</div>
              <div className="settings-row-sub">ガチャのコスト不要（テスト用）</div>
            </div>
            <button className={`toggle${settings.infiniteCoins ? ' on' : ' off'}`} onClick={() => onChange('infiniteCoins', !settings.infiniteCoins)} />
          </div>
        </div>
      </>}

      <div className="settings-section-title">通知・サウンド</div>
      <div className="settings-card">
        {/* Permission status */}
        <div className="notif-perm-row">
          <span className="notif-perm-label">通知の許可状態：</span>
          {notifPerm === 'granted' && <span className="notif-perm-badge ok">許可済み ✓</span>}
          {notifPerm === 'denied'  && <span className="notif-perm-badge ng">拒否（ブラウザ設定から変更）</span>}
          {notifPerm === 'default' && (
            <button className="notif-perm-btn" onClick={requestNotifPermission}>通知を許可する</button>
          )}
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">タスク通知</div>
            <div className="settings-row-sub">
              {notifPerm === 'granted'
                ? 'アプリ起動中に期限前リマインドを送信'
                : '通知を許可すると有効になります'}
            </div>
          </div>
          <button
            className={`toggle${notifEnabled ? ' on' : ' off'}`}
            onClick={() => {
              if (!notifEnabled && notifPerm !== 'granted') { requestNotifPermission(); return; }
              onChange('notifEnabled', !notifEnabled);
            }}
          />
        </div>

        {notifEnabled && notifPerm === 'granted' && (<>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">事前通知</div>
              <div className="settings-row-sub">時刻設定済みタスクを何分前に通知するか</div>
            </div>
            <select
              className="notif-select"
              value={notifAdvanceMin}
              onChange={e => onChange('notifAdvanceMin', Number(e.target.value))}
            >
              <option value={0}>時刻ちょうど</option>
              <option value={15}>15分前</option>
              <option value={30}>30分前</option>
              <option value={60}>1時間前</option>
            </select>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">デフォルト通知時刻</div>
              <div className="settings-row-sub">時刻未設定タスクをこの時間に通知</div>
            </div>
            <input
              type="time"
              className="notif-time-input"
              value={notifDailyTime}
              onChange={e => onChange('notifDailyTime', e.target.value)}
            />
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">テスト通知</div>
              <div className="settings-row-sub">通知が届くか確認する</div>
            </div>
            <button className="notif-test-btn" onClick={sendTestNotif}>テスト送信</button>
          </div>
        </>)}

        <div className="settings-row">
          <div>
            <div className="settings-row-label">完了サウンド</div>
            <div className="settings-row-sub">TODOにチェックを入れた時に音とアニメーション</div>
          </div>
          <button className={`toggle${soundOn ? ' on' : ' off'}`} onClick={() => onChange('completeSound', !soundOn)} />
        </div>
        {soundOn && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">サウンドの種類</div>
              <div className="settings-row-sub">タップして試聴</div>
            </div>
            <div className="sound-type-opts">
              {SOUND_TYPES.filter(s =>
                DEFAULT_SOUNDS.includes(s.key) ||
                (settings.gachaUnlocked?.sounds || []).includes(s.key) ||
                (settings.soundType || 'doremi') === s.key
              ).map(s => (
                <button
                  key={s.key}
                  className={`sound-type-btn${(settings.soundType || 'doremi') === s.key ? ' sel' : ''}`}
                  onClick={() => { onChange('soundType', s.key); playSound(s.key); }}
                >{s.label}</button>
              ))}
            </div>
            <div className="settings-row-sub" style={{ marginTop: 8 }}>
              🔒 その他のサウンドはガチャで当てると選べるようになります
            </div>
          </div>
        )}
      </div>

      <div className="settings-section-title">AI 連携</div>
      <div className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">AI プロバイダ</div>
            <div className="settings-row-sub">音声・画像・メモ解析・書庫チャットに使う AI を選べます</div>
          </div>
          <div className="font-size-opts">
            {(['gemini', 'openai', 'anthropic'] as AiProvider[]).map(p => (
              <button
                key={p}
                className={`font-size-opt${aiProvider === p ? ' sel' : ''}`}
                onClick={() => onChange('aiProvider', p)}
              >{p === 'gemini' ? 'Gemini' : p === 'openai' ? 'GPT' : 'Claude'}</button>
            ))}
          </div>
        </div>
        <div className="api-row">
          <div className="settings-row-label">{AI_LABEL[aiProvider]} APIキー</div>
          <div className="settings-row-sub">
            {aiProvider === 'gemini' && <>取得: aistudio.google.com → Get API key（モデル: {GEMINI_MODEL}）</>}
            {aiProvider === 'openai' && <>取得: platform.openai.com → API keys（モデル: {OPENAI_TEXT_MODEL} / 音声: Whisper）</>}
            {aiProvider === 'anthropic' && <>取得: console.anthropic.com → API Keys（モデルは下で指定・既定 {ANTHROPIC_TEXT_MODEL}／音声入力は非対応）</>}
            <br/>未設定時はローカル解析にフォールバック。キーは端末内にのみ保存されます。
          </div>
          <div className="api-input-row">
            <input
              type={keyVisible ? 'text' : 'password'}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder={providerKeyPlaceholder[aiProvider]}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="secondary" onClick={() => setKeyVisible(v => !v)} style={{ padding: '0 8px', display: 'flex', alignItems: 'center' }}>
              {keyVisible
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>
              }
            </button>
          </div>
          <div className="api-input-row">
            <button onClick={saveKey} disabled={keyInput.trim() === storedProviderKey}>保存</button>
            <button className="secondary" onClick={testKey} disabled={!keyInput.trim()}>接続テスト</button>
            {storedProviderKey && (
              <button className="secondary" onClick={() => { setKeyInput(''); onChange(providerKeyField[aiProvider], ''); setApiStatus({ kind: 'ok', msg: '削除しました' }); }}>削除</button>
            )}
          </div>
          {apiStatus.msg && (
            <div className={`api-status ${apiStatus.kind}`}>{apiStatus.msg}</div>
          )}
          {aiProvider === 'anthropic' && (
            <div className="api-model-row">
              <div className="settings-row-label">Claude モデル</div>
              <div className="settings-row-sub">
                使用するモデル ID をテキストで指定できます（例: claude-haiku-4-5 / claude-sonnet-4-5）。
                空欄にすると既定の {ANTHROPIC_TEXT_MODEL} を使います。
              </div>
              <div className="api-input-row">
                <input
                  type="text"
                  value={settings.anthropicModel || ''}
                  onChange={e => onChange('anthropicModel', e.target.value)}
                  placeholder={ANTHROPIC_TEXT_MODEL}
                  autoComplete="off"
                  spellCheck={false}
                />
                {(settings.anthropicModel || '').trim() && (settings.anthropicModel || '').trim() !== ANTHROPIC_TEXT_MODEL && (
                  <button className="secondary" onClick={() => onChange('anthropicModel', '')}>既定に戻す</button>
                )}
              </div>
              <div className="settings-row-sub">現在のモデル: <strong>{anthropicModel}</strong></div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-section-title">AI 分析</div>
      <div className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">傾向を分析する</div>
            <div className="settings-row-sub">TODO・ナレッジ・削除履歴からAIが傾向とアドバイスを生成します</div>
          </div>
          <button
            className="insights-run-btn"
            onClick={onInsights}
            disabled={!storedProviderKey}
            title={storedProviderKey ? 'AI分析を実行' : `${AI_LABEL[aiProvider]} のAPIキーを設定してください`}
          >
            {storedProviderKey ? '🔍 分析する' : '🔒 要APIキー'}
          </button>
        </div>
      </div>

      <div className="settings-section-title">AI 設定</div>
      <div className="settings-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">自動タグ付け</div>
            <div className="settings-row-sub">タスク解析時に自動でタグを付与</div>
          </div>
          <button className={`toggle${autoTag ? ' on' : ' off'}`} onClick={() => onChange('autoTag', !autoTag)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">日付の自動推定</div>
            <div className="settings-row-sub">「来週」などの相対日付を解析</div>
          </div>
          <button className={`toggle${autoDate ? ' on' : ' off'}`} onClick={() => onChange('autoDate', !autoDate)} />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">反映ボタンを分ける</div>
            <div className="settings-row-sub">「TODOに反映」「ナレッジに反映」を個別ボタンで表示</div>
          </div>
          <button className={`toggle${settings.splitReflectButtons !== false ? ' on' : ' off'}`} onClick={() => onChange('splitReflectButtons', settings.splitReflectButtons === false)} />
        </div>
      </div>

      <div className="settings-section-title">タグ</div>
      <div className="settings-card">
        <div className="tag-row">
          <div className="settings-row-label">既定タグ</div>
          <div className="settings-row-sub">ナレッジ用の既定タグは「アイデア」のみ</div>
          <div className="tag-chip-list">
            {BUILTIN_IDEA_TAGS.map(t => (
              <span key={t} className="tag-chip tag-chip-builtin">{t}</span>
            ))}
          </div>
        </div>
        <div className="tag-row">
          <div className="settings-row-label">カスタムタグ</div>
          <div className="settings-row-sub">独自のタグを追加・削除できます（TODO・ナレッジ両方で使用可能）</div>
          {(settings.customTags || []).length > 0 && (
            <div className="tag-chip-list">
              {(settings.customTags || []).map(t => (
                <span key={t} className="tag-chip">
                  {t}
                  <button onClick={() => onChange('customTags', (settings.customTags || []).filter(x => x !== t))}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="tag-add-row">
            <input value={newTag} onChange={e => setNewTag(e.target.value)}
              placeholder="新しいタグ名（例: 副業）"
              onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
              maxLength={12} />
            <button disabled={!canAdd} onClick={addTag}>追加</button>
          </div>
        </div>
      </div>

      {memoMons.length > 0 && <>
        <div className="settings-section-title">メモモン</div>
        <div className="settings-card">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">メモモンを表示する</div>
              <div className="settings-row-sub">画面上を歩き回るモンスターの表示</div>
            </div>
            <button
              className={`toggle${settings.memoMonVisible === false ? ' off' : ' on'}`}
              onClick={() => onChange('memoMonVisible', settings.memoMonVisible === false ? true : false)}
            />
          </div>
          {settings.memoMonVisible !== false && <>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">サイズ</div>
              </div>
              <div className="font-size-opts">
                {(['small', 'medium', 'large'] as const).map((s, i) => (
                  <button
                    key={s}
                    className={`font-size-opt${(settings.memoMonSize || 'medium') === s ? ' sel' : ''}`}
                    style={{ fontSize: i === 0 ? '11px' : i === 1 ? '13px' : '15px' }}
                    onClick={() => onChange('memoMonSize', s)}
                  >{['小', '中', '大'][i]}</button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">タップで吹き出し</div>
                <div className="settings-row-sub">メモモンをタップしたときにセリフを表示</div>
              </div>
              <button
                className={`toggle${settings.memoMonSpeech === false ? ' off' : ' on'}`}
                onClick={() => onChange('memoMonSpeech', settings.memoMonSpeech === false ? true : false)}
              />
            </div>
          </>}
        </div>
      </>}

      <div className="settings-section-title">プレゼントコード</div>
      <div className="settings-card">
        <div className="api-row">
          <div className="settings-row-label">コードを入力</div>
          <div className="settings-row-sub">プレゼントコードを入力してコインをゲット！</div>
          <div className="api-input-row">
            <input
              type="text"
              value={giftCode}
              onChange={e => { setGiftCode(e.target.value); setGiftMsg({ kind: 'idle', msg: '' }); }}
              placeholder="コードを入力"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={e => { if (e.key === 'Enter') redeemGift(); }}
            />
            <button onClick={redeemGift} disabled={!giftCode.trim()}>使用</button>
          </div>
          {giftMsg.msg && <div className={`api-status ${giftMsg.kind}`}>{giftMsg.msg}</div>}
        </div>
      </div>

      <div className="settings-section-title">データ管理</div>
      <div className="settings-card">
        <div className="api-row">
          <div className="settings-row-label">バックアップ</div>
          <div className="settings-row-sub">
            すべてのデータ（TODO・アイデア・設定・メモモンなど）を JSON ファイルに書き出し／読み込みできます。端末の変更やデータ消失に備えてバックアップを取れます。
          </div>
          <div className="backup-btn-row">
            <button className="backup-btn" onClick={exportAllData}>エクスポート</button>
            <button className="backup-btn" onClick={() => importFileRef.current?.click()}>インポート</button>
          </div>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          {backupStatus.kind && (
            <div className={`api-status ${backupStatus.kind}`}>{backupStatus.msg}</div>
          )}
        </div>
      </div>

      <div className="settings-section-title">アプリ情報</div>
      <div className="about-card">
        <div className="about-app-name">SmartMemo</div>
        <div className="about-version">Version {APP_VERSION} (TypeScript)</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AI Insights
// ─────────────────────────────────────────────────────────────
function buildInsightsSummary(todos: Todo[], ideas: Idea[], trash: TrashedTodo[]): string {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86400000;
  const ninetyDaysAgo = now - 90 * 86400000;

  const done = todos.filter(t => t.done);
  const undone = todos.filter(t => !t.done);
  const recent = todos.filter(t => (t.addedAt || 0) > thirtyDaysAgo);
  const recentDone = done.filter(t => (t.addedAt || 0) > thirtyDaysAgo);

  const tagCount = (arr: Todo[]) => {
    const m: Record<string, number> = {};
    arr.forEach(t => (t.tags || []).forEach(g => { m[g] = (m[g] || 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(', ');
  };

  const recurring = todos.filter(t => (t as any).recurring);
  const overdue = undone.filter(t => t.endDate && t.endDate < new Date().toISOString().slice(0, 10));

  const ideaProjects = [...new Set(ideas.map(i => i.projectName))];
  const ideaTagCount: Record<string, number> = {};
  ideas.forEach(i => (i.tags || []).forEach(g => { ideaTagCount[g] = (ideaTagCount[g] || 0) + 1; }));
  const topIdeaTags = Object.entries(ideaTagCount).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(', ');

  const trashRecent = trash.filter(t => (t.trashedAt || 0) > ninetyDaysAgo);
  const trashTagCount: Record<string, number> = {};
  trashRecent.forEach(t => (t.tags || []).forEach(g => { trashTagCount[g] = (trashTagCount[g] || 0) + 1; }));
  const trashTopTags = Object.entries(trashTagCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(', ');

  const completionRate = todos.length > 0 ? Math.round(done.length / todos.length * 100) : 0;
  const recentCompletionRate = recent.length > 0 ? Math.round(recentDone.length / recent.length * 100) : 0;

  return [
    `【TODO統計】`,
    `総数: ${todos.length}件（完了: ${done.length}件, 未完了: ${undone.length}件）`,
    `完了率: ${completionRate}%（直近30日: ${recentCompletionRate}%）`,
    `期限切れ未完了: ${overdue.length}件`,
    `定期予定: ${recurring.length}件`,
    `未完了タグ内訳: ${tagCount(undone) || 'なし'}`,
    `完了済みタグ内訳: ${tagCount(done) || 'なし'}`,
    `直近30日に追加したTODO: ${recent.length}件`,
    `未完了タイトルサンプル（最大10件）: ${undone.slice(0, 10).map(t => t.title).join(' / ')}`,
    ``,
    `【ナレッジ統計】`,
    `総数: ${ideas.length}件（プロジェクト数: ${ideaProjects.length}）`,
    `プロジェクト: ${ideaProjects.slice(0, 12).join(', ')}`,
    `タグ内訳: ${topIdeaTags || 'なし'}`,
    `ナレッジサンプル（最大8件）: ${ideas.slice(0, 8).map(i => i.projectName + (i.summary ? `「${i.summary.slice(0, 20)}」` : '')).join(' / ')}`,
    ``,
    `【ゴミ箱（直近90日）】`,
    `削除されたTODO: ${trashRecent.length}件`,
    `削除が多いタグ: ${trashTopTags || 'なし'}`,
    `削除されたタイトルサンプル（最大8件）: ${trashRecent.slice(0, 8).map(t => t.title).join(' / ')}`,
  ].join('\n');
}

function renderInsightText(text: string): React.ReactNode[] {
  return text.split('\n').map((line, i) => {
    if (/^#{1,3}\s/.test(line)) {
      return <div key={i} className="insight-heading">{line.replace(/^#+\s/, '')}</div>;
    }
    if (/^\*\*(.+)\*\*$/.test(line)) {
      return <div key={i} className="insight-bold">{line.replace(/\*\*/g, '')}</div>;
    }
    // Bold inline **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((p, j) =>
      /^\*\*[^*]+\*\*$/.test(p)
        ? <strong key={j}>{p.replace(/\*\*/g, '')}</strong>
        : p
    );
    if (line.startsWith('- ') || line.startsWith('• ')) {
      return <div key={i} className="insight-bullet">{rendered}</div>;
    }
    if (line.match(/^\d+\.\s/)) {
      return <div key={i} className="insight-numbered">{rendered}</div>;
    }
    if (line.trim() === '') return <div key={i} className="insight-spacer" />;
    return <div key={i} className="insight-line">{rendered}</div>;
  });
}

function InsightsModal({ todos, ideas, trash, aiCfg, onClose }: {
  todos: Todo[];
  ideas: Idea[];
  trash: TrashedTodo[];
  aiCfg: AiCfg;
  onClose: () => void;
}) {
  useDismissable(onClose);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [result, setResult] = useState('');

  useEffect(() => {
    (async () => {
      const summary = buildInsightsSummary(todos, ideas, trash);
      const prompt =
        `あなたは生産性コーチです。以下のユーザーのタスク・ナレッジ・削除履歴データを分析し、日本語で傾向とアドバイスを出力してください。\n\n` +
        `${summary}\n\n` +
        `以下の構成で出力してください（見出しは ## を使用）:\n` +
        `## 📊 傾向分析\n（TODOの完了率・カテゴリ傾向・ナレッジの偏りなど、3〜5点を箇条書き）\n\n` +
        `## ✅ 継続できていること\n（うまくいっている点を2〜3点）\n\n` +
        `## 💡 改善のアドバイス\n（具体的で実践しやすい改善提案を3〜5点）\n\n` +
        `## 🎯 今すぐできるアクション\n（今週中に試せる具体的な行動を2〜3点）\n\n` +
        `データが少ない場合は推測で補完せず「データが不足しています」と記載してください。出力は日本語のみ。`;

      try {
        let out = '';
        if (aiConfigured(aiCfg)) {
          out = await aiText(aiCfg, prompt);
        }
        if (!out) throw new Error('no response');
        setResult(out);
        setStatus('done');
      } catch {
        setStatus('error');
      }
    })();
  }, []);

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet insights-sheet">
        <div className="modal-handle" />
        <div className="insights-header">
          <span className="insights-title">🔍 AI 傾向分析</span>
          <button className="insights-close" onClick={onClose}>✕</button>
        </div>
        <div className="insights-body">
          {status === 'loading' && (
            <div className="insights-loading">
              <div className="spinner" />
              <div className="loading-text">データを分析中...</div>
              <div className="loading-sub">少々お待ちください</div>
            </div>
          )}
          {status === 'error' && (
            <div className="insights-error">
              <div style={{ fontSize: 32 }}>⚠️</div>
              <div style={{ marginTop: 8 }}>分析に失敗しました</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>設定でAI APIキーを確認してください</div>
            </div>
          )}
          {status === 'done' && (
            <div className="insights-content">{renderInsightText(result)}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MemoMon Layer — pixel-art monsters that walk around the app
// ─────────────────────────────────────────────────────────────
type LiveMon = MemoMonInstance & {
  x: number; y: number; vx: number; vy: number;
  facing: 'r' | 'l';
  state: 'walk' | 'idle' | 'hiding' | 'hidden' | 'dislike-wait';
  stateUntil: number;
  hideTimer?: ReturnType<typeof setTimeout>;
  animState: AnimState;
  frame: number;
  frameTime: number;
  tapCount: number;
  personality: 'active' | 'lazy';
  speech?: { text: string; until: number };
};

const MEMOMON_LINES: Record<string, { chat: string[]; tip: string[] }> = {
  kuroneko: {
    chat: ['…にゃ', '夜は静かでよい', 'ふぅ…', '誰かに見られている気がする', 'あくび…', '見るな', '今宵は良い夜だ'],
    tip: ['完了したものは整理してこそ意味があるぞ', 'ナレッジに残せば、未来の自分が助かる'],
  },
  skullon: {
    chat: ['カラカラ…', '我は永遠なり', 'おばけ、どこ行った？', 'ホネは細部に宿る', 'メメント・モリ', 'もう体は無いが、未練はある'],
    tip: ['削除したメモはゴミ箱から復元できる', '整理整頓、それもまた供養'],
  },
  slime: {
    chat: ['ぷるん', 'ぷにぷに', '今日も湿度ばっちり', 'メモにくっついちゃった', 'むにゅ〜ん', 'ふにゃっ'],
    tip: ['TODOに期限を入れると忘れにくくなるよ', 'タグで分類するとあとから探しやすいよ'],
  },
  hiyoko: {
    chat: ['ぴよっ！', 'ぴよぴよぴよ〜', 'ぴよ！(やる気MAX)', 'ぴよぴよ…(疲れた)', 'ちっちゃくても頑張るピヨ', 'ぴよっ！？'],
    tip: ['メモは音声入力もできるピヨ！', '繰り返し設定で習慣化できるピヨ'],
  },
  obake: {
    chat: ['ふぁ〜…', 'ぼくみえてる？', 'ドクロンと遊んでた', '驚かしちゃおっと', 'ふらふら…', 'ぼくの正体は秘密'],
    tip: ['ナレッジタブにメモした知識が貯まるよ〜', '夜更かしせず、明日のTODOを軽くして寝るのもアリ'],
  },
  yukigitsune: {
    chat: ['ふっ、運気上昇のしるしだ', '九尾を見たな', '雪のような気品を', '今日は良い日になるぞ', '尾を数えると不思議が起きる', '選ばれし者よ'],
    tip: ['完了したTODOは履歴に残り、知の糧となる', '焦らずとも、続けることが運を呼ぶ'],
  },
  shibainu: {
    chat: ['わんわん！', 'わんわんわん！', '走り回るぞ！', 'あなた最高！', '尻尾ぶんぶん', '今日も全力疾走！', 'もっと撫でて〜'],
    tip: ['TODOにタグを付けると分類しやすいワン！', '完了するとコインがもらえるワン！'],
  },
  magician: {
    chat: ['じゃじゃーん！', '魔法の時間だ', 'アブラカタブラ', '袖の中、空っぽに見える？', '拍手をくれ、拍手を', '種も仕掛けもあるんだ'],
    tip: ['メモを書いてAI解析するとタスクが自動で生まれるぞ', 'ガチャは確率の魔法、引きすぎ注意'],
  },
  dragon: {
    chat: ['我は黒龍なり', '汝のタスク、整えん', '…', '古より見守る', '忠誠を誓う', '縮んでも龍は龍'],
    tip: ['繰り返し設定は「毎日」「毎週」など選べる', '完了したナレッジは知の宝として残る'],
  },
  pylar: {
    chat: ['いいねっ！', 'うっす！', '君ならできる！', '今日も腕を立てよう！', '筋肉は裏切らない', '応援してるぞ！', 'グッド！'],
    tip: ['TODOを完了するとコインがもらえるぜ！', '1日1タスクでも前進だ！'],
  },
  matameta: {
    chat: ['めためたわかる！', 'ふむふむ、めためたわかる', 'なるほど〜', '頭の芽が育ってきた', 'もう一度教えて？', 'わかったふりは得意'],
    tip: ['ナレッジを集めると芽が伸びる気がする', 'メモを残せば後で見返せるんだって、めためたわかる'],
  },
  gomachan: {
    chat: ['すぴー…', 'ねむい…', 'あと10分…', 'ふあぁ', '起こさないで', 'おふとん最高', '夢の中で泳ぐ', 'ぱたぱた'],
    tip: ['通知設定でリマインドできるよ、たぶん…', '寝る前にTODOを整理しておくと朝が楽だよ'],
  },
};

function pickMemoMonLine(defId: string): string | null {
  const lines = MEMOMON_LINES[defId];
  if (!lines) return null;
  const useTip = lines.tip.length > 0 && Math.random() < 0.3;
  const pool = useTip ? lines.tip : lines.chat;
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// タスク完了時など、メモモン別の台詞が用意されていない場面で使う汎用の喜び台詞
const CHEER_LINES_TASK = ['やったね！', 'すごい！', 'えらい！', 'がんばったね', 'その調子！', 'おつかれさま！'];
function pickCheerLine(): string {
  return CHEER_LINES_TASK[Math.floor(Math.random() * CHEER_LINES_TASK.length)];
}

// ─────────────────────────────────────────────────────────────
// Playground Modal (feed & pet memomons)
// ─────────────────────────────────────────────────────────────
type ReactionKind = 'pet' | 'feedFav' | 'feedNormal' | 'feedDis';
const MEMOMON_REACTIONS: Record<string, Record<ReactionKind, string[]>> = {
  kuroneko: {
    pet:        ['…にゃ', 'ふぅ…', 'まあいい', '見るな', 'もうちょっと'],
    feedFav:    ['これだ…！', '思い出すにゃ', 'お主、わかっておるな', '至福…', '夜のごちそうだ'],
    feedNormal: ['ふむ', '悪くない', 'まあ食ってやろう', 'にゃ', 'ごちそうさま'],
    feedDis:    ['…これは', '勘弁してくれ', 'にゃっ！？', 'これは違う', 'ぐぬぬ'],
  },
  skullon: {
    pet:        ['カラカラ…', '我に触れたな', 'ホネに沁みる', 'もぞ', '気は確かか？'],
    feedFav:    ['カラカラ！！', '我が魂が震える', 'これぞ供物', '永遠の味だ', 'おばけにも分けてやろう'],
    feedNormal: ['いただこう', 'カラカラ', '腹はないが…', 'ふむ', 'まあよかろう'],
    feedDis:    ['カラ…？', 'これは罠か', '我を試すか', 'ホネが拒んでいる', 'うっ…'],
  },
  slime: {
    pet:        ['ぷるん♪', 'むにゅ〜', 'もっとぉ', 'ぷにぷに〜', 'たのしー！'],
    feedFav:    ['ぷるん♥', 'すきー！', 'もっとちょうだい！', 'しあわせ〜', 'これだいすき！'],
    feedNormal: ['ぷる', 'うん', 'おいしい', 'ぷにっ', 'ごちそうさま'],
    feedDis:    ['ぷる…', 'うえ〜', 'ぷにゅん（拒否）', 'これダメ…', '溶けそう…'],
  },
  hiyoko: {
    pet:        ['ぴよ♪', 'ぴよぴよ〜', 'うれしいピヨ', 'ぴよ！', 'もっとピヨ'],
    feedFav:    ['ピヨ♥', '大好きピヨ！', 'ぴよぴよっ！', 'もっとちょうだいピヨ', 'たまらんピヨ'],
    feedNormal: ['ぴよ', 'ごちそうさまピヨ', 'おいしいピヨ', 'ぴよぴよ', 'まあピヨ'],
    feedDis:    ['ぴ、ぴよ…', 'これはピヨらない', 'ぴよっ！？', '苦手ピヨ', 'うっぴよ'],
  },
  obake: {
    pet:        ['ふわ〜', 'くすぐったい〜', 'ぼくに触れたね', 'ふふっ', 'もう一回ね'],
    feedFav:    ['ふわふわ♥', 'ぼくの大好物だ！', '透けるくらい嬉しい！', 'ありがと〜', '一生ついていくよ'],
    feedNormal: ['いただきまーす', 'ふむふむ', 'ぼくも食べられるんだ', '満足', 'ごちそうさま'],
    feedDis:    ['ふ、ふぇ…', 'ちょっと…', 'ぼく無理かも', 'うえぇ', '消えちゃう…'],
  },
  yukigitsune: {
    pet:        ['ふっ', '良き手つきよ', '尾が揺れる', '心地よい', 'もう少し…'],
    feedFav:    ['ふっ、見事！', '神饌の味よ', '我が選んだ証', '永遠に覚えておこう', '汝に幸あれ'],
    feedNormal: ['いただこう', 'ふむ', '悪くない', 'ありがたい', 'ごちそうさま'],
    feedDis:    ['…', 'これは…', '我を試すか', 'ふっ、無理', '受け取れぬ'],
  },
  shibainu: {
    pet:        ['わん！', 'もっと！', 'うれしいわん♪', 'なでなで好き！', '尻尾とまらん！'],
    feedFav:    ['わわわん！', 'これ最高ぉぉ！', 'ありがとうわん！！', 'ごほうび！！', '飼い主は神…！'],
    feedNormal: ['わん♪', 'うまうま', 'ごちそうさまわん', 'おいちー', 'もぐもぐ'],
    feedDis:    ['わぅ…', 'これは違うわん', 'うえぇぇ…', 'なんで？', '違うやつほしいわん'],
  },
  magician: {
    pet:        ['マジックタイム！', 'ふふ、心地よい', 'これも魔法', 'おや、優しいね', 'ブラボー！'],
    feedFav:    ['ジャジャーン！', '魔法のような味！', 'これぞ秘伝のレシピ！', '私の最高傑作だ', 'アンコール！'],
    feedNormal: ['頂戴しよう', 'ふむ', '魔法的に消えていく', 'ごちそうさま', '満足だ'],
    feedDis:    ['消失の魔法を…', 'これは罠か？', '私の舌は誤魔化せん', 'ノーサンキュー', 'マジで無理'],
  },
  dragon: {
    pet:        ['…うむ', '心地よい', '人の手とは', 'ふぅ', 'もう少しよかろう'],
    feedFav:    ['これぞ伝説の味', '汝、献身を見せたな', '我が魂が震える', '千年の友よ', '忠誠を誓う'],
    feedNormal: ['いただこう', 'うむ', '悪くない', 'ありがたい', '腹は満ちた'],
    feedDis:    ['…', 'これは…', '我に挑むか', '受け取れぬ', '汝、覚悟はあるか'],
  },
  pylar: {
    pet:        ['いいねっ！', 'うれしいぜ！', 'もっとくれ！', '元気が出る！', 'サンキュー！'],
    feedFav:    ['ベリーグッド！', '最高！！！', 'これは筋肉になる！', '今日はベストデー！', 'ありがとう兄貴！'],
    feedNormal: ['いただきます！', 'うむ、うまい', 'ごちそうさん', '満タンだぜ', 'いい栄養！'],
    feedDis:    ['うっ…', 'これは厳しい', '筋肉が拒否', 'ちょっとパス', 'グッドじゃない…'],
  },
  matameta: {
    pet:        ['めためたわかる', 'なるほどなで！', 'これはいい', 'ふむふむ', '芽が育つ'],
    feedFav:    ['めためたわかる！！', 'これは伝説の味！', '芽がぐんぐん育つ！', '知識が増えた気がする', 'めためた満足！'],
    feedNormal: ['ふむふむ', 'めためた普通', 'ごちそうさま', 'これも勉強', '満足めためた'],
    feedDis:    ['めため…た？', 'これは違うかも', '芽が縮む…', 'うっ', 'めため…たくない'],
  },
  gomachan: {
    pet:        ['ふあぁ…', 'ねむい…', 'もうちょっと…', 'すぴー', 'ぱたぱた'],
    feedFav:    ['ぱたぱた♥', 'お腹いっぱい幸せ', 'すきー…', 'ぱたぱたぱた', 'おふとんに戻る'],
    feedNormal: ['もぐもぐ…', 'ありがと…', 'ふあぁ…', 'すぴー…', 'ごちそうさま'],
    feedDis:    ['ぐぬ…', '寝る前提でない…', 'ぱた…', 'ふぁ…ダメ', 'うえぇ'],
  },
};

function pickReaction(defId: string, kind: ReactionKind): string | null {
  const r = MEMOMON_REACTIONS[defId];
  if (!r) return null;
  const pool = r[kind];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

const PET_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

function affectionLevel(a: number): { label: string; stars: string } {
  if (a >= 90) return { label: '心の友', stars: '★★★★★' };
  if (a >= 70) return { label: 'なかよし', stars: '★★★★' };
  if (a >= 40) return { label: '打ち解けた', stars: '★★★' };
  if (a >= 15) return { label: '挨拶仲間', stars: '★★' };
  return { label: 'おはつ', stars: '★' };
}

// 餌をえらぶシート。メモモンずかん（あそび画面）と、にわのおねだりの
// 両方から使う共通コンポーネント。
function FoodPickerSheet({ foodInventory, coins, infinite, title = '餌をえらぶ', standalone = false, onPick, onClose }: {
  foodInventory: Record<string, number>;
  coins: number;
  infinite: boolean;
  title?: string;
  // にわから直接開くときは画面全体を覆う（ずかんではモーダル内に収める）
  standalone?: boolean;
  onPick: (f: Food) => void;
  onClose: () => void;
}) {
  useDismissable(onClose);
  return (
    <div className={`playground-food-overlay${standalone ? ' standalone' : ''}`} onClick={onClose}>
      <div className="playground-food-sheet" onClick={e => e.stopPropagation()}>
        <div className="playground-food-title">{title}</div>
        <div className="playground-food-grid">
          {FOODS.map(f => {
            const stock = foodInventory[f.id] || 0;
            const canAfford = stock > 0 || infinite || coins >= f.cost;
            return (
              <button
                key={f.id}
                className={`playground-food-card grade-${f.grade}${!canAfford ? ' disabled' : ''}${stock > 0 ? ' in-stock' : ''}`}
                onClick={() => canAfford && onPick(f)}
                disabled={!canAfford}
              >
                {stock > 0 && <div className="playground-food-stock">×{stock}</div>}
                <div className="playground-food-emoji">{f.emoji}</div>
                <div className="playground-food-name">{f.name}</div>
                <div className="playground-food-grade">{'★'.repeat(f.grade)}</div>
                <div className="playground-food-cost">
                  {stock > 0
                    ? <span className="playground-food-stock-label">在庫から</span>
                    : <><IcoCoin />&nbsp;{f.cost}</>}
                </div>
              </button>
            );
          })}
        </div>
        <button className="playground-food-cancel" onClick={onClose}>キャンセル</button>
      </div>
    </div>
  );
}

function PlaygroundModal({ memoMons, coins, infinite, activeMonUid, initialUid, foodInventory, itemInventory, unlockedSounds, unlockedBgs, onClose, onUpdateMons, onSpendCoins, onGainCoins, onSetActive, onConsumeFood, onCollectItem, onUnlockSound, onUnlockBg }: {
  memoMons: MemoMonInstance[];
  coins: number;
  infinite: boolean;
  activeMonUid: string | undefined;
  initialUid?: string | null;
  foodInventory: Record<string, number>;
  itemInventory: Record<string, number>;
  unlockedSounds: string[];
  unlockedBgs: number[];
  onClose: () => void;
  onUpdateMons: (updater: (mons: MemoMonInstance[]) => MemoMonInstance[]) => void;
  onSpendCoins: (amount: number) => void;
  onGainCoins: (amount: number) => void;
  onSetActive: (uid: string) => void;
  onConsumeFood: (foodId: string) => void;
  onCollectItem: (itemId: string) => void;
  onUnlockSound: (soundType: string) => void;
  onUnlockBg: (bgIdx: number) => void;
}) {
  useDismissable(onClose);
  const visibleMons = memoMons.filter(m => MEMOMON_DEFS.find(d => d.id === m.defId));
  const [selectedUid, setSelectedUid] = useState<string | null>(
    (initialUid && visibleMons.some(m => m.uid === initialUid) ? initialUid : visibleMons[0]?.uid) ?? null
  );
  const [showFoodPicker, setShowFoodPicker] = useState(false);
  const [inspectItemId, setInspectItemId] = useState<string | null>(null);
  const [giftReveal, setGiftReveal] = useState<{ itemId: string; monName: string } | null>(null);
  const [bonusReveal, setBonusReveal] = useState<{ kind: 'sound' | 'bg'; label: string; color: string } | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const [swipeNudge, setSwipeNudge] = useState<'prev' | 'next' | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'fav' | 'dis' | 'normal' | 'pet' | 'cooldown' | 'broke' | 'full' } | null>(null);
  const [bubbleMsg, setBubbleMsg] = useState<string | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [animFrame, setAnimFrame] = useState(0);
  const [currentAnim, setCurrentAnim] = useState<AnimState>('sit');

  const selected = visibleMons.find(m => m.uid === selectedUid) || visibleMons[0];
  const selectedDef = selected ? MEMOMON_DEFS.find(d => d.id === selected.defId) : null;

  // Reset to idle (sit) whenever the selected memomon changes
  useEffect(() => {
    setCurrentAnim('sit');
    setAnimFrame(0);
    if (bubbleTimerRef.current) { clearTimeout(bubbleTimerRef.current); bubbleTimerRef.current = null; }
    setBubbleMsg(null);
  }, [selectedUid]);

  function shiftSelected(dir: -1 | 1) {
    if (visibleMons.length <= 1) return;
    const idx = Math.max(0, visibleMons.findIndex(m => m.uid === selected?.uid));
    const next = (idx + dir + visibleMons.length) % visibleMons.length;
    setSelectedUid(visibleMons[next].uid);
    setSwipeNudge(dir === 1 ? 'next' : 'prev');
    setTimeout(() => setSwipeNudge(null), 220);
  }

  function handleSwipeStart(e: React.TouchEvent | React.PointerEvent) {
    if (visibleMons.length <= 1) return;
    const x = 'touches' in e ? e.touches[0]?.clientX : (e as React.PointerEvent).clientX;
    if (typeof x === 'number') swipeStartXRef.current = x;
  }
  function handleSwipeEnd(e: React.TouchEvent | React.PointerEvent) {
    const start = swipeStartXRef.current;
    swipeStartXRef.current = null;
    if (start === null) return;
    const x = 'changedTouches' in e ? e.changedTouches[0]?.clientX : (e as React.PointerEvent).clientX;
    if (typeof x !== 'number') return;
    const delta = x - start;
    if (Math.abs(delta) < 50) return;
    shiftSelected(delta < 0 ? 1 : -1);
  }

  function showBubble(text: string) {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    setBubbleMsg(text);
    bubbleTimerRef.current = setTimeout(() => {
      setBubbleMsg(null);
      bubbleTimerRef.current = null;
    }, 3500);
  }

  // Roll for an item drop if the memomon's affection is at MAX.
  // Returns the dropped item id (and triggers UI), or null.
  function tryItemDrop(defId: string, currentAffection: number, chance: number): string | null {
    if (currentAffection < 100) return null;
    const item = ITEM_BY_DEFID[defId];
    if (!item) return null;
    if (Math.random() >= chance) return null;
    const def = MEMOMON_DEFS.find(d => d.id === defId);
    onCollectItem(item.id);
    setGiftReveal({ itemId: item.id, monName: def?.name ?? '' });
    return item.id;
  }

  // Roll for a basic bg/sound unlock when affection is at MAX. Runs only
  // when the rarer gift drop did NOT fire. Picks among still-locked
  // sounds/bgs from the gacha pool. Returns true if something was awarded.
  function tryBonusDrop(currentAffection: number, chance: number): boolean {
    if (currentAffection < 100) return false;
    if (Math.random() >= chance) return false;
    const lockedSounds = GACHA_ITEMS.filter(
      g => g.type === 'sound' && g.soundType && !unlockedSounds.includes(g.soundType)
    );
    const lockedBgs = GACHA_ITEMS.filter(
      g => g.type === 'bg' && g.bgIdx !== undefined && !unlockedBgs.includes(g.bgIdx)
    );
    const pool = [...lockedSounds, ...lockedBgs];
    if (pool.length === 0) return false;
    // Weight by inverse-rarity (common easier to drop than ultra)
    const rarityWeight: Record<string, number> = { common: 6, rare: 4, super: 2, ultra: 1 };
    const weighted: typeof pool = [];
    for (const item of pool) {
      const w = rarityWeight[item.rarity] || 1;
      for (let i = 0; i < w; i++) weighted.push(item);
    }
    const picked = weighted[Math.floor(Math.random() * weighted.length)];
    if (picked.type === 'sound' && picked.soundType) {
      onUnlockSound(picked.soundType);
    } else if (picked.type === 'bg' && picked.bgIdx !== undefined) {
      onUnlockBg(picked.bgIdx);
    } else {
      return false;
    }
    setBonusReveal({
      kind: picked.type as 'sound' | 'bg',
      label: picked.label,
      color: picked.color,
    });
    return true;
  }

  // Drive the big sprite animation. Looping anims (sit) repeat forever;
  // one-shot anims (happy / surprise) return to sit when complete.
  useEffect(() => {
    const animDef = selectedDef?.sprites?.[currentAnim];
    if (!animDef) {
      if (currentAnim !== 'sit') setCurrentAnim('sit');
      return;
    }
    setAnimFrame(0);
    let frame = 0;
    // Idle (sit) only cycles between frames 0 and 1 for a subtle breath/bob.
    // Reaction anims (happy / dislike / surprise) play through all their frames.
    const total = currentAnim === 'sit'
      ? Math.min(2, animDef.frames.length)
      : animDef.frames.length;
    const fps = animDef.fps || 6;
    const id = setInterval(() => {
      frame += 1;
      if (frame >= total) {
        if (animDef.loop) {
          frame = 0;
          setAnimFrame(0);
        } else {
          clearInterval(id);
          setCurrentAnim('sit');
        }
      } else {
        setAnimFrame(frame);
      }
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [selectedDef, currentAnim]);

  type ToastTone = 'fav' | 'dis' | 'normal' | 'pet' | 'cooldown' | 'broke' | 'full';
  function showToastMsg(text: string, tone: ToastTone) {
    setToast({ text, tone });
    setTimeout(() => setToast(t => t && t.text === text ? null : t), 2500);
  }

  function handleFeed(food: Food) {
    if (!selected || !selectedDef) return;
    const now0 = Date.now();
    if (effectiveHunger(selected, now0) >= 100) {
      showToastMsg(`${selectedDef.name} はお腹いっぱいみたい…`, 'full');
      return;
    }
    const stock = foodInventory[food.id] || 0;
    const useInventory = stock > 0;
    if (!useInventory && !infinite && coins < food.cost) {
      showToastMsg('コインが足りません', 'broke');
      return;
    }
    if (useInventory) onConsumeFood(food.id);
    else if (!infinite) onSpendCoins(food.cost);
    const eff = computeFeedingEffect(selectedDef.id, food.id);
    const now = Date.now();
    const affBefore = effectiveAffection(selected, now);
    onUpdateMons(prev => prev.map(m => {
      if (m.uid !== selected.uid) return m;
      const baseAff = effectiveAffection(m);
      const baseHun = effectiveHunger(m, now); // 満腹度は時間で減るので現在値を基準にする
      return {
        ...m,
        affection: Math.max(0, Math.min(100, baseAff + eff.affectionDelta)),
        hunger:    Math.max(0, Math.min(100, baseHun + eff.hungerDelta)),
        lastFed:   now,
        lastSeenAt: now,
      };
    }));
    const reactionKind: ReactionKind = eff.reaction === 'fav'
      ? 'feedFav'
      : eff.reaction === 'dis'
      ? 'feedDis'
      : 'feedNormal';
    const line = pickReaction(selectedDef.id, reactionKind);
    if (line) showBubble(line);
    const sign = eff.affectionDelta >= 0 ? '+' : '';
    const prefix = eff.reaction === 'fav' ? '大好物！' : eff.reaction === 'dis' ? '嫌いみたい…' : '満足げ';
    const dropped = eff.reaction === 'fav'
      ? tryItemDrop(selectedDef.id, affBefore, ITEM_DROP_CHANCE_FEED_FAV)
      : null;
    // If rare gift didn't drop, try the basic bg/sound drop (favorite only)
    const bonus = !dropped && eff.reaction === 'fav'
      ? tryBonusDrop(affBefore, BONUS_DROP_CHANCE_FEED_FAV)
      : false;
    if (!dropped && !bonus) showToastMsg(`${prefix} なつき ${sign}${eff.affectionDelta}`, eff.reaction);
    setShowFoodPicker(false);
    // Reaction animation: favorite/normal -> happy, disliked -> dislike
    const reactionAnim: AnimState = eff.reaction === 'dis' ? 'dislike' : 'happy';
    setCurrentAnim(reactionAnim);
    setAnimFrame(0);
  }

  function handlePet() {
    if (!selected || !selectedDef) return;
    const now = Date.now();
    const last = selected.lastPetAt ?? 0;
    if (now - last < PET_COOLDOWN_MS) {
      const remainMin = Math.ceil((PET_COOLDOWN_MS - (now - last)) / 60000);
      showToastMsg(`もう少し休ませてあげて（あと ${remainMin} 分）`, 'cooldown');
      return;
    }
    const affBefore = effectiveAffection(selected, now);
    onUpdateMons(prev => prev.map(m => {
      if (m.uid !== selected.uid) return m;
      const baseAff = effectiveAffection(m);
      return { ...m, affection: Math.min(100, baseAff + 2), lastPetAt: now, lastSeenAt: now };
    }));
    if (!infinite) onGainCoins(5);
    const line = pickReaction(selectedDef.id, 'pet');
    if (line) showBubble(line);
    const dropped = tryItemDrop(selectedDef.id, affBefore, ITEM_DROP_CHANCE_PET);
    const bonus = !dropped ? tryBonusDrop(affBefore, BONUS_DROP_CHANCE_PET) : false;
    if (!dropped && !bonus) showToastMsg('なつき +2、コイン +5', 'pet');
    // Trigger happy reaction (one-shot, then auto-returns to sit)
    setCurrentAnim('happy');
    setAnimFrame(0);
  }

  const animFrames = selectedDef?.sprites?.[currentAnim]?.frames || selectedDef?.sprites?.sit?.frames;
  const bigSrc = animFrames && animFrames.length > 0
    ? animFrames[animFrame % animFrames.length]
    : (selected ? MEMOMON_IMGS[selected.defId] : '');
  const nowMs = Date.now();
  const aff = selected ? effectiveAffection(selected, nowMs) : 0;
  const hun = selected ? effectiveHunger(selected, nowMs) : 0;
  const lvl = affectionLevel(aff);
  return (
    <div className="modal-backdrop playground-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="playground-modal">
        <button className="playground-close-btn" onClick={onClose} aria-label="閉じる">✕</button>
        <div className="playground-title">メモモンずかん</div>
        <div className="playground-coin-display">所持: <IcoCoin />&nbsp;{infinite ? '∞' : coins}</div>

        {visibleMons.length === 0 ? (
          <div className="playground-empty">
            まだメモモンを持っていません。<br />
            ガチャでメモモンをお迎えしましょう！
          </div>
        ) : (
          <>
            {selected && selectedDef && (
              <div
                className={`playground-detail${swipeNudge ? ` swipe-${swipeNudge}` : ''}`}
                onTouchStart={handleSwipeStart}
                onTouchEnd={handleSwipeEnd}
              >
                <div className="playground-stage">
                  {bubbleMsg && (
                    <div key={bubbleMsg} className="playground-stage-bubble">{bubbleMsg}</div>
                  )}
                  <img className="playground-stage-img" src={bigSrc} alt={selectedDef.name} />
                </div>
                <div className="playground-name">{selectedDef.name}</div>
                <div className="playground-level">{lvl.stars} <span>{lvl.label}</span></div>
                {(() => {
                  const gachaItem = GACHA_ITEMS.find(g => g.type === 'memomon' && g.monDefId === selectedDef.id);
                  const ecology = (gachaItem?.flavor || selectedDef.desc || '').replace(/^【生態】/, '').trim();
                  if (!ecology) return null;
                  return <div className="playground-bio">{ecology}</div>;
                })()}
                <div className="playground-meter">
                  <div className="playground-meter-label">なつき度</div>
                  <div className="playground-meter-bar">
                    <div className="playground-meter-fill playground-meter-aff" style={{ width: `${aff}%` }} />
                  </div>
                  <div className="playground-meter-val">{aff} / 100</div>
                </div>
                <div className="playground-meter">
                  <div className="playground-meter-label">満腹度</div>
                  <div className="playground-meter-bar">
                    <div className="playground-meter-fill playground-meter-hun" style={{ width: `${hun}%` }} />
                  </div>
                  <div className="playground-meter-val">{Math.round(hun)} / 100</div>
                </div>

                <div className="playground-prefs">
                  <div className="playground-prefs-hint">
                    好物・嫌いな物は色んな餌をあげて見つけよう
                  </div>
                  {(() => {
                    const giftItem = ITEM_BY_DEFID[selectedDef.id];
                    const count = giftItem ? (itemInventory[giftItem.id] || 0) : 0;
                    const SLOTS = 5;
                    const hasAny = !!(giftItem && count > 0);
                    return (
                      <div className="playground-gifts">
                        <div className="playground-gifts-label">🎁 おくりもの</div>
                        <div className="playground-gifts-slots">
                          {Array.from({ length: SLOTS }).map((_, i) => {
                            if (i === 0 && hasAny) {
                              return (
                                <button
                                  key={i}
                                  className="playground-gift-slot filled"
                                  onClick={() => setInspectItemId(giftItem!.id)}
                                  aria-label={giftItem!.name}
                                  title={giftItem!.name}
                                >
                                  <img src={giftItem!.imageUrl} alt={giftItem!.name} />
                                  {count > 1 && <span className="playground-gift-slot-count">×{count}</span>}
                                </button>
                              );
                            }
                            return (
                              <div key={i} className="playground-gift-slot empty">
                                <span>?</span>
                              </div>
                            );
                          })}
                        </div>
                        {!hasAny && (
                          <div className="playground-gifts-empty-hint">
                            なつき度MAXで仲良くなったら、もらえるかも…？
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="playground-actions">
                  <button className="playground-btn playground-btn-pet" onClick={handlePet}>
                    ✋ なでる<span className="playground-btn-sub">+2 / +5🪙</span>
                  </button>
                  <button
                    className="playground-btn playground-btn-feed"
                    onClick={() => setShowFoodPicker(true)}
                    disabled={hun >= 100}
                  >
                    🍽️ 餌をあげる{hun >= 100 && <span className="playground-btn-sub">お腹いっぱい</span>}
                  </button>
                </div>
                {(() => {
                  const isOnScreen = selected.uid === activeMonUid || (!activeMonUid && selected.uid === visibleMons[0]?.uid);
                  return (
                    <button
                      className={`playground-btn-active${isOnScreen ? ' onscreen' : ''}`}
                      onClick={() => onSetActive(selected.uid)}
                      disabled={isOnScreen}
                    >
                      {isOnScreen
                        ? '🏠 にわにお出かけ中'
                        : '🚪 この子を画面に出す'}
                    </button>
                  );
                })()}
              </div>
            )}

            {visibleMons.length > 1 && (
              <>
                <button
                  className="playground-nav-arrow left"
                  onClick={() => shiftSelected(-1)}
                  aria-label="前のメモモン"
                >‹</button>
                <button
                  className="playground-nav-arrow right"
                  onClick={() => shiftSelected(1)}
                  aria-label="次のメモモン"
                >›</button>
                <div className="playground-dots">
                  {visibleMons.map(m => (
                    <button
                      key={m.uid}
                      className={`playground-dot${m.uid === selected?.uid ? ' active' : ''}${m.uid === activeMonUid || (!activeMonUid && m.uid === visibleMons[0]?.uid) ? ' is-active-mon' : ''}`}
                      onClick={() => setSelectedUid(m.uid)}
                      aria-label={(MEMOMON_DEFS.find(d => d.id === m.defId) || { name: '' }).name}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {toast && (
          <div className={`playground-toast playground-toast-${toast.tone}`}>{toast.text}</div>
        )}

        {bonusReveal && (
          <div className="bonus-reveal-overlay" onClick={() => setBonusReveal(null)}>
            <div className="bonus-reveal-card" onClick={e => e.stopPropagation()} style={{ borderColor: bonusReveal.color }}>
              <div className="bonus-reveal-banner" style={{ color: bonusReveal.color }}>
                {bonusReveal.kind === 'sound' ? '🎵 効果音' : '🎨 背景'} GET!
              </div>
              <div className="bonus-reveal-label">{bonusReveal.label}</div>
              <div className="bonus-reveal-sub">
                {bonusReveal.kind === 'sound'
                  ? '設定 → サウンド から選べます'
                  : '設定 → 背景テーマ から選べます'}
              </div>
              <button className="bonus-reveal-close" onClick={() => setBonusReveal(null)}>OK</button>
            </div>
          </div>
        )}

        {giftReveal && (() => {
          const item = ITEM_BY_ID[giftReveal.itemId];
          if (!item) return null;
          return (
            <div className="gift-reveal-overlay" onClick={() => setGiftReveal(null)}>
              <div className="gift-reveal-rays" />
              <div className="gift-reveal-particles">
                {Array.from({ length: 18 }).map((_, i) => (
                  <span key={i} className={`gift-particle p${i}`}>✨</span>
                ))}
              </div>
              <div className="gift-reveal-card" onClick={e => e.stopPropagation()}>
                <div className="gift-reveal-banner">✨ おくりもの GET! ✨</div>
                <div className="gift-reveal-mon">{giftReveal.monName} から</div>
                <div className="gift-reveal-stage">
                  <img src={item.imageUrl} alt={item.name} />
                </div>
                <div className="gift-reveal-name">{item.name}</div>
                <button className="gift-reveal-close" onClick={() => setGiftReveal(null)}>OK</button>
              </div>
            </div>
          );
        })()}

        {inspectItemId && (() => {
          const item = ITEM_BY_ID[inspectItemId];
          if (!item) return null;
          const giver = MEMOMON_DEFS.find(d => d.id === item.defId);
          return (
            <div className="playground-item-overlay" onClick={() => setInspectItemId(null)}>
              <div className="playground-item-sheet" onClick={e => e.stopPropagation()}>
                <button className="gacha-close-btn" onClick={() => setInspectItemId(null)} aria-label="閉じる">✕</button>
                <div className="playground-item-stage">
                  <img src={item.imageUrl} alt={item.name} />
                </div>
                <div className="playground-item-name">{item.name}</div>
                <div className="playground-item-giver">{giver?.name ?? ''}からの贈り物</div>
                <div className="playground-item-comment">{item.comment}</div>
                {(itemInventory[item.id] || 0) > 1 && (
                  <div className="playground-item-count-label">所持: ×{itemInventory[item.id]}</div>
                )}
              </div>
            </div>
          );
        })()}

        {showFoodPicker && selectedDef && (
          <FoodPickerSheet
            foodInventory={foodInventory}
            coins={coins}
            infinite={infinite}
            onPick={handleFeed}
            onClose={() => setShowFoodPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

function MemoMonLayer({ mons, scale, initSleep, speechEnabled, cheer, onTapReward, onFulfillRequest }: { mons: MemoMonInstance[]; scale: number; initSleep: boolean; speechEnabled: boolean; cheer?: { n: number; text?: string }; onTapReward: () => void; onFulfillRequest?: (uid: string) => void }) {
  const scaleRef    = useRef(scale);
  scaleRef.current  = scale;
  const speechEnabledRef = useRef(speechEnabled);
  speechEnabledRef.current = speechEnabled;
  // おねだり中かどうかを RAF ループから参照するための鏡
  const requestsRef = useRef<Record<string, MonRequestKind | undefined>>({});
  requestsRef.current = Object.fromEntries(mons.map(m => [m.uid, m.request]));
  const liveRef     = useRef<Record<string, LiveMon>>({});
  const elemRefs    = useRef<Record<string, HTMLDivElement | null>>({});
  const imgRefs     = useRef<Record<string, HTMLImageElement | null>>({});
  const bubbleRefs  = useRef<Record<string, HTMLDivElement | null>>({});
  const reqRefs     = useRef<Record<string, HTMLDivElement | null>>({});
  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const rootRef     = useRef<HTMLDivElement | null>(null);
  const [monIds, setMonIds] = useState<string[]>([]);

  // 庭（親コンテナ）の内側だけを歩く。座標はコンテナ相対
  const boundsOf = () => ({
    W: rootRef.current?.clientWidth || window.innerWidth,
    H: rootRef.current?.clientHeight || window.innerHeight,
  });
  // 地面ゾーン：メモモンの足元が世界の下端から GROUND_MIN〜GROUND_MAX px の帯に収まる
  const GROUND_MAX = 96;
  const GROUND_MIN = 14;
  const groundY = (H: number, mh: number) => {
    const yMin = Math.max(0, H - mh - GROUND_MAX);
    const yMax = Math.max(yMin, H - mh - GROUND_MIN);
    return { yMin, yMax };
  };

  useEffect(() => {
    const now = Date.now();
    const { W, H } = boundsOf();
    mons.forEach(m => {
      if (!liveRef.current[m.uid]) {
        // 未知の defId（旧バージョン・クラウド同期・データ破損由来）でも
        // クラッシュしないようにスキップする。
        const def = MEMOMON_DEFS.find(d => d.id === m.defId);
        if (!def) return;
        const hoursElapsed = (now - m.lastFed) / 3600000;
        const hunger = Math.max(0, m.hunger - hoursElapsed * 10);
        const sc = scaleRef.current;
        const startSleep = initSleep && !!def.sprites;
        const personality: 'active' | 'lazy' = m.activity ?? (Math.random() < 0.5 ? 'active' : 'lazy');
        const initSpeed = personality === 'active' ? 45 : 18;
        const gy = groundY(H, Math.round(def.monH * sc));
        liveRef.current[m.uid] = {
          ...m, hunger,
          x: Math.random() * Math.max(0, W - def.monW * sc),
          y: gy.yMin + Math.random() * (gy.yMax - gy.yMin),
          vx: startSleep ? 0 : (Math.random() > 0.5 ? 1 : -1) * initSpeed,
          vy: startSleep ? 0 : (Math.random() - 0.5) * (personality === 'active' ? 18 : 8),
          facing: 'r',
          state: startSleep ? 'idle' : 'walk',
          stateUntil: now + 2000 + Math.random() * 3000,
          animState: startSleep ? 'sleep' : (def.sprites ? 'walk' : 'sit'),
          frame: 0, frameTime: 0, tapCount: 0,
          personality,
        };
      }
    });
    Object.keys(liveRef.current).forEach(uid => {
      if (!mons.find(m => m.uid === uid)) delete liveRef.current[uid];
    });
    setMonIds(mons.map(m => m.uid));
  }, [mons]);

  useEffect(() => {
    const step = (time: number) => {
      const dt = Math.min((time - (lastTimeRef.current || time)) / 1000, 0.05);
      lastTimeRef.current = time;
      const now = Date.now();
      const { W, H } = boundsOf();

      Object.values(liveRef.current).forEach(m => {
        const def = MEMOMON_DEFS.find(d => d.id === m.defId);
        if (!def) return;
        const sc = scaleRef.current;
        const mw = Math.round(def.monW * sc);

        const offscreen = m.state === 'hidden' || m.state === 'hiding' || m.state === 'dislike-wait';
        const pendingReq = requestsRef.current[m.uid];

        // Update speech bubble (uses position from previous frame — invisible at 60fps)
        const bubble = bubbleRefs.current[m.uid];
        if (bubble) {
          const expired = m.speech && Date.now() > m.speech.until;
          if (expired || !speechEnabledRef.current) m.speech = undefined;
          // おねだり中は吹き出しと重なるので、おねだりを優先して表示する
          const hide = !m.speech || offscreen || !!pendingReq;
          if (hide) {
            if (bubble.style.display !== 'none') bubble.style.display = 'none';
          } else {
            bubble.style.left = `${Math.round(m.x + mw / 2)}px`;
            bubble.style.top  = `${Math.round(m.y) - 6}px`;
            if (bubble.style.display !== 'block') bubble.style.display = 'block';
          }
        }

        // おねだりバッジもメモモンの頭上に追従させる
        const reqEl = reqRefs.current[m.uid];
        if (reqEl) {
          if (!pendingReq || offscreen) {
            if (reqEl.style.display !== 'none') reqEl.style.display = 'none';
          } else {
            reqEl.style.left = `${Math.round(m.x + mw / 2)}px`;
            reqEl.style.top  = `${Math.round(m.y) - 6}px`;
            if (reqEl.style.display !== 'flex') reqEl.style.display = 'flex';
          }
        }
        const mh = Math.round(def.monH * sc);

        if (m.state === 'hidden') return;

        // ── Sprite frame animation ──────────────────────────────
        if (def.sprites) {
          const animDef = def.sprites[m.animState];
          if (animDef) {
            m.frameTime += dt;
            // Idle (sit) loops only frames 0-1 for a subtle breathing pose;
            // other anims play through all frames.
            const totalFrames = m.animState === 'sit'
              ? Math.min(2, animDef.frames.length)
              : animDef.frames.length;
            const rawFrame = Math.floor(m.frameTime * animDef.fps);
            const newFrame = animDef.loop ? rawFrame % totalFrames : Math.min(rawFrame, totalFrames - 1);
            if (newFrame !== m.frame) {
              m.frame = newFrame;
              const imgEl = imgRefs.current[m.uid];
              if (imgEl) imgEl.src = animDef.frames[m.frame];
            }
            // Non-looping animation completed
            if (!animDef.loop && rawFrame >= totalFrames) {
              if (m.animState === 'happy') {
                m.animState = 'sit'; m.frameTime = 0; m.frame = 0;
              } else if (m.animState === 'surprise') {
                // tapCount はリセットしない（コイン獲得は通算3回まで／寝起きの
                // タップもカウントに含める）
                m.animState = 'sit'; m.frameTime = 0; m.frame = 0;
              } else if (m.animState === 'dislike' && m.state === 'dislike-wait') {
                const dirs = [
                  { dx: -250, dy: 0, dist: m.x }, { dx: 250, dy: 0, dist: W - m.x - mw },
                ];
                const best = dirs.reduce((a, b) => a.dist < b.dist ? a : b);
                m.vx = best.dx; m.vy = best.dy;
                m.state = 'hiding'; m.stateUntil = Date.now() + 10000;
              }
            }
          }
        }

        if (m.state === 'dislike-wait') {
          const el = elemRefs.current[m.uid];
          if (el) {
            el.style.left = `${Math.round(m.x)}px`;
            el.style.top  = `${Math.round(m.y)}px`;
          }
          return;
        }

        if (m.state === 'hiding') {
          m.x += m.vx * dt; m.y += m.vy * dt;
          if (m.vx !== 0) m.facing = m.vx < 0 ? 'l' : 'r';
          const el = elemRefs.current[m.uid];
          if (el) {
            el.style.left = `${Math.round(m.x)}px`;
            el.style.top  = `${Math.round(m.y)}px`;
            const flipH = (m.facing === 'l') !== (def.spriteFacing === 'l');
            el.style.transform = `scaleX(${flipH ? -1 : 1})`;
          }
          const offscreen = m.x < -mw - 10 || m.x > W + 10 || m.y < -mh - 10 || m.y > H + mh + 10;
          if (offscreen) {
            m.state = 'hidden';
            if (el) el.style.display = 'none';
            m.hideTimer = setTimeout(() => {
              const sc2 = scaleRef.current;
              const b2 = boundsOf();
              const gy2 = groundY(b2.H, Math.round(def.monH * sc2));
              m.state = 'idle'; m.animState = 'sit'; m.frameTime = 0; m.frame = 0;
              m.x = Math.random() * Math.max(0, b2.W - Math.round(def.monW * sc2));
              m.y = gy2.yMin + Math.random() * (gy2.yMax - gy2.yMin);
              m.vx = 0; m.vy = 0;
              m.stateUntil = Date.now() + 1500 + Math.random() * 2000;
              const reEl = elemRefs.current[m.uid];
              const reImg = imgRefs.current[m.uid];
              if (reEl) { reEl.style.display = 'block'; reEl.style.left = `${Math.round(m.x)}px`; reEl.style.top = `${Math.round(m.y)}px`; }
              if (reImg && def.sprites?.sit) reImg.src = def.sprites.sit.frames[0];
              else if (reImg) { reImg.style.animation = 'monBob 0.6s ease-in-out infinite'; }
            }, 600000);
          }
          return;
        }

        // Sleep state: no movement
        if (m.animState === 'sleep') {
          m.vx = 0; m.vy = 0;
          const el = elemRefs.current[m.uid];
          if (el) {
            el.style.left = `${Math.round(m.x)}px`;
            el.style.top  = `${Math.round(m.y)}px`;
          }
          return;
        }

        // Locked animations (happy/surprise): no movement
        if (m.animState === 'happy' || m.animState === 'surprise') {
          m.vx = 0; m.vy = 0;
          return;
        }

        // Pinned in place while speech bubble is up
        if (m.speech && now < m.speech.until) {
          m.vx = 0; m.vy = 0;
          if (m.animState === 'walk') {
            m.animState = 'sit'; m.frameTime = 0; m.frame = 0;
          }
          if (m.state !== 'idle') {
            m.state = 'idle';
            m.stateUntil = m.speech.until + 200;
          }
          return;
        }

        // Movement state machine — personality-driven
        if (now > m.stateUntil) {
          const active = m.personality === 'active';
          const speed  = active ? 45 : 18;
          const vyAmp  = active ? 18 : 8;
          const idleChance    = active ? 0.45 : 0.75;
          const walkMinMs     = active ? 1500 : 600;
          const walkRandMs    = active ? 2000 : 1000;
          const idleMinMs     = active ? 1500 : 3000;
          const idleRandMs    = active ? 2000 : 5000;
          if (m.state === 'walk') {
            if (Math.random() < idleChance) {
              m.state = 'idle'; m.vx = 0; m.vy = 0;
              m.stateUntil = now + idleMinMs + Math.random() * idleRandMs;
              if (def.sprites) { m.animState = 'sit'; m.frameTime = 0; }
              else { const img = imgRefs.current[m.uid]; if (img) img.style.animation = 'none'; }
            } else {
              m.vx = (Math.random() > 0.5 ? 1 : -1) * speed;
              m.vy = (Math.random() - 0.5) * vyAmp;
              m.stateUntil = now + walkMinMs + Math.random() * walkRandMs;
              if (def.sprites && m.animState !== 'walk') { m.animState = 'walk'; m.frameTime = 0; }
            }
          } else {
            m.state = 'walk';
            m.vx = (Math.random() > 0.5 ? 1 : -1) * speed;
            m.vy = (Math.random() - 0.5) * vyAmp;
            m.stateUntil = now + walkMinMs + Math.random() * walkRandMs;
            if (def.sprites) { m.animState = 'walk'; m.frameTime = 0; }
            else { const img = imgRefs.current[m.uid]; if (img) img.style.animation = 'monBob 0.6s ease-in-out infinite'; }
          }
        }

        if (m.animState !== 'walk') { m.vx = 0; m.vy = 0; }
        m.x += m.vx * dt; m.y += m.vy * dt;
        const gy = groundY(H, mh);
        if (m.x < 0) { m.x = 0; m.vx = Math.abs(m.vx); }
        if (m.x > W - mw) { m.x = W - mw; m.vx = -Math.abs(m.vx); }
        if (m.y < gy.yMin) { m.y = gy.yMin; m.vy = Math.abs(m.vy); }
        if (m.y > gy.yMax) { m.y = gy.yMax; m.vy = -Math.abs(m.vy); }
        if (m.vx !== 0) m.facing = m.vx < 0 ? 'l' : 'r';

        const el = elemRefs.current[m.uid];
        if (el) {
          el.style.left = `${Math.round(m.x)}px`;
          el.style.top  = `${Math.round(m.y)}px`;
          const flipN = (m.facing === 'l') !== (def.spriteFacing === 'l');
          el.style.transform = `scaleX(${flipN ? -1 : 1})`;
        }
      });

      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  function startHide(m: LiveMon, def: MemoMonDef) {
    if (m.hideTimer) { clearTimeout(m.hideTimer); m.hideTimer = undefined; }
    m.vx = 0; m.vy = 0;
    if (def.sprites) {
      m.animState = 'dislike'; m.frameTime = 0; m.frame = 0;
      m.state = 'dislike-wait';
    } else {
      const { W } = boundsOf();
      const sc = scaleRef.current;
      const mw = Math.round(def.monW * sc);
      const dirs = [
        { dx: -250, dy: 0, dist: m.x }, { dx: 250, dy: 0, dist: W - m.x - mw },
      ];
      const best = dirs.reduce((a, b) => a.dist < b.dist ? a : b);
      m.vx = best.dx; m.vy = best.dy;
      m.state = 'hiding'; m.stateUntil = Date.now() + 10000;
    }
  }

  // 餌やり・トイレ・タスク完了などに反応して、にわのメモモンが喜ぶ。
  // cheer.n が増えるたびに 1 回だけ発火する。
  const cheerN = cheer?.n ?? 0;
  const cheerText = cheer?.text;
  useEffect(() => {
    if (!cheerN) return;
    const now = Date.now();
    Object.values(liveRef.current).forEach(m => {
      const def = MEMOMON_DEFS.find(d => d.id === m.defId);
      if (!def) return;
      // 画面外に隠れている最中や、嫌がって離れている最中は反応させない
      if (m.state === 'hidden' || m.state === 'hiding' || m.state === 'dislike-wait') return;
      if (def.sprites?.happy) {
        m.animState = 'happy'; m.frame = 0; m.frameTime = 0;
      }
      // その場で立ち止まって喜ぶ（happy はアニメ終了時に自動で sit へ戻る）
      m.vx = 0; m.vy = 0; m.state = 'idle';
      m.stateUntil = now + 1800;
      if (cheerText && speechEnabledRef.current) {
        m.speech = { text: cheerText, until: now + 3000 };
        const bubble = bubbleRefs.current[m.uid];
        if (bubble) bubble.textContent = cheerText;
      }
    });
  }, [cheerN]);

  function handleTap(uid: string) {
    const m = liveRef.current[uid];
    if (!m || m.state === 'hiding' || m.state === 'hidden' || m.state === 'dislike-wait') return;
    const def = MEMOMON_DEFS.find(d => d.id === m.defId);
    if (!def) return;

    // リアクション再生中の連打は無視（sit / sleep のときだけ反応）
    if (m.animState === 'happy' || m.animState === 'surprise') return;

    m.tapCount++;
    const rewardable = m.tapCount <= 3; // コイン獲得はタップ3回まで

    // スプライトの無いレガシー個体：逃げずにコインだけ
    if (!def.sprites) {
      if (rewardable) onTapReward();
      return;
    }

    if (m.animState === 'sleep') {
      // 寝てる子を起こす → 驚く
      m.animState = 'surprise'; m.frameTime = 0; m.frame = 0;
    } else {
      // 起きてる子 → 喜ぶ（4回目以降も逃げない）
      m.animState = 'happy'; m.frameTime = 0; m.frame = 0;
      m.vx = 0; m.vy = 0; m.state = 'idle';
      if (speechEnabledRef.current) {
        const line = pickMemoMonLine(def.id);
        if (line) {
          m.speech = { text: line, until: Date.now() + 4000 };
          const bubble = bubbleRefs.current[m.uid];
          if (bubble) {
            bubble.textContent = line;
            bubble.style.display = 'block';
          }
        }
      }
    }
    if (rewardable) onTapReward();
  }

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      {monIds.map(uid => {
        const m = liveRef.current[uid];
        if (!m) return null;
        const def = MEMOMON_DEFS.find(d => d.id === m.defId);
        if (!def) return null;
        const dW = Math.round(def.monW * scale);
        const dH = Math.round(def.monH * scale);
        const initSrc = def.sprites
          ? (def.sprites[m.animState]?.frames[0] ?? MEMOMON_IMGS[def.id])
          : MEMOMON_IMGS[def.id];
        return (
          <div
            key={uid}
            ref={el => { elemRefs.current[uid] = el; }}
            style={{
              position: 'absolute',
              left: Math.round(m.x), top: Math.round(m.y),
              width: dW, height: dH,
              pointerEvents: 'auto', cursor: 'pointer',
              transformOrigin: '50% 50%',
              transform: `scaleX(${((m.facing === 'l') !== (def.spriteFacing === 'l')) ? -1 : 1})`,
              userSelect: 'none', WebkitUserSelect: 'none',
            }}
            onClick={() => handleTap(uid)}
            title={def.name}
          >
            <img
              ref={el => { imgRefs.current[uid] = el; }}
              src={initSrc}
              alt={def.name}
              draggable={false}
              style={{
                display: 'block', imageRendering: 'pixelated',
                width: dW, height: dH, objectFit: 'contain',
                animation: def.sprites ? 'none' : 'monBob 0.6s ease-in-out infinite',
              }}
            />
          </div>
        );
      })}
      {monIds.map(uid => (
        <div
          key={`bubble-${uid}`}
          ref={el => { bubbleRefs.current[uid] = el; }}
          className="memomon-bubble"
          style={{ display: 'none' }}
        />
      ))}
      {mons.map(m => {
        if (!m.request) return null;
        const info = MON_REQUEST_INFO[m.request];
        return (
          <div
            key={`req-${m.uid}`}
            ref={el => { reqRefs.current[m.uid] = el; }}
            className="memomon-request"
            style={{ display: 'none' }}
            onClick={e => { e.stopPropagation(); onFulfillRequest?.(m.uid); }}
            role="button"
            title={info.label}
          >
            <span className="memomon-request-emoji">{info.emoji}</span>
            <span className="memomon-request-text">{info.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Notification scheduler
// ─────────────────────────────────────────────────────────────
async function showSWNotification(title: string, body: string, tag: string) {
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: './icon.svg', badge: './icon.svg', tag, vibrate: [200, 100, 200] } as NotificationOptions);
      return;
    }
  } catch {}
  try { new (window as any).Notification(title, { body, icon: './icon.svg', tag }); } catch {}
}

function useNotificationScheduler(todos: Todo[], settings: Settings) {
  const { notifEnabled, notifAdvanceMin = 30, notifDailyTime = '09:00' } = settings;

  useEffect(() => {
    if (!notifEnabled) return;
    if (typeof Notification === 'undefined') return;
    if ((Notification as any).permission !== 'granted') return;

    const now = Date.now();
    const d   = new Date();
    const yy  = d.getFullYear();
    const mm  = d.getMonth();
    const dd  = d.getDate();
    const todStr = `${yy}-${String(mm+1).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;

    const notifiedKey = `smartmemo:notified:${todStr}`;
    const notified    = new Set<string>(loadStored<string[]>(notifiedKey, []));
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    todos.forEach(todo => {
      if (todo.done || !todo.startDate) return;
      // Only notify for today (or overdue range that includes today)
      const inRange = todo.startDate <= todStr && (todo.endDate || todo.startDate) >= todStr;
      if (!inRange) return;

      const sid = String(todo.id);
      if (notified.has(sid)) return;

      let notifyAt: number;
      if (todo.time) {
        const [h, m] = todo.time.split(':').map(Number);
        notifyAt = new Date(yy, mm, dd, h, m, 0).getTime() - notifAdvanceMin * 60_000;
      } else {
        const [h, m] = notifDailyTime.split(':').map(Number);
        notifyAt = new Date(yy, mm, dd, h, m, 0).getTime();
      }

      const ms = notifyAt - now;
      if (ms < 0 || ms > 24 * 3600_000) return;

      const body = todo.time
        ? `${todo.time}${notifAdvanceMin > 0 ? ` の${notifAdvanceMin}分前` : ''} — ${todo.title}`
        : todo.title;

      timeouts.push(setTimeout(async () => {
        await showSWNotification('SmartMemo', body, sid);
        const prev = loadStored<string[]>(notifiedKey, []);
        if (!prev.includes(sid)) saveStored(notifiedKey, [...prev, sid]);
      }, ms));
    });

    return () => timeouts.forEach(clearTimeout);
  }, [todos, notifEnabled, notifAdvanceMin, notifDailyTime]);
}

// ─────────────────────────────────────────────────────────────
// Focus Mode（タスク集中モード）
// 単一タスクに集中して時間を計測する。計測は開始時刻(startedAt)を保持する
// 方式なので、アプリを閉じても now - startedAt で正しい経過を復元できる。
// ─────────────────────────────────────────────────────────────
type FocusSession = {
  date: string;
  curId: string | number | null;
  startedAt: number | null;
  suspendedId: string | number | null;
  acc: Record<string, number>; // taskId -> きょうの累計 ms
};

const FOCUS_MON_PAL: Record<string, string> = { B: '#FFE45C', S: '#F0C93F', K: '#3A3532', O: '#F08A24', P: '#FFB3B3' };
const FOCUS_MON_MAP: Record<'work' | 'rest', string[]> = {
  work: ['...BBBB...', '..BBBBBB..', '.BBBBBBBB.', '.BKBBBBKB.', 'BBBBOOBBBB', 'BPBBBBBBPB', 'BBBBBBBBBB', '.BBBBBBBB.', '..BSSSSB..', '...O..O...'],
  rest: ['..........', '...BBBB...', '..BBBBBB..', '.BBBBBBBB.', '.KKBBBBKK.', 'BBBBOOBBBB', 'BPBBBBBBPB', 'BBBBBBBBBB', '.BSSSSSSB.', '..O....O..'],
};
function FocusMon({ state }: { state: 'work' | 'rest' }) {
  return (
    <div className={`fm-mon ${state}`}>
      {FOCUS_MON_MAP[state].flatMap((row, y) =>
        [...row].map((c, x) => c === '.' ? null : (
          <div key={`${x}-${y}`} className="fm-px" style={{ left: x * 4, top: y * 4, background: FOCUS_MON_PAL[c] }} />
        ))
      )}
    </div>
  );
}

const FOCUS_TAG_COLORS = ['#E8722E', '#4A9BD9', '#5CB25C', '#2E9B9B', '#D9534F', '#B98A12', '#C86FB0'];
function focusTagColor(tag: string | undefined): string {
  if (!tag) return '#8A94A0';
  if (tag === '割り込み') return '#7A5AB8';
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return FOCUS_TAG_COLORS[h % FOCUS_TAG_COLORS.length];
}
function fmtDur(ms: number): string {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
function fmtDurShort(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? m % 60 + '分' : ''}` : `${m}分`;
}

function FocusMode({ todos, coins, infinite, onComplete, onAddInterrupt, onClose }: {
  todos: Todo[];
  coins: number;
  infinite: boolean;
  onComplete: (id: number | string) => void;
  onAddInterrupt: (t: Todo) => void;
  onClose: () => void;
}) {
  useDismissable(onClose);
  const [sess, setSess] = usePersistedState<FocusSession>('smartmemo:focus:v1', {
    date: todayStr, curId: null, startedAt: null, suspendedId: null, acc: {},
  });
  const [iText, setIText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick] = useState(0);

  // 日付が変わったら「きょう」の計測をリセット
  useEffect(() => {
    if (sess.date !== todayStr) {
      setSess({ date: todayStr, curId: null, startedAt: null, suspendedId: null, acc: {} });
    }
  }, [sess.date]);

  // 走っている間だけ毎秒再描画（計測は startedAt 依存なのでズレない）
  useEffect(() => {
    if (!(sess.curId != null && sess.startedAt)) return;
    const iv = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(iv);
  }, [sess.curId, sess.startedAt]);

  function showToast(m: string) {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  const allById = new Map<string | number, Todo>(todos.map(t => [t.id, t]));
  const curTask = sess.curId != null ? allById.get(sess.curId) : null;
  const suspTask = sess.suspendedId != null ? allById.get(sess.suspendedId) : null;
  const running = !!(sess.curId != null && sess.startedAt);

  const accOf = (id: string | number) => sess.acc[String(id)] || 0;
  const elapsedOf = (t: Todo | null | undefined): number =>
    !t ? 0 : accOf(t.id) + (t.id === sess.curId && sess.startedAt ? Date.now() - sess.startedAt : 0);

  // きょうのタスク: 未完了で（日付なし or 開始日が今日以前＝今日・繰越）、または今日完了したもの
  const focusTasks = todos.filter(t => {
    if (t.done) return t.completedAt === todayStr;
    if (!t.startDate) return true;
    return t.startDate <= todayStr;
  });
  const ordered = [...focusTasks.filter(t => !t.done), ...focusTasks.filter(t => t.done)];

  // セッションを開始する低レベル関数。id と title だけを受け取るので、
  // 親 state に反映される前の割り込みタスクでもすぐ開始できる。
  function beginSession(id: string | number, title: string, fromSuspend = false) {
    setSess(p => {
      const now = Date.now();
      let { curId, startedAt, suspendedId } = p;
      const acc = { ...p.acc };
      if (curId != null && curId !== id) {
        if (startedAt) acc[String(curId)] = (acc[String(curId)] || 0) + (now - startedAt);
        startedAt = null;
        if (!fromSuspend) suspendedId = curId; // 直前のタスクは中断として覚えておく
      }
      if (suspendedId === id) suspendedId = null;
      return { date: p.date, acc, curId: id, startedAt: now, suspendedId };
    });
    showToast(`「${title}」を開始`);
  }
  function focusStart(id: string | number, fromSuspend = false) {
    const t = allById.get(id);
    if (!t || t.done) return;
    beginSession(id, t.title, fromSuspend);
  }
  function focusPause() {
    setSess(p => {
      if (p.curId == null || !p.startedAt) return p;
      const acc = { ...p.acc };
      acc[String(p.curId)] = (acc[String(p.curId)] || 0) + (Date.now() - p.startedAt);
      return { ...p, acc, startedAt: null };
    });
  }
  function focusResume() {
    setSess(p => (p.curId == null || p.startedAt) ? p : { ...p, startedAt: Date.now() });
  }
  function focusFinish() {
    const cur = sess.curId;
    if (cur == null) return;
    const curT = allById.get(cur);
    const suspId = sess.suspendedId;
    const susp = suspId != null ? allById.get(suspId) : null;
    const willResume = !!(susp && !susp.done);
    const spent = accOf(cur) + (sess.startedAt ? Date.now() - sess.startedAt : 0);
    setSess(p => {
      if (p.curId == null) return p;
      const acc = { ...p.acc };
      if (p.startedAt) acc[String(p.curId)] = (acc[String(p.curId)] || 0) + (Date.now() - p.startedAt);
      return { date: p.date, acc, curId: null, startedAt: null, suspendedId: willResume ? null : p.suspendedId };
    });
    onComplete(cur); // TODO を完了に（コインは既存ロジックで加算）
    if (willResume && suspId != null) {
      focusStart(suspId, true);
      showToast(`${fmtDurShort(spent)}を記録 → 「${susp!.title}」に戻りました`);
    } else {
      showToast(`${fmtDurShort(spent)}を記録${infinite ? '' : ` 🪙+${curT?.coinReward ?? 10}`}`);
    }
  }
  function addInterrupt(title: string) {
    const t: Todo = {
      id: Date.now(), title, startDate: todayStr, endDate: todayStr, time: '',
      tags: ['割り込み'], done: false, addedAt: Date.now(),
      coinReward: estimateCoinReward(title, ['割り込み']),
    };
    onAddInterrupt(t);
    beginSession(t.id, t.title);
  }

  const totalMs = focusTasks.reduce((n, t) => n + elapsedOf(t), 0);
  const timelineItems = focusTasks.filter(t => elapsedOf(t) > 0).sort((a, b) => elapsedOf(b) - elapsedOf(a));
  const restOn = running && sess.startedAt ? (Date.now() - sess.startedAt) > 50 * 60000 : false;
  const chips = ['電話対応', '急ぎの修正', '打ち合わせ', '質問対応'];
  const curColor = focusTagColor((curTask?.tags || [])[0]);

  return (
    <div className="fm-overlay">
      <div className="fm-app">
        <header className="fm-header">
          <button className="fm-back" onClick={onClose} aria-label="にわに戻る">‹ にわ</button>
          <div className="fm-b">集中モード</div>
          <div className="fm-coin">🪙 {infinite ? '∞' : coins}</div>
        </header>
        <main className="fm-main">
          {/* 進行中 */}
          <section className={`fm-now ${running ? 'running' : (curTask ? 'paused' : '')}`}>
            <FocusMon state={running ? 'work' : 'rest'} />
            <div className="fm-nowhead">
              <span className="fm-badge"><span className="fm-dot" />{running ? '進行中' : (curTask ? '一時停止中' : '待機中')}</span>
              {curTask && (curTask.tags || [])[0] && (
                <span className="fm-nowtag" style={{ background: curColor + '22', color: curColor }}>{(curTask.tags || [])[0]}</span>
              )}
            </div>
            <div className={`fm-nowtitle ${curTask ? '' : 'empty'}`}>{curTask ? curTask.title : '下から選ぶか、割り込みを入力'}</div>
            <div className="fm-timerow">
              <div className={`fm-timer num ${curTask ? '' : 'idle'}`}>{fmtDur(elapsedOf(curTask))}</div>
            </div>
            <div className="fm-acts">
              <button className={running ? 'fm-bpause' : 'fm-bstart'} disabled={!curTask} onClick={() => running ? focusPause() : focusResume()}>
                {running ? '一時停止' : '再開'}
              </button>
              <button className="fm-bdone" disabled={!curTask} onClick={focusFinish}>完了</button>
            </div>
            {restOn && <div className="fm-rest">☕ 50分たちました。少し休みませんか</div>}
          </section>

          {/* 割り込み */}
          <section className="fm-intr">
            <div className="fm-ilabel">⚡ 割り込みが入ったとき</div>
            <div className="fm-irow">
              <input
                className="fm-itext" value={iText} placeholder="やることを入力してすぐ開始" enterKeyHint="go"
                onChange={e => setIText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && iText.trim()) { addInterrupt(iText.trim()); setIText(''); } }}
              />
              <button className="fm-igo" disabled={!iText.trim()} onClick={() => { if (iText.trim()) { addInterrupt(iText.trim()); setIText(''); } }}>開始</button>
            </div>
            <div className="fm-ichips">
              {chips.map(l => <button key={l} className="fm-ichip" onClick={() => addInterrupt(l)}>＋ {l}</button>)}
            </div>
          </section>

          {/* 中断中 */}
          {suspTask && !suspTask.done && (
            <button className="fm-susp" onClick={() => focusStart(suspTask.id, true)}>
              <span style={{ fontSize: 18 }}>⏸</span>
              <span className="fm-susp-t"><b>{suspTask.title}</b><span>ここまで {fmtDur(accOf(suspTask.id))}</span></span>
              <span className="fm-susp-go">もどる</span>
            </button>
          )}

          {/* 一覧 */}
          <div className="fm-seclabel">☀️ きょうのタスク {totalMs > 0 && <span className="fm-tot num">合計 {fmtDur(totalMs)}</span>}</div>
          <div className="fm-list">
            {ordered.length === 0 && <div className="fm-empty">きょうのタスクはありません</div>}
            {ordered.map(t => {
              const cur = t.id === sess.curId;
              const el = elapsedOf(t);
              const tag = (t.tags || [])[0];
              const c = focusTagColor(tag);
              return (
                <div key={t.id} className={`fm-task ${cur ? 'cur' : ''} ${t.done ? 'done' : ''}`}>
                  <button className="fm-play" onClick={() => {
                    if (t.done) return;
                    if (cur && sess.startedAt) focusPause();
                    else if (cur) focusResume();
                    else focusStart(t.id);
                  }}>
                    {t.done ? '✓' : (cur && sess.startedAt ? '❚❚' : '▶')}
                  </button>
                  <div className="fm-tbody">
                    <div className="fm-tt">{t.title}</div>
                    {tag && <div className="fm-tmeta"><span className="fm-tag" style={{ background: c + '22', color: c }}>{tag}</span></div>}
                  </div>
                  <span className={`fm-telapsed num ${el ? '' : 'zero'} ${cur && sess.startedAt ? 'live' : ''}`}>{el ? fmtDur(el) : '–:––'}</span>
                </div>
              );
            })}
          </div>

          {/* タイムライン */}
          <div className="fm-seclabel">📊 きょうの内訳</div>
          <div className="fm-tl">
            <div className="fm-tlbar">
              {totalMs === 0
                ? <i style={{ flex: 1, background: '#EFF3F7' }} />
                : timelineItems.map(t => <i key={t.id} style={{ flex: elapsedOf(t) / totalMs, background: focusTagColor((t.tags || [])[0]) }} />)}
            </div>
            <div className="fm-tlnote">
              {totalMs === 0
                ? 'まだ計測がありません'
                : <>合計 <b>{fmtDur(totalMs)}</b> ／ いちばん時間を使ったのは「{timelineItems[0].title}」の <b>{fmtDurShort(elapsedOf(timelineItems[0]))}</b></>}
            </div>
          </div>
        </main>
        {toast && <div className="fm-toast on">{toast}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────
function SmartMemoApp() {
  const [tab, setTab] = usePersistedState<Tab>('smartmemo:ui:tab', 'memo');
  const [pulseTabs, setPulseTabs] = useState<Set<Tab>>(new Set());
  const [micTrigger, setMicTrigger] = useState(0);
  const [showGacha, setShowGacha] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showFocus, setShowFocus] = useState(false);
  // にわの「ごはん」おねだりに応えるときの餌えらび対象
  const [feedRequestUid, setFeedRequestUid] = useState<string | null>(null);
  // にわのメモモンを喜ばせるトリガー（n を増やすたびに 1 回喜ぶ）
  const [monCheer, setMonCheer] = useState<{ n: number; text?: string }>({ n: 0 });
  const cheerMon = (text?: string) => setMonCheer(p => ({ n: p.n + 1, text }));
  const [showPlayground, setShowPlayground] = useState(false);
  // メモモン画面を開くときに最初に選択するメモモン（ずかんタップ時に指定）
  const [playgroundInitUid, setPlaygroundInitUid] = useState<string | null>(null);
  const openPlayground = (uid?: string) => { setPlaygroundInitUid(uid ?? null); setShowPlayground(true); };
  const [showAccount, setShowAccount] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  // エラーではないが伝えたい状態（機能が一部縮退しているなど）
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const initialSyncDoneRef = useRef(false);
  // 初回同期が「完了」したか。自動送信はこれが立つまで始めない。
  const initialSyncReadyRef = useRef(false);
  // 最後に見たサーバの updated_at（楽観的排他制御の基準）
  const cloudBaseRef = useRef<string | null>(null);
  const pushingRef = useRef(false);
  // 送信中に来た変更を取りこぼさないための「未送信あり」フラグ
  const pushDirtyRef = useRef(false);
  const [monInitSleep] = useState(() => {
    const last = parseInt(localStorage.getItem('smartmemo:lastOpen') || '0');
    const sleep = Date.now() - last > 12 * 3600 * 1000;
    localStorage.setItem('smartmemo:lastOpen', String(Date.now()));
    return sleep;
  });
  const [appToast, setAppToast] = useState<string | null>(null);
  const appToastRef = useRef<number | undefined>(undefined);
  const [boss, setBoss] = usePersistedState<{ id: string; title: string; spawnedAt: number } | null>('smartmemo:boss', null);
  const [todos, setTodos] = usePersistedState<Todo[]>(LS_TODOS, [
    { id: 1, title: 'プレゼン資料の作成', startDate: todayStr, endDate: '', time: '10:00', tags: ['仕事'],   done: false },
    { id: 2, title: '牛乳を購入する',     startDate: todayStr, endDate: '', time: '',      tags: ['買い物'], done: false },
    { id: 3, title: '部屋の片付け',       startDate: '',       endDate: '', time: '',      tags: ['家事'],   done: false },
  ]);
  const [todoSets, setTodoSets] = usePersistedState<TodoSet[]>(LS_TODO_SETS, []);
  const [ideas, setIdeas] = usePersistedState<Idea[]>(LS_IDEAS, []);
  const [settings, setSettings] = usePersistedState<Settings>(LS_SETTINGS, {
    colorIdx: 0, fontIdx: 1, notifEnabled: true, autoTag: true, autoDate: true,
    completeSound: true, customTags: [], geminiApiKey: '', coins: 0, darkMode: false, bgIdx: 0,
    infiniteCoins: false, gachaUnlocked: { sounds: [], bgs: [] },
  });
  const [memoMons, setMemoMons] = usePersistedState<MemoMonInstance[]>('smartmemo:memomons', [
    { uid: 'kuroneko-default', defId: 'kuroneko', hunger: 100, lastFed: Date.now(), activity: Math.random() < 0.5 ? 'active' : 'lazy' },
  ]);

  useEffect(() => {
    if (!memoMons.find(m => m.defId === 'kuroneko')) {
      setMemoMons(prev => [
        { uid: 'kuroneko-default', defId: 'kuroneko', hunger: 100, lastFed: Date.now(), activity: Math.random() < 0.5 ? 'active' : 'lazy' },
        ...prev,
      ]);
    }
  }, []);

  // 庭にいるメモモンが時間経過で えさ / トイレ / あそび をおねだりする。
  // なつき度は減らなくなったので lastSeenAt の定期更新は不要になり、
  // 代わりにこのタイマーでおねだりを発生させる。
  useEffect(() => {
    if (settings.memoMonVisible === false) return;
    const tick = () => {
      const activeUid = settings.activeMonUid;
      const now = Date.now();
      setMemoMons(prev => {
        const target = (activeUid && prev.find(m => m.uid === activeUid)) || prev[0];
        if (!target || target.request) return prev;
        const since = target.lastRequestDoneAt ?? target.requestAt ?? target.lastFed ?? now;
        if (now - since < MON_REQUEST_INTERVAL_MS) return prev;
        const kind = pickMonRequest(effectiveHunger(target, now));
        return prev.map(m => m.uid === target.uid ? { ...m, request: kind, requestAt: now } : m);
      });
    };
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [settings.activeMonUid, settings.memoMonVisible, memoMons.length]);

  // おねだりに応える。ごはんの要求は餌えらびのシートを開き、
  // それ以外（トイレ・あそび）はその場で応える。
  function fulfillMonRequest(uid: string) {
    const mon = memoMons.find(m => m.uid === uid);
    const kind = mon?.request;
    if (!mon || !kind) return;
    if (kind === 'food') { setFeedRequestUid(uid); return; }
    const now = Date.now();
    setMemoMons(prev => prev.map(m => m.uid === uid ? {
      ...m,
      affection: Math.min(100, effectiveAffection(m) + MON_REQUEST_AFFECTION),
      request: undefined,
      requestAt: undefined,
      lastRequestDoneAt: now,
    } : m));
    if (!settings.infiniteCoins) {
      setSettings(p => ({ ...p, coins: (p.coins || 0) + MON_REQUEST_COINS }));
    }
    const coinPart = settings.infiniteCoins ? '' : ` 🪙+${MON_REQUEST_COINS}`;
    showAppToast(`${MON_REQUEST_INFO[kind].done}！ なつき +${MON_REQUEST_AFFECTION}${coinPart}`);
    cheerMon(pickReaction(mon.defId, 'pet') || pickCheerLine());
  }

  // ごはんのおねだりに、選んだ餌で応える。
  // 餌ごとの好き嫌い（computeFeedingEffect）はずかんの餌やりと同じ扱い。
  function feedMonRequest(food: Food) {
    const uid = feedRequestUid;
    const mon = uid ? memoMons.find(m => m.uid === uid) : null;
    if (!uid || !mon) { setFeedRequestUid(null); return; }
    const stock = (settings.foodInventory || {})[food.id] || 0;
    const useInventory = stock > 0;
    if (!useInventory && !settings.infiniteCoins && (settings.coins || 0) < food.cost) {
      showAppToast('コインが足りません');
      return;
    }
    const eff = computeFeedingEffect(mon.defId, food.id);
    const now = Date.now();
    // おねだりに応えたぶんのボーナスを、餌ごとの好き嫌いに上乗せする
    const totalAff = eff.affectionDelta + MON_REQUEST_AFFECTION;
    setMemoMons(prev => prev.map(m => m.uid === uid ? {
      ...m,
      affection: Math.max(0, Math.min(100, effectiveAffection(m) + totalAff)),
      hunger:    Math.max(0, Math.min(100, effectiveHunger(m, now) + eff.hungerDelta)),
      lastFed:   now,
      request: undefined,
      requestAt: undefined,
      lastRequestDoneAt: now,
    } : m));
    setSettings(p => {
      const inv = { ...(p.foodInventory || {}) };
      let c = p.coins || 0;
      if (useInventory) {
        const n = inv[food.id] || 0;
        if (n <= 1) delete inv[food.id]; else inv[food.id] = n - 1;
      } else if (!p.infiniteCoins) {
        c = Math.max(0, c - food.cost);
      }
      if (!p.infiniteCoins) c += MON_REQUEST_COINS;
      return { ...p, foodInventory: inv, coins: c };
    });
    const prefix = eff.reaction === 'fav' ? '大好物！' : eff.reaction === 'dis' ? '嫌いみたい…' : '満足げ';
    const sign = totalAff >= 0 ? '+' : '';
    const coinPart = settings.infiniteCoins ? '' : ` 🪙+${MON_REQUEST_COINS}`;
    showAppToast(`${prefix} ${food.name}をあげた／なつき ${sign}${totalAff}${coinPart}`);
    // 嫌いな餌のときは喜ばせない。それ以外はずかんの餌やりと同じ台詞プールで反応させる
    if (eff.reaction !== 'dis') {
      const reactionKind: ReactionKind = eff.reaction === 'fav' ? 'feedFav' : 'feedNormal';
      cheerMon(pickReaction(mon.defId, reactionKind) || pickCheerLine());
    }
    setFeedRequestUid(null);
  }

  useEffect(() => {
    if (navigator.storage && (navigator.storage as any).persist) {
      (navigator.storage as any).persist().catch(() => {});
    }
  }, []);

  // ── Supabase auth subscription ────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuthUser(data.session?.user ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      if (!session?.user) {
        initialSyncDoneRef.current = false;
        initialSyncReadyRef.current = false;
        cloudBaseRef.current = null;
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const flush = () => {
      saveStored(LS_TODOS,    todos);
      saveStored(LS_IDEAS,    ideas);
      saveStored(LS_SETTINGS, settings);
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [todos, ideas, settings]);

  function showAppToast(msg: string) {
    setAppToast(msg);
    if (appToastRef.current) clearTimeout(appToastRef.current);
    appToastRef.current = window.setTimeout(() => setAppToast(null), 2700);
  }

  useEffect(() => {
    const handler = () => showAppToast('コピーしました ✓');
    const toastHandler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (typeof msg === 'string' && msg) showAppToast(msg);
    };
    window.addEventListener('copy-success', handler);
    window.addEventListener('app-toast', toastHandler);
    return () => {
      window.removeEventListener('copy-success', handler);
      window.removeEventListener('app-toast', toastHandler);
    };
  }, []);

  useEffect(() => {
    if (boss !== null) return;
    const lastDate = loadStored<string>('smartmemo:boss:date', '');
    if (lastDate === todayStr) return;
    saveStored('smartmemo:boss:date', todayStr);
    if (Math.random() < 0.30) {
      const idx = Math.floor(Math.random() * BOSS_TODOS.length);
      setBoss({ id: `boss-${Date.now()}`, title: BOSS_TODOS[idx], spawnedAt: Date.now() });
    }
  }, []);

  function handleBossComplete() {
    setBoss(null);
    setSettings(p => ({ ...p, coins: (p.coins || 0) + 50 }));
    showAppToast('👑 ボスミッション達成！ 🪙 +50コイン！');
  }

  useNotificationScheduler(todos, settings);

  // colorIdx / fontIdx は永続化データやクラウド同期由来で undefined / 範囲外に
  // なりうる。その場合は既定値(0)にフォールバックしてクラッシュを防ぐ。
  const color = COLOR_PRESETS[settings.colorIdx] ?? COLOR_PRESETS[0];
  const font  = FONT_SIZE_OPTS[settings.fontIdx] ?? FONT_SIZE_OPTS[0];

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color.value);
  }, [color.value]);

  const appBg = settings.darkMode ? '#141416' : (BG_PRESETS[settings.bgIdx ?? 0]?.bg ?? '#fafaf9');
  const appStyle: React.CSSProperties = {
    ['--accent'       as any]: color.value,
    ['--accent-light' as any]: color.light,
    ['--accent-text'  as any]: color.text,
    ['--fs-base'      as any]: font.base,
    ['--fs-sm'        as any]: font.sm,
    ['--fs-xs'        as any]: font.xs,
    background: appBg,
  };

  // 重複したプロジェクト名はプロンプトを薄めて誤マッチを増やすので除外する
  const existingProjects = Array.from(new Set(ideas.map(i => i.projectName).filter(Boolean)));
  // AI が「主題が同じか」を判断できるよう、名前だけでなく概要も渡す
  const existingIdeaBriefs: IdeaBrief[] = useMemo(() => {
    const seen = new Set<string>();
    const out: IdeaBrief[] = [];
    for (const i of ideas) {
      const name = (i.projectName || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, summary: i.summary || (i.details || [])[0] || '' });
    }
    return out;
  }, [ideas]);
  const aiCfg = aiCfgFromSettings(settings);

  function commit({ todos: newTodos = [], ideas: newIdeas = [], unlockCoins = false }: { todos?: Todo[]; ideas?: IdeaDraft[]; unlockCoins?: boolean }) {
    if (unlockCoins) setSetting('infiniteCoinsUnlocked', true);
    if (newTodos.length) {
      setTodos(p => [...p, ...newTodos]);
    }
    if (newIdeas.length) {
      setIdeas(prev => mergeIdeas(prev, newIdeas));
      if (!settings.infiniteCoins) {
        const ideaCoins = newIdeas.reduce((sum, i) => sum + (i.coinReward ?? 0), 0);
        if (ideaCoins > 0) setSettings(p => ({ ...p, coins: (p.coins || 0) + ideaCoins }));
      }
    }
    const targets: Tab[] = [];
    if (newTodos.length) targets.push('todo');
    if (newIdeas.length) targets.push('idea');
    if (targets.length) {
      setPulseTabs(new Set(targets));
      setTimeout(() => setPulseTabs(new Set()), 1000);
    }
    if (newTodos.length && !newIdeas.length) setTab('todo');
    else if (!newTodos.length && newIdeas.length) setTab('idea');
    else if (newTodos.length && newIdeas.length) setTab('todo');
  }

  function reorderIdea(fromId: number | string, toId: number | string) {
    setIdeas(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(i => i.id === fromId);
      const toIdx   = arr.findIndex(i => i.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  }

  const toggle = (id: number | string) => {
    const todo = todos.find(t => t.id === id);
    if (todo && !settings.infiniteCoins) {
      const reward = todo.coinReward ?? 10;
      const delta = todo.done ? -reward : reward;
      setSettings(p => ({ ...p, coins: Math.max(0, (p.coins || 0) + delta) }));
    }
    // 完了したときだけ、にわのメモモンが喜ぶ（未完了に戻したときは反応しない）
    if (todo && !todo.done) cheerMon(pickCheerLine());
    setTodos(p => p.map(t => {
      if (t.id !== id) return t;
      const next = { ...t, done: !t.done, mtime: Date.now() };
      if (next.done) next.completedAt = todayStr;
      else delete next.completedAt;
      return next;
    }));
  };
  const [trash, setTrash] = usePersistedState<TrashedTodo[]>(LS_TRASH, []);
  const [deletions, setDeletions] = usePersistedState<Record<string, number>>(LS_DELETIONS, {});
  // 削除した項目を墓標として覚えておく。これが無いと、他端末とマージした
  // ときに「相手がまだ持っている」削除済み項目が復活してしまう。
  const tombstone = (...ids: (number | string)[]) =>
    setDeletions(prev => {
      const next = { ...prev };
      const now = Date.now();
      ids.forEach(id => { next[String(id)] = now; });
      return pruneTombstones(next);
    });
  const untombstone = (...ids: (number | string)[]) =>
    setDeletions(prev => {
      const next = { ...prev };
      ids.forEach(id => { delete next[String(id)]; });
      return next;
    });

  const remove     = (id: number | string) => {
    const t = todos.find(x => x.id === id);
    if (t) setTrash(p => [{ ...t, trashedAt: Date.now() }, ...p].slice(0, 200));
    setTodos(p => p.filter(t => t.id !== id));
  };
  const trashRestore = (id: number | string) => {
    const item = trash.find(x => x.id === id);
    // mtime を更新しないと、他端末がまだ持っている「ゴミ箱に入れた」記録
    // （trashedAt）の方が新しく見えて、マージで復元が取り消されてしまう。
    if (item) { const { trashedAt, ...t } = item; setTodos(p => [...p, { ...(t as Todo), mtime: Date.now() }]); }
    setTrash(p => p.filter(x => x.id !== id));
    untombstone(id);
  };
  const trashDelete  = (id: number | string) => { setTrash(p => p.filter(x => x.id !== id)); tombstone(id); };
  const trashEmpty   = () => { tombstone(...trash.map(t => t.id)); setTrash([]); };
  const update     = (item: Todo)          => setTodos(p => p.map(t => t.id === item.id ? { ...item, mtime: Date.now() } : t));
  const addTodo    = (item: Todo)          => setTodos(p => [...p, { ...item, mtime: Date.now() }]);
  const updateIdea = (item: Idea)          => setIdeas(p => p.map(i => i.id === item.id ? { ...item, updatedAt: formatDate(new Date()), mtime: Date.now() } : i));
  const removeIdea = (id: number | string) => { setIdeas(p => p.filter(i => i.id !== id)); tombstone(id); };
  const addIdea    = (item: Idea) => {
    if (!settings.infiniteCoins && (item.coinReward ?? 0) > 0) {
      setSettings(p => ({ ...p, coins: (p.coins || 0) + (item.coinReward ?? 0) }));
    }
    setIdeas(p => [...p, { ...item, mtime: Date.now() }]);
  };
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(p => ({ ...p, [k]: v }));
  const saveTodoSet    = (s: TodoSet) => setTodoSets(p => { const v = { ...s, mtime: Date.now() }; const i = p.findIndex(x => x.id === s.id); return i >= 0 ? p.map(x => x.id === s.id ? v : x) : [...p, v]; });
  const deleteTodoSet  = (id: string) => { setTodoSets(p => p.filter(x => x.id !== id)); tombstone(id); };

  const handleFabMic = () => { setTab('memo'); setMicTrigger(t => t + 1); };

  // ボトムナビは機能名だけの 1 行にする。以前は「にわ／タスク」のように
  // 愛称と機能名を 2 段で出していたが、5 タブぶん積むと下端が窮屈になり、
  // どちらを読めばよいのかも決まらなかった。
  // 愛称（にわ・書庫・ずかん）は各画面のタイトルとして本文側に残してある。
  // 中央のメモボタンぶんの隙間も配列で持たせ、並びを変えるときに触る場所を 1 箇所にする。
  type NavItem = { key: Tab; label: string; Icon: React.FC<{ active: boolean }> };
  const navItems: (NavItem | 'memo-slot')[] = [
    { key: 'todo',     label: 'タスク',   Icon: IcoHomeNav },
    { key: 'idea',     label: 'ナレッジ', Icon: IcoBookNav },
    'memo-slot',
    { key: 'zukan',    label: 'メモモン', Icon: IcoEggNav },
    { key: 'settings', label: '設定',     Icon: IcoGearNav },
  ];

  const now = new Date();

  // メモモンは庭（ガーデンワールド）の中でだけ歩く
  const monLayer = (() => {
    if (settings.memoMonVisible === false) return null;
    // 表示できるのは MEMOMON_DEFS に定義がある個体だけ（未知 defId を除外）。
    const known = memoMons.filter(m => MEMOMON_DEFS.some(d => d.id === m.defId));
    // Only one memomon is on screen at a time. Default to the first owned one.
    const activeUid = settings.activeMonUid;
    const active = (activeUid && known.find(m => m.uid === activeUid)) || known[0];
    if (!active) return null;
    const monScale = ({ small: 0.75, medium: 1, large: 1.5 } as const)[settings.memoMonSize || 'medium'] ?? 1;
    return (
      <MemoMonLayer
        mons={[active]}
        scale={monScale}
        initSleep={monInitSleep}
        speechEnabled={settings.memoMonSpeech !== false}
        cheer={monCheer}
        onTapReward={() => setSettings(p => ({ ...p, coins: (p.coins || 0) + 10 }))}
        onFulfillRequest={fulfillMonRequest}
      />
    );
  })();

  // ── Cloud sync helpers (Supabase) ─────────────────────────
  // Keep latest state in refs so the debounced push always sees the latest.
  const cloudStateRef = useRef({ todos, todoSets, ideas, trash, memoMons, settings, deletions });
  cloudStateRef.current = { todos, todoSets, ideas, trash, memoMons, settings, deletions };

  function describeSyncError(e: unknown): string {
    // Supabase(PostgREST) のエラーは Error ではなく素のオブジェクトで返ってくる。
    // String(e) だと "[object Object]" になってしまうので message を取り出す。
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
    const details = (e as { details?: string })?.details || '';
    const hint = (e as { hint?: string })?.hint || '';
    const uid = authUser?.id;
    // 実際に Postgres が返した生の情報。原因を隠さないよう常に末尾へ付ける。
    const techParts: string[] = [];
    if (code) techParts.push(`code: ${code}`);
    if (raw) techParts.push(`message: ${raw}`);
    if (details) techParts.push(`details: ${details}`);
    if (hint) techParts.push(`hint: ${hint}`);
    const tech = techParts.length ? `\n\n［技術詳細］\n${techParts.join('\n')}` : '';
    const blob = `${raw} ${details} ${hint}`;

    // PostgREST: 列がテーブルに無い（スキーマ未更新）
    if (code === 'PGRST204' || /could not find the .* column/i.test(blob)) {
      const col = blob.match(/'([\w-]+)' column/i)?.[1] || '';
      return (
        `テーブルに${col ? `「${col}」` : '必要な'}列がありません。Supabase の SQL Editor で最新の db/schema.sql を実行してください。\n\n` +
        '手早く直すには次を実行:\n' +
        "   alter table public.user_data add column if not exists deleted_ids jsonb not null default '{}'::jsonb;\n" +
        '   notify pgrst, \'reload schema\';\n\n' +
        '※ 列を追加済みでも出る場合は、ダッシュボードの Database → Reload schema cache を実行してください。'
        + tech
      );
    }
    // PostgREST: table not found
    if (code === '42P01' || /relation .* does not exist|table .* not found/i.test(blob)) {
      return 'サーバーに user_data テーブルがありません。Supabase の SQL Editor で最新の db/schema.sql を実行してください。' + tech;
    }
    // 42501 のうち「テーブルへの GRANT 不足」。RLS ポリシーとは別問題で、
    // ポリシーをいくら確認しても直らない（＝記載の①〜④では解決しない）。
    if (/permission denied for (table|relation)/i.test(blob)) {
      return (
        'テーブルへのアクセス権（GRANT）が不足しています。これは RLS ポリシーとは別の問題で、ポリシーを確認しても直りません。\n\n' +
        'Supabase の SQL Editor で最新の db/schema.sql を実行し直してください（GRANT 文が追加されています）。\n' +
        '手早く直すには次を実行:\n' +
        '   grant usage on schema public to authenticated;\n' +
        '   grant select, insert, update, delete on public.user_data to authenticated;'
        + tech
      );
    }
    // 42501: 本当の RLS 行チェック失敗（auth.uid() が user_id と一致しない等）
    if (code === '42501' || /row-level security|new row violates/i.test(blob)) {
      return (
        'RLS ポリシーで拒否されました。以下を順に確認してください。\n\n' +
        '① まず「ログアウト → 再ログイン」で JWT をリフレッシュ（一番よくある原因）\n\n' +
        '② 4 つのポリシーが登録されているか（SQL Editor で実行）:\n' +
        "   select policyname, cmd from pg_policies where tablename = 'user_data';\n" +
        '   → 4 行返らなければ、最新の db/schema.sql を SQL Editor で実行し直してください。\n\n' +
        '③ 現在のセッションの user_id が auth.users に存在するか:\n' +
        (uid ? `   あなたの user_id: ${uid}\n` : '   （現在ログインしていません）\n') +
        (uid ? `   SQL Editor で: select id, email, email_confirmed_at from auth.users where id = '${uid}';\n\n` : '\n') +
        '④ 未確認メールなら Authentication → Providers → Email の "Confirm email" を OFF にしてから再登録するのが最短。'
        + tech
      );
    }
    // PostgREST: schema cache stale (often "could not find ... in schema cache")
    if (/schema cache|PGRST205|PGRST106/i.test(blob)) {
      return 'スキーマキャッシュが古いようです。Supabase の SQL Editor で schema.sql を実行 → ダッシュボードの Database → Reload schema cache を試してください。' + tech;
    }
    // PostgREST: JWT/Auth
    if (code === 'PGRST301' || /JWT|invalid token|not authenticated/i.test(blob)) {
      return '認証トークンが無効です。一度ログアウトして再ログインしてください。' + tech;
    }
    return (raw || '不明なエラー') + tech;
  }

  // ── 複数端末のマージ ─────────────────────────────────────
  // 方針: どちらか片方にしか無い項目は必ず残す（＝消さない）。
  // 両方にある項目は mtime が新しい方を採用。削除は墓標(deleted_ids)で表現する。
  function mergeById<T extends Record<string, any>>(
    remote: T[] | undefined, local: T[] | undefined, key: 'id' | 'uid', tomb: Record<string, number>,
  ): T[] {
    const out = new Map<string, T>();
    const put = (arr: T[] | undefined) => {
      for (const it of arr || []) {
        const k = String(it?.[key] ?? '');
        if (!k) continue;
        const prev = out.get(k);
        if (!prev) { out.set(k, it); continue; }
        const a = Number(prev.mtime ?? 0);
        const b = Number(it.mtime ?? 0);
        // mtime が無い古いデータは後から入れた方（ローカル）を優先
        if (b >= a) out.set(k, it);
      }
    };
    put(remote);
    put(local);
    return Array.from(out.entries()).filter(([k]) => !tomb[k]).map(([, v]) => v);
  }
  // 個数を持つ在庫は多い方を採用（減る方向に倒すと獲得が消えてしまう）
  function mergeCounts(a?: Record<string, number>, b?: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) out[k] = Math.max(out[k] || 0, Number(v) || 0);
    return out;
  }
  const uniq = <T,>(a?: T[], b?: T[]): T[] => Array.from(new Set([...(a || []), ...(b || [])]));

  function mergeSettings(remote: any, local: any): Settings {
    // 古いバージョンが送ってしまった API キーがサーバに残っていても、
    // ここで落として端末側の設定を上書きさせない。
    const merged: any = { ...stripSecretSettings(remote), ...(local || {}) };
    // 数え上げ系・解放済み系は「失われない」方向へ寄せる
    merged.coins = Math.max(Number(remote?.coins ?? 0), Number(local?.coins ?? 0));
    merged.customTags     = uniq(remote?.customTags, local?.customTags);
    merged.ideaTabs       = uniq(remote?.ideaTabs, local?.ideaTabs);
    merged.usedGiftCodes  = uniq(remote?.usedGiftCodes, local?.usedGiftCodes);
    merged.customHolidays = uniq(remote?.customHolidays, local?.customHolidays);
    merged.gachaUnlocked = {
      sounds: uniq(remote?.gachaUnlocked?.sounds, local?.gachaUnlocked?.sounds),
      bgs:    uniq(remote?.gachaUnlocked?.bgs, local?.gachaUnlocked?.bgs),
    };
    merged.foodInventory = mergeCounts(remote?.foodInventory, local?.foodInventory);
    merged.itemInventory = mergeCounts(remote?.itemInventory, local?.itemInventory);
    return merged as Settings;
  }

  // ゴミ箱行きは墓標(deleted_ids)で表せない。墓標は trash 配列にも効くので、
  // 立てた瞬間ゴミ箱からも消えてしまうため。代わりに「同じ id が todos と
  // trash の両方に出てきたら、新しい操作の方を採用する」で決着させる。
  // ゴミ箱に入れた時刻は trashedAt、そこから戻した時刻は復元側の mtime。
  function reconcileTrashed(todos: Todo[], trash: TrashedTodo[]): { todos: Todo[]; trash: TrashedTodo[] } {
    const trashedAt = new Map<string, number>();
    for (const t of trash) trashedAt.set(String(t.id), Number(t.trashedAt ?? 0));
    if (!trashedAt.size) return { todos, trash };

    const restored = new Set<string>();
    const keptTodos = todos.filter(t => {
      const k = String(t.id);
      const at = trashedAt.get(k);
      if (at === undefined) return true;          // ゴミ箱に無い＝そのまま残す
      if (Number(t.mtime ?? 0) > at) { restored.add(k); return true; } // 復元の方が新しい
      return false;                                // ゴミ箱行きの方が新しい
    });
    return {
      todos: keptTodos,
      trash: restored.size ? trash.filter(t => !restored.has(String(t.id))) : trash,
    };
  }

  function mergeSnapshots(remote: CloudSnapshot, local: CloudSnapshot): CloudSnapshot {
    const tomb: Record<string, number> = {
      ...((remote.deleted_ids as Record<string, number>) || {}),
      ...((local.deleted_ids as Record<string, number>) || {}),
    };
    const reconciled = reconcileTrashed(
      mergeById(remote.todos as any[], local.todos as any[], 'id', tomb) as Todo[],
      mergeById(remote.trash as any[], local.trash as any[], 'id', tomb) as TrashedTodo[],
    );
    return {
      todos:     reconciled.todos,
      ideas:     mergeById(remote.ideas as any[],     local.ideas as any[],     'id',  tomb),
      todo_sets: mergeById(remote.todo_sets as any[], local.todo_sets as any[], 'id',  tomb),
      trash:     reconciled.trash,
      memo_mons: mergeById(remote.memo_mons as any[], local.memo_mons as any[], 'uid', tomb),
      settings:  mergeSettings(remote.settings, local.settings) as unknown as Record<string, unknown>,
      deleted_ids: tomb,
    };
  }

  function buildLocalSnapshot(): CloudSnapshot {
    const s = cloudStateRef.current;
    return {
      ideas: s.ideas,
      todos: s.todos,
      todo_sets: s.todoSets,
      trash: s.trash,
      memo_mons: s.memoMons,
      settings: stripSecretSettings(s.settings),
      deleted_ids: s.deletions,
    };
  }

  // マージ結果を画面（ローカル state）へ反映する
  function applySnapshot(snap: CloudSnapshot) {
    if (Array.isArray(snap.todos))     setTodos(snap.todos as Todo[]);
    if (Array.isArray(snap.ideas))     setIdeas(snap.ideas as Idea[]);
    if (Array.isArray(snap.todo_sets)) setTodoSets(snap.todo_sets as TodoSet[]);
    if (Array.isArray(snap.trash))     setTrash(snap.trash as TrashedTodo[]);
    if (Array.isArray(snap.memo_mons)) setMemoMons(snap.memo_mons as MemoMonInstance[]);
    if (snap.settings && typeof snap.settings === 'object') {
      // クラウド側に欠けている必須フィールドを消さないよう既存へマージする。
      // スナップショットには API キーが含まれない（stripSecretSettings）ので、
      // この prev 展開が端末ローカルのキーを保つ役割も担っている。
      setSettings(prev => ({ ...prev, ...(snap.settings as unknown as Settings) }));
    }
    if (snap.deleted_ids && typeof snap.deleted_ids === 'object') {
      setDeletions(prev => pruneTombstones({ ...prev, ...(snap.deleted_ids as Record<string, number>) }));
    }
  }

  // explicit を渡すとその内容を送る。setState は即座に cloudStateRef へ
  // 反映されないため、マージ直後の送信では必ず明示的に渡すこと。
  async function pushSnapshot(explicit?: CloudSnapshot) {
    if (!authUser) return;
    // 送信が重なると片方が競合し続けるので直列化する。ただし捨ててはいけない。
    // 捨てると「送信中に加えた変更」が次の編集まで届かないままになる。
    // 印だけ残しておき、いま走っている送信が終わったら送り直す。
    if (pushingRef.current) { pushDirtyRef.current = true; return; }
    pushingRef.current = true;
    setSyncStatus('syncing');
    setSyncError(null);
    try {
      let snap = explicit ?? buildLocalSnapshot();
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await pushCloud(snap, cloudBaseRef.current);
        if (!res.conflict) {
          cloudBaseRef.current = res.updatedAt;
          setLastSyncAt(res.updatedAt || new Date().toISOString());
          setSyncStatus('idle');
          // 同期自体は成功しているのでエラー扱いにはしないが、
          // 削除の同期だけが効かない状態であることは知らせる。
          setSyncNotice(isDeletedIdsUnsupported() ? DELETED_IDS_NOTICE : null);
          return;
        }
        // 競合＝この端末が知らない更新がサーバにある。
        // 取り込んでマージし、どちらの変更も残したうえで再送する。
        const { data, updatedAt } = await fetchCloud();
        cloudBaseRef.current = updatedAt;
        if (data) {
          snap = mergeSnapshots(data, snap);
          applySnapshot(snap);
        }
      }
      throw new Error('他の端末の更新と競合しました。もう一度お試しください。');
    } catch (e) {
      console.error('[cloud push]', e);
      setSyncError(describeSyncError(e));
      setSyncStatus('error');
    } finally {
      pushingRef.current = false;
      // 送信中に変更があったぶんを送り直す。ここで拾わないと、ユーザーが
      // 編集をやめた直後の変更ほどクラウドに届かないままになる。
      if (pushDirtyRef.current) {
        pushDirtyRef.current = false;
        void pushSnapshot();
      }
    }
  }

  async function pullSnapshot(): Promise<boolean> {
    if (!authUser) return false;
    setSyncStatus('syncing');
    setSyncError(null);
    try {
      const { data, updatedAt } = await fetchCloud();
      cloudBaseRef.current = updatedAt;
      if (!data) {
        setSyncStatus('idle');
        return false;
      }
      // 上書きではなくマージして取り込む。こうしないと、この端末でしか
      // 作っていない項目（オフライン中の追加など）が消えてしまう。
      applySnapshot(mergeSnapshots(data, buildLocalSnapshot()));
      setLastSyncAt(updatedAt || new Date().toISOString());
      setSyncStatus('idle');
      return true;
    } catch (e) {
      console.error('[cloud pull]', e);
      setSyncError(describeSyncError(e));
      setSyncStatus('error');
      return false;
    }
  }

  // ログイン直後の初回同期。サーバの内容とローカルをマージしてから送り返す。
  useEffect(() => {
    if (!authUser || initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;
    (async () => {
      const { data, updatedAt } = await fetchCloud();
      cloudBaseRef.current = updatedAt;
      const merged = data ? mergeSnapshots(data, buildLocalSnapshot()) : buildLocalSnapshot();
      if (data) applySnapshot(merged);
      // マージ結果をそのまま送る（state 反映を待たない）
      await pushSnapshot(merged);
    })()
      .catch(e => console.error('[initial sync]', e))
      // 初回同期が終わるまで自動送信を始めない。ここを同期的に立てていたため、
      // 取得が5秒を超えると空のローカル内容でサーバを上書きしていた。
      .finally(() => { initialSyncReadyRef.current = true; });
  }, [authUser]);

  // Auto-push on any data change, debounced 5s after the last edit.
  useEffect(() => {
    if (!authUser || !initialSyncReadyRef.current) return;
    const t = setTimeout(() => { pushSnapshot(); }, 5000);
    return () => clearTimeout(t);
  }, [authUser, todos, todoSets, ideas, trash, memoMons, settings, deletions]);

  // 画面に戻ってきたら取得し直す。これが無いと、この端末はログイン時の
  // 一度しか取得せず、他端末の更新を知らないまま上書きし続ける。
  useEffect(() => {
    if (!authUser) return;
    const onBack = () => {
      if (document.visibilityState !== 'visible') return;
      if (!initialSyncReadyRef.current || pushingRef.current) return;
      pullSnapshot();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [authUser]);

  return (
    <div className={`app${settings.darkMode ? ' dark' : ''}${settings.glassUI ? ' glass' : ''}`} style={appStyle}>
      <div className="app-header">
        {/* 日付はここではなく にわ のシート見出しに一本化した。
            両方に出ていたころは、ヘッダーの日付とシートの日付が
            別々の意味に見えて（今日／選択日）迷いのもとになっていた。 */}
        <div className="header-left">
          <IcoAppMark />
          <span className="tagline">SmartMemo</span>
        </div>
        <div className="header-right">
          {/* 同期の失敗は設定を開かないと分からなかった。書き続けたのに他の端末へ
              反映されていない、という事故を防ぐため、異常時だけここに出す。
              正常時と同期中は出さない（5 秒ごとに点滅させても邪魔なだけ）。 */}
          {authUser && syncStatus === 'error' && (
            <button
              type="button"
              className="sync-chip"
              onClick={() => setTab('settings')}
              title={syncError || '同期に失敗しました'}
            >
              <IcoWarn />同期エラー
            </button>
          )}
          <CoinBadge coins={settings.coins || 0} infinite={settings.infiniteCoins} onGacha={() => setShowGacha(true)} />
        </div>
      </div>
      <div className="tab-content">
        {tab === 'memo'     && <MemoTab existingProjects={existingProjects} existingIdeaBriefs={existingIdeaBriefs} customTags={settings.customTags || []} aiCfg={aiCfg} ideaTabs={settings.ideaTabs || []} micTrigger={micTrigger} splitReflectButtons={settings.splitReflectButtons !== false} onCommit={commit} />}
        {tab === 'todo'     && <TodoTab todos={todos} boss={boss} onBossComplete={handleBossComplete} onBossDismiss={() => setBoss(null)} onToggle={toggle} onDelete={remove} onUpdate={update} onAdd={addTodo} trash={trash} onTrashRestore={trashRestore} onTrashDelete={trashDelete} onTrashEmpty={trashEmpty} soundEnabled={settings.completeSound !== false} soundType={settings.soundType || 'doremi'} customTags={settings.customTags || []} todoSets={todoSets} onSaveTodoSet={saveTodoSet} onDeleteTodoSet={deleteTodoSet} holidayConfig={{ weekends: settings.holidayWeekends !== false, jpHolidays: settings.holidayJpHolidays !== false, custom: settings.customHolidays || [] }} monLayer={monLayer} onOpenFocus={() => setShowFocus(true)} />}
        {tab === 'idea'     && <IdeasTab ideas={ideas} aiCfg={aiCfg} onUpdate={updateIdea} onDelete={removeIdea} onAdd={addIdea} onReorder={reorderIdea} customTags={settings.customTags || []} ideaTabs={settings.ideaTabs || []} onUpdateIdeaTabs={tabs => setSetting('ideaTabs', tabs)} />}
        {tab === 'zukan'    && <ZukanTab memoMons={memoMons} onOpenPlayground={openPlayground} />}
        {tab === 'settings' && <SettingsTab settings={settings} onChange={setSetting} memoMons={memoMons} onInsights={() => setShowInsights(true)} authUser={authUser} syncStatus={syncStatus} syncError={syncError} syncNotice={syncNotice} lastSyncAt={lastSyncAt} onOpenAccount={() => setShowAccount(true)} onPushNow={() => { retryDeletedIds(); pushSnapshot(); }} onPullNow={() => { retryDeletedIds(); pullSnapshot(); }} />}
      </div>
      <div className="bottom-nav-wrapper">
        <button className={`nav-center-memo${tab === 'memo' ? ' active' : ''}`} onClick={() => setTab('memo')} title="メモ入力">
          <IcoPencilFab />
          <span>メモ</span>
        </button>
        <div className="bottom-nav" role="tablist" aria-label="画面の切り替え">
          {navItems.map(item => item === 'memo-slot'
            ? <div key="memo-slot" className="nav-mic-slot" />
            : (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`nav-tab${tab === item.key ? ' active' : ''}${pulseTabs.has(item.key) ? ' pulse' : ''}`}
                onClick={() => setTab(item.key)}
              >
                <span className="nav-icon"><item.Icon active={tab === item.key} /></span>
                <span className="nav-label">{item.label}</span>
              </button>
            )
          )}
        </div>
      </div>
      {appToast && <div className="toast">{appToast}</div>}
      {showGacha && (
        <GachaModal
          coins={settings.coins || 0}
          infinite={settings.infiniteCoins}
          unlockedSounds={(settings.gachaUnlocked || { sounds: [], bgs: [] }).sounds}
          unlockedBgs={(settings.gachaUnlocked || { sounds: [], bgs: [] }).bgs}
          ownedMons={memoMons.map(m => m.defId)}
          onClose={() => setShowGacha(false)}
          onResult={(results, totalCost) => {
            results.forEach(({ prize, dup }, i) => {
              if (!dup && prize.type === 'memomon' && prize.monDefId) {
                setMemoMons(prev => [...prev, {
                  uid: `mon-${Date.now()}-${i}`,
                  defId: prize.monDefId!,
                  hunger: 100,
                  lastFed: Date.now(),
                  activity: Math.random() < 0.5 ? 'active' : 'lazy',
                }]);
              }
            });
            setSettings(p => {
              const unlocked = p.gachaUnlocked || { sounds: [], bgs: [], mons: [] };
              const newUnlocked = { sounds: [...unlocked.sounds], bgs: [...unlocked.bgs], mons: [...(unlocked.mons || [])] };
              const updates: Partial<Settings> = {};
              if (!p.infiniteCoins) updates.coins = Math.max(0, (p.coins || 0) - totalCost);
              let dupRefund = 0;
              results.forEach(({ prize, dup }) => {
                if (dup) { dupRefund += 10; return; }
                if (prize.type === 'sound' && prize.soundType && !newUnlocked.sounds.includes(prize.soundType)) {
                  updates.soundType = prize.soundType;
                  newUnlocked.sounds.push(prize.soundType);
                }
                if (prize.type === 'bg' && prize.bgIdx !== undefined && !newUnlocked.bgs.includes(prize.bgIdx)) {
                  updates.bgIdx = prize.bgIdx;
                  newUnlocked.bgs.push(prize.bgIdx);
                }
                if (prize.type === 'memomon' && prize.monDefId && !newUnlocked.mons.includes(prize.monDefId)) {
                  newUnlocked.mons.push(prize.monDefId);
                }
                if (prize.type === 'food' && prize.foodId) {
                  const inv = updates.foodInventory ?? { ...(p.foodInventory || {}) };
                  inv[prize.foodId] = (inv[prize.foodId] || 0) + 1;
                  updates.foodInventory = inv;
                }
              });
              if (dupRefund && !p.infiniteCoins) updates.coins = (updates.coins ?? (p.coins || 0)) + dupRefund;
              updates.gachaUnlocked = newUnlocked;
              return { ...p, ...updates };
            });
          }}
        />
      )}
      {showAccount && (
        <AccountModal authUser={authUser} onClose={() => setShowAccount(false)} />
      )}
      {feedRequestUid && (
        <FoodPickerSheet
          foodInventory={settings.foodInventory || {}}
          coins={settings.coins || 0}
          infinite={!!settings.infiniteCoins}
          title="なにをあげる？"
          standalone
          onPick={feedMonRequest}
          onClose={() => setFeedRequestUid(null)}
        />
      )}
      {showFocus && (
        <FocusMode
          todos={todos}
          coins={settings.coins || 0}
          infinite={!!settings.infiniteCoins}
          onComplete={id => { const t = todos.find(x => x.id === id); if (t && !t.done) toggle(id); }}
          onAddInterrupt={addTodo}
          onClose={() => setShowFocus(false)}
        />
      )}
      {showPlayground && (
        <PlaygroundModal
          memoMons={memoMons}
          coins={settings.coins || 0}
          infinite={!!settings.infiniteCoins}
          activeMonUid={settings.activeMonUid}
          initialUid={playgroundInitUid}
          foodInventory={settings.foodInventory || {}}
          itemInventory={settings.itemInventory || {}}
          unlockedSounds={(settings.gachaUnlocked || { sounds: [], bgs: [] }).sounds}
          unlockedBgs={(settings.gachaUnlocked || { sounds: [], bgs: [] }).bgs}
          onClose={() => { setShowPlayground(false); setPlaygroundInitUid(null); }}
          onUpdateMons={updater => setMemoMons(updater)}
          onSpendCoins={amount => setSettings(p => ({ ...p, coins: Math.max(0, (p.coins || 0) - amount) }))}
          onGainCoins={amount => setSettings(p => ({ ...p, coins: (p.coins || 0) + amount }))}
          onSetActive={uid => setSettings(p => ({ ...p, activeMonUid: uid }))}
          onConsumeFood={foodId => setSettings(p => {
            const inv = { ...(p.foodInventory || {}) };
            const n = inv[foodId] || 0;
            if (n <= 1) delete inv[foodId];
            else inv[foodId] = n - 1;
            return { ...p, foodInventory: inv };
          })}
          onCollectItem={itemId => setSettings(p => {
            const inv = { ...(p.itemInventory || {}) };
            inv[itemId] = (inv[itemId] || 0) + 1;
            return { ...p, itemInventory: inv };
          })}
          onUnlockSound={soundType => setSettings(p => {
            const unlocked = p.gachaUnlocked || { sounds: [], bgs: [] };
            if (unlocked.sounds.includes(soundType)) return p;
            return {
              ...p,
              soundType,
              gachaUnlocked: { ...unlocked, sounds: [...unlocked.sounds, soundType] },
            };
          })}
          onUnlockBg={bgIdx => setSettings(p => {
            const unlocked = p.gachaUnlocked || { sounds: [], bgs: [] };
            if (unlocked.bgs.includes(bgIdx)) return p;
            return {
              ...p,
              bgIdx,
              gachaUnlocked: { ...unlocked, bgs: [...unlocked.bgs, bgIdx] },
            };
          })}
        />
      )}
      {showInsights && (
        <InsightsModal
          todos={todos}
          ideas={ideas}
          trash={trash}
          aiCfg={aiCfg}
          onClose={() => setShowInsights(false)}
        />
      )}
    </div>
  );
}

export default SmartMemoApp;
