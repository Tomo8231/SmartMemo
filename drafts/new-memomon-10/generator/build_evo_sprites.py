"""base_cut の切り抜きから、進化メモモン 102 体のスプライト（6 状態 x 6 コマ, 144x156, 3px 単位）を作る。
動き（伸び縮み・傾き・上下・エフェクト）は memomon_gen の仕組みを使う。
usage: python build_evo_sprites.py
出力: public/sprites/ev_<key><段階>_<状態>_<コマ>.png, evo_preview_*.png
"""
import os
import numpy as np
from PIL import Image
from memomon_gen import state, deform, draw_fx, finish, Cv, W, H, GROUND, S, ANIMS
from extract_base import LINES

HERE = os.path.dirname(os.path.abspath(__file__))
CUT = os.path.join(HERE, 'base_cut')
OUT = os.path.join(HERE, '..', '..', '..', 'public', 'sprites')
# 進化で育ったように見せる大きさの比率（3 段階目を 1 とする）
GROW = {1: 0.8, 2: 0.9, 3: 1.0}
MAX_W, MAX_H = 46, 37   # 論理マス。上に跳ねる余白を残す


def to_logical(im, stage):
    """切り抜き（シートの解像度）を論理マスに縮める。半透明は作らない"""
    w, h = im.size
    s = min(MAX_W / w, MAX_H / h) * GROW[stage]
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    small = im.convert('RGBa').resize((nw, nh), Image.BOX).convert('RGBA')
    a = np.array(small)
    op = a[..., 3] >= 110
    a[..., 3] = np.where(op, 255, 0)
    a[~op, :3] = 0
    return Image.fromarray(a, 'RGBA')


def render(char, anim, i):
    st = state(anim, i)
    cw, ch = char.size
    x0, y0 = 24 - cw // 2, GROUND - ch          # 足元を地面にそろえて中央に置く
    base = Cv()
    base.ell(24, GROUND, max(4, round(cw * 0.34 * st['sx']) + round(min(0, st['dy']) * 0.5)), 1.5, '#d2d2d2')
    body = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    body.paste(char, (x0 + st['dx'], y0 + st['dy']), char)
    body = deform(body, st['sx'], st['sy'], st['lean'], GROUND + st['dy'], 24 + st['dx'])
    fx, plain = Cv(), Cv()
    draw_fx(fx, plain, anim, i, 24 + st['dx'], max(2, y0 + st['dy']), min(W - 6, 24 + cw // 2))
    out = base.im
    out.alpha_composite(body)
    out.alpha_composite(finish(fx.im, shade=False))
    out.alpha_composite(plain.im)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    n = 0
    keyframes = {}
    for key, _, _ in LINES:
        for stage in (1, 2, 3):
            char = to_logical(Image.open(os.path.join(CUT, f'{key}_{stage}.png')), stage)
            for anim in ANIMS:
                for i in range(6):
                    im = render(char, anim, i)
                    if (anim, i) in (('sit', 0), ('happy', 2)):
                        keyframes[(key, stage, anim)] = im
                    im.resize((W * S, H * S), Image.NEAREST).save(
                        os.path.join(OUT, f'ev_{key}{stage}_{anim}_{i}.png'), optimize=True)
                    n += 1
    # プレビュー: 行=系統、列=段階 x (座り, 跳ねる)。17 行ずつ 2 枚
    T = 2
    tw, th = W * T, H * T
    half = (len(LINES) + 1) // 2
    for part in range(2):
        rows = LINES[part * half:(part + 1) * half]
        sheet = Image.new('RGBA', (tw * 6, th * len(rows)), (246, 244, 240, 255))
        for r, (key, _, _) in enumerate(rows):
            for stage in (1, 2, 3):
                for k, anim in enumerate(('sit', 'happy')):
                    sheet.alpha_composite(keyframes[(key, stage, anim)].resize((tw, th), Image.NEAREST),
                                          (((stage - 1) * 2 + k) * tw, r * th))
        sheet.save(os.path.join(HERE, f'evo_preview_{part}.png'))
    print('sprites', n)


if __name__ == '__main__':
    main()
