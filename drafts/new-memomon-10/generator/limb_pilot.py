"""Codex が画像生成で描いた手足のポーズ（limb_frames/）から、試作 3 体のスプライトを作る。
  limb_frames/<id>_walk.png     3 列 x 2 行: 歩き 6 コマ
  limb_frames/<id>_actions.png  2 列 x 2 行: 喜ぶ・嫌がる・寝る・驚く
状態ごとの組み立て
  座る   : 元の絵 + まばたき（parts_anim）+ 呼吸（今までと同じ）
  歩く   : 生成した 6 コマ + 軽い上下の弾み
  喜ぶ   : 喜ぶポーズ + ため → ジャンプ → 着地
  嫌がる : 嫌がるポーズ + 首振り
  寝る   : 寝るポーズ + 寝息
  驚く   : 驚くポーズ + 飛び上がる
大きさは、歩きのコマの高さを元の絵の高さに合わせ、4 つのポーズは歩きと同じ縮尺（面積の比）にそろえる。
usage: python limb_pilot.py
出力: public/sprites/ev_<id>_<状態>_<コマ>.png, ../limb_preview/<id>_<状態>.gif, ../limb_preview/<id>_sheet.png
"""
import os
import numpy as np
from PIL import Image
from memomon_gen import draw_fx, finish, Cv, W, H, GROUND, S, ANIMS
from extract_base import bands, cut
from build_evo_sprites import to_logical, fitted_pose, MOTION, OUT, CUT
from parts_anim import edit as edit_parts

HERE = os.path.dirname(os.path.abspath(__file__))
LIMB = os.path.join(HERE, '..', 'limb_frames')
PREVIEW = os.path.join(HERE, '..', 'limb_preview')
PILOT = ['shironeko1', 'penguin2', 'knight1']
FPS = {'sit': 2, 'walk': 8, 'happy': 6, 'dislike': 6, 'sleep': 2, 'surprise': 7}
F = False
# 生成したポーズには手足と表情があるので、体の動きは控えめにして手足を見せる
LIMB_MOTION = {
    'walk':     [(0, 0, 1, 1, 0, F), (0, -3, 1, 1, 0, F), (0, -1, 1, 1, 0, F),
                 (0, 0, 1, 1, 0, F), (0, -3, 1, 1, 0, F), (0, -1, 1, 1, 0, F)],
    'happy':    [(0, 0, 1.14, 0.86, 0, F), (0, -8, 0.94, 1.08, -4, F), (0, -14, 1, 1, 4, F),
                 (0, -14, 1, 1, -4, F), (0, -6, 1, 1, 2, F), (0, 0, 1.12, 0.88, 0, F)],
    'dislike':  [(0, 0, 1, 1, 0, F), (-4, 0, 1.04, 0.96, 6, F), (4, 0, 1.04, 0.96, -6, F),
                 (-4, 0, 1.04, 0.96, 6, F), (4, 0, 1.04, 0.96, -6, F), (0, 0, 1, 1, 0, F)],
    'sleep':    [(0, 0, 1.00, 1.00, 0, F), (0, 0, 1.03, 0.96, 0, F), (0, 0, 1.06, 0.92, 0, F),
                 (0, 0, 1.06, 0.92, 0, F), (0, 0, 1.03, 0.96, 0, F), (0, 0, 1.00, 1.00, 0, F)],
    'surprise': [(0, 0, 1.16, 0.84, 0, F), (0, -14, 0.9, 1.12, -6, F), (0, -10, 0.96, 1.04, -3, F),
                 (0, -4, 1, 1, 0, F), (-2, 0, 1, 1, 2, F), (2, 0, 1, 1, -2, F)],
}
ACTION_ORDER = ['happy', 'dislike', 'sleep', 'surprise']


def slice_sheet(path, rows, cols):
    """黒背景のシートをマス目ごとに切り出し、背景と白フチを取り除いた画像のリストを返す"""
    img = Image.open(path).convert('RGB')
    fg = np.array(img).max(-1) > 45
    rb, cb = bands(fg.sum(1)), bands(fg.sum(0))
    if len(rb) != rows or len(cb) != cols:
        # 帯がうまく取れないときは等分する
        hs, ws = img.height / rows, img.width / cols
        rb = [(round(r * hs), round((r + 1) * hs) - 1) for r in range(rows)]
        cb = [(round(c * ws), round((c + 1) * ws) - 1) for c in range(cols)]
    out = []
    for y0, y1 in rb:
        for x0, x1 in cb:
            box = (max(0, x0 - 16), max(0, y0 - 16), min(img.width, x1 + 17), min(img.height, y1 + 17))
            # 明るい色の体が白フチと一緒にはがれないよう、ほぼ真っ白なフチだけを削る
            out.append(cut(img.crop(box), fringe_min=225, fringe_sat=24, fringe_iter=4, bg_erode=4))
    return out


def shrink(im, factor):
    """決まった縮尺で論理マスに縮める。半透明は作らない"""
    nw, nh = max(1, round(im.width * factor)), max(1, round(im.height * factor))
    small = im.convert('RGBa').resize((nw, nh), Image.BOX).convert('RGBA')
    a = np.array(small)
    op = a[..., 3] >= 110
    a[..., 3] = np.where(op, 255, 0)
    a[~op, :3] = 0
    return Image.fromarray(a, 'RGBA')


def compose(char, anim, i, motion):
    body, (x, y, w, h), damped = fitted_pose(char, motion)
    lift = GROUND - (y + h)
    base = Cv()
    base.ell(24, GROUND, max(4, round(w * 0.34) + round(min(0, -lift) * 0.4)), 1.5, '#d2d2d2')
    fx, plain = Cv(), Cv()
    draw_fx(fx, plain, anim, i, x + w // 2, max(2, y), min(W - 6, x + w))
    out = base.im
    out.alpha_composite(body)
    out.alpha_composite(finish(fx.im, shade=False))
    out.alpha_composite(plain.im)
    return out


def build(cid):
    key, stage = cid[:-1], int(cid[-1])
    base_cut = Image.open(os.path.join(CUT, f'{key}_{stage}.png'))
    base_logical = to_logical(base_cut, stage)
    walk = slice_sheet(os.path.join(LIMB, f'{cid}_walk.png'), 2, 3)
    actions = slice_sheet(os.path.join(LIMB, f'{cid}_actions.png'), 2, 2)
    area = lambda im: int((np.array(im)[..., 3] > 0).sum())
    f_walk = base_logical.height / np.median([im.height for im in walk])
    f_act = f_walk * np.sqrt(np.median([area(im) for im in walk]) / np.median([area(im) for im in actions]))
    poses = {name: shrink(im, f_act) for name, im in zip(ACTION_ORDER, actions)}
    walk_l = [shrink(im, f_walk) for im in walk]
    frames = {}
    for anim in ANIMS:
        for i in range(6):
            if anim == 'sit':
                char, motion = to_logical(edit_parts(cid, base_cut, 'sit', i), stage), MOTION['sit'][i]
            elif anim == 'walk':
                char, motion = walk_l[i], LIMB_MOTION['walk'][i]
            else:
                char, motion = poses[anim], LIMB_MOTION[anim][i]
            im = compose(char, anim, i, motion)
            frames[(anim, i)] = im
            im.resize((W * S, H * S), Image.NEAREST).save(os.path.join(OUT, f'ev_{cid}_{anim}_{i}.png'), optimize=True)
    return frames, f_walk, f_act


def main():
    os.makedirs(PREVIEW, exist_ok=True)
    for cid in PILOT:
        frames, f_walk, f_act = build(cid)
        bg = (246, 244, 240, 255)
        sheet = Image.new('RGBA', (W * 2 * 6, H * 2 * len(ANIMS)), bg)
        for r, anim in enumerate(ANIMS):
            gif = []
            for i in range(6):
                tile = Image.new('RGBA', (W, H), bg)
                tile.alpha_composite(frames[(anim, i)])
                sheet.alpha_composite(tile.resize((W * 2, H * 2), Image.NEAREST), (i * W * 2, r * H * 2))
                gif.append(tile.resize((W * 4, H * 4), Image.NEAREST).convert('RGB'))
            gif[0].save(os.path.join(PREVIEW, f'{cid}_{anim}.gif'), save_all=True, append_images=gif[1:],
                        duration=round(1000 / FPS[anim]), loop=0)
        sheet.save(os.path.join(PREVIEW, f'{cid}_sheet.png'))
        print(cid, f'縮尺 歩き {f_walk:.3f} / ポーズ {f_act:.3f}')


if __name__ == '__main__':
    main()
