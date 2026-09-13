"""新メモモン 10 体のスプライト(6 状態 x 6 コマ)となつき MAX アイテムをドット絵で生成する。
usage: python memomon_gen.py
出力: new_memomon/sprites/<prefix>_<anim>_<i>.png, new_memomon/items/<id>.png, new_memomon/preview_*.png

かわいさの付け方
  - 頭を大きく体を小さく（ちびキャラの比率）。手足は短く太く、先を丸くする
  - 目は 3x4 の丸目にハイライト。閉じ目は ∪、笑い目は ∩
  - 全員にほっぺ。口は ω や小さな笑顔を表情ごとに変える
  - 輪郭線は黒一色にせず、隣の色を暗くした色付きの線にする
動きの付け方
  - 体全体: 伸び縮み(sx, sy)・前後の傾き(lean)・上下(dy)・左右(dx) をコマごとに変える
  - 部位: 翼・足・腕・尻尾・耳などを、状態ごとの位相で全コマ動かす
  - エフェクト: 砂ぼこり・ハート・集中線・どんより線・Z を状態ごとに出す
キャラクターは 44 マスの高さで設計し、跳ねる余白として上に 8 マス足したキャンバスに描く。
"""
import math
import os
import numpy as np
from PIL import Image, ImageDraw

W, H = 48, 52          # スプライトの論理マス（設計は高さ 44、上に 8 マスの余白）
TOP = 8                # 設計座標 -> キャンバス座標の縦オフセット
GROUND = 40 + TOP      # 地面の y
S = 3                  # 拡大率 -> 144x156
IW = 40                # アイテムの論理マス
IS = 4                 # アイテムの拡大率 -> 160x160
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'new_memomon')
ANIMS = ['sit', 'walk', 'happy', 'dislike', 'sleep', 'surprise']
EYE = '#2a2233'
MOUTH = '#5a3a4a'
BLUSH = '#ffa3b5'
LINE_TINT = np.array([46, 30, 52])


def col(c):
    if isinstance(c, tuple):
        return c
    h = c.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


class Cv:
    def __init__(self, w=W, h=H):
        self.im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.ox = 0
        self.oy = 0
        self.look = 0   # 目線の左右ずれ（open / wide の黒目だけ動かす）

    def _b(self, x0, y0, x1, y1):
        return [round(x0 + self.ox), round(y0 + self.oy), round(x1 + self.ox), round(y1 + self.oy)]

    def ell(self, cx, cy, rx, ry, c):
        self.d.ellipse(self._b(cx - rx, cy - ry, cx + rx, cy + ry), fill=col(c))

    def ell_line(self, cx, cy, rx, ry, c, w=1):
        self.d.ellipse(self._b(cx - rx, cy - ry, cx + rx, cy + ry), outline=col(c), width=w)

    def rect(self, x0, y0, x1, y1, c):
        self.d.rectangle(self._b(x0, y0, x1, y1), fill=col(c))

    def rrect(self, x0, y0, x1, y1, r, c):
        self.d.rounded_rectangle(self._b(x0, y0, x1, y1), radius=r, fill=col(c))

    def rrect_line(self, x0, y0, x1, y1, r, c, w=1):
        self.d.rounded_rectangle(self._b(x0, y0, x1, y1), radius=r, outline=col(c), width=w)

    def poly(self, pts, c):
        self.d.polygon([(round(x + self.ox), round(y + self.oy)) for x, y in pts], fill=col(c))

    def line(self, pts, c, w=1):
        self.d.line([(round(x + self.ox), round(y + self.oy)) for x, y in pts], fill=col(c), width=w)

    def px(self, x, y, c):
        self.d.point((round(x + self.ox), round(y + self.oy)), fill=col(c))


def stamp(c, pat, x, y, color):
    for dy, row in enumerate(pat):
        for dx, ch in enumerate(row):
            if ch == 'X':
                c.px(x + dx, y + dy, color)


def _shift(m, dy, dx):
    """out[y, x] = m[y+dy, x+dx]（範囲外は 0）。後ろの次元はそのまま"""
    out = np.zeros_like(m)
    h, w = m.shape[:2]
    out[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)] = \
        m[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
    return out


def finish(im, shade=True, outline=True):
    """縁にやわらかい陰影を付け、シルエットの外側に隣の色を暗くした輪郭線を引く"""
    a = np.array(im).astype(int)
    op = a[..., 3] > 0
    if shade:
        lum = a[..., :3].mean(-1)
        dark = ((op & ~_shift(op, 1, 0)) | (op & ~_shift(op, 0, 1))) & (lum > 70)
        light = op & ~_shift(op, -1, 0) & ~dark & (lum > 70)
        a[dark, :3] = (a[dark, :3] * 0.86).astype(int)
        a[light, :3] = np.minimum(255, a[light, :3] * 1.1).astype(int)
    if outline:
        ring = ~op & (_shift(op, 1, 0) | _shift(op, -1, 0) | _shift(op, 0, 1) | _shift(op, 0, -1))
        src = np.zeros_like(a)
        got = np.zeros_like(op)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sel = ring & _shift(op, dy, dx) & ~got
            src[sel] = _shift(a, dy, dx)[sel]
            got |= sel
        a[ring, :3] = (src[ring, :3] * 0.34 + LINE_TINT * 0.5).astype(int)
        a[ring, 3] = 255
    return Image.fromarray(a.astype(np.uint8))


def deform(im, sx, sy, lean, anchor_y, cx=24):
    """体を (cx, anchor_y) を基準に伸び縮みさせ、lean マスぶん上側を前(左)へ傾ける。
    輪郭線を 1 マスに保つため、finish の前にかける。"""
    w, h = im.size
    if sx != 1 or sy != 1:
        scaled = im.resize((max(1, round(w * sx)), max(1, round(h * sy))), Image.NEAREST)
        out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        out.paste(scaled, (round(cx - cx * sx), round(anchor_y - anchor_y * sy)), scaled)
        im = out
    if lean:
        # 出力 (x, y) は入力 (x + k*(anchor_y - y), y) を読む。上端(y=TOP)で lean マス左へずれる
        k = lean / (anchor_y - TOP)
        im = im.transform((w, h), Image.AFFINE, (1, -k, k * anchor_y, 0, 1, 0), resample=Image.NEAREST)
    return im


# ── 顔のパーツ ─────────────────────────────────────────────
def eye(c, x, y, kind, side='l'):
    """(x, y) は 3x4 の目の枠の左上"""
    lk = c.look
    if kind == 'open':
        stamp(c, ['.X.', 'XXX', 'XXX', '.X.'], x + lk, y, EYE)
        c.px(x + lk + 1, y + 1, '#ffffff')
    elif kind == 'half':
        stamp(c, ['XXX', '.X.'], x, y + 2, EYE)
    elif kind == 'closed':
        stamp(c, ['X..X', '.XX.'], x, y + 2, EYE)
    elif kind == 'happy':
        stamp(c, ['.X.', 'X.X'], x, y + 1, EYE)
    elif kind == 'wide':
        stamp(c, ['.XX.', 'XXXX', 'XXXX', 'XXXX', '.XX.'], x + lk, y - 1, EYE)
        c.px(x + lk + 1, y, '#ffffff')
        c.px(x + lk + 2, y + 2, '#ffffff')
    elif kind == 'angry':
        stamp(c, ['X..', '.XX', 'X..'] if side == 'l' else ['..X', 'XX.', '..X'], x, y + 1, EYE)


def blush(c, x, y):
    c.rect(x, y, x + 1, y, BLUSH)


def mouth(c, x, y, kind, style='smile'):
    if kind == 'happy':
        c.rect(x, y, x + 2, y + 1, MOUTH)
        c.px(x + 1, y + 1, '#ff8fa3')
    elif kind == 'wide':
        c.rect(x + 1, y, x + 2, y + 1, MOUTH)
    elif kind == 'angry':
        stamp(c, ['.X.X', 'X.X.'], x, y, MOUTH)
    elif kind == 'closed':
        c.px(x + 1, y, MOUTH)
    elif style == 'w':
        stamp(c, ['X.X.X', '.X.X.'], x, y, MOUTH)
    else:
        stamp(c, ['X.X', '.X.'], x, y, MOUTH)


def legs(st):
    """歩きの左右の足上げ量（0〜2）"""
    if st['anim'] != 'walk':
        return 0, 0
    s = st['s']
    return (2 if s > 0.8 else 1 if s > 0.3 else 0), (2 if s < -0.8 else 1 if s < -0.3 else 0)


def state(anim, i, jump=1.0):
    ph = i * math.pi / 3
    st = {'anim': anim, 'i': i, 'ph': ph, 's': math.sin(ph), 'c': math.cos(ph),
          'dx': 0, 'dy': 0, 'sx': 1.0, 'sy': 1.0, 'lean': 0, 'eye': 'open', 'look': 0}
    if anim == 'sit':
        st['sy'] = [1, 1, 0.97, 0.95, 0.97, 1][i]          # 呼吸
        st['sx'] = [1, 1, 1.02, 1.04, 1.02, 1][i]
        st['look'] = [0, 0, -1, -1, 1, 0][i]               # きょろきょろ
        st['eye'] = 'closed' if i == 5 else 'open'
    elif anim == 'walk':
        st['dy'] = [0, -2, -1, 0, -2, -1][i]
        st['sy'] = [0.95, 1.04, 1, 0.95, 1.04, 1][i]
        st['sx'] = [1.04, 0.97, 1, 1.04, 0.97, 1][i]
        st['lean'] = [1, 2, 1, 1, 2, 1][i]                 # 前のめり
    elif anim == 'happy':
        st['dy'] = round([0, -5, -9, -10, -6, 0][i] * jump)
        st['sy'] = [0.84, 1.12, 1.06, 1, 1.04, 0.88][i]    # ため → 伸び → 着地
        st['sx'] = [1.14, 0.92, 0.96, 1, 0.97, 1.1][i]
        st['lean'] = [0, -1, 1, 0, -1, 0][i]
        st['eye'] = 'happy'
    elif anim == 'dislike':
        st['dx'] = [0, -2, 2, -2, 2, 0][i]
        st['sy'] = [0.96, 0.92, 0.92, 0.92, 0.92, 0.96][i]
        st['sx'] = [1.02, 1.06, 1.06, 1.06, 1.06, 1.02][i]
        st['lean'] = [0, -2, 2, -2, 2, 0][i]
        st['eye'] = 'angry'
    elif anim == 'sleep':
        st['sy'] = [1, 0.97, 0.94, 0.92, 0.95, 0.98][i]
        st['sx'] = [1, 1.02, 1.04, 1.06, 1.03, 1.01][i]
        st['eye'] = 'closed'
    elif anim == 'surprise':
        st['dy'] = round([0, -7, -5, -2, 0, 0][i] * jump)
        st['sy'] = [0.84, 1.16, 1.08, 1.02, 0.94, 1][i]
        st['sx'] = [1.14, 0.88, 0.94, 1, 1.05, 1][i]
        st['lean'] = [0, -2, -1, 0, 0, 0][i]                # のけぞる（上側が後ろ＝右へ）
        st['eye'] = 'wide'
    return st


# ── エフェクト ─────────────────────────────────────────────
HEART = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..']
HEART_S = ['X.X', 'XXX', '.X.']
SPARK = ['..X..', '..X..', 'XXXXX', '..X..', '..X..']
SPARK_S = ['.X.', 'XXX', '.X.']
EXCL = ['XX', 'XX', 'XX', 'XX', '..', 'XX']
DROP = ['.X.', '.X.', 'XXX', 'XXX']
ANGER = ['.X.X.', 'XX.XX', '.....', 'XX.XX', '.X.X.']
ANGER_S = ['X.X', '...', 'X.X']
ZBIG = ['XXXX', '..X.', '.X..', 'XXXX']
ZSMALL = ['XXX', '.X.', 'XXX']
PUFF = ['.XX.', 'XXXX', '.XX.']
PUFF_S = ['XX', 'XX']
SLASH_L = ['X..', '.X.', '..X']
SLASH_R = ['..X', '.X.', 'X..']
DASH = ['XXX']
GLOOM = ['X', '.', 'X', 'X']


def draw_fx(fx, plain, anim, i, ax, ay, back_x):
    """fx は輪郭線あり、plain は輪郭線なし（Z・砂ぼこり・線のエフェクト）"""
    if anim == 'walk':
        if i in (1, 4):
            stamp(plain, PUFF_S, back_x, GROUND - 3, '#dcdcdc')
        elif i in (2, 5):
            stamp(plain, PUFF, back_x + 2, GROUND - 5, '#e8e8e8')
    elif anim == 'happy':
        for k, (hx, hy) in enumerate([(ax + 9, ay - 1), (ax - 14, ay + 3)]):
            t = (i + k * 3) % 6
            if t < 5:
                stamp(fx, HEART if t < 3 else HEART_S, hx + round(math.sin(t)), max(1, hy - t * 2), '#ff7fa0')
        for k, (sx_, sy_) in enumerate([(ax - 16, ay + 10), (ax + 15, ay + 5), (ax + 12, ay + 18)]):
            if (i + k) % 2 == 0:
                stamp(fx, SPARK if k != 2 else SPARK_S, sx_, max(1, sy_), '#ffd95a')
    elif anim == 'surprise':
        if i >= 1:
            stamp(fx, EXCL, ax + 10, max(1, ay - 8 + [0, 0, -2, 0, 0, 0][i]), '#ffb020')
        if i in (1, 2, 3):
            stamp(plain, SLASH_L, ax - 12, max(0, ay - 3), '#9a9a9a')
            stamp(plain, SLASH_R, ax + 16, max(0, ay - 3), '#9a9a9a')
            stamp(plain, DASH, ax - 16, ay + 4, '#9a9a9a')
            stamp(plain, DASH, ax + 19, ay + 4, '#9a9a9a')
        if i >= 2:
            stamp(fx, DROP, ax - 9, ay + 1 + (i - 2) * 2, '#8fd0f5')
    elif anim == 'dislike':
        if i % 2 == 1:
            stamp(fx, ANGER, ax + 8, max(1, ay - 3), '#ff5a5a')
        else:
            stamp(fx, ANGER_S, ax + 9, max(1, ay - 2), '#ff5a5a')
        for k, gx in enumerate((ax - 6, ax - 2, ax + 2)):
            if (i + k) % 2 == 0:
                stamp(plain, GLOOM, gx, max(0, ay - 7 + (i % 2)), '#95a2c4')
    elif anim == 'sleep':
        for k in range(3):
            t = (i + k * 2) % 6
            if t < 5:
                stamp(plain, ZSMALL if t < 2 else ZBIG,
                      min(W - 5, ax + 8 + t + round(math.sin(t * 1.3))), max(0, ay - t * 2), '#5566aa')


# ── キャラクター（すべて左向き。設計座標は高さ 44・地面 y=40）──────────────
def draw_owl(c, st):
    body, belly, dark, disc, beak = '#5363a8', '#ddd6f4', '#43539a', '#fff4de', '#ffab40'
    i, anim, kind = st['i'], st['anim'], st['eye']
    lL, lR = legs(st)
    c.ell(20, 39 - lL, 2, 1, beak)
    c.ell(28, 39 - lR, 2, 1, beak)
    tw = 1 if (anim == 'sit' and i in (4, 5)) else 0
    c.poly([(12, 16), (14 - tw, 8 - tw), (19, 12)], body)
    c.poly([(29, 12), (34 + tw, 8 - tw), (36, 16)], body)
    if anim in ('happy', 'surprise'):
        wy = [29, 19, 17, 23, 19, 28][i]
    elif anim == 'walk':
        wy = [29, 25, 28, 29, 25, 28][i]
    elif anim == 'dislike':
        wy = 32
    elif anim == 'sleep':
        wy = 30
    else:
        wy = [29, 29, 28, 28, 29, 29][i]
    wx = 3 if wy < 23 else 1 if wy < 27 else 0
    c.ell(10 - wx, wy, 3, 5, dark)
    c.ell(38 + wx, wy, 3, 5, dark)
    c.ell(24, 25, 14, 13, body)
    c.ell(24, 34, 8, 5, belly)
    for x in (21, 25):
        stamp(c, ['X.X', '.X.'], x, 33, '#b8aee0')
    c.ell(19, 12, 3, 1, '#7484c4')
    c.ell(18, 22, 6, 6, disc)
    c.ell(30, 22, 6, 6, disc)
    eye(c, 16, 20, kind, 'l')
    eye(c, 29, 20, kind, 'r')
    blush(c, 13, 26)
    blush(c, 33, 26)
    c.poly([(23, 25), (25, 25), (24, 27)], beak)


def draw_snail(c, st):
    foot, shell, line = '#f3dca9', '#fff8ea', '#8db3e8'
    i, anim, kind = st['i'], st['anim'], st['eye']
    walk = anim == 'walk'
    s = [0, 2, 3, 2, 0, -1][i] if walk else 0
    sh = [0, -1, -1, 0, 0, 0][i] if walk else 0
    c.rrect(6 - s, 33, 40, 39, 4, foot)
    c.ell(28, 23 + sh, 11, 11, shell)
    c.ell_line(28, 23 + sh, 8, 8, line)
    c.ell_line(29, 22 + sh, 5, 5, line)
    c.ell_line(30, 21 + sh, 2, 2, line)
    c.line([(21, 16 + sh), (23, 14 + sh)], '#ffffff')
    stamp(c, HEART_S, 33, 27 + sh, '#ffb3c6')
    if anim == 'sleep':
        c.ell(12 - s, 33, 7, 5, foot)
        eye(c, 8 - s, 29, 'closed')
        eye(c, 14 - s, 29, 'closed', 'r')
        blush(c, 7 - s, 34)
        blush(c, 17 - s, 34)
        return
    c.ell(12 - s, 29, 7, 7, foot)
    amp = 2 if anim in ('walk', 'happy') else 1
    ext = -3 if anim == 'surprise' else 3 if anim == 'dislike' else 0
    tx1 = 8 - s + round(amp * math.sin(st['ph']))
    tx2 = 17 - s + round(amp * math.sin(st['ph'] + 1.3))
    ty1 = 15 + ext + round(math.cos(st['ph']))
    ty2 = 15 + ext + round(math.cos(st['ph'] + 1.3))
    if anim == 'dislike':
        tx1, tx2 = tx1 - 2, tx2 + 1
    c.line([(10 - s, 24), (tx1, ty1 + 2)], foot, 2)
    c.line([(14 - s, 24), (tx2, ty2 + 2)], foot, 2)
    c.ell(tx1, ty1, 3, 3, foot)
    c.ell(tx2, ty2, 3, 3, foot)
    eye(c, tx1 - 1, ty1 - 2, kind, 'l')
    eye(c, tx2 - 1, ty2 - 2, kind, 'r')
    blush(c, 6 - s, 31)
    blush(c, 16 - s, 31)
    mouth(c, 10 - s, 31, kind)


def draw_octo(c, st):
    red, pale, shine = '#ff7f76', '#ffc6bf', '#ffdcd7'
    i, anim, kind, ph = st['i'], st['anim'], st['eye'], st['ph']
    amp = {'walk': 2, 'happy': 2, 'dislike': 1, 'surprise': 1, 'sit': 1}.get(anim, 0)
    for k, x in enumerate([14, 19, 24, 29, 34]):
        wig = round(amp * math.sin(ph + k * 0.9))
        end = 35 if anim == 'sleep' else 37 + (round(math.cos(ph + k)) if anim in ('walk', 'happy') else 0)
        c.line([(x, 27), (x + wig, end)], red, 4)
        c.ell(x + wig, end, 2, 1, red)
        c.px(x + wig, end - 3, pale)
    if anim == 'happy':
        ly, ry = (14, 21) if i % 2 == 0 else (21, 14)
    elif anim == 'surprise':
        ly = ry = 14
    elif anim == 'walk':
        ly, ry = 23 - round(4 * abs(st['s'])), 23 - round(4 * abs(st['c']))
    elif anim == 'dislike':
        ly = ry = 28
    elif anim == 'sit':
        ly, ry = 23 + [0, 0, -1, -2, -1, 0][i], 23 + [0, -1, -2, -1, 0, 0][i]
    else:
        ly = ry = 25
    c.line([(13, 24), (8, ly)], red, 4)
    c.line([(35, 24), (40, ry)], red, 4)
    c.ell(8, ly, 2, 2, red)
    c.ell(40, ry, 2, 2, red)
    c.line([(6, ly - 5), (6, ly - 2)], '#5b8fe6', 2)
    c.line([(42, ry - 5), (42, ry - 2)], '#ffcf3a', 2)
    c.ell(24, 17, 13, 12, red)
    c.ell(30, 10, 3, 2, shine)
    eye(c, 17, 14, kind, 'l')
    eye(c, 28, 14, kind, 'r')
    blush(c, 14, 20)
    blush(c, 32, 20)
    mouth(c, 22, 21, kind, 'w')


def draw_clip(c, st):
    plate, wire, limb = '#e8eef6', '#a8bad2', '#8898b0'
    i, anim, kind = st['i'], st['anim'], st['eye']
    lL, lR = legs(st)
    c.line([(20, 36), (20, 38 - lL)], limb, 2)
    c.line([(28, 36), (28, 38 - lR)], limb, 2)
    c.ell(19, 39 - lL, 2, 1, limb)
    c.ell(29, 39 - lR, 2, 1, limb)
    if anim == 'walk':
        la, ra = (9, 27 + round(3 * st['s'])), (39, 27 - round(3 * st['s']))
    elif anim == 'happy':
        la, ra = ((8, 14), (40, 19)) if i % 2 == 0 else ((8, 19), (40, 14))
    elif anim == 'surprise':
        la, ra = (8, 15), (40, 15)
    elif anim == 'dislike':
        la, ra = (12, 32), (36, 32)
    elif anim == 'sleep':
        la, ra = (10, 30), (38, 30)
    else:
        la, ra = (9, 27 + [0, 0, 1, 2, 1, 0][i]), (39, 27 + [0, 1, 2, 1, 0, 0][i])
    c.line([(14, 24), la], limb, 2)
    c.line([(34, 24), ra], limb, 2)
    c.ell(la[0], la[1], 1, 1, limb)
    c.ell(ra[0], ra[1], 1, 1, limb)
    # アホ毛
    c.line([(24, 9), (24, 6)], wire)
    c.px(25, 5, wire)
    c.px(26, 6, wire)
    c.rrect(13, 9, 35, 37, 10, plate)
    # クリップの外側の輪は縁に沿わせ、内側の輪は下半分だけにして顔の場所を空ける
    c.rrect_line(15, 11, 33, 35, 8, wire)
    c.rrect_line(19, 26, 29, 33, 4, wire)
    shine = [13, 14, 15, 16, 15, 14][i]
    c.line([(17, shine), (17, shine + 2)], '#ffffff')
    eye(c, 18, 16, kind, 'l')
    eye(c, 27, 16, kind, 'r')
    blush(c, 15, 22)
    blush(c, 31, 22)
    mouth(c, 22, 22, kind)


def draw_beaver(c, st):
    fur, dark, muz, belly = '#bd8656', '#80552f', '#f6d7ae', '#ebc89e'
    i, anim, kind = st['i'], st['anim'], st['eye']
    lL, lR = legs(st)
    if anim in ('walk', 'happy'):
        tail = round(2 * math.sin(st['ph'] * 2))
    elif anim == 'dislike':
        tail = [0, -3, 0, -3, 0, -3][i]
    elif anim == 'sit':
        tail = [0, 0, 0, -3, 1, 0][i]
    else:
        tail = 0
    c.ell(38, 35 + tail, 6, 3, dark)
    for x in (35, 38, 41):
        c.px(x, 35 + tail, '#a0714a')
    c.ell(22, 39 - lL, 2, 1, dark)
    c.ell(30, 39 - lR, 2, 1, dark)
    c.ell(27, 31, 10, 8, fur)
    c.ell(27, 33, 6, 5, belly)
    wob = round(math.sin(st['ph'])) if anim in ('walk', 'happy', 'dislike') else 0
    c.line([(21, 11), (26 + wob, 4)], '#ffd24a', 2)
    c.px(26 + wob, 4, '#b8c0cc')
    c.px(27 + wob, 4, '#b8c0cc')
    c.rect(27 + wob, 2, 28 + wob, 3, '#ff9fc0')
    ear = 2 if (anim == 'sit' and i in (4, 5)) else 3
    c.ell(11, 11, 2, 2, fur)
    c.ell(24, 10, ear, ear, fur)
    c.ell(18, 19, 11, 10, fur)
    c.ell(12, 23, 5, 4, muz)
    c.rect(7, 21, 9, 22, EYE)
    c.px(8, 21, '#6e6178')
    c.rect(10, 27, 12, 28, '#ffffff')
    c.px(11, 28, '#e4e4e4')
    paw = round(2 * st['s']) if anim in ('walk', 'happy') else (-3 if anim == 'surprise' else 0)
    c.ell(20, 30 + paw, 2, 2, dark)
    c.ell(25, 31 - paw, 2, 2, dark)
    eye(c, 11, 14, kind, 'l')
    eye(c, 20, 14, kind, 'r')
    blush(c, 16, 21)
    blush(c, 24, 20)


def draw_sloth(c, st):
    fur, mask, patch, branch, leaf = '#bccaa0', '#f5ecd5', '#b09878', '#8f6239', '#7cc262'
    i, anim, kind = st['i'], st['anim'], st['eye']
    amp = 3 if anim == 'walk' else 1 if anim in ('sit', 'sleep') else 2 if anim == 'dislike' else 0
    a = round(amp * st['s'])
    if anim == 'sit' and kind == 'open':
        kind = 'half'
    c.line([(3, 6), (45, 7)], branch, 3)
    c.ell(10, 4 + (i % 2 if anim == 'walk' else 0), 2, 1, leaf)
    c.ell(38, 4, 2, 1, leaf)
    c.ell(31, 4, 1, 1, '#ffb3c6')
    c.px(31, 4, '#ffe066')
    c.line([(15, 6), (17 + a, 17)], fur, 4)
    if anim == 'happy':
        # 片手を離して手を振る
        hy = [13, 10, 13, 10, 13, 10][i]
        c.line([(31 + a, 18), (40, hy)], fur, 4)
        c.ell(40, hy, 2, 2, fur)
    else:
        c.line([(33, 6), (31 + a, 17)], fur, 4)
    kick = round(2 * st['c']) if anim in ('walk', 'happy') else 0
    c.line([(21 + a, 33), (20 + a - kick, 37)], fur, 4)
    c.line([(27 + a, 33), (28 + a + kick, 37)], fur, 4)
    c.ell(24 + a, 26, 11, 12, fur)
    c.ell(24 + a, 24, 8, 6, mask)
    c.ell(19 + a, 23, 3, 2, patch)
    c.ell(29 + a, 23, 3, 2, patch)
    eye(c, 18 + a, 21, kind, 'l')
    eye(c, 28 + a, 21, kind, 'r')
    c.rect(23 + a, 25, 24 + a, 25, '#5a4636')
    mouth(c, 22 + a, 27, kind)
    blush(c, 15 + a, 27)
    blush(c, 32 + a, 27)


def draw_whale(c, st):
    body, belly, dark, star, groove = '#5d85cc', '#c6d8f4', '#4a6db0', '#fff2a8', '#a3bde6'
    i, anim, kind = st['i'], st['anim'], st['eye']
    if anim in ('sit', 'walk', 'sleep'):
        c.oy += round(2 * st['s'])
    amp = {'sit': 2, 'walk': 3, 'happy': 4, 'surprise': 3, 'dislike': 2, 'sleep': 1}[anim]
    f = round(amp * math.sin(st['ph'] + 0.8))
    # クジラらしく、持ち上がった尾の先に横長の尾びれを付ける（縦の尾だと魚に見える）
    c.line([(33, 27), (41, 20 + f)], body, 5)
    c.ell(43, 18 + f, 4, 2 if abs(f) < 3 else 1, body)
    c.ell(22, 26, 15, 11, body)
    c.ell(21, 32, 11, 5, belly)
    for x in (13, 17, 21, 25):
        c.line([(x, 32), (x + 2, 32)], groove)
    c.ell(26, 34 + (1 if i % 2 else -1), 3, 2, dark)
    for k, (x, y) in enumerate([(22, 19), (29, 18), (32, 23), (18, 21), (26, 23)]):
        c.px(x, y, star if (i + k) % 3 else '#fffbe0')
    c.ell(16, 18, 3, 1, '#7ea0dc')
    eye(c, 10, 22, kind, 'l')
    blush(c, 13, 28)
    mouth(c, 6, 28, kind)
    if anim in ('sit', 'walk', 'happy', 'surprise'):
        # 潮に混ざった紙きれとしずくが、吹き上がって左右に散る
        for k in range(3):
            t = (i + k * 2) % 6
            if t < 5:
                x = 14 + (k - 1) * (1 + t)
                y = 13 - t * 2
                if k == 1:
                    c.rect(x, y, x + 3, y + 2, '#ffffff')
                    c.line([(x, y + 1), (x + 3, y + 1)], '#8db3e8')
                else:
                    stamp(c, DROP, x, y, '#a9d8ff')


def draw_phoenix(c, st):
    red, gold, orange, dark = '#ff6a50', '#ffd760', '#ffa640', '#e8503a'
    i, anim, kind = st['i'], st['anim'], st['eye']
    lL, lR = legs(st)
    c.line([(22, 36), (22, 39 - lL)], orange)
    c.line([(26, 36), (26, 39 - lR)], orange)
    c.px(21, 39 - lL, orange)
    c.px(25, 39 - lR, orange)
    t = 0 if anim == 'sleep' else round((3 if anim in ('walk', 'happy') else 2) * math.sin(st['ph']))
    c.poly([(30, 29), (43, 19 + t), (40, 26)], gold)
    c.poly([(30, 28), (45, 25 + t), (40, 30)], orange)
    c.poly([(30, 27), (43, 33 + t), (37, 33)], red)
    c.ell(25, 30, 9, 7, red)
    c.ell(23, 32, 5, 4, gold)
    c.ell(18, 20, 9, 8, red)
    c.ell(21, 14, 2, 1, '#ff9f8a')
    fl = [(0, 0, 0), (1, -1, 1), (-1, 1, 0), (0, -1, -1), (1, 1, 0), (-1, 0, 1)][i]
    c.poly([(14, 14), (14, 8 - fl[0]), (18, 13)], gold)
    c.poly([(17, 12), (19, 6 - fl[1]), (22, 12)], orange)
    c.poly([(20, 13), (24, 9 - fl[2]), (24, 15)], gold)
    c.poly([(9, 20), (9, 23), (6, 21)], gold)
    flap = anim in ('walk', 'happy', 'surprise') and i % 2 == 1
    if flap:
        c.poly([(24, 28), (32, 17), (35, 25), (33, 31)], dark)
        c.poly([(26, 27), (32, 20), (33, 27)], orange)
    else:
        c.ell(29, 30, 5, 3, dark)
    eye(c, 12, 17, kind, 'l')
    blush(c, 15, 23)


def draw_haniwa(c, st):
    clay, dark, hole, shine = '#e2a676', '#c08453', '#4a3226', '#f2c49c'
    i, anim, kind = st['i'], st['anim'], st['eye']
    c.rect(16, 36, 32, 39, clay)
    c.rrect(17, 21, 31, 38, 5, clay)
    if anim in ('walk', 'happy'):
        ly, ry = (15, 34) if i % 2 == 0 else (25, 21)      # 腕を交互に上げ下げして踊る
    elif anim == 'surprise':
        ly, ry = 13, 15
    elif anim in ('dislike', 'sleep'):
        ly, ry = 33, 35
    else:
        ly, ry = 17 + [0, 0, 1, 2, 1, 0][i], 33 - [0, 0, 1, 2, 1, 0][i]
    c.line([(17, 26), (10, ly)], clay, 4)
    c.line([(31, 28), (38, ry)], clay, 4)
    c.ell(10, ly, 2, 2, clay)
    c.ell(38, ry, 2, 2, clay)
    c.ell(24, 15, 9, 8, clay)
    c.ell(20, 10, 2, 1, shine)
    c.line([(18, 32), (30, 32)], dark)
    for x in (20, 24, 28):
        c.px(x, 34, dark)
    for ex, side in ((19, 'l'), (27, 'r')):
        if kind == 'open':
            c.ell(ex + 1 + c.look, 14, 1, 2, hole)
        elif kind == 'wide':
            # 穴を大きくすると叫び顔に見えて怖いので、縦に 1 マス伸ばすだけにする
            c.ell(ex + 1, 13, 1, 3, hole)
        else:
            eye(c, ex, 11, kind, side)
    blush(c, 16, 19)
    blush(c, 31, 19)
    if kind in ('open', 'happy'):
        c.ell(24, 20, 1, [1, 1, 2, 1, 1, 2][i], hole)
    elif kind == 'wide':
        c.rect(24, 20, 24, 21, hole)
    else:
        c.px(24, 20, hole)


def draw_rabbit(c, st):
    white, pink, tip, wood, handle = '#fffaf3', '#ffbccb', '#ffd96b', '#dcb07a', '#9a6a3f'
    i, anim, kind = st['i'], st['anim'], st['eye']
    lL, lR = legs(st)
    sleep = anim == 'sleep'
    bounce = [0, -2, -1, 0, -2, -1][i] if anim in ('walk', 'happy') else 0
    flop = round(math.sin(st['ph'])) if anim in ('walk', 'happy', 'sit') else 0
    ey = 11 + (5 if sleep else 3 if anim == 'dislike' else 0)
    for k, ex in enumerate((16, 23)):
        lean = flop if k == 0 else -flop
        c.ell(ex + lean, ey + bounce, 3, 6, white)
        c.ell(ex + lean, ey + 1 + bounce, 1, 4, pink)
        c.ell(ex + lean * 2, ey - 5 + bounce, 2, 1, tip)
    c.ell(21, 39 - lL, 3, 1, white)
    c.ell(29, 39 - lR, 3, 1, white)
    c.ell(26, 33, 9, 6, white)
    c.ell(35, 32, 2, 2, white)
    if anim == 'sit':
        hx, hy = [(38, 16), (37, 12), (36, 10), (39, 20), (41, 28), (39, 22)][i]   # 餅つき
    elif anim == 'walk':
        hx, hy = 38, 18 + (i % 2)
    elif anim == 'happy':
        hx, hy = 37, [14, 9, 7, 8, 10, 13][i]
    elif anim == 'surprise':
        hx, hy = 40, [18, 11, 12, 14, 16, 18][i]
    elif anim == 'dislike':
        hx, hy = 42, 34
    else:
        hx, hy = 40, 32
    c.line([(32, 31), (hx, hy)], handle, 2)
    c.rrect(hx - 3, hy - 4, hx + 3, hy, 2, wood)
    c.ell(20, 23, 10, 9, white)
    eye(c, 14, 20, kind, 'l')
    eye(c, 22, 20, kind, 'r')
    blush(c, 11, 25)
    blush(c, 25, 25)
    mouth(c, 17, 26, kind, 'w')
    if anim == 'sit' and i == 4:
        stamp(c, SPARK_S, hx + 3, hy + 1, '#ffffff')


MONS = [
    dict(id='yofukashi', prefix='yk', draw=draw_owl, top=(24, 8)),
    dict(id='noronoron', prefix='nr', draw=draw_snail, top=(27, 12), shadow=(23, 18), back=42),
    dict(id='takoashi', prefix='tk', draw=draw_octo, top=(24, 5)),
    dict(id='tomepin', prefix='tp', draw=draw_clip, top=(24, 5), back=34),
    dict(id='damtsumi', prefix='dm', draw=draw_beaver, top=(20, 5), back=42),
    dict(id='atomawashi', prefix='at', draw=draw_sloth, top=(24, 12), shadow=(24, 8), jump=0.2, anchor=6, lean=False),
    dict(id='wasurekujira', prefix='wk', draw=draw_whale, top=(18, 12), shadow=(23, 11), anchor=26),
    dict(id='fukkatsudori', prefix='fk', draw=draw_phoenix, top=(18, 5), back=38),
    dict(id='haniwan', prefix='hn', draw=draw_haniwa, top=(24, 6), back=34),
    dict(id='tsukimimochi', prefix='tm', draw=draw_rabbit, top=(21, 5), back=34),
]


def render(mon, anim, i):
    st = state(anim, i, mon.get('jump', 1.0))
    scx, srx = mon.get('shadow', (24, 12))
    base = Cv()
    base.ell(scx, GROUND, max(4, round(srx * st['sx']) + round(min(0, st['dy']) * 0.6)), 1.5, '#d2d2d2')
    body = Cv()
    body.ox, body.oy, body.look = st['dx'], TOP + st['dy'], st['look']
    mon['draw'](body, st)
    anchor = mon.get('anchor', 40) + TOP + st['dy']
    # 枝にぶら下がる子は基準点が上にあり、傾けると足元が大きくずれてねじれるので傾けない
    lean = st['lean'] if mon.get('lean', True) else 0
    body_im = deform(body.im, st['sx'], st['sy'], lean, anchor, 24 + st['dx'])
    fx, plain = Cv(), Cv()
    ax, ay = mon['top']
    draw_fx(fx, plain, anim, i, ax + st['dx'], ay + TOP + st['dy'], mon.get('back', 36))
    out = base.im
    out.alpha_composite(finish(body_im))
    out.alpha_composite(finish(fx.im, shade=False))
    out.alpha_composite(plain.im)
    return out


# ── アイテム ───────────────────────────────────────────────
def item_lens(c):
    c.ell_line(20, 5, 2, 2, '#e0b44a', 1)
    c.ell(20, 21, 13, 13, '#e0b44a')
    c.ell(20, 21, 10, 10, '#c9ecfa')
    c.ell(16, 16, 3, 2, '#ffffff')
    c.px(25, 26, '#ffffff')
    stamp(c, HEART_S, 23, 22, '#ffb3c6')


def item_shell(c):
    c.ell(20, 21, 14, 13, '#fff8ea')
    c.ell_line(20, 21, 10, 10, '#8db3e8')
    c.ell_line(21, 20, 6, 6, '#8db3e8')
    c.ell_line(22, 19, 2, 2, '#8db3e8')
    c.line([(11, 13), (13, 11)], '#ffffff')


def item_stamp(c):
    c.ell(20, 9, 5, 4, '#ff7f76')
    c.rect(17, 12, 23, 20, '#ff7f76')
    c.rrect(8, 20, 32, 30, 4, '#ff9f98')
    c.rect(8, 30, 32, 33, '#e0625a')
    for x in (13, 20, 27):
        c.ell_line(x, 25, 2, 2, '#ffd6d0')
    c.ell(18, 7, 1, 1, '#ffd6d0')


def item_clip(c):
    c.rrect_line(12, 4, 28, 36, 8, '#f0c24f', 3)
    c.rrect_line(16, 10, 24, 30, 4, '#f0c24f', 3)
    c.px(14, 9, '#fff3c0')


def item_twig(c):
    c.line([(6, 34), (34, 6)], '#9a6a3f', 4)
    for x, y in [(14, 26), (20, 20), (26, 14)]:
        c.px(x, y, '#6e4826')
        c.px(x + 1, y - 1, '#6e4826')
    c.ell(30, 16, 4, 2, '#7cc262')
    c.ell(10, 25, 1, 1, '#ffb3c6')


def item_branch(c):
    c.line([(4, 25), (36, 18)], '#8f6239', 4)
    for x, y, g in [(12, 17, '#7cc262'), (22, 28, '#6ab04f'), (30, 11, '#8fd070')]:
        c.ell(x, y, 4, 3, g)
    c.ell(33, 23, 2, 2, '#ffb3c6')
    c.px(33, 23, '#ffe066')


def item_pearl(c):
    c.ell(20, 21, 12, 12, '#f7f3fb')
    c.ell(22, 24, 8, 8, '#ebe1f6')
    c.ell(15, 15, 3, 3, '#ffffff')
    stamp(c, SPARK, 31, 5, '#ffd95a')
    stamp(c, SPARK_S, 5, 30, '#ffd95a')


def item_feather(c):
    c.poly([(9, 35), (14, 22), (24, 8), (33, 4), (30, 14), (20, 28)], '#ff6a50')
    c.poly([(12, 31), (18, 21), (27, 10), (30, 9), (23, 23)], '#ffd760')
    c.line([(9, 35), (31, 6)], '#e8503a')


def item_shard(c):
    c.poly([(6, 14), (20, 5), (34, 11), (31, 30), (14, 35), (8, 26)], '#e2a676')
    for a, b in [((12, 15), (20, 13)), ((14, 20), (26, 18)), ((13, 25), (22, 24))]:
        c.line([a, b], '#b27a4c')


def item_dango(c):
    c.rect(6, 30, 34, 33, '#dcb07a')
    c.rect(9, 33, 31, 36, '#b98a55')
    c.ell(20, 21, 9, 8, '#fffaf3')
    c.px(16, 17, '#ffffff')
    blush(c, 15, 23)
    blush(c, 24, 23)
    stamp(c, ['X.X', '.X.'], 19, 22, MOUTH)


ITEMS = [
    ('yofukashi_lens', item_lens), ('noronoron_shell', item_shell), ('takoashi_stamp', item_stamp),
    ('tomepin_clip', item_clip), ('damtsumi_twig', item_twig), ('atomawashi_branch', item_branch),
    ('wasurekujira_pearl', item_pearl), ('fukkatsudori_feather', item_feather),
    ('haniwan_shard', item_shard), ('tsukimimochi_dango', item_dango),
]


def main():
    sp_dir, it_dir = os.path.join(OUT, 'sprites'), os.path.join(OUT, 'items')
    os.makedirs(sp_dir, exist_ok=True)
    os.makedirs(it_dir, exist_ok=True)
    n = 0
    frames = {}
    for mon in MONS:
        for anim in ANIMS:
            for i in range(6):
                im = render(mon, anim, i)
                frames[(mon['prefix'], anim, i)] = im
                im.resize((W * S, H * S), Image.NEAREST).save(
                    os.path.join(sp_dir, f"{mon['prefix']}_{anim}_{i}.png"), optimize=True)
                n += 1
    for iid, fn in ITEMS:
        c = Cv(IW, IW)
        fn(c)
        finish(c.im).resize((IW * IS, IW * IS), Image.NEAREST).save(os.path.join(it_dir, f'{iid}.png'), optimize=True)

    T = 2
    tw, th = W * T, H * T
    # 状態ごとに 1 枚。行=メモモン、列=6 コマ
    for anim in ANIMS:
        sheet = Image.new('RGBA', (tw * 6, th * len(MONS)), (246, 244, 240, 255))
        for r, mon in enumerate(MONS):
            for i in range(6):
                sheet.alpha_composite(frames[(mon['prefix'], anim, i)].resize((tw, th), Image.NEAREST), (i * tw, r * th))
        sheet.save(os.path.join(OUT, f'preview_{anim}.png'))
    # 全体: 行=状態、列=メモモン（各状態の見せ場のコマ）
    key = {'sit': 0, 'walk': 1, 'happy': 2, 'dislike': 1, 'sleep': 2, 'surprise': 1}
    sheet = Image.new('RGBA', (tw * len(MONS), th * len(ANIMS)), (246, 244, 240, 255))
    for r, anim in enumerate(ANIMS):
        for ci, mon in enumerate(MONS):
            sheet.alpha_composite(frames[(mon['prefix'], anim, key[anim])].resize((tw, th), Image.NEAREST), (ci * tw, r * th))
    sheet.save(os.path.join(OUT, 'preview_all.png'))
    items = Image.new('RGBA', (IW * IS * 5, IW * IS * 2), (246, 244, 240, 255))
    for k, (iid, _) in enumerate(ITEMS):
        items.alpha_composite(Image.open(os.path.join(it_dir, f'{iid}.png')), ((k % 5) * IW * IS, (k // 5) * IW * IS))
    items.save(os.path.join(OUT, 'preview_items.png'))
    print('sprites', n, 'items', len(ITEMS), 'size', (W * S, H * S))


if __name__ == '__main__':
    main()
