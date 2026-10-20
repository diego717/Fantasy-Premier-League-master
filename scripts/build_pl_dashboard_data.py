"""Build the Premier League (non-FPL) comparison dataset for the dashboard.

Source files live in data/pl and come from the public Premier-League-Stats
archive. This builder deliberately keeps the PL model separate from FPL points:
the dashboard switches labels and sort metrics depending on the active mode.
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "pl"
OUTPUT = ROOT / "web" / "pl_data.js"
POSITION_NAMES = {"goalkeeper": "GK", "defender": "DEF", "midfielder": "MID", "forward": "FWD"}


def repair_text(value: str | None) -> str:
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


def clean_position(value: str) -> str:
    position = repair_text(value).strip().lower()
    for token, label in POSITION_NAMES.items():
        if token in position:
            return label
    return "—"


def photo_url(player_id: int) -> str:
    return f"https://resources.premierleague.com/premierleague/photos/players/110x140/p{player_id}.png" if player_id else ""


def build_season(path: Path) -> dict:
    season = path.name.replace("_players_stats.csv", "")
    players = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            name = repair_text(row.get("playerName"))
            if not name:
                continue
            player_id = int(number(row, "playerId", 0))
            appearances = number(row, "appearances") or number(row, "gamesPlayed")
            minutes = number(row, "timePlayed")
            goals = number(row, "goals")
            assists = number(row, "goalAssists")
            players.append({
                "id": player_id,
                "name": name,
                "shortName": name.split()[-1] if name.split() else name,
                "position": clean_position(row.get("position", "")),
                "club": repair_text(row.get("team_name")) or "Unknown club",
                "clubId": int(number(row, "team_id", 0)),
                "photo": photo_url(player_id),
                "goals": goals,
                "assists": assists,
                "minutes": minutes,
                "appearances": appearances,
                "starts": number(row, "starts"),
                "cleanSheets": number(row, "cleanSheets"),
                "expectedGoals": number(row, "expectedGoals"),
                "expectedAssists": number(row, "expectedAssists"),
                "shots": number(row, "totalShots"),
                "shotsOnTarget": number(row, "shotsOnTargetIncGoals"),
                "passes": number(row, "totalPasses"),
                "tackles": number(row, "totalTackles"),
                "interceptions": number(row, "interceptions"),
                "yellowCards": number(row, "yellowCards"),
                "redCards": number(row, "totalRedCards"),
                "goalsPer90": round((goals / minutes) * 90, 2) if minutes else 0,
                "contributions": goals + assists,
            })

    clubs = defaultdict(lambda: {"players": 0, "goals": 0, "assists": 0, "minutes": 0, "appearances": 0, "expectedGoals": 0, "expectedAssists": 0})
    for player in players:
        rollup = clubs[player["club"]]
        rollup["players"] += 1
        for key in ("goals", "assists", "minutes", "appearances", "expectedGoals", "expectedAssists"):
            rollup[key] += player[key]

    club_rows = []
    for club, values in clubs.items():
        squad = [player for player in players if player["club"] == club]
        leader = max(squad, key=lambda item: (item["goals"], item["assists"], item["minutes"])) if squad else None
        club_rows.append({
            "club": club,
            **values,
            "leader": leader["shortName"] if leader else "—",
            "goalsPerPlayer": round(values["goals"] / values["players"], 2) if values["players"] else 0,
        })

    leaders = sorted(players, key=lambda item: (item["goals"], item["assists"], item["minutes"]), reverse=True)
    return {
        "season": season,
        "status": "current" if season == "2026-27" else "final",
        "players": players,
        "clubs": sorted(club_rows, key=lambda item: (item["goals"], item["assists"]), reverse=True),
        "leaders": leaders[:6],
        "stats": {
            "players": len(players),
            "clubs": len(club_rows),
            "goals": sum(player["goals"] for player in players),
            "assists": sum(player["assists"] for player in players),
            "minutes": sum(player["minutes"] for player in players),
            "appearances": sum(player["appearances"] for player in players),
            "expectedGoals": round(sum(player["expectedGoals"] for player in players), 1),
            "expectedAssists": round(sum(player["expectedAssists"] for player in players), 1),
            "avgGoals": round(sum(player["goals"] for player in players) / len(players), 2) if players else 0,
            "leader": leaders[0]["name"] if leaders else "—",
            "leaderClub": leaders[0]["club"] if leaders else "—",
        },
    }


def main() -> None:
    files = sorted(SOURCE_DIR.glob("*_players_stats.csv"))
    payload = {"seasons": [build_season(path) for path in files]}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("window.PL_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Built {OUTPUT} with {sum(len(item['players']) for item in payload['seasons'])} player-season rows")


if __name__ == "__main__":
    main()
