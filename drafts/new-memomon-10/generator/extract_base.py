"""base_image のシート（5 行 x 3 列、右ほど進化後）から、採用する 34 系統 x 3 段階を切り出す。
黒い背景と白いフチを取り除き、シートの解像度のまま RGBA で保存する。
usage: python extract_base.py
出力: base_cut/<key>_<stage>.png, base_cut/contact.png
"""
import glob
import os
import re
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'base_image')
OUT = os.path.join(HERE, 'base_cut')

# (key, シート番号, 行) 行は 0 始まり。既存メモモンと同じもの・重複は含めない
LINES = [
    ('shironeko', 1, 1), ('pinkusagi', 1, 3), ('penguin', 2, 0), ('hoshi', 2, 4),
    ('honoshiba', 3, 0), ('ookami', 3, 1), ('panda', 3, 2), ('kame', 3, 3),
    ('denkineko', 4, 0), ('koumori', 4, 1), ('kinoko', 4, 2), ('buta', 4, 3),
    ('shika', 5, 0), ('kotori', 5, 1), ('futaba', 5, 4),
    ('araiguma', 6, 0), ('hinotama', 6, 2), ('harinezumi', 6, 3), ('fukurou', 6, 4),
    ('kani', 7, 0), ('hachi', 7, 1), ('mushi', 7, 2), ('golem', 7, 3), ('yousei', 7, 4),
    ('mizukusa', 8, 1), ('mikeneko', 8, 2), ('knight', 8, 3),
    ('mogura', 9, 0), ('kumo', 9, 1), ('saboten', 9, 2), ('onpu', 9, 3), ('kabocha', 9, 4),
    ('kujira', 10, 3), ('takarabako', 10, 4),
]


def bands(profile, thr=2, min_len=60, min_gap=18):
    on = profile > thr
    out, start, gap, end = [], None, 0, 0
    for i, v in enumerate(on):
        if v:
            if start is None:
                start = i
            gap, end = 0, i
        elif start is not None:
            gap += 1
            if gap > min_gap:
                if end - start + 1 >= min_len:
                    out.append((start, end))
                start = None
    if start is not None and end - start + 1 >= min_len:
        out.append((start, end))
    return out


def shift(m, dy, dx):
    out = np.zeros_like(m)
    h, w = m.shape[:2]
    out[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)] = \
        m[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
    return out


def cut(cell):
    a = np.array(cell.convert('RGB')).astype(int)
    h, w = a.shape[:2]
    # シートの背景はほぼ純黒（色の値 0〜1）。60 まで広げると、キャラの濃い輪郭線を伝って
    # パンダの模様やハチの縞まで背景になったので、純黒に近いピクセルだけを背景の候補にする
    dark = a.max(-1) <= 8
    # 外周の暗いピクセルから始めて、暗いピクセルだけを伝って広げる
    bg = np.zeros_like(dark)
    bg[0, :], bg[-1, :], bg[:, 0], bg[:, -1] = dark[0, :], dark[-1, :], dark[:, 0], dark[:, -1]
    while True:
        grown = (bg | shift(bg, 1, 0) | shift(bg, -1, 0) | shift(bg, 0, 1) | shift(bg, 0, -1)) & dark
        if (grown == bg).all():
            break
        bg = grown
    fg = ~bg
    # 外側の白いフチを削る
    for _ in range(8):
        touch = fg & (shift(bg, 1, 0) | shift(bg, -1, 0) | shift(bg, 0, 1) | shift(bg, 0, -1))
        light = touch & (a.min(-1) >= 150)
        if not light.any():
            break
        fg &= ~light
        bg |= light
    # 小さなごみを消す
    lab = np.zeros((h, w), int)
    comp = 0
    for y0, x0 in zip(*np.nonzero(fg)):
        if lab[y0, x0]:
            continue
        comp += 1
        q = deque([(y0, x0)])
        lab[y0, x0] = comp
        pts = []
        while q:
            y, x = q.popleft()
            pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and fg[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = comp
                    q.append((yy, xx))
        if len(pts) < 40:
            for y, x in pts:
                fg[y, x] = False
    rgba = np.dstack([a, np.where(fg, 255, 0)]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    return im.crop(im.getchannel('A').getbbox())


def main():
    os.makedirs(OUT, exist_ok=True)
    sheets = {int(re.search(r'\((\d+)\)', f).group(1)): f for f in glob.glob(os.path.join(SRC, '*.png'))}
    cache = {}
    for key, sn, row in LINES:
        if sn not in cache:
            img = Image.open(sheets[sn]).convert('RGB')
            fgp = np.array(img).max(-1) > 45
            cache[sn] = (img, bands(fgp.sum(1)), bands(fgp.sum(0)))
        img, rows, cols = cache[sn]
        y0, y1 = rows[row]
        for stage, (x0, x1) in enumerate(cols, 1):
            box = (max(0, x0 - 16), max(0, y0 - 16), min(img.width, x1 + 17), min(img.height, y1 + 17))
            cut(img.crop(box)).save(os.path.join(OUT, f'{key}_{stage}.png'))
    # 確認用の一覧（マゼンタ地に並べる）
    T = 110
    sheet = Image.new('RGB', (T * 6, T * ((len(LINES) + 1) // 2)), (255, 0, 255))
    d = ImageDraw.Draw(sheet)
    for k, (key, _, _) in enumerate(LINES):
        cx, cy = (k % 2) * T * 3, (k // 2) * T
        for s in range(3):
            im = Image.open(os.path.join(OUT, f'{key}_{s + 1}.png'))
            im.thumbnail((T - 8, T - 14))
            sheet.paste(im, (cx + s * T + (T - im.width) // 2, cy + 12 + (T - 14 - im.height) // 2), im)
        d.text((cx + 3, cy + 1), key, fill=(255, 255, 255))
    sheet.save(os.path.join(OUT, 'contact.png'))
    print('cut', len(LINES) * 3)


if __name__ == '__main__':
    main()
