"""Build compact in-page Premier League fixture data for the dashboard.

The source archive mirrors the Fantasy Premier League fixture endpoint by
season. Only the fields needed by the UI are kept so the static site can show
the calendar without calling a third-party API from the browser. Each season is
written to web/data/fixtures/<season>.json and fetched only when selected.
"""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

from common import WEB_DATA_DIR, write_json

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = WEB_DATA_DIR / "fixtures"
SOURCE_ROOT = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
OFFICIAL_API = "https://footballapi.pulselive.com/football"
SEASONS = [f"{year}-{str(year + 1)[-2:]}" for year in range(2009, 2027)]
OFFICIAL_COMP_SEASONS = {
    "2009-10": 18, "2010-11": 19, "2011-12": 20, "2012-13": 21,
    "2013-14": 22, "2014-15": 27, "2015-16": 42, "2016-17": 54,
    "2017-18": 79, "2018-19": 210, "2019-20": 274, "2020-21": 363,
    "2021-22": 418, "2022-23": 489, "2023-24": 578, "2024-25": 719,
    "2025-26": 777, "2026-27": 841,
}


def fetch_text(url: str) -> str:
    response = requests.get(
        url,
        headers={"Origin": "https://www.premierleague.com", "User-Agent": "Fantasy-Premier-League-dashboard/1.0", "Connection": "close"},
        timeout=(10, 30),
    )
    response.raise_for_status()
    return response.text.lstrip("\ufeff")


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def read_source(season: str, filename: str) -> str:
    local_file = ROOT / "data" / season / filename
    try:
        return fetch_text(f"{SOURCE_ROOT}/{season}/{filename}")
    except Exception:
        if local_file.exists():
            return local_file.read_text(encoding="utf-8-sig")
        raise


def number(value: str | None) -> int | None:
    try:
        return int(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def build_legacy_from_gameweeks(season: str) -> dict | None:
    """Recover older fixture lists from the per-gameweek player exports."""
    season_dir = ROOT / "data" / season
    players_file = season_dir / "players_raw.csv"
    clubs_file = ROOT / "data" / "pl" / f"{season}_players_stats.csv"
    if not players_file.exists() or not clubs_file.exists():
        return None

    player_teams = {}
    with players_file.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle):
            player_id = number(row.get("id"))
            team_id = number(row.get("team"))
            if player_id is not None and team_id is not None:
                player_teams[player_id] = team_id

    teams = {}
    with clubs_file.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle):
            team_id = number(row.get("team_id"))
            name = row.get("team_name", "Unknown")
            if team_id is not None and team_id not in teams:
                parts = [part for part in name.split() if part.lower() not in {"and", "of"}]
                teams[team_id] = {"name": name, "short": "".join(part[0] for part in parts)[:3].upper()}

    matches = {}
    for gameweek_file in sorted((season_dir / "gws").glob("gw*.csv")):
        with gameweek_file.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
            for row in csv.DictReader(handle):
                fixture_id = number(row.get("fixture"))
                player_id = number(row.get("element")) or number(row.get("id"))
                opponent = number(row.get("opponent_team"))
                event = number(row.get("round"))
                team = player_teams.get(player_id) if player_id is not None else None
                if None in (fixture_id, player_id, opponent, event, team) or fixture_id in matches:
                    continue
                is_home = row.get("was_home", "").lower() == "true"
                matches[fixture_id] = {
                    "event": event,
                    "kickoff": row.get("kickoff_time") or "",
                    "home": team if is_home else opponent,
                    "away": opponent if is_home else team,
                    "homeScore": number(row.get("team_h_score")),
                    "awayScore": number(row.get("team_a_score")),
                    "finished": True,
                }

    if len(matches) < 300:
        return None
    return {"teams": {str(key): value for key, value in teams.items()}, "matches": list(matches.values())}


def build_official_season(season: str) -> dict:
    comp_season = OFFICIAL_COMP_SEASONS[season]
    payload = fetch_json(f"{OFFICIAL_API}/fixtures?comp=1&compSeasons={comp_season}&page=0&pageSize=1000&altIds=true")
    teams = {}
    matches = []
    for fixture in payload.get("content", []):
        gameweek = fixture.get("gameweek") or {}
        week = number(str(gameweek.get("gameweek", "")))
        fixture_teams = fixture.get("teams") or []
        if week is None or len(fixture_teams) < 2:
            continue
        home_team = fixture_teams[0].get("team") or {}
        away_team = fixture_teams[1].get("team") or {}
        home_club = home_team.get("club") or {}
        away_club = away_team.get("club") or {}
        home_id = number(str(home_team.get("id", "")))
        away_id = number(str(away_team.get("id", "")))
        if home_id is None or away_id is None:
            continue
        teams[str(home_id)] = {"name": home_team.get("name", "Unknown"), "short": home_club.get("abbr") or home_team.get("shortName", "LOC")}
        teams[str(away_id)] = {"name": away_team.get("name", "Unknown"), "short": away_club.get("abbr") or away_team.get("shortName", "VIS")}
        kickoff = (fixture.get("kickoff") or {}).get("millis")
        kickoff_iso = datetime.fromtimestamp(kickoff / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z") if kickoff else ""
        home_score = fixture_teams[0].get("score")
        away_score = fixture_teams[1].get("score")
        matches.append({
            "event": week,
            "kickoff": kickoff_iso,
            "home": home_id,
            "away": away_id,
            "homeScore": number(str(home_score)) if home_score is not None else None,
            "awayScore": number(str(away_score)) if away_score is not None else None,
            "finished": fixture.get("status") in {"C", "F"} or fixture.get("outcome") in {"H", "A", "D"},
        })
    if len(matches) < 300:
        raise RuntimeError(f"official source returned only {len(matches)} matches")
    return {"teams": teams, "matches": matches}


def build_season(season: str) -> dict | None:
    try:
        return build_official_season(season)
    except Exception as error:  # pragma: no cover - keep archive fallback available
        print(f"Official source unavailable for {season}: {error}")
    try:
        try:
            teams_rows = list(csv.DictReader(io.StringIO(read_source(season, "teams.csv"))))
        except Exception:
            raw_file = ROOT / "data" / season / "raw.json"
            raw_teams = json.loads(raw_file.read_text(encoding="utf-8"))["teams"]
            teams_rows = [{
                "id": str(row.get("id", "")),
                "name": row.get("name", "Unknown"),
                "short_name": row.get("short_name", "—"),
            } for row in raw_teams]
        fixture_rows = csv.DictReader(io.StringIO(read_source(season, "fixtures.csv")))
    except Exception as error:  # pragma: no cover - network/source availability varies by season
        legacy = build_legacy_from_gameweeks(season)
        if legacy:
            print(f"{season}: recovered {len(legacy['matches'])} matches from gameweek exports")
            return legacy
        print(f"Skipping {season}: {error}")
        return None

    teams = {
        str(number(row.get("id"))): {
            "name": row.get("name", "Unknown"),
            "short": row.get("short_name", "—"),
        }
        for row in teams_rows
        if number(row.get("id")) is not None
    }

    matches = []
    for row in fixture_rows:
        event = number(row.get("event"))
        home = number(row.get("team_h"))
        away = number(row.get("team_a"))
        if event is None or home is None or away is None:
            continue
        matches.append({
            "event": event,
            "kickoff": row.get("kickoff_time") or "",
            "home": home,
            "away": away,
            "homeScore": number(row.get("team_h_score")),
            "awayScore": number(row.get("team_a_score")),
            "finished": row.get("finished", "").lower() == "true",
        })

    if not matches:
        return None
    return {"teams": teams, "matches": matches}


def main() -> None:
    for season in SEASONS:
        data = build_season(season)
        if data:
            write_json(OUTPUT_DIR / f"{season}.json", data)
            print(f"{season}: {len(data['matches'])} matches")
    print(f"Wrote {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
