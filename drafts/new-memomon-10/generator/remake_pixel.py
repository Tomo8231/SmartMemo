"""Original, hand-placed pixel maps for the ten Memomon.

Run from any directory. --base only writes sit frame zero and its review sheet.
All drawing is on the logical pixel grid; export uses nearest-neighbour only.
No input artwork or previous generator is loaded.
"""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
NAMES = ['ヨフカシ','のろのろん','タコアシ','とめピン','ダムつみ','あとまわし','ワスレクジラ','フッカツドリ','ハニワン','つきみもち']
KEYS = ['yk','nr','tk','tp','dm','at','wk','fk','hn','tm']
STATES = ['sit','walk','happy','dislike','sleep','surprise']
ITEMS = ['yofukashi_lens','noronoron_shell','takoashi_stamp','tomepin_clip','damtsumi_twig','atomawashi_branch','wasurekujira_pearl','fukkatsudori_feather','haniwan_shard','tsukimimochi_dango']
# o outline, s shadow, b base, l upper-left light, c cream, h cream shadow.
COLORS = {
 'yk': ['51436f','8a79b4','b7a1d7','d9c9ed','fff0d6','eac9b1'],
 'nr': ['526b66','76ac88','a7d9a0','daf0bb','fff4d7','e8c89a'],
 'tk': ['944c72','d97597','f49eb4','ffd1d8','fff0dd','ebc6ad'],
 'tp': ['476779','73a9bb','a8dce0','e1faf2','fff4cc','e5c781'],
 'dm': ['714c49','b77557','dba379','f4cc96','fff0ce','deb588'],
 'at': ['75604f','b4a17d','dacbaa','f4e6c6','fff5db','b79c80'],
 'wk': ['414879','686eae','929cdb','bcc9f3','e0f5ff','abcada'],
 'fk': ['994966','e37768','ffad77','ffe1a1','fff5cc','f4cc87'],
 'hn': ['8d594b','bc795d','e1a579','ffd1a0','fff0c8','ddb584'],
 'tm': ['756286','c4b4da','f5e8ef','fffaf1','fff1bf','e0b980'],
}
PAL = {k:dict(zip('osblch', ['#'+v for v in a])) for k,a in COLORS.items()}
for p in PAL.values():
    p.update(e='#46394f', w='#fffdf2', r='#ee92a4', g='#86b8a0', a='#f6ce78', v='#9186cd', t='#b98962', d='#805c51')

def stamp(im, rows, xy, pal):
    """A character in the source is exactly one logical pixel."""
    x0,y0=xy
    for y,row in enumerate(rows.strip('\n').splitlines()):
        for x,c in enumerate(row):
            if c != '.' and c != ' ':
                if 0 <= x+x0 < im.width and 0 <= y+y0 < im.height:
                    im.putpixel((x+x0,y+y0), ImageColor(pal[c]))

def ImageColor(s):
    return tuple(bytes.fromhex(s.lstrip('#'))) + (255,)

BODY = {
'yk': (6,7,"""
....ooo............ooo
...ollbo..........obbo
...olllboooooooooobbbso
...ollllllbbbbbbbbbbbso
..olllllllbbbbbbbbbbbbso
.ollllllllbbbbbbbbbbbbso
.ollllccccccbbcccccbbbso
ollllcccccccoccccccbbbso
olllcccccccccccccccbbbso
ollccccccccccccccccbbsso
ollccccccccccccccccbbsso
ollcccccccccccccccbbssso
ollcccccccccccccccbbssso
olbbhccccccccccchbbsssso
.obbbhhccccccchhbbsssso
.obbbbbhhccchhbbbbsssso
.obbblbbbbbbbbbbbbbssso
.obblllbbbbbbbbbbbbssso
.obblllbcbcbcbcbbbbssso
..obblbbbbbbbbbbbbssso
..obbbbbbbbbbbbbbsssso
...obbbbbbbbbbbsssso
....obsssssssssssso
.....oooooooooooo
"""),
'nr': (4,10,"""
.................oooooooo
...............ooccccccccoo
..............occllllllllcco
.............occlcccccccclcco
............occlccvvvvccclccso
............oclccccccccccclcso
...........occlccvvvvvvccclccso
...........oclccccccccccclcccso
...........oclccvvvvvvvccclccso
...........oclccccccccccclcccso
...........oclccvvvvvvvccclccso
...........occlccccccccclccchso
...........occlccvvvvvcclcchhso
...ooooo....occlccccccclcchhso
..ollllloo..occcllllllcchhhso
.ollllllllooocccccccchhhhso
olllllllllbbbohhhhhhhhhso
olllllllbbbbbbboooooooobbo
olllllllbbbbbbbbbbbbbbbbso
olllllbbbbbbbbbbbbbbbbbbso
.olllbbbbbbbbbbbbbbbbbssso
..obbbbbbbbbbbbbbbbbssso
...obssssssssssssssssoo
....oooooooooooooooo
"""),
'tk': (6,8,"""
..........oooooooo
.......ooolllllllboo
.....oolllllllllbbbo
....ollllllllllllbbbo
...olllllllllllllbbbso
..ollllllllllllllbbbbso
..olllllllllllllbbbbbso
.ollllllllllllllbbbbbso
.olllllllllllllbbbbbbso
olllllllllllllbbbbbbbso
ollllllllllllbbbbbbbbso
olllllllllllbbbbbbbbbsso
ollllllllllbbbbbbbbbbssso
olllllllllbbbbbbbbbbbssso
ollllllllbbbbbbbbbbbsssso
.obllllbbbbbbbbbbbbsssso
.obbbbbbbbbbbbbbbbbsssso
..obbbbbbbbbbbbbbbbssso
...obbbbbbbbbbbbbbsso
....obbbbbbbbbbbbsso
.....ooooooooooooo
"""),
'tp': (8,5,"""
.........oooooooo
.......oolllllllloo
......olllllllllllbo
.....olllooooooobllbo
....olllo.......obllbo
....ollo.........obllbo
...olllo.........obllbo
...ollo..........obllbo
...ollo....ooo...obllbo
..olllo...ollbo..obllbo
..ollo....ollbo..obllbo
..ollo...ollbo...obllbo
..ollo...ollbo...obllbo
..ollo...ollbo...obllbo
..ollo...ollbo...obllbo
..ollo...ollbo...obllbo
..ollo...ollbo...obllbo
..ollbo..ollbo...obllbo
..ollbo...obbo...obllbo
..olllbo...oo...obllbo
...olllboo....oobllbo
...olllllbooooblllbo
....ollllllllllllbo
.....obllllllllbbo
......oobbbbbbooo
........oooooo
"""),
'dm': (6,10,"""
....oooo.........oooo
...olllbo.......olbbso
...olrrboooooooobrrbso
...olrllllllllbbbbrbso
..olllllllllllllbbbbso
.olllllllllllllllbbbso
ollllllllllllllllbbbso
olllllllllllllllbbbbso
ollllllllllllllbbbbbbso
olllllllllllllbbbbbbbso
ollllccccclllbbbbbbbbso
occcccccccclbbbbbbbbbso
occccccccccclbbbbbbbbsso
occcccccccccbbbbbbbbssso
.ohcccccccchbbbbbbbsssso
..ohhhccchhbbbbbbbbsssso
...obcccccbbbbbbbbsssso
...obcccccbbbbbbbbsssso
...obbbcccccccbbbbsssso
...obbbccccccccbbbsssso
...obbbcccccccbbbsssso
....obbbbbbbbbbbsssso
.....obssssssssssso
......oooooooooooo
"""),
'at': (6,9,"""
.........oooooooo
......ooolllllllboo
....oolllllllllllbbo
...ollllllllllllllbbo
..ollllccccccccclllbbo
.olllccccccccccccllbbo
.ollcccchcccccchccclbbo
ollccchhhhccchhhhhcclbbo
ollcchhhhhhchhhhhhhclbbo
ollcchhhhhhchhhhhhhclbbo
ollccchhhhccchhhhhcclbbo
ollcccccccccccccccclbbso
ollcccccccccccccccclbbso
.ollcccccccccccccllbbso
.obllcccccccccccllbbssso
..obbbhhccccchhbbbbsssso
..obbbbbbbbbbbbbbbbsssso
..obbblbbbbbbbbbbbbsssso
..obblllccccccbbbbsssso
..obblllcccccccbbbsssso
..obbblccccccccbbbsssso
...obbcccccccccbbbssso
....obbbbbbbbbbbbbssso
.....obsssssssssssso
......oooooooooooo
"""),
'wk': (3,13,"""
..........oooooooooo
.......ooollllllllbbboo
.....oolllllllllllbbbbbo
....ollllllllllllbbbbbbbo
...ollllllllllllbbbbbbbbso
..ollllllllllllbbbbbbbbbso
.ollllllllllllbbbbbbbbbbbso
.olllllllllllbbbbabbbbbbbso
olllllllllllbbbbawabbabbbbso
ollllllllllbbbbbabbbbabbbbso
olllllllllbbbbbbbbbbbbbbbsso
ollllllllbbbbbbbbbbbbbbbbssso
olllllllbbbbbbbbbbbbbbbbbssso
ollllllbbbbbbbbbbbbbbbbbbssso
olllllbbbbbbbbbbbbbbbbbbsssso
olllccccccccccccbbbbbbbsssso
.occccccccccccccccbbbbsssso
..occccccccccccccccbbsssso
...ohccccccccccccchsssso
.....ohhhhccccchhhssoo
.......oooooooooooo
"""),
'fk': (7,7,"""
...........oo
..........olbo
.........ollbo
......oo.ollbbo
.....olboolllbbo
.....ollllllllboo
....ollllllllllbbo
...ollllllllllllbo
..olllllllllllllbbo
.olllllllllllllllbbo
.ollllcccccllllllbbo
ollllcccccccllllbbbo
olllccccccccllllbbso
ollccccccccclllbbbso
olcccccccccclllbbbso
olccccccccclllbbbbso
olccccccccllllbbbbsso
.obccccccclllbbbbbssso
.obcccccccllbbbbbbssso
..obccccclllbbbbbbssso
..obcccccllbbbbbbssso
...obcccclbbbbbbbssso
....obbbbbbbbbbsssso
.....obssssssssssso
......oooooooooooo
"""),
'hn': (7,7,"""
........oooooooo
......oolllllllboo
.....ollllllllllbbo
....ollllllllllllbbo
....ollllllllllllbbso
...olllllllllllllbbso
...ollllllllllllbbbso
...olllllllllllbbbbso
...olllllllllllbbbbso
...olllllllllllbbbbso
...ollllllllllbbbbbso
...olllllllllbbbbbbso
...ollllllllbbbbbbbso
...olllllllbbbbbbbbso
...ollllllbbbbbbbbbso
...olllllbbbbbbbbbbso
...ollllbbbbbbbbbbbso
...olllbbbbbbbbbbbbsso
..ollllbbbbbbbbbbbbssso
..olllbbbbbbbbbbbbbssso
..olllbbbbbbbbbbbbbssso
..ollbbbbbbbbbbbbbbssso
..obbhbhbhbhbhbhbhbssso
..obbbbbbbbbbbbbbbbssso
...osssssssssssssssso
....oooooooooooooooo
"""),
'tm': (6,2,"""
.........ooo......ooo
........olllo....ollbo
........olrllo...olrbbo
........olrrlo...olrrbo
........olrrlo..olrrbbo
........olrrlo..olrrbo
........olrrlo..olrrbo
........olrrlo.olrrbbo
........ollllo.olllbo
......ooolllloooolbbo
....oolllllllllllllboo
...olllllllllllllllllbo
..ollllllllllllllllllbbo
.olllllllllllllllllllbbo
ollllllllllllllllllllbbso
olllllllllllllllllllbbbso
olllllllllllllllllllbbbso
olllllllllllllllllllbbbso
ollllllllllllllllllbbbbso
ollllllllllllllllllbbbbso
.ollllllllllllllllbbbbso
..oblllllllllllllbbbbso
...obbblllllllbbbbbbso
....obbbbbbbbbbbbbbso
....obbccccccbbbbbbso
....obbcccccccbbbbbso
....obbcccccccbbbbbso
....obbcccccccbbbbbso
.....obbbbbbbbbbbbso
......ossssssssssso
.......ooooooooooo
"""),
}

EYES={'yk':(11,18,8),'nr':(6,27,7),'tk':(10,20,8),'tp':(11,24,8),'dm':(9,20,8),'at':(11,18,8),'wk':(6,24,8),'fk':(10,21,7),'hn':(12,16,7),'tm':(10,19,8)}

def face(im,k,state,f):
    p=PAL[k]; x,y,gap=EYES[k]
    sleepy=state=='sleep' or (state=='sit' and f==4)
    happy=state=='happy' and f in (2,3,4)
    angry=state=='dislike'
    eye='ee.\newe\neee\n.ee' if k=='hn' else 'ee\nwe\nee'
    if sleepy: eye='...\ne.e\n.ee'
    elif happy: eye='.e.\ne.e\n...'
    elif angry: eye='ee.\n.ee\n.ee'
    elif state=='surprise' and f in (2,3,4): eye='.ee.\newwe\ne.we\n.ee.'
    for xx in (x,x+gap): stamp(im,eye,(xx,y),p)
    stamp(im,'rr',(x-1,y+4),p); stamp(im,'rr',(x+gap+1,y+4),p)
    if k in ('yk','fk'):
        stamp(im,'aa\nah\nh.',(x+3,y+3),p)
        # A left-projecting beak makes direction readable at icon size.
        stamp(im,'.aa\naah\n.hh',(3 if k=='yk' else 4,y+2),p)
    elif k=='dm':
        stamp(im,'ee\n.e\nww\nwh',(x+3,y+3),p)
    elif k=='hn': stamp(im,'.ee\neee\nee.',(x+3,y+6),p)
    elif state=='surprise': stamp(im,'ee\nee',(x+3,y+5),p)
    else: stamp(im,'e.e\n.e.',(x+3,y+4),p)

def character(k,state='sit',f=0):
    im=Image.new('RGBA',(44,40)); p=PAL[k]
    wag=[0,-1,-2,0,1,1][f]; step=[-2,0,2,2,0,-2][f] if state=='walk' else 0
    excited=state in ('happy','surprise') and f in (2,3)
    # Separate hand-authored appendages move before the main body is composited.
    if k=='dm': stamp(im,'.ooooo\nollbbbo\nolltbbo\nobbtbtbo\n.obtbtbo\n.obbtbbo\n..obbbo\n...ooo',(28,25+wag),p)
    if k=='wk': stamp(im,'oo......oo\nollbo..olbo\nollbboobbbo\n.obbbbbbbso\n..obbbbsso\n...obbsso\n...obso\n...obo',(31,21+wag),p)
    if k=='fk': stamp(im,'...oo\n..olbo\n.ollbo\nollbbo\nollbso\n.obbbso\n..obso\n...oo',(26,24+wag),p)
    if k=='tm': stamp(im,'.ooo\nollbo\nollbbo\n.obbo\n..oo',(29,28),p)
    if k=='nr':
        for ax,ay in ((5,18+wag),(12,18-wag)):
            stamp(im,'bo\n'*(28-ay-4),(ax+1,ay+4),p)
            stamp(im,'.oo\nolbo\nolbo\n.oo',(ax,ay),p)
    if k not in ('nr','wk','tk'):
        for x,dy in ((12+step,0),(23-step,-1 if step else 0)):
            foot_y=30 if k in ('yk','fk','tp') else 32
            footpal=dict(p, b=p['a'],l=p['c']) if k in ('yk','fk') else p
            stamp(im,'.ooo.\nollbo\nolbbo\nooooo',(x,foot_y+dy),footpal)
    if k=='tk':
        for root_x,root_y in ((7,25),(12,26),(21,26),(25,25)):
            stamp(im,'obbbbbo\nobbbbbo',(root_x,root_y),p)
        for j,(x,y) in enumerate(((5,27),(11,29),(20,29),(28,27))):
            dy=([0,-2,1,0,2,-1][(f+j)%6] if state=='walk' else (wag if j%2 else -wag))
            if y+dy>=26:
                stamp(im,'obbo\n'*(y+dy-25),(x,26),p)
            stamp(im,'obbo..oo\nobbboolbo\nolbbbbbo\n.obcchbo\n..ooooo',(x,y+dy),p)
    x,y,rows=BODY[k]; stamp(im,rows,(x,y),p)
    # Motif-specific foreground details, all placed on the same logical grid.
    arm_y=24+(-3 if excited else wag)
    if k in ('yk','fk'):
        stamp(im,'.oo\nolbo\nollbo\nollbbo\n.obbbso\n..obso\n...oo',(25,arm_y),p)
    elif k in ('at','dm','tm'):
        stamp(im,'.ooo\nollbo\nollbbo\n.obbbbo\n..occo\n...oo',(24,arm_y+2),p)
    if k=='at':
        stamp(im,'.ooo\nolbo\nollbo\nollbo\nolcco\n.ooo',(8,26+wag),p)
    if k=='dm':
        stamp(im,'..aa\n.oaao\n.oaao\n.oaao\n.ohho\n..ee',(24,6),p)
    if k=='tk':
        stamp(im,'..oo\n.olvo\n.olvo\n.olvo\n.olvo\n.occo\n..eo',(3,24-wag),p)
    if k=='tp':
        # The face sits on a little folded memo held by the actual bent wire.
        stamp(im,'.hhhhhhhhhhhh\nhccccccccccch\nhcwwwwwwwwwch\nhcwwwwwwwwwch\nhcwwwwwwwwwch\nhcwwwwwwwwwch\nhccccccccccch\n.hhhhhhhhhhh',(9,22),p)
        stamp(im,'ooo\nolbo\n.olbo\n..oo',(25,25+wag),p)
        stamp(im,'.oo\nolbo\nolbo\n.oo',(6,25-wag),p)
    if k=='hn':
        stamp(im,'.ooo\nolbo\nolbo\nolbo\n.obboo\n..obbbo\n...ooo',(4,18-wag-(2 if excited else 0)),p)
        stamp(im,'ooo\nobbo\n.obbo\n..obbo\n..olbo\n..olbo\n...oo',(26,22+wag-(4 if excited else 0)),p)
        stamp(im,'..a..\n.ava.\navwva\n.ava.\n..a..',(18,27),p)
    if k=='tm':
        stamp(im,'..dd\n..tt\n..tt\n..tt\n..tt\n..tt\n..dd',(32,25),p)
        stamp(im,'.dddddddd\ndclllllct\ndclllbbct\n.dbttttd\n..ddddd',(28,21+wag-(3 if excited else 0)),p)
        stamp(im,'.aa\naac\nac.\naac\n.aa',(24,15),p)
    if k=='wk':
        stamp(im,'..ooo\n.ollbo\nolllbo\n.obbbbo\n..obbo\n...oo',(22,28+wag),p)
        stamp(im,'..c..\n.ccc.\n..c..',(24,18),p)
    face(im,k,state,f)
    return im

def render(k,state,f):
    raw=character(k,state,f)
    box=raw.getbbox(); raw=raw.crop(box)
    # Six poses return to their resting anchor; jumps really clear the ground.
    params={
      'sit': [(0,0,0,0),(1,1,0,0),(2,1,0,0),(1,0,0,0),(0,-1,0,0),(-1,0,0,0)],
      'walk':[(1,-1,0,-1),(0,1,2,0),(-1,2,3,1),(1,-1,0,1),(0,1,2,0),(-1,2,3,-1)],
      'happy':[(0,0,0,0),(4,-5,0,0),(-2,2,7,-1),(0,0,11,0),(5,-5,0,1),(0,0,0,0)],
      'dislike':[(0,0,0,0),(3,-2,0,2),(-1,1,1,-2),(3,-2,0,2),(-1,1,0,-2),(0,0,0,0)],
      'sleep':[(3,-5,0,0),(4,-4,0,0),(5,-3,0,0),(4,-4,0,0),(3,-5,0,0),(2,-6,0,0)],
      'surprise':[(0,0,0,0),(4,-4,0,0),(-2,2,8,1),(0,1,9,2),(3,-2,0,2),(0,0,0,0)],
    }
    dw,dh,jump,dx=params[state][f]
    raw=raw.resize((raw.width+dw,raw.height+dh),Image.Resampling.NEAREST)
    im=Image.new('RGBA',(48,52))
    xx=24-raw.width//2+dx; yy=46-raw.height-jump
    im.alpha_composite(raw,(xx,yy))
    p=PAL[k]
    if state=='happy' and f in (2,3):
        stamp(im,'.rr.rr\nrrrrrr\nrrrrrr\n.rrrr.\n..rr..',(2,10-f),p)
        stamp(im,'..a..\n..a..\naawaa\n..a..\n..a..',(39,15-f),p)
    if state=='surprise' and f in (2,3,4):
        stamp(im,'aa\naa\naa\naa\n..\naa',(3,8 if f==3 else 11),p)
        stamp(im,'.l.\n.ll\nlbl\n.bb',(40,18+f),p)
    if state=='dislike' and f in (1,2,3,4):
        stamp(im,'r.r\nrrr\n.r.\nrrr\nr.r',(37+f%2,14+f%2),p)
    if state=='sleep':
        zx=[34,35,36,36,35,34][f]; zy=[15,13,11,10,11,13][f]
        stamp(im,'vvvv\n..v.\n.v..\nvvvv',(zx,zy),p)
    return im.resize((144,156),Image.Resampling.NEAREST)

def font(size):
    for path in ('C:/Windows/Fonts/meiryo.ttc','C:/Windows/Fonts/YuGothM.ttc','C:/Windows/Fonts/arial.ttf'):
        if Path(path).exists(): return ImageFont.truetype(path,size)
    return ImageFont.load_default()

def base_preview():
    sheet=Image.new('RGB',(1000,490),'#f7f2e9'); d=ImageDraw.Draw(sheet)
    d.text((28,14),'MEMOMON / 新しい10体の通常ポーズ',font=font(23),fill='#554961')
    for n,k in enumerate(KEYS):
        x=20+(n%5)*196; y=58+(n//5)*214
        d.rounded_rectangle((x,y,x+184,y+200),12,fill='#fffdf8')
        im=render(k,'sit',0); sheet.paste(im,(x+20,y+1),im)
        d.text((x+10,y+162),NAMES[n],font=font(18),fill='#554961')
        small=im.resize((60,65),Image.Resampling.NEAREST); sheet.paste(small,(x+118,y+127),small)
    sheet.save(ROOT/'preview_sit0.png')

# Gifts are independent 40 x 40 hand drawings, not crops of character artwork.
GIFT_MAPS = [
"""
..........aa
.........awa
..........a
.....oooooooooo
...ooaaaaccccaaoo
..oaccccccccccccao
.oacccvvvvvvvcccaaao
oacclllvvvvvvvvccaaso
oaclwllvvvvvvvvvcaaso
oaclwlvvvvvvvvvvcaaso
oaclwvvvvvvvvvvvcaaso
oacllvvvvvvvvvvvcaaso
oacvvvvvvvvvvccvcaaso
oacvvvvvvvvvcccvcaaso
oacvvvvvvvvvcccvaaso
.oacvvvvvvvvcccaaso
..oaacccccccccaaso
...oaaaasssssaao
.....oooooooooo
..........otto
..........ottto
...........ottto
............ottto
.............otto
..............oo
""",
"""
.........oooooooo
......ooolllllllcoo
.....olllllllllllcco
....ollllllccccccccco
...ollllccvvvvvccccccso
..ollllcvccccccvccccccso
.olllcvccvvvvccvcccccso
.ollcvccvccccvccvccccso
ollcvccvclllcvccvccccso
ollcvccvclclcvccvcccchso
ollcvccvccllcvccvccchhso
ollcvcccvvvvcclvccchhhso
ollccvcccccccclvccchhhso
.ollccvvvvvvvvccchhhhso
.ollccccccccccchhhhso
..ohccccccccchhhhso
...ohhhhhhhhhhhsso
....oosssssssssoo
......ooooooooo
""",
"""
.........oooooo
.......oolllllloo
......olllllllllbo
.....ollllllllllbbo
.....olllccclllbbbo
.....olllclclllbbbo
......oblcclllbbbo
.......obbbbbbbso
........obbbbbso
........obbbbbso
.....oooobbbbboooo
....ollllllllllllbo
...olllllllllllllbbo
...ollllllllllllbbbo
...obbbbbbbbbbbbbssso
...osssssssssssssssso
....oooooooooooooooo
....occcccccccccccco
.....ohhhhhhhhhhhho
......oooooooooooo
""",
"""
.........oooooooo
.......ooacccccccoo
......oaccccccccccao
.....oacccooooocccaso
....oaccoo.....oaccaso
....occo........occaso
...oacco........occaso
...occo....oo...occaso
...occo...ocao..occaso
..oacco...ocao..occaso
..occo....ocao..occaso
..occo...occao..occaso
..occo...ocao...occaso
..occo...ocao...occaso
..occo...ocao...occaso
..occo...ocao...occaso
..occo...ocao...occaso
..occao..ocao..occaso
..occao...oo...occaso
...occao......occaso
...occcaooooooccaso
....occccccccccassso
.....oaccccccaassso
......ooassssssoo
........ooooooo
""",
"""
...............gggg
..............glllg
.............gllbg
.............gggg
............dd
....dd.....dtd
...dlld...dttd
..dlclldddtttd
..dlcccllllttdd
...dlccclllllttddd
....dllcclllllltttd
.....dlllccllllltttd
......dlllcclllltttd
.......dlllccllttdd
........dlllccltd
.........dlllccd
..........dlccd
...........ddd
""",
"""
..gggg.............gggg
.glllg............glllg
gllbg............gllbg
.gggg............gggg
....dd..........dd
....dtd........dtd
....dttddddddddttd
...dllllllllllllltd
..dlcllllllllllllttd
..dttttttttttttttttd
...dddddddddddddddd
.........hcch
.........hcch
.........hcch
.........hcch
.........hcch
.........hcch
........hcccch
.......hccccchh
.......hhhhhchh
........hhhhhh
""",
"""
....a..............a
...awa............awa
....a..............a
.........oooooo
.......oolllllloo
.....oollwwlllllcoo
....ollwwwllllllccco
...ollwwwllllllllccco
...olwwwlllllllllccco
..ollwwllllllllllcccso
..olwwlllccccclllcccso
..ollllllcvvvclllcccso
..ollllllcclcclllcccso
..ollllllcvvvclllcccso
..ollllllccccclllcccso
...ollllllllllllccsso
...ocllllllllllcccsso
....occcllllccccssso
.....occccccccsssso
......oosssssssoo
........ooooooo
......aa..a..aa
.....aawaaaaawaa
......aaaaaaaaa
""",
"""
.............oo
............olco
...........ollco
..........ollcco
........oollccbo
.......ollllccbo
......ollllccbbbo
.....ollllcccbbbo
....ollllcccbbbbo
....olllcccbbbsbo
...olllcccbbbsbo
...ollcccbbbsbo
..ollcccbbbbsbo
..ollccbbbbsbo
..olcccbbbssbo
..olccbbbssoo
..olcbbbssbo
...ocbbssoo
...ocbsso
...ocsoo
...oco
..oco
..oo
""",
"""
.......ooooooo
......ollllllboo
.....olllllllllboo
....ollllllllllllboo
...ollllccccclllllbbo
...ollcccccccccclllbbo
..olllccllllcllclllbbo
..olllccllllcllclllbbso
.ollllccclccclcclllbbso
.ollllccclcclccclllbbso
olllllccclcclccclllbbso
olllllcccccccccllllbbso
olllllllllllllllllbbsso
.obllllllllllllllbbssso
..obllllllllllllbbsso
...obbbbbbbbbbbbbsso
....osssoobbbbssoo
.....ooo..ossso
...........ooo
""",
"""
.........oooooo
.......ooccccccoo
......occllllllcco
......oclllllllcco
......oclllllllcho
.......occcccchho
........ohhhhhoo
.........oooooo
.......oolllllloo
......olllllllllbo
......olllllllllbo
......ollllllllbso
.......obbbbbbsoo
........osssssoo
.........oooooo
.......ooggggggoo
......oglllllllgo
......oglllllllgo
......ogllllllgso
.......oggggggsoo
........osssssoo
.........oddto
.........odtto
.........odtto
....oooooooooooooooo
...olllllllllllllllbo
....obbbbbbbbbbbbbso
.....oooooooooooooo
""",
]

def make_items():
    for i,k in enumerate(KEYS):
        pal=dict(PAL[k])
        if k in ('yk','tp'):
            pal.update(o='#94704e',s='#c29650',a='#eac06d',c='#fff1b8',l='#d4edff',v='#9294d7',t='#bba4d5')
        im=Image.new('RGBA',(40,40))
        rows=GIFT_MAPS[i].strip('\n').splitlines()
        w=max(map(len,rows)); h=len(rows)
        stamp(im,GIFT_MAPS[i],((40-w)//2,(40-h)//2),pal)
        if k in ('wk','fk','tm'):
            stamp(im,'..a..\n..a..\naawaa\n..a..\n..a..',(31,6),pal)
        im.resize((160,160),Image.Resampling.NEAREST).save(ROOT/'items'/f'{ITEMS[i]}.png')

STATE_JA=['くつろぐ','左へ歩く','大喜び','いやがる','眠る','びっくり']
def previews():
    for state,title in zip(STATES,STATE_JA):
        sheet=Image.new('RGB',(1100,1730),'#f7f2e9'); d=ImageDraw.Draw(sheet)
        d.text((24,12),f'MEMOMON / {title} / 6 frames',font=font(24),fill='#554961')
        for f in range(6): d.text((190+f*150,53),str(f),font=font(16),fill='#897b8f')
        for i,k in enumerate(KEYS):
            y=82+i*163
            d.rounded_rectangle((12,y,1087,y+156),10,fill='#fffdf8' if i%2==0 else '#efe9e2')
            d.text((22,y+58),NAMES[i],font=font(18),fill='#554961')
            for f in range(6):
                im=render(k,state,f); sheet.paste(im,(182+f*150,y),im)
        sheet.save(ROOT/f'preview_{state}.png')
    sheet=Image.new('RGB',(1300,1830),'#f7f2e9'); d=ImageDraw.Draw(sheet)
    d.text((26,17),'MEMOMON / 手描きドットから生まれた10体',font=font(28),fill='#554961')
    d.text((28,58),'くつろぎ・歩行・跳躍・不満・寝息・驚きと、それぞれのおくりもの',font=font(16),fill='#897b8f')
    for j,title in enumerate(STATE_JA+['おくりもの']):
        d.text((200+j*154,99),title,font=font(18),fill='#554961')
    peak=[0,2,3,2,2,3]
    for i,k in enumerate(KEYS):
        y=134+i*166
        d.rounded_rectangle((14,y,1285,y+159),12,fill='#fffdf8' if i%2==0 else '#eee8e1')
        d.text((24,y+55),NAMES[i],font=font(18),fill='#554961')
        d.text((24,y+84),'ULTRA' if i>=6 else 'SUPER',font=font(12),fill='#a08da8')
        for j,state in enumerate(STATES):
            im=render(k,state,peak[j]); sheet.paste(im,(184+j*154,y),im)
        im=Image.open(ROOT/'items'/f'{ITEMS[i]}.png'); sheet.paste(im,(1110,y),im)
    sheet.save(ROOT/'preview.png')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--base',action='store_true'); args=ap.parse_args()
    if args.base:
        for k in KEYS: render(k,'sit',0).save(ROOT/'sprites'/f'{k}_sit_0.png')
        base_preview(); print('Created 10 base poses and preview_sit0.png'); return
    for k in KEYS:
        for state in STATES:
            for f in range(6): render(k,state,f).save(ROOT/'sprites'/f'{k}_{state}_{f}.png')
    base_preview()
    make_items()
    previews()

if __name__=='__main__': main()
