#!/usr/bin/env bash
# Codex に、手足のポーズ画像を 5 体ずつ描かせる。3 本並行。すでに 2 枚ともある id は飛ばす（再実行で続きから）。
# usage: bash run_limb_batches.sh [並行数=3] [1 回あたりの体数=5]
set -u
WORKERS=${1:-3}
BATCH=${2:-5}
# スクリプトの置き場所から drafts/new-memomon-10 を割り出す（環境ごとの絶対パスを持たない）
D=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# ログの置き場所。LIMB_LOGS で差し替えられる
LOGS=${LIMB_LOGS:-"${TMPDIR:-/tmp}/limb_logs"}
# Codex CLI。拡張のバージョンは変わるので、入っているうちで一番新しいものを使う
BIN=$(ls -d /c/Users/tomoy/.vscode/extensions/openai.chatgpt-*/bin/windows-x86_64/codex.exe 2>/dev/null | sort -V | tail -1)
[ -x "$BIN" ] || { echo "codex.exe が見つかりません" >&2; exit 1; }
mkdir -p "$LOGS" "$D/limb_frames"
export PYTHONIOENCODING=utf-8

# 全 102 体の id（系統の並び順 x 段階）
IDS=$(cd "$D/generator" && python -c "
from extract_base import LINES
print(' '.join(f'{k}{s}' for k, _, _ in LINES for s in (1, 2, 3)))")

todo() {  # 2 枚そろっていない id だけを返す
  for id in "$@"; do
    [ -f "$D/limb_frames/${id}_walk.png" ] && [ -f "$D/limb_frames/${id}_actions.png" ] || echo "$id"
  done
}

worker() {
  local w=$1; shift
  local queue=("$@")
  local i=0
  while [ $i -lt ${#queue[@]} ]; do
    local chunk=("${queue[@]:$i:$BATCH}")
    i=$((i + BATCH))
    local rest
    rest=$(todo "${chunk[@]}")
    [ -z "$rest" ] && continue
    local imgs=()
    local list=""
    for id in $rest; do
      imgs+=(-i "$D/generator/base_cut/${id%?}_${id: -1}.png")
      list="$list $id"
    done
    local log="$LOGS/w${w}_$(echo $list | tr ' ' '_').log"
    echo "[worker $w] start:$list" >> "$LOGS/progress.log"
    "$BIN" exec -c model_reasoning_effort="medium" --enable image_generation -C "$D" -s workspace-write "${imgs[@]}" -- \
"このフォルダの CODEX_LIMB_TASK_ALL.md を読み、その依頼を実行してください。ファイルは UTF-8 です。PowerShell で読むときは Get-Content -Encoding UTF8 を使ってください。
担当する id:${list}
添付した画像は、上の id の順に並んだ参照画像です（generator/base_cut/<系統>_<段階>.png）。見た目・向き・画風を必ず参照画像にそろえてください。
試作の limb_frames/shironeko1_walk.png と limb_frames/shironeko1_actions.png と同じ形式にしてください（歩きは 3 列 x 2 行、ポーズは 2 列 x 2 行、背景は真っ黒一色、白い細いフチ）。
すでに limb_frames/<id>_walk.png と limb_frames/<id>_actions.png の両方がある id は作り直さないでください。
git の操作はしないでください。変更は limb_frames/ の中の担当 id のファイルだけにしてください。最後に作った画像と、うまくいかなかった id を日本語で短く報告してください。" < /dev/null > "$log" 2>&1
    echo "[worker $w] done:$list (exit $?)" >> "$LOGS/progress.log"
  done
}

# 残っている id を並行数で振り分ける（系統が偏らないよう順番に配る）
REMAIN=($(todo $IDS))
echo "$(date '+%H:%M:%S') remaining ${#REMAIN[@]}" >> "$LOGS/progress.log"
for w in $(seq 0 $((WORKERS - 1))); do
  q=()
  for k in "${!REMAIN[@]}"; do
    [ $((k % WORKERS)) -eq $w ] && q+=("${REMAIN[$k]}")
  done
  worker "$w" "${q[@]}" &
done
wait
echo "$(date '+%H:%M:%S') all workers finished. remaining: $(todo $IDS | wc -l)" >> "$LOGS/progress.log"
