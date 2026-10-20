# Prototipo (no forma parte del build): empareja jugadores de LaLiga en Understat con fotos de Wikidata.
# Ver docs/HANDOFF.md para el estado y los problemas pendientes.
import json, re, sys, unicodedata, requests, collections
from pathlib import Path
UA = {"User-Agent": "Fantasy-Premier-League-dashboard/1.0 (local research)"}
def sparql(q):
    r = requests.post("https://query.wikidata.org/sparql", data={"query": q, "format": "json"}, headers=UA, timeout=120)
    r.raise_for_status(); return r.json()["results"]["bindings"]
base = sparql("""SELECT ?player ?img ?club WHERE {
  ?player wdt:P106 wd:Q937857 ; wdt:P18 ?img ; p:P54 ?st .
  ?st ps:P54 ?club . ?club wdt:P17 wd:Q29 .
  OPTIONAL { ?st pq:P582 ?end } FILTER(!BOUND(?end) || YEAR(?end) >= 2014) }""")
qid = lambda uri: uri.rsplit("/", 1)[1]
players_wd = collections.defaultdict(lambda: {"img": None, "clubs": set(), "names": set()})
for b in base:
    e = players_wd[qid(b["player"]["value"])]; e["img"] = b["img"]["value"]; e["clubs"].add(qid(b["club"]["value"]))
def labels(ids, alt):
    out = collections.defaultdict(set); ids = list(ids)
    for i in range(0, len(ids), 400):
        values = " ".join("wd:" + x for x in ids[i:i+400])
        prop = "skos:altLabel" if alt else "rdfs:label"
        for b in sparql(f'SELECT ?x ?n WHERE {{ VALUES ?x {{ {values} }} ?x {prop} ?n . FILTER(LANG(?n) IN ("en","es","de","it","fr","pt")) }}'):
            out[qid(b["x"]["value"])].add(b["n"]["value"])
    return out
for alt in (False, True):
    for k, v in labels(players_wd, alt).items(): players_wd[k]["names"] |= v
club_names = labels({c for e in players_wd.values() for c in e["clubs"]}, False)
print("wikidata players", len(players_wd))
def norm(s):
    s = unicodedata.normalize("NFKD", s.lower()); s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z ]", " ", s.replace("-", " ")).split()
by_name = collections.defaultdict(list)
for q, e in players_wd.items():
    clubs = " | ".join(n for c in e["clubs"] for n in club_names.get(c, ())).lower()
    for n in e["names"]: by_name[" ".join(norm(n))].append((q, e["img"], clubs))
by_token = collections.defaultdict(list)
for q, e in players_wd.items():
    clubs = " | ".join(n for c in e["clubs"] for n in club_names.get(c, ())).lower()
    for t in {t for n in e["names"] for t in norm(n)}: by_token[t].append((q, e["img"], clubs))
players = {}
for path in sorted(Path("web/data/laliga").glob("20*.json")):
    for p in json.load(open(path, encoding="utf-8"))["players"]:
        players.setdefault(p["id"], {**p, "minutesTotal": 0, "clubs": set()})
        players[p["id"]]["minutesTotal"] += p["minutes"]; players[p["id"]]["clubs"] |= {p["club"], *p.get("otherClubs", [])}
hit = amb = 0; hit_min = tot_min = 0; misses = []
for p in players.values():
    key = " ".join(norm(p["name"])); cands = {e[0]: e for e in by_name.get(key, [])}
    def club_ok(e): return any(any(tok in e[2] for tok in norm(c) if len(tok) > 3) for c in p["clubs"])
    good = [e for e in cands.values() if club_ok(e)]
    if not good:
        toks = set(norm(p["name"]))
        rare = min(toks, key=lambda t: len(by_token.get(t, ())), default=None)
        pool = {e[0]: e for e in by_token.get(rare, ())}
        good = [e for q, e in pool.items() if any(toks <= set(norm(n)) for n in players_wd[q]["names"]) and club_ok(e)]
    tot_min += p["minutesTotal"]
    if len(good) == 1: hit += 1; hit_min += p["minutesTotal"]
    elif len(good) > 1: amb += 1
    else: misses.append((p["minutesTotal"], p["name"], sorted(p["clubs"])))
print(f"players {len(players)} matched {hit} ({hit/len(players):.0%}), ambiguous {amb}, minutes covered {hit_min/tot_min:.0%}")
for m in sorted(misses, reverse=True)[:15]: print("  miss", m)
