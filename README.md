# SmartMemo

スマートメモ（SmartMemo）は、AIを活用したメモ・TODO管理PWAアプリです。メモを書くだけでTODOが自動生成され、かわいいMemoMonと一緒に毎日のタスクをゲーム感覚で管理できます。

## 主な機能

- **AIメモ解析**: メモの内容をAIが解析し、TODOを自動生成・難易度判定
- **コイン報酬システム**: TODOを完了するとコインを獲得（10〜200コイン）
- **ガチャシステム**: コインを使ってMemoMonのガチャを引ける豪華な演出付き
- **MemoMon**: 5種類のキャラクター（クロネコ・スライム・スカルロン・ひよこ・おばけ）がスプライトアニメーションで活動
- **タグ管理**: TODO・メモへのタグ付けとフィルタリング
- **PWA対応**: オフライン動作・ホーム画面追加に対応

## 仕様書

詳細な仕様については [docs/spec.md](./docs/spec.md) を参照してください。

## 技術スタック

- **React 18 + TypeScript**
- **Vite** によるビルド（開発: HMR / 本番: production ビルド）
- **vite-plugin-pwa**（Workbox）による PWA / オフライン対応
- **Gemini API**（任意・メモ解析・TODO 生成）/ ローカル解析フォールバック
- **GitHub Actions → GitHub Pages** で自動デプロイ

## 起動（Windows）

`start.bat` をダブルクリックすると、必要なら依存をインストールしたうえで
開発サーバを起動し、ブラウザが自動で開きます。

| 実行 | 内容 |
| --- | --- |
| `start.bat` | この PC のブラウザで開く |
| `start.bat host` | 同じ Wi-Fi のスマホからも開けるようにする |

> `start.bat` は cmd の都合で Shift-JIS (CP932) + CRLF で保存しています。
> 編集するときは文字コードを変えないでください（UTF-8 にすると日本語の行が途中で切れます）。

## 開発

```bash
npm install        # 依存をインストール
npm run dev        # 開発サーバ（HMR）。実機確認は npm run dev -- --host
npm run build      # 型チェック + 本番ビルド（dist/ に出力）
npm run preview    # ビルド結果をローカル確認
npm run lint       # ESLint
```

## フォルダ構成

```
src/
  main.tsx     エントリポイント（createRoot）
  App.tsx      アプリ本体（コンポーネント群）
  index.css    スタイル
public/        sprites/・icon.svg など静的アセット
index.html     Vite エントリ HTML
vite.config.ts ビルド・PWA・base 設定
```
