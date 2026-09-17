// docs/memomon-characters.md を src から再生成する。
//
// メモモンのセリフ・性格はソースの定数に散らばっていて手で書き写すと取りこぼすため、
// 定数を機械的に抽出して Markdown に起こす。セリフを足したり直したりしたら実行する。
//
//   node scripts/gen-memomon-doc.mjs
//
// 抽出元:
//   src/memomonEvo.ts … EVO_LINES / EVO_REACTIONS / EVO_TIP / EVO_TASKS_TO_EVOLVE
//   src/App.tsx       … MEMOMON_DEFS / MEMOMON_LINES / MEMOMON_REACTIONS /
//                       MEMOMON_FOOD_PREFS / MEMOMON_ITEMS / FOODS /
//                       MON_REQUEST_INFO / CHEER_LINES_TASK / GACHA_ITEMS の生態文
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = require(path.join(ROOT, 'node_modules/typescript'));

const app = fs.readFileSync(`${ROOT}/src/App.tsx`, 'utf8');
const evoSrc = fs.readFileSync(`${ROOT}/src/memomonEvo.ts`, 'utf8');

// ── 汎用: `const NAME ... = <literal>;` の literal を括弧対応で切り出す ──
function literalOf(src, name) {
  const decl = src.indexOf(`const ${name}`);
  if (decl < 0) throw new Error(`not found: ${name}`);
  const eq = src.indexOf('=', decl);
  let i = eq + 1;
  while (/\s/.test(src[i])) i++;
  const open = src[i];
  const close = open === '[' ? ']' : '}';
  if (open !== '[' && open !== '{') throw new Error(`not a literal: ${name}`);
  let depth = 0, inStr = null, esc = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`unbalanced: ${name}`);
}

function evalTs(code) {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
}

// ── memomonEvo.ts（そのまま評価できる）──
const evo = evalTs(evoSrc);
const { EVO_LINES, EVO_REACTIONS, EVO_TIP, EVO_TASKS_TO_EVOLVE } = evo;

// ── App.tsx から必要な定数だけ抜き出して評価 ──
const defsLit = literalOf(app, 'MEMOMON_DEFS').replace(/sprites:\s*\w+,/g, ''); // スプライト参照は落とす
const pick = (name) => literalOf(app, name);
const extracted = evalTs([
  `const MEMOMON_DEFS = ${defsLit};`,
  `const MEMOMON_FOOD_PREFS = ${pick('MEMOMON_FOOD_PREFS')};`,
  `const MEMOMON_ITEMS = ${pick('MEMOMON_ITEMS')};`,
  `const FOODS = ${pick('FOODS')};`,
  `const MEMOMON_LINES = ${pick('MEMOMON_LINES')};`,
  `const MEMOMON_REACTIONS = ${pick('MEMOMON_REACTIONS')};`,
  `const MON_REQUEST_INFO = ${pick('MON_REQUEST_INFO')};`,
  `const CHEER_LINES_TASK = ${pick('CHEER_LINES_TASK')};`,
  'module.exports = { MEMOMON_DEFS, MEMOMON_FOOD_PREFS, MEMOMON_ITEMS, FOODS, MEMOMON_LINES, MEMOMON_REACTIONS, MON_REQUEST_INFO, CHEER_LINES_TASK };',
].join('\n'));

const { MEMOMON_DEFS, MEMOMON_FOOD_PREFS, MEMOMON_ITEMS, FOODS,
        MEMOMON_LINES, MEMOMON_REACTIONS, MON_REQUEST_INFO, CHEER_LINES_TASK } = extracted;

// ── ガチャの「生態」フレーバー（基本メモモンのみ。進化系は EVO_LINES.flavor）──
const gachaFlavor = {};
for (const m of app.matchAll(/\{\s*type:\s*'memomon',[^\n]*?monDefId:\s*'(\w+)',[^\n]*?flavor:\s*'((?:[^'\\]|\\.)*)'/g)) {
  gachaFlavor[m[1]] = m[2].replace(/\\'/g, "'");
}
// ガチャ排出テーブル（基本メモモンの weight / rarity）
const gachaMeta = {};
for (const m of app.matchAll(/\{\s*type:\s*'memomon',[^\n]*?rarity:\s*'(\w+)',[^\n]*?monDefId:\s*'(\w+)',\s*weight:\s*(\d+)/g)) {
  gachaMeta[m[2]] = { rarity: m[1], weight: Number(m[3]) };
}

const foodName = Object.fromEntries(FOODS.map(f => [f.id, `${f.emoji} ${f.name}`]));
const itemByDef = Object.fromEntries(MEMOMON_ITEMS.map(i => [i.defId, i]));
const RARITY_JA = { ultra: 'ウルトラ', super: 'スーパー', rare: 'レア', common: 'ノーマル' };
const STARS = { ultra: '★★★★★', super: '★★★★', rare: '★★★', common: '★★' };

const listF = (ids) => (ids && ids.length ? ids.map(i => foodName[i] || i).join(' / ') : '—');
const quote = (arr) => (arr && arr.length ? arr.map(s => `「${s}」`).join('　') : '—');

const out = [];
const P = (s = '') => out.push(s);

const evoStageCount = EVO_LINES.length * 3;
const today = new Date().toISOString().slice(0, 10);

P('# メモモン 性格・セリフ資料');
P();
P('SmartMemo に登場するメモモンの**性格づけとセリフ**を、ソースから抽出してまとめた資料です。');
P();
P('| 項目 | 内容 |');
P('|---|---|');
P(`| 抽出日 | ${today} |`);
P(`| 抽出元 | \`src/App.tsx\` / \`src/memomonEvo.ts\` |`);
P(`| 基本メモモン | ${MEMOMON_DEFS.length} 体 |`);
P(`| 進化系メモモン | ${EVO_LINES.length} 系統 × 3 段階 = ${evoStageCount} 体 |`);
P(`| 合計 | ${MEMOMON_DEFS.length + evoStageCount} 体 |`);
P();
P('> **この資料は自動生成です。直接編集しないでください。**');
P('> セリフや設定を変えたら `npm run gen:memomon-doc`（= `node scripts/gen-memomon-doc.mjs`）で作り直してください。');
P();
P('---');
P();

// ── 共通の仕組み ──
P('## 1. 共通の仕組み');
P();
P('### 1.1 性格（`personality`）');
P();
P('各個体は `active`（活発）か `lazy`（のんびり）のどちらかを**ランダムに1つ**持ちます（`MemoMonInstance.activity`）。');
P('にわを歩き回る動きだけに影響し、セリフの内容は変わりません。');
P();
P('| パラメータ | active（活発） | lazy（のんびり） |');
P('|---|---|---|');
P('| 移動速度 | 45 | 18 |');
P('| 上下のブレ幅 | 18 | 8 |');
P('| 立ち止まる確率 | 45% | 75% |');
P('| 歩く時間 | 1500〜3500ms | 600〜1600ms |');
P('| 止まる時間 | 1500〜3500ms | 3000〜8000ms |');
P();
P('つまり **active はよく動き回り、lazy はほとんど座っている** という違いになります。');
P();

P('### 1.2 なつき度レベル');
P();
P('| なつき度 | 呼び名 | 星 |');
P('|---|---|---|');
P('| 90〜100 | 心の友 | ★★★★★ |');
P('| 70〜89 | なかよし | ★★★★ |');
P('| 40〜69 | 打ち解けた | ★★★ |');
P('| 15〜39 | 挨拶仲間 | ★★ |');
P('| 0〜14 | おはつ | ★ |');
P();
P('なつき度は**時間経過では減りません**（にわに出していない間も維持されます）。');
P();

P('### 1.3 セリフが出る場面');
P();
P('| 場面 | 使うセリフ | 出どころ |');
P('|---|---|---|');
P('| にわでタップ | 雑談 70% / 豆知識 30% | `MEMOMON_LINES[id].chat` / `.tip` |');
P('| なでる | なでた反応 | `MEMOMON_REACTIONS[id].pet` |');
P('| 好物をあげる | 大好物の反応 | `.feedFav` |');
P('| ふつうの餌をあげる | ふつうの反応 | `.feedNormal` |');
P('| 嫌いな餌をあげる | 嫌がる反応 | `.feedDis` |');
P('| タスク完了 | 汎用の喜び | `CHEER_LINES_TASK` |');
P('| おねだり | 要求ラベル | `MON_REQUEST_INFO` |');
P();

P('### 1.4 タスク完了時の汎用セリフ');
P();
P('メモモン別の台詞が用意されていない場面（タスク完了など）で使う共通プールです。');
P();
P(quote(CHEER_LINES_TASK));
P();

P('### 1.5 おねだり');
P();
P('にわのメモモンは、前回応えてから **20 分**経つとおねだりをします。応えると **なつき度 +3 / コイン +5**。');
P('満腹度が 40 未満のときは 70% の確率で「ごはん」が選ばれます。');
P();
P('| 種類 | 表示 | 応えたとき |');
P('|---|---|---|');
for (const [k, v] of Object.entries(MON_REQUEST_INFO)) {
  P(`| \`${k}\` | ${v.emoji} ${v.label} | ${v.done} |`);
}
P();
P('- **ごはん** … 餌えらびが開き、選んだ餌の好き嫌いに応じた反応セリフが出ます（満腹度 +25）');
P('- **トイレ / あそび** … タップ一回で応え、`pet` の反応セリフが出ます');
P();

P('### 1.6 餌と好みの判定');
P();
P('| 餌 | グレード | コスト |');
P('|---|---|---|');
for (const f of FOODS) P(`| ${f.emoji} ${f.name} | ${'★'.repeat(f.grade)} | ${f.cost} |`);
P();
P('好みによって、なつき度と満腹度の増減が変わります（`computeFeedingEffect`）。');
P();
P('| 判定 | なつき度 | 満腹度 |');
P('|---|---|---|');
P('| 好物 | +10 + グレード×3 | +30 + グレード×10 |');
P('| ふつう | +2 + グレード | +20 + グレード×8 |');
P('| 嫌い | **-3** | +10 |');
P();
P('なつき度が MAX のときに「なでる」「好物をあげる」と、確率でおくりもの（各メモモン固有アイテム）や背景・サウンドが手に入ります。');
P();

P('### 1.7 進化');
P();
P(`進化系は **なつき度 MAX の子をにわに出したままタスクを完了**すると進化に近づきます。`);
P(`1→2 段階目に **${EVO_TASKS_TO_EVOLVE[1]} タスク**、2→3 段階目に **${EVO_TASKS_TO_EVOLVE[2]} タスク**。`);
P();
P('ガチャに出るのは **1 段階目だけ**で、2・3 段階目は進化でしか出会えません。段階が上がるとレア度も上がります（レア → スーパー → ウルトラ）。');
P();
P('進化系はまだ 1・2 段階目のとき、豆知識に次の一文が加わります。');
P();
P(`> 「${EVO_TIP}」`);
P();
P('---');
P();

// ── 基本メモモン ──
P(`## 2. 基本メモモン（${MEMOMON_DEFS.length} 体）`);
P();
P('それぞれ固有の雑談・豆知識・4 種類の反応セリフを持ちます。');
P();
P('### 一覧');
P();
P('| # | 名前 | ID | レア度 | 好物 | 嫌いな物 | 入手 |');
P('|---|---|---|---|---|---|---|');
MEMOMON_DEFS.forEach((d, i) => {
  const pref = MEMOMON_FOOD_PREFS[d.id] || {};
  const g = gachaMeta[d.id];
  const how = d.id === 'kuroneko' ? '最初からいる' : (g ? `ガチャ（weight ${g.weight}）` : 'ガチャ');
  P(`| ${i + 1} | ${d.name} | \`${d.id}\` | ${RARITY_JA[d.rarity] || d.rarity} ${STARS[d.rarity] || ''} | ${listF(pref.fav)} | ${listF(pref.dis)} | ${how} |`);
});
P();

MEMOMON_DEFS.forEach((d, i) => {
  const pref = MEMOMON_FOOD_PREFS[d.id] || {};
  const lines = MEMOMON_LINES[d.id] || { chat: [], tip: [] };
  const re = MEMOMON_REACTIONS[d.id] || {};
  const item = itemByDef[d.id];
  P(`### 2.${i + 1} ${d.name}　\`${d.id}\``);
  P();
  P(`**レア度**: ${RARITY_JA[d.rarity] || d.rarity} ${STARS[d.rarity] || ''}　／　**好物**: ${listF(pref.fav)}　／　**嫌いな物**: ${listF(pref.dis)}`);
  P();
  P('**キャラクター設定**');
  P();
  P(`> ${d.desc}`);
  P();
  if (gachaFlavor[d.id]) {
    P('**生態（ずかん / ガチャの説明）**');
    P();
    P(`> ${gachaFlavor[d.id]}`);
    P();
  }
  P('**雑談セリフ**（にわでタップしたとき・70%）');
  P();
  lines.chat.forEach(s => P(`- ${s}`));
  P();
  P('**豆知識セリフ**（にわでタップしたとき・30%）');
  P();
  lines.tip.forEach(s => P(`- ${s}`));
  P();
  P('**反応セリフ**');
  P();
  P('| 場面 | セリフ |');
  P('|---|---|');
  P(`| なでる | ${quote(re.pet)} |`);
  P(`| 好物 | ${quote(re.feedFav)} |`);
  P(`| ふつうの餌 | ${quote(re.feedNormal)} |`);
  P(`| 嫌いな餌 | ${quote(re.feedDis)} |`);
  P();
  if (item) {
    P(`**おくりもの**: ${item.name}`);
    P();
    P(`> ${item.comment}`);
    P();
  }
});

P('---');
P();

// ── 進化系 ──
P(`## 3. 進化系メモモン（${EVO_LINES.length} 系統 / ${evoStageCount} 体）`);
P();
P('進化系は**系統ごと**に性格・セリフを持ちます。3 段階すべてで雑談・豆知識・反応セリフは**共通**で、');
P('段階ごとに違うのは **名前・見た目・説明文・レア度**です。');
P();
P('### 3.0 進化系の共通反応セリフ');
P();
P(`系統別の反応セリフは用意されておらず、**全 ${EVO_LINES.length} 系統・${evoStageCount} 体が同じ反応**を使います（\`EVO_REACTIONS\`）。`);
P();
P('| 場面 | セリフ |');
P('|---|---|');
P(`| なでる | ${quote(EVO_REACTIONS.pet)} |`);
P(`| 好物 | ${quote(EVO_REACTIONS.feedFav)} |`);
P(`| ふつうの餌 | ${quote(EVO_REACTIONS.feedNormal)} |`);
P(`| 嫌いな餌 | ${quote(EVO_REACTIONS.feedDis)} |`);
P();

P('### 一覧');
P();
P('| # | 系統 | 1段階目 | 2段階目 | 3段階目 | 好物 | 嫌いな物 |');
P('|---|---|---|---|---|---|---|');
EVO_LINES.forEach((l, i) => {
  P(`| ${i + 1} | ${l.emoji} \`${l.key}\` | ${l.stages[0].name} | ${l.stages[1].name} | ${l.stages[2].name} | ${listF(l.fav)} | ${listF(l.dis)} |`);
});
P();

EVO_LINES.forEach((l, i) => {
  P(`### 3.${i + 1} ${l.emoji} ${l.stages[0].name} 系統　\`${l.key}\``);
  P();
  P(`**好物**: ${listF(l.fav)}　／　**嫌いな物**: ${listF(l.dis)}`);
  P();
  P('**生態（ずかん / ガチャの説明）**');
  P();
  P(`> ${l.flavor}`);
  P();
  P('**各段階**');
  P();
  P('| 段階 | 名前 | ID | レア度 | 説明 |');
  P('|---|---|---|---|---|');
  const rar = ['レア ★★★', 'スーパー ★★★★', 'ウルトラ ★★★★★'];
  l.stages.forEach((s, k) => {
    P(`| ${k + 1} | ${s.name} | \`${s.id}\` | ${rar[k]} | ${s.desc} |`);
  });
  P();
  P('**雑談セリフ**（3 段階共通）');
  P();
  l.chat.forEach(s => P(`- ${s}`));
  P();
  P('**豆知識セリフ**（3 段階共通）');
  P();
  l.tip.forEach(s => P(`- ${s}`));
  P(`- ${EVO_TIP} ※1・2 段階目のみ`);
  P();
});

P('---');
P();

// ── 統計 ──
P('## 4. セリフ数の内訳');
P();
const baseChat = MEMOMON_DEFS.reduce((n, d) => n + (MEMOMON_LINES[d.id]?.chat.length || 0), 0);
const baseTip = MEMOMON_DEFS.reduce((n, d) => n + (MEMOMON_LINES[d.id]?.tip.length || 0), 0);
const baseReact = MEMOMON_DEFS.reduce((n, d) => {
  const r = MEMOMON_REACTIONS[d.id] || {};
  return n + ['pet', 'feedFav', 'feedNormal', 'feedDis'].reduce((m, k) => m + (r[k]?.length || 0), 0);
}, 0);
const evoChat = EVO_LINES.reduce((n, l) => n + l.chat.length, 0);
const evoTip = EVO_LINES.reduce((n, l) => n + l.tip.length, 0);
const evoReact = Object.values(EVO_REACTIONS).reduce((n, a) => n + a.length, 0);
P('| 区分 | 雑談 | 豆知識 | 反応 | 備考 |');
P('|---|---|---|---|---|');
P(`| 基本メモモン ${MEMOMON_DEFS.length} 体 | ${baseChat} | ${baseTip} | ${baseReact} | 1 体ずつ固有 |`);
P(`| 進化系 ${EVO_LINES.length} 系統 | ${evoChat} | ${evoTip} | ${evoReact} | 系統で共通、反応は全系統で共通 |`);
P(`| 汎用（タスク完了） | — | — | ${CHEER_LINES_TASK.length} | 全メモモン共通 |`);
P();
P(`ユニークなセリフの総数は **${baseChat + baseTip + baseReact + evoChat + evoTip + evoReact + CHEER_LINES_TASK.length} 個**です。`);
P();
P('### 気づいた点');
P();
P(`- 進化系 ${evoStageCount} 体は**反応セリフが全員同じ**（\`EVO_REACTIONS\` 1 組）なので、なでたり餌をあげたときの個性は出ません。系統ごとの反応を足すと差が出せます。`);
const withItem = MEMOMON_DEFS.filter(d => itemByDef[d.id]).length;
const noItem = MEMOMON_DEFS.filter(d => !itemByDef[d.id]).map(d => d.name);
P(`- おくりものが設定されているのは基本メモモン ${withItem}/${MEMOMON_DEFS.length} 体${noItem.length ? `（未設定: ${noItem.join('、')}）` : ''}で、**進化系 ${evoStageCount} 体には設定がありません**。`);
P('- 雑談・豆知識は進化しても変わらないため、3 段階目でも 1 段階目と同じことを話します。');
P();

fs.writeFileSync(`${ROOT}/docs/memomon-characters.md`, out.join('\n'));
console.log('生成しました: docs/memomon-characters.md');
console.log(`基本 ${MEMOMON_DEFS.length} 体 / 進化系 ${EVO_LINES.length} 系統 ${evoStageCount} 体`);
console.log(`ユニークセリフ ${baseChat + baseTip + baseReact + evoChat + evoTip + evoReact + CHEER_LINES_TASK.length} 個`);
