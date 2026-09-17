// AI プロバイダ呼び出し層。API キーは利用者の端末から各社 API へ直接送る（BYOK）。

// ─────────────────────────────────────────────────────────────
// Gemini API integration
// ─────────────────────────────────────────────────────────────
export type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };

export const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// json=true では「JSON モード」で呼ぶ。自由文のまま返させると前置きや
// コードブロックが混ざって抽出に失敗し、精度の低いローカル解析へ落ちる。
async function callGemini(apiKey: string, parts: GeminiPart[], json = false): Promise<string> {
  if (!apiKey) throw new Error('no_api_key');
  // キーはクエリ文字列ではなくヘッダで渡す。URL に載せるとプロキシや
  // ブラウザの開発者ツール・エラーログなどに残りやすい。
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      ...(json ? { generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8192 } } : {}),
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Gemini ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  // 思考するモデルは parts が複数に割れることがあるので全部つなぐ
  return ((data.candidates?.[0]?.content?.parts || []) as GeminiPart[])
    .map(p => p?.text || '').join('') || '';
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
export type AiProvider = 'gemini' | 'openai' | 'anthropic';
export type AiCfg = {
  provider: AiProvider;
  geminiKey: string;
  openaiKey: string;
  anthropicKey: string;
  anthropicModel: string;
};

export const OPENAI_TEXT_MODEL = 'gpt-4o-mini';
// Claude はモデルを設定画面でテキスト指定できる。未指定時はこれをデフォルトに使う。
export const ANTHROPIC_TEXT_MODEL = 'claude-haiku-4-5';
const OPENAI_AUDIO_MODEL = 'whisper-1';

export const AI_LABEL: Record<AiProvider, string> = { gemini: 'Gemini', openai: 'GPT (OpenAI)', anthropic: 'Claude (Anthropic)' };

export function aiCfgFromSettings(s: { aiProvider?: AiProvider; geminiApiKey?: string; openaiApiKey?: string; anthropicApiKey?: string; anthropicModel?: string }): AiCfg {
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
export function aiConfigured(cfg: AiCfg): boolean {
  return !!aiActiveKey(cfg);
}
// 音声の直接文字起こしに対応するのは Gemini / OpenAI(Whisper) のみ。
export function aiAudioSupported(cfg: AiCfg): boolean {
  return (cfg.provider === 'gemini' && !!cfg.geminiKey) || (cfg.provider === 'openai' && !!cfg.openaiKey);
}

// ── OpenAI (GPT) ──
async function callOpenAIChat(key: string, content: any, json = false): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      messages: [{ role: 'user', content }],
      // 解析は毎回同じ答えが欲しいので温度 0。JSON モードで前置きを封じる。
      ...(json ? { temperature: 0, response_format: { type: 'json_object' } } : {}),
    }),
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
async function callAnthropicMessages(key: string, content: any, model?: string, json = false): Promise<string> {
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
    body: JSON.stringify({
      model: (model || '').trim() || ANTHROPIC_TEXT_MODEL,
      max_tokens: 8192,
      // json のときは "{" を先に書かせて（prefill）前置きを物理的に不可能にする
      messages: json
        ? [{ role: 'user', content }, { role: 'assistant', content: '{' }]
        : [{ role: 'user', content }],
      ...(json ? { temperature: 0 } : {}),
    }),
  });
  if (!res.ok) {
    let d = ''; try { d = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Anthropic ${res.status}${d ? ': ' + d : ''}`);
  }
  const data = await res.json();
  const text = (Array.isArray(data.content) ? data.content.map((c: any) => c?.text || '').join('') : '') || '';
  return json ? `{${text}` : text;   // prefill した "{" を戻す
}

// ── Unified entry points ──
export async function aiText(cfg: AiCfg, prompt: string): Promise<string> {
  const key = aiActiveKey(cfg);
  if (!key) throw new Error('no_api_key');
  if (cfg.provider === 'openai')    return callOpenAIChat(key, prompt);
  if (cfg.provider === 'anthropic') return callAnthropicMessages(key, [{ type: 'text', text: prompt }], cfg.anthropicModel);
  return callGeminiText(key, prompt);
}
// JSON を返させる用の入口。プロバイダごとの JSON モードを必ず通す。
export async function aiJson(cfg: AiCfg, prompt: string): Promise<string> {
  const key = aiActiveKey(cfg);
  if (!key) throw new Error('no_api_key');
  if (cfg.provider === 'openai')    return callOpenAIChat(key, prompt, true);
  if (cfg.provider === 'anthropic') return callAnthropicMessages(key, [{ type: 'text', text: prompt }], cfg.anthropicModel, true);
  return callGemini(key, [{ text: prompt }], true);
}
export async function aiVision(cfg: AiCfg, prompt: string, base64: string, mime: string): Promise<string> {
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
export async function aiAudio(cfg: AiCfg, blob: Blob, mime: string): Promise<string> {
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
