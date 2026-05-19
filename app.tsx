// React / ReactDOM are loaded via UMD <script> tags in index.html.
declare const React: any;
declare const ReactDOM: any;

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
};
type AnimState = 'sit' | 'walk' | 'happy' | 'dislike' | 'sleep' | 'surprise';
type MemoMonDef = { id: string; name: string; pixels: string[]; palette: Record<string, string>; rarity: string; desc: string; monW: number; monH: number; imageUrl?: string; spriteFacing?: 'l' | 'r'; sprites?: Partial<Record<AnimState, { frames: string[]; fps: number; loop: boolean }>>; };
type MemoMonInstance = { uid: string; defId: string; hunger: number; lastFed: number; };
type GachaPrize = {
  type: 'miss' | 'sound' | 'bg' | 'memomon';
  label: string; rarity: string; stars: string; color: string;
  soundType?: string; bgIdx?: number; monDefId?: string;
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
};
type IdeaDraft = {
  id?: number | string;
  projectName: string;
  summary: string;
  details: string[];
  tags: string[];
  subTab?: string;
};
type ParseResult = { todos: TodoDraft[]; ideas: IdeaDraft[] };
type Pending = { todos: (TodoDraft & { id: string; done: false })[]; ideas: (IdeaDraft & { id: string })[] };
type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };
type Tab = 'memo' | 'todo' | 'idea' | 'settings';
type MemoHistoryItem = { id: number; text: string; savedAt: number };

const { useState, useRef, useEffect } = React;

// ─────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────
const LS_TODOS    = 'smartmemo:todos';
const LS_IDEAS    = 'smartmemo:ideas';
const LS_SETTINGS = 'smartmemo:settings';

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

// Sound types for task completion.
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
];
let _audioCtx: AudioContext | undefined;
function _getAudioCtx(): AudioContext {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  if (!_audioCtx) _audioCtx = new Ctx();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playSound(type: string) {
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
const GACHA_COST_MON = 500;
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
  { type: 'sound', label: '🔔 チャイム',         rarity: 'common', stars: '★★',    color: '#777',    soundType: 'chime',   weight: 20 },
  { type: 'sound', label: '💥 ポップ',           rarity: 'common', stars: '★★',    color: '#777',    soundType: 'pop',     weight: 18 },
  { type: 'sound', label: '🎮 8ビット',          rarity: 'common', stars: '★★',    color: '#777',    soundType: '8bit',    weight: 16 },
  { type: 'bg',    label: '🎨 クリーム背景',     rarity: 'common', stars: '★★',    color: '#c8860a', bgIdx: 1,             weight: 14 },
  { type: 'sound', label: '🎹 ドレミ',           rarity: 'rare',   stars: '★★★',   color: '#2e7bef', soundType: 'doremi',  weight: 10 },
  { type: 'sound', label: '🪙 コイン音',         rarity: 'rare',   stars: '★★★',   color: '#2e7bef', soundType: 'coin',    weight: 8  },
  { type: 'bg',    label: '🌿 ミント背景',       rarity: 'rare',   stars: '★★★',   color: '#27ae60', bgIdx: 2,             weight: 8  },
  { type: 'bg',    label: '🌸 スカイ背景',       rarity: 'rare',   stars: '★★★',   color: '#1a88d0', bgIdx: 4,             weight: 6  },
  { type: 'sound', label: '🍄 マリオ音',         rarity: 'super',  stars: '★★★★',  color: '#e53935', soundType: 'mario',   weight: 5  },
  { type: 'sound', label: '🎺 ファンファーレ',   rarity: 'super',  stars: '★★★★',  color: '#9c27b0', soundType: 'fanfare', weight: 4  },
  { type: 'bg',    label: '💜 ラベンダー背景',   rarity: 'super',  stars: '★★★★',  color: '#8e24aa', bgIdx: 3,             weight: 4  },
  { type: 'bg',    label: '🌙 ナイト背景',       rarity: 'super',  stars: '★★★★',  color: '#546e7a', bgIdx: 5,             weight: 3  },
  { type: 'sound', label: '🎵 特製メロディ',     rarity: 'ultra',  stars: '★★★★★', color: '#ff6f00', soundType: 'special', weight: 2  },
  { type: 'sound', label: '🎶 ベル',             rarity: 'ultra',  stars: '★★★★★', color: '#e91e63', soundType: 'bell',    weight: 1  },
  { type: 'bg',      label: '🌅 ローズ背景', rarity: 'ultra', stars: '★★★★★', color: '#c2185b', bgIdx: 6,            weight: 1 },
  { type: 'memomon', label: '💀 ドクロン',  rarity: 'ultra', stars: '★★★★★', color: '#52575e', monDefId: 'skullon',  weight: 2 },
  { type: 'memomon', label: '💧 スライム', rarity: 'super',  stars: '★★★★',  color: '#0288d1', monDefId: 'slime',    weight: 3 },
  { type: 'memomon', label: '🐥 ひよこ',   rarity: 'super',  stars: '★★★★',  color: '#f9a825', monDefId: 'hiyoko',   weight: 3 },
  { type: 'memomon', label: '👻 おばけ',      rarity: 'ultra', stars: '★★★★★', color: '#616161', monDefId: 'obake',       weight: 2 },
  { type: 'memomon', label: '🦊 ゆきぎつね', rarity: 'ultra', stars: '★★★★★', color: '#90caf9', monDefId: 'yukigitsune', weight: 2 },
  { type: 'memomon', label: '🐕 しばいぬ',   rarity: 'super', stars: '★★★★',  color: '#e65100', monDefId: 'shibainu',    weight: 3 },
];
const BOSS_TODOS = [
  '今日のタスクを3つ完了させよ！',
  'メモを書いてAI解析してみよ！',
  'アイデアを新しく1つ追加せよ！',
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

const MEMOMON_DEFS: MemoMonDef[] = [
  {
    id: 'kuroneko', name: 'クロネコ',
    pixels: [], palette: {},
    rarity: 'ultra',
    desc: 'メモのすみっこに住む神出鬼没な黒猫。タップされると喜ぶが、しつこいと怒って逃げる。',
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

  useEffect(() => {
    if (phase === 'result' && mode === 'ten' && revealCount >= 0 && revealCount < 10) {
      const t = setTimeout(() => setRevealCount(c => c + 1), 175);
      return () => clearTimeout(t);
    }
  }, [phase, mode, revealCount]);

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
        const results = Array.from({ length: 10 }, () => {
          const r = pickGacha(); return { prize: r, dup: isDup(r) };
        });
        const refund = results.filter(r => r.dup).length * 10;
        if (refund && !infinite) setLocalCoins(c => c + refund);
        setTenResults(results);
        setRevealCount(0);
        onResult(results, GACHA_COST_TEN);
        setPhase('result');
      } else {
        const r = mode === 'memomon' ? pickGachaMon() : pickGacha();
        const dup = isDup(r);
        setSingleResult(r); setSingleDup(dup);
        if (dup && !infinite) setLocalCoins(c => c + 10);
        onResult([{ prize: r, dup }], cost);
        if (r.rarity !== 'common') {
          setFlashRarity(r.rarity);
          setPhase('flashing');
        } else {
          setPhase('result');
        }
      }
    }, 1600);
  }

  function again() {
    setPhase('idle'); setSingleResult(null); setSingleDup(false);
    setTenResults([]); setRevealCount(-1); setFlashRarity(null);
  }
  function switchMode(m: GachaMode) { if (phase !== 'spinning') { setMode(m); again(); } }

  const revealed = phase === 'flashing' || phase === 'result';
  const capsuleBg   = revealed && singleResult ? (rarityBg[singleResult.rarity] || rarityBg.common) : 'linear-gradient(135deg, #ffd700 0%, #ff6b35 50%, #e91e63 100%)';
  const capsuleGlow = revealed && singleResult ? (rarityGlow[singleResult.rarity] || rarityGlow.common) : '0 0 30px rgba(255,215,0,0.5), 0 0 60px rgba(255,107,53,0.3)';

  const singleDesc = singleResult
    ? singleDup ? 'すでに解放済み！ コイン +10 獲得'
    : singleResult.type === 'memomon' ? `${singleResult.label} がメモ画面を歩き回り始めた！`
    : `${singleResult.label} をゲット！設定に反映されました`
    : '';
  const labelParts = singleResult ? singleResult.label.split(' ') : [];
  const modeCostLabel: Record<GachaMode, string> = {
    single:  `${GACHA_COST}コインで1回`,
    ten:     `${GACHA_COST_TEN}コインで10連`,
    memomon: `${GACHA_COST_MON}コインでメモモン確定`,
  };

  return (
    <>
      {flashRarity && (
        <div
          className={`gacha-rarity-flash ${flashRarity}`}
          onAnimationEnd={() => { setFlashRarity(null); setPhase('result'); }}
        />
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
              <div className="gacha-capsule-wrap">
                {revealed && singleResult && (singleResult.rarity === 'ultra' || singleResult.rarity === 'super') && (
                  <div className={`gacha-beam gacha-beam-${singleResult.rarity}`} />
                )}
                {phase === 'spinning' && ORBIT_DOTS.map((d, i) => (
                  <div key={i} className="gacha-orbit-ring" style={{
                    '--dot-color': d.color, '--rot': d.rot, '--dur': d.dur,
                    '--delay': d.delay, '--sz': d.sz,
                  } as any} />
                ))}
                {revealed && singleResult && singleResult.rarity !== 'common' && (
                  <GachaParticles rarity={singleResult.rarity} />
                )}
                <div
                  className={`gacha-capsule${phase === 'spinning' ? ' spinning' : ''}${revealed ? ' revealed' : ''}`}
                  style={{ background: capsuleBg, boxShadow: capsuleGlow }}
                >
                  {phase === 'spinning' && <div className="gacha-flash" />}
                  {!revealed
                    ? <div className="gacha-capsule-inner">{mode === 'memomon' ? '🐾' : '？'}</div>
                    : <div className="gacha-result">
                        <div className="gacha-result-rarity" style={{ color: singleResult!.color }}>{singleResult!.stars}</div>
                        <div className="gacha-result-label">{labelParts[0]}</div>
                      </div>
                  }
                </div>
              </div>
              <div className="gacha-result-area" style={{ visibility: phase === 'result' ? 'visible' : 'hidden' }}>
                <div className="gacha-result-name">{labelParts.slice(1).join(' ') || singleResult?.label || ' '}</div>
                <div className="gacha-result-desc">{singleDesc || ' '}</div>
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
      result[idx] = {
        ...cur,
        summary: cur.summary || inc.summary || '',
        details: newDetails,
        tags: newTags,
        updatedAt: todayDate,
        addedAt: Date.now(),
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
      });
    }
  }
  return result;
}

async function parseMemoToItems(text: string, existingProjects: string[] = [], apiKey = ''): Promise<ParseResult> {
  const prompt =
    `あなたはメモを解析するアシスタントです。以下のメモを「TODO」と「アイデア」に分類し、JSONのみを返してください。\n\n` +
    `ルール:\n` +
    `1. TODO: 実行可能なタスク・予定・買い物・連絡など、行動動詞または日付/期限のあるもの\n` +
    `2. アイデア: 思いつき・構想・企画・コンセプト・将来やりたいこと\n` +
    `3. 複数項目は分割。「明日、にんじん、玉ねぎを買う」→「にんじんを買う」「玉ねぎを買う」（「明日」は日付なのでタイトルに含めずstartDateに）\n` +
    `4. 日付は YYYY-MM-DD。期間は startDate と endDate 両方、単日は endDate=""\n` +
    `   - 「8月中」      → startDate=yyyy-08-01, endDate=yyyy-08-31\n` +
    `   - 「7月1日〜15日」 → startDate=yyyy-07-01, endDate=yyyy-07-15\n` +
    `   - 「7月1日〜8月15日」→ startDate=yyyy-07-01, endDate=yyyy-08-15\n` +
    `   - 「明日から来週水曜まで」→ 期間で記述\n` +
    `5. 時間は HH:MM か ""。\n` +
    `   - TODOのtags: 買い物 / 仕事 / 家事 / 健康 / 勉強 / その他（「アイデア」は使わない）\n` +
    `   - アイデアのtags: アイデア / 買い物 / 仕事 / 家事 / 健康 / 勉強\n` +
    `6. TODOのcoinReward: タスクの難易度・手間・所要時間をもとに10〜200の整数で設定（10の倍数推奨）\n` +
    `   - 10〜30: 買い物・連絡など数分でできる簡単なもの\n` +
    `   - 40〜80: 家事・軽い仕事など30分〜1時間程度\n` +
    `   - 90〜150: 複雑な仕事・長時間の作業・勉強など\n` +
    `   - 160〜200: 大型プロジェクト・困難なタスク\n` +
    `7. アイデアは projectName で分類。下記の既存プロジェクトと類似する場合、必ずその名前を使用すること\n` +
    `8. 既存プロジェクト: ${JSON.stringify(existingProjects)}\n` +
    `9. 本日: ${todayStr}（年が指定されていない月日は${today.getFullYear()}年として扱う）\n\n` +
    `形式（JSONのみ）:\n` +
    `{"todos":[{"title":"","startDate":"","endDate":"","time":"","tags":[],"coinReward":10}],"ideas":[{"projectName":"","summary":"","details":[],"tags":[]}]}\n\n` +
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
function Calendar({ todos, selectedDate, onSelect, mode = 'month', onModeChange }: { todos: Todo[]; selectedDate: string; onSelect: (d: string) => void; mode?: 'month' | 'week'; onModeChange?: (m: 'month' | 'week') => void }) {
  const [vy, setVy] = useState(today.getFullYear());
  const [vm, setVm] = useState(today.getMonth());
  const [direction, setDirection] = useState<'prev' | 'next' | null>(null);
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

  const prev = () => {
    if (mode === 'week') {
      // 週表示：7日前にジャンプ
      const prevDate = new Date(selectedDate + 'T00:00:00');
      prevDate.setDate(prevDate.getDate() - 7);
      onSelect(formatDate(prevDate));
    } else {
      // 月表示：前月に移動
      setDirection('prev');
      setTimeout(() => {
        vm === 0 ? (setVm(11), setVy(y => y - 1)) : setVm(m => m - 1);
        setDirection(null);
      }, 200);
    }
  };
  const next = () => {
    if (mode === 'week') {
      // 週表示：7日後にジャンプ
      const nextDate = new Date(selectedDate + 'T00:00:00');
      nextDate.setDate(nextDate.getDate() + 7);
      onSelect(formatDate(nextDate));
    } else {
      // 月表示：翌月に移動
      setDirection('next');
      setTimeout(() => {
        vm === 11 ? (setVm(0),  setVy(y => y + 1)) : setVm(m => m + 1);
        setDirection(null);
      }, 200);
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
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prev}>‹</button>
          <button className="cal-nav-btn" onClick={next}>›</button>
        </div>
      </div>
      <div className="cal-dow">{DOW.map(d => <div key={d} className="cal-dow-cell">{d}</div>)}</div>
      <div className={`cal-grid${direction ? ` cal-slide-${direction}` : ''}`}>
        {cells.map((c, i) => {
          const ds = formatDate(c.date), isTd = ds === todayStr, isSel = ds === selectedDate, hasDot = dotSet.has(ds);
          const cellTodos = todos.filter(t => {
            if (!t.startDate) return false;
            return ds >= t.startDate && ds <= (t.endDate || t.startDate);
          });
          return (
            <div key={i} className={`cal-cell${!c.cur ? ' other-month' : ''}${isTd && !isSel ? ' today' : ''}${isSel ? ' selected' : ''}`} onClick={() => onSelect(ds)}>
              <span className="cal-num">{c.date.getDate()}</span>
              {cellTodos.length > 0 && (
                <div className="cal-todos">
                  {cellTodos.slice(0, 2).map((t, idx) => {
                    const multi = t.startDate && t.endDate && t.startDate !== t.endDate;
                    const spanCls = multi
                      ? ds === t.startDate ? 'span-start'
                      : ds === t.endDate   ? 'span-end'
                      : 'span-middle'
                      : '';
                    return (
                      <div key={idx} className={`cal-todo-item${spanCls ? ` ${spanCls}` : ''}`} title={t.title}>
                        {spanCls === 'span-middle' || spanCls === 'span-end' ? '' :
                          t.title.length > 10 ? t.title.substring(0, 10) + '…' : t.title}
                      </div>
                    );
                  })}
                  {cellTodos.length > 2 && <div className="cal-more">+{cellTodos.length - 2}</div>}
                </div>
              )}
              {hasDot && cellTodos.length === 0 && <div className="cal-dot"/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Edit Modal
// ─────────────────────────────────────────────────────────────
function EditModal({ todo, mode = 'edit', onSave, onClose, customTags = [] }: {
  todo: Todo | (TodoDraft & { id: string });
  mode?: 'add' | 'edit';
  onSave: (t: any) => void;
  onClose: () => void;
  customTags?: string[];
}) {
  const tagOptions = getTodoTagOptions(customTags);
  const [title,    setTitle]    = useState(todo.title);
  const [startDate,setStartDate]= useState(todo.startDate);
  const [endDate,  setEndDate]  = useState(todo.endDate);
  const [time,     setTime]     = useState(todo.time);
  const [tags,     setTags]     = useState<string[]>(todo.tags || []);

  const toggleTag = (t: string) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  function handleSave() {
    if (!title.trim()) return;
    onSave({ ...todo, title: title.trim(), startDate, endDate, time, tags });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div className="modal-title">{mode === 'add' ? 'タスクを追加' : 'タスクを編集'}</div>

        <div className="modal-field">
          <label>タイトル</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="タスク名" />
        </div>
        <div className="modal-row">
          <div className="modal-field">
            <label>開始日</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="modal-field">
            <label>終了日</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
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
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>キャンセル</button>
          <button className="modal-save" onClick={handleSave}>{mode === 'add' ? '追加' : '保存'}</button>
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

  const toggleTag = (t: string) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  function handleSave() {
    if (!projectName.trim()) return;
    onSave({
      ...idea,
      projectName: projectName.trim(),
      summary: summary.trim(),
      details: details.split('\n').map(s => s.trim()).filter(Boolean),
      tags,
      subTab: subTab || undefined,
    });
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div className="modal-title">{mode === 'add' ? 'アイデアを追加' : 'アイデアを編集'}</div>

        <div className="modal-field">
          <label>プロジェクト</label>
          <input list="idea-projects-dl" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="プロジェクト名" />
          <datalist id="idea-projects-dl">
            {projects.filter(p => p && p !== projectName).map(p => <option key={p} value={p} />)}
          </datalist>
        </div>
        <div className="modal-field">
          <label>概要</label>
          <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="アイデアの概要" />
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
            TODO {pending.todos.length}件・アイデア {pending.ideas.length}件 を抽出しました。タップで編集、✕で除外できます。
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
                      {t.startDate}{t.endDate ? ` — ${t.endDate}` : ''}{t.time ? `  ${t.time}` : ''}
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

          {pending.ideas.length > 0 && <div className="confirm-section-head">アイデア（{pending.ideas.length}）</div>}
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

// ─────────────────────────────────────────────────────────────
// Memo Tab
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
function MemoTab({ existingProjects, customTags, geminiApiKey, ideaTabs = [], micTrigger = 0, onCommit }: {
  existingProjects: string[];
  customTags: string[];
  geminiApiKey: string;
  ideaTabs?: string[];
  micTrigger?: number;
  onCommit: (p: { todos: Todo[]; ideas: IdeaDraft[]; unlockCoins?: boolean }) => void;
}) {
  const [text,       setText]       = usePersistedState<string>('smartmemo:memo:draft', '');
  const [loading,    setLoading]    = useState(false);
  const [loadingMsg, setLMsg]       = useState('');
  const [recording,  setRec]        = useState(false);
  const [imgPrev,    setImgPrev]    = useState<string | null>(null);
  const [toast,      setToast]      = useState<string | null>(null);
  const [pending,    setPending]    = useState<Pending | null>(null);
  const [swooshing,  setSwooshing]  = useState(false);
  const [burst,      setBurst]      = useState<{ x: number; y: number; key: number } | null>(null);
  const [memoHistory, setMemoHistory] = usePersistedState<MemoHistoryItem[]>('smartmemo:memoHistory', []);
  const [showHistory, setShowHistory] = useState(false);
  const fileRef         = useRef<HTMLInputElement | null>(null);
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

  async function reflect(originX: number, originY: number) {
    if (!text.trim()) { showToast('メモを入力してください'); return; }
    setLoading(true);
    setLMsg('AI で TODO とアイデアに自動分類中');
    try {
      const result = await parseMemoToItems(text, existingProjects, geminiApiKey);
      const todos = result.todos || [];
      const ideas = result.ideas || [];

      const ts = Date.now();
      const todoDrafts = todos.map((t, i) => ({
        title: t.title || 'タスク',
        startDate: t.startDate || '',
        endDate: t.endDate || '',
        time: t.time || '',
        tags: t.tags || [],
        id: `t_${ts}_${i}`,
        done: false as const,
      }));
      const ideaDrafts = ideas.map((i, idx) => ({
        projectName: i.projectName || 'メモ',
        summary: i.summary || '',
        details: i.details || [],
        tags: (i.tags && i.tags.length ? i.tags : ['アイデア']),
        id: `i_${ts}_${idx}`,
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
    const total = pending.todos.length + pending.ideas.length;
    setTimeout(() => {
      const stamp = Date.now();
      const newTodos: Todo[] = pending.todos.map(t => ({
        id: stamp + Math.random(),
        title: t.title,
        startDate: t.startDate,
        endDate: t.endDate,
        time: t.time,
        tags: t.tags,
        done: false,
        addedAt: stamp,
      }));
      const newIdeas: IdeaDraft[] = pending.ideas.map(i => ({
        projectName: i.projectName,
        summary: i.summary,
        details: i.details,
        tags: i.tags,
      }));
      onCommit({ todos: newTodos, ideas: newIdeas, unlockCoins: text.includes('coinzackzack') });
      showToast(`${total}件を追加しました`);
      if (text.trim()) setMemoHistory(h => [{ id: Date.now(), text: text.trim(), savedAt: Date.now() }, ...h].slice(0, 100));
      setText(''); setImgPrev(null); setPending(null); setSwooshing(false);
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
        <textarea className="memo-textarea" placeholder={"思いついたことを自由に入力\n例：来週月曜から水曜まで出張。にんじん・じゃがいも・玉ねぎを買う"} value={text} onChange={e => setText(e.target.value)} />
        <div className="memo-actions">
          <button className={`action-btn${recording ? ' recording' : ''}`} onClick={toggleRec}>
            {recording ? <><span className="pulse-dot"/>録音停止</> : <><IcoMic />音声入力</>}
          </button>
          <button className="action-btn" onClick={() => fileRef.current?.click()}><IcoImg />画像から入力</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />
          <button className="action-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowHistory(true)}><IcoHistory />履歴</button>
        </div>
      </div>

      <div className="reflect-actions">
        <button
          className="reflect-btn"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const parent = (e.currentTarget.closest('.memo-tab') as HTMLElement | null)?.getBoundingClientRect();
            const x = r.left + r.width / 2 - (parent?.left || 0);
            const y = r.top  + r.height / 2 - (parent?.top  || 0);
            reflect(x, y);
          }}
          disabled={loading}
        >
          <IcoSparkle /> AI で TODO・アイデアに反映
        </button>
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
                  <div key={item.id} className="memo-history-item" onClick={() => { setText(item.text); setShowHistory(false); }}>
                    <div className="memo-history-info">
                      <div className="memo-history-date">{formatHistoryDate(item.savedAt)}</div>
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
function TodoTab({ todos, boss, onBossComplete, onBossDismiss, onToggle, onDelete, onUpdate, onAdd, soundEnabled, soundType = 'doremi', customTags }: {
  todos: Todo[];
  boss?: { id: string; title: string; spawnedAt: number } | null;
  onBossComplete?: () => void;
  onBossDismiss?: () => void;
  onToggle: (id: number | string) => void;
  onDelete: (id: number | string) => void;
  onUpdate: (t: Todo) => void;
  onAdd: (t: Todo) => void;
  soundEnabled: boolean;
  soundType?: string;
  customTags: string[];
}) {
  const [sel,          setSel]        = usePersistedState<string>('smartmemo:ui:sel', todayStr);
  const [editing,      setEditing]    = useState<Todo | null>(null);
  const [adding,       setAdding]     = useState(false);
  const [showCalendar, setShowCalendar] = useState(true);
  const [selTagsArr,   setSelTagsArr] = usePersistedState<string[]>('smartmemo:ui:tags', []);
  const [calendarMode, setCalendarMode] = usePersistedState<'month' | 'week'>('smartmemo:ui:calMode', 'month');
  const [undatedOpen,  setUndatedOpen]  = useState(true);

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

  return (
    <div className="todo-tab">
      {editing && <EditModal todo={editing} onSave={onUpdate} onClose={() => setEditing(null)} customTags={customTags} />}
      {adding && <EditModal mode="add" todo={{ id: Date.now(), title: '', startDate: sel, endDate: '', time: '', tags: [], done: false, addedAt: Date.now() }} onSave={t => { onAdd(t); setAdding(false); }} onClose={() => setAdding(false)} customTags={customTags} />}
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
          <Calendar todos={filteredTodos} selectedDate={sel} onSelect={setSel} mode={calendarMode} onModeChange={setCalendarMode} />
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
            {overdueTodos.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={setEditing} soundEnabled={soundEnabled} soundType={soundType} overdue />)}
            <div className="divider"/>
          </>}
          {sortedDateTodos.length === 0
            ? <div className="todo-empty">この日のタスクはありません</div>
            : sortedDateTodos.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={setEditing} soundEnabled={soundEnabled} soundType={soundType} />)
          }
          {sortedUndated.length > 0 && <>
            <div className="divider"/>
            <div className="section-head undated-head" onClick={() => setUndatedOpen(o => !o)}>
              <span className="section-head-label">日付未定</span>
              <span className="section-count">{sortedUndated.length}</span>
              <span className="undated-arrow">{undatedOpen ? <IcoChevronUp /> : <IcoChevronDown />}</span>
            </div>
            <div className={`undated-body${undatedOpen ? '' : ' closed'}`}>
              {sortedUndated.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={setEditing} soundEnabled={soundEnabled} soundType={soundType} />)}
            </div>
          </>}
          <button className="todo-add-row" onClick={() => setAdding(true)}>
            ＋ タスクを追加
          </button>
        </div>
      </div>
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
  const justDraggedRef   = React.useRef(false);
  const [dropTabTarget,  setDropTabTarget]  = useState<string | null>(null);
  const projectNames = ideas.map(i => i.projectName);

  const filteredIdeas = activeSubTab === 'all'
    ? ideas
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
    if (!window.confirm(`「${tab}」タブを削除しますか？\nこのタブのアイデアは未分類になります。`)) return;
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
      >すべて</span>
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
          onSave={i => { onAdd(i); setAddingIdea(false); }}
          onClose={() => setAddingIdea(false)}
          customTags={customTags}
          ideaTabs={ideaTabs}
        />
      )}
      {subtabBar}
      {subtabInput}
      <div className={`ideas-tab tab-pane${touchDragId != null ? ' touch-dragging' : ''}`}>
        {filteredIdeas.length === 0
          ? <div className="ideas-empty">まだアイデアがありません</div>
          : ideaCards
        }
        <button className="ideas-add-row" onClick={() => setAddingIdea(true)}>
          ＋ 新しいアイデアを追加
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings Tab
// ─────────────────────────────────────────────────────────────
function SettingsTab({ settings, onChange, memoMons }: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  memoMons: MemoMonInstance[];
}) {
  const { colorIdx, fontIdx, notifEnabled, autoTag, autoDate, completeSound, geminiApiKey, darkMode } = settings;
  const soundOn = completeSound !== false;
  const [newTag, setNewTag]             = useState('');
  const [keyInput, setKeyInput]         = useState(geminiApiKey || '');
  const [keyVisible, setKeyVisible]     = useState(false);
  const [apiStatus, setApiStatus]       = useState<{ kind: 'idle' | 'ok' | 'ng'; msg: string }>({ kind: 'idle', msg: '' });
  const [showMonSelector, setShowMonSelector] = useState(false);

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
        <div className="settings-row">
          <div>
            <div className="settings-row-label">タスク通知</div>
            <div className="settings-row-sub">期限前にリマインド</div>
          </div>
          <button className={`toggle${notifEnabled ? ' on' : ' off'}`} onClick={() => onChange('notifEnabled', !notifEnabled)} />
        </div>
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
              {SOUND_TYPES.map(s => (
                <button
                  key={s.key}
                  className={`sound-type-btn${(settings.soundType || 'doremi') === s.key ? ' sel' : ''}`}
                  onClick={() => { onChange('soundType', s.key); playSound(s.key); }}
                >{s.label}</button>
              ))}
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
      </div>

      <div className="settings-section-title">タグ</div>
      <div className="settings-card">
        <div className="tag-row">
          <div className="settings-row-label">既定タグ</div>
          <div className="settings-row-sub">削除はできません。アイデア用は「アイデア」のみ</div>
          <div className="tag-chip-list">
            {BUILTIN_IDEA_TAGS.map(t => (
              <span key={t} className="tag-chip tag-chip-builtin">{t}</span>
            ))}
          </div>
        </div>
        <div className="tag-row">
          <div className="settings-row-label">カスタムタグ</div>
          <div className="settings-row-sub">独自のタグを追加・削除できます（TODO・アイデア両方で使用可能）</div>
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
              <button onClick={() => setShowMonSelector(true)}>選択</button>
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
                    onClick={() => {
                      const current = settings.hiddenMons || [];
                      onChange('hiddenMons', hidden
                        ? current.filter(id => id !== m.defId)
                        : [...current, m.defId]
                      );
                    }}
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

      <div className="settings-section-title">アプリ情報</div>
      <div className="about-card">
        <div className="about-app-name">SmartMemo</div>
        <div className="about-version">Version 1.1.0 (TypeScript)</div>
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
        liveRef.current[m.uid] = {
          ...m, hunger,
          x: Math.random() * Math.max(0, W - def.monW * sc),
          y: 60 + Math.random() * Math.max(0, H * 0.3),
          vx: startSleep ? 0 : (Math.random() > 0.5 ? 1 : -1) * 40,
          vy: startSleep ? 0 : (Math.random() - 0.5) * 20,
          facing: 'r',
          state: startSleep ? 'idle' : 'walk',
          stateUntil: now + 2000 + Math.random() * 3000,
          animState: startSleep ? 'sleep' : 'sit',
          frame: 0, frameTime: 0, tapCount: 0,
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

        // Movement state machine
        if (now > m.stateUntil) {
          if (m.state === 'walk') {
            if (Math.random() < 0.3) {
              m.state = 'idle'; m.vx = 0; m.vy = 0;
              m.stateUntil = now + 1000 + Math.random() * 2000;
              if (def.sprites) { m.animState = 'sit'; m.frameTime = 0; }
              else { const img = imgRefs.current[m.uid]; if (img) img.style.animation = 'none'; }
            } else {
              m.vx = (Math.random() > 0.5 ? 1 : -1) * 40;
              m.vy = (Math.random() - 0.5) * 20;
              m.stateUntil = now + 2000 + Math.random() * 4000;
            }
          } else {
            m.state = 'walk';
            m.vx = (Math.random() > 0.5 ? 1 : -1) * 40;
            m.vy = (Math.random() - 0.5) * 20;
            m.stateUntil = now + 2000 + Math.random() * 4000;
            if (def.sprites) { m.animState = 'walk'; m.frameTime = 0; }
            else { const img = imgRefs.current[m.uid]; if (img) img.style.animation = 'monBob 0.6s ease-in-out infinite'; }
          }
        }

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
// Root
// ─────────────────────────────────────────────────────────────
function SmartMemoApp() {
  const [tab, setTab] = usePersistedState<Tab>('smartmemo:ui:tab', 'memo');
  const [pulseTabs, setPulseTabs] = useState<Set<Tab>>(new Set());
  const [micTrigger, setMicTrigger] = useState(0);
  const [showGacha, setShowGacha] = useState(false);
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
  const [ideas, setIdeas] = usePersistedState<Idea[]>(LS_IDEAS, []);
  const [settings, setSettings] = usePersistedState<Settings>(LS_SETTINGS, {
    colorIdx: 0, fontIdx: 1, notifEnabled: true, autoTag: true, autoDate: true,
    completeSound: true, customTags: [], geminiApiKey: '', coins: 0, darkMode: false, bgIdx: 0,
    infiniteCoins: false, gachaUnlocked: { sounds: [], bgs: [] },
  });
  const [memoMons, setMemoMons] = usePersistedState<MemoMonInstance[]>('smartmemo:memomons', [
    { uid: 'kuroneko-default', defId: 'kuroneko', hunger: 100, lastFed: Date.now() },
  ]);

  useEffect(() => {
    if (!memoMons.find(m => m.defId === 'kuroneko')) {
      setMemoMons(prev => [
        { uid: 'kuroneko-default', defId: 'kuroneko', hunger: 100, lastFed: Date.now() },
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
  const remove     = (id: number | string) => setTodos(p => p.filter(t => t.id !== id));
  const update     = (item: Todo)          => setTodos(p => p.map(t => t.id === item.id ? item : t));
  const addTodo    = (item: Todo)          => setTodos(p => [...p, item]);
  const updateIdea = (item: Idea)          => setIdeas(p => p.map(i => i.id === item.id ? { ...item, updatedAt: formatDate(new Date()) } : i));
  const removeIdea = (id: number | string) => setIdeas(p => p.filter(i => i.id !== id));
  const addIdea    = (item: Idea)          => setIdeas(p => [...p, item]);
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(p => ({ ...p, [k]: v }));

  const handleFabMic = () => { setTab('memo'); setMicTrigger(t => t + 1); };

  const navItems: { key: Tab; label: string; Icon: React.FC<{ active: boolean }> }[] = [
    { key: 'memo',     label: 'メモ入力', Icon: IcoMemoNav     },
    { key: 'todo',     label: 'TODO',     Icon: IcoTodoNav     },
    { key: 'idea',     label: 'アイデア', Icon: IcoIdeaNav     },
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
        {tab === 'memo'     && <MemoTab existingProjects={existingProjects} customTags={settings.customTags || []} geminiApiKey={settings.geminiApiKey || ''} ideaTabs={settings.ideaTabs || []} micTrigger={micTrigger} onCommit={commit} />}
        {tab === 'todo'     && <TodoTab todos={todos} boss={boss} onBossComplete={handleBossComplete} onBossDismiss={() => setBoss(null)} onToggle={toggle} onDelete={remove} onUpdate={update} onAdd={addTodo} soundEnabled={settings.completeSound !== false} soundType={settings.soundType || 'doremi'} customTags={settings.customTags || []} />}
        {tab === 'idea'     && <IdeasTab ideas={ideas} onUpdate={updateIdea} onDelete={removeIdea} onAdd={addIdea} onReorder={reorderIdea} customTags={settings.customTags || []} ideaTabs={settings.ideaTabs || []} onUpdateIdeaTabs={tabs => setSetting('ideaTabs', tabs)} />}
        {tab === 'settings' && <SettingsTab settings={settings} onChange={setSetting} memoMons={memoMons} />}
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
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<SmartMemoApp />);
