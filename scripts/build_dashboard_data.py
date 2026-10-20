"""Build the compact, browser-friendly dataset used by the FPL dashboard.

The repository contains the source CSVs, so the dashboard stays fully local and
does not need to call the FPL API on every page load. Player photos remain lazy
remote assets from the Premier League CDN, with an initials fallback in the UI.
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web" / "data.js"

SEASONS = [
    "2016-17", "2017-18", "2018-19", "2019-20",
    "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
]
POSITION_NAMES = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}

# The historical exports do not include a teams.csv file for every season.
# These are the FPL team ids used by the matching season export.
HISTORICAL_TEAMS = {
    "2016-17": {
        1: "Arsenal", 2: "Bournemouth", 3: "Burnley", 4: "Chelsea",
        5: "Crystal Palace", 6: "Everton", 7: "Hull City", 8: "Leicester",
        9: "Liverpool", 10: "Man City", 11: "Man Utd", 12: "Middlesbrough",
        13: "Southampton", 14: "Stoke", 15: "Sunderland", 16: "Swansea",
        17: "Spurs", 18: "Watford", 19: "West Brom", 20: "West Ham",
    },
    "2017-18": {
        1: "Bournemouth", 2: "Arsenal", 3: "Brighton", 4: "Burnley",
        5: "Chelsea", 6: "Crystal Palace", 7: "Everton", 8: "Huddersfield",
        9: "Leicester", 10: "Liverpool", 11: "Man City", 12: "Man Utd",
        13: "Newcastle", 14: "Southampton", 15: "Stoke", 16: "Swansea",
        17: "Spurs", 18: "Watford", 19: "West Brom", 20: "West Ham",
    },
    "2018-19": {
        1: "Arsenal", 2: "Bournemouth", 3: "Brighton", 4: "Burnley",
        5: "Cardiff", 6: "Chelsea", 7: "Crystal Palace", 8: "Everton",
        9: "Fulham", 10: "Huddersfield", 11: "Leicester", 12: "Liverpool",
        13: "Man City", 14: "Man Utd", 15: "Newcastle", 16: "Southampton",
        17: "Spurs", 18: "Watford", 19: "West Ham", 20: "Wolves",
    },
}


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


def team_names(season: str) -> dict[int, str]:
    if season in HISTORICAL_TEAMS:
        return HISTORICAL_TEAMS[season]
    path = ROOT / "data" / season / "teams.csv"
    if path.exists():
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return {int(row["id"]): repair_text(row["name"]) for row in csv.DictReader(handle)}
    return {}


def short_name(name: str) -> str:
    replacements = {
        "Manchester City": "Man City",
        "Manchester United": "Man Utd",
        "Tottenham Hotspur": "Spurs",
        "Wolverhampton Wanderers": "Wolves",
        "West Bromwich Albion": "West Brom",
    }
    return replacements.get(name, name)


def photo_url(row: dict[str, str]) -> str:
    photo = row.get("photo", "")
    if not photo:
        code = row.get("code", "")
        photo = code
    code = re.sub(r"\D", "", photo)
    return f"https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png" if code else ""


def build_season(season: str) -> dict:
    source = ROOT / "data" / season / "players_raw.csv"
    clubs = team_names(season)
    players = []

    with source.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            first = repair_text(row.get("first_name"))
            last = repair_text(row.get("second_name"))
            club_id = int(number(row, "team", 0))
            club = short_name(clubs.get(club_id, f"Club {club_id}"))
            position_id = int(number(row, "element_type", 0))
            player = {
                "id": int(number(row, "id", 0)),
                "name": (first + " " + last).strip() or repair_text(row.get("web_name")) or "Unknown player",
                "shortName": repair_text(row.get("web_name")) or last or first or "Unknown",
                "firstName": first,
                "lastName": last,
                "position": POSITION_NAMES.get(position_id, "—"),
                "club": club,
                "clubId": club_id,
                "teamCode": int(number(row, "team_code", 0)),
                "photo": photo_url(row),
                "points": number(row, "total_points"),
                "goals": number(row, "goals_scored"),
                "assists": number(row, "assists"),
                "minutes": number(row, "minutes"),
                "cleanSheets": number(row, "clean_sheets"),
                "bonus": number(row, "bonus"),
                "bps": number(row, "bps"),
                "ict": number(row, "ict_index"),
                "creativity": number(row, "creativity"),
                "influence": number(row, "influence"),
                "threat": number(row, "threat"),
                "ppg": number(row, "points_per_game"),
                "selected": number(row, "selected_by_percent"),
                "price": round(number(row, "now_cost") / 10, 1),
            }
            players.append(player)

    club_rollups = defaultdict(lambda: {"players": 0, "points": 0, "goals": 0, "assists": 0, "minutes": 0})
    for player in players:
        rollup = club_rollups[player["club"]]
        rollup["players"] += 1
        for key in ("points", "goals", "assists", "minutes"):
            rollup[key] += player[key]

    club_rows = []
    for club, values in club_rollups.items():
        squad = [player for player in players if player["club"] == club]
        leader = max(squad, key=lambda item: (item["points"], item["goals"])) if squad else None
        club_rows.append({
            "club": club,
            **values,
            "avgPoints": round(values["points"] / values["players"], 1) if values["players"] else 0,
            "leader": leader["shortName"] if leader else "—",
        })

    leaders = sorted(players, key=lambda item: (item["points"], item["goals"], item["assists"]), reverse=True)
    return {
        "season": season,
        "status": "current" if season == "2026-27" else "final",
        "players": players,
        "clubs": sorted(club_rows, key=lambda item: item["points"], reverse=True),
        "leaders": leaders[:6],
        "stats": {
            "players": len(players),
            "clubs": len(club_rows),
            "points": sum(player["points"] for player in players),
            "goals": sum(player["goals"] for player in players),
            "assists": sum(player["assists"] for player in players),
            "minutes": sum(player["minutes"] for player in players),
            "avgPoints": round(sum(player["points"] for player in players) / len(players), 1) if players else 0,
            "leader": leaders[0]["name"] if leaders else "—",
            "leaderClub": leaders[0]["club"] if leaders else "—",
        },
    }


def main() -> None:
    payload = {"seasons": [build_season(season) for season in SEASONS]}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUTPUT.write_text("window.FPL_DATA = " + serialized + ";\n", encoding="utf-8")
    total_players = sum(len(item["players"]) for item in payload["seasons"])
    print(f"Built {OUTPUT} with {total_players} player-season rows")


if __name__ == "__main__":
    main()
