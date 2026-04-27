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
};
type TodoDraft = {
  id?: number | string;
  title: string;
  startDate: string;
  endDate: string;
  time: string;
  tags: string[];
  done?: boolean;
};
type IdeaDraft = {
  id?: number | string;
  projectName: string;
  summary: string;
  details: string[];
  tags: string[];
};
type ParseResult = { todos: TodoDraft[]; ideas: IdeaDraft[] };
type Pending = { todos: (TodoDraft & { id: string; done: false })[]; ideas: (IdeaDraft & { id: string })[] };
type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };
type Tab = 'memo' | 'todo' | 'idea' | 'settings';

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

// Two-tone success "ding" via Web Audio API.
let _audioCtx: AudioContext | undefined;
function playCompleteSound() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!_audioCtx) _audioCtx = new Ctx();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const now = _audioCtx.currentTime;
    [659.25, 987.77].forEach((freq, i) => {
      const osc = _audioCtx!.createOscillator();
      const gain = _audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.07;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      osc.connect(gain).connect(_audioCtx!.destination);
      osc.start(t);
      osc.stop(t + 0.27);
    });
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
      out.push({ title: `${n}を${verb}`, startDate: dates.startDate, endDate: dates.endDate, time, tags });
    }
    return out;
  }

  const parts = cleaned.split(/[、,]/).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (const p of parts) {
      out.push({ title: p, startDate: dates.startDate, endDate: dates.endDate, time, tags: inferTagsForTodo(p) });
    }
  } else {
    out.push({ title: cleaned || line, startDate: dates.startDate, endDate: dates.endDate, time, tags: inferTagsForTodo(line) });
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
    `6. アイデアは projectName で分類。下記の既存プロジェクトと類似する場合、必ずその名前を使用すること\n` +
    `7. 既存プロジェクト: ${JSON.stringify(existingProjects)}\n` +
    `8. 本日: ${todayStr}（年が指定されていない月日は${today.getFullYear()}年として扱う）\n\n` +
    `形式（JSONのみ）:\n` +
    `{"todos":[{"title":"","startDate":"","endDate":"","time":"","tags":[]}],"ideas":[{"projectName":"","summary":"","details":[],"tags":[]}]}\n\n` +
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

// ─────────────────────────────────────────────────────────────
// Calendar
// ─────────────────────────────────────────────────────────────
function Calendar({ todos, selectedDate, onSelect }: { todos: Todo[]; selectedDate: string; onSelect: (d: string) => void }) {
  const [vy, setVy] = useState(today.getFullYear());
  const [vm, setVm] = useState(today.getMonth());
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const firstDay = new Date(vy, vm, 1);
  const lastDay  = new Date(vy, vm + 1, 0);
  const cells: { date: Date; cur: boolean }[] = [];
  for (let i = firstDay.getDay() - 1; i >= 0; i--) cells.push({ date: new Date(vy, vm, -i), cur: false });
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ date: new Date(vy, vm, d), cur: true });
  while (cells.length < 42) {
    const l = cells[cells.length - 1].date;
    cells.push({ date: new Date(l.getTime() + 86400000), cur: false });
  }

  const dotSet = new Set<string>();
  todos.forEach(t => {
    if (!t.startDate) return;
    const s = new Date(t.startDate), e = t.endDate ? new Date(t.endDate) : s;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) dotSet.add(formatDate(new Date(d)));
  });

  const prev = () => vm === 0 ? (setVm(11), setVy(y => y - 1)) : setVm(m => m - 1);
  const next = () => vm === 11 ? (setVm(0),  setVy(y => y + 1)) : setVm(m => m + 1);

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
        <span className="cal-month-label">{vy}年 {MONTH_JP[vm]}</span>
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prev}>‹</button>
          <button className="cal-nav-btn" onClick={next}>›</button>
        </div>
      </div>
      <div className="cal-dow">{DOW.map(d => <div key={d} className="cal-dow-cell">{d}</div>)}</div>
      <div className="cal-grid">
        {cells.map((c, i) => {
          const ds = formatDate(c.date), isTd = ds === todayStr, isSel = ds === selectedDate, hasDot = dotSet.has(ds);
          return (
            <div key={i} className={`cal-cell${!c.cur ? ' other-month' : ''}${isTd && !isSel ? ' today' : ''}${isSel ? ' selected' : ''}`} onClick={() => onSelect(ds)}>
              <span className="cal-num">{c.date.getDate()}</span>
              {hasDot && <div className="cal-dot"/>}
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
function EditModal({ todo, onSave, onClose, customTags = [] }: {
  todo: Todo | (TodoDraft & { id: string });
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
        <div className="modal-title">タスクを編集</div>

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
          <button className="modal-save" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Idea Edit Modal
// ─────────────────────────────────────────────────────────────
function IdeaEditModal({ idea, projects, onSave, onClose, customTags = [] }: {
  idea: Idea | (IdeaDraft & { id: string });
  projects: string[];
  onSave: (i: any) => void;
  onClose: () => void;
  customTags?: string[];
}) {
  const tagOptions = getIdeaTagOptions(customTags);
  const [projectName, setProjectName] = useState(idea.projectName || '');
  const [summary,     setSummary]     = useState(idea.summary || '');
  const [details,     setDetails]     = useState((idea.details || []).join('\n'));
  const [tags,        setTags]        = useState<string[]>(idea.tags || []);

  const toggleTag = (t: string) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  function handleSave() {
    if (!projectName.trim()) return;
    onSave({
      ...idea,
      projectName: projectName.trim(),
      summary: summary.trim(),
      details: details.split('\n').map(s => s.trim()).filter(Boolean),
      tags,
    });
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div className="modal-title">アイデアを編集</div>

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
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>キャンセル</button>
          <button className="modal-save" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Todo Item
// ─────────────────────────────────────────────────────────────
function TodoItem({ todo, onToggle, onDelete, onEdit, soundEnabled }: {
  todo: Todo;
  onToggle: (id: number | string) => void;
  onDelete: (id: number | string) => void;
  onEdit: (t: Todo) => void;
  soundEnabled: boolean;
}) {
  const [animating, setAnimating] = useState(false);
  const justAdded = !!todo.addedAt && (Date.now() - todo.addedAt) < 800;

  function handleToggle() {
    if (!todo.done) {
      setAnimating(true);
      if (soundEnabled) playCompleteSound();
      setTimeout(() => setAnimating(false), 600);
    }
    onToggle(todo.id);
  }
  return (
    <div className={`todo-item${todo.done ? ' done' : ''}${animating ? ' animate-fade' : ''}${justAdded ? ' just-added' : ''}`}>
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
        </div>
      </div>
      <button className="todo-del" onClick={() => onDelete(todo.id)}>✕</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirm Sheet
// ─────────────────────────────────────────────────────────────
function ConfirmSheet({
  pending, existingProjects, customTags, swooshing,
  onUpdateTodo, onDeleteTodo, onUpdateIdea, onDeleteIdea, onConfirm, onCancel,
}: {
  pending: Pending;
  existingProjects: string[];
  customTags: string[];
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
// ─────────────────────────────────────────────────────────────
function MemoTab({ existingProjects, customTags, geminiApiKey, onCommit }: {
  existingProjects: string[];
  customTags: string[];
  geminiApiKey: string;
  onCommit: (p: { todos: Todo[]; ideas: IdeaDraft[] }) => void;
}) {
  const [text,       setText]       = useState('');
  const [loading,    setLoading]    = useState(false);
  const [loadingMsg, setLMsg]       = useState('');
  const [recording,  setRec]        = useState(false);
  const [imgPrev,    setImgPrev]    = useState<string | null>(null);
  const [toast,      setToast]      = useState<string | null>(null);
  const [pending,    setPending]    = useState<Pending | null>(null);
  const [swooshing,  setSwooshing]  = useState(false);
  const [burst,      setBurst]      = useState<{ x: number; y: number; key: number } | null>(null);
  const fileRef       = useRef<HTMLInputElement | null>(null);
  const recRef        = useRef<any>(null);
  const tRef          = useRef<number | undefined>(undefined);
  const baseTextRef   = useRef('');
  const finalTextRef  = useRef('');

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
      onCommit({ todos: newTodos, ideas: newIdeas });
      showToast(`${total}件を追加しました`);
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
        <textarea className="memo-textarea" placeholder={"思いついたことを自由に入力\n例：来週月曜から水曜まで出張。にんじん・じゃがいも・玉ねぎを買う"} value={text} onChange={e => setText(e.target.value)} />
        <div className="memo-actions">
          <button className={`action-btn${recording ? ' recording' : ''}`} onClick={toggleRec}>
            {recording ? <><span className="pulse-dot"/>録音停止</> : <><IcoMic />音声入力</>}
          </button>
          <button className="action-btn" onClick={() => fileRef.current?.click()}><IcoImg />画像から入力</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />
        </div>
      </div>

      {imgPrev && (
        <div className="img-preview">
          <img src={imgPrev} alt="" />
          <button className="img-clear" onClick={() => setImgPrev(null)}>✕</button>
        </div>
      )}

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

      <div className="hint-card">
        <div className="hint-title">入力のヒント</div>
        <div className="hint-body">
          AI が自動で TODO とアイデアを判別します。<br/>
          「明日から来週水曜まで出張」「8月中」「7月1日〜15日」→ 期間つきTODO<br/>
          「にんじん、じゃがいも、玉ねぎを買う」→ 3つのTODOに分割<br/>
          「新アプリ案: チャット機能を追加」→ プロジェクト『新アプリ案』のアイデア<br/>
          既存プロジェクト名で書くと、そのアイデアに詳細が追記されます
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TODO Tab
// ─────────────────────────────────────────────────────────────
function TodoTab({ todos, onToggle, onDelete, onUpdate, soundEnabled, customTags }: {
  todos: Todo[];
  onToggle: (id: number | string) => void;
  onDelete: (id: number | string) => void;
  onUpdate: (t: Todo) => void;
  soundEnabled: boolean;
  customTags: string[];
}) {
  const [sel,     setSel]     = useState(todayStr);
  const [editing, setEditing] = useState<Todo | null>(null);

  const dateTodos = todos.filter(t => {
    if (!t.startDate) return false;
    const d = new Date(sel), s = new Date(t.startDate), e = t.endDate ? new Date(t.endDate) : s;
    return d >= s && d <= e;
  });
  const undated = todos.filter(t => !t.startDate);

  return (
    <div className="todo-tab">
      {editing && <EditModal todo={editing} onSave={onUpdate} onClose={() => setEditing(null)} customTags={customTags} />}
      <Calendar todos={todos} selectedDate={sel} onSelect={setSel} />
      <div className="todo-list-area">
        <div className="section-head">
          <span className="section-head-label">{sel.replace(/-/g, '/')}</span>
          {dateTodos.length > 0 && <span className="section-count">{dateTodos.length}</span>}
        </div>
        {dateTodos.length === 0
          ? <div className="todo-empty">この日のタスクはありません</div>
          : dateTodos.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={setEditing} soundEnabled={soundEnabled} />)
        }
        {undated.length > 0 && <>
          <div className="divider"/>
          <div className="section-head">
            <span className="section-head-label">日付未定</span>
            <span className="section-count">{undated.length}</span>
          </div>
          {undated.map(t => <TodoItem key={t.id} todo={t} onToggle={onToggle} onDelete={onDelete} onEdit={setEditing} soundEnabled={soundEnabled} />)}
        </>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ideas Tab
// ─────────────────────────────────────────────────────────────
function IdeasTab({ ideas, onUpdate, onDelete, customTags }: {
  ideas: Idea[];
  onUpdate: (i: Idea) => void;
  onDelete: (id: number | string) => void;
  customTags: string[];
}) {
  const [editing, setEditing] = useState<Idea | null>(null);
  const projectNames = ideas.map(i => i.projectName);

  if (ideas.length === 0) {
    return (
      <div className="ideas-tab tab-pane">
        <div className="ideas-empty">
          まだアイデアがありません<br/>
          メモタブで思いついたことを入力し、<br/>
          「AI で反映」を押すと蓄積されます
        </div>
      </div>
    );
  }

  return (
    <div className="ideas-tab tab-pane">
      {editing && (
        <IdeaEditModal
          idea={editing}
          projects={projectNames.filter(p => p !== editing.projectName)}
          onSave={u => { onUpdate(u); setEditing(null); }}
          onClose={() => setEditing(null)}
          customTags={customTags}
        />
      )}
      {ideas.map(i => {
        const justAdded = !!i.addedAt && (Date.now() - i.addedAt) < 800;
        return (
          <div key={i.id} className={`idea-card${justAdded ? ' just-added' : ''}`} onClick={() => setEditing(i)}>
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
            <button className="todo-del" onClick={e => { e.stopPropagation(); onDelete(i.id); }}>✕</button>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings Tab
// ─────────────────────────────────────────────────────────────
function SettingsTab({ settings, onChange }: {
  settings: Settings;
  onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const { colorIdx, fontIdx, notifEnabled, autoTag, autoDate, completeSound, geminiApiKey } = settings;
  const soundOn = completeSound !== false;
  const [newTag, setNewTag]         = useState('');
  const [keyInput, setKeyInput]     = useState(geminiApiKey || '');
  const [keyVisible, setKeyVisible] = useState(false);
  const [apiStatus, setApiStatus]   = useState<{ kind: 'idle' | 'ok' | 'ng'; msg: string }>({ kind: 'idle', msg: '' });

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
            <button className="secondary" onClick={() => setKeyVisible(v => !v)}>{keyVisible ? '隠' : '表'}</button>
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

      <div className="settings-section-title">アプリ情報</div>
      <div className="about-card">
        <div className="about-app-name">SmartMemo</div>
        <div className="about-version">Version 1.1.0 (TypeScript)</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────
function SmartMemoApp() {
  const [tab, setTab] = useState<Tab>('memo');
  const [pulseTabs, setPulseTabs] = useState<Set<Tab>>(new Set());
  const [todos, setTodos] = usePersistedState<Todo[]>(LS_TODOS, [
    { id: 1, title: 'プレゼン資料の作成', startDate: todayStr, endDate: '', time: '10:00', tags: ['仕事'],   done: false },
    { id: 2, title: '牛乳を購入する',     startDate: todayStr, endDate: '', time: '',      tags: ['買い物'], done: false },
    { id: 3, title: '部屋の片付け',       startDate: '',       endDate: '', time: '',      tags: ['家事'],   done: false },
  ]);
  const [ideas, setIdeas] = usePersistedState<Idea[]>(LS_IDEAS, []);
  const [settings, setSettings] = usePersistedState<Settings>(LS_SETTINGS, {
    colorIdx: 0, fontIdx: 1, notifEnabled: true, autoTag: true, autoDate: true,
    completeSound: true, customTags: [], geminiApiKey: '',
  });

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

  const color = COLOR_PRESETS[settings.colorIdx];
  const font  = FONT_SIZE_OPTS[settings.fontIdx];

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color.value);
  }, [color.value]);

  const appStyle: React.CSSProperties = {
    ['--accent'       as any]: color.value,
    ['--accent-light' as any]: color.light,
    ['--accent-text'  as any]: color.text,
    ['--fs-base'      as any]: font.base,
    ['--fs-sm'        as any]: font.sm,
    ['--fs-xs'        as any]: font.xs,
  };

  const existingProjects = ideas.map(i => i.projectName);

  function commit({ todos: newTodos = [], ideas: newIdeas = [] }: { todos?: Todo[]; ideas?: IdeaDraft[] }) {
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

  const toggle     = (id: number | string) => setTodos(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const remove     = (id: number | string) => setTodos(p => p.filter(t => t.id !== id));
  const update     = (item: Todo)          => setTodos(p => p.map(t => t.id === item.id ? item : t));
  const updateIdea = (item: Idea)          => setIdeas(p => p.map(i => i.id === item.id ? { ...item, updatedAt: formatDate(new Date()) } : i));
  const removeIdea = (id: number | string) => setIdeas(p => p.filter(i => i.id !== id));
  const setSetting = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(p => ({ ...p, [k]: v }));

  const navItems: { key: Tab; label: string; Icon: React.FC<{ active: boolean }> }[] = [
    { key: 'memo',     label: 'メモ入力', Icon: IcoMemoNav     },
    { key: 'todo',     label: 'TODO',     Icon: IcoTodoNav     },
    { key: 'idea',     label: 'アイデア', Icon: IcoIdeaNav     },
    { key: 'settings', label: '設定',     Icon: IcoSettingsNav },
  ];

  return (
    <div className="app" style={appStyle}>
      <div className="app-header">
        <h1>SmartMemo</h1>
        <span className="tagline">AI でタスクを自動整理</span>
      </div>
      <div className="tab-content">
        {tab === 'memo'     && <MemoTab existingProjects={existingProjects} customTags={settings.customTags || []} geminiApiKey={settings.geminiApiKey || ''} onCommit={commit} />}
        {tab === 'todo'     && <TodoTab todos={todos} onToggle={toggle} onDelete={remove} onUpdate={update} soundEnabled={settings.completeSound !== false} customTags={settings.customTags || []} />}
        {tab === 'idea'     && <IdeasTab ideas={ideas} onUpdate={updateIdea} onDelete={removeIdea} customTags={settings.customTags || []} />}
        {tab === 'settings' && <SettingsTab settings={settings} onChange={setSetting} />}
      </div>
      <div className="bottom-nav">
        {navItems.map(({ key, label, Icon }) => (
          <div key={key} className={`nav-tab${tab === key ? ' active' : ''}${pulseTabs.has(key) ? ' pulse' : ''}`} onClick={() => setTab(key)}>
            <span className="nav-icon"><Icon active={tab === key} /></span>
            <span className="nav-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<SmartMemoApp />);
