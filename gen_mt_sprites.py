#!/usr/bin/env python3
"""Generate sprite PNGs for めためたわかるもん (prefix: mt) into public/sprites/"""
from PIL import Image, ImageDraw
import os, math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public', 'sprites')
os.makedirs(OUT, exist_ok=True)

W, H = 120, 130

TR   = (0,0,0,0)
OUT_ = (44,24,12,255)
BODY = (238,218,120,255)
BODS = (208,188, 90,255)
HAIR = (82,112,50,255)
HAIR2= (56, 82,32,255)
CHEK = (242,160,108,255)
EYE  = (44, 24,12,255)
EYEW = (255,255,255,255)
FEET = (140, 94,44,255)
MOUT = (190, 56,56,255)
WHT  = (255,255,255,255)
YEL  = (255,210, 50,255)
LGY  = (200,200,200,180)


def ellipse(d, box, fill, outline=None, ow=2):
    if outline:
        d.ellipse([box[0]-ow, box[1]-ow, box[2]+ow, box[3]+ow], fill=outline)
    d.ellipse(box, fill=fill)


def rrect(d, box, r, fill, outline=None, ow=2):
    if outline:
        d.rounded_rectangle([box[0]-ow, box[1]-ow, box[2]+ow, box[3]+ow], radius=r+ow, fill=outline)
    d.rounded_rectangle(box, radius=r, fill=fill)


def draw_body(d, cx, cy, w=56, h=74, tilt=0):
    x0, y0 = cx - w//2 + tilt, cy - h//2
    x1, y1 = cx + w//2 + tilt, cy + h//2
    d.ellipse([x0-2, y0-2, x1+2, y1+2], fill=OUT_)
    d.ellipse([x0, y0, x1, y1], fill=BODY)
    for i in range(3):
        d.arc([x0+w//3-i, y0+h//3-i, x1-i, y1-i], start=-10, end=80, fill=BODS, width=4)


def draw_hair(d, cx, cy, h=74, tilt=0):
    ty = cy - h//2 + 2
    for ox, hw, hh in [(-13,10,13),(0,10,16),(13,10,13)]:
        hx = cx + ox + tilt
        hy = ty - hh//2
        d.ellipse([hx-hw//2-2, hy-hh//2-2, hx+hw//2+2, hy+hh//2+2], fill=OUT_)
        d.ellipse([hx-hw//2, hy-hh//2, hx+hw//2, hy+hh//2], fill=HAIR)
        d.ellipse([hx-2, hy-2, hx+1, hy+1], fill=HAIR2)


def draw_cheeks(d, cx, cy, tilt=0):
    ey = cy - 8
    for sx in [-22, 22]:
        d.ellipse([cx+sx+tilt-8, ey-5, cx+sx+tilt+8, ey+5], fill=CHEK)


def draw_eyes(d, cx, cy, mode='open', tilt=0):
    ey = cy - 14
    for sx in [-15, 15]:
        ex = cx + sx + tilt
        if mode == 'open':
            ellipse(d, [ex-4, ey-4, ex+4, ey+4], EYE)
            d.ellipse([ex+1, ey-2, ex+3, ey], fill=EYEW)
        elif mode == 'happy':
            d.arc([ex-5, ey-2, ex+5, ey+6], 200, 340, fill=EYE, width=3)
        elif mode == 'shut':
            d.line([ex-5, ey+1, ex+5, ey+1], fill=EYE, width=3)
        elif mode == 'zzz':
            d.line([ex-4, ey+1, ex+4, ey+1], fill=EYE, width=2)
        elif mode == 'angry':
            if sx < 0:
                d.line([ex-5, ey+3, ex+5, ey-1], fill=EYE, width=3)
            else:
                d.line([ex-5, ey-1, ex+5, ey+3], fill=EYE, width=3)
            d.ellipse([ex-3, ey, ex+3, ey+5], fill=EYE)
        elif mode == 'wide':
            ellipse(d, [ex-6, ey-6, ex+6, ey+6], EYE)
            d.ellipse([ex-4, ey-4, ex+4, ey+4], fill=EYEW)
            d.ellipse([ex-2, ey-2, ex+2, ey+2], fill=EYE)
        elif mode == 'half':
            d.arc([ex-5, ey-4, ex+5, ey+4], 0, 180, fill=EYE, width=4)
            d.ellipse([ex+1, ey-1, ex+3, ey+1], fill=EYEW)
        elif mode == 'content':
            d.arc([ex-5, ey-4, ex+5, ey+4], 200, 340, fill=EYE, width=2)


def draw_mouth(d, cx, cy, mode='smile', tilt=0):
    my = cy + 8
    mx = cx + tilt
    if mode == 'smile':
        d.arc([mx-8, my-4, mx+8, my+6], 20, 160, fill=EYE, width=2)
    elif mode == 'big_smile':
        d.arc([mx-10, my-5, mx+10, my+8], 15, 165, fill=EYE, width=3)
        d.arc([mx-8,  my-3, mx+8,  my+6], 15, 165, fill=WHT, width=2)
    elif mode == 'open':
        d.ellipse([mx-7, my-4, mx+7, my+7], fill=EYE)
        d.ellipse([mx-5, my-2, mx+5, my+5], fill=MOUT)
    elif mode == 'frown':
        d.arc([mx-8, my, mx+8, my+8], 200, 340, fill=EYE, width=2)
    elif mode == 'flat':
        d.line([mx-5, my+2, mx+5, my+2], fill=EYE, width=2)
    elif mode == 'tiny':
        d.ellipse([mx-3, my, mx+3, my+5], fill=EYE)
        d.ellipse([mx-2, my+1, mx+2, my+4], fill=MOUT)
    elif mode == 'shout':
        d.ellipse([mx-8, my-5, mx+8, my+8], fill=EYE)
        d.ellipse([mx-6, my-3, mx+6, my+6], fill=MOUT)


def draw_feet(d, cx, cy, h=74, pose='stand', tilt=0):
    fy = cy + h//2 + 2
    if pose == 'stand':
        lf = cx - 16 + tilt
        rf = cx + 16 + tilt
        rrect(d, [lf-9, fy-1, lf+3,  fy+11], 5, FEET, OUT_, 2)
        rrect(d, [rf-3, fy-1, rf+9,  fy+11], 5, FEET, OUT_, 2)
    elif pose == 'walk_a':
        rrect(d, [cx-25+tilt, fy-5, cx-7+tilt,  fy+8],  5, FEET, OUT_, 2)
        rrect(d, [cx+10+tilt, fy+2, cx+26+tilt,  fy+12], 4, FEET, OUT_, 2)
    elif pose == 'walk_b':
        rrect(d, [cx-26+tilt, fy+2, cx-10+tilt,  fy+12], 4, FEET, OUT_, 2)
        rrect(d, [cx+7+tilt,  fy-5, cx+25+tilt,  fy+8],  5, FEET, OUT_, 2)
    elif pose == 'sit':
        rrect(d, [cx-38+tilt, fy-4, cx-16+tilt, fy+9], 6, FEET, OUT_, 2)
        rrect(d, [cx+16+tilt, fy-4, cx+38+tilt, fy+9], 6, FEET, OUT_, 2)
    elif pose == 'jump':
        for sx in [-12, 8]:
            rrect(d, [cx+sx+tilt-5, fy+2, cx+sx+tilt+5, fy+14], 5, FEET, OUT_, 2)
    elif pose == 'float':
        for sx in [-14, 14]:
            rrect(d, [cx+sx+tilt-6, fy+4, cx+sx+tilt+6, fy+13], 5, FEET, OUT_, 2)


def draw_arm(d, cx, cy, side, pose='hang', tilt=0):
    ay = cy - 2
    if side == 'L':
        ax = cx - 32 + tilt
        if pose == 'hang':
            rrect(d, [ax-5, ay-4, ax+3, ay+10], 4, BODY, OUT_, 2)
        elif pose == 'up':
            rrect(d, [ax-4, ay-20, ax+4, ay-4], 4, BODY, OUT_, 2)
        elif pose == 'out':
            rrect(d, [ax-14, ay-3, ax+2, ay+5], 4, BODY, OUT_, 2)
        elif pose == 'wave':
            rrect(d, [ax-6, ay-16, ax+2, ay-2], 4, BODY, OUT_, 2)
        elif pose == 'cross':
            rrect(d, [ax, ay-3, ax+16, ay+5], 4, BODY, OUT_, 2)
    else:
        ax = cx + 32 + tilt
        if pose == 'hang':
            rrect(d, [ax-3, ay-4, ax+5, ay+10], 4, BODY, OUT_, 2)
        elif pose == 'up':
            rrect(d, [ax-4, ay-20, ax+4, ay-4], 4, BODY, OUT_, 2)
        elif pose == 'out':
            rrect(d, [ax-2, ay-3, ax+14, ay+5], 4, BODY, OUT_, 2)
        elif pose == 'wave':
            rrect(d, [ax-2, ay-16, ax+6, ay-2], 4, BODY, OUT_, 2)
        elif pose == 'cross':
            rrect(d, [ax-16, ay-3, ax, ay+5], 4, BODY, OUT_, 2)


def sparkle(d, x, y, size=6):
    for angle in [0, 45, 90, 135]:
        rad = math.radians(angle)
        x1 = int(x + math.cos(rad) * size)
        y1 = int(y - math.sin(rad) * size)
        x2 = int(x - math.cos(rad) * size)
        y2 = int(y + math.sin(rad) * size)
        d.line([x1, y1, x2, y2], fill=YEL, width=2)


def zzz(d, cx, cy):
    sx, sy = cx + 22, cy - 40
    for i, sz in enumerate([10, 12, 15]):
        tx, ty = sx + i*10, sy - i*10
        d.line([tx, ty, tx+sz, ty],       fill=LGY, width=2)
        d.line([tx+sz, ty, tx, ty+sz],    fill=LGY, width=2)
        d.line([tx, ty+sz, tx+sz, ty+sz], fill=LGY, width=2)


def shock_lines(d, cx, cy):
    for angle in range(0, 360, 45):
        rad = math.radians(angle)
        x1 = int(cx + math.cos(rad) * 38)
        y1 = int(cy + math.sin(rad) * 38)
        x2 = int(cx + math.cos(rad) * 54)
        y2 = int(cy + math.sin(rad) * 54)
        d.line([x1, y1, x2, y2], fill=YEL, width=3)


def sweat(d, cx, cy, tilt=0):
    sx, sy = cx + 26 + tilt, cy - 28
    d.ellipse([sx-4, sy-6, sx+4, sy+6],   fill=(100,180,220,200))
    d.polygon([sx-4, sy, sx+4, sy, sx, sy-14], fill=(100,180,220,200))


def make(eye, mouth_, feet_, arm_l, arm_r, tilt=0, cy_off=0, extra=None):
    img = Image.new('RGBA', (W, H), TR)
    d = ImageDraw.Draw(img)
    cx, cy = 60, 68 + cy_off
    draw_feet(d, cx, cy, pose=feet_, tilt=tilt)
    draw_arm(d, cx, cy, 'L', arm_l, tilt=tilt)
    draw_arm(d, cx, cy, 'R', arm_r, tilt=tilt)
    draw_body(d, cx, cy, tilt=tilt)
    draw_cheeks(d, cx, cy, tilt=tilt)
    draw_eyes(d, cx, cy, eye, tilt=tilt)
    draw_mouth(d, cx, cy, mouth_, tilt=tilt)
    draw_hair(d, cx, cy, tilt=tilt)
    if extra:
        extra(d, cx, cy)
    return img


def save(img, anim, idx):
    path = os.path.join(OUT, f'mt_{anim}_{idx}.png')
    img.save(path, 'PNG')
    print(f'  mt_{anim}_{idx}.png')


print('Generating mt sprites → public/sprites/ ...')

# sit
print('sit')
save(make('open',    'smile',     'sit', 'hang', 'hang'),              'sit', 0)
save(make('happy',   'big_smile', 'sit', 'hang', 'hang'),              'sit', 1)
save(make('open',    'smile',     'sit', 'wave', 'hang', tilt=-2),     'sit', 2)
save(make('open',    'flat',      'sit', 'hang', 'hang'),              'sit', 3)
save(make('content', 'smile',     'sit', 'hang', 'hang', tilt=2),      'sit', 4)
save(make('happy',   'smile',     'sit', 'hang', 'wave'),              'sit', 5)

# walk
print('walk')
save(make('open', 'smile', 'walk_a', 'hang', 'hang'),                  'walk', 0)
save(make('open', 'smile', 'stand',  'wave', 'hang', tilt=2),          'walk', 1)
save(make('open', 'smile', 'walk_b', 'hang', 'hang'),                  'walk', 2)
save(make('open', 'smile', 'stand',  'hang', 'wave', tilt=-2),         'walk', 3)
save(make('open', 'smile', 'walk_a', 'wave', 'hang'),                  'walk', 4)
save(make('open', 'flat',  'walk_b', 'hang', 'wave', tilt=2),          'walk', 5)

# happy
print('happy')
save(make('happy', 'big_smile', 'stand', 'up',   'hang'),              'happy', 0)
save(make('happy', 'big_smile', 'stand', 'hang',  'up'),               'happy', 1)
save(make('happy', 'big_smile', 'jump',  'up',    'up',  cy_off=-6),   'happy', 2)
def sp1(d,cx,cy): sparkle(d,cx-40,cy-40,8); sparkle(d,cx+38,cy-42,6)
save(make('happy', 'big_smile', 'jump',  'up',    'up',  cy_off=-8, extra=sp1), 'happy', 3)
save(make('happy', 'big_smile', 'jump',  'up',    'up',  cy_off=-4),   'happy', 4)
save(make('happy', 'smile',     'stand', 'hang',  'hang', tilt=3),     'happy', 5)

# dislike
print('dislike')
save(make('angry', 'frown',  'stand', 'cross', 'hang',  tilt=-2),      'dislike', 0)
save(make('angry', 'frown',  'stand', 'hang',  'hang'),                'dislike', 1)
save(make('angry', 'open',   'stand', 'out',   'hang',  tilt=-3),      'dislike', 2)
def sw1(d,cx,cy): sweat(d,cx,cy)
save(make('angry', 'shout',  'walk_a','out',   'out',   tilt=-4, extra=sw1), 'dislike', 3)
save(make('angry', 'frown',  'stand', 'cross', 'cross'),               'dislike', 4)
save(make('angry', 'flat',   'stand', 'out',   'hang',  tilt=2),       'dislike', 5)

# sleep
print('sleep')
save(make('shut', 'flat', 'sit', 'hang', 'hang'),                      'sleep', 0)
def zz1(d,cx,cy): zzz(d,cx,cy)
save(make('zzz',  'flat', 'sit', 'hang', 'hang', extra=zz1),           'sleep', 1)
save(make('shut', 'flat', 'sit', 'hang', 'hang', tilt=2),              'sleep', 2)
save(make('shut', 'flat', 'sit', 'hang', 'hang', tilt=-2),             'sleep', 3)
save(make('zzz',  'flat', 'sit', 'hang', 'hang', tilt=1, extra=zz1),   'sleep', 4)
def q1(d,cx,cy):
    qx, qy = cx+28, cy-40
    d.ellipse([qx-7, qy-12, qx+7, qy+4],  fill=LGY)
    d.ellipse([qx-3, qy+8,  qx+3, qy+14], fill=LGY)
save(make('half', 'tiny', 'sit', 'hang', 'hang', tilt=3, extra=q1),   'sleep', 5)

# surprise
print('surprise')
save(make('open', 'smile',  'stand', 'hang', 'hang'),                  'surprise', 0)
def sh1(d,cx,cy): sparkle(d,cx-36,cy-44,6)
save(make('wide', 'open',   'stand', 'hang', 'hang', tilt=2, extra=sh1), 'surprise', 1)
save(make('wide', 'shout',  'jump',  'up',   'up',   cy_off=-10, tilt=-4), 'surprise', 2)
def sh2(d,cx,cy): shock_lines(d,cx,cy-10)
save(make('wide', 'shout',  'jump',  'up',   'up',   cy_off=-8, extra=sh2), 'surprise', 3)
def sh3(d,cx,cy):
    for ox,oy in [(-18,-8),(14,-12),(0,-18)]:
        d.polygon([cx+ox-4,cy+oy+6, cx+ox+4,cy+oy+6, cx+ox,cy+oy-6], fill=YEL)
save(make('wide', 'open',   'float', 'out',  'out',  cy_off=-6, extra=sh3), 'surprise', 4)
save(make('wide', 'open',   'stand', 'hang', 'hang', tilt=4),             'surprise', 5)

print(f'\nDone! 36 sprites → {OUT}/')
