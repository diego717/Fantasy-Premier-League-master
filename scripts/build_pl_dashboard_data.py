"""Build the Premier League (non-FPL) comparison dataset for the dashboard.

Source files live in data/pl and come from the public Premier-League-Stats
archive. This builder deliberately keeps the PL model separate from FPL points:
the dashboard switches labels and sort metrics depending on the active mode.
Output goes to web/data/pl/ with the same split as the FPL builder (index,
one file per season and careers), minus gameweeks, which this source lacks.
"""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

import build_dashboard_data as fpl
from common import DATA_DIR, WEB_DATA_DIR, canonical_club, number, per_90, repair_text, season_status, write_json


SOURCE_DIR = DATA_DIR / "pl"
OUTPUT_DIR = WEB_DATA_DIR / "pl"
POSITION_NAMES = {"goalkeeper": "GK", "defender": "DEF", "midfielder": "MID", "forward": "FWD"}
CAREER_FIELDS = ["season", "id", "club", "position", "goals", "assists", "minutes", "appearances", "expectedGoals"]


NAME_PARTICLES = {"de", "van", "von", "da", "di", "del", "der", "den", "dos", "la", "le", "ter", "ten"}


def short_name(name: str) -> str:
    """Last name with its particles: "Kevin De Bruyne" -> "De Bruyne"."""

    parts = name.split()
    start = len(parts) - 1
    while start > 1 and parts[start - 1].lower() in NAME_PARTICLES:
        start -= 1
    return " ".join(parts[start:]) or name


def clean_position(value: str) -> str:
    position = repair_text(value).strip().lower()
    for token, label in POSITION_NAMES.items():
        if token in position:
            return label
    return "—"


def read_players(path: Path) -> list[dict]:
    players = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            name = repair_text(row.get("playerName"))
            if not name:
                continue
            appearances = number(row, "appearances") or number(row, "gamesPlayed")
            minutes = number(row, "timePlayed")
            goals = number(row, "goals")
            assists = number(row, "goalAssists")
            players.append({
                "id": int(number(row, "playerId", 0)),
                "name": name,
                "shortName": short_name(name),
                "position": clean_position(row.get("position", "")),
                "club": canonical_club(repair_text(row.get("team_name"))) or "Unknown club",
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
                "goalsPer90": per_90(goals, minutes),
                "contributionsPer90": per_90(goals + assists, minutes),
                "contributions": goals + assists,
            })
    return players


def merge_registrations(season: str, players: list[dict]) -> list[dict]:
    """Keep one row per player and season.

    The source repeats a player's full season totals under every club he was
    registered with (loans and mid-season transfers), which would count his
    goals twice. PL ids are the same `code` FPL uses, so when the season has
    FPL data the club he finished the season at decides; otherwise the first
    listed club stays and the rest go to `otherClubs` for the club filter.
    """

    fpl_clubs = {}
    if (DATA_DIR / season / "players_raw.csv").exists():
        fpl_clubs = {player["code"]: player["club"] for player in fpl.read_players(season)}

    rows_by_id: dict[int, list[dict]] = defaultdict(list)
    for player in players:
        rows_by_id[player["id"]].append(player)

    merged = []
    for rows in rows_by_id.values():
        clubs = list(dict.fromkeys(row["club"] for row in rows))
        main_club = fpl_clubs.get(rows[0]["id"])
        if main_club not in clubs:
            main_club = clubs[0]
        player = next(row for row in rows if row["club"] == main_club)
        others = [club for club in clubs if club != main_club]
        merged.append({**player, "otherClubs": others} if others else player)
    return merged


def summarize(season: str, players: list[dict]) -> dict:
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
            "expectedGoals": round(values["expectedGoals"], 1),
            "expectedAssists": round(values["expectedAssists"], 1),
            "leader": leader["shortName"] if leader else "—",
            "goalsPerPlayer": round(values["goals"] / values["players"], 2) if values["players"] else 0,
        })

    leaders = sorted(players, key=lambda item: (item["goals"], item["assists"], item["minutes"]), reverse=True)
    return {
        "season": season,
        "status": season_status(season),
        "hasGameweeks": False,
        "clubs": sorted(club_rows, key=lambda item: (item["goals"], item["assists"]), reverse=True),
        "leaders": leaders[:6],
        "topGoals": max(players, key=lambda item: item["goals"], default=None),
        "topAssists": max(players, key=lambda item: item["assists"], default=None),
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
    index = []
    careers: dict[int, list[list]] = defaultdict(list)
    total_players = 0
    archive_leader = None

    for path in sorted(SOURCE_DIR.glob("*_players_stats.csv")):
        season = path.name.replace("_players_stats.csv", "")
        players = merge_registrations(season, read_players(path))
        total_players += len(players)
        index.append(summarize(season, players))
        write_json(OUTPUT_DIR / f"{season}.json", {"season": season, "players": players})
        for player in players:
            if player["id"]:
                careers[player["id"]].append([season] + [player[key] for key in CAREER_FIELDS[1:]])
            if archive_leader is None or player["goals"] > archive_leader["goals"]:
                archive_leader = {**player, "season": season}

    write_json(OUTPUT_DIR / "index.json", {"mode": "pl", "seasons": index, "archiveLeader": archive_leader})
    careers_size = write_json(OUTPUT_DIR / "careers.json", {"fields": CAREER_FIELDS, "players": careers})
    print(f"Built {OUTPUT_DIR} with {total_players} player-season rows (careers {careers_size // 1024} KB)")


if __name__ == "__main__":
    main()
