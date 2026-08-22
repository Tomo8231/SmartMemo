// visual-snapshot.mjs が出力した 2 つのスナップショットを比較する。
// 計算後スタイル（要素単位）とスクリーンショット（ピクセル単位）の両方を見る。
// 見た目を変えないはずの変更なら、どちらも 0 になるのが期待値。
//
//   npm run visual:diff before after
//
// 差分が出たときは、まず「無変更で 2 回撮って比較」する対照実験をすること。
// アプリ側の非決定要素が残っていると、変更していなくても差分が出る。
import { readFileSync, existsSync } from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const dir = process.argv[2] || '.visual';
const a = process.argv[3] || 'before';
const b = process.argv[4] || 'after';
const A = JSON.parse(readFileSync(dir + '/' + a + '-styles.json', 'utf8'));
const B = JSON.parse(readFileSync(dir + '/' + b + '-styles.json', 'utf8'));

let styleDiff = 0, shown = 0;
for (const key of Object.keys(A)) {
  const x = A[key], y = B[key] || [];
  if (x.length !== y.length) {
    console.log('  ' + key + ': 要素数が違う ' + x.length + ' → ' + y.length);
    styleDiff++;
    continue;
  }
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    styleDiff++;
    if (shown++ < 10) {
      const tag = x[i].split('|')[1];
      const pa = x[i].split('|')[2].split(';');
      const pb = y[i].split('|')[2].split(';');
      const changed = pa.map((v, j) => v !== pb[j] ? '[' + j + '] ' + v + ' → ' + pb[j] : null).filter(Boolean);
      console.log('  ' + key + ' ' + tag + ': ' + changed.join(', '));
    }
  }
}
console.log('スタイル差分のある要素: ' + styleDiff);

let pixels = 0;
for (const theme of ['light', 'dark']) {
  for (const screen of ['niwa', 'shoko', 'zukan', 'settei', 'memo', 'edit', 'gacha', 'trash']) {
    const f1 = dir + '/' + a + '-' + theme + '-' + screen + '.png';
    const f2 = dir + '/' + b + '-' + theme + '-' + screen + '.png';
    if (!existsSync(f1) || !existsSync(f2)) continue;
    const i1 = PNG.sync.read(readFileSync(f1));
    const i2 = PNG.sync.read(readFileSync(f2));
    if (i1.width !== i2.width || i1.height !== i2.height) { console.log('  ' + theme + '/' + screen + ': サイズ違い'); continue; }
    const n = pixelmatch(i1.data, i2.data, null, i1.width, i1.height, { threshold: 0.1 });
    pixels += n;
    if (n) console.log('  ' + theme + '/' + screen.padEnd(6) + ' ' + String(n).padStart(8) + ' px');
  }
}
console.log('ピクセル差分 合計: ' + pixels + ' px');
process.exit(styleDiff || pixels ? 1 : 0);
