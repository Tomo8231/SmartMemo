# SmartMemo — Claude 開発ルール

## ブランチ & PR ワークフロー

**新しい作業を始める前に必ず以下を実行すること:**

1. `git fetch origin main` で最新の main を取得する
2. 直前に作業していたブランチが main にマージ済みか確認する
   - `git log --oneline origin/main | head -10` で確認
   - またはそのブランチ名が main のコミット履歴に含まれているか見る
3. **マージ済みの場合**: `git checkout -b <新ブランチ名> origin/main` で最新 main から新しいブランチを切る
4. **未マージの場合**: 既存のブランチで作業を継続する

## ブランチ命名規則

セッションの開始時にシステムプロンプトで指定されたブランチ名を使う。
指定がない場合は `claude/<feature-name>` 形式で命名する。

## コミット & プッシュ

- 変更が完成したら必ずコミットしてプッシュする (`git push -u origin <branch>`)
- **実装が完了したら毎回必ず新しいプルリクエストを作成する**（ユーザーに依頼されなくても自動的に作成すること）
- 1機能・1修正 = 1ブランチ = 1PR の原則を守る

## バージョン管理

**改修するたびに内部バージョンを必ず上げること。** セマンティックバージョニング (semver) に従う:

- **patch** (`x.y.Z`): バグ修正・軽微な調整
- **minor** (`x.Y.0`): 後方互換のある機能追加
- **major** (`X.0.0`): 破壊的変更・大規模リニューアル

上げる箇所（両方を同時に更新する）:

1. [src/App.tsx](src/App.tsx) の `APP_VERSION` 定数（アプリ情報に表示される正式バージョン）
2. [package.json](package.json) の `version` フィールド

> Service Worker のキャッシュ無効化は `vite-plugin-pwa` がビルドごとに自動で行うため、手動更新は不要。

PR を出す前に、その改修内容に応じて上記を更新したか確認すること。

## 開発・ビルド

- 依存インストール: `npm install`
- 開発サーバ: `npm run dev`（スマホ実機確認は `npm run dev -- --host`）
- 本番ビルド: `npm run build`（`tsc --noEmit` 型チェック込み）
- ビルド結果のプレビュー: `npm run preview`
- Lint: `npm run lint`
- main への push で GitHub Actions が自動ビルドして GitHub Pages にデプロイする
  （[.github/workflows/deploy.yml](.github/workflows/deploy.yml)、base は `/SmartMemo/`）
