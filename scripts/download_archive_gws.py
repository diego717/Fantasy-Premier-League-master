"""Download the season exports missing from the local archive.

The local copy only ships per-gameweek files up to 2019-20, and its 2019-20
snapshot stops at gameweek 29 (the season was paused in March 2020). The
upstream vaastav/Fantasy-Premier-League repository keeps a merged_gw.csv for
every season and the final 2019-20 player totals, so this script mirrors
those files into data/<season>/.

    python scripts/download_archive_gws.py                    # only missing files
    python scripts/download_archive_gws.py --force            # re-download everything
    python scripts/download_archive_gws.py --season 2019-20 --force
"""

from __future__ import annotations

import argparse

import requests

from common import CURRENT_SEASON, DATA_DIR


SOURCE_ROOT = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
SEASON_FILES = {
    "2019-20": ["gws/merged_gw.csv", "players_raw.csv", "cleaned_players.csv"],
    "2020-21": ["gws/merged_gw.csv"],
    "2021-22": ["gws/merged_gw.csv"],
    "2022-23": ["gws/merged_gw.csv"],
    "2023-24": ["gws/merged_gw.csv"],
    "2024-25": ["gws/merged_gw.csv"],
    "2025-26": ["gws/merged_gw.csv"],
}
SEASONS = list(SEASON_FILES)


def download(season: str, force: bool) -> None:
    for name in SEASON_FILES[season]:
        target = DATA_DIR / season / name
        if target.exists() and not force:
            print(f"{season}/{name}: already present, skipping")
            continue
        response = requests.get(f"{SOURCE_ROOT}/{season}/{name}", timeout=(10, 120))
        response.raise_for_status()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(response.content)
        print(f"{season}: wrote {target.relative_to(DATA_DIR.parent)} ({len(response.content) // 1024} KB)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="overwrite files that already exist")
    parser.add_argument("--season", choices=SEASONS, help="only this season")
    args = parser.parse_args()
    for season in [args.season] if args.season else SEASONS:
        if season != CURRENT_SEASON:
            download(season, args.force)


if __name__ == "__main__":
    main()
