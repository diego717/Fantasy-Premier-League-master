"""Checks on the builder helpers and on the generated web/data files.

Run with: python -m unittest discover tests
(regenerate first with: python scripts/build_all.py --skip-fixtures)
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from common import RATE_MIN_MINUTES, WEB_DATA_DIR, canonical_club, number, per_90, repair_text  # noqa: E402


def load(path: str):
    return json.loads((WEB_DATA_DIR / path).read_text(encoding="utf-8"))


class HelperTests(unittest.TestCase):
    def test_repair_text_fixes_mojibake(self):
        self.assertEqual(repair_text("KantÃ©"), "Kanté")
        self.assertEqual(repair_text("Kanté"), "Kanté")
        self.assertEqual(repair_text(None), "")

    def test_number_parses_and_defaults(self):
        self.assertEqual(number({"a": "3.0"}, "a"), 3)
        self.assertEqual(number({"a": "2.345"}, "a"), 2.35)
        self.assertEqual(number({"a": "None"}, "a"), 0)
        self.assertEqual(number({}, "a", 7), 7)

    def test_per_90_needs_minimum_minutes(self):
        self.assertEqual(per_90(10, RATE_MIN_MINUTES - 1), 0)
        self.assertEqual(per_90(10, 900), 1.0)

    def test_canonical_club(self):
        self.assertEqual(canonical_club("A Villa"), "Aston Villa")
        self.assertEqual(canonical_club("Ipswich Town"), "Ipswich")
        self.assertEqual(canonical_club("Arsenal"), "Arsenal")


    def test_pl_short_name_keeps_particles(self):
        from build_pl_dashboard_data import short_name

        self.assertEqual(short_name("Kevin De Bruyne"), "De Bruyne")
        self.assertEqual(short_name("Virgil van Dijk"), "van Dijk")
        self.assertEqual(short_name("Mohamed Salah"), "Salah")
        self.assertEqual(short_name("Rodri"), "Rodri")


class GeneratedDataTests(unittest.TestCase):
    def check_mode(self, mode: str, primary: str, clubs: tuple[int, ...] = (20,)):
        index = load(f"{mode}/index.json")
        self.assertGreater(len(index["seasons"]), 5)
        careers = load("leagues/careers.json" if mode not in ("fpl", "pl") else f"{mode}/careers.json")
        for summary in index["seasons"]:
            season = summary["season"]
            with self.subTest(mode=mode, season=season):
                players = load(f"{mode}/{season}.json")["players"]
                ids = [player["id"] for player in players]
                self.assertEqual(len(ids), len(set(ids)), "one row per player and season")
                self.assertEqual(summary["stats"]["players"], len(players))
                self.assertIn(summary["stats"]["clubs"], clubs)
                self.assertEqual(sum(club["players"] for club in summary["clubs"]), len(players))
                self.assertEqual(summary["stats"][primary], sum(player[primary] for player in players))
                self.assertEqual(summary["leaders"][0][primary], max(player[primary] for player in players))
        self.assertEqual(index["archiveLeader"][primary], max(summary["leaders"][0][primary] for summary in index["seasons"]))
        self.assertTrue(all(len(row) == len(careers["fields"]) for rows in careers["players"].values() for row in rows))

    def test_fpl_data(self):
        self.check_mode("fpl", "points")

    def test_pl_data(self):
        self.check_mode("pl", "goals")

    def test_understat_leagues(self):
        for league in ("laliga", "bundesliga", "seriea", "ligue1"):
            self.check_mode(league, "goals", clubs=(18, 20))
            for summary in load(f"{league}/index.json")["seasons"]:
                fixtures = load(f"{league}/fixtures/{summary['season']}.json")
                self.assertEqual(len(fixtures["teams"]), summary["stats"]["clubs"])
                self.assertEqual(len(fixtures["matches"]), summary["stats"]["clubs"] * (summary["stats"]["clubs"] - 1))

    def test_understat_careers_cover_every_player(self):
        careers = load("leagues/careers.json")["players"]
        for league in ("laliga", "bundesliga", "seriea", "ligue1"):
            season = load(f"{league}/index.json")["seasons"][-1]["season"]
            for player in load(f"{league}/{season}.json")["players"]:
                self.assertIn([league, season], [row[:2] for row in careers[str(player["id"])]])

    def test_fpl_gameweeks_add_up_to_season_points(self):
        index = load("fpl/index.json")
        seasons = [summary["season"] for summary in index["seasons"] if summary["hasGameweeks"]]
        self.assertTrue(seasons)
        for season in seasons:
            with self.subTest(season=season):
                points = {str(player["id"]): player["points"] for player in load(f"fpl/{season}.json")["players"]}
                gameweeks = load(f"fpl/gws/{season}.json")["players"]
                self.assertTrue(set(gameweeks) <= set(points))
                # The upstream 2024-25 export misses one point for a single player.
                mismatched = [player_id for player_id, rows in gameweeks.items() if sum(row[1] for row in rows) != points[player_id]]
                self.assertLessEqual(len(mismatched), 1, mismatched)

    def test_fixtures_have_full_seasons(self):
        files = sorted((WEB_DATA_DIR / "fixtures").glob("*.json"))
        self.assertTrue(files)
        for path in files:
            with self.subTest(season=path.stem):
                data = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(len(data["matches"]), 380)
                self.assertTrue(all(str(match["home"]) in data["teams"] for match in data["matches"]))


if __name__ == "__main__":
    unittest.main()
