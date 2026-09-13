"""検出した目・口・足を、状態とコマに合わせて描き替える（切り抜きの解像度で編集してから縮める）。
  目: まばたき・半目・閉じ目（∪）・にっこり（∩）・びっくり（大きく）・いやがる（＞＜）
  口: 開ける（喜ぶ・驚く・寝息）・波線（いやがる）
  足: 歩くときは交互に上げる、跳ねるときは縮める、いやがるときは足踏み
usage: python parts_anim.py [key ...]   -> parts_proto_<状態>.png（指定したキャラの 6 コマ）
"""
import json
import os
import sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CUT = os.path.join(HERE, 'base_cut')
PARTS = json.load(open(os.path.join(HERE, 'parts_final.json')))

# 足を持たない系統・姿（検出が星のとがりや雲のすそを足と誤るため）
NO_LEGS_LINES = {'hoshi', 'kumo', 'onpu', 'kujira', 'takarabako', 'saboten', 'kabocha', 'futaba'}
NO_LEGS_IDS = {'hinotama1', 'kotori3'}

# 状態ごとの顔: (目, 口) x 6 コマ
FACE = {
    'sit':      [('open', None), ('open', None), ('open', None), ('half', None), ('closed', None), ('open', None)],
    'walk':     [('open', None)] * 6,
    'happy':    [('happy', 'open'), ('happy', 'open'), ('happy', 'wide'), ('happy', 'wide'), ('happy', 'open'), ('happy', None)],
    'dislike':  [('angry', 'wave'), ('angry', 'wave'), ('angry', 'wave'), ('angry', 'wave'), ('angry', 'wave'), ('half', None)],
    'sleep':    [('closed', None), ('closed', 'o'), ('closed', 'o'), ('closed', 'o'), ('closed', None), ('closed', None)],
    'surprise': [('wide', 'o'), ('wide', 'o'), ('wide', 'o'), ('wide', 'o'), ('wide', 'o'), ('open', None)],
}
# 足の持ち上げ量（帯の高さに対する割合）: 偶数番の足, 奇数番の足
# 足の動き。検出される足の帯は「おなかより下」だけで短く、持ち上げるだけでは体に隠れて見えない。
# そこで付け根を固定したまま、足先ほど大きく前後に振る（振り: マイナスで前＝左）。
# 1 コマ = (偶数番の足の振り, 偶数番の足の上げ, 奇数番の足の振り, 奇数番の足の上げ)
#   振りは足の帯の高さに対する割合、上げは帯の高さに対する割合
LEGS = {
    'sit':      [(0, 0, 0, 0)] * 6,
    'walk':     [(-1.0, 0.25, 1.0, 0), (-0.4, 0, 0.4, 0), (0.4, 0, -0.4, 0.25),
                 (1.0, 0, -1.0, 0.25), (0.4, 0, -0.4, 0), (-0.4, 0.25, 0.4, 0)],
    'happy':    [(0, 0, 0, 0), (-0.8, 0.3, 0.8, 0.3), (-1.0, 0.4, 1.0, 0.4), (-1.0, 0.4, 1.0, 0.4), (-0.5, 0.2, 0.5, 0.2), (0, 0, 0, 0)],
    'dislike':  [(0, 0, 0, 0), (0, 0.6, 0, 0), (0, 0, 0, 0.6), (0, 0.6, 0, 0), (0, 0, 0, 0.6), (0, 0, 0, 0)],
    'sleep':    [(0, 0, 0, 0)] * 6,
    'surprise': [(0, 0, 0, 0), (-1.0, 0.4, 1.0, 0.4), (-0.8, 0.3, 0.8, 0.3), (-0.3, 0.1, 0.3, 0.1), (0, 0, 0, 0), (0, 0, 0, 0)],
}


def lum(rgb):
    return rgb[..., :3].mean(-1)


def skin_color(a, box, pad):
    """パーツのまわりの地の色（暗い色を除いた中央値）"""
    h, w = a.shape[:2]
    x0, y0, x1, y1 = box
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(w - 1, x1 + pad), min(h - 1, y1 + pad)
    region = a[Y0:Y1 + 1, X0:X1 + 1]
    mask = np.ones(region.shape[:2], bool)
    mask[y0 - Y0:y1 - Y0 + 1, x0 - X0:x1 - X0 + 1] = False
    px = region[mask & (region[..., 3] > 0) & (lum(region) >= 90)]
    if len(px) == 0:
        px = region[mask & (region[..., 3] > 0)]
    return tuple(int(v) for v in np.median(px[:, :3], 0)) + (255,) if len(px) else (230, 200, 180, 255)


def erase(a, box, color, grow=2):
    """パーツの暗い部分とハイライトを、地の色で塗りつぶす"""
    h, w = a.shape[:2]
    x0, y0, x1, y1 = box
    X0, Y0, X1, Y1 = max(0, x0 - grow), max(0, y0 - grow), min(w - 1, x1 + grow), min(h - 1, y1 + grow)
    region = a[Y0:Y1 + 1, X0:X1 + 1]
    target = (region[..., 3] > 0) & ((lum(region) < 110) | (lum(region) > 200))
    region[target] = color


def dark_color(a, box):
    x0, y0, x1, y1 = box
    region = a[y0:y1 + 1, x0:x1 + 1]
    px = region[(region[..., 3] > 0) & (lum(region) < 90)]
    return tuple(int(v) for v in np.median(px[:, :3], 0)) + (255,) if len(px) else (40, 30, 40, 255)


def draw_eye(im, a, box, kind, side, eye_col, skin):
    x0, y0, x1, y1 = box
    w, h = x1 - x0 + 1, y1 - y0 + 1
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    t = max(5, round(min(w, h) * 0.45))
    if kind == 'open':
        return
    if kind == 'wide':
        patch = Image.fromarray(a[y0:y1 + 1, x0:x1 + 1].copy())
        erase(a, box, skin)
        s = 1.4
        big = patch.resize((round(w * s), round(h * s)), Image.NEAREST)
        im.paste(Image.fromarray(a), (0, 0))
        im.alpha_composite(big, (round(cx - big.width / 2), round(cy - big.height / 2)))
        a[:] = np.array(im)
        return
    if kind == 'half':
        # 上半分だけを地の色でふさいで、眠そうな半目にする
        region = a[y0:round(cy) + 1, x0 - 1:x1 + 2]
        region[(region[..., 3] > 0)] = skin
        return
    erase(a, box, skin)
    im.paste(Image.fromarray(a), (0, 0))
    d = ImageDraw.Draw(im)
    if kind == 'closed':   # ∪
        d.line([(x0 - t * 0.3, cy - t * 0.2), (cx, cy + t * 0.7), (x1 + t * 0.3, cy - t * 0.2)], fill=eye_col, width=t, joint='curve')
    elif kind == 'happy':  # ∩
        d.line([(x0 - t * 0.3, cy + t * 0.6), (cx, cy - t * 0.6), (x1 + t * 0.3, cy + t * 0.6)], fill=eye_col, width=t, joint='curve')
    elif kind == 'angry':  # ＞ ＜
        ww = max(w, h) * 0.6
        if side == 'l':
            d.line([(cx - ww, cy - ww), (cx + ww * 0.6, cy), (cx - ww, cy + ww)], fill=eye_col, width=t, joint='curve')
        else:
            d.line([(cx + ww, cy - ww), (cx - ww * 0.6, cy), (cx + ww, cy + ww)], fill=eye_col, width=t, joint='curve')
    a[:] = np.array(im)


def draw_mouth(im, a, box, kind, skin, eye_h):
    if kind is None:
        return
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    mw = max(x1 - x0 + 1, eye_h * 0.9)
    erase(a, box, skin)
    im.paste(Image.fromarray(a), (0, 0))
    d = ImageDraw.Draw(im)
    dark, pink = (90, 30, 40, 255), (240, 110, 130, 255)
    if kind in ('open', 'wide'):
        rx = mw * (0.55 if kind == 'open' else 0.7)
        ry = rx * (0.75 if kind == 'open' else 1.0)
        d.ellipse([cx - rx, cy - ry * 0.6, cx + rx, cy + ry * 1.4], fill=dark)
        d.ellipse([cx - rx * 0.6, cy + ry * 0.4, cx + rx * 0.6, cy + ry * 1.25], fill=pink)
    elif kind == 'o':
        r = mw * 0.4
        d.ellipse([cx - r, cy - r * 0.7, cx + r, cy + r * 1.3], fill=dark)
    elif kind == 'wave':
        t = max(4, round(eye_h * 0.3))
        n = 4
        pts = [(cx - mw * 0.7 + i * (mw * 1.4 / n), cy + (t * 0.8 if i % 2 else -t * 0.8)) for i in range(n + 1)]
        d.line(pts, fill=dark, width=t, joint='curve')
    a[:] = np.array(im)


def move_legs(im, legs, motion):
    """足の帯の中で、付け根（帯の上端）を固定して足先ほど大きく前後に振り、少し持ち上げる"""
    swing_a, lift_a, swing_b, lift_b = motion
    if not legs or motion == (0, 0, 0, 0):
        return im
    a = np.array(im)
    h_img, w_img = a.shape[:2]
    out = a.copy()
    for idx, (x0, y0, x1, y1) in enumerate(sorted(legs, key=lambda b: b[0])):
        swing, lift = (swing_a, lift_a) if idx % 2 == 0 else (swing_b, lift_b)
        if not swing and not lift:
            continue
        piece = a[y0:y1 + 1, x0:x1 + 1].copy()
        out[y0:y1 + 1, x0:x1 + 1] = 0
        bh = y1 - y0 + 1
        reach = max(14, bh * 0.9) * swing         # 足先の前後の移動量（px）
        up = round(bh * lift)
        for r in range(bh):
            t = (r + 1) / bh                      # 付け根 0 → 足先 1
            row = piece[r]
            dx = round(reach * t)
            ty = y0 + r - round(up * t)
            if ty < 0:
                continue
            xs = np.nonzero(row[:, 3] > 0)[0]
            for x in xs:
                tx = x0 + x + dx
                if 0 <= tx < w_img and out[ty, tx, 3] == 0:
                    out[ty, tx] = row[x]
    return Image.fromarray(out)


def edit(cid, im, anim, i):
    """1 コマ分、目・口・足を描き替えた画像を返す（入力と同じ大きさ）"""
    p = PARTS[cid]
    im = im.convert('RGBA').copy()
    line = ''.join(c for c in cid if not c.isdigit())
    legs = [] if (line in NO_LEGS_LINES or cid in NO_LEGS_IDS) else p['legs']
    im = move_legs(im, legs, LEGS[anim][i])
    a = np.array(im)
    eyes, mouth = p['eyes'], p['mouth']
    # 口は 1 つ（[x0,y0,x1,y1]）か、顔が 2 つあるキャラ用に複数（[[...], [...]]）
    mouths = [] if mouth is None else (mouth if isinstance(mouth[0], list) else [mouth])
    eye_kind, mouth_kind = FACE[anim][i]
    if eyes:
        skin = skin_color(a, eyes[0], 10)
        eye_col = dark_color(a, eyes[0])
        eye_h = np.mean([b[3] - b[1] + 1 for b in eyes])
        if mouth_kind:
            for mb in mouths:
                draw_mouth(im, a, mb, mouth_kind, skin_color(a, mb, 10), eye_h)
        for k, box in enumerate(eyes):
            # 左から順に 左目・右目・左目・右目…（顔が 2 つのキャラにも対応）
            draw_eye(im, a, box, eye_kind, 'l' if k % 2 == 0 else 'r', eye_col, skin)
        im = Image.fromarray(a)
    return im


def main():
    keys = sys.argv[1:] or ['shironeko1', 'penguin2', 'shika1', 'kani2', 'hoshi1', 'yousei2']
    T = 150
    for anim in FACE:
        sheet = Image.new('RGB', (T * 6, T * len(keys)), (240, 240, 240))
        for r, cid in enumerate(keys):
            src = Image.open(os.path.join(CUT, f'{cid[:-1]}_{cid[-1]}.png'))
            for i in range(6):
                out = edit(cid, src, anim, i)
                bg = Image.new('RGBA', out.size, (240, 240, 240, 255))
                bg.alpha_composite(out)
                bg.thumbnail((T - 4, T - 4))
                sheet.paste(bg.convert('RGB'), (i * T + 2, r * T + 2))
        sheet.save(os.path.join(HERE, f'parts_proto_{anim}.png'))
    print('ok', keys)


if __name__ == '__main__':
    main()
