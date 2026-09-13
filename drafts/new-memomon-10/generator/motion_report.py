"""スプライトの動きの量を状態ごとに数値で出す。
usage: python generator/motion_report.py   （drafts/new-memomon-10 から実行）

指標（10 体の平均）
  変化率   : 隣り合うコマで色が変わったピクセル数 / キャラの面積
  上下(px) : 6 コマの中で、キャラの上端がいちばん上といちばん下で何 px 違うか
  幅(px)   : 6 コマの中で、キャラの幅がいちばん広いと狭いで何 px 違うか（伸び縮みの目安）
目安（CODEX_REMAKE_TASK.md）を満たさない状態には「← 足りない」を付ける。
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIXES = ['yk', 'nr', 'tk', 'tp', 'dm', 'at', 'wk', 'fk', 'hn', 'tm']
ANIMS = ['sit', 'walk', 'happy', 'dislike', 'sleep', 'surprise']
# 目安: (変化率の下限, 上下 px の下限, 幅 px の下限)
TARGET = {
    'sit':      (0.15, 3, 3),
    'walk':     (0.35, 6, 3),
    'happy':    (0.50, 24, 6),
    'dislike':  (0.35, 3, 6),
    'sleep':    (0.15, 3, 3),
    'surprise': (0.45, 21, 6),
}


def main():
    print(f'{"状態":8} {"変化率":>6} {"上下(px)":>9} {"幅(px)":>7}')
    for a in ANIMS:
        rates, spans, widths = [], [], []
        for p in PREFIXES:
            fr = [np.array(Image.open(os.path.join(ROOT, 'sprites', f'{p}_{a}_{i}.png')).convert('RGBA')) for i in range(6)]
            op = [f[..., 3] > 0 for f in fr]
            area = max(1, np.mean([o.sum() for o in op]))
            rates.append(np.mean([np.any(fr[i] != fr[i + 1], -1).sum() / area for i in range(5)]))
            tops = [np.where(o.any(1))[0][0] for o in op]
            ws = [np.ptp(np.where(o.any(0))[0]) for o in op]
            spans.append(max(tops) - min(tops))
            widths.append(max(ws) - min(ws))
        r, s, w = np.mean(rates), np.mean(spans), np.mean(widths)
        t = TARGET[a]
        short = r < t[0] or s < t[1] or w < t[2]
        print(f'{a:8} {r:6.2f} {s:9.1f} {w:7.1f}' + ('  ← 足りない' if short else ''))


if __name__ == '__main__':
    main()
