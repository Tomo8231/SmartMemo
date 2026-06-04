import React, { useState, useRef, useEffect } from 'react';

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
  coinReward?: number;
  recurring?: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  recurringDay?: number;
  recurringGroupId?: string;
  attachments?: Attachment[];
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
  memoMonSize?: 'small' | 'medium' | 'large';
  usedGiftCodes?: string[];
  notifAdvanceMin?: number;  // minutes before task time (0/15/30/60)
  notifDailyTime?: string;   // "HH:MM" for todos without a time
  holidayWeekends?: boolean;
  holidayJpHolidays?: boolean;
  customHolidays?: string[];
  splitReflectButtons?: boolean;
};
type AnimState = 'sit' | 'walk' | 'happy' | 'dislike' | 'sleep' | 'surprise';
type MemoMonDef = { id: string; name: string; pixels: string[]; palette: Record<string, string>; rarity: string; desc: string; monW: number; monH: number; imageUrl?: string; spriteFacing?: 'l' | 'r'; sprites?: Partial<Record<AnimState, { frames: string[]; fps: number; loop: boolean }>>; };
type MemoMonInstance = { uid: string; defId: string; hunger: number; lastFed: number; activity?: 'active' | 'lazy'; };
type GachaPrize = {
  type: 'miss' | 'sound' | 'bg' | 'memomon';
  label: string; rarity: string; stars: string; color: string;
  soundType?: string; bgIdx?: number; monDefId?: string;
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
type Tab = 'memo' | 'todo' | 'idea' | 'settings';
type Attachment = { id: string; name: string; mime: string; data: string };
type MemoHistoryItem = { id: number; text: string; savedAt: number; attachments?: Attachment[] };
type TodoSetItem = { title: string; tags: string[]; coinReward?: number; };
type TodoSet = { id: string; name: string; items: TodoSetItem[]; createdAt: number; };

// ─────────────────────────────────────────────────────────────
// App version — bump on every change (see CLAUDE.md versioning rule)
//   patch: バグ修正 / minor: 機能追加 / major: 破壊的変更
//   PWA (vite-plugin-pwa) がビルドごとにキャッシュを自動更新する
// ─────────────────────────────────────────────────────────────
const APP_VERSION = '1.6.1';

// ─────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────
const LS_TODOS    = 'smartmemo:todos';
const LS_IDEAS    = 'smartmemo:ideas';
const LS_SETTINGS = 'smartmemo:settings';
const LS_TRASH    = 'smartmemo:trash';
const LS_TODO_SETS = 'smartmemo:todosets';

function loadStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
}
function saveStored<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {
    console.error('[SmartMemo] save failed for', key, e);
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

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES  = 3 * 1024 * 1024; // 3 MB for non-image files

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
  const [blobUrl,     setBlobUrl]     = useState('');
  const [textContent, setTextContent] = useState('');
  const isImage = attachment.mime.startsWith('image/');
  const isPdf   = attachment.mime === 'application/pdf';
  const isText  = (attachment.mime === 'text/plain' || attachment.mime === 'text/csv');

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, []);

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
      if (!file.type.startsWith('image/') && file.size > MAX_FILE_BYTES) {
        toast?.(`${file.name} はサイズが大きすぎます（最大3MB）`); continue;
      }
      const raw = await readFileAsDataUrl(file);
      const data = file.type.startsWith('image/') ? await compressImage(raw) : raw;
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
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') addLink(); if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl(''); } }} />
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

// Synchronous persisted state — writes inside the setter.
function usePersistedState<T>(key: string, defaultValue: T): [T, (u: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => loadStored(key, defaultValue));
  const set = (updater: T | ((prev: T) => T)) => {
    setState(prev => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
      saveStored(key, next);
      return next;
    });
  };
  return [state, set];
}

const pad = (n: number) => String(n).padStart(2, '0');
const today = new Date();
const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = formatDate(today);
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
  </svg>
);

function CoinBadge({ coins, infinite, onGacha }: { coins: number; infinite?: boolean; onGacha: () => void }) {
  return (
    <button className="coin-badge" onClick={onGacha} title="ガチャを引く">
      <IcoCoin />
      <span className="coin-badge-count">{infinite ? '∞' : coins}</span>
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
  const [mode, setMode] = useState<GachaMode>('single');
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'flashing' | 'result'>('idle');
  const [singleResult, setSingleResult] = useState<GachaPrize | null>(null);
  const [singleDup, setSingleDup] = useState(false);
  const [tenResults, setTenResults] = useState<{ prize: GachaPrize; dup: boolean }[]>([]);
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
  }
  function switchMode(m: GachaMode) { if (phase !== 'spinning') { setMode(m); again(); } }

  const labelParts = singleResult ? singleResult.label.split(' ') : [];
  const singleObtainedMsg = singleResult
    ? singleDup ? 'すでに解放済み！ コイン +10 獲得'
    : singleResult.type === 'memomon' ? `${labelParts.slice(1).join(' ')} がメモ画面を歩き回り始めた！`
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
                {tenResults.map((r, i) => (
                  <div key={i} className={`gacha-ten-card${i < revealCount ? ' show' : ''}`}
                    style={{
                      background: rarityBg[r.prize.rarity] || rarityBg.common,
                      boxShadow: rarityGlow[r.prize.rarity],
                    }}>
                    <div style={{ fontSize: 22, lineHeight: 1.4 }}>{r.prize.label.split(' ')[0]}</div>
                    <div style={{ fontSize: 10, color: '#fff', fontWeight: 700, opacity: .85 }}>{r.prize.stars}</div>
                    {r.dup && <div style={{ fontSize: 9, color: '#ffd700', fontWeight: 700 }}>+10</div>}
                  </div>
                ))}
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
const DATE_TOKEN_RE  = /(今日|明日|明後日|昨日|来週.曜?|今週.曜?|来月|今月|\d{1,2}[\/月]\d{1,2}日?|\d{1,2}月中|\d{4}[-/]\d{1,2}[-/]\d{1,2})/;
const RECURRING_RE   = /(毎日|毎週|毎月|隔週|週\d?回|月\d?回|定期|ルーティン|習慣)/;
const DEADLINE_RE    = /(\d{1,2}[月\/]\d{1,2}日?まで|\d{4}[-\/]\d{1,2}[-\/]\d{1,2}まで|来週まで|今月中|月末まで|までに|まで[にの])/;
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

  const xmr = text.match(/(\d{1,2})[\/月](\d{1,2})日?\s*(?:[~\-]|から)\s*(\d{1,2})[\/月](\d{1,2})日?\s*まで?/);
  if (xmr) return {
    startDate: `${yy}-${pad(+xmr[1])}-${pad(+xmr[2])}`,
    endDate:   `${yy}-${pad(+xmr[3])}-${pad(+xmr[4])}`,
  };

  const smr = text.match(/(\d{1,2})[\/月](\d{1,2})日?\s*(?:[~\-]|から)\s*(\d{1,2})日?\s*まで?/);
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

  const md = text.match(/(\d{1,2})[\/月](\d{1,2})日?/);
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
  t = t.replace(/(\d{1,2})[\/月](\d{1,2})日?\s*(?:[~\-]|から)\s*(\d{1,2})[\/月](\d{1,2})日?\s*まで?/g, '');
  t = t.replace(/(\d{1,2})[\/月](\d{1,2})日?\s*(?:[~\-]|から)\s*(\d{1,2})日?\s*まで?/g, '');
  t = t.replace(/(\d{1,2}|今|来)月中/g, '');
  t = t.replace(/(今日|明日|明後日|来週.曜?|今週.曜?)\s*から\s*(今日|明日|明後日|来週.曜?|今週.曜?)\s*まで/g, '');
  t = t.replace(/(今日|明日|明後日|昨日|来週.曜?|今週.曜?|来月|今月)/g, '');
  t = t.replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, '');
  t = t.replace(/\d{1,2}[\/月]\d{1,2}日?/g, '');
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
    projectName = colonM[1].replace(/^[■◆●▼※【\[]+|[】\]]+$/g, '').trim();
    projectName = projectName.replace(/(について|のアイデア|の話|のメモ|の構想|の企画|案|構想|企画)$/, '').trim();
    summary = colonM[2].trim();
  } else {
    const bracketM = line.match(/^[■◆●▼※【\[]+(.+?)[】\]]+\s*(.*)$/);
    if (bracketM) {
      projectName = bracketM[1].trim();
      summary = bracketM[2].trim() || projectName;
    }
  }

  const tryMatch = (candidate: string) => {
    if (!candidate || !existingProjects.length) return null;
    const c = candidate.toLowerCase();
    return existingProjects.find(p => {
      if (!p) return false;
      const pl = p.toLowerCase();
      return pl === c || pl.includes(c) || c.includes(pl);
    }) || null;
  };
  if (projectName) {
    const matched = tryMatch(projectName);
    if (matched) projectName = matched;
  }
  if (!projectName) {
    const matched = existingProjects.find(p => p && line.includes(p));
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

async function parseMemoToItems(text: string, existingProjects: string[] = [], apiKey = '', mode: 'todo' | 'idea' | 'both' = 'both'): Promise<ParseResult> {
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
    `1. 複数項目は分割。「明日、にんじん、玉ねぎを買う」→「にんじんを買う」「玉ねぎを買う」（「明日」はstartDateへ）\n` +
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
    `6. ナレッジは projectName で分類。既存プロジェクトと類似なら必ずその名前を使用\n` +
    `7. 既存プロジェクト: ${JSON.stringify(existingProjects)}\n` +
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
    `   startDate=本日（または指定の開始日）、endDate=6ヶ月後（または指定の終了日）\n\n` +
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

  if (apiKey) {
    try {
      const out = await callGeminiText(apiKey, prompt);
      const parsed = tryParseJson(out);
      if (parsed) return parsed;
    } catch (e) {
      console.warn('[Gemini] memo parse failed:', e);
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
    if (!t.startDate) return;
    const s = new Date(t.startDate), e = t.endDate ? new Date(t.endDate) : s;
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

            const rowTodos = todos.filter(t => {
              if (!t.startDate) return false;
              const e = t.endDate || t.startDate;
              return t.startDate <= rowEnd && e >= rowStart;
            }).sort((a, b) => {
              if (a.done !== b.done) return a.done ? 1 : -1;
              const aS = a.startDate < rowStart ? rowStart : a.startDate;
              const bS = b.startDate < rowStart ? rowStart : b.startDate;
              const aE = (a.endDate || a.startDate) > rowEnd ? rowEnd : (a.endDate || a.startDate);
              const bE = (b.endDate || b.startDate) > rowEnd ? rowEnd : (b.endDate || b.startDate);
              const aSpan = row.findIndex(c => formatDate(c.date) === aE) - row.findIndex(c => formatDate(c.date) === aS);
              const bSpan = row.findIndex(c => formatDate(c.date) === bE) - row.findIndex(c => formatDate(c.date) === bS);
              if (bSpan !== aSpan) return bSpan - aSpan;
              return aS.localeCompare(bS);
            });

            const laneSlots: LaneSlot[][] = [];
            const placements: Placement[] = [];
            for (const t of rowTodos) {
              const effS = t.startDate < rowStart ? rowStart : t.startDate;
              const effE = (t.endDate || t.startDate) > rowEnd ? rowEnd : (t.endDate || t.startDate);
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
              placements.push({ todo: t, lane, cs, ce, isStart: t.startDate >= rowStart, isEnd: (t.endDate || t.startDate) <= rowEnd });
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
function MemoTab({ existingProjects, customTags, geminiApiKey, ideaTabs = [], micTrigger = 0, splitReflectButtons = true, onCommit }: {
  existingProjects: string[];
  customTags: string[];
  geminiApiKey: string;
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

    if (geminiApiKey) {
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
        setLoading(true); setLMsg('Gemini で文字起こし中');
        try {
          const base64 = await blobToBase64(blob);
          const transcript = await callGeminiAudio(geminiApiKey, base64, captureMime);
          if (transcript) {
            setText(p => p ? p + '\n' + transcript : transcript);
            showToast('音声を文字起こししました');
          } else {
            showToast('文字起こし結果が空でした');
          }
        } catch (err) {
          console.error('[Gemini audio]', err);
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
      showToast('このブラウザは音声入力に未対応です（設定でGemini APIキーを登録すると利用可能）');
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
      if (!geminiApiKey && !claude) {
        showToast('画像OCRには Gemini APIキー（設定）が必要です');
        return;
      }
      setLoading(true);
      setLMsg(geminiApiKey ? 'Gemini で画像から文字を抽出中' : '画像からテキストを抽出中');
      try {
        const b64 = dataUrl.split(',')[1];
        let result = '';
        if (geminiApiKey) {
          result = await callGeminiVision(
            geminiApiKey,
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
      const result = await parseMemoToItems(text, existingProjects, geminiApiKey, mode);
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
                if (e.key === 'Escape') { setMemoShowLink(false); setMemoLinkUrl(''); }
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

function TodoTab({ todos, boss, onBossComplete, onBossDismiss, onToggle, onDelete, onUpdate, onAdd, trash, onTrashRestore, onTrashDelete, onTrashEmpty, soundEnabled, soundType = 'doremi', customTags, todoSets, onSaveTodoSet, onDeleteTodoSet, holidayConfig }: {
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
}) {
  const [sel,          setSel]        = useState<string>(todayStr);
  const [editPicking,  setEditPicking] = useState<Todo | null>(null);
  const [editing,      setEditing]    = useState<{todo: Todo; scope: 'single' | 'all'} | null>(null);
  const [adding,       setAdding]     = useState(false);
  const [showTrash,    setShowTrash]  = useState(false);
  const [showCalendar, setShowCalendar] = useState(true);
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
    if (!t.startDate || overdueIds.has(t.id as string)) return false;
    return sel >= t.startDate && sel <= (t.endDate || t.startDate);
  });
  const sortedDateTodos = [...dateTodos.filter(t => !t.done), ...dateTodos.filter(t => t.done)];

  const undated       = filteredTodos.filter(t => !t.startDate);
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

  return (
    <div className="todo-tab">
      {editPicking && (
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
          <button className="todo-set-open-btn" onClick={() => setShowSets(true)}>
            📋 TODOセット{todoSets.length > 0 && <span className="todo-set-count">{todoSets.length}</span>}
          </button>
          <button className="trash-open-btn" onClick={() => setShowTrash(true)}>
            🗑 ゴミ箱{trash.length > 0 && <span className="trash-count">{trash.length}</span>}
          </button>
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
function IdeasTab({ ideas, onUpdate, onDelete, onAdd, onReorder, customTags, ideaTabs = [], onUpdateIdeaTabs }: {
  ideas: Idea[];
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
        onKeyDown={e => { if (e.key === 'Enter') addTab(); if (e.key === 'Escape') { setAddingTab(false); setNewTabName(''); } }}
        placeholder="タブ名を入力"
        maxLength={16}
      />
      <button onClick={addTab} disabled={!newTabName.trim()}>追加</button>
      <button className="cancel-btn" onClick={() => { setAddingTab(false); setNewTabName(''); }}>取消</button>
    </div>
  ) : null;

  const ideaCards = filteredIdeas.map(i => {
    const justAdded = !!i.addedAt && (Date.now() - i.addedAt) < 800;
    const isTouchDragging = touchDragId === i.id;
    const isDragOver = dragOverIdeaId === i.id || touchDragOverId === String(i.id);
    return (
      <div
        key={i.id}
        data-idea-id={String(i.id)}
        draggable
        className={[
          'idea-card',
          justAdded ? 'just-added' : '',
          dragIdeaId === i.id ? 'dragging' : '',
          isTouchDragging ? 'touch-dragging' : '',
          isDragOver ? 'drag-over-top' : '',
        ].filter(Boolean).join(' ')}
        onDragStart={e => onIdeaDragStart(e, i.id)}
        onDragEnd={onIdeaDragEnd}
        onDragOver={e => onIdeaDragOverCard(e, i.id)}
        onDrop={e => onIdeaDropCard(e, i.id)}
        onTouchStart={e => onIdeaTouchStart(e, i.id)}
        onTouchMove={onIdeaTouchMove}
        onTouchEnd={onIdeaTouchEnd}
        onClick={() => { if (justDraggedRef.current) return; setEditing(i); }}
      >
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
        <button className="item-copy-btn" onClick={e => { e.stopPropagation(); copyToClipboard(buildIdeaCopyText(i)); }} title="コピー"><IcoCopy /></button>
        <button className="todo-del" onClick={e => { e.stopPropagation(); onDelete(i.id); }}>✕</button>
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
      {subtabBar}
      {subtabInput}
      <div ref={ideasListRef} className={`ideas-tab tab-pane${touchDragId != null ? ' touch-dragging' : ''}`}>
        {filteredIdeas.length === 0
          ? <div className="ideas-empty">まだナレッジがありません</div>
          : ideaCards
        }
        <button className="ideas-add-row" onClick={() => setAddingIdea(true)}>
          ＋ 新しいナレッジを追加
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings Tab
// ─────────────────────────────────────────────────────────────
function SettingsTab({ settings, onChange, memoMons, onInsights }: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  memoMons: MemoMonInstance[];
  onInsights: () => void;
}) {
  const { colorIdx, fontIdx, notifEnabled, notifAdvanceMin = 30, notifDailyTime = '09:00', autoTag, autoDate, completeSound, geminiApiKey, darkMode } = settings;
  const soundOn = completeSound !== false;
  const [newTag, setNewTag]             = useState('');
  const [keyInput, setKeyInput]         = useState(geminiApiKey || '');
  const [keyVisible, setKeyVisible]     = useState(false);
  const [apiStatus, setApiStatus]       = useState<{ kind: 'idle' | 'ok' | 'ng'; msg: string }>({ kind: 'idle', msg: '' });
  const [showMonSelector,  setShowMonSelector]  = useState(false);
  const [monInfoId,        setMonInfoId]        = useState<string | null>(null);
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

  useEffect(() => { setKeyInput(geminiApiKey || ''); }, [geminiApiKey]);

  function saveKey() {
    onChange('geminiApiKey', keyInput.trim());
    setApiStatus({ kind: 'ok', msg: '保存しました' });
    setTimeout(() => setApiStatus({ kind: 'idle', msg: '' }), 2200);
  }
  async function testKey() {
    if (!keyInput.trim()) {
      setApiStatus({ kind: 'ng', msg: 'APIキーを入力してください' }); return;
    }
    setApiStatus({ kind: 'idle', msg: '接続テスト中...' });
    try {
      const out = await callGeminiText(keyInput.trim(), 'Reply with the single word: OK');
      if (out) setApiStatus({ kind: 'ok', msg: `接続成功（${GEMINI_MODEL}）` });
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
            <input
              type="date"
              value={newHolidayDate}
              onChange={e => setNewHolidayDate(e.target.value)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #e0e0de', fontSize: 14, fontFamily: 'inherit', background: 'var(--card-bg,#fff)', color: 'inherit' }}
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

      <div className="settings-section-title">AI 連携（Gemini）</div>
      <div className="settings-card">
        <div className="api-row">
          <div className="settings-row-label">Gemini APIキー</div>
          <div className="settings-row-sub">
            設定すると音声・画像・メモ解析に Gemini を使用します。
            未設定時はローカル解析にフォールバック。
            <br/>取得: aistudio.google.com → Get API key
          </div>
          <div className="api-input-row">
            <input
              type={keyVisible ? 'text' : 'password'}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="AIza..."
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
            <button onClick={saveKey} disabled={keyInput.trim() === (geminiApiKey || '')}>保存</button>
            <button className="secondary" onClick={testKey} disabled={!keyInput.trim()}>接続テスト</button>
            {geminiApiKey && (
              <button className="secondary" onClick={() => { setKeyInput(''); onChange('geminiApiKey', ''); setApiStatus({ kind: 'ok', msg: '削除しました' }); }}>削除</button>
            )}
          </div>
          {apiStatus.msg && (
            <div className={`api-status ${apiStatus.kind}`}>{apiStatus.msg}</div>
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
            disabled={!geminiApiKey}
            title={geminiApiKey ? 'AI分析を実行' : 'Gemini APIキーを設定してください'}
          >
            {geminiApiKey ? '🔍 分析する' : '🔒 要APIキー'}
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
                <div className="settings-row-label">メモモンを選ぶ</div>
                <div className="settings-row-sub">
                  {memoMons.filter(m => !(settings.hiddenMons || []).includes(m.defId)).length} / {memoMons.length} 体表示中
                </div>
              </div>
              <button className="font-size-opt" onClick={() => setShowMonSelector(true)}>選択</button>
            </div>
          </>}
        </div>
      </>}
      {showMonSelector && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'flex-end',
        }} onClick={() => setShowMonSelector(false)}>
          <div style={{
            width: '100%', background: 'var(--card-bg, #fff)',
            borderRadius: '20px 20px 0 0', padding: '20px 16px 32px',
            maxHeight: '70vh', overflowY: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 16, textAlign: 'center' }}>メモモンを選ぶ</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {memoMons.map(m => {
                const def = MEMOMON_DEFS.find(d => d.id === m.defId);
                if (!def) return null;
                const hidden = (settings.hiddenMons || []).includes(m.defId);
                return (
                  <div
                    key={m.uid}
                    onClick={() => setMonInfoId(m.defId)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: 8, padding: '16px 8px',
                      border: `2px solid ${hidden ? '#ddd' : 'var(--accent, #4f46e5)'}`,
                      borderRadius: 14, cursor: 'pointer',
                      background: hidden ? '#fafafa' : 'rgba(79,70,229,0.06)',
                      opacity: hidden ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    <img
                      src={MEMOMON_IMGS[def.id]}
                      alt={def.name}
                      style={{ width: def.monW * 2, height: def.monH * 2, imageRendering: 'pixelated' }}
                    />
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{def.name}</div>
                    <div style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20,
                      background: hidden ? '#eee' : 'var(--accent, #4f46e5)',
                      color: hidden ? '#888' : '#fff',
                    }}>{hidden ? '非表示' : '表示中'}</div>
                  </div>
                );
              })}
            </div>
            <button
              style={{ width: '100%', marginTop: 20, padding: '12px 0', borderRadius: 12, fontSize: 15, fontWeight: 600 }}
              onClick={() => setShowMonSelector(false)}
            >閉じる</button>
          </div>
        </div>
      )}
      {monInfoId && (() => {
        const def = MEMOMON_DEFS.find(d => d.id === monInfoId);
        const gachaItem = GACHA_ITEMS.find(g => g.type === 'memomon' && g.monDefId === monInfoId);
        if (!def) return null;
        const hidden = (settings.hiddenMons || []).includes(monInfoId);
        const ecology = gachaItem?.flavor || def.desc;
        const stars = gachaItem?.stars || (def.rarity === 'ultra' ? '★★★★★' : '★★★★');
        const rarityColor = def.rarity === 'ultra' ? '#e040fb' : def.rarity === 'super' ? '#f9a825' : '#4caf50';
        return (
          <div style={{ position:'fixed', inset:0, zIndex:3000, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 16px' }}
            onClick={() => setMonInfoId(null)}>
            <div style={{ width:'100%', maxWidth:340, background:'var(--card-bg,#fff)', borderRadius:22, padding:'28px 20px 20px', boxShadow:'0 8px 32px rgba(0,0,0,0.18)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, marginBottom:16 }}>
                <img src={MEMOMON_IMGS[def.id]} alt={def.name}
                  style={{ width: def.monW * 2.2, height: def.monH * 2.2, imageRendering:'pixelated', marginBottom:4 }} />
                <div style={{ fontWeight:700, fontSize:20 }}>{def.name}</div>
                <div style={{ color: rarityColor, fontSize:16, letterSpacing:2 }}>{stars}</div>
              </div>
              <div style={{ fontSize:14, lineHeight:1.8, color:'var(--text-sub,#666)', background:'rgba(0,0,0,0.04)', borderRadius:14, padding:'14px 16px', marginBottom:18, whiteSpace:'pre-wrap' }}>
                {ecology.replace(/^【生態】/, '').trim()}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => {
                  const current = settings.hiddenMons || [];
                  onChange('hiddenMons', hidden ? current.filter(id => id !== monInfoId) : [...current, monInfoId]);
                }} style={{ flex:1, padding:'11px 0', borderRadius:12, border:'2px solid var(--accent,#4f46e5)', color:'var(--accent,#4f46e5)', background:'transparent', fontWeight:600, fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>
                  {hidden ? '表示する' : '非表示にする'}
                </button>
                <button onClick={() => setMonInfoId(null)}
                  style={{ flex:1, padding:'11px 0', borderRadius:12, background:'var(--accent,#4f46e5)', color:'#fff', border:'none', fontWeight:600, fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>
                  閉じる
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

function InsightsModal({ todos, ideas, trash, apiKey, onClose }: {
  todos: Todo[];
  ideas: Idea[];
  trash: TrashedTodo[];
  apiKey: string;
  onClose: () => void;
}) {
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
        if (apiKey) {
          out = await callGeminiText(apiKey, prompt);
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
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>設定でGemini APIキーを確認してください</div>
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
};

function MemoMonLayer({ mons, scale, initSleep, onTapReward }: { mons: MemoMonInstance[]; scale: number; initSleep: boolean; onTapReward: () => void }) {
  const scaleRef    = useRef(scale);
  scaleRef.current  = scale;
  const liveRef     = useRef<Record<string, LiveMon>>({});
  const elemRefs    = useRef<Record<string, HTMLDivElement | null>>({});
  const imgRefs     = useRef<Record<string, HTMLImageElement | null>>({});
  const rafRef      = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const [monIds, setMonIds] = useState<string[]>([]);

  useEffect(() => {
    const now = Date.now();
    const W = window.innerWidth;
    const H = window.innerHeight;
    mons.forEach(m => {
      if (!liveRef.current[m.uid]) {
        const def = MEMOMON_DEFS.find(d => d.id === m.defId)!;
        const hoursElapsed = (now - m.lastFed) / 3600000;
        const hunger = Math.max(0, m.hunger - hoursElapsed * 10);
        const sc = scaleRef.current;
        const startSleep = initSleep && !!def.sprites;
        const personality: 'active' | 'lazy' = m.activity ?? (Math.random() < 0.5 ? 'active' : 'lazy');
        const initSpeed = personality === 'active' ? 45 : 18;
        liveRef.current[m.uid] = {
          ...m, hunger,
          x: Math.random() * Math.max(0, W - def.monW * sc),
          y: 60 + Math.random() * Math.max(0, H * 0.3),
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
      const W = window.innerWidth;
      const H = window.innerHeight - 80;

      Object.values(liveRef.current).forEach(m => {
        const def = MEMOMON_DEFS.find(d => d.id === m.defId);
        if (!def) return;
        const sc = scaleRef.current;
        const mw = Math.round(def.monW * sc);
        const mh = Math.round(def.monH * sc);

        if (m.state === 'hidden') return;

        // ── Sprite frame animation ──────────────────────────────
        if (def.sprites) {
          const animDef = def.sprites[m.animState];
          if (animDef) {
            m.frameTime += dt;
            const totalFrames = animDef.frames.length;
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
                m.animState = 'sit'; m.frameTime = 0; m.frame = 0; m.tapCount = 0;
              } else if (m.animState === 'dislike' && m.state === 'dislike-wait') {
                const dirs = [
                  { dx: -250, dy: 0, dist: m.x }, { dx: 250, dy: 0, dist: W - m.x - mw },
                  { dx: 0, dy: -250, dist: m.y - 60 }, { dx: 0, dy: 250, dist: H - m.y - mh },
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
              m.state = 'idle'; m.animState = 'sit'; m.frameTime = 0; m.frame = 0;
              m.x = Math.random() * Math.max(0, W - Math.round(def.monW * sc2));
              m.y = 60 + Math.random() * Math.max(0, H * 0.3);
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
        if (m.x < 0) { m.x = 0; m.vx = Math.abs(m.vx); }
        if (m.x > W - mw) { m.x = W - mw; m.vx = -Math.abs(m.vx); }
        if (m.y < 60) { m.y = 60; m.vy = Math.abs(m.vy); }
        if (m.y > H - mh) { m.y = H - mh; m.vy = -Math.abs(m.vy); }
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
      const W = window.innerWidth; const H = window.innerHeight - 80;
      const sc = scaleRef.current;
      const mw = Math.round(def.monW * sc); const mh = Math.round(def.monH * sc);
      const dirs = [
        { dx: -250, dy: 0, dist: m.x }, { dx: 250, dy: 0, dist: W - m.x - mw },
        { dx: 0, dy: -250, dist: m.y - 60 }, { dx: 0, dy: 250, dist: H - m.y - mh },
      ];
      const best = dirs.reduce((a, b) => a.dist < b.dist ? a : b);
      m.vx = best.dx; m.vy = best.dy;
      m.state = 'hiding'; m.stateUntil = Date.now() + 10000;
    }
  }

  function handleTap(uid: string) {
    const m = liveRef.current[uid];
    if (!m || m.state === 'hiding' || m.state === 'hidden' || m.state === 'dislike-wait') return;
    const def = MEMOMON_DEFS.find(d => d.id === m.defId);
    if (!def) return;

    if (!def.sprites) {
      startHide(m, def);
      return;
    }

    if (m.animState === 'sleep') {
      m.animState = 'surprise'; m.frameTime = 0; m.frame = 0;
      onTapReward();
      return;
    }

    if (m.animState === 'happy' || m.animState === 'surprise') return;

    m.tapCount++;
    if (m.tapCount <= 3) {
      m.animState = 'happy'; m.frameTime = 0; m.frame = 0;
      m.vx = 0; m.vy = 0; m.state = 'idle';
      onTapReward();
    } else {
      startHide(m, def);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 900, overflow: 'hidden' }}>
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
// Root
// ─────────────────────────────────────────────────────────────
function SmartMemoApp() {
  const [tab, setTab] = usePersistedState<Tab>('smartmemo:ui:tab', 'memo');
  const [pulseTabs, setPulseTabs] = useState<Set<Tab>>(new Set());
  const [micTrigger, setMicTrigger] = useState(0);
  const [showGacha, setShowGacha] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
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

  useEffect(() => {
    if (navigator.storage && (navigator.storage as any).persist) {
      (navigator.storage as any).persist().catch(() => {});
    }
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
    window.addEventListener('copy-success', handler);
    return () => window.removeEventListener('copy-success', handler);
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

  const color = COLOR_PRESETS[settings.colorIdx];
  const font  = FONT_SIZE_OPTS[settings.fontIdx];

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

  const existingProjects = ideas.map(i => i.projectName);

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
    setTodos(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };
  const [trash, setTrash] = usePersistedState<TrashedTodo[]>(LS_TRASH, []);
  const remove     = (id: number | string) => {
    const t = todos.find(x => x.id === id);
    if (t) setTrash(p => [{ ...t, trashedAt: Date.now() }, ...p].slice(0, 200));
    setTodos(p => p.filter(t => t.id !== id));
  };
  const trashRestore = (id: number | string) => {
    const item = trash.find(x => x.id === id);
    if (item) { const { trashedAt, ...t } = item; setTodos(p => [...p, t as Todo]); }
    setTrash(p => p.filter(x => x.id !== id));
  };
  const trashDelete  = (id: number | string) => setTrash(p => p.filter(x => x.id !== id));
  const trashEmpty   = () => setTrash([]);
  const update     = (item: Todo)          => setTodos(p => p.map(t => t.id === item.id ? item : t));
  const addTodo    = (item: Todo)          => setTodos(p => [...p, item]);
  const updateIdea = (item: Idea)          => setIdeas(p => p.map(i => i.id === item.id ? { ...item, updatedAt: formatDate(new Date()) } : i));
  const removeIdea = (id: number | string) => setIdeas(p => p.filter(i => i.id !== id));
  const addIdea    = (item: Idea) => {
    if (!settings.infiniteCoins && (item.coinReward ?? 0) > 0) {
      setSettings(p => ({ ...p, coins: (p.coins || 0) + (item.coinReward ?? 0) }));
    }
    setIdeas(p => [...p, item]);
  };
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(p => ({ ...p, [k]: v }));
  const saveTodoSet    = (s: TodoSet) => setTodoSets(p => { const i = p.findIndex(x => x.id === s.id); return i >= 0 ? p.map(x => x.id === s.id ? s : x) : [...p, s]; });
  const deleteTodoSet  = (id: string) => setTodoSets(p => p.filter(x => x.id !== id));

  const handleFabMic = () => { setTab('memo'); setMicTrigger(t => t + 1); };

  const navItems: { key: Tab; label: string; Icon: React.FC<{ active: boolean }> }[] = [
    { key: 'memo',     label: 'メモ入力', Icon: IcoMemoNav     },
    { key: 'todo',     label: 'TODO',     Icon: IcoTodoNav     },
    { key: 'idea',     label: 'ナレッジ', Icon: IcoIdeaNav     },
    { key: 'settings', label: '設定',     Icon: IcoSettingsNav },
  ];

  return (
    <div className={`app${settings.darkMode ? ' dark' : ''}`} style={appStyle}>
      <div className="app-header">
        <div className="header-left">
          <h1>SmartMemo</h1>
          <span className="tagline">AI でタスクを自動整理</span>
        </div>
        <CoinBadge coins={settings.coins || 0} infinite={settings.infiniteCoins} onGacha={() => setShowGacha(true)} />
      </div>
      <div className="tab-content">
        {tab === 'memo'     && <MemoTab existingProjects={existingProjects} customTags={settings.customTags || []} geminiApiKey={settings.geminiApiKey || ''} ideaTabs={settings.ideaTabs || []} micTrigger={micTrigger} splitReflectButtons={settings.splitReflectButtons !== false} onCommit={commit} />}
        {tab === 'todo'     && <TodoTab todos={todos} boss={boss} onBossComplete={handleBossComplete} onBossDismiss={() => setBoss(null)} onToggle={toggle} onDelete={remove} onUpdate={update} onAdd={addTodo} trash={trash} onTrashRestore={trashRestore} onTrashDelete={trashDelete} onTrashEmpty={trashEmpty} soundEnabled={settings.completeSound !== false} soundType={settings.soundType || 'doremi'} customTags={settings.customTags || []} todoSets={todoSets} onSaveTodoSet={saveTodoSet} onDeleteTodoSet={deleteTodoSet} holidayConfig={{ weekends: settings.holidayWeekends !== false, jpHolidays: settings.holidayJpHolidays !== false, custom: settings.customHolidays || [] }} />}
        {tab === 'idea'     && <IdeasTab ideas={ideas} onUpdate={updateIdea} onDelete={removeIdea} onAdd={addIdea} onReorder={reorderIdea} customTags={settings.customTags || []} ideaTabs={settings.ideaTabs || []} onUpdateIdeaTabs={tabs => setSetting('ideaTabs', tabs)} />}
        {tab === 'settings' && <SettingsTab settings={settings} onChange={setSetting} memoMons={memoMons} onInsights={() => setShowInsights(true)} />}
      </div>
      <div className="bottom-nav-wrapper">
        <button className="nav-center-mic" onClick={handleFabMic} title="音声入力">
          <IcoMicFab />
        </button>
        <div className="bottom-nav">
          {navItems.slice(0, 2).map(({ key, label, Icon }) => (
            <div key={key} className={`nav-tab${tab === key ? ' active' : ''}${pulseTabs.has(key) ? ' pulse' : ''}`} onClick={() => setTab(key)}>
              <span className="nav-icon"><Icon active={tab === key} /></span>
              <span className="nav-label">{label}</span>
            </div>
          ))}
          <div className="nav-mic-slot" />
          {navItems.slice(2).map(({ key, label, Icon }) => (
            <div key={key} className={`nav-tab${tab === key ? ' active' : ''}${pulseTabs.has(key) ? ' pulse' : ''}`} onClick={() => setTab(key)}>
              <span className="nav-icon"><Icon active={tab === key} /></span>
              <span className="nav-label">{label}</span>
            </div>
          ))}
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
              });
              if (dupRefund && !p.infiniteCoins) updates.coins = (updates.coins ?? (p.coins || 0)) + dupRefund;
              updates.gachaUnlocked = newUnlocked;
              return { ...p, ...updates };
            });
          }}
        />
      )}
      {settings.memoMonVisible !== false && (() => {
        const visible = memoMons.filter(m => !(settings.hiddenMons || []).includes(m.defId));
        const monScale = ({ small: 0.75, medium: 1, large: 1.5 } as const)[settings.memoMonSize || 'medium'];
        return visible.length > 0 ? <MemoMonLayer mons={visible} scale={monScale} initSleep={monInitSleep} onTapReward={() => setSettings(p => ({ ...p, coins: (p.coins || 0) + 10 }))} /> : null;
      })()}
      {showInsights && (
        <InsightsModal
          todos={todos}
          ideas={ideas}
          trash={trash}
          apiKey={settings.geminiApiKey || ''}
          onClose={() => setShowInsights(false)}
        />
      )}
    </div>
  );
}

export default SmartMemoApp;
