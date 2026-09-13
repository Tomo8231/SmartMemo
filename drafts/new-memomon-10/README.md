# 新メモモン 10 体（保留中）

見た目がかわいくなかったため、v1.44.1 でアプリから外して保管しているもの。
`public/` の外に置いているので、ビルドにもデプロイにも含まれない。

| id | 名前 | 略号 | レア度 |
|---|---|---|---|
| yofukashi | ヨフカシ | yk | スーパー |
| noronoron | のろのろん | nr | スーパー |
| takoashi | タコアシ | tk | スーパー |
| tomepin | とめピン | tp | スーパー |
| damtsumi | ダムつみ | dm | スーパー |
| atomawashi | あとまわし | at | スーパー |
| wasurekujira | ワスレクジラ | wk | ウルトラ |
| fukkatsudori | フッカツドリ | fk | ウルトラ |
| haniwan | ハニワン | hn | ウルトラ |
| tsukimimochi | つきみもち | tm | ウルトラ |

## 中身

- `sprites/` — スプライト 360 枚（`<略号>_<状態>_<コマ>.png`、144x156）
- `items/` — なつき MAX のおくりもの 10 枚（160x160）
- `removed-code.tsx.txt` — `src/App.tsx` から外したコード（スプライト定数・メモモン定義・ガチャの景品・好き嫌い・おくりもの・セリフ・反応）
- `generator/memomon_gen.py` — 画像を生成した Python スクリプト（Pillow と numpy が必要。`python memomon_gen.py` で `new_memomon/` に出力）

## 戻すとき

1. `sprites/` を `public/sprites/`、`items/` を `public/items/` に移す
2. `removed-code.tsx.txt` の各ブロックを、`src/App.tsx` の同じ名前の定数の末尾に貼り直す
3. バージョンを上げてビルドする

一度手に入れた利用者の端末にはデータが残っている。外している間は、定義にない id として図鑑やメモモン画面から見えなくなるだけで、戻せばそのまま表示される。
