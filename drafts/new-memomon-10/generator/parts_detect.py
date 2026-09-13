"""切り抜いたキャラ（base_cut/<key>_<段階>.png、シートの解像度）から、目・口・足を自動で見つける。
usage: python parts_detect.py          -> parts_overlay.png（見つけた場所に印を付けた一覧）と要約を出す
"""
import json
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CUT = os.path.join(HERE, 'base_cut')
from extract_base import LINES


def shift(m, dy, dx):
    out = np.zeros_like(m)
    h, w = m.shape[:2]
    out[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)] = \
        m[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)]
    return out


def components(mask):
    """8 近傍の連結成分。ラベル画像と成分数を返す"""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        n += 1
        stack = [(y0, x0)]
        lab[y0, x0] = n
        while stack:
            y, x = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        stack.append((yy, xx))
    return lab, n


def detect(im):
    a = np.array(im).astype(int)
    op = a[..., 3] > 0
    rgb = a[..., :3]
    lum = rgb.mean(-1)
    ys, xs = np.nonzero(op)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    H, W = y1 - y0 + 1, x1 - x0 + 1
    area = op.sum()

    # ── 目: 輪郭線につながっていない暗い成分のうち、上寄りで大きさがそろった 2 つ ──
    dark = op & (lum < 75)
    outside = ~op
    near_out = outside | shift(outside, 1, 0) | shift(outside, -1, 0) | shift(outside, 0, 1) | shift(outside, 0, -1)
    lab, n = components(dark)
    cands = []
    for k in range(1, n + 1):
        m = lab == k
        cnt = m.sum()
        if cnt < area * 0.0008 or cnt > area * 0.03:
            continue
        if (m & near_out).any():
            continue          # 輪郭線とつながっている
        cy, cx = np.nonzero(m)
        by0, by1, bx0, bx1 = cy.min(), cy.max(), cx.min(), cx.max()
        bh, bw = by1 - by0 + 1, bx1 - bx0 + 1
        fill = cnt / (bh * bw)
        cands.append(dict(k=k, cnt=int(cnt), box=[int(bx0), int(by0), int(bx1), int(by1)],
                          cx=float(cx.mean()), cy=float(cy.mean()), bh=int(bh), bw=int(bw), fill=float(fill)))
    eyes = []
    best = None
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            p, q = cands[i], cands[j]
            if max(p['cnt'], q['cnt']) / min(p['cnt'], q['cnt']) > 2.2:
                continue
            if abs(p['cy'] - q['cy']) > H * 0.07:
                continue
            dx = abs(p['cx'] - q['cx'])
            if dx < W * 0.07 or dx > W * 0.5:
                continue
            ey = (p['cy'] + q['cy']) / 2
            if ey > y0 + H * 0.75:
                continue
            roundish = min(p['bh'] / p['bw'], p['bw'] / p['bh']) + min(q['bh'] / q['bw'], q['bw'] / q['bh'])
            score = (p['cnt'] + q['cnt']) / area * 100 + roundish - abs(p['cy'] - q['cy']) / H * 10
            if best is None or score > best[0]:
                best = (score, p, q)
    if best:
        eyes = sorted([best[1], best[2]], key=lambda e: e['cx'])
    else:
        # 横顔など、目が 1 つだけ見えるキャラ
        singles = [c for c in cands if c['cy'] < y0 + H * 0.6 and 0.5 < c['bh'] / c['bw'] < 2.5 and c['fill'] > 0.5]
        if singles:
            eyes = [max(singles, key=lambda c: c['cnt'])]

    # ── 口: 目より下で、目の間に近い、小さめの暗い成分 ──
    mouth = None
    if eyes:
        ex = np.mean([e['cx'] for e in eyes])
        ey = np.mean([e['cy'] for e in eyes])
        eh = np.mean([e['bh'] for e in eyes])
        span = abs(eyes[-1]['cx'] - eyes[0]['cx']) if len(eyes) == 2 else W * 0.2
        used = {e['k'] for e in eyes}
        mc = [c for c in cands if c['k'] not in used and c['cy'] > ey + eh * 0.4 and c['cy'] < ey + eh * 3.2
              and abs(c['cx'] - ex) < max(span * 0.6, W * 0.08)]
        if mc:
            mouth = min(mc, key=lambda c: abs(c['cx'] - ex) + (c['cy'] - ey) * 0.3)

    # ── 足: 下から見て、不透明な列が 2 つ以上に分かれている帯 ──
    legs = []
    band_top = None
    rows = []
    for y in range(y1, y0 + int(H * 0.55), -1):
        row = op[y, x0:x1 + 1]
        runs, start = [], None
        for x, v in enumerate(row):
            if v and start is None:
                start = x
            elif not v and start is not None:
                runs.append((start, x - 1))
                start = None
        if start is not None:
            runs.append((start, len(row) - 1))
        runs = [r for r in runs if r[1] - r[0] + 1 >= max(3, W * 0.03)]
        rows.append((y, runs))
    k = 0
    for y, runs in rows:
        if len(runs) >= 2:
            k += 1
            band_top = y
        elif k > 0 and len(runs) < 2:
            break
    if band_top is not None and (y1 - band_top + 1) >= H * 0.06:
        cols = op[band_top:y1 + 1, x0:x1 + 1].any(0)
        segs, start = [], None
        for x, v in enumerate(cols):
            if v and start is None:
                start = x
            elif not v and start is not None:
                segs.append((start, x - 1))
                start = None
        if start is not None:
            segs.append((start, len(cols) - 1))
        segs = [s for s in segs if s[1] - s[0] + 1 >= max(3, W * 0.03)]
        if len(segs) >= 2:
            legs = [[int(x0 + s0), int(band_top), int(x0 + s1), int(y1)] for s0, s1 in segs]
    return dict(bbox=[int(x0), int(y0), int(x1), int(y1)], eyes=[e['box'] for e in eyes],
                mouth=mouth['box'] if mouth else None, legs=legs)


def main():
    res = {}
    T = 150
    sheet = Image.new('RGB', (T * 6, T * ((len(LINES) + 1) // 2)), (60, 60, 70))
    for idx, (key, _, _) in enumerate(LINES):
        for s in (1, 2, 3):
            im = Image.open(os.path.join(CUT, f'{key}_{s}.png')).convert('RGBA')
            d = detect(im)
            res[f'{key}{s}'] = d
            vis = Image.new('RGBA', im.size, (235, 235, 235, 255))
            vis.alpha_composite(im)
            dr = ImageDraw.Draw(vis)
            for b in d['eyes']:
                dr.rectangle(b, outline=(255, 0, 0), width=3)
            if d['mouth']:
                dr.rectangle(d['mouth'], outline=(0, 90, 255), width=3)
            for b in d['legs']:
                dr.rectangle(b, outline=(0, 200, 0), width=3)
            vis.thumbnail((T - 4, T - 4))
            cx, cy = ((idx % 2) * 3 + s - 1) * T, (idx // 2) * T
            sheet.paste(vis.convert('RGB'), (cx + 2, cy + 2))
    sheet.save(os.path.join(HERE, 'parts_overlay.png'))
    json.dump(res, open(os.path.join(HERE, 'parts.json'), 'w'), indent=1)
    eyes2 = sum(len(d['eyes']) == 2 for d in res.values())
    eyes1 = sum(len(d['eyes']) == 1 for d in res.values())
    mouth = sum(d['mouth'] is not None for d in res.values())
    legs = sum(len(d['legs']) >= 2 for d in res.values())
    print(f'102 体: 目2つ {eyes2} / 目1つ {eyes1} / 目なし {102 - eyes2 - eyes1} | 口 {mouth} | 足 {legs}')
    print('目が見つからない:', [k for k, d in res.items() if not d['eyes']])


if __name__ == '__main__':
    main()
