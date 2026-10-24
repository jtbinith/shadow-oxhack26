"""Builds Shadow Skeleton, an original display font for the Shadow brand.

Every letter is drawn the way the app draws a dancer: thick rounded "bones"
between points, with a round joint wherever a bone bends or ends. Letters sit
at slightly different heights and angles so a word looks like it's moving.

Usage: .venv/bin/python build_font.py [out_dir]
Writes ShadowSkeleton.otf and ShadowSkeleton.woff2.
"""
import math
import sys
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen

UPM = 1000
CAP = 700
T, M, B = 640, 360, 60   # centreline top, middle, bottom
BONE = 140               # stroke width
JOINT = 94               # joint dot radius (bigger than half a bone, so joints show)
SIDE = 46                # side bearing
BOUNCE = True            # per-letter lift and tilt
BOUNCE_SCALE = 1.8

K = 0.5522847498  # cubic circle constant


def arc(cx, cy, rx, ry, a0, a1, n=40):
    """Points along an elliptical arc, angles in degrees (a1 < a0 goes clockwise)."""
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


class G:
    """A glyph: bones (point lists), curves (point lists without joints) and extra dots."""

    def __init__(self, width, bones=(), curves=(), dots=(), joints=True):
        self.width = width
        self.bones = [list(b) for b in bones]
        self.curves = [list(c) for c in curves]
        self.dots = list(dots)
        self.joints = joints


# ----- letters -------------------------------------------------------------
GLYPHS = {
    "A": G(620, [[(60, B), (310, T), (560, B)], [(150, 250), (470, 250)]]),
    "B": G(560, [[(80, M), (80, T), (320, T)], [(80, M), (340, M)], [(80, M), (80, B), (340, B)]],
           [arc(320, 500, 150, 140, 90, -90), arc(340, 210, 160, 150, 90, -90)]),
    "C": G(580, curves=[arc(330, 350, 260, 290, 45, 315)],
           dots=[(330 + 260 * math.cos(math.radians(45)), 350 + 290 * math.sin(math.radians(45))),
                 (330 + 260 * math.cos(math.radians(315)), 350 + 290 * math.sin(math.radians(315)))]),
    "D": G(600, [[(250, T), (80, T), (80, B), (250, B)]], [arc(250, 350, 280, 290, 90, -90)]),
    "E": G(520, [[(460, T), (80, T), (80, B), (460, B)], [(80, M), (400, M)]]),
    "F": G(500, [[(460, T), (80, T), (80, B)], [(80, M), (400, M)]]),
    "G": G(600, [[(580, 330), (580, 300), (360, 300)]], [arc(320, 350, 260, 290, 45, 360)],
           dots=[(320 + 260 * math.cos(math.radians(45)), 350 + 290 * math.sin(math.radians(45)))]),
    "H": G(600, [[(80, B), (80, T)], [(520, B), (520, T)], [(80, M), (520, M)]]),
    "I": G(200, [[(100, B), (100, T)]]),
    "J": G(480, [[(400, T), (400, 230)]], [arc(240, 230, 160, 170, 0, -180)], dots=[(80, 230)]),
    "K": G(580, [[(80, B), (80, T)], [(500, T), (80, 290)], [(220, 380), (520, B)]]),
    "L": G(480, [[(80, T), (80, B), (440, B)]]),
    "M": G(720, [[(80, B), (80, T), (360, 300), (640, T), (640, B)]]),
    "N": G(620, [[(80, B), (80, T), (540, B), (540, T)]]),
    "O": G(640, curves=[arc(320, 350, 260, 290, 0, 360, 64)], joints=False),
    "P": G(540, [[(80, B), (80, T), (300, T)], [(300, M), (80, M)]], [arc(300, 500, 150, 140, 90, -90)]),
    "Q": G(640, [[(380, 200), (580, B)]], [arc(320, 350, 260, 290, 0, 360, 64)]),
    "R": G(560, [[(80, B), (80, T), (300, T)], [(300, M), (80, M)], [(260, M), (500, B)]],
           [arc(300, 500, 150, 140, 90, -90)]),
    "S": G(540, curves=[arc(270, 500, 200, 140, 20, 270), arc(270, 210, 210, 150, 90, -160)],
           dots=[(270 + 200 * math.cos(math.radians(20)), 500 + 140 * math.sin(math.radians(20))),
                 (270 + 210 * math.cos(math.radians(-160)), 210 + 150 * math.sin(math.radians(-160)))]),
    "T": G(560, [[(60, T), (500, T)], [(280, T), (280, B)]]),
    "U": G(600, [[(80, T), (80, 300)], [(520, 300), (520, T)]], [arc(300, 300, 220, 240, 180, 360)]),
    "V": G(600, [[(60, T), (300, B), (540, T)]]),
    "W": G(820, [[(60, T), (220, B), (410, 450), (600, B), (760, T)]]),
    "X": G(580, [[(70, T), (510, B)], [(510, T), (70, B)]]),
    "Y": G(580, [[(70, T), (290, 340), (510, T)], [(290, 340), (290, B)]]),
    "Z": G(540, [[(70, T), (470, T), (70, B), (470, B)]]),
    # ----- digits ----------------------------------------------------------
    "0": G(560, curves=[arc(280, 350, 220, 290, 0, 360, 64)], joints=False),
    "1": G(360, [[(80, 540), (220, T), (220, B)]]),
    "2": G(540, [[(458, 425), (70, B), (480, B)]], [arc(270, 480, 200, 160, 160, -20)],
           dots=[(270 + 200 * math.cos(math.radians(160)), 480 + 160 * math.sin(math.radians(160)))]),
    "3": G(520, curves=[arc(260, 500, 190, 140, 150, -90), arc(260, 210, 210, 150, 90, -150)],
           dots=[(260 + 190 * math.cos(math.radians(150)), 500 + 140 * math.sin(math.radians(150))),
                 (260 + 210 * math.cos(math.radians(-150)), 210 + 150 * math.sin(math.radians(-150))),
                 (260, 360)]),
    "4": G(560, [[(400, B), (400, T), (60, 230), (500, 230)]]),
    "5": G(520, [[(460, T), (110, T), (109, 339)]], [arc(270, 230, 210, 170, 140, -150)],
           dots=[(270 + 210 * math.cos(math.radians(-150)), 230 + 170 * math.sin(math.radians(-150)))]),
    "6": G(540, [[(420, T), (110, 260)]], [arc(280, 220, 200, 160, 0, 360, 64)]),
    "7": G(520, [[(60, T), (460, T), (200, B)]]),
    "8": G(520, curves=[arc(260, 510, 170, 130, 0, 360, 64), arc(260, 215, 200, 155, 0, 360, 64)],
           dots=[(260, 380)]),
    "9": G(540, [[(455, 450), (200, B)]], [arc(260, 480, 200, 160, 0, 360, 64)]),
    # ----- punctuation -----------------------------------------------------
    ".": G(180, dots=[(90, B)]),
    ",": G(200, [[(110, B), (60, -90)]]),
    "!": G(200, [[(100, T), (100, 260)]], dots=[(100, B)]),
    "?": G(500, [[(250, 380), (250, 260)]], [arc(250, 510, 190, 140, 160, -90)],
           dots=[(250, B), (250 + 190 * math.cos(math.radians(160)), 510 + 140 * math.sin(math.radians(160)))]),
    "-": G(400, [[(60, 330), (340, 330)]]),
    ":": G(180, dots=[(90, B), (90, 400)]),
    "'": G(180, [[(90, T), (90, 500)]]),
    "+": G(500, [[(250, 160), (250, 500)], [(80, 330), (420, 330)]]),
}

# Hand-tuned bounce: (lift in units, tilt in degrees). Letters not listed don't move.
BOUNCE_TABLE = {
    "A": (18, -3), "B": (-10, 2), "C": (12, -2), "D": (-14, 2), "E": (16, -3), "F": (-12, 2),
    "G": (10, 3), "H": (-16, -2), "I": (20, 3), "J": (-18, -3), "K": (14, 2), "L": (-10, -3),
    "M": (8, 2), "N": (-14, -2), "O": (16, 3), "P": (-12, -2), "Q": (10, 2), "R": (-16, 3),
    "S": (18, -3), "T": (-10, 2), "U": (12, -2), "V": (-14, 3), "W": (8, -2), "X": (-12, 2),
    "Y": (16, -3), "Z": (-18, 2),
}


# ----- geometry --------------------------------------------------------------
def ccw(points):
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]))
    return points if area > 0 else points[::-1]


def add_poly(path, pts):
    pts = ccw(pts)
    path.moveTo(*pts[0])
    for p in pts[1:]:
        path.lineTo(*p)
    path.close()


def add_circle(path, cx, cy, r):
    # counter-clockwise, four cubics
    k = r * K
    path.moveTo(cx + r, cy)
    path.cubicTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    path.cubicTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    path.cubicTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    path.cubicTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    path.close()


def add_bone(path, p, q, w):
    (x0, y0), (x1, y1) = p, q
    d = math.hypot(x1 - x0, y1 - y0)
    if d < 1e-6:
        return
    nx, ny = -(y1 - y0) / d * w / 2, (x1 - x0) / d * w / 2
    add_poly(path, [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)])


def transform(g, lift, tilt):
    cx, cy = g.width / 2, CAP / 2
    a = math.radians(tilt)
    ca, sa = math.cos(a), math.sin(a)

    def f(p):
        x, y = p[0] - cx, p[1] - cy
        return (cx + x * ca - y * sa, cy + x * sa + y * ca + lift)
    return f


def outline(name, g):
    lift, tilt = BOUNCE_TABLE.get(name, (0, 0)) if BOUNCE else (0, 0)
    lift, tilt = lift * BOUNCE_SCALE, tilt * BOUNCE_SCALE
    f = transform(g, lift, tilt)
    path = pathops.Path()
    for line in g.bones + g.curves:
        pts = [f(p) for p in line]
        for p, q in zip(pts, pts[1:]):
            add_bone(path, p, q, BONE)
        for p in pts:
            add_circle(path, *p, BONE / 2)
    if g.joints:
        curve_ends = [c[i] for c in g.curves for i in (0, -1)]
        for line in g.bones:
            for p in line:
                if any(math.dist(p, e) < 25 for e in curve_ends):
                    continue  # bone flows into a curve here: no joint
                add_circle(path, *f(p), JOINT)
    for p in g.dots:
        add_circle(path, *f(p), JOINT)
    path.simplify(fix_winding=True, clockwise=False)
    return path


# ----- font ------------------------------------------------------------------
def build(out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    names = {ch: ("uni%04X" % ord(ch)) for ch in GLYPHS}
    names.update({c: c for c in GLYPHS if c.isalnum() and c.isupper()})
    order = [".notdef", "space"] + [names[c] for c in GLYPHS]

    cmap = {32: "space"}
    for ch in GLYPHS:
        cmap[ord(ch)] = names[ch]
        if ch.isalpha():
            cmap[ord(ch.lower())] = names[ch]  # caps-only face: lowercase maps to caps

    charstrings, metrics = {}, {}
    for blank, adv in ((".notdef", 500), ("space", 260)):
        charstrings[blank] = T2CharStringPen(adv, None).getCharString()
        metrics[blank] = (adv, 0)

    for ch, g in GLYPHS.items():
        path = outline(ch, g)
        xmin, _, xmax, _ = path.bounds
        adv = round(xmax - xmin + 2 * SIDE)
        pen = T2CharStringPen(adv, None)
        path.draw(TransformPen(pen, (1, 0, 0, 1, SIDE - xmin, 0)))  # left side bearing = SIDE
        charstrings[names[ch]] = pen.getCharString()
        metrics[names[ch]] = (adv, SIDE)

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupCFF("ShadowSkeleton-Regular", {"FullName": "Shadow Skeleton"}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=860, descent=-200)
    fb.setupNameTable({"familyName": "Shadow Skeleton", "styleName": "Regular",
                       "copyright": "Copyright 2026 Team Shadow (OxHack '26)"})
    fb.setupOS2(sTypoAscender=860, sTypoDescender=-200, usWinAscent=900, usWinDescent=220,
                sCapHeight=CAP, sxHeight=CAP)
    fb.setupPost()
    otf = out_dir / "ShadowSkeleton.otf"
    fb.save(str(otf))
    fb.font.flavor = "woff2"
    fb.save(str(out_dir / "ShadowSkeleton.woff2"))
    print("wrote", otf, "and .woff2 with", len(GLYPHS), "glyphs")


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "out")
