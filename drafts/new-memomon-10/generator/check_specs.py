"""drafts/new-memomon-10 の画像が規格（ピクセル数・ドット単位・透明度・枚数・ファイル名）を守っているか調べる。
usage: python generator/check_specs.py   （drafts/new-memomon-10 から実行）
"""
import os
import sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIXES = ['yk', 'nr', 'tk', 'tp', 'dm', 'at', 'wk', 'fk', 'hn', 'tm']
ANIMS = ['sit', 'walk', 'happy', 'dislike', 'sleep', 'surprise']
ITEMS = ['yofukashi_lens', 'noronoron_shell', 'takoashi_stamp', 'tomepin_clip', 'damtsumi_twig',
         'atomawashi_branch', 'wasurekujira_pearl', 'fukkatsudori_feather', 'haniwan_shard', 'tsukimimochi_dango']
SPRITE = dict(size=(144, 156), block=3)
ITEM = dict(size=(160, 160), block=4)


def check(path, size, block):
    errs = []
    if not os.path.exists(path):
        return ['ファイルがない']
    im = Image.open(path)
    if im.size != size:
        errs.append(f'サイズ {im.size} (期待値 {size})')
    a = np.array(im.convert('RGBA'))
    extra = sorted(set(np.unique(a[..., 3]).tolist()) - {0, 255})
    if extra:
        errs.append(f'半透明がある (alpha {extra[:5]})')
    if im.size == size:
        up = a[::block, ::block].repeat(block, 0).repeat(block, 1)
        if not (up == a).all():
            errs.append(f'{block}x{block} px のドット単位になっていない')
    if not (a[..., 3] > 0).any():
        errs.append('完全に透明')
    return errs


def main():
    ng = 0
    expected = set()
    for p in PREFIXES:
        for an in ANIMS:
            for i in range(6):
                name = f'{p}_{an}_{i}.png'
                expected.add(name)
                for e in check(os.path.join(ROOT, 'sprites', name), **SPRITE):
                    print(f'NG sprites/{name}: {e}')
                    ng += 1
    extra = sorted(set(os.listdir(os.path.join(ROOT, 'sprites'))) - expected)
    for name in extra:
        print(f'NG sprites/{name}: 想定外のファイル')
        ng += 1
    for it in ITEMS:
        for e in check(os.path.join(ROOT, 'items', f'{it}.png'), **ITEM):
            print(f'NG items/{it}.png: {e}')
            ng += 1
    extra = sorted(set(os.listdir(os.path.join(ROOT, 'items'))) - {f'{i}.png' for i in ITEMS})
    for name in extra:
        print(f'NG items/{name}: 想定外のファイル')
        ng += 1
    if ng:
        print(f'\n{ng} 件の NG')
        sys.exit(1)
    print(f'OK: スプライト {len(expected)} 枚 (144x156, 3px 単位) / おくりもの {len(ITEMS)} 枚 (160x160, 4px 単位)')


if __name__ == '__main__':
    main()
