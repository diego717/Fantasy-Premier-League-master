"""Build the dashboard datasets for the other European leagues (Understat).

Reads data/understat/<league>/<season>.json (see fetch_understat.py) and
writes, per league, the same files the PL mode uses:

    web/data/<league>/index.json
    web/data/<league>/<season>.json
    web/data/<league>/fixtures/<season>.json

plus web/data/leagues/careers.json, shared by the four leagues because
Understat player ids are the same in all of them.
"""

from __future__ import annotations

import json
from collections import defaultdict

from build_pl_dashboard_data import short_name, summarize
from common import DATA_DIR, WEB_DATA_DIR, number, per_90, write_json
from fetch_understat import LEAGUES


SOURCE_DIR = DATA_DIR / "understat"
PHOTO_DIR = DATA_DIR / "wikidata"
CAREER_FIELDS = ["league", "season", "id", "club", "position", "goals", "assists", "minutes", "appearances", "expectedGoals"]
POSITIONS = {"G": "GK", "D": "DEF", "M": "MID", "F": "FWD"}


def position(value: str) -> str:
    """Understat lists every role played ("F M S"); the first one is the main one."""

    return POSITIONS.get((value or "S")[0], "—")


def read_photo_map(league: str) -> dict[str, str]:
    path = PHOTO_DIR / f"{league}.json"
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain an object mapping player ids to Commons files")
    return {str(player_id): photo for player_id, photo in payload.items() if isinstance(photo, str) and photo}


def read_players(rows: list[dict], photos: dict[str, str] | None = None) -> list[dict]:
    photos = photos or {}
    players = []
    for row in rows:
        minutes = number(row, "time")
        goals = number(row, "goals")
        assists = number(row, "assists")
        # Players who changed club mid-season come as "Club A,Club B" (alphabetical,
        # with combined totals), so the first one is kept and the rest go to otherClubs.
        clubs = [club.strip() for club in row.get("team_title", "").split(",") if club.strip()] or ["Unknown club"]
        player = {
            "id": int(number(row, "id", 0)),
            "name": row.get("player_name", "").strip(),
            "shortName": short_name(row.get("player_name", "").strip()),
            "position": position(row.get("position", "")),
            "club": clubs[0],
            "goals": goals,
            "assists": assists,
            "minutes": minutes,
            "appearances": number(row, "games"),
            "expectedGoals": round(number(row, "xG"), 2),
            "expectedAssists": round(number(row, "xA"), 2),
            "nonPenaltyGoals": number(row, "npg"),
            "nonPenaltyXg": round(number(row, "npxG"), 2),
            "shots": number(row, "shots"),
            "keyPasses": number(row, "key_passes"),
            "yellowCards": number(row, "yellow_cards"),
            "redCards": number(row, "red_cards"),
            "goalsPer90": per_90(goals, minutes),
            "contributionsPer90": per_90(goals + assists, minutes),
            "contributions": goals + assists,
        }
        if len(clubs) > 1:
            player["otherClubs"] = clubs[1:]
        if str(player["id"]) in photos:
            player["photo"] = photos[str(player["id"])]
        if player["name"]:
            players.append(player)
    return players


def read_fixtures(dates: list[dict]) -> dict:
    """Understat has no matchweek, so it is derived from each team's game count.

    A match gets the larger of the two teams' running game numbers: that is the
    real matchweek except for a postponed game, which lands where it was played.
    """

    teams, matches, played = {}, [], defaultdict(int)
    for match in sorted(dates, key=lambda item: (item.get("datetime") or "", item["id"])):
        home, away = match["h"], match["a"]
        for side in (home, away):
            teams[side["id"]] = {"name": side["title"], "short": side.get("short_title") or side["title"][:3].upper()}
        played[home["id"]] += 1
        played[away["id"]] += 1
        finished = bool(match.get("isResult"))
        goals = match.get("goals") or {}
        matches.append({
            "event": max(played[home["id"]], played[away["id"]]),
            # Understat times are UTC (Girona-Rayo, 15 Aug 2025, 19:00 CEST, is listed at 17:00).
            "kickoff": f"{match['datetime'].replace(' ', 'T')}Z" if match.get("datetime") else "",
            "home": int(home["id"]),
            "away": int(away["id"]),
            "homeScore": int(goals["h"]) if finished and goals.get("h") is not None else None,
            "awayScore": int(goals["a"]) if finished and goals.get("a") is not None else None,
            "finished": finished,
        })
    return {"teams": teams, "matches": matches}


def generated_facts(league: str, season: str, players: list[dict]) -> list[dict]:
    """Facts derived from the same rows shown in the dashboard."""

    source = f"https://understat.com/league/{LEAGUES[league]}/{season[:4]}"
    if not players:
        return []
    top_goals = max(players, key=lambda player: (player["goals"], player["minutes"]))
    top_assists = max(players, key=lambda player: (player["assists"], player["minutes"]))
    eligible = [player for player in players if player["minutes"] >= 900]
    overperformer = max(eligible or players, key=lambda player: (player["goals"] - player["expectedGoals"], player["minutes"]))
    overperformance = round(overperformer["goals"] - overperformer["expectedGoals"], 2)
    return [
        {
            "eyebrow": f"GOLEADOR · {season}",
            "title": f"{top_goals['shortName']} hizo {top_goals['goals']} goles",
            "body": f"{top_goals['name']} fue el máximo goleador de {season} en {league}, según los datos de Understat.",
            "source": source,
        },
        {
            "eyebrow": f"ASISTIDOR · {season}",
            "title": f"{top_assists['shortName']} dio {top_assists['assists']} asistencias",
            "body": f"{top_assists['name']} lideró las asistencias de {season} en {league}, según los datos de Understat.",
            "source": source,
        },
        {
            "eyebrow": f"SOBRE XG · {season}",
            "title": f"{overperformer['shortName']} superó su xG por {overperformance}",
            "body": f"Marcó {overperformer['goals']} goles con un xG de {overperformer['expectedGoals']}; el cálculo usa jugadores con al menos 900 minutos cuando están disponibles.",
            "source": source,
        },
    ]


def main() -> None:
    careers: dict[int, list[list]] = defaultdict(list)
    facts: dict[str, list[dict]] = defaultdict(list)
    for league in LEAGUES:
        photos = read_photo_map(league)
        index, archive_leader, total = [], None, 0
        for path in sorted((SOURCE_DIR / league).glob("*.json")):
            season = path.stem
            raw = json.loads(path.read_text(encoding="utf-8"))
            players = read_players(raw["players"], photos)
            total += len(players)
            summary = summarize(season, players)
            facts[league].extend(generated_facts(league, season, players))
            index.append(summary)
            write_json(WEB_DATA_DIR / league / f"{season}.json", {"season": season, "players": players})
            write_json(WEB_DATA_DIR / league / "fixtures" / f"{season}.json", read_fixtures(raw["dates"]))
            for player in players:
                careers[player["id"]].append([league, season] + [player[key] for key in CAREER_FIELDS[2:]])
                if archive_leader is None or player["goals"] > archive_leader["goals"]:
                    archive_leader = {**player, "season": season}
        write_json(WEB_DATA_DIR / league / "index.json", {"mode": league, "seasons": index, "archiveLeader": archive_leader, "facts": facts[league]})
        print(f"Built web/data/{league} with {total} player-season rows")

    for rows in careers.values():
        rows.sort(key=lambda row: (row[1], row[0]))
    size = write_json(WEB_DATA_DIR / "leagues" / "careers.json", {"fields": CAREER_FIELDS, "players": careers})
    print(f"Built web/data/leagues/careers.json ({size // 1024} KB, {len(careers)} players)")


if __name__ == "__main__":
    main()
