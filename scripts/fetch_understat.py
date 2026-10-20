"""Download season data for other European leagues from Understat.

Saves data/understat/<league>/<season>.json with two lists: `players` (season
totals with xG/xA) and `dates` (every match, with the result once played).
Understat covers these leagues from 2014-15; its player ids are shared across
leagues, which lets the dashboard follow a player who changes league.

    python scripts/fetch_understat.py            # missing seasons + the current one
    python scripts/fetch_understat.py --force    # everything again
    python scripts/fetch_understat.py --league laliga
"""

from __future__ import annotations

import argparse
import json
import time

import requests

from common import CURRENT_SEASON, DATA_DIR


API = "https://understat.com/getLeagueData/{league}/{year}"
HEADERS = {"User-Agent": "Fantasy-Premier-League-dashboard/1.0", "X-Requested-With": "XMLHttpRequest"}
FIRST_YEAR = 2014
# Dashboard key -> Understat league name.
LEAGUES = {"laliga": "La_liga", "bundesliga": "Bundesliga", "seriea": "Serie_A", "ligue1": "Ligue_1"}
OUTPUT_DIR = DATA_DIR / "understat"


def seasons() -> list[str]:
    last = int(CURRENT_SEASON[:4])
    return [f"{year}-{str(year + 1)[-2:]}" for year in range(FIRST_YEAR, last + 1)]


def fetch(league: str, season: str) -> dict:
    url = API.format(league=LEAGUES[league], year=season[:4])
    for attempt in range(3):
        try:
            response = requests.get(url, headers=HEADERS, timeout=(10, 60))
            response.raise_for_status()
            payload = response.json()
            return {"players": payload["players"], "dates": payload["dates"]}
        except (requests.RequestException, ValueError, KeyError):
            if attempt == 2:
                raise
            time.sleep(5)
    raise AssertionError("unreachable")


def main(force: bool = False, only: str | None = None) -> None:
    for league in [only] if only else LEAGUES:
        for season in seasons():
            target = OUTPUT_DIR / league / f"{season}.json"
            if target.exists() and not force and season != CURRENT_SEASON:
                continue
            payload = fetch(league, season)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            print(f"{league} {season}: {len(payload['players'])} players, {len(payload['dates'])} matches")
            time.sleep(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="download final seasons again")
    parser.add_argument("--league", choices=LEAGUES, help="only this league")
    args = parser.parse_args()
    main(args.force, args.league)
