"""Build the approved dotted OpenAI and Claude marks for VISUAL.MAP.

OpenAI is traced from its local PNG alpha channel. Claude uses the approved
pixel mascot geometry: a double dotted perimeter, empty body and particle eyes.
No external assets or raster backgrounds are emitted into the SVG.
"""

from __future__ import annotations

import math
import random
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageFilter


Point = tuple[float, float]
LOGO_DIR = Path(__file__).resolve().parent.parent / "logos"


def _source_mask(name: str) -> Image.Image:
    image = Image.open(LOGO_DIR / f"{name}-mark.png").convert("RGBA")
    if name == "openai":
        mask = image.getchannel("A").point(lambda alpha: 255 if alpha >= 128 else 0)
    elif name == "claude-code":
        mask = Image.new("L", image.size)
        # Retain the supplied warm silhouette; the black eyes and pale canvas
        # become holes rather than being painted as another foreground color.
        mask.putdata(
            [
                255 if alpha >= 128 and red > 100 and red - green > 25 and green - blue > 8 else 0
                for red, green, blue, alpha in image.getdata()
            ]
        )
    else:
        raise ValueError(f"Unknown local AI mark: {name}")
    bounds = mask.getbbox()
    if bounds is None:
        raise ValueError(f"No usable silhouette in {name}-mark.png")
    return mask.crop(bounds)


def _boundary_loops(mask: Image.Image) -> list[list[Point]]:
    """Trace foreground pixel edges, including every negative-space contour."""
    pixels = mask.load()
    width, height = mask.size
    edges: dict[Point, list[Point]] = defaultdict(list)

    def is_set(x: int, y: int) -> bool:
        return 0 <= x < width and 0 <= y < height and pixels[x, y] != 0

    for y in range(height):
        for x in range(width):
            if not pixels[x, y]:
                continue
            if not is_set(x, y - 1):
                edges[(x, y)].append((x + 1, y))
            if not is_set(x + 1, y):
                edges[(x + 1, y)].append((x + 1, y + 1))
            if not is_set(x, y + 1):
                edges[(x + 1, y + 1)].append((x, y + 1))
            if not is_set(x - 1, y):
                edges[(x, y + 1)].append((x, y))

    loops = []
    while edges:
        start = next(iter(edges))
        point = start
        previous = None
        loop = []
        while True:
            loop.append(point)
            options = edges[point]
            if len(options) > 1 and previous is not None:
                # At a diagonal pixel contact, turn right to keep the current
                # foreground component on the same side of the traced edge.
                dx, dy = point[0] - previous[0], point[1] - previous[1]
                index = max(
                    range(len(options)),
                    key=lambda i: dx * (options[i][1] - point[1]) - dy * (options[i][0] - point[0]),
                )
            else:
                index = 0
            next_point = options.pop(index)
            if not options:
                del edges[point]
            previous, point = point, next_point
            if point == start:
                break
        # Removing collinear raster steps makes the later curve approximation
        # compact while preserving the Claude silhouette's deliberate corners.
        corners = []
        for i, current in enumerate(loop):
            previous, following = loop[i - 1], loop[(i + 1) % len(loop)]
            if (current[0] - previous[0]) * (following[1] - current[1]) != (
                current[1] - previous[1]
            ) * (following[0] - current[0]):
                corners.append(current)
        if len(corners) >= 3:
            loops.append(corners)
    return loops


def _simplify_open(points: list[Point], tolerance: float) -> list[Point]:
    if len(points) <= 2:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    squared_length = dx * dx + dy * dy
    farthest, largest = 0, -1.0
    for index, point in enumerate(points[1:-1], 1):
        t = max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared_length))
        distance = (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2
        if distance > largest:
            farthest, largest = index, distance
    if largest <= tolerance * tolerance:
        return [a, b]
    return _simplify_open(points[: farthest + 1], tolerance)[:-1] + _simplify_open(
        points[farthest:], tolerance
    )


def _simplify_closed(points: list[Point], tolerance: float) -> list[Point]:
    # Split the closed contour into two genuine open paths before simplifying,
    # avoiding the coincident start/end ambiguity of a direct closed RDP pass.
    split = max(range(1, len(points)), key=lambda i: math.dist(points[0], points[i]))
    return _simplify_open(points[: split + 1], tolerance)[:-1] + _simplify_open(
        points[split:] + points[:1], tolerance
    )[:-1]


def _fmt(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _boundary_dots(
    points: list[Point], spacing: float = 4.2, *, count: int | None = None
) -> list[Point]:
    """Sample each silhouette and cutout contour at a steady airy pitch."""
    lengths = [math.dist(a, b) for a, b in zip(points, points[1:] + points[:1])]
    perimeter = sum(lengths)
    count = count or max(len(points), round(perimeter / spacing))
    samples: list[Point] = []
    segment = 0
    distances = [0.0]
    for length in lengths:
        distances.append(distances[-1] + length)
    for index in range(count):
        target = perimeter * index / count
        while segment + 1 < len(distances) - 1 and distances[segment + 1] < target:
            segment += 1
        along = (target - distances[segment]) / lengths[segment]
        a, b = points[segment], points[(segment + 1) % len(points)]
        samples.append((a[0] + (b[0] - a[0]) * along, a[1] + (b[1] - a[1]) * along))
    return samples


def _inset_mask(mask: Image.Image, scale: float) -> Image.Image:
    """Keep moving Claude dots safely inside the logo's narrow silhouette."""
    radius = math.ceil(2.0 / scale)
    padded = Image.new("L", (mask.width + 2 * radius, mask.height + 2 * radius))
    padded.paste(mask, (radius, radius))
    return padded.filter(ImageFilter.MinFilter(radius * 2 + 1)).crop(
        (radius, radius, radius + mask.width, radius + mask.height)
    )


def _interior_points(mask: Image.Image, left: float, top: float, scale: float) -> list[Point]:
    # Keep a two-display-pixel inset so the 1.22px traveller dots, including
    # the generator's half-pixel position offset, do not fill the logo holes.
    radius = math.ceil(2.0 / scale)
    padded = Image.new("L", (mask.width + 2 * radius, mask.height + 2 * radius))
    padded.paste(mask, (radius, radius))
    interior = padded.filter(ImageFilter.MinFilter(radius * 2 + 1)).crop(
        (radius, radius, radius + mask.width, radius + mask.height)
    )
    pixels = interior.load()
    candidates = []
    for iy in range(math.ceil(mask.height * scale / 1.5)):
        for ix in range(math.ceil(mask.width * scale / 1.5)):
            x, y = (ix + 0.5) * 1.5, (iy + 0.5) * 1.5
            if x >= mask.width * scale or y >= mask.height * scale:
                continue
            sx, sy = min(mask.width - 1, int(x / scale)), min(mask.height - 1, int(y / scale))
            if pixels[sx, sy]:
                candidates.append((left + x, top + y))
    if len(candidates) < 104:
        raise ValueError("A supplied AI mark has too little interior for 104 particles")
    center = (left + mask.width * scale / 2, top + mask.height * scale / 2)
    first = min(range(len(candidates)), key=lambda i: math.dist(candidates[i], center))
    selected = [candidates[first]]
    closest = [math.dist(candidate, selected[0]) ** 2 for candidate in candidates]
    while len(selected) < 104:
        index = max(range(len(candidates)), key=lambda i: closest[i])
        point = candidates[index]
        selected.append(point)
        for index, candidate in enumerate(candidates):
            distance = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2
            closest[index] = min(closest[index], distance)
    return selected


_CLAUDE_OUTER: tuple[Point, ...] = (
    (174, 100), (246, 100), (250, 104), (250, 118), (258, 118), (262, 122),
    (262, 142), (258, 146), (250, 146), (250, 160), (246, 164), (246, 186),
    (234, 186), (234, 164), (230, 164), (230, 186), (218, 186), (218, 164),
    (202, 164), (202, 186), (190, 186), (190, 164), (186, 164), (186, 186),
    (174, 186), (174, 164), (170, 160), (170, 146), (162, 146), (158, 142),
    (158, 122), (162, 118), (170, 118), (170, 104),
)


def _inset_polygon(points: tuple[Point, ...], scale: float) -> list[Point]:
    center = (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )
    return [
        (center[0] + (x - center[0]) * scale, center[1] + (y - center[1]) * scale)
        for x, y in points
    ]


def _claude_transform(point: Point) -> Point:
    """Set the mascot beside OpenAI at balanced, reference-matched proportions."""
    return (232.0 + (point[0] - 210.0) * 1.1, 160.0 + (point[1] - 149.0) * 0.9)


def _eye_dots() -> list[Point]:
    """Fill only the two inward-facing Claude chevrons with small particles."""
    rng = random.Random(517)
    eyes = (
        ((180.0, 124.0), (192.0, 132.5), (180.0, 141.0)),
        ((240.0, 124.0), (228.0, 132.5), (240.0, 141.0)),
    )
    dots = []
    for eye in eyes:
        for start, end in zip(eye, eye[1:]):
            dx, dy = end[0] - start[0], end[1] - start[1]
            length = math.hypot(dx, dy)
            steps = max(1, math.ceil(length / 2.5))
            nx, ny = -dy / length, dx / length
            for index in range(steps + 1):
                t = index / steps
                for offset in (-1.7, 0.0, 1.7):
                    along = max(0.0, min(1.0, t + rng.uniform(-0.16, 0.16) / steps))
                    across = offset + rng.uniform(-0.18, 0.18)
                    dots.append(
                        (
                            start[0] + dx * along + nx * across,
                            start[1] + dy * along + ny * across,
                        )
                    )
    return dots


@lru_cache(maxsize=1)
def _geometry() -> tuple[tuple[str, ...], tuple[Point, ...], tuple[Point, ...]]:
    paths: list[str] = []
    points: list[Point] = []
    edge_dots: list[Point] = []

    # Preserve OpenAI's approved local trace, contour and 104 interior targets.
    mask = _source_mask("openai")
    display_width = 125.0
    scale = display_width / mask.width
    left, top = 68.0 - display_width / 2, 160.0 - mask.height * scale / 2
    fragments = []
    for contour in _boundary_loops(mask):
        simplified = _simplify_closed(contour, 0.16 / scale)
        coordinates = [(left + x * scale, top + y * scale) for x, y in simplified]
        fragments.append("M" + "L".join(f"{_fmt(x)} {_fmt(y)}" for x, y in coordinates) + "Z")
        edge_dots.extend(_boundary_dots(coordinates))
    paths.append("".join(fragments))
    points.extend(_interior_points(mask, left, top, scale))

    # The final reference uses a square Claude mascot with side tabs and four
    # separated legs. Static perimeter dots plus inset travellers make a
    # robust double edge while leaving the body empty except for its eyes.
    claude = [_claude_transform(point) for point in _CLAUDE_OUTER]
    paths.append("M" + "L".join(f"{_fmt(x)} {_fmt(y)}" for x, y in claude) + "Z")
    edge_dots.extend(_boundary_dots(claude, spacing=3.0))
    edge_dots.extend(_claude_transform(point) for point in _eye_dots())
    points.extend(_boundary_dots(_inset_polygon(tuple(claude), 0.935), count=104))
    return tuple(paths), tuple(points), tuple(edge_dots)


def ai_points() -> list[Point]:
    """Return 104 OpenAI interior particles plus 104 inset Claude perimeter dots."""
    return list(_geometry()[1])


def ai_overlay(colors: dict[str, str]) -> str:
    """Render the OpenAI contour, Claude outline and Claude eye particles."""
    _, _, edge_dots = _geometry()
    return (
        f'<g fill="{colors["cyan"]}" data-brand-particles="openai-claude-code">'
        + "".join(
            f'<circle cx="{_fmt(x)}" cy="{_fmt(y)}" r="1.03"/>' for x, y in edge_dots
        )
        + "</g>"
        + f'<text x="150" y="261" text-anchor="middle" font-size="14" '
        f'fill="{colors["muted"]}">OpenAI <tspan fill="{colors["cyan"]}">&#215;</tspan> Claude Code</text>'
    )
