// 主要画面を撮影し、計算後スタイルも書き出す。
//
// UI を触ったときに「見た目が変わっていないこと」を機械的に確かめる道具。
// CSS の整理のように、意図としては見た目を変えないはずの変更で使う。
//
//   npm run dev -- --port 5199          # 別ターミナルで先に起動しておく
//   npm run visual:snap before
//   （変更する）
//   npm run visual:snap after
//   npm run visual:diff before after
//
// ■ 撮影を決定論的にするための細工
// このアプリには実行ごとに絵が変わる要素が 3 つあり、そのままでは
// CSS の回帰と見分けがつかない。それぞれ以下で潰している。
//   1. メモモンの歩行アニメーション → 設定で非表示にしてから撮る
//   2. ボスミッションの日次抽選(30%)と夜空の星 26 個の配置 → Math.random を固定
//   3. 庭の空が実時刻で朝/昼/夕/夜に変わる → 時刻を固定
// これらを入れる前は、無変更で 2 回撮るだけで 6 万 px 以上の差が出ていた。
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const out = process.argv[2] || '.visual';
const tag = process.argv[3] || 'snap';
const URL = process.env.VISUAL_URL || 'http://localhost:5199/SmartMemo/';
mkdirSync(out, { recursive: true });

const PROPS = [
  'background-color', 'color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'font-size', 'font-weight', 'box-shadow', 'width', 'height',
  'align-items', 'display', 'justify-content', 'letter-spacing', 'line-height',
];
const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important}';

const browser = await chromium.launch({ channel: 'msedge' });
const styles = {};
let failed = false;

async function capture(dark) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.clock.setFixedTime(new Date('2026-08-14T10:30:00'));
  await page.addInitScript(() => {
    let s = 42;
    Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);

  // 設定はトップが一覧になり、各項目はサブページの中にある。
  // 目的のトグルまでサブページを開いて、終わったら戻る。
  const openSetting = async (menu, rowText) => {
    await page.locator('.nav-tab:has-text("設定")').first().click();
    await page.waitForTimeout(500);
    await page.locator('.settings-menu-row', { hasText: menu }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.settings-row', { hasText: rowText }).first().locator('.toggle').click();
    await page.waitForTimeout(500);
    await page.locator('.sub-back').click();
    await page.waitForTimeout(400);
  };
  await openSetting('メモモン', 'メモモンを表示する');
  if (dark) await openSetting('表示', 'ダークモード');
  await page.addStyleTag({ content: FREEZE });

  const theme = dark ? 'dark' : 'light';
  const dump = async name => {
    await page.waitForTimeout(300);
    styles[theme + '/' + name] = await page.evaluate(props =>
      [...document.querySelectorAll('.app *')].map((el, i) => {
        const cs = getComputedStyle(el);
        return i + '|' + el.tagName + '.' + el.className + '|' + props.map(k => cs.getPropertyValue(k)).join(';');
      }), PROPS);
    await page.screenshot({ path: out + '/' + tag + '-' + theme + '-' + name + '.png' });
  };

  // ナビのラベルは機能名 1 行（タスク／ナレッジ／メモ／メモモン／設定）。
  // 撮影ファイル名は画面の愛称のまま（before/after を突き合わせるため）。
  for (const [label, name] of [['タスク', 'niwa'], ['ナレッジ', 'shoko'], ['メモモン', 'zukan'], ['設定', 'settei']]) {
    await page.locator('.nav-tab:has-text("' + label + '")').first().click();
    await page.waitForTimeout(900);
    await dump(name);
  }
  await page.locator('.nav-center-memo').click(); await page.waitForTimeout(800); await dump('memo');
  await page.locator('.nav-tab:has-text("タスク")').first().click(); await page.waitForTimeout(900);
  await page.locator('.todo-item').first().click(); await page.waitForTimeout(700); await dump('edit');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.locator('.coin-badge').click(); await page.waitForTimeout(800); await dump('gacha');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  await page.locator('.trash-open-btn').click(); await page.waitForTimeout(700); await dump('trash');

  if (errors.length) { failed = true; console.error(theme + ': エラー\n  ' + errors.join('\n  ')); }
  else console.log(theme + ': 8 画面を撮影');
  await page.close();
}

await capture(false);
await capture(true);
writeFileSync(out + '/' + tag + '-styles.json', JSON.stringify(styles));
await browser.close();
console.log(out + '/' + tag + '-* に保存（要素 ' + Object.values(styles).reduce((s, a) => s + a.length, 0) + ' 件）');
process.exit(failed ? 1 : 0);
