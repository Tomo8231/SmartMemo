// メモモンのスプライトを 128x128 のキャンバスに揃える。
//
//   node scripts/resize-sprites.mjs [--check]
//
// 進化系（ev_*）は 144x156 の中身が「48x52 ドットを 3px ずつに引き伸ばしたもの」
// なので、ドット格子から作り直して 1 ドット 2px（96x104）にし、128x128 の中央に
// 置く。整数倍なので輪郭は 1 ドットも崩れない。
// 3px 格子になっていないファイルが混ざっていたら、黙って劣化させずに止める。
//
// 基本メモモン 12 体はドット格子を持たず、コマごとに切り抜きの大きさが違う。
// 表示側は昔から「コマごとに枠へ収める」挙動なので、それをそのまま保つために
// コマ単位で高さ 104 に揃えて中央に置く（面積平均で縮小する）。
//
// ガチャの卵・演出（gacha_*）はキャラではないので触らない。

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const DIR = 'public/sprites';
const SIZE = 128;
const EVO_DOT = 3;        // 変換前の 1 ドットの太さ
const EVO_NEW_DOT = 2;    // 変換後の 1 ドットの太さ
// 絵の高さの上限。進化系の 52 ドットを 2px 刻みにすると、ちょうどこの高さになる。
// 全キャラの高さをこれに揃えることで「キャンバスに対する絵の割合」が揃い、
// 表示側は 128/104 倍するだけで今までと同じ大きさに見える。
// 横は 128 まで使ってよい（横長のポーズを潰さないため）。
const ART_H = 104, ART_W = 96;
const check = process.argv.includes('--check');

const isFrame = f => /_(sit|walk|happy|dislike|sleep|surprise)_\d+\.png$/.test(f);
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png') && isFrame(f));

const blank = () => {
  const p = new PNG({ width: SIZE, height: SIZE });
  p.data.fill(0);
  return p;
};
const px = (p, x, y) => { const i = (p.width * y + x) << 2; return [p.data[i], p.data[i+1], p.data[i+2], p.data[i+3]]; };
const put = (p, x, y, c) => { const i = (p.width * y + x) << 2; p.data[i]=c[0]; p.data[i+1]=c[1]; p.data[i+2]=c[2]; p.data[i+3]=c[3]; };

// 進化系：ドット格子から作り直す
function convertEvo(src, file) {
  if (src.width % EVO_DOT || src.height % EVO_DOT) throw new Error(`${file}: ${src.width}x${src.height} は ${EVO_DOT} で割り切れない`);
  const dw = src.width / EVO_DOT, dh = src.height / EVO_DOT;
  const out = blank();
  // 上下左右とも中央。ずかんや進化演出など、正方形の枠に置く画面が多いため。
  // 余白は偶数なので、2px のドット格子は画面上でもずれない。
  const ox = Math.round((SIZE - dw * EVO_NEW_DOT) / 2);
  const oy = Math.round((SIZE - dh * EVO_NEW_DOT) / 2);
  if (dw * EVO_NEW_DOT !== ART_W || dh * EVO_NEW_DOT !== ART_H)
    throw new Error(`${file}: ${dw}x${dh} ドットは内枠 ${ART_W}x${ART_H} に一致しない`);
  for (let v = 0; v < dh; v++) for (let u = 0; u < dw; u++) {
    const c = px(src, u * EVO_DOT, v * EVO_DOT);
    // 本当に単色のブロックか確かめる（違えば引き伸ばしではないので止める）
    for (let dy = 0; dy < EVO_DOT; dy++) for (let dx = 0; dx < EVO_DOT; dx++) {
      const q = px(src, u * EVO_DOT + dx, v * EVO_DOT + dy);
      if (q[0]!==c[0]||q[1]!==c[1]||q[2]!==c[2]||q[3]!==c[3]) throw new Error(`${file}: (${u},${v}) が単色ブロックではない`);
    }
    for (let dy = 0; dy < EVO_NEW_DOT; dy++) for (let dx = 0; dx < EVO_NEW_DOT; dx++)
      put(out, ox + u * EVO_NEW_DOT + dx, oy + v * EVO_NEW_DOT + dy, c);
  }
  return { png: out, box: { x: ox, y: oy, w: dw * EVO_NEW_DOT, h: dh * EVO_NEW_DOT } };
}

// 基本メモモン：最近傍で縮小して中央に置く。
//
// 平均で縮小すると輪郭に半透明の中間色ができる。表示側は
// image-rendering:pixelated（＝最近傍）なので、その中間色がそのまま拾われて
// 輪郭がぼやける。描画まで通して最近傍で揃えたほうが、変換前の見え方に近い。
function convertBasic(src, file) {
  const s = Math.min(SIZE / src.width, ART_H / src.height);
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const out = blank();
  const ox = Math.round((SIZE - w) / 2), oy = Math.round((SIZE - h) / 2);
  for (let y = 0; y < h; y++) {
    // 元画素の中央を拾う（端に寄せると絵が片側へずれる）
    const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * src.height / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * src.width / w));
      put(out, ox + x, oy + y, px(src, sx, sy));
    }
  }
  return { png: out, box: { x: ox, y: oy, w, h } };
}

let evo = 0, basic = 0, skipped = 0;
const errors = [];
for (const file of files) {
  const full = path.join(DIR, file);
  const src = PNG.sync.read(fs.readFileSync(full));
  if (src.width === SIZE && src.height === SIZE) { skipped++; continue; }
  try {
    const { png } = file.startsWith('ev_') ? convertEvo(src, file) : convertBasic(src, file);
    if (!check) fs.writeFileSync(full, PNG.sync.write(png));
    if (file.startsWith('ev_')) evo++; else basic++;
  } catch (e) {
    errors.push(e.message);
  }
}
console.log(`進化系: ${evo} 枚 / 基本メモモン: ${basic} 枚 / すでに 128x128: ${skipped} 枚`);
if (errors.length) { console.error(`\n変換できなかったファイル ${errors.length} 件:`); errors.slice(0, 20).forEach(m => console.error('  ' + m)); process.exit(1); }
console.log(check ? '（--check なので書き込んでいない）' : '書き込み完了');
