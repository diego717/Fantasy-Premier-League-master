"""Download the gameweek-by-gameweek exports missing from the local archive.

The local copy only ships per-gameweek files up to 2019-20. The upstream
vaastav/Fantasy-Premier-League repository keeps a merged_gw.csv for every later
season, so this script mirrors those files into data/<season>/gws/.

    python scripts/download_archive_gws.py          # only missing files
    python scripts/download_archive_gws.py --force  # re-download everything
"""

from __future__ import annotations

import argparse

import requests

from common import CURRENT_SEASON, DATA_DIR


SOURCE_ROOT = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
SEASONS = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]


def download(season: str, force: bool) -> None:
    target = DATA_DIR / season / "gws" / "merged_gw.csv"
    if target.exists() and not force:
        print(f"{season}: already present, skipping")
        return
    response = requests.get(f"{SOURCE_ROOT}/{season}/gws/merged_gw.csv", timeout=(10, 120))
    response.raise_for_status()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)
    print(f"{season}: wrote {target.relative_to(DATA_DIR.parent)} ({len(response.content) // 1024} KB)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="overwrite files that already exist")
    args = parser.parse_args()
    for season in SEASONS:
        if season != CURRENT_SEASON:
            download(season, args.force)


if __name__ == "__main__":
    main()
