"""Refresh the current season snapshot from the public FPL API.

Writes data/<CURRENT_SEASON>/players_raw.csv, teams.csv, cleaned_players.csv,
player_idlist.csv and one gws/gwN.csv per started gameweek plus merged_gw.csv.
Gameweek stats come from event/<gw>/live/, which returns every player of a
gameweek in a single request (double gameweeks are already summed).
"""

from __future__ import annotations

import csv
import sys
import time

import requests

from common import CURRENT_SEASON, DATA_DIR, ROOT


API = "https://fantasy.premierleague.com/api"
POSITION_NAMES = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
HEADERS = {"User-Agent": "Fantasy-Premier-League-dashboard/1.0"}

sys.path.insert(0, str(ROOT))
from cleaners import clean_players, id_players  # noqa: E402


def get(path: str) -> dict:
    for attempt in range(3):
        try:
            response = requests.get(f"{API}/{path}", headers=HEADERS, timeout=(10, 60))
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(5)
    raise AssertionError("unreachable")


def write_rows(path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    season_dir = DATA_DIR / CURRENT_SEASON
    bootstrap = get("bootstrap-static/")
    elements = bootstrap["elements"]
    teams = {team["id"]: team["name"] for team in bootstrap["teams"]}

    # Same layout as parsers.parse_players: every API field, sorted.
    write_rows(season_dir / "players_raw.csv", elements, sorted(elements[0]))
    write_rows(season_dir / "teams.csv", bootstrap["teams"], list(bootstrap["teams"][0]))
    base = str(season_dir) + "/"  # cleaners concatenate filenames onto this
    clean_players(str(season_dir / "players_raw.csv"), base)
    id_players(str(season_dir / "players_raw.csv"), base)
    print(f"{CURRENT_SEASON}: {len(elements)} players, {len(teams)} teams")

    players = {element["id"]: element for element in elements}
    started = [event["id"] for event in bootstrap["events"] if event["finished"] or event["is_current"]]
    merged = []
    for gameweek in started:
        live = get(f"event/{gameweek}/live/")
        rows = []
        for item in live["elements"]:
            player = players.get(item["id"], {})
            rows.append({
                "name": f"{player.get('first_name', '')} {player.get('second_name', '')}".strip(),
                "position": POSITION_NAMES.get(player.get("element_type"), ""),
                "team": teams.get(player.get("team"), ""),
                "element": item["id"],
                "round": gameweek,
                **item["stats"],
                "GW": gameweek,
            })
        fieldnames = list(rows[0]) if rows else ["element", "round", "GW"]
        write_rows(season_dir / "gws" / f"gw{gameweek}.csv", rows, fieldnames)
        merged.extend(rows)
        print(f"GW{gameweek}: {len(rows)} rows")
        time.sleep(0.5)

    if merged:
        write_rows(season_dir / "gws" / "merged_gw.csv", merged, list(merged[0]))


if __name__ == "__main__":
    main()
