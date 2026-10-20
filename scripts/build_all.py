"""Regenerate every dataset the dashboard reads from web/data/.

    python scripts/build_all.py                  # rebuild from local CSVs + fixtures
    python scripts/build_all.py --fetch-current  # refresh the current season from the FPL API first
    python scripts/build_all.py --skip-fixtures  # no network: keep the fixture files already built
"""

from __future__ import annotations

import argparse

import build_dashboard_data
import build_fixture_data
import build_pl_dashboard_data
import download_archive_gws
import fetch_current_season


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fetch-current", action="store_true", help="refresh the current season from the FPL API")
    parser.add_argument("--skip-fixtures", action="store_true", help="do not rebuild fixtures (needs network)")
    args = parser.parse_args()

    if args.fetch_current:
        fetch_current_season.main()
        print()
    for season in download_archive_gws.SEASONS:
        if not (download_archive_gws.DATA_DIR / season / "gws" / "merged_gw.csv").exists():
            download_archive_gws.download(season, force=False)
    build_dashboard_data.main()
    build_pl_dashboard_data.main()
    if not args.skip_fixtures:
        build_fixture_data.main()


if __name__ == "__main__":
    main()
