"""Particle targets and restrained labels for the VISUAL.MAP modules.

The coordinates share the portrait's 300 by 340 local canvas.  Each module
supplies exactly 208 points to the existing traveller layer; this module does
not create an independent animation or alter the dense portrait geometry.
OpenAI is traced from its local logo; Claude follows the approved pixel-mascot
reference geometry.
"""

from __future__ import annotations

import math
import random
from bisect import bisect_left

from hero_brand_marks import ai_overlay, ai_points


Point = tuple[float, float]
PARTICLE_COUNT = 208


def _polyline(vertices: list[Point], count: int) -> list[Point]:
    """Sample a line evenly while retaining every geometric corner."""
    lengths = [math.dist(a, b) for a, b in zip(vertices, vertices[1:])]
    available = count - 1
    if available < len(lengths) or any(length <= 0 for length in lengths):
        raise ValueError("A polyline needs distinct vertices and enough points")
    quotas = [available * length / sum(lengths) for length in lengths]
    steps = [max(1, math.floor(quota)) for quota in quotas]
    while sum(steps) < available:
        index = max(range(len(steps)), key=lambda i: quotas[i] - steps[i])
        steps[index] += 1
    while sum(steps) > available:
        index = max(
            (i for i, step in enumerate(steps) if step > 1),
            key=lambda i: steps[i] - quotas[i],
        )
        steps[index] -= 1
    points: list[Point] = []
    for a, b, step_count in zip(vertices, vertices[1:], steps):
        for index in range(step_count):
            t = index / step_count
            points.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    points.append(vertices[-1])
    return points


def _ellipse_arc(
    center: Point,
    radii: Point,
    start: float,
    end: float,
    count: int,
    *,
    closed: bool = False,
) -> list[Point]:
    """Use arc length, rather than angle, to keep ellipse dots evenly spaced."""
    dense = [
        (
            center[0] + radii[0] * math.cos(start + (end - start) * i / 512),
            center[1] + radii[1] * math.sin(start + (end - start) * i / 512),
        )
        for i in range(513)
    ]
    distances = [0.0]
    for a, b in zip(dense, dense[1:]):
        distances.append(distances[-1] + math.dist(a, b))
    points = []
    for index in range(count):
        distance = distances[-1] * index / (count if closed else count - 1)
        upper = max(1, min(bisect_left(distances, distance), len(dense) - 1))
        lower = upper - 1
        t = (distance - distances[lower]) / (distances[upper] - distances[lower])
        a, b = dense[lower], dense[upper]
        points.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return points


def _web_paths() -> tuple[tuple[Point, ...], ...]:
    """Return the enlarged, balanced strokes of the combined WEB.CORE glyph."""
    def place(x: float, y: float) -> Point:
        return (150.0 + (x - 150.0) * 1.35, 161.5 + (y - 168.0) * 1.55)

    left = tuple(place(x, y) for x, y in ((94.0, 108.0), (47.0, 168.0), (94.0, 228.0)))
    right = tuple((300.0 - x, y) for x, y in left)
    slash = tuple(place(x, y) for x, y in ((176.0, 101.0), (124.0, 235.0)))
    return left, right, slash


def _web_points() -> list[Point]:
    # The 208 shared travellers now describe the enlarged, crisp centerlines.
    left, right, slash = _web_paths()
    left_points = _polyline(list(left), 68)
    right_points = [(300.0 - x, y) for x, y in left_points]
    slash_points = _polyline(list(slash), 72)
    return left_points + right_points + slash_points


def _web_particle_field(colors: dict[str, str]) -> str:
    """Fill each WEB.CORE stroke with a restrained, jittered particle band."""
    rng = random.Random(34017)
    circles = []
    spacing = 2.9
    across_count = 4
    across_pitch = 3.2
    for path in _web_paths():
        for start, end in zip(path, path[1:]):
            dx, dy = end[0] - start[0], end[1] - start[1]
            length = math.hypot(dx, dy)
            steps = max(1, math.ceil(length / spacing))
            nx, ny = -dy / length, dx / length
            along_pitch = length / steps
            for index in range(steps):
                for row in range(across_count):
                    along_distance = (index + rng.uniform(0.08, 0.92)) * along_pitch
                    side = (row - (across_count - 1) / 2) * across_pitch
                    side += rng.uniform(-1.05, 1.05)
                    t = along_distance / length
                    x = start[0] + dx * t + nx * side
                    y = start[1] + dy * t + ny * side
                    radius = rng.uniform(0.62, 1.04)
                    circles.append(
                        f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius:.2f}"/>'
                    )
    return f'<g fill="{colors["cyan"]}" data-web-particle-field="dense-ribbon">' + "".join(circles) + "</g>"


def _data_points() -> list[Point]:
    # One cylinder: complete upper rim, two walls and two front-facing arcs.
    # The clear center between the arcs leaves room for the primary SQL signal.
    top = _ellipse_arc((150.0, 103.0), (96.0, 26.0), 0, math.tau, 82, closed=True)
    left = _polyline([(54.0, 109.0), (54.0, 212.0)], 23)
    right = [(300.0 - x, y) for x, y in left]
    divider = _ellipse_arc((150.0, 141.0), (96.0, 26.0), 0, math.pi, 40)
    bottom = _ellipse_arc((150.0, 216.0), (96.0, 26.0), 0, math.pi, 40)
    return top + left + right + divider + bottom


def _ai_points() -> list[Point]:
    return ai_points()


def module_points(name: str) -> list[Point]:
    """Return one deterministic 208-point traveller target: web, data or ai."""
    factories = {"web": _web_points, "data": _data_points, "ai": _ai_points}
    try:
        points = factories[name]()
    except KeyError as error:
        raise ValueError(f"Unknown VISUAL.MAP module: {name}") from error
    if len(points) != PARTICLE_COUNT:
        raise ValueError(f"{name} must provide exactly {PARTICLE_COUNT} particles")
    return points


def module_overlay(name: str, colors: dict[str, str]) -> str:
    """Return module detail; the caller owns its shared-loop opacity."""
    if name == "web":
        labels = [(87, "HTML"), (150, "CSS"), (213, "JS")]
        # The traveller row sits within the same dense, jittered particle bands.
        return _web_particle_field(colors) + "".join(
            f'<text x="{x}" y="301" text-anchor="middle" font-size="14" '
            f'letter-spacing="1.1" fill="{colors["muted"]}">{label}</text>'
            for x, label in labels
        )
    if name == "data":
        return (
            f'<text x="151" y="199" text-anchor="middle" font-size="30" '
            f'font-weight="600" letter-spacing="3" fill="{colors["text"]}">SQL</text>'
            f'<text x="150" y="278" text-anchor="middle" font-size="12.5" '
            f'fill="{colors["muted"]}">PostgreSQL &#183; Supabase</text>'
        )
    if name == "ai":
        return ai_overlay(colors)
    raise ValueError(f"Unknown VISUAL.MAP module: {name}")
