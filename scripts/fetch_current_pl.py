"""Refresh the current season of the Premier League (non-FPL) archive.

Writes data/pl/<CURRENT_SEASON>_players_stats.csv in the same layout as the
older files of that archive, using the stats API behind premierleague.com.
The leaderboard is requested once per club (filtered with `team=`), so every
row carries the club the player played for this season instead of his
current team (which can be a U21 side or a club outside the league).

Club ids come from data/<CURRENT_SEASON>/teams.csv: the FPL team `code` is
the same id the Premier League API uses. Run fetch_current_season.py first.
"""

from __future__ import annotations

import csv
import time

import requests

from common import CURRENT_SEASON, DATA_DIR


API = "https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v2/competitions/8/seasons/{year}/players/stats/leaderboard"
HEADERS = {"Origin": "https://www.premierleague.com", "User-Agent": "Fantasy-Premier-League-dashboard/1.0"}
META_FIELDS = ["playerId", "playerName", "position", "team_name", "team_id", "nationality", "season"]


def clubs() -> list[tuple[int, str]]:
    with (DATA_DIR / CURRENT_SEASON / "teams.csv").open(encoding="utf-8-sig", newline="") as handle:
        return [(int(row["code"]), row["name"]) for row in csv.DictReader(handle)]


def fetch_club(year: str, club_id: int) -> list[dict]:
    rows, cursor = [], None
    while True:
        params = {"_sort": "timePlayed:desc", "_limit": 100, "team": club_id}
        if cursor:
            params["_next"] = cursor
        for attempt in range(3):
            try:
                response = requests.get(API.format(year=year), params=params, headers=HEADERS, timeout=(10, 60))
                response.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(5)
        payload = response.json()
        rows.extend(payload["data"])
        cursor = payload["pagination"].get("_next")
        if not cursor or not payload["data"]:
            return rows


def main() -> None:
    year = CURRENT_SEASON[:4]
    output, stat_names = [], []
    for club_id, club_name in clubs():
        players = fetch_club(year, club_id)
        for item in players:
            meta, stats = item["playerMetadata"], item["stats"]
            for name in stats:
                if name not in stat_names:
                    stat_names.append(name)
            output.append({
                "playerId": meta["id"],
                "playerName": meta["name"],
                "position": meta.get("position", ""),
                "team_name": club_name,
                "team_id": club_id,
                "nationality": (meta.get("country") or {}).get("country", ""),
                "season": CURRENT_SEASON,
                **stats,
            })
        print(f"{club_name}: {len(players)} players")
        time.sleep(0.3)

    target = DATA_DIR / "pl" / f"{CURRENT_SEASON}_players_stats.csv"
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, META_FIELDS + stat_names)
        writer.writeheader()
        writer.writerows(output)
    print(f"Wrote {target.relative_to(DATA_DIR.parent)} ({len(output)} rows)")


if __name__ == "__main__":
    main()
