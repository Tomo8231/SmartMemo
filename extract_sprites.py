#!/usr/bin/env python3
"""
Extract sprite frames from a 6x6 sprite sheet.
Usage: python3 extract_sprites.py <spritesheet.png>

Sheet layout (rows top to bottom):
  Row 0: 歩く   → walk
  Row 1: 喜ぶ   → happy
  Row 2: 嫌がる → dislike
  Row 3: 驚く   → surprise
  Row 4: 寝る   → sleep
  Row 5: 座る   → sit
"""
import sys, os
from PIL import Image

PREFIX = 'mt'
ANIM_ROWS = ['walk', 'happy', 'dislike', 'surprise', 'sleep', 'sit']
OUT_DIR = os.path.join(os.path.dirname(__file__), 'sprites')

def remove_white_bg(img: Image.Image, fuzz: int = 15) -> Image.Image:
    """Convert near-white pixels to transparent."""
    img = img.convert('RGBA')
    data = img.getdata()
    new_data = []
    for r, g, b, a in data:
        if r >= 255 - fuzz and g >= 255 - fuzz and b >= 255 - fuzz:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append((r, g, b, a))
    img.putdata(new_data)
    return img

def trim_transparent(img: Image.Image, padding: int = 4) -> Image.Image:
    """Trim transparent edges and add small padding."""
    bbox = img.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    w, h = img.size
    l = max(0, l - padding)
    t = max(0, t - padding)
    r = min(w, r + padding)
    b = min(h, b + padding)
    return img.crop((l, t, r, b))

def extract(sheet_path: str):
    sheet = Image.open(sheet_path).convert('RGBA')
    W, H = sheet.size
    print(f"Sheet size: {W}x{H}")

    # Detect label column width by scanning for the first mostly-white column
    # that contains the sprite grid. We manually set based on visual inspection.
    # Typical layout: ~90px label on the left, 6 equal columns, 6 equal rows.
    label_w = int(W * 0.085)   # ~90px for a 1080px image
    grid_w  = W - label_w
    col_w   = grid_w // 6
    row_h   = H // 6

    print(f"Label width: {label_w}, Cell: {col_w}x{row_h}")
    os.makedirs(OUT_DIR, exist_ok=True)

    for row_idx, anim in enumerate(ANIM_ROWS):
        for col_idx in range(6):
            x0 = label_w + col_idx * col_w
            y0 = row_idx * row_h
            x1 = x0 + col_w
            y1 = y0 + row_h

            cell = sheet.crop((x0, y0, x1, y1))
            cell = remove_white_bg(cell)
            cell = trim_transparent(cell, padding=4)

            fname = f"{PREFIX}_{anim}_{col_idx}.png"
            out_path = os.path.join(OUT_DIR, fname)
            cell.save(out_path, 'PNG')
            print(f"  Saved {fname}  ({cell.size[0]}x{cell.size[1]})")

    print(f"\nDone! {6*6} sprites saved to {OUT_DIR}/")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 extract_sprites.py <spritesheet.png>")
        sys.exit(1)
    extract(sys.argv[1])
