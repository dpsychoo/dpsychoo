#!/usr/bin/env python3
"""Generate the self-contained SGODX profile hero SVGs.

Requires Pillow: python -m pip install Pillow
Run from any directory: python scripts/generate_hero.py

The portrait source stays local in .local-assets/ (which is intentionally
gitignored). The resulting SVGs contain all portrait and animation geometry.
"""

from __future__ import annotations

import argparse
import base64
import math
import random
from io import BytesIO
from collections import deque
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


WIDTH, HEIGHT = 1180, 610
PORTRAIT_SIZE = (300, 340)
MORPH_COUNT = 208
LOOP_SECONDS = 24
INTRO_SECONDS = 3.2
LOOP_KEY_TIMES = "0;.083;.158;.25;.325;.417;.492;.583;.658;1"
LOOP_SPLINES = ";".join([".42 0 .58 1"] * 9)
SEED = 7319

ROWS = [
    ("Subject", "David Castro"),
    ("Role", "Full-Stack Developer · AI Product Builder"),
    ("Origin", "La Serena · Chile"),
    ("Education", "Computer Engineering · 6 Semesters"),
    ("Status", "Building · Automating · Shipping"),
    ("ToolChain", "VS Code · Git · Vercel · Figma"),
    ("Core.Lang", "JavaScript · TypeScript · Python · SQL"),
    ("Core.Frontend", "React · Astro · GSAP · WebGL"),
    ("Core.Backend", "Node.js · Express · REST APIs"),
    ("Core.Database", "PostgreSQL · Supabase"),
    ("Core.Infra", "Vercel · GitHub Actions"),
    ("Grid.Mail", "phoenix6ccxr@gmail.com"),
    ("Grid.Portfolio", "coming soon"),
    ("Grid.LinkedIn", "/in/david-castro-b6a287240"),
    ("Grid.GitHub", "github.com/dpsychoo"),
    ("Grid.Instagram", "@sgodx_"),
]

THEMES = {
    "dark": {
        "bg": "#080B14",
        "panel": "#0A101F",
        "panel_alt": "#0D1526",
        "line": "#202B3D",
        "line_soft": "#172133",
        "text": "#F8FAFC",
        "muted": "#94A3B8",
        "quiet": "#65758C",
        "portrait": "#A78BFA",
        "violet": "#7C3AED",
        "cyan": "#22D3EE",
        "green": "#10B981",
        "value": "#E5EDF7",
        "shadow": "#050810",
    },
    "light": {
        "bg": "#F4F7FB",
        "panel": "#FFFFFF",
        "panel_alt": "#F8FAFD",
        "line": "#D8E1EC",
        "line_soft": "#E8EDF4",
        "text": "#0B1324",
        "muted": "#536174",
        "quiet": "#78879A",
        "portrait": "#7C3AED",
        "violet": "#6D28D9",
        "cyan": "#0E7490",
        "green": "#047857",
        "value": "#172335",
        "shadow": "#E9EEF5",
    },
}


def foreground_mask(image: Image.Image) -> Image.Image:
    """Isolate the warm-clothed subject from the cool city background.

    The mask is color based, with a small spatial restriction for skin and the
    dark cap. It avoids hand-drawn contours and keeps the treatment repeatable.
    """
    rgb = image.convert("RGB")
    pixels = rgb.load()
    mask = Image.new("L", rgb.size, 0)
    out = mask.load()
    width, height = rgb.size

    for y in range(height):
        ny = y / max(1, height - 1)
        for x in range(width):
            nr = x / max(1, width - 1)
            red, green, blue = pixels[x, y]
            maximum, minimum = max(red, green, blue), min(red, green, blue)
            saturation = (maximum - minimum) / max(1, maximum)
            hue = 0.0
            if maximum != minimum:
                if maximum == red:
                    hue = 60 * ((green - blue) / (maximum - minimum) % 6)
                elif maximum == green:
                    hue = 60 * ((blue - red) / (maximum - minimum) + 2)
                else:
                    hue = 60 * ((red - green) / (maximum - minimum) + 4)

            # Red fabric, including its darker shadows and folds.
            red_cloth = saturation > 0.17 and (hue <= 16 or hue >= 341)

            # Skin stays in the central head/neck region so warm buildings at
            # the crop edge do not leak into the cutout.
            skin = (
                0.29 <= nr <= 0.79
                and 0.07 <= ny <= 0.56
                and red > green + 7
                and green > blue + 6
                and 5 <= hue <= 39
                and 0.12 <= saturation <= 0.67
                and red >= 74
            )

            # The hat is a dark, low-saturation oval above the face. This
            # protects it from the blue-gray background key.
            hat_region = ((nr - 0.52) / 0.25) ** 2 + ((ny - 0.17) / 0.19) ** 2 <= 1
            cap = hat_region and max(red, green, blue) < 105

            if red_cloth or skin or cap:
                out[x, y] = 255

    # Close single-pixel gaps around the cap and clothing, then keep the main
    # connected subject component so warm background highlights do not become
    # stray portrait dots.
    closed = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    raw = closed.tobytes()
    seen = bytearray(len(raw))
    largest: list[int] = []

    for start, value in enumerate(raw):
        if value < 128 or seen[start]:
            continue
        component = []
        queue = deque([start])
        seen[start] = 1
        while queue:
            index = queue.popleft()
            component.append(index)
            x = index % width
            for row in (index - width, index, index + width):
                if row < 0 or row >= width * height:
                    continue
                row_x = row - x
                for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row_x + neighbor_x
                    if raw[neighbor] >= 128 and not seen[neighbor]:
                        seen[neighbor] = 1
                        queue.append(neighbor)
        if len(component) > len(largest):
            largest = component

    clean = bytearray(width * height)
    for index in largest:
        clean[index] = 255
    # A small blur softens only the cutout edge before it is downsampled.
    return Image.frombytes("L", (width, height), bytes(clean)).filter(
        ImageFilter.GaussianBlur(radius=1.25)
    )


def serpentine_floyd_steinberg(
    gray: Image.Image, foreground: Image.Image
) -> list[tuple[int, int]]:
    """Return on-pixels from a one-bit serpentine Floyd–Steinberg pass."""
    width, height = gray.size
    raw_values = gray.tobytes()
    values = [
        list(raw_values[y * width : (y + 1) * width]) for y in range(height)
    ]
    mask = foreground.load()
    dots: list[tuple[int, int]] = []

    for y in range(height):
        reverse = y % 2 == 1
        indices = range(width - 1, -1, -1) if reverse else range(width)
        step = -1 if reverse else 1
        for x in indices:
            if mask[x, y] < 112:
                values[y][x] = 0
                continue
            old = max(0.0, min(255.0, values[y][x]))
            quantized = 255 if old >= 128 else 0
            values[y][x] = quantized
            if quantized:
                dots.append((x, y))
            error = old - quantized

            def diffuse(nx: int, ny: int, weight: float) -> None:
                if 0 <= nx < width and 0 <= ny < height and mask[nx, ny] >= 112:
                    values[ny][nx] += error * weight / 16

            diffuse(x + step, y, 7)
            diffuse(x - step, y + 1, 3)
            diffuse(x, y + 1, 5)
            diffuse(x + step, y + 1, 1)

    return dots


def portrait_dots(source: Path) -> list[tuple[int, int]]:
    image = Image.open(source).convert("RGB")
    width, height = image.size
    # A consistent head-and-shoulders crop that includes the cap and crossed
    # arms while excluding most of the surrounding city.
    crop = image.crop(
        (
            round(width * 0.115),
            round(height * 0.115),
            round(width * 0.885),
            round(height * 0.965),
        )
    )
    mask = foreground_mask(crop)
    base = Image.new("RGB", crop.size, (0, 0, 0))
    base.paste(crop, mask=mask)
    small = base.resize(PORTRAIT_SIZE, Image.Resampling.LANCZOS)
    small_mask = mask.resize(PORTRAIT_SIZE, Image.Resampling.LANCZOS)

    gray = ImageOps.grayscale(small)
    gray = ImageOps.autocontrast(gray, cutoff=1)
    gray = ImageEnhance.Contrast(gray).enhance(1.3)
    gray = gray.filter(ImageFilter.UnsharpMask(radius=3, percent=140))
    return serpentine_floyd_steinberg(gray, small_mask)


def sample_evenly(points: list[tuple[float, float]], count: int) -> list[tuple[float, float]]:
    if not points:
        raise ValueError("A morph target did not contain any usable dots")
    if len(points) == count:
        return points
    if len(points) < count:
        return [points[round(i * (len(points) - 1) / max(1, count - 1))] for i in range(count)]
    return [points[round(i * (len(points) - 1) / (count - 1))] for i in range(count)]


def sgodx_geometry(logo_path: Path) -> tuple[list[tuple[float, float]], dict[str, str]]:
    image = Image.open(logo_path).convert("RGBA")
    # The supplied mark has a black canvas and electric-blue/white artwork.
    px = image.load()
    content = Image.new("L", image.size, 0)
    cp = content.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = px[x, y]
            lum = round(0.2126 * red + 0.7152 * green + 0.0722 * blue)
            if alpha > 8 and lum > 30 and (blue > red * 1.12 or lum > 205):
                cp[x, y] = 255
    bounds = content.getbbox()
    if not bounds:
        raise ValueError(f"No illuminated SGODX emblem pixels found in {logo_path}")
    cropped = image.crop(bounds)
    mark = cropped.resize((452, 200), Image.Resampling.LANCZOS)
    mark_pixels = mark.load()
    # Use the stronger source pixel for each mirrored pair so the raster mark
    # and its travelling particles share a clean vertical centerline.
    for y in range(mark.height):
        for x in range(mark.width // 2):
            mirror_x = mark.width - x - 1
            left = mark_pixels[x, y]
            right = mark_pixels[mirror_x, y]

            def signal(pixel: tuple[int, int, int, int]) -> float:
                red, green, blue, alpha = pixel
                lum = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                return alpha * lum

            chosen = left if signal(left) >= signal(right) else right
            mark_pixels[x, y] = chosen
            mark_pixels[mirror_x, y] = chosen
    thumb = mark.resize((226, 100), Image.Resampling.LANCZOS)
    sample = thumb.load()
    travelling_pairs: list[tuple[tuple[float, float], tuple[float, float]]] = []

    def layer_level(x: int, y: int) -> int:
        red, green, blue, alpha = sample[x, y]
        if alpha <= 8:
            return 0
        lum = 0.2126 * red + 0.7152 * green + 0.0722 * blue
        blue_ink = blue > 48 and blue >= green * 0.72 and blue > red * 1.08
        if min(red, green, blue) > 172:
            return 3
        if green > 70 and blue > 95 and green > red * 1.35 and blue >= green * 0.72:
            return 2
        return 1 if lum > 24 and blue_ink else 0

    def mirrored_pair(x: int, y: int) -> tuple[tuple[float, float], tuple[float, float]]:
        left_x = 38 + x / 111 * 112
        target_y = 120 + y / 99 * 100
        return (left_x, target_y), (300 - left_x, target_y)

    # Read the original mark as a layered bitmap, then mirror the stronger
    # signal from each pixel pair to give both flame eyes the same contour.
    # A two-pixel sampling pitch keeps the fill crisp and particle-like.
    for y in range(1, thumb.height, 2):
        for x in range(0, 112, 2):
            level = max(layer_level(x, y), layer_level(225 - x, y))
            if level == 0:
                continue
            pair = mirrored_pair(x, y)
            travelling_pairs.append(pair)

    sampled_pairs = sample_evenly(travelling_pairs, MORPH_COUNT // 2)
    travelling_points = [point for pair in sampled_pairs for point in pair]

    # A few tiny side sparks echo the source's detached electric fragments.
    shard_left = [(33, 132), (37, 137), (32, 158), (36, 163)]
    shards = []
    for x, y in shard_left:
        shards.extend(((float(x), float(y)), (300.0 - x, float(y))))

    image_data = BytesIO()
    mark.save(image_data, format="PNG", optimize=True)
    embedded_mark = base64.b64encode(image_data.getvalue()).decode("ascii")
    shard_paths = "".join(f"M{fmt(x)} {fmt(y)}h.01" for x, y in shards)

    return travelling_points, {"image": embedded_mark, "shards": shard_paths}


def react_points() -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    cx, cy = 150, 168
    for angle in (0, 60, -60):
        radians = math.radians(angle)
        for i in range(96):
            theta = math.tau * i / 96
            x, y = 72 * 1.4 * math.cos(theta), 28 * 1.4 * math.sin(theta)
            points.append(
                (
                    cx + x * math.cos(radians) - y * math.sin(radians),
                    cy + x * math.sin(radians) + y * math.cos(radians),
                )
            )
    points.extend([(150, 168)] * 8)
    return points


def node_points() -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []

    def line(a: tuple[float, float], b: tuple[float, float], steps: int) -> None:
        for i in range(steps):
            t = i / max(1, steps - 1)
            points.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))

    hexagon = [(150, 95), (210, 130), (210, 200), (150, 235), (90, 200), (90, 130)]
    for index, point in enumerate(hexagon):
        line(point, hexagon[(index + 1) % len(hexagon)], 40)
    # An N-like circuit inside the shield gives the dot form its own identity.
    line((124, 188), (124, 140), 24)
    line((124, 140), (176, 188), 28)
    line((176, 188), (176, 140), 24)
    return [(150 + (x - 150) * 1.65, 165 + (y - 165) * 1.65) for x, y in points]


def fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def svg_logo_references() -> dict[str, str]:
    react = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="React">
  <g fill="none" stroke="#22D3EE" stroke-width="3">
    <ellipse cx="32" cy="32" rx="27" ry="10"/>
    <ellipse cx="32" cy="32" rx="27" ry="10" transform="rotate(60 32 32)"/>
    <ellipse cx="32" cy="32" rx="27" ry="10" transform="rotate(-60 32 32)"/>
  </g>
  <circle cx="32" cy="32" r="4.5" fill="#22D3EE"/>
</svg>
'''
    node = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Node.js">
  <path d="M32 4 56 18v28L32 60 8 46V18Z" fill="none" stroke="#10B981" stroke-width="3" stroke-linejoin="round"/>
  <path d="M21 42V23l22 19V23" fill="none" stroke="#10B981" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'''
    return {"react-mark.svg": react, "node-mark.svg": node}


def make_leader(label: str, value: str, y: float, colors: dict[str, str]) -> str:
    font_size = 13.4
    char_width = font_size * 0.602
    label_x = 499
    value_right = 1115
    label_end = label_x + len(label) * char_width
    value_start = value_right - len(value) * char_width
    leader_start = label_end + 12
    leader_end = max(leader_start + 13, value_start - 12)
    return (
        f'<text x="{label_x}" y="{y}" class="label">{escape(label)}</text>'
        f'<path d="M{fmt(leader_start)} {fmt(y - 4)}H{fmt(leader_end)}" '
        f'fill="none" stroke="{colors["line"]}" stroke-width="1.2" '
        f'stroke-dasharray="0.8 4.1" stroke-linecap="round"/>'
        f'<text x="{value_right}" y="{y}" text-anchor="end" class="value">{escape(value)}</text>'
    )


def icon_caption(
    label: str, opacity: str, colors: dict[str, str], color: str = "cyan"
) -> str:
    return (
        f'<text x="242" y="535" text-anchor="middle" class="caption" '
        f'opacity="0" fill="{colors[color]}">{escape(label)}'
        f'<animate attributeName="opacity" values="{opacity}" keyTimes="0;.083;.105;.145;.158;.25;.325;.417;.492;.583;.658;1" '
        f'dur="{LOOP_SECONDS}s" begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>'
        f'</text>'
    )


def morph_dot(
    origin: tuple[int, int],
    sgodx: tuple[float, float],
    react: tuple[float, float],
    node: tuple[float, float],
    colors: dict[str, str],
) -> str:
    targets = [origin, origin, sgodx, sgodx, react, react, node, node, origin, origin]
    xs = ";".join(fmt(p[0] + 0.5) for p in targets)
    ys = ";".join(fmt(p[1] + 0.5) for p in targets)
    return (
        f'<circle cx="{fmt(origin[0] + 0.5)}" cy="{fmt(origin[1] + 0.5)}" r="1.22" opacity="0">'
        f'<animate attributeName="cx" values="{xs}" keyTimes="{LOOP_KEY_TIMES}" '
        f'calcMode="spline" keySplines="{LOOP_SPLINES}" dur="{LOOP_SECONDS}s" '
        f'begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>'
        f'<animate attributeName="cy" values="{ys}" keyTimes="{LOOP_KEY_TIMES}" '
        f'calcMode="spline" keySplines="{LOOP_SPLINES}" dur="{LOOP_SECONDS}s" '
        f'begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>'
        f'<animate attributeName="fill" values="{colors["cyan"]};{colors["cyan"]};{colors["cyan"]};{colors["cyan"]};{colors["cyan"]};{colors["cyan"]};{colors["green"]};{colors["green"]};{colors["cyan"]};{colors["cyan"]}" '
        f'keyTimes="{LOOP_KEY_TIMES}" calcMode="discrete" dur="{LOOP_SECONDS}s" '
        f'begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>'
        f'<animate attributeName="opacity" values="0;1;1;1;1;1;1;0;0;0" '
        f'keyTimes="{LOOP_KEY_TIMES}" calcMode="discrete" dur="{LOOP_SECONDS}s" '
        f'begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>'
        f'</circle>'
    )


def build_svg(
    theme_name: str,
    dense_dots: list[tuple[int, int]],
    icon_sets: tuple[list[tuple[float, float]], ...],
    sgodx_layers: dict[str, str],
    rng: random.Random,
) -> str:
    c = THEMES[theme_name]
    sgodx, react, node = icon_sets
    origins = sample_evenly(rng.sample(dense_dots, min(MORPH_COUNT, len(dense_dots))), MORPH_COUNT)
    sgodx = sample_evenly(sgodx, MORPH_COUNT)
    react = sample_evenly(react, MORPH_COUNT)
    node = sample_evenly(node, MORPH_COUNT)

    buckets: list[list[tuple[int, int]]] = [[] for _ in range(20)]
    shuffled = list(dense_dots)
    rng.shuffle(shuffled)
    for index, dot in enumerate(shuffled):
        buckets[index % len(buckets)].append(dot)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title description">',
        '<title id="title">David Castro · SGODX developer profile</title>',
        '<desc id="description">Animated terminal-style profile banner with a one-bit portrait and system information.</desc>',
        '<defs>',
        '<clipPath id="portrait-window"><rect x="82" y="150" width="320" height="348" rx="7"/></clipPath>',
        '<filter id="sgodx-soft-glow" x="-35%" y="-80%" width="170%" height="260%" color-interpolation-filters="sRGB">',
        '<feGaussianBlur in="SourceGraphic" stdDeviation="2.1" result="blue-halo"/>',
        '<feMerge><feMergeNode in="blue-halo"/><feMergeNode in="SourceGraphic"/></feMerge>',
        '</filter>',
        '<linearGradient id="header-sheen" x1="0" y1="0" x2="1" y2="1">',
        f'<stop offset="0" stop-color="{c["panel"]}"/><stop offset="1" stop-color="{c["panel_alt"]}"/>',
        '</linearGradient>',
        '</defs>',
        f'<rect width="{WIDTH}" height="{HEIGHT}" rx="26" fill="{c["bg"]}"/>',
        f'<rect x="23.5" y="19.5" width="1133" height="571" rx="21" fill="{c["panel"]}" stroke="{c["line"]}"/>',
        f'<path d="M24 42Q24 20 46 20H1134Q1156 20 1156 42V73H24Z" fill="url(#header-sheen)"/>',
        f'<path d="M24 73.5H1156" stroke="{c["line"]}"/>',
        f'<circle cx="51" cy="47" r="5.2" fill="{c["quiet"]}" opacity=".72"/>',
        f'<circle cx="69" cy="47" r="5.2" fill="{c["quiet"]}" opacity=".5"/>',
        f'<circle cx="87" cy="47" r="5.2" fill="{c["quiet"]}" opacity=".34"/>',
        f'<text x="108" y="52" class="terminal-title" fill="{c["text"]}">profile.sh --live</text>',
        f'<rect x="920" y="34" width="83" height="27" rx="13.5" fill="{c["panel_alt"]}" stroke="{c["line"]}"/>',
        f'<circle cx="937" cy="47.5" r="3.2" fill="{c["green"]}">',
        '<animate attributeName="opacity" values="1;.48;1" dur="1.8s" repeatCount="indefinite"/>',
        '</circle>',
        f'<text x="948" y="52" class="badge" fill="{c["green"]}">LIVE</text>',
        f'<rect x="1014" y="34" width="122" height="27" rx="13.5" fill="{c["green"]}" opacity=".13"/>',
        f'<rect x="1014" y="34" width="122" height="27" rx="13.5" fill="none" stroke="{c["green"]}" opacity=".48"/>',
        f'<text x="1075" y="52" text-anchor="middle" class="badge" fill="{c["green"]}">@dpsychoo</text>',
        f'<rect x="41" y="91" width="401" height="470" rx="14" fill="{c["panel_alt"]}" stroke="{c["line"]}"/>',
        f'<rect x="478" y="91" width="655" height="470" rx="14" fill="{c["panel_alt"]}" stroke="{c["line"]}"/>',
        f'<path d="M459.5 101V551" stroke="{c["line_soft"]}"/>',
        f'<circle cx="60" cy="117" r="3.2" fill="{c["violet"]}"/>',
        f'<text x="72" y="121" class="section-title" fill="{c["text"]}">VISUAL.MAP</text>',
        f'<text x="422" y="120" text-anchor="end" class="micro" fill="{c["muted"]}">01 / 02</text>',
        f'<path d="M56 136H427" stroke="{c["line_soft"]}"/>',
        f'<rect x="59" y="145" width="365" height="370" rx="10" fill="{c["bg"]}" stroke="{c["line"]}"/>',
        f'<path d="M72 160H411M72 500H411" stroke="{c["line_soft"]}" stroke-dasharray="1 6"/>',
        '<g clip-path="url(#portrait-window)">',
        '<g transform="translate(94 158)">',
        f'<g fill="{c["portrait"]}" opacity="1">',
    ]

    for group_index, dots in enumerate(buckets):
        path_data = "".join(f"M{x + 0.5:.1f} {y + 0.5:.1f}h.001" for x, y in dots)
        delay = max(0.02, min(2.65, group_index * 0.135 + rng.uniform(-0.075, 0.075)))
        parts.extend(
            [
                f'<path d="{path_data}" fill="none" stroke="{c["portrait"]}" stroke-width=".84" stroke-linecap="round" opacity="1">',
                f'<set attributeName="opacity" to="0" begin="0s" dur="{delay:.3f}s"/>',
                f'<animate attributeName="opacity" from="0" to="1" begin="{delay:.3f}s" dur=".24s" fill="freeze"/>',
                '</path>',
            ]
        )

    parts.extend(
        [
            f'<animate attributeName="opacity" values="1;1;.17;.17;1;1" keyTimes="0;.083;.158;.583;.658;1" dur="{LOOP_SECONDS}s" begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>',
            '</g>',
            '<g opacity="0">',
            f'<image x="38" y="120" width="224" height="100" preserveAspectRatio="none" href="data:image/png;base64,{sgodx_layers["image"]}" filter="url(#sgodx-soft-glow)"/>',
            f'<path d="{sgodx_layers["shards"]}" fill="none" stroke="#2563EB" stroke-width="1.05" stroke-linecap="round" opacity=".72"/>',
            f'<animate attributeName="opacity" values="0;0;.22;.82;1;1;.78;0;0" keyTimes="0;.083;.105;.145;.158;.25;.30;.325;1" dur="{LOOP_SECONDS}s" begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>',
            '</g>',
            f'<g fill="{c["cyan"]}" opacity="1">',
        ]
    )
    for origin, p_sgodx, p_react, p_node in zip(origins, sgodx, react, node):
        parts.append(morph_dot(origin, p_sgodx, p_react, p_node, c))

    parts.extend(
        [
            '</g>',
            '</g>',
            '</g>',
            f'<text x="242" y="535" text-anchor="middle" class="caption" fill="{c["muted"]}" opacity="1">PORTRAIT // 1-BIT',
            f'<animate attributeName="opacity" values="1;1;0;0;0;0;0;0;1;1" keyTimes="{LOOP_KEY_TIMES}" calcMode="discrete" dur="{LOOP_SECONDS}s" begin="{INTRO_SECONDS}s" repeatCount="indefinite"/>',
            '</text>',
            icon_caption("SGODX // IDENTITY", "0;0;0;.4;1;1;0;0;0;0;0;0", c),
            icon_caption("REACT // INTERFACE", "0;0;0;0;0;0;.4;1;1;0;0;0", c),
            icon_caption("NODE.JS // RUNTIME", "0;0;0;0;0;0;0;0;.4;1;0;0", c, "green"),
            f'<text x="500" y="121" class="section-title" fill="{c["text"]}">SYSTEM.INFO</text>',
            f'<text x="1112" y="120" text-anchor="end" class="micro" fill="{c["muted"]}">SGODX / READOUT</text>',
            f'<path d="M495 136H1116" stroke="{c["line_soft"]}"/>',
        ]
    )

    for index, (label, value) in enumerate(ROWS):
        y = 162 + index * 23
        parts.append(make_leader(label, value, y, c))
        if index in (4, 10):
            parts.append(
                f'<path d="M495 {y + 11}H1116" stroke="{c["line_soft"]}" stroke-dasharray="1 5" opacity=".72"/>'
            )

    parts.extend(
        [
            f'<path d="M495 535H1116" stroke="{c["line_soft"]}"/>',
            f'<text x="499" y="550" class="micro" fill="{c["quiet"]}">FULL-STACK</text>',
            f'<circle cx="587" cy="546" r="2" fill="{c["green"]}"/>',
            f'<text x="598" y="550" class="micro" fill="{c["muted"]}">BUILDING / AUTOMATING / SHIPPING</text>',
            f'<text x="1115" y="550" text-anchor="end" class="micro" fill="{c["quiet"]}">LA SERENA · CL</text>',
            f'<text x="42" y="582" class="micro" fill="{c["quiet"]}">SGODX / PERSONAL SYSTEMS</text>',
            f'<text x="1138" y="582" text-anchor="end" class="micro" fill="{c["quiet"]}">1180 × 610 · PROFILE SESSION</text>',
            '<style>',
            'text{font-family:"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",monospace}',
            '.terminal-title{font-size:14px;font-weight:500;letter-spacing:.1px}',
            '.badge{font-size:10.4px;font-weight:700;letter-spacing:.6px}',
            '.section-title{font-size:14px;font-weight:700;letter-spacing:1.1px}',
            '.micro{font-size:9px;letter-spacing:.75px}',
            '.label{font-size:13.4px;letter-spacing:0;fill:' + c["muted"] + '}',
            '.value{font-size:13.4px;letter-spacing:0;fill:' + c["value"] + '}',
            '.caption{font-size:10.5px;font-weight:600;letter-spacing:.8px}',
            '</style>',
            '</svg>',
        ]
    )
    return "\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(".local-assets/david-hero-source.jpg"),
        help="head-and-shoulders source photo (default: %(default)s)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("."),
        help="directory for dark.svg and light.svg (default: %(default)s)",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = args.source if args.source.is_absolute() else root / args.source
    output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    logo_path = root / "logos" / "sgodx-eyes.png"
    if not source.exists():
        parser.error(f"Source photo not found: {source}")
    if not logo_path.exists():
        parser.error(f"SGODX eyes asset not found: {logo_path}")

    portrait = portrait_dots(source)
    if len(portrait) < MORPH_COUNT:
        parser.error(f"Portrait mask produced only {len(portrait)} dots; check the source crop")
    sgodx, sgodx_layers = sgodx_geometry(logo_path)
    icons = (sgodx, react_points(), node_points())
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, content in svg_logo_references().items():
        (root / "logos" / name).write_text(content, encoding="utf-8", newline="\n")
    for theme in ("dark", "light"):
        svg = build_svg(theme, portrait, icons, sgodx_layers, random.Random(SEED))
        (output_dir / f"{theme}.svg").write_text(svg, encoding="utf-8", newline="\n")

    print(f"Portrait grid: {PORTRAIT_SIZE[0]}x{PORTRAIT_SIZE[1]}, {len(portrait):,} dithered dots")
    print(f"Wrote {output_dir / 'dark.svg'} and {output_dir / 'light.svg'}")


if __name__ == "__main__":
    main()
