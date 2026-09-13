"""Codex が描いた手足のポーズ（limb_frames/）から、進化メモモン全員分のスプライトを作る。
試作用の limb_pilot.py を全員分に広げたもの。組み立て方は limb_pilot.py と同じ。
  - 2 枚（<id>_walk.png と <id>_actions.png）がそろった id だけを作り直す。そろっていない id は今のスプライトのまま
  - シートからマス目の数どおりに切り出せない id は飛ばして報告する
usage: python limb_build.py [id ...]    （id を省くと全員）
出力: public/sprites/ev_<id>_<状態>_<コマ>.png
      ../limb_preview/overview_<n>.png  （確認用: 1 行 = 1 体。座る・歩き 2 コマ・4 ポーズ）
      ../limb_preview/<id>_<状態>.gif
"""
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
from memomon_gen import W, H, S, ANIMS
from extract_base import LINES, bands
import limb_pilot as lp

HERE = os.path.dirname(os.path.abspath(__file__))


def grid_ok(path, rows, cols):
    """シートの帯を数えて、マス目の数どおりに並んでいるかを返す"""
    img = Image.open(path).convert('RGB')
    fg = np.array(img).max(-1) > 45
    return len(bands(fg.sum(1))) == rows and len(bands(fg.sum(0))) == cols


def main():
    ids = sys.argv[1:] or [f'{k}{s}' for k, _, _ in LINES for s in (1, 2, 3)]
    os.makedirs(lp.PREVIEW, exist_ok=True)
    built, missing, bad = [], [], []
    rows_img = []
    for cid in ids:
        walk_p = os.path.join(lp.LIMB, f'{cid}_walk.png')
        act_p = os.path.join(lp.LIMB, f'{cid}_actions.png')
        if not (os.path.exists(walk_p) and os.path.exists(act_p)):
            missing.append(cid)
            continue
        problems = []
        if not grid_ok(walk_p, 2, 3):
            problems.append('walk のマス目')
        if not grid_ok(act_p, 2, 2):
            problems.append('actions のマス目')
        if problems:
            bad.append(f'{cid}（{" / ".join(problems)}）')
            continue
        frames, _, _ = lp.build(cid)
        built.append(cid)
        bg = (246, 244, 240, 255)
        for anim in ANIMS:
            gif = []
            for i in range(6):
                tile = Image.new('RGBA', (W, H), bg)
                tile.alpha_composite(frames[(anim, i)])
                gif.append(tile.resize((W * 3, H * 3), Image.NEAREST).convert('RGB'))
            gif[0].save(os.path.join(lp.PREVIEW, f'{cid}_{anim}.gif'), save_all=True, append_images=gif[1:],
                        duration=round(1000 / lp.FPS[anim]), loop=0)
        picks = [('sit', 0), ('walk', 0), ('walk', 3), ('happy', 2), ('dislike', 1), ('sleep', 2), ('surprise', 1)]
        row = Image.new('RGBA', (W * 2 * len(picks) + 90, H * 2), bg)
        ImageDraw.Draw(row).text((4, 4), cid, fill=(60, 60, 60, 255))
        for k, key in enumerate(picks):
            tile = Image.new('RGBA', (W, H), bg)
            tile.alpha_composite(frames[key])
            row.alpha_composite(tile.resize((W * 2, H * 2), Image.NEAREST), (90 + k * W * 2, 0))
        rows_img.append(row)
    for n in range(0, len(rows_img), 12):
        chunk = rows_img[n:n + 12]
        sheet = Image.new('RGBA', (chunk[0].width, chunk[0].height * len(chunk)), (246, 244, 240, 255))
        for r, row in enumerate(chunk):
            sheet.alpha_composite(row, (0, r * row.height))
        sheet.save(os.path.join(lp.PREVIEW, f'overview_{n // 12}.png'))
    print(f'作り直した {len(built)} 体 / 画像がまだない {len(missing)} 体 / マス目が合わず飛ばした {len(bad)} 体')
    if missing:
        print('まだない:', ' '.join(missing))
    if bad:
        print('飛ばした:', ' / '.join(bad))


if __name__ == '__main__':
    main()
