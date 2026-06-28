# Supabase 設定手順

SmartMemo にアカウント機能・クラウド同期を有効にするための初期設定。

## 1. Supabase プロジェクトを作る

1. https://supabase.com にサインアップ
2. 新規プロジェクトを作成（リージョンは Tokyo / Singapore あたりが速い）
3. プロジェクトのダッシュボード → **Project Settings → API** を開き、以下の 2 つをメモ
   - **Project URL** （`https://xxxxx.supabase.co`）
   - **anon public** キー

## 2. テーブルを作る

ダッシュボード → **SQL Editor** で [`db/schema.sql`](../db/schema.sql) の内容を貼り付けて実行。
`public.user_data` テーブルと RLS ポリシーが作成されます。

## 3. Auth プロバイダを有効化

ダッシュボード → **Authentication → Providers** で：

### Email（必須）
- すでにデフォルトで有効
- 「Confirm email」をオフにすると登録直後にログイン可能（推奨）
- オンのままにする場合はメール認証フローを通る必要あり

### Google
失敗例: ログイン時に `Unsupported provider: provider is not enabled` が出る場合は、以下の手順がまだ未完了です。

1. **Google Cloud Console で OAuth クライアントを作る**
   1. https://console.cloud.google.com/ にアクセス、プロジェクトを選択（無ければ新規作成）
   2. 左メニュー → **APIs & Services → OAuth consent screen** を開き、外部 (External) で App name を入力して保存（Testing 状態でも OK、開発中なら Test users に自分のメールを追加）
   3. **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID**
   4. Application type: **Web application**
   5. **Authorized JavaScript origins**: `https://<YOUR_PROJECT_REF>.supabase.co`
   6. **Authorized redirect URIs**: `https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback`
      （Supabase ダッシュボード → Authentication → Providers → Google を開いて表示される "Callback URL" と完全一致させること）
   7. 作成すると **Client ID** と **Client Secret** が表示されるのでコピー
2. **Supabase 側で有効化**
   1. Supabase ダッシュボード → **Authentication → Providers**
   2. **Google** を展開 → **Enable Google provider** をオン
   3. **Client ID (for OAuth)** と **Client Secret (for OAuth)** に上記の値を貼り付け
   4. **Save**
3. アプリで Google ログインボタンを押すと、Google のログイン画面 → 承認 → アプリへ戻ってくる流れになる。

## 4. アプリ側の環境変数

### ローカル開発
プロジェクトのルートに `.env.local` を置く：

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### 本番（GitHub Pages デプロイ）
GitHub のリポジトリ → **Settings → Secrets and variables → Actions** で 2 つの Secret を追加：

| Secret 名 | 値 |
|---|---|
| `SUPABASE_URL` | 上記の Project URL |
| `SUPABASE_ANON_KEY` | 上記の anon public キー |

`.github/workflows/deploy.yml` のビルドステップで `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` として環境変数に注入されます。

## 5. アプリで確認

設定タブ → 「アカウント」セクションが表示されたら準備完了。

初回ログインの挙動：
- **サーバーに自分のデータが無いとき**: 端末の `localStorage` の内容をアップロード
- **サーバーに既にデータがあるとき**: サーバーの内容で端末を上書き（メールで確認）

ログイン後は変更があるたびに 5 秒のデバウンスでサーバーへ自動アップロード。設定タブから「今すぐアップロード」「サーバーから取得」を手動で実行することもできます。

## セキュリティ

- `anon key` はクライアント側で公開されても安全な公開鍵です
- 各テーブルの行アクセスは RLS で `auth.uid() = user_id` に制限されているため、他人のデータは見えません
- **`service_role` キーは絶対にクライアントに置かないこと**
