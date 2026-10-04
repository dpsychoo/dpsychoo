#!/usr/bin/env python3
"""Merge configured featured projects with live public GitHub metadata."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


API_ROOT = "https://api.github.com/repos"
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
USER_AGENT = "dpsychoo-projects-list/1.0"


def normalize_repo(value: Any) -> str:
    """Accept owner/repo or a GitHub repository URL and return owner/repo."""
    if not isinstance(value, str):
        raise ValueError("repo must be a string")

    repo = value.strip()
    if repo.startswith(("https://", "http://")):
        parsed = urlparse(repo)
        if parsed.scheme != "https" or parsed.netloc.lower() not in {"github.com", "www.github.com"}:
            raise ValueError("repository URLs must use https://github.com")
        repo = parsed.path.strip("/")
    repo = repo.removesuffix(".git").strip("/")
    if not REPO_PATTERN.fullmatch(repo):
        raise ValueError("repo must be owner/repository")
    return repo


def request_json(url: str, token: str | None) -> Any:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def warn(repo: str, endpoint: str, error: Exception) -> None:
    if isinstance(error, HTTPError):
        reason = f"HTTP {error.code} {error.reason}"
    elif isinstance(error, URLError):
        reason = str(error.reason)
    else:
        reason = str(error)
    print(f"Warning: {repo} {endpoint} request failed: {reason}", file=sys.stderr)


def read_projects(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("projects.json must contain an array")

    projects: list[dict[str, Any]] = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"project {index} must be an object")
        for field in ("name", "repo", "logo", "description", "tags"):
            if field not in item:
                raise ValueError(f"project {index} is missing {field!r}")
        if not isinstance(item["name"], str) or not item["name"].strip():
            raise ValueError(f"project {index} name must be a non-empty string")
        if not isinstance(item["description"], str):
            raise ValueError(f"project {index} description must be a string")
        if item["logo"] is not None and not isinstance(item["logo"], str):
            raise ValueError(f"project {index} logo must be a local path or null")
        if not isinstance(item["tags"], list) or not all(isinstance(tag, str) for tag in item["tags"]):
            raise ValueError(f"project {index} tags must be an array of strings")
        project = dict(item)
        project["repo"] = normalize_repo(item["repo"])
        projects.append(project)
    return projects


def fetch_project(project: dict[str, Any], token: str | None) -> dict[str, Any]:
    repo = project["repo"]
    merged = {
        **project,
        "stars": 0,
        "pushed_at": None,
        "languages": {},
        "github_description": "",
    }

    try:
        repository = request_json(f"{API_ROOT}/{repo}", token)
        if not isinstance(repository, dict):
            raise ValueError("repository endpoint returned an unexpected response")
        merged["stars"] = max(0, int(repository.get("stargazers_count", 0) or 0))
        pushed_at = repository.get("pushed_at")
        merged["pushed_at"] = pushed_at if isinstance(pushed_at, str) else None
        remote_description = repository.get("description")
        merged["github_description"] = remote_description if isinstance(remote_description, str) else ""
    except Exception as error:
        warn(repo, "repository metadata", error)

    try:
        languages = request_json(f"{API_ROOT}/{repo}/languages", token)
        if not isinstance(languages, dict):
            raise ValueError("languages endpoint returned an unexpected response")
        merged["languages"] = {
            str(name): max(0, int(byte_count))
            for name, byte_count in languages.items()
            if isinstance(name, str) and isinstance(byte_count, int)
        }
    except Exception as error:
        warn(repo, "language metadata", error)

    if not merged["description"].strip():
        merged["description"] = merged["github_description"]
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("projects.json"))
    parser.add_argument("--output", type=Path, required=True, help="merged JSON destination")
    args = parser.parse_args()

    try:
        projects = read_projects(args.config)
        result = [fetch_project(project, os.environ.get("GITHUB_TOKEN")) for project in projects]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(f"Wrote live metadata for {len(result)} configured project(s) to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
