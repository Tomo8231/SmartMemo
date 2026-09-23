"""進化メモモン 102 体のスプライトを、元絵の細かさのまま 128x128 で作る。

これまでは 48x52 の論理マスで組み立て、1 マスを 2px に引き伸ばして 128x128 に
収めていた（96x104 の絵）。絵の情報量は 48x52 ぶんしかないので、拡大された
粗いドットに見えていた。ここでは同じ 96x104 の枠に「1 マス = 1px」で置く。
マスの数が縦横 2 倍になるので、元絵から拾えるディテールは 4 倍になる。

変えたのはマスの細かさだけで、ドット絵であることと、枠の中での絵の大きさ・
位置は変えていない。表示側（128 のキャンバス / 内枠 96x104）もそのまま使える。

  - 動き（MOTION / LIMB_MOTION）の移動量はマスで数えているので 2 倍にする
  - エフェクト（ハート・Z・砂ぼこり）は、今までと同じ大きさに見えるよう
    48x52 のマスで描いてから 2 倍に拡大して重ねる
  - 手足のポーズ画像がある 100 体はそれを使い、無い 2 体（でんきねこ 1・2）は
    これまでどおり体全体を動かして作る

usage: python fine_build.py [id ...]       （id を省くと 102 体すべて）
出力: public/sprites/ev_<id>_<状態>_<コマ>.png（128x128）
      ../limb_preview/fine_overview_<n>.png（確認用）
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

from memomon_gen import ANIMS, GROUND, H, W, Cv, draw_fx, finish
from build_evo_sprites import CUT, GROW, MAX_H, MAX_W, MOTION, OUT, shape
from extract_base import LINES
from parts_anim import edit as edit_parts
import limb_pilot as lp

K = 2                      # マスの細かさ。今までの 1 マス = K マス
FW, FH = W * K, H * K      # 96 x 104（絵が入る内枠）
FGROUND = GROUND * K
SIZE = 128                 # 最終のキャンバス
# 横は中央。縦は中央より 2px 下げて、足元（影）の高さを今までのスプライトと
# そろえる。ここがずれると、にわや遊び場で進化メモモンだけ浮いて見える。
OX, OY = (SIZE - FW) // 2, (SIZE - FH) // 2 + 2
HERE = os.path.dirname(os.path.abspath(__file__))


def to_logical(im, stage):
    """切り抜き（元絵の解像度）を細かいマスに縮める。半透明は作らない"""
    w, h = im.size
    s = min(MAX_W * K / w, MAX_H * K / h) * GROW[stage]
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    small = im.convert('RGBa').resize((nw, nh), Image.BOX).convert('RGBA')
    a = np.array(small)
    op = a[..., 3] >= 110
    a[..., 3] = np.where(op, 255, 0)
    a[~op, :3] = 0
    return Image.fromarray(a, 'RGBA')


def fitted_pose(char, motion):
    """1 コマ分動かして 96x104 の内枠に置く。はみ出し方の扱いは今までと同じ"""
    dx, dy, sx, sy, rot, flip = motion
    dx, dy = dx * K, dy * K
    damped = 0
    for damped in range(11):
        t = 1 - damped * 0.1
        im = shape(char, 1 + (sx - 1) * t, sy, rot * t, flip)
        if im.width <= FW - 2 * K:
            break
    for k in range(11):
        if FGROUND - im.height >= 0:
            break
        im = shape(char, 1 + (sx - 1) * t, 1 + (sy - 1) * (1 - (k + 1) * 0.1), rot * t, flip)
        damped = max(damped, k + 1)
    x = min(max(K, round(FW / 2 - im.width / 2) + dx), FW - K - im.width)
    y = max(0, FGROUND - im.height + dy)
    canvas = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    canvas.paste(im, (x, y), im)
    return canvas, (x, y, im.width, im.height), damped


def _fx_layers(anim, i, x, y, w):
    """エフェクトは今までのマスで描いて拡大する。細かいマスで描くと半分の大きさになってしまう"""
    fx, plain = Cv(), Cv()
    draw_fx(fx, plain, anim, i, (x + w // 2) // K, max(2, y // K), min(W - 6, (x + w) // K))
    up = lambda im: im.resize((FW, FH), Image.NEAREST)
    return up(finish(fx.im, shade=False)), up(plain.im)


def compose(char, anim, i, motion, outline):
    """1 コマを 128x128 で仕上げる。outline=True は 1 枚絵から作る組み立て（今までの render 相当）"""
    body, (x, y, w, h), damped = fitted_pose(char, motion)
    lift = FGROUND - (y + h)
    base = Cv(FW, FH)
    base.ell(24 * K, FGROUND, max(4 * K, round(w * 0.34) + round(min(0, -lift) * 0.4)), 1.5 * K, '#d2d2d2')
    fx_im, plain_im = _fx_layers(anim, i, x, y, w)
    inner = base.im
    inner.alpha_composite(finish(body, shade=False, outline=False) if outline else body)
    inner.alpha_composite(fx_im)
    inner.alpha_composite(plain_im)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(inner, (OX, OY))
    return out, damped


def build(cid):
    """ポーズ画像があればそれを使い、無ければ 1 枚絵を動かして 6 状態 x 6 コマを作る"""
    key, stage = cid[:-1], int(cid[-1])
    cut = Image.open(os.path.join(CUT, f'{key}_{stage}.png'))
    walk_p = os.path.join(lp.LIMB, f'{cid}_walk.png')
    act_p = os.path.join(lp.LIMB, f'{cid}_actions.png')
    has_limb = os.path.exists(walk_p) and os.path.exists(act_p)

    if has_limb:
        base_logical = to_logical(cut, stage)
        walk = lp.slice_sheet(walk_p, 2, 3)
        actions = lp.slice_sheet(act_p, 2, 2)
        area = lambda im: int((np.array(im)[..., 3] > 0).sum())
        f_walk = base_logical.height / np.median([im.height for im in walk])
        f_act = f_walk * np.sqrt(np.median([area(im) for im in walk]) / np.median([area(im) for im in actions]))
        poses = {name: lp.shrink(im, f_act) for name, im in zip(lp.ACTION_ORDER, actions)}
        walk_l = [lp.shrink(im, f_walk) for im in walk]

    frames = {}
    for anim in ANIMS:
        for i in range(6):
            if has_limb and anim == 'walk':
                char, motion, outline = walk_l[i], lp.LIMB_MOTION['walk'][i], False
            elif has_limb and anim != 'sit':
                char, motion, outline = poses[anim], lp.LIMB_MOTION[anim][i], False
            else:
                # 座るコマと、ポーズ画像が無い子は、元絵の目・口・足を描き替えて動かす
                char = to_logical(edit_parts(cid, cut, anim, i), stage)
                motion, outline = MOTION[anim][i], True
            im, _ = compose(char, anim, i, motion, outline)
            frames[(anim, i)] = im
            im.save(os.path.join(OUT, f'ev_{cid}_{anim}_{i}.png'), optimize=True)
    return frames, has_limb


def main():
    ids = sys.argv[1:] or [f'{k}{s}' for k, _, _ in LINES for s in (1, 2, 3)]
    os.makedirs(lp.PREVIEW, exist_ok=True)
    picks = [('sit', 0), ('walk', 0), ('walk', 3), ('happy', 2), ('dislike', 1), ('sleep', 2), ('surprise', 1)]
    bg = (246, 244, 240, 255)
    rows, plain_ids = [], []
    for cid in ids:
        frames, has_limb = build(cid)
        if not has_limb:
            plain_ids.append(cid)
        row = Image.new('RGBA', (SIZE * len(picks) + 90, SIZE), bg)
        ImageDraw.Draw(row).text((4, 4), cid, fill=(60, 60, 60, 255))
        for k, key in enumerate(picks):
            row.alpha_composite(frames[key], (90 + k * SIZE, 0))
        rows.append(row)
    for n in range(0, len(rows), 12):
        chunk = rows[n:n + 12]
        sheet = Image.new('RGBA', (chunk[0].width, chunk[0].height * len(chunk)), bg)
        for r, row in enumerate(chunk):
            sheet.alpha_composite(row, (0, r * row.height))
        sheet.save(os.path.join(lp.PREVIEW, f'fine_overview_{n // 12}.png'))
    print(f'作り直した {len(ids)} 体 / うちポーズ画像が無いのは {len(plain_ids)} 体')
    if plain_ids:
        print('ポーズ画像なし:', ' '.join(plain_ids))


if __name__ == '__main__':
    main()
