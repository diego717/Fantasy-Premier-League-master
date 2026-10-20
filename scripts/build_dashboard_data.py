"""Build the browser-friendly FPL dataset used by the dashboard.

The repository contains the source CSVs, so the dashboard stays fully local and
does not need to call the FPL API on every page load. Output goes to
web/data/fpl/ and is split so the page only downloads what it shows:

    index.json          season summaries, club tables and leaders (always loaded)
    <season>.json       every player of one season (loaded on season switch)
    careers.json        each player's season-by-season line (loaded on demand)
    gws/<season>.json   gameweek-by-gameweek points per player (loaded on demand)

Player photos remain lazy remote assets from the Premier League CDN, built in
the browser from the player's stable `code`.
"""

from __future__ import annotations

import csv
from collections import defaultdict

from common import (
    DATA_DIR, RATE_MIN_MINUTES, WEB_DATA_DIR,
    canonical_club, number, per_90, repair_text, season_status, write_json,
)


OUTPUT_DIR = WEB_DATA_DIR / "fpl"

SEASONS = [
    "2016-17", "2017-18", "2018-19", "2019-20",
    "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
]
POSITION_NAMES = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
CAREER_FIELDS = ["season", "id", "club", "position", "points", "goals", "assists", "minutes", "price"]
GAMEWEEK_FIELDS = ["gw", "points", "minutes", "goals", "assists"]

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


def team_names(season: str) -> dict[int, str]:
    if season in HISTORICAL_TEAMS:
        return HISTORICAL_TEAMS[season]
    path = DATA_DIR / season / "teams.csv"
    if path.exists():
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return {int(row["id"]): repair_text(row["name"]) for row in csv.DictReader(handle)}
    return {}


def player_code(row: dict[str, str]) -> int:
    """The `code` is stable across seasons; old exports only carry it in `photo`."""

    code = int(number(row, "code", 0))
    if not code:
        digits = "".join(char for char in row.get("photo", "") if char.isdigit())
        code = int(digits) if digits else 0
    return code


def read_players(season: str) -> list[dict]:
    clubs = team_names(season)
    players = []
    with (DATA_DIR / season / "players_raw.csv").open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            first = repair_text(row.get("first_name"))
            last = repair_text(row.get("second_name"))
            club_id = int(number(row, "team", 0))
            points = number(row, "total_points")
            minutes = number(row, "minutes")
            price = round(number(row, "now_cost") / 10, 1)
            players.append({
                "id": int(number(row, "id", 0)),
                "code": player_code(row),
                "name": (first + " " + last).strip() or repair_text(row.get("web_name")) or "Unknown player",
                "shortName": repair_text(row.get("web_name")) or last or first or "Unknown",
                "position": POSITION_NAMES.get(int(number(row, "element_type", 0)), "—"),
                "club": canonical_club(clubs.get(club_id, f"Club {club_id}")),
                "points": points,
                "goals": number(row, "goals_scored"),
                "assists": number(row, "assists"),
                "minutes": minutes,
                "cleanSheets": number(row, "clean_sheets"),
                "bonus": number(row, "bonus"),
                "bps": number(row, "bps"),
                "ict": number(row, "ict_index"),
                "creativity": number(row, "creativity"),
                "influence": number(row, "influence"),
                "threat": number(row, "threat"),
                "ppg": number(row, "points_per_game"),
                "selected": number(row, "selected_by_percent"),
                "price": price,
                "pointsPer90": per_90(points, minutes),
                "pointsPerMillion": round(points / price, 1) if price and minutes >= RATE_MIN_MINUTES else 0,
            })
    return players


def summarize(season: str, players: list[dict]) -> dict:
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
        "status": season_status(season),
        "hasGameweeks": False,
        "clubs": sorted(club_rows, key=lambda item: item["points"], reverse=True),
        "leaders": leaders[:6],
        "topGoals": max(players, key=lambda item: item["goals"], default=None),
        "topAssists": max(players, key=lambda item: item["assists"], default=None),
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


def read_gameweeks(season: str) -> dict[int, list[list[float]]] | None:
    """Points per player and gameweek, summing double gameweeks."""

    folder = DATA_DIR / season / "gws"
    merged = folder / "merged_gw.csv"
    files = [merged] if merged.exists() else sorted(folder.glob("gw*.csv"))
    if not files:
        return None

    # Some upstream exports repeat a player's row for the same fixture; keep the last one.
    appearances: dict[tuple, dict[str, str]] = {}
    for path in files:
        with path.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
            for position, row in enumerate(csv.DictReader(handle)):
                player_id = int(number(row, "element", 0))
                gameweek = int(number(row, "GW", 0) or number(row, "round", 0))
                if player_id and gameweek:
                    fixture = row.get("fixture") or f"{path.name}:{position}"
                    appearances[(player_id, gameweek, fixture)] = row

    totals: dict[int, dict[int, list[float]]] = defaultdict(dict)
    for (player_id, gameweek, _), row in appearances.items():
        line = totals[player_id].setdefault(gameweek, [gameweek, 0, 0, 0, 0])
        line[1] += number(row, "total_points")
        line[2] += number(row, "minutes")
        line[3] += number(row, "goals_scored")
        line[4] += number(row, "assists")
    return {player_id: [weeks[gw] for gw in sorted(weeks)] for player_id, weeks in totals.items()}


def main() -> None:
    index = []
    careers: dict[int, list[list]] = defaultdict(list)
    total_players = 0
    archive_leader = None

    for season in SEASONS:
        players = read_players(season)
        total_players += len(players)
        summary = summarize(season, players)
        write_json(OUTPUT_DIR / f"{season}.json", {"season": season, "players": players})

        gameweeks = read_gameweeks(season)
        if gameweeks:
            summary["hasGameweeks"] = True
            write_json(OUTPUT_DIR / "gws" / f"{season}.json", {"fields": GAMEWEEK_FIELDS, "players": gameweeks})
        index.append(summary)

        for player in players:
            if player["code"]:
                careers[player["code"]].append([season] + [player[key] for key in CAREER_FIELDS[1:]])
            if archive_leader is None or player["points"] > archive_leader["points"]:
                archive_leader = {**player, "season": season}

    write_json(OUTPUT_DIR / "index.json", {"mode": "fpl", "seasons": index, "archiveLeader": archive_leader})
    careers_size = write_json(OUTPUT_DIR / "careers.json", {"fields": CAREER_FIELDS, "players": careers})
    print(f"Built {OUTPUT_DIR} with {total_players} player-season rows (careers {careers_size // 1024} KB)")


if __name__ == "__main__":
    main()
