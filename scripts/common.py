"""Shared helpers for the dashboard build and fetch scripts."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
WEB_DATA_DIR = ROOT / "web" / "data"

# The season the FPL API is currently serving. Every other season is final.
CURRENT_SEASON = "2026-27"

# Players under this many minutes are left out of per-90 / per-£m rankings,
# otherwise a single cameo tops the table.
RATE_MIN_MINUTES = 450


# Both sources spell some clubs differently, even from one season to the next.
CLUB_ALIASES = {
    "A Villa": "Aston Villa", "Villa": "Aston Villa",
    "C Palace": "Crystal Palace", "Palace": "Crystal Palace",
    "Forest": "Nott'm Forest", "Nottingham Forest": "Nott'm Forest",
    "Coventry City": "Coventry", "Hull City": "Hull", "Ipswich Town": "Ipswich",
    "Manchester City": "Man City", "Manchester United": "Man Utd",
    "Tottenham Hotspur": "Spurs", "Tottenham": "Spurs",
    "Wolverhampton Wanderers": "Wolves", "West Bromwich Albion": "West Brom",
    "Sheffield United": "Sheffield Utd", "Newcastle United": "Newcastle",
}


def canonical_club(name: str) -> str:
    return CLUB_ALIASES.get(name, name)


def repair_text(value: str | None) -> str:
    """Repair the common UTF-8-as-Latin-1 mojibake in old exports."""

    if not value:
        return ""
    if any(token in value for token in ("Ã", "Â", "â")):
        try:
            return value.encode("latin1").decode("utf-8")
        except UnicodeError:
            pass
    return value


def number(row: dict[str, str], key: str, default: float = 0) -> float:
    try:
        value = float(row.get(key, default) or default)
        return int(value) if value.is_integer() else round(value, 2)
    except (TypeError, ValueError):
        return default


def per_90(value: float, minutes: float) -> float:
    return round(value / minutes * 90, 2) if minutes >= RATE_MIN_MINUTES else 0


def season_status(season: str) -> str:
    return "current" if season == CURRENT_SEASON else "final"


def write_json(path: Path, payload: object) -> int:
    """Write compact JSON and return its size in bytes."""

    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(serialized, encoding="utf-8")
    return len(serialized.encode("utf-8"))
