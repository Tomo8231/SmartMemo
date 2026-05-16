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

- React 18 (UMD) + TypeScript (Babel Standalone)
- Service Worker (PWA / stale-while-revalidate)
- Claude AI API (メモ解析・TODO生成)
- ビルドステップなし（シングルファイル構成）
