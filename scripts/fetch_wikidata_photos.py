"""Build Understat player -> Wikimedia Commons photo maps.

Understat does not expose player photos. This downloader matches each player by
name and by a confirmed Wikidata club statement, then stores only the Commons
file name. The resulting files are deliberately small and deterministic:

    data/wikidata/<league>.json

The script is networked and should be run explicitly, or through
``build_all.py --fetch-current``.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import time
import unicodedata
from pathlib import Path
from urllib.parse import unquote

import requests

from common import DATA_DIR, WEB_DATA_DIR
from fetch_understat import LEAGUES


SPARQL_URL = "https://query.wikidata.org/sparql"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COUNTRIES = {"laliga": {"Q29"}, "bundesliga": {"Q183"}, "seriea": {"Q38"}, "ligue1": {"Q142", "Q235"}}
LANGUAGES = ("en", "es", "de", "it", "fr", "pt")
HEADERS = {
    "Accept": "application/sparql-results+json",
    "User-Agent": "Fantasy-Premier-League-dashboard/1.0 (Wikidata photo import)",
}
OUTPUT_DIR = DATA_DIR / "wikidata"

# Understat uses a few provider-specific names. These aliases keep the club
# confirmation strict while covering the common differences in spelling.
CLUB_ALIASES = {
    "Atletico Madrid": ["Atlético de Madrid"],
    "Athletic Club": ["Athletic Club Bilbao"],
    "Alaves": ["Deportivo Alavés"],
    "Deportivo La Coruna": ["Deportivo de La Coruña"],
    "Las Palmas": ["UD Las Palmas"],
    "Malaga": ["Málaga CF"],
    "Real Betis": ["Real Betis Balompié"],
    "Racing Santander": ["Racing de Santander"],
    "Bayern Munich": ["FC Bayern Munich", "FC Bayern München"],
    "Borussia M.Gladbach": ["Borussia Mönchengladbach"],
    "FC Cologne": ["1. FC Köln"],
    "Fortuna Duesseldorf": ["Fortuna Düsseldorf"],
    "Greuther Fuerth": ["SpVgg Greuther Fürth"],
    "Hertha Berlin": ["Hertha BSC"],
    "Nuernberg": ["1. FC Nürnberg"],
    "RasenBallsport Leipzig": ["RB Leipzig"],
    "St. Pauli": ["FC St. Pauli"],
    "AC Milan": ["Associazione Calcio Milan", "AC Milan"],
    "Inter": ["Inter Milan", "FC Internazionale Milano"],
    "Parma": ["Parma Calcio 1913"],
    "SPAL 2013": ["SPAL"],
    "Verona": ["Hellas Verona FC"],
    "Evian Thonon Gaillard": ["Évian Thonon Gaillard FC"],
    "GFC Ajaccio": ["Gazélec Ajaccio"],
    "Paris Saint Germain": ["Paris Saint-Germain"],
    "Saint-Etienne": ["AS Saint-Étienne"],
    "Monaco": ["AS Monaco FC"],
}


def sparql_literal(value: str, language: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"@{language}'


def sparql(session: requests.Session, query: str) -> list[dict]:
    for attempt in range(4):
        try:
            # The public endpoint is noticeably more reliable for these small
            # read-only queries over GET than over POST from CI/workstations.
            response = session.get(SPARQL_URL, params={"query": query, "format": "json"}, headers=HEADERS, timeout=(15, 120))
            response.raise_for_status()
            return response.json()["results"]["bindings"]
        except (requests.RequestException, ValueError, KeyError):
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    raise AssertionError("unreachable")


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def normalize(value: str) -> tuple[str, ...]:
    value = unicodedata.normalize("NFKD", value.lower())
    value = "".join(char for char in value if not unicodedata.combining(char))
    return tuple(re.sub(r"[^a-z0-9 ]", " ", value.replace("-", " ")).split())


def load_players(league: str) -> dict[int, dict]:
    players: dict[int, dict] = {}
    for path in sorted((WEB_DATA_DIR / league).glob("20*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload["players"]:
            player_id = int(row["id"])
            player = players.setdefault(player_id, {"names": set(), "clubs": set()})
            player["names"].add(row["name"])
            player["clubs"].add(row["club"])
            player["clubs"].update(row.get("otherClubs", []))
    return players


def resolve_clubs(session: requests.Session, league: str, names: set[str]) -> dict[str, set[str]]:
    aliases = {source: {source, *CLUB_ALIASES.get(source, [])} for source in sorted(names)}
    countries = " ".join(f"wd:{country}" for country in sorted(COUNTRIES[league]))
    result: dict[str, set[str]] = collections.defaultdict(set)
    sources = sorted(aliases)
    for start in range(0, len(sources), 5):
        batch = sources[start:start + 5]
        values = " ".join(sparql_literal(alias, "en") for source in batch for alias in aliases[source])
        query = f"""
        SELECT DISTINCT ?club ?wanted WHERE {{
          VALUES ?wanted {{ {values} }}
          VALUES ?country {{ {countries} }}
          ?club wdt:P17 ?country .
          ?club (rdfs:label|skos:altLabel) ?wanted .
        }}
        """
        aliases_to_source = {alias: source for source in batch for alias in aliases[source]}
        for row in sparql(session, query):
            source = aliases_to_source.get(row["wanted"]["value"])
            if source:
                result[source].add(qid(row["club"]["value"]))
        time.sleep(0.4)
    return result


def fetch_club_players(session: requests.Session, club_id: str) -> list[dict]:
    query = f"""
    SELECT DISTINCT ?player ?img WHERE {{
      ?player wdt:P106 wd:Q937857 ; wdt:P18 ?img ; p:P54 ?statement .
      ?statement ps:P54 wd:{club_id} .
      OPTIONAL {{ ?statement pq:P582 ?end }}
      FILTER(!BOUND(?end) || YEAR(?end) >= 2014)
    }}
    """
    return sparql(session, query)


def load_names(session: requests.Session, player_ids: set[str]) -> dict[str, set[str]]:
    names: dict[str, set[str]] = collections.defaultdict(set)
    ids = sorted(player_ids)
    for start in range(0, len(ids), 300):
        values = " ".join(f"wd:{item}" for item in ids[start:start + 300])
        query = f"""
        SELECT ?item ?name WHERE {{
          VALUES ?item {{ {values} }}
          ?item (rdfs:label|skos:altLabel) ?name .
          FILTER(LANG(?name) IN ({', '.join(json.dumps(language) for language in LANGUAGES)}))
        }}
        """
        for row in sparql(session, query):
            names[qid(row["item"]["value"])].add(row["name"]["value"])
    return names


def match_player(player: dict, clubs: dict[str, set[str]], candidates: dict[str, dict]) -> str | None:
    confirmed_clubs = set().union(*(clubs.get(name, set()) for name in player["clubs"]))
    if not confirmed_clubs:
        return None
    eligible = {key: value for key, value in candidates.items() if value["clubs"] & confirmed_clubs}
    by_name: dict[tuple[str, ...], set[str]] = collections.defaultdict(set)
    for key, value in eligible.items():
        for name in value["names"]:
            by_name[normalize(name)].add(key)
    exact = {key for name in player["names"] for key in by_name.get(normalize(name), set())}
    if len(exact) == 1:
        return candidates[next(iter(exact))]["img"]

    tokens = set().union(*(set(normalize(name)) for name in player["names"]))
    tokens = {token for token in tokens if len(token) >= 4}
    fuzzy = {
        key for key, value in eligible.items()
        if any(tokens <= set(normalize(name)) for name in value["names"])
    } if tokens else set()
    return candidates[next(iter(fuzzy))]["img"] if len(fuzzy) == 1 else None


def build_map(session: requests.Session, league: str) -> dict[str, str]:
    players = load_players(league)
    clubs = resolve_clubs(session, league, set().union(*(player["clubs"] for player in players.values())))
    candidates: dict[str, dict] = {}
    for club_ids in clubs.values():
        for club_id in sorted(club_ids):
            for row in fetch_club_players(session, club_id):
                player_id = qid(row["player"]["value"])
                candidate = candidates.setdefault(player_id, {"clubs": set(), "names": set(), "img": row["img"]["value"]})
                candidate["clubs"].add(club_id)
                candidate["img"] = row["img"]["value"]
    names = load_names(session, set(candidates))
    for player_id, candidate in candidates.items():
        candidate["names"] = names.get(player_id, set())
    result = {}
    for understat_id, player in players.items():
        image = match_player(player, clubs, candidates)
        if image:
            # Wikidata commonly returns a percent-encoded Special:FilePath
            # URL. Store the readable Commons filename so the frontend only
            # needs to encode it once.
            result[str(understat_id)] = unquote(image.rsplit("/", 1)[-1])
    print(f"{league}: {len(result)} photos / {len(players)} players; {len(candidates)} Wikidata candidates")
    return result


def main(only: str | None = None) -> None:
    session = requests.Session()
    for league in [only] if only else LEAGUES:
        payload = build_map(session, league)
        target = OUTPUT_DIR / f"{league}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        time.sleep(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--league", choices=LEAGUES, help="only this league")
    main(parser.parse_args().league)
