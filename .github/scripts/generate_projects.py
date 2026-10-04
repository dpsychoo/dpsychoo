#!/usr/bin/env python3
"""Generate the theme-aware, two-column PROJECTS.LIST SVG panels."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import re
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any


WIDTH = 1180
CARD_X = (18, 598)
CARD_WIDTH = 564
CARD_TOP = 68
CARD_HEIGHT = 242
ROW_GAP = 16
BOTTOM_PAD = 20
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
LANGUAGE_COLORS = {
    "Astro": "#F97316",
    "C": "#6B8EAE",
    "C++": "#E05D99",
    "CSS": "#8B5CF6",
    "Go": "#38BDF8",
    "HTML": "#F97316",
    "Java": "#D97706",
    "JavaScript": "#EAB308",
    "Jupyter Notebook": "#F59E0B",
    "Kotlin": "#A78BFA",
    "PHP": "#818CF8",
    "Python": "#60A5FA",
    "Ruby": "#EF4444",
    "Rust": "#D97706",
    "Shell": "#10B981",
    "Svelte": "#F97316",
    "Swift": "#F97316",
    "TypeScript": "#3B82F6",
    "Vue": "#34D399",
}
FALLBACK_LANGUAGE_COLORS = ("#22D3EE", "#A78BFA", "#10B981", "#F59E0B", "#60A5FA")

THEMES = {
    "dark": {
        "background": "#0A101F",
        "panel": "#0C1426",
        "panel_alt": "#101B30",
        "border": "#26334B",
        "border_soft": "#1C2940",
        "cyan": "#22D3EE",
        "violet": "#A78BFA",
        "deep_violet": "#7C3AED",
        "active": "#10B981",
        "text": "#F8FAFC",
        "muted": "#94A3B8",
        "quiet": "#64748B",
        "track": "#1D2B43",
        "pill": "#111D32",
    },
    "light": {
        "background": "#F8FAFC",
        "panel": "#FFFFFF",
        "panel_alt": "#F1F5F9",
        "border": "#CBD5E1",
        "border_soft": "#E2E8F0",
        "cyan": "#0891B2",
        "violet": "#7C3AED",
        "deep_violet": "#6D28D9",
        "active": "#059669",
        "text": "#0F172A",
        "muted": "#475569",
        "quiet": "#64748B",
        "track": "#E2E8F0",
        "pill": "#F8FAFC",
    },
}


def xml(value: Any) -> str:
    return escape(str(value), quote=True)


def truncate(value: str, limit: int) -> str:
    value = " ".join(value.split())
    if len(value) <= limit:
        return value
    return value[: max(1, limit - 1)].rstrip() + "…"


def wrap_description(value: str, max_chars: int = 66) -> tuple[str, str]:
    words = " ".join(value.split()).split(" ") if value.strip() else []
    if not words:
        return "Description unavailable.", ""
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
            if len(lines) == 1:
                break
    if current and len(lines) < 2:
        lines.append(current)
    if len(lines) == 2:
        consumed = " ".join(lines).split()
        if len(consumed) < len(words):
            lines[1] = truncate(lines[1] + " " + " ".join(words[len(consumed) :]), max_chars)
    return (truncate(lines[0], max_chars), truncate(lines[1], max_chars) if len(lines) > 1 else "")


def relative_updated(pushed_at: Any) -> tuple[str, bool]:
    if not isinstance(pushed_at, str):
        return "updated n/a", False
    try:
        pushed = datetime.fromisoformat(pushed_at.replace("Z", "+00:00"))
        if pushed.tzinfo is None:
            pushed = pushed.replace(tzinfo=timezone.utc)
    except ValueError:
        return "updated n/a", False
    days = max(0, (datetime.now(timezone.utc) - pushed.astimezone(timezone.utc)).days)
    if days == 0:
        label = "updated today"
    elif days < 30:
        label = f"updated {days}d ago"
    elif days < 365:
        months = max(1, days // 30)
        label = f"updated {months}mo ago"
    else:
        years = days // 365
        label = f"updated {years}y ago"
    return label, days <= 45


def language_color(name: str) -> str:
    if name in LANGUAGE_COLORS:
        return LANGUAGE_COLORS[name]
    digest = hashlib.sha1(name.encode("utf-8")).digest()
    return FALLBACK_LANGUAGE_COLORS[digest[0] % len(FALLBACK_LANGUAGE_COLORS)]


def validate_project(project: Any, index: int) -> dict[str, Any]:
    if not isinstance(project, dict):
        raise ValueError(f"merged project {index} must be an object")
    for field in ("name", "repo", "logo", "description", "tags", "stars", "pushed_at", "languages"):
        if field not in project:
            raise ValueError(f"merged project {index} is missing {field!r}")
    if not isinstance(project["name"], str) or not project["name"].strip():
        raise ValueError(f"merged project {index} has an invalid name")
    if not isinstance(project["repo"], str) or not REPO_PATTERN.fullmatch(project["repo"]):
        raise ValueError(f"merged project {index} has an invalid repository identifier")
    if not isinstance(project["description"], str):
        raise ValueError(f"merged project {index} has an invalid description")
    if not isinstance(project["tags"], list):
        raise ValueError(f"merged project {index} tags must be an array")
    if not isinstance(project["languages"], dict):
        project["languages"] = {}
    project["stars"] = max(0, int(project.get("stars", 0) or 0))
    return project


def logo_markup(project: dict[str, Any], root: Path, x: int, y: int, theme: dict[str, str]) -> str:
    size = 62
    logo = project.get("logo")
    if isinstance(logo, str) and logo.strip():
        relative = Path(logo)
        resolved = (root / relative).resolve()
        allowed = (root / "project-logos").resolve()
        try:
            resolved.relative_to(allowed)
        except ValueError:
            print(f"Warning: {project['repo']} logo must be inside project-logos; using monogram", file=sys.stderr)
        else:
            mime, _ = mimetypes.guess_type(resolved.name)
            if mime in {"image/png", "image/jpeg", "image/webp"} and resolved.is_file():
                try:
                    image_bytes = resolved.read_bytes()
                except OSError as error:
                    print(f"Warning: could not read {resolved.name} for {project['repo']}; using monogram: {error}", file=sys.stderr)
                else:
                    if image_bytes:
                        data = base64.b64encode(image_bytes).decode("ascii")
                        padding = 7
                        image_size = size - 2 * padding
                        return (
                            f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="10" '
                            f'fill="{theme["panel_alt"]}" stroke="{theme["border_soft"]}"/>'
                            f'<image x="{x + padding}" y="{y + padding}" width="{image_size}" height="{image_size}" '
                            f'preserveAspectRatio="xMidYMid meet" href="data:{mime};base64,{data}"/>'
                        )
                    print(f"Warning: {resolved.name} is empty for {project['repo']}; using monogram", file=sys.stderr)
            else:
                print(f"Warning: {project['repo']} logo is unavailable or not a local PNG/JPEG/WebP; using monogram", file=sys.stderr)

    monogram = truncate(str(project.get("monogram") or ""), 4) or "PRJ"
    accent = theme["cyan"] if hashlib.sha1(project["repo"].encode("utf-8")).digest()[0] % 2 else theme["violet"]
    return (
        f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="10" '
        f'fill="{theme["panel_alt"]}" stroke="{theme["border_soft"]}"/>'
        f'<circle cx="{x + 12}" cy="{y + 12}" r="2" fill="{accent}" opacity=".8"/>'
        f'<circle cx="{x + size - 12}" cy="{y + 12}" r="2" fill="{theme["quiet"]}" opacity=".7"/>'
        f'<path d="M{x + 12} {y + size - 11}h9m4 0h4" stroke="{accent}" stroke-width="1.2" opacity=".75"/>'
        f'<text x="{x + size / 2:g}" y="{y + 38}" text-anchor="middle" '
        f'font-size="14" font-weight="700" fill="{theme["text"]}">{xml(monogram)}</text>'
    )


def tag_markup(tags: list[Any], x: int, y: int, theme: dict[str, str]) -> str:
    parts: list[str] = []
    cursor = x
    for tag in [item for item in tags if isinstance(item, str)][:3]:
        label = truncate(tag, 18)
        width = max(46, min(134, int(len(label) * 6.0 + 18)))
        parts.append(
            f'<rect x="{cursor}" y="{y}" width="{width}" height="20" rx="6" '
            f'fill="{theme["pill"]}" stroke="{theme["border_soft"]}"/>'
            f'<text x="{cursor + width / 2:g}" y="{y + 13.5:g}" text-anchor="middle" '
            f'font-size="9" fill="{theme["muted"]}">{xml(label)}</text>'
        )
        cursor += width + 8
    return "".join(parts)


def language_markup(languages: dict[str, Any], x: int, y: int, theme: dict[str, str]) -> str:
    valid = [(name, max(0, int(value))) for name, value in languages.items() if isinstance(name, str)]
    valid.sort(key=lambda pair: (-pair[1], pair[0].lower()))
    total = sum(value for _, value in valid)
    width = 222
    if total <= 0:
        return (
            f'<text x="{x}" y="{y}" class="label" fill="{theme["muted"]}">LANGUAGE MIX</text>'
            f'<rect x="{x}" y="{y + 8}" width="{width}" height="5" rx="2.5" fill="{theme["track"]}"/>'
            f'<text x="{x}" y="{y + 29}" class="tiny" fill="{theme["quiet"]}">Language data unavailable</text>'
        )

    visible = valid[:3]
    other = sum(value for _, value in valid[3:])
    segments = [(name, value) for name, value in visible]
    if other:
        segments.append(("Other", other))
    markup = [f'<text x="{x}" y="{y}" class="label" fill="{theme["muted"]}">LANGUAGE MIX</text>']
    markup.append(f'<rect x="{x}" y="{y + 8}" width="{width}" height="5" rx="2.5" fill="{theme["track"]}"/>')
    cursor = float(x)
    for name, amount in segments:
        segment_width = width * amount / total
        markup.append(
            f'<rect x="{cursor:.2f}" y="{y + 8}" width="{segment_width:.2f}" height="5" '
            f'fill="{language_color(name)}"><title>{xml(name)}: {amount / total * 100:.1f}%</title></rect>'
        )
        cursor += segment_width

    first = visible[:2]
    labels = [f"{truncate(name, 14)} {value / total * 100:.0f}%" for name, value in first]
    line_one = " · ".join(labels) if labels else "Language data unavailable"
    if len(visible) > 2 or other:
        other_value = sum(value for _, value in visible[2:]) + other
        line_two = f"+ Other {other_value / total * 100:.0f}%"
    else:
        line_two = ""
    markup.append(f'<text x="{x}" y="{y + 27}" class="tiny" fill="{theme["text"]}">{xml(line_one)}</text>')
    if line_two:
        markup.append(f'<text x="{x}" y="{y + 40}" class="tiny" fill="{theme["muted"]}">{xml(line_two)}</text>')
    return "".join(markup)


def card_markup(project: dict[str, Any], index: int, total_projects: int, row: int, col: int, theme: dict[str, str], root: Path) -> str:
    x = CARD_X[col]
    y = CARD_TOP + row * (CARD_HEIGHT + ROW_GAP)
    repo = project["repo"]
    title = truncate(project["name"].strip(), 42)
    description = project["description"].strip() or project.get("github_description", "")
    desc_one, desc_two = wrap_description(description)
    updated, recent = relative_updated(project.get("pushed_at"))
    activity = "ACTIVE" if recent else "QUIET"
    activity_color = theme["active"] if recent else theme["quiet"]
    stars = f"{project.get('stars', 0):,}"
    tags = project.get("tags", [])
    card_id = f"card-{index + 1}"
    repo_text = truncate(repo, 57)
    logo = logo_markup(project, root, x + 20, y + 49, theme)
    language = language_markup(project.get("languages", {}), x + 310, y + 165, theme)

    return f'''<g class="card" id="{card_id}">
      <rect x="{x}" y="{y}" width="{CARD_WIDTH}" height="{CARD_HEIGHT}" rx="11" fill="{theme['panel']}" stroke="{theme['border']}"/>
      <rect x="{x + 1}" y="{y + 1}" width="{CARD_WIDTH - 2}" height="35" rx="10" fill="{theme['panel_alt']}"/>
      <path d="M{x + 1} {y + 34}H{x + CARD_WIDTH - 1}" stroke="{theme['border_soft']}"/>
      <circle cx="{x + 18}" cy="{y + 18}" r="3" fill="{theme['active']}"/>
      <circle cx="{x + 29}" cy="{y + 18}" r="2.5" fill="{theme['quiet']}"/>
      <text x="{x + 40}" y="{y + 22}" class="repo" fill="{theme['muted']}">{xml(repo_text)}</text>
      <a href="https://github.com/{xml(repo)}" target="_blank" rel="noopener noreferrer">
        <text x="{x + CARD_WIDTH - 18}" y="{y + 22}" text-anchor="end" class="repo link" fill="{theme['cyan']}">OPEN ↗</text>
      </a>
      {logo}
      <text x="{x + 100}" y="{y + 68}" class="name" fill="{theme['text']}">{xml(title)}</text>
      <text x="{x + 100}" y="{y + 91}" class="description" fill="{theme['muted']}">{xml(desc_one)}</text>
      <text x="{x + 100}" y="{y + 105}" class="description" fill="{theme['muted']}">{xml(desc_two)}</text>
      {tag_markup(tags, x + 20, y + 125, theme)}
      <path d="M{x + 20} {y + 155}H{x + CARD_WIDTH - 20}" stroke="{theme['border_soft']}"/>
      <text x="{x + 22}" y="{y + 179}" class="metric" fill="{theme['text']}">★ {xml(stars)}</text>
      <text x="{x + 110}" y="{y + 179}" class="small" fill="{theme['muted']}">{xml(updated)}</text>
      <circle cx="{x + 28}" cy="{y + 202}" r="3" fill="{activity_color}"/>
      <text x="{x + 39}" y="{y + 205}" class="label" fill="{activity_color}">{activity}</text>
      <path d="M{x + 292} {y + 165}V{y + 224}" stroke="{theme['border_soft']}"/>
      {language}
      <text x="{x + CARD_WIDTH - 19}" y="{y + CARD_HEIGHT - 14}" text-anchor="end" class="index" fill="{theme['quiet']}">PROJECT {index + 1:02d} / {total_projects:02d}</text>
    </g>'''


def generate_svg(projects: list[dict[str, Any]], mode: str, root: Path) -> str:
    theme = THEMES[mode]
    rows = max(1, (len(projects) + 1) // 2)
    height = CARD_TOP + rows * CARD_HEIGHT + (rows - 1) * ROW_GAP + BOTTOM_PAD
    cards = []
    for index, project in enumerate(projects):
        cards.append(card_markup(project, index, len(projects), index // 2, index % 2, theme, root))

    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" role="img" aria-labelledby="title description">
  <title id="title">David Castro featured projects — {mode} theme</title>
  <desc id="description">A terminal-inspired list of featured projects with live GitHub activity and language distribution.</desc>
  <style>
    text {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }}
    .repo {{ font-size: 10px; letter-spacing: .12px; }}
    .name {{ font-size: 15px; font-weight: 700; }}
    .description {{ font-size: 9px; }}
    .metric {{ font-size: 11px; font-weight: 700; }}
    .small {{ font-size: 9px; }}
    .label {{ font-size: 8px; letter-spacing: .65px; font-weight: 700; }}
    .tiny {{ font-size: 8px; }}
    .index {{ font-size: 7px; letter-spacing: .55px; }}
    .link {{ font-size: 8px; }}
    .accent {{ transform-box: fill-box; transform-origin: left center; animation: accent-in 900ms ease-out; }}
    @keyframes accent-in {{ from {{ transform: scaleX(.72); }} to {{ transform: scaleX(1); }} }}
    a {{ text-decoration: none; }}
    a:hover text {{ text-decoration: underline; }}
    @media (prefers-reduced-motion: reduce) {{ .accent {{ animation: none; transform: none; }} }}
  </style>
  <rect width="{WIDTH}" height="{height}" rx="14" fill="{theme['background']}"/>
  <rect x="1" y="1" width="{WIDTH - 2}" height="{height - 2}" rx="13" fill="none" stroke="{theme['border_soft']}"/>
  <text x="24" y="31" fill="{theme['text']}" font-size="14" font-weight="700" letter-spacing=".7">PROJECTS.LIST</text>
  <text x="{WIDTH - 24}" y="30" text-anchor="end" fill="{theme['muted']}" font-size="10">./projects.sh --featured</text>
  <circle cx="24" cy="48" r="2" fill="{theme['violet']}"/>
  <rect class="accent" x="31" y="47" width="{WIDTH - 55}" height="1.5" rx=".75" fill="url(#accent-gradient)"/>
  <defs>
    <linearGradient id="accent-gradient" x1="0" x2="1">
      <stop offset="0" stop-color="{theme['violet']}"/>
      <stop offset=".62" stop-color="{theme['deep_violet']}"/>
      <stop offset="1" stop-color="{theme['cyan']}" stop-opacity=".45"/>
    </linearGradient>
  </defs>
  {''.join(cards)}
</svg>
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="merged project JSON")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="repository root for local project logos")
    args = parser.parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError("merged data must be an array")
        projects = [validate_project(item, index) for index, item in enumerate(data, start=1)]
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for mode, name in (("dark", "projects.svg"), ("light", "projects-light.svg")):
            (args.output_dir / name).write_text(generate_svg(projects, mode, args.root.resolve()), encoding="utf-8")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(f"Generated dark and light project panels for {len(projects)} project(s) in {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
