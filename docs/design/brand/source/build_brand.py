#!/usr/bin/env python3
"""Build the Vanilla Press Bloom Seal 04 brand assets (SVG masters + lockups).

Usage: python3 build_brand.py <out_dir> <fraunces-700.woff>

The SVGs are the source of truth. PNG/ICO rasters are made from them separately.
Geometry matches the "Bloom Seal 04" canvas defaults:
  16 bumps, depth 1.0, valley radius 66, rim r 55, petals 11 x 22 at r 26, eye r 9.
"""
import math
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = sys.argv[1]
FONT = sys.argv[2]

# ---- geometry -------------------------------------------------------------
N = 16
DEPTH = 1.0
RV = 66.0
STEP = 2 * math.pi / N
CHORD = 2 * RV * math.sin(STEP / 2)
R_BUMP = CHORD / (2 * math.sin(DEPTH * math.pi / 2))
SAG = R_BUMP - math.sqrt(max(0.0, R_BUMP ** 2 - (CHORD / 2) ** 2))
TIP_R = RV * math.cos(STEP / 2) + SAG  # ~77.6

RIM_R = 55
PRX, PRY, REACH = 11, 22, 26
PCY = 100 - REACH
EYE_R = 9
DOT_R = 3

def f(n):
    s = f"{n:.2f}".rstrip("0").rstrip(".")
    return s if s != "-0" else "0"

def scallop_d():
    def pt(i):
        a = -math.pi / 2 + (i + 0.5) * STEP
        return f"{f(100 + RV * math.cos(a))} {f(100 + RV * math.sin(a))}"
    d = f"M{pt(0)}"
    for i in range(1, N + 1):
        d += f" A{f(R_BUMP)} {f(R_BUMP)} 0 0 1 {pt(i % N)}"
    return d + " Z"

SCALLOP = scallop_d()
ANGLES = [0, 72, 144, 216, 288]

def rot(a):
    return "" if a == 0 else f' transform="rotate({a} 100 100)"'

def petals(fill):
    return "".join(
        f'<ellipse cx="100" cy="{PCY}" rx="{PRX}" ry="{PRY}"{rot(a)}/>' for a in ANGLES
    ).join([f'<g fill="{fill}">', "</g>"])

def veins(stroke):
    y1, y2 = PCY - PRY * 0.5, PCY + PRY * 0.5
    lines = "".join(f'<line x1="100" y1="{f(y1)}" x2="100" y2="{f(y2)}"{rot(a)}/>' for a in ANGLES)
    return f'<g stroke="{stroke}" stroke-width="2" stroke-linecap="round" opacity="0.55">{lines}</g>'

INK = dict(wax="#23314F", rim="#141C30", petal="#F7EEDB", eye="#F0C95A", shine=0.22)
VANILLA = dict(wax="#ECD89A", rim="#C9AD62", petal="#23314F", eye="#B07A4A", shine=0.5)

VB_FULL = "22 22 156 156"   # tight to the bump tips (r ~77.6)
VB_MICRO = "6 6 188 188"    # tight to the r 94 disc

def seal_body(c, full=True):
    """Seal drawing in the 0..200 coordinate space. full = rim, veins and shine."""
    parts = [f'<path fill="{c["wax"]}" d="{SCALLOP}"/>']
    if full:
        parts.append(f'<circle cx="100" cy="100" r="{RIM_R}" fill="none" stroke="{c["rim"]}" stroke-width="4"/>')
    parts.append(petals(c["petal"]))
    if full:
        parts.append(veins(c["wax"]))
    parts.append(f'<circle cx="100" cy="100" r="{EYE_R}" fill="{c["eye"]}"/>')
    parts.append(f'<circle cx="100" cy="100" r="{DOT_R}" fill="{c["wax"]}"/>')
    if full:
        parts.append(
            f'<path d="M54 78 A50 50 0 0 1 86 48" fill="none" stroke="#FFFFFF" '
            f'stroke-opacity="{c["shine"]}" stroke-width="5" stroke-linecap="round"/>'
        )
    return "".join(parts)

MICRO_PETALS = [(100, 62), (136.1, 88.3), (122.3, 130.7), (77.7, 130.7), (63.9, 88.3)]

def micro_body(c):
    circles = "".join(f'<circle cx="{x}" cy="{y}" r="22"/>' for x, y in MICRO_PETALS)
    return (
        f'<circle cx="100" cy="100" r="94" fill="{c["wax"]}"/>'
        f'<g fill="{c["petal"]}">{circles}</g>'
        f'<circle cx="100" cy="100" r="14" fill="{c["eye"]}"/>'
    )

def svg(viewbox, body, title, extra_attrs=""):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}"{extra_attrs} role="img" aria-labelledby="t">'
        f'<title id="t">{title}</title>{body}</svg>\n'
    )

def write(rel, text):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)

# ---- marks ----------------------------------------------------------------
write("svg/seal-ink.svg", svg(VB_FULL, seal_body(INK, True), "Vanilla Press"))
write("svg/seal-ink-medium.svg", svg(VB_FULL, seal_body(INK, False), "Vanilla Press"))
write("svg/seal-ink-micro.svg", svg(VB_MICRO, micro_body(INK), "Vanilla Press"))
write("svg/seal-vanilla.svg", svg(VB_FULL, seal_body(VANILLA, True), "Vanilla Press"))
write("svg/seal-vanilla-medium.svg", svg(VB_FULL, seal_body(VANILLA, False), "Vanilla Press"))
write("svg/seal-vanilla-micro.svg", svg(VB_MICRO, micro_body(VANILLA), "Vanilla Press"))

# One color: the wax in currentColor with the bloom cut through (transparent).
mask_petals = "".join(
    f'<ellipse cx="100" cy="{PCY}" rx="{PRX}" ry="{PRY}"{rot(a)}/>' for a in ANGLES
)
mono = (
    '<defs><mask id="bloom-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">'
    '<rect width="200" height="200" fill="#fff"/>'
    f'<g fill="#000">{mask_petals}</g>'
    f'<circle cx="100" cy="100" r="{EYE_R}" fill="#fff"/>'
    f'<circle cx="100" cy="100" r="{EYE_R - 3}" fill="#000"/>'
    '</mask></defs>'
    f'<path fill="currentColor" mask="url(#bloom-cut)" d="{SCALLOP}"/>'
)
write("svg/seal-mono.svg", svg(VB_FULL, mono, "Vanilla Press"))

# Adaptive favicon: micro drawing, ink in light UI, vanilla in dark UI.
fav = (
    "<style>"
    ".w{fill:#23314F}.p{fill:#F7EEDB}.e{fill:#F0C95A}"
    "@media (prefers-color-scheme: dark){.w{fill:#ECD89A}.p{fill:#23314F}.e{fill:#B07A4A}}"
    "</style>"
    '<circle class="w" cx="100" cy="100" r="94"/>'
    + "".join(f'<circle class="p" cx="{x}" cy="{y}" r="22"/>' for x, y in MICRO_PETALS)
    + '<circle class="e" cx="100" cy="100" r="14"/>'
)
write("favicon.svg", svg(VB_MICRO, fav, "Vanilla Press"))

# ---- wordmark as outlines -------------------------------------------------
font = TTFont(FONT)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
hmtx = font["hmtx"]
upm = font["head"].unitsPerEm
cap_h = getattr(font["OS/2"], "sCapHeight", 0) or upm * 0.7

def wordmark(text, size, tracking_em=-0.02):
    """Return (path_d, width, cap_height) for text set at `size` px, baseline at y=0."""
    scale = size / upm
    x = 0.0
    ds = []
    for ch in text:
        gname = cmap.get(ord(ch))
        if gname is None:
            continue
        pen = SVGPathPen(gs)
        tpen = TransformPen(pen, (scale, 0, 0, -scale, x, 0))
        gs[gname].draw(tpen)
        d = pen.getCommands()
        if d:
            ds.append(d)
        x += hmtx[gname][0] * scale + tracking_em * size
    x -= tracking_em * size
    return " ".join(ds), x, cap_h * scale

def lockup_horizontal(c, text_fill, name):
    seal = 96.0
    gap = 18.0
    size = 46.0
    d, w, ch = wordmark("Vanilla Press", size)
    width = seal + gap + w
    height = seal
    baseline = height / 2 + ch / 2
    s = seal / 156.0
    body = (
        f'<g transform="translate(0 0) scale({s:.5f}) translate(-22 -22)">{seal_body(c, True)}</g>'
        f'<path fill="{text_fill}" transform="translate({f(seal + gap)} {f(baseline)})" d="{d}"/>'
    )
    write(f"svg/{name}", svg(f"0 0 {f(width)} {f(height)}", body, "Vanilla Press"))

def lockup_stacked(c, text_fill, name):
    seal = 96.0
    gap = 14.0
    size = 34.0
    d, w, ch = wordmark("Vanilla Press", size)
    width = max(seal, w)
    height = seal + gap + ch
    s = seal / 156.0
    body = (
        f'<g transform="translate({f((width - seal) / 2)} 0) scale({s:.5f}) translate(-22 -22)">{seal_body(c, True)}</g>'
        f'<path fill="{text_fill}" transform="translate({f((width - w) / 2)} {f(seal + gap + ch)})" d="{d}"/>'
    )
    write(f"svg/{name}", svg(f"0 0 {f(width)} {f(height)}", body, "Vanilla Press"))

lockup_horizontal(INK, "#23314F", "lockup-horizontal-ink.svg")
lockup_horizontal(VANILLA, "#F7EEDB", "lockup-horizontal-vanilla.svg")
lockup_stacked(INK, "#23314F", "lockup-stacked-ink.svg")
lockup_stacked(VANILLA, "#F7EEDB", "lockup-stacked-vanilla.svg")

d, w, ch = wordmark("Vanilla Press", 46)
write("svg/wordmark-ink.svg", svg(f"0 {f(-ch - 2)} {f(w)} {f(ch + 14)}", f'<path fill="#23314F" d="{d}"/>', "Vanilla Press"))
write("svg/wordmark-vanilla.svg", svg(f"0 {f(-ch - 2)} {f(w)} {f(ch + 14)}", f'<path fill="#F7EEDB" d="{d}"/>', "Vanilla Press"))

print(f"tip r {TIP_R:.2f}  bump r {R_BUMP:.2f}  cap {cap_h}")
