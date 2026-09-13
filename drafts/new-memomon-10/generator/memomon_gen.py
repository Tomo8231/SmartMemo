"""新メモモン 10 体のスプライト(6 状態 x 6 コマ)となつき MAX アイテムをドット絵で生成する。
usage: python memomon_gen.py
出力: new_memomon/sprites/<prefix>_<anim>_<i>.png, new_memomon/items/<id>.png, new_memomon/preview_*.png

かわいさの付け方
  - 頭を大きく体を小さく（ちびキャラの比率）。手足は短く太く、先を丸くする
  - 目は 3x4 の丸目にハイライト。閉じ目は ∪、笑い目は ∩
  - 全員にほっぺ。口は ω や小さな笑顔を表情ごとに変える
  - 輪郭線は黒一色にせず、隣の色を暗くした色付きの線にする
動きの付け方
  - 体全体: 大きさを固定し、上下(dy)・左右(dx) の移動だけを付ける
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


def finish(im, shade=False, outline=True):
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
    c.ell(x+1, y, 2, 1, BLUSH)


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
    # Fixed proportions: animate translation and limbs, never rescale the body.
    ph = i * math.pi / 3
    st = dict(anim=anim, i=i, ph=ph, s=math.sin(ph), c=math.cos(ph),
              dx=0, dy=0, sx=1, sy=1, lean=0, eye='open', look=0)
    if anim == 'sit':
        st['look'] = [0, 0, -1, -1, 0, 0][i]
        st['dy'] = [0, 0, -1, -1, 0, 0][i]
        st['eye'] = 'closed' if i == 5 else 'open'
    elif anim == 'walk':
        st['dy'] = [0, -1, -2, 0, -1, -2][i]
    elif anim == 'happy':
        st['dy'] = round([0, -3, -6, -6, -3, 0][i] * jump)
        st['eye'] = 'happy'
    elif anim == 'dislike':
        st['dx'] = [0, -1, 1, -1, 1, 0][i]
        st['eye'] = 'angry'
    elif anim == 'sleep':
        st['dy'] = [0, 0, -1, -1, 0, 0][i]
        st['eye'] = 'closed'
    elif anim == 'surprise':
        st['dy'] = round([0, -5, -4, -2, 0, 0][i] * jump)
        st['eye'] = 'wide'
    return st


HEART = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..']
HEART_S = ['X.X', 'XXX', '.X.']
SPARK = ['..X..', '..X..', 'XXXXX', '..X..', '..X..']
SPARK_S = ['.X.', 'XXX', '.X.']
EXCL = ['XX', 'XX', 'XX', 'XX', '..', 'XX']
ANGER_S = ['X.X', '...', 'X.X']
ZSMALL = ['XXX', '.X.', 'XXX']
PUFF_S = ['XX', 'XX']


def draw_fx(fx, plain, anim, i, ax, ay, back_x):
    if anim == 'happy':
        stamp(plain, HEART if i%3 != 2 else HEART_S, 37, 10-i%3, '#ef8ba7')
    elif anim == 'dislike':
        stamp(plain, ANGER_S, 38, 13+i%2, '#df7890')
    elif anim == 'sleep':
        stamp(plain, ZSMALL, 37+i%2, 13-i%3, '#8290bd')
    elif anim == 'surprise' and i > 0:
        stamp(plain, EXCL, 39, 9+i%2, '#e9ad5b')
    elif anim == 'walk' and i in (2, 5):
        stamp(plain, PUFF_S, min(back_x, 43), GROUND-3, '#e1d4c9')


def draw_owl(c, st):
    navy, blue, cream = '#515798', '#737dc1', '#fff2d9'
    a, b = legs(st)
    c.ell(18, 39-a, 3, 1, '#ffbf70')
    c.ell(28, 39-b, 3, 1, '#ffbf70')
    c.ell(25, 27, 14, 12, navy)
    # Soft ear tufts merge into a broad, round head.
    c.ell(16, 15, 4, 4, navy)
    c.ell(31, 15, 4, 4, navy)
    c.ell(23, 23, 14, 12, navy)
    c.ell(18, 15, 5, 2, blue)
    c.ell(22, 32, 9, 6, '#d7d6f5')
    c.ell(16, 25, 6, 7, cream)
    c.ell(27, 25, 7, 7, cream)
    wy = 25 if st['anim'] in ('happy', 'surprise') else 31
    c.ell(36, wy + (st['i']%2), 4, 5, blue)
    eye(c, 12, 24, st['eye'])
    eye(c, 24, 24, st['eye'], 'r')
    blush(c, 10, 30)
    blush(c, 29, 30)
    c.poly([(19, 29), (23, 29), (20, 32)], '#ffbd69')


def draw_snail(c, st):
    honey, light, paper, blue = '#f6cb82', '#ffe7b3', '#fff6e2', '#a3c4e9'
    wave = round(st['s']) if st['anim'] == 'walk' else 0
    c.rrect(7, 34, 39, 39, 3, honey)
    c.ell(29, 26, 11, 11, blue)
    c.ell(28, 24, 10, 10, paper)
    # A small memo page is the shell's identity; no concentric line noise.
    c.rrect(23, 17, 33, 30, 2, '#ffffff')
    c.line([(25, 22), (31, 22)], blue)
    c.line([(25, 26), (29, 26)], blue)
    for x in (25, 29, 32):
        c.rect(x, 16, x, 18, '#7d9dca')
    c.ell(12, 30, 9, 8, honey)
    c.ell(10, 30, 6, 6, light)
    for x, side in ((7, 'l'), (18, 'r')):
        yy = 22 + (wave if side == 'l' else -wave)
        c.rrect(x-2, yy, x+2, 30, 2, honey)
        c.ell(x, yy, 4, 4, light)
        eye(c, x-1, yy-2, st['eye'], side)
    blush(c, 5, 32)
    blush(c, 17, 33)
    mouth(c, 10, 34, st['eye'])


def draw_octo(c, st):
    red, dark, pale = '#fa8a93', '#df637e', '#ffd1d0'
    # Overlapping rounded curls replace the row of straight tentacles.
    for k, x in enumerate((12, 19, 27, 34)):
        lift = round(1.5*math.sin(st['ph']+k)) if st['anim'] == 'walk' else 0
        c.ell(x, 35-lift, 4, 4, dark)
        c.ell(x-1, 34-lift, 3, 3, red)
        c.ell(x, 37-lift, 2, 1, pale)
    c.ell(23, 25, 14, 12, red)
    c.ell(18, 17, 5, 2, pale)
    yy = 28 if st['anim'] in ('happy', 'surprise') else 33
    c.ell(8, yy, 4, 3, red)
    c.ell(37, 32, 4, 3, red)
    c.rrect(5, yy-8, 7, yy+1, 1, '#7399d9')
    c.poly([(5, yy+2), (7, yy+2), (6, yy+4)], '#ffe7b3')
    c.ell(8, yy, 3, 2, red)
    eye(c, 13, 25, st['eye'])
    eye(c, 25, 25, st['eye'], 'r')
    blush(c, 10, 31)
    blush(c, 29, 31)
    mouth(c, 19, 31, st['eye'])


def draw_clip(c, st):
    metal, light, shade = '#9ecedc', '#e5faff', '#679caf'
    a, b = legs(st)
    c.ell(19, 39-a, 3, 1, shade)
    c.ell(28, 39-b, 3, 1, shade)
    yy = 24 if st['anim'] in ('happy', 'surprise') else 32
    c.ell(10, yy, 3, 3, metal)
    c.ell(35, yy+st['i']%2, 3, 3, metal)
    # Actual open paperclip silhouette, with a little face on its broad top.
    c.rrect(12, 12, 33, 38, 10, metal)
    c.rrect(17, 27, 28, 35, 4, (0, 0, 0, 0))
    c.rrect(23, 30, 26, 36, 1, metal)
    c.line([(15, 22), (15, 18), (18, 15), (24, 15)], light, 2)
    c.ell(21, 21, 10, 7, metal)
    eye(c, 14, 20, st['eye'])
    eye(c, 25, 20, st['eye'], 'r')
    blush(c, 12, 25)
    blush(c, 29, 25)
    mouth(c, 19, 26, st['eye'])


def draw_beaver(c, st):
    fur, dark, cream = '#cc935e', '#9e674e', '#ffe5bb'
    a, b = legs(st)
    c.ell(37, 35, 6, 4, dark)
    c.line([(36, 33), (39, 35)], '#bd855f')
    c.ell(19, 39-a, 3, 1, dark)
    c.ell(29, 39-b, 3, 1, dark)
    c.ell(25, 32, 10, 7, fur)
    c.ell(23, 33, 6, 5, cream)
    c.rrect(24, 7, 27, 17, 1, '#ffcf75')
    c.rect(24, 7, 27, 9, '#f39bac')
    c.ell(12, 16, 4, 4, fur)
    c.ell(28, 16, 4, 4, fur)
    c.ell(12, 16, 2, 2, cream)
    c.ell(28, 16, 2, 2, cream)
    c.ell(20, 24, 13, 11, fur)
    c.ell(16, 16, 4, 1, '#eab77f')
    c.ell(12, 29, 6, 4, cream)
    c.ell(9, 27, 2, 1, dark)
    c.rrect(13, 32, 16, 35, 1, '#fff9eb')
    eye(c, 11, 23, st['eye'])
    eye(c, 23, 23, st['eye'], 'r')
    blush(c, 8, 30)
    blush(c, 27, 29)
    yy = 29 if st['anim'] in ('happy', 'surprise') else 34
    c.ell(28, yy, 3, 3, fur)


def draw_sloth(c, st):
    fur, cream, patch = '#b7ce95', '#fff3d9', '#c8b48c'
    swing = round(st['s'])
    c.line([(10, 10), (37, 10)], '#bd9167', 2)
    c.ell(34, 8, 3, 2, '#91c57e')
    c.rrect(14, 10, 19, 22, 2, fur)
    c.rrect(29, 10, 34, 23, 2, fur)
    c.ell(24+swing, 29, 11, 10, fur)
    c.ell(18+swing, 38, 3, 2, fur)
    c.ell(29+swing, 38, 3, 2, fur)
    c.ell(22+swing, 26, 13, 10, fur)
    c.ell(20+swing, 27, 11, 8, cream)
    c.ell(14+swing, 27, 4, 3, patch)
    c.ell(26+swing, 27, 4, 3, patch)
    eye(c, 12+swing, 25, st['eye'])
    eye(c, 24+swing, 25, st['eye'], 'r')
    c.ell(19+swing, 30, 1, 1, '#82694e')
    mouth(c, 18+swing, 32, st['eye'])
    blush(c, 10+swing, 31)
    blush(c, 29+swing, 31)


def draw_whale(c, st):
    blue, light, dark = '#7589ce', '#dfecff', '#5c6fb2'
    wag = round(st['s'])
    c.line([(33, 29), (39, 25+wag)], blue, 5)
    c.ell(37, 22+wag, 4, 3, blue)
    c.ell(42, 22+wag, 2, 3, blue)
    c.ell(22, 29, 15, 11, blue)
    c.ell(19, 35, 11, 5, light)
    c.ell(16, 21, 5, 2, '#a5b6e8')
    c.ell(28, 35+wag, 4, 3, dark)
    stamp(c, SPARK_S, 29, 24, '#fff0b4')
    eye(c, 11, 28, st['eye'])
    blush(c, 13, 34)
    mouth(c, 7, 34, st['eye'])
    if st['anim'] not in ('sleep', 'dislike'):
        yy = 13 - st['i']%3
        c.ell(18, yy, 2, 2, '#b8e4f6')
        c.ell(23, yy+2, 2, 1, '#b8e4f6')


def draw_phoenix(c, st):
    coral, gold, orange = '#f98772', '#ffe19a', '#ffb363'
    a, b = legs(st)
    c.ell(19, 39-a, 3, 1, orange)
    c.ell(27, 39-b, 3, 1, orange)
    wag = round(st['s'])
    c.ell(36, 30+wag, 6, 4, coral)
    c.ell(38, 26+wag, 4, 5, orange)
    c.ell(38, 24+wag, 2, 3, gold)
    c.ell(24, 31, 11, 8, coral)
    c.ell(20, 33, 7, 5, gold)
    c.ell(18, 14, 3, 4, orange)
    c.ell(23, 15, 3, 3, gold)
    c.ell(19, 24, 11, 10, coral)
    c.ell(16, 17, 4, 2, '#ffbaa0')
    c.ell(8, 27, 3, 2, gold)
    yy = 26 if st['anim'] in ('happy', 'surprise') else 32
    c.ell(29, yy, 5, 4, orange)
    c.ell(29, yy-1, 3, 2, gold)
    eye(c, 12, 24, st['eye'])
    blush(c, 14, 30)


def draw_haniwa(c, st):
    clay, light, dark = '#eab085', '#ffd6ad', '#bf805f'
    c.rrect(15, 27, 32, 39, 5, clay)
    c.ell(23, 38, 10, 2, clay)
    dance = st['anim'] in ('walk', 'happy')
    ly, ry = ((24, 32) if st['i']%2 == 0 else (30, 23)) if dance else (24, 32)
    if st['anim'] == 'surprise':
        ly, ry = 22, 23
    if st['anim'] == 'sleep':
        ly, ry = 33, 34
    c.line([(16, 31), (10, ly)], clay, 5)
    c.line([(30, 30), (36, ry)], clay, 5)
    c.ell(10, ly, 3, 3, clay)
    c.ell(36, ry, 3, 3, clay)
    c.rrect(10, 13, 34, 32, 9, clay)
    c.ell(17, 16, 4, 1, light)
    eye(c, 14, 24, st['eye'])
    eye(c, 25, 24, st['eye'], 'r')
    blush(c, 11, 29)
    blush(c, 29, 29)
    mouth(c, 19, 30, st['eye'])
    c.line([(19, 36), (27, 36)], dark)


def draw_rabbit(c, st):
    white, pink, gold = '#fff5df', '#ffc3ce', '#f6d382'
    a, b = legs(st)
    c.ell(18, 39-a, 3, 1, white)
    c.ell(28, 39-b, 3, 1, white)
    c.ell(26, 33, 9, 6, white)
    c.ell(35, 34, 3, 3, white)
    for x, yy in ((14, 14), (24, 13)):
        c.ell(x, yy, 3, 7, white)
        c.ell(x, yy, 1, 4, pink)
    c.ell(19, 27, 12, 10, white)
    stamp(c, SPARK_S, 18, 18, gold)
    eye(c, 10, 26, st['eye'])
    eye(c, 22, 26, st['eye'], 'r')
    blush(c, 8, 32)
    blush(c, 26, 32)
    mouth(c, 16, 32, st['eye'])
    yy = 25 + ([0, -1, -2, 0, 2, 1][st['i']] if st['anim'] == 'sit' else 0)
    c.line([(31, 35), (35, yy)], '#c19469', 2)
    c.rrect(31, yy-2, 39, yy+2, 2, '#e6bc86')
    c.line([(33, yy-1), (36, yy-1)], '#ffe0ad')
    c.ell(30, 34, 3, 2, white)


MONS = [
    dict(id='yofukashi', prefix='yk', draw=draw_owl, top=(24, 8)),
    dict(id='noronoron', prefix='nr', draw=draw_snail, top=(27, 12), shadow=(23, 18), back=42),
    dict(id='takoashi', prefix='tk', draw=draw_octo, top=(24, 5)),
    dict(id='tomepin', prefix='tp', draw=draw_clip, top=(24, 5), back=34),
    dict(id='damtsumi', prefix='dm', draw=draw_beaver, top=(20, 5), back=42),
    dict(id='atomawashi', prefix='at', draw=draw_sloth, top=(24, 12), shadow=(24, 12), jump=0.2),
    dict(id='wasurekujira', prefix='wk', draw=draw_whale, top=(18, 12), shadow=(23, 11), anchor=26),
    dict(id='fukkatsudori', prefix='fk', draw=draw_phoenix, top=(18, 5), back=38),
    dict(id='haniwan', prefix='hn', draw=draw_haniwa, top=(24, 6), back=34),
    dict(id='tsukimimochi', prefix='tm', draw=draw_rabbit, top=(21, 5), back=34),
]


def render(mon, anim, i):
    st = state(anim, i, mon.get('jump', 1.0))
    scx, srx = mon.get('shadow', (24, 12))
    base = Cv()
    base.ell(scx, GROUND, max(4, round(srx * st['sx']) + round(min(0, st['dy']) * 0.6)), 1.5, '#ded6de')
    body = Cv()
    body.ox, body.oy, body.look = st['dx'], TOP + st['dy'], st['look']
    mon['draw'](body, st)
    # 全コマで同じ論理座標・比率を保つ。地面の影は移動させない。
    body_im = body.im
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
    c.ell_line(20, 7, 3, 3, '#e8b76c', 2)
    c.ell(20, 23, 12, 12, '#e8b76c')
    c.ell(20, 23, 9, 9, '#b9dfea')
    c.ell(17, 19, 4, 3, '#edfcff')
    stamp(c, HEART, 22, 25, '#f6a5b7')


def item_shell(c):
    c.ell(20, 23, 13, 12, '#a3c4e9')
    c.ell(19, 21, 12, 11, '#fff1d5')
    c.rrect(12, 13, 26, 29, 3, '#fffefa')
    for x in (15, 20, 24):
        c.rect(x, 11, x+1, 14, '#7d9dca')
    c.line([(15, 19), (23, 19)], '#a3c4e9')
    c.line([(15, 23), (20, 23)], '#a3c4e9')
    stamp(c, HEART_S, 24, 27, '#f3a6b9')


def item_stamp(c):
    c.ell(20, 12, 7, 6, '#fa8a93')
    c.rrect(16, 14, 24, 24, 3, '#fa8a93')
    c.rrect(8, 24, 32, 33, 4, '#df637e')
    c.rrect(8, 22, 32, 29, 3, '#ffb9b9')
    stamp(c, HEART, 18, 23, '#fff2de')
    c.ell(17, 9, 2, 1, '#ffd1d0')


def item_clip(c):
    c.rrect_line(11, 6, 29, 34, 8, '#e8bb73', 4)
    c.rrect_line(17, 13, 24, 30, 3, '#e8bb73', 3)
    c.line([(13, 16), (13, 12), (16, 9)], '#fff0bc')
    stamp(c, HEART, 26, 6, '#f4a6b9')


def item_twig(c):
    c.line([(10, 31), (30, 11)], '#bf895e', 5)
    c.ell(10, 31, 2, 2, '#eac294')
    c.ell(29, 17, 5, 3, '#a4cd87')
    c.ell(24, 12, 3, 4, '#c1dfa3')
    c.line([(14, 26), (23, 17)], '#eac294')


def item_branch(c):
    c.line([(8, 27), (32, 23)], '#bf946d', 4)
    c.ell(8, 27, 2, 2, '#ebc99c')
    c.line([(17, 25), (17, 18)], '#bf946d', 2)
    c.ell(13, 17, 4, 3, '#a5ce8c')
    c.ell(22, 16, 5, 3, '#c0dfa2')
    for x, y in ((29, 19), (32, 16), (35, 19), (32, 22)):
        c.ell(x, y, 2, 2, '#ffc2ce')
    c.ell(32, 19, 1, 1, '#ffe39a')


def item_pearl(c):
    c.ell(20, 23, 11, 11, '#b8b6e3')
    c.ell(19, 21, 10, 10, '#e6dff6')
    c.ell(16, 17, 4, 3, '#fffaf4')
    c.ell(24, 26, 2, 1, '#ffc3d4')
    stamp(c, SPARK, 30, 7, '#f1ca7e')


def item_feather(c):
    c.line([(10, 33), (27, 13)], '#f98772', 5)
    c.ell(25, 15, 7, 9, '#f98772')
    c.ell(21, 22, 7, 7, '#ffb363')
    c.ell(24, 17, 3, 5, '#ffe19a')
    c.line([(10, 33), (26, 13)], '#e5a25f', 2)


def item_shard(c):
    c.poly([(9, 14), (18, 8), (30, 12), (33, 22), (26, 31), (13, 33), (7, 23)], '#eab085')
    c.line([(10, 15), (18, 11), (25, 13)], '#ffd6ad', 2)
    stamp(c, ['.X...X.', 'X.X.X.X'], 15, 20, '#a96e55')
    stamp(c, ['X.X', '.X.'], 18, 25, '#a96e55')
    blush(c, 12, 25)
    blush(c, 25, 25)


def item_dango(c):
    c.rrect(7, 30, 33, 34, 2, '#e6bc86')
    c.rect(11, 34, 29, 36, '#c19469')
    for x, y in ((14, 24), (26, 24), (20, 15)):
        c.ell(x, y, 6, 6, '#fff5df')
        c.ell(x-2, y-3, 2, 1, '#ffffff')
    c.px(17, 16, EYE)
    c.px(22, 16, EYE)
    blush(c, 15, 18)
    blush(c, 23, 18)
    mouth(c, 18, 19, 'open')


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
    # Review sheet: every character and state, plus the matching gifts.
    cell_w, cell_h, left, header = 144, 174, 90, 30
    review = Image.new('RGBA', (left + cell_w * len(MONS), header + cell_h * 7), '#faf5ed')
    labels = ImageDraw.Draw(review)
    for j, mon in enumerate(MONS):
        labels.text((left+j*cell_w+12, 10), mon['id'], fill='#66546e')
    for r, anim in enumerate(ANIMS):
        labels.text((12, header+r*cell_h+70), anim, fill='#66546e')
        for j, mon in enumerate(MONS):
            review.alpha_composite(frames[(mon['prefix'], anim, key[anim])].resize((W*S, H*S), Image.Resampling.NEAREST),
                                   (left+j*cell_w, header+r*cell_h))
    labels.text((12, header+6*cell_h+70), 'gift', fill='#66546e')
    for j, (iid, fn) in enumerate(ITEMS):
        c = Cv(IW, IW)
        fn(c)
        review.alpha_composite(finish(c.im).resize((120, 120), Image.Resampling.NEAREST),
                               (left+j*cell_w+12, header+6*cell_h+15))
    review.save(os.path.join(OUT, 'preview.png'))
    print('sprites', n, 'items', len(ITEMS), 'size', (W * S, H * S))


if __name__ == '__main__':
    main()
