// ─────────────────────────────────────────────────────────────
// 8bit（チップチューン）サウンドエンジン
//
// 音源ファイルは一切持たず、矩形波・三角波・ノイズだけで鳴らす。
// ファミコン風の細い音にしたいので、矩形波はデューティ比を変えた
// PeriodicWave を使う（Web Audio の 'square' は 50% 固定で、
// 25% / 12.5% の「ピコピコ」した音色が作れない）。
//
// 使い方:
//   playChipSe('tap')          … 単発の効果音
//   startChipBgm('evolution')  … ループ BGM（止めるまで鳴り続ける）
//   stopChipBgm()
// ─────────────────────────────────────────────────────────────

type Wave = 'pulse12' | 'pulse25' | 'pulse50' | 'tri' | 'noise';

let _ctx: AudioContext | undefined;
let _master: GainNode | undefined;
let _seBus: GainNode | undefined;
let _bgmBus: GainNode | undefined;

// AudioContext は 1 アプリ 1 個。作れない環境（未対応ブラウザ）では null を返し、
// 呼び出し側は黙って何もしない。音が出ないだけでアプリは動くべきなので、
// ここで例外を投げてはいけない。
export function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = (window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctx) return null;
    if (!_ctx) _ctx = new Ctx();
    // モバイルはユーザー操作の外で suspended に落ちるので、鳴らす直前に起こす
    if (_ctx.state === 'suspended') void _ctx.resume();
    return _ctx;
  } catch { return null; }
}

function buses(): { ctx: AudioContext; se: GainNode; bgm: GainNode } | null {
  const ctx = getAudioCtx();
  if (!ctx) return null;
  if (!_master) {
    _master = ctx.createGain();
    _master.gain.value = 0.9;
    _master.connect(ctx.destination);
  }
  if (!_seBus) { _seBus = ctx.createGain(); _seBus.gain.value = 1; _seBus.connect(_master); }
  // BGM は効果音の下に敷くものなので、最初から控えめにしておく
  if (!_bgmBus) { _bgmBus = ctx.createGain(); _bgmBus.gain.value = BGM_LEVEL; _bgmBus.connect(_master); }
  return { ctx, se: _seBus, bgm: _bgmBus };
}

const BGM_LEVEL = 0.34;

/** MIDI ノート番号 → 周波数 */
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// デューティ比ごとの波形は作るのにコストがかかるので作り置きする
const _waveCache: Partial<Record<Wave, PeriodicWave>> = {};
const DUTY: Record<'pulse12' | 'pulse25' | 'pulse50', number> = {
  pulse12: 0.125, pulse25: 0.25, pulse50: 0.5,
};
function pulseWave(ctx: AudioContext, kind: 'pulse12' | 'pulse25' | 'pulse50'): PeriodicWave {
  const cached = _waveCache[kind];
  if (cached) return cached;
  const d = DUTY[kind];
  const N = 32;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  // パルス波の n 次倍音の振幅は 2/(nπ)·sin(nπd)
  for (let n = 1; n < N; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * d);
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  _waveCache[kind] = w;
  return w;
}

// ノイズ（打楽器・閃光用）。1 秒ぶん作っておいて、毎回そこから鳴らす
let _noiseBuf: AudioBuffer | undefined;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!_noiseBuf) {
    const len = Math.floor(ctx.sampleRate);
    _noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return _noiseBuf;
}

type ToneOpts = {
  /** MIDI ノート番号。noise のときは無視される */
  midi?: number;
  wave?: Wave;
  /** ctx.currentTime からの相対秒 */
  at: number;
  dur: number;
  gain?: number;
  /** 指定すると dur をかけてこのノートまで滑らかに上がる／下がる */
  slideTo?: number;
  /** ノイズの色（Hz）。高いほど「シャッ」、低いほど「ドン」 */
  noiseHz?: number;
};

// いま鳴らしている BGM の音源。止めるときにまとめて黙らせる
const _bgmVoices: AudioScheduledSourceNode[] = [];

function tone(ctx: AudioContext, dest: GainNode, o: ToneOpts, track?: boolean) {
  const t = ctx.currentTime + o.at;
  const g = ctx.createGain();
  const peak = o.gain ?? 0.12;
  // 8bit らしく、立ち上がりは一瞬・切れ際もスパッと落とす
  const hold = t + Math.max(0.006, o.dur * 0.7);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.setValueAtTime(peak, hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  g.connect(dest);

  let src: AudioScheduledSourceNode;
  if (o.wave === 'noise') {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = o.noiseHz ?? 4000;
    bp.Q.value = 0.8;
    n.connect(bp).connect(g);
    src = n;
  } else {
    const osc = ctx.createOscillator();
    if (o.wave === 'tri') osc.type = 'triangle';
    else osc.setPeriodicWave(pulseWave(ctx, (o.wave ?? 'pulse50') as 'pulse12' | 'pulse25' | 'pulse50'));
    osc.frequency.setValueAtTime(mtof(o.midi ?? 69), t);
    if (o.slideTo != null) osc.frequency.exponentialRampToValueAtTime(mtof(o.slideTo), t + o.dur);
    osc.connect(g);
    src = osc;
  }
  src.start(t);
  src.stop(t + o.dur + 0.02);
  if (track) {
    _bgmVoices.push(src);
    src.onended = () => {
      const i = _bgmVoices.indexOf(src);
      if (i >= 0) _bgmVoices.splice(i, 1);
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 効果音
// ─────────────────────────────────────────────────────────────
export type ChipSe =
  | 'tap'        // 起きている子をタップ：うれしそうな上昇ブリップ
  | 'tapWake'    // 寝ている子を起こす：びっくりの「ピュイッ！」
  | 'evoStart'   // 進化のはじまり：不穏な低音＋疑問符
  | 'evoFlash'   // 閃光
  | 'evoFanfare' // 進化完了のファンファーレ
  | 'evoCancel'; // やめたときのしょんぼり音

export function playChipSe(se: ChipSe) {
  const b = buses();
  if (!b) return;
  const { ctx, se: bus } = b;
  const n = (o: ToneOpts) => tone(ctx, bus, o);
  try {
    switch (se) {
      case 'tap':
        // ピコッ（C6 → G6）
        n({ midi: 84, wave: 'pulse25', at: 0,     dur: 0.045, gain: 0.14 });
        n({ midi: 91, wave: 'pulse25', at: 0.045, dur: 0.09,  gain: 0.14 });
        break;
      case 'tapWake':
        // 寝起きドッキリ。低いところから一気に駆け上がる
        n({ midi: 60, wave: 'pulse12', at: 0,    dur: 0.09, gain: 0.12, slideTo: 88 });
        n({ midi: 88, wave: 'pulse12', at: 0.10, dur: 0.06, gain: 0.12 });
        n({ midi: 93, wave: 'pulse12', at: 0.17, dur: 0.12, gain: 0.12 });
        n({ wave: 'noise', at: 0, dur: 0.05, gain: 0.05, noiseHz: 6000 });
        break;
      case 'evoStart':
        // 「おや…？」の不穏さ。低音が一発、そのあと疑問符のように上がる
        n({ midi: 33, wave: 'tri',     at: 0,    dur: 0.50, gain: 0.20 });
        n({ midi: 45, wave: 'pulse50', at: 0,    dur: 0.45, gain: 0.07 });
        n({ midi: 64, wave: 'pulse25', at: 0.50, dur: 0.12, gain: 0.10 });
        n({ midi: 68, wave: 'pulse25', at: 0.62, dur: 0.22, gain: 0.10, slideTo: 71 });
        break;
      case 'evoFlash':
        // 閃光。ノイズを上に振り切らせて、光が抜けるように減衰させる
        n({ wave: 'noise',             at: 0,    dur: 0.45, gain: 0.16, noiseHz: 9000 });
        n({ midi: 60, wave: 'pulse12', at: 0,    dur: 0.40, gain: 0.10, slideTo: 100 });
        n({ midi: 48, wave: 'tri',     at: 0.02, dur: 0.50, gain: 0.16, slideTo: 84 });
        break;
      case 'evoFanfare': {
        // おめでとうの定番。主旋律＋4度下のハモり＋ベース＋シンバル
        const lead = [67, 72, 76, 79, 84, 79, 84];
        const step = 0.095;
        lead.forEach((m, i) => {
          const dur = i === lead.length - 1 ? 0.70 : step * 0.92;
          n({ midi: m,     wave: 'pulse25', at: i * step, dur, gain: 0.15 });
          n({ midi: m - 5, wave: 'pulse50', at: i * step, dur, gain: 0.06 });
        });
        ([[0, 36], [0.19, 36], [0.38, 43], [0.57, 48]] as const).forEach(([at, m]) =>
          n({ midi: m, wave: 'tri', at, dur: 0.18, gain: 0.20 }));
        n({ midi: 48, wave: 'tri', at: 0.76, dur: 0.70, gain: 0.20 });
        n({ wave: 'noise', at: 0,    dur: 0.12, gain: 0.07, noiseHz: 7000 });
        n({ wave: 'noise', at: 0.57, dur: 0.35, gain: 0.07, noiseHz: 7000 });
        break;
      }
      case 'evoCancel':
        // しょんぼり下降
        n({ midi: 69, wave: 'pulse50', at: 0,    dur: 0.12, gain: 0.10 });
        n({ midi: 65, wave: 'pulse50', at: 0.12, dur: 0.12, gain: 0.10 });
        n({ midi: 57, wave: 'pulse50', at: 0.24, dur: 0.35, gain: 0.10, slideTo: 53 });
        break;
    }
  } catch { /* 音が出ないだけなので握りつぶす */ }
}

/**
 * 進化演出でシルエットが入れ替わるたびの「カチッ」。
 * progress（0→1）が進むほど音程を上げて、切り替わりが近いことを伝える。
 */
export function playChipMorphTick(progress: number) {
  const b = buses();
  if (!b) return;
  try {
    const midi = 72 + Math.round(Math.min(1, Math.max(0, progress)) * 14);
    tone(b.ctx, b.se, { midi, wave: 'pulse12', at: 0, dur: 0.04, gain: 0.09 });
  } catch { /* noop */ }
}

// ─────────────────────────────────────────────────────────────
// BGM
//
// 1 音ずつ setTimeout で鳴らすと端末が重いときにリズムがヨレるので、
// 一定間隔で「少し先」までまとめて予約する先読みスケジューラにする。
// 予約するのは常に LOOKAHEAD 秒ぶんだけなので、止めたときに
// 延々と鳴り続けることもない。
// ─────────────────────────────────────────────────────────────
export type ChipBgm = 'evolution';

type Step = { midi: number; wave: Wave; dur: number; gain: number };
type Pattern = {
  /** 16分音符 1 つぶんの秒数 */
  stepSec: number;
  /** ループの長さ（16分音符いくつぶん） */
  steps: number;
  /** step 番号 → そのタイミングで鳴らす音たち */
  at: (step: number) => Step[];
};

// 進化中のループ。Am → E7 の 2 小節で、じわじわ不安をあおる
const EVOLUTION: Pattern = {
  stepSec: 0.1,
  steps: 32,
  at: (s) => {
    const out: Step[] = [];
    // アルペジオ（1 小節目 Am / 2 小節目 E7）
    const arp = s < 16 ? [57, 60, 64, 69] : [56, 59, 64, 68];
    out.push({ midi: arp[s % 4], wave: 'pulse12', dur: 0.085, gain: 0.07 });
    // ベースは 2 拍ごと
    if (s % 8 === 0) out.push({ midi: s < 16 ? 45 : 40, wave: 'tri', dur: 0.30, gain: 0.16 });
    // ハイハット代わりのノイズ
    if (s % 2 === 1) out.push({ midi: 0, wave: 'noise', dur: 0.03, gain: 0.035 });
    return out;
  },
};

const PATTERNS: Record<ChipBgm, Pattern> = { evolution: EVOLUTION };

const LOOKAHEAD = 0.15;   // 何秒先まで予約するか
const TICK_MS = 25;       // スケジューラを回す間隔

let _bgmTimer: ReturnType<typeof setInterval> | undefined;
let _bgmStep = 0;
let _bgmNextAt = 0;       // 次の step を鳴らす ctx 時刻

export function startChipBgm(name: ChipBgm) {
  const b = buses();
  if (!b) return;
  if (_bgmTimer) stopChipBgm();
  const { ctx, bgm } = b;
  const pat = PATTERNS[name];
  _bgmStep = 0;
  _bgmNextAt = ctx.currentTime + 0.06;
  // 直前の stopChipBgm がフェードアウトを予約しているので、消してから戻す
  bgm.gain.cancelScheduledValues(ctx.currentTime);
  bgm.gain.setValueAtTime(BGM_LEVEL, ctx.currentTime);

  const schedule = () => {
    try {
      while (_bgmNextAt < ctx.currentTime + LOOKAHEAD) {
        const rel = Math.max(0, _bgmNextAt - ctx.currentTime);
        pat.at(_bgmStep % pat.steps).forEach(s => {
          tone(ctx, bgm, {
            midi: s.midi, wave: s.wave, at: rel,
            dur: s.dur, gain: s.gain, noiseHz: 8000,
          }, true);
        });
        _bgmNextAt += pat.stepSec;
        _bgmStep++;
      }
    } catch { stopChipBgm(); }
  };
  schedule();
  _bgmTimer = setInterval(schedule, TICK_MS);
}

export function stopChipBgm() {
  if (_bgmTimer) { clearInterval(_bgmTimer); _bgmTimer = undefined; }
  try {
    // 予約済みの音が少し先まで残っているので、フェードで畳んでから実際に止める
    if (_ctx && _bgmBus) {
      const t = _ctx.currentTime;
      _bgmBus.gain.cancelScheduledValues(t);
      _bgmBus.gain.setValueAtTime(Math.max(0.0001, _bgmBus.gain.value), t);
      _bgmBus.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    }
    _bgmVoices.splice(0).forEach(v => { try { v.stop(); } catch { /* 既に止まっている */ } });
  } catch { /* noop */ }
}
