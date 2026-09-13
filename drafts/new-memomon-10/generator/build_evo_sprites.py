"""base_cut の切り抜きから、進化メモモン 102 体のスプライト（6 状態 x 6 コマ, 144x156, 3px 単位）を作る。
元が 1 枚の静止画なので、手足は動かせない。代わりに体全体を大きく動かす。
  - 伸び縮み（ため → 伸び → 着地のつぶれ、寝息のふくらみ）
  - 傾き（歩きのよちよち、寝るときの船こぎ、驚きののけぞり）
  - 向きの反転（嫌がるときに ぷいっ、喜ぶときに空中でくるっ）
  - 上下左右の移動（跳ねる、首振り）
傾けたり伸ばしたりしてキャンバスからはみ出すコマは、そのコマの動きだけを少しずつ弱めて収める。
usage: python build_evo_sprites.py   （先に python extract_base.py で base_cut/ を作る）
出力: public/sprites/ev_<key><段階>_<状態>_<コマ>.png, evo_preview_<状態>.png
"""
import os
import numpy as np
from PIL import Image
from memomon_gen import draw_fx, finish, Cv, W, H, GROUND, S, ANIMS
from extract_base import LINES

HERE = os.path.dirname(os.path.abspath(__file__))
CUT = os.path.join(HERE, 'base_cut')
OUT = os.path.join(HERE, '..', '..', '..', 'public', 'sprites')
# 進化で育ったように見せる大きさの比率（3 段階目を 1 とする）
GROW = {1: 0.8, 2: 0.9, 3: 1.0}
MAX_W, MAX_H = 46, 37   # 論理マス。上に跳ねる余白を残す

# コマごとの動き: dx, dy(上がマイナス), sx, sy, rot(度。プラスで上側が前＝左へ傾く), flip(向きを反転)
F, T = False, True
MOTION = {
    # その場でくつろぐ（2fps ループ）: 大きく呼吸しながら、首をかしげて、ときどき小さく跳ねる
    'sit': [
        (0,  0, 1.00, 1.00,  0, F),
        (0,  0, 1.06, 0.94,  5, F),
        (0,  0, 1.12, 0.88, 10, F),
        (0,  0, 1.06, 0.94,  5, F),
        (0, -4, 0.94, 1.08, -4, F),
        (0,  0, 1.04, 0.96, -8, F),
    ],
    # 左へ歩く（8fps ループ）: 1 周で 2 歩。はずんで、左右によちよち傾く
    'walk': [
        (0,  0, 1.10, 0.90,  12, F),
        (0, -6, 0.92, 1.10,   4, F),
        (0, -3, 1.00, 1.02,  -6, F),
        (0,  0, 1.10, 0.90, -12, F),
        (0, -6, 0.92, 1.10,  -4, F),
        (0, -3, 1.00, 1.02,   6, F),
    ],
    # 大喜び（6fps 1 回）: しゃがんでためる → 高く跳んで空中でくるっと振り向く → 着地でつぶれる
    'happy': [
        (0,   0, 1.28, 0.72,   0, F),
        (0,  -8, 0.84, 1.24, -12, F),
        (0, -14, 0.92, 1.10,  16, T),
        (0, -14, 0.96, 1.04, -16, T),
        (0,  -6, 1.04, 0.96,  10, F),
        (0,   0, 1.24, 0.78,   0, F),
    ],
    # いやがる（6fps 1 回）: ぷいっと顔をそむけて、首を横にぶんぶん振る
    'dislike': [
        (0,  0, 1.08, 0.92,   0, F),
        (-5, 0, 1.12, 0.88,  18, T),
        (5,  0, 1.12, 0.88, -18, T),
        (-5, 0, 1.12, 0.88,  18, T),
        (5,  0, 1.12, 0.88, -18, T),
        (0,  0, 1.06, 0.94,   0, F),
    ],
    # 眠る（2fps ループ）: 前に傾いて船をこぎ、寝息で大きくしぼんだり、ふくらんだりする。
    # 横に伸ばすと幅がはみ出して傾きを弱めることになるので、横はほとんど伸ばさず縦で見せる
    'sleep': [
        (0, 0, 1.02, 0.94, 12, F),
        (0, 0, 1.05, 0.84, 20, F),
        (0, 0, 1.08, 0.74, 28, F),
        (0, 0, 1.08, 0.72, 32, F),
        (0, 0, 1.05, 0.82, 24, F),
        (0, 0, 1.02, 0.92, 16, F),
    ],
    # びっくり（7fps 1 回）: 縮む → 飛び上がってのけぞる → 着地して震える
    'surprise': [
        (0,   0, 1.30, 0.70,   0, F),
        (0, -14, 0.78, 1.34, -20, F),
        (0, -10, 0.88, 1.18, -14, F),
        (0,  -4, 1.00, 1.04,  -6, F),
        (-3,  0, 1.12, 0.90,   6, F),
        (3,   0, 1.04, 0.96,  -4, F),
    ],
}


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


def shape(char, sx, sy, rot, flip):
    """反転・伸び縮み・傾きをかけて、余白を切り詰めた画像を返す"""
    im = char.transpose(Image.FLIP_LEFT_RIGHT) if flip else char
    cw, ch = im.size
    im = im.resize((max(1, round(cw * sx)), max(1, round(ch * sy))), Image.NEAREST)
    if rot:
        im = im.rotate(rot, resample=Image.NEAREST, expand=True)
    return im.crop(im.getchannel('A').getbbox())


def fitted_pose(char, motion):
    """1 コマ分動かして 48x52 のキャンバスに置く。はみ出すときは、はみ出した向きの動きだけを抑える。
      - 横にはみ出す: まず内側へずらす。キャンバスより幅が広いときだけ、伸びと傾きを弱める
      - 上にはみ出す: ジャンプの高さだけを下げる。それでも入らないときは縦の伸びを弱める
    戻り値の 3 つ目は、伸びや傾きを弱めた段階（0 なら弱めていない。1 段階 = 10%）"""
    dx, dy, sx, sy, rot, flip = motion
    damped = 0
    for damped in range(11):
        t = 1 - damped * 0.1
        im = shape(char, 1 + (sx - 1) * t, sy, rot * t, flip)
        if im.width <= W:
            break
    for k in range(11):
        if GROUND - im.height >= 0:
            break
        im = shape(char, 1 + (sx - 1) * t, 1 + (sy - 1) * (1 - (k + 1) * 0.1), rot * t, flip)
        damped = max(damped, k + 1)
    # 傾けても足元が地面につくように、いちばん下のピクセルを地面にそろえる
    x = min(max(0, round(W / 2 - im.width / 2) + dx), W - im.width)
    y = max(0, GROUND - im.height + dy)
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(im, (x, y), im)
    return canvas, (x, y, im.width, im.height), damped


def render(char, anim, i):
    body, (x, y, w, h), damped = fitted_pose(char, MOTION[anim][i])
    lift = GROUND - (y + h)   # 0 のときは地面にいる
    base = Cv()
    base.ell(24, GROUND, max(4, round(w * 0.34) + round(min(0, -lift) * 0.4)), 1.5, '#d2d2d2')
    fx, plain = Cv(), Cv()
    draw_fx(fx, plain, anim, i, x + w // 2, max(2, y), min(W - 6, x + w))
    out = base.im
    out.alpha_composite(finish(body, shade=False, outline=False))
    out.alpha_composite(finish(fx.im, shade=False))
    out.alpha_composite(plain.im)
    return out, damped


def main():
    os.makedirs(OUT, exist_ok=True)
    n = damped_frames = 0
    frames = {}
    for key, _, _ in LINES:
        for stage in (1, 2, 3):
            char = to_logical(Image.open(os.path.join(CUT, f'{key}_{stage}.png')), stage)
            for anim in ANIMS:
                for i in range(6):
                    im, damped = render(char, anim, i)
                    damped_frames += damped > 0
                    if key in ('penguin', 'kani', 'hachi', 'kujira', 'yousei', 'golem') and stage == 2:
                        frames[(key, anim, i)] = im
                    im.resize((W * S, H * S), Image.NEAREST).save(
                        os.path.join(OUT, f'ev_{key}{stage}_{anim}_{i}.png'), optimize=True)
                    n += 1
    # プレビュー: 状態ごとに、行=代表の系統（2 段階目）、列=6 コマ
    T2 = 2
    keys = ['penguin', 'kani', 'hachi', 'kujira', 'yousei', 'golem']
    for anim in ANIMS:
        sheet = Image.new('RGBA', (W * T2 * 6, H * T2 * len(keys)), (246, 244, 240, 255))
        for r, key in enumerate(keys):
            for i in range(6):
                sheet.alpha_composite(frames[(key, anim, i)].resize((W * T2, H * T2), Image.NEAREST), (i * W * T2, r * H * T2))
        sheet.save(os.path.join(HERE, f'evo_preview_{anim}.png'))
    print('sprites', n, '| はみ出して動きを弱めたコマ', damped_frames)


if __name__ == '__main__':
    main()
