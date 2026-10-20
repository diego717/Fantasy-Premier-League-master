[![GitSpo Mentions](https://gitspo.com/badges/mentions/vaastav/Fantasy-Premier-League?style=flat-square)](https://gitspo.com/mentions/vaastav/Fantasy-Premier-League)

Fantasy-Premier-League
======================

A FPL library that gets all the basic stats for each player, gw-specific data for each player and season history of each player

### Acknowledgement

+ speeder1987 for providing 2018/19 fixtures.csv file
+ ravgeetdhillon for github actions automation for data update

## FAQ

### Data Structure

The data folder contains the data from past seasons as well as the current season. It is structured as follows:

+ season/cleaned_players.csv : The overview stats for the season
+ season/gws/gw_number.csv : GW-specific stats for the particular season
+ season/gws/merged_gws.csv : GW-by-GW stats for each player in a single file
+ season/players/player_name/gws.csv : GW-by-GW stats for that specific player
+ season/players/player_name/history.csv : Prior seasons history stats for that specific player.

### Player Position Data

In players_raw.csv, element_type is the field that corresponds to the position.
1 = GK
2 = DEF
3 = MID
4 = FWD

### Contributing

+ If you feel like there is some data that is missing which you would like to see, then please feel free to create a PR or create an issue highlighting what is missing and what you would like to be added
+ If you have access to old data (pre-2016) then please feel free to create Pull Requests adding the data to the repo or create an issue with links to old data and I will add them myself.

### Using

If you use data from here for your website or blog posts, then I would humbly request that you please add a link back to this repo as the data source (and I would in turn add a link to your post/site as a notable usage of this repo).

## Interactive dashboard

The repository includes a local, dependency-free web explorer in `web/`. It covers FPL seasons 2016-17 through 2026-27 and the Premier League archive (`data/pl/`) from 2009-10 through 2026-27, and provides:

- an `FPL / PL` switch: FPL uses fantasy points, price and ICT; PL uses goals, assists, appearances, minutes, xG and xA;
- season switching, accent-insensitive player search (`odegaard` finds Ødegaard), club and position filters, and a "load more" list;
- value metrics: points per £m and points per 90' (FPL), goals and goal contributions per 90' (PL). Rates only rank players with 450+ minutes;
- a scatter per season: price vs points (FPL), goals vs xG (PL), or shots vs goals for seasons without xG;
- a player drawer with a season-by-season career chart (click a season to jump to it) and, for FPL, a gameweek-by-gameweek chart;
- a comparator for up to three players, even from different seasons;
- shareable URLs: mode, season, filters, the open player and the comparator live in the URL hash, and the browser back button works;
- keyboard support (rows open with Enter, the drawer traps focus and returns it on close, `Ctrl K` / `⌘ K` focuses the search), responsive layout and reduced-motion support.

The 2026-27 data is a current-season snapshot and is labeled `EN CURSO` in the interface.

### Running it

The page loads its data with `fetch`, so it has to be served over HTTP (opening `index.html` directly shows a warning):

```powershell
.\.venv\Scripts\python.exe -m http.server 8765 --directory web
```

Then open `http://localhost:8765`.

### Rebuilding the data

Everything the page reads lives in `web/data/`, split so the browser only downloads what it shows (about 500 KB uncompressed on first load, code included):

| File | Contents |
| --- | --- |
| `fpl/index.json`, `pl/index.json` | season summaries, club tables, leaders |
| `fpl/<season>.json`, `pl/<season>.json` | every player of one season |
| `fpl/careers.json`, `pl/careers.json` | each player's season-by-season line, keyed by the stable player code |
| `fpl/gws/<season>.json` | points, minutes, goals and assists per gameweek |
| `fixtures/<season>.json` | the season calendar |

```powershell
.\.venv\Scripts\python.exe scripts\build_all.py                  # rebuild everything
.\.venv\Scripts\python.exe scripts\build_all.py --fetch-current  # refresh 2026-27 from the FPL API first
.\.venv\Scripts\python.exe scripts\build_all.py --skip-fixtures  # offline: keep the fixture files
```

`build_all.py` also downloads the `merged_gw.csv` files for 2019-20 through 2025-26 (plus the final 2019-20 player totals, since the local snapshot stopped at gameweek 29) from this repository's upstream when they are missing (`scripts/download_archive_gws.py`). The post-2020-pause events 39-47 are shown as gameweeks 30-38, as the game did. The current season comes from two scripts: `scripts/fetch_current_season.py` (FPL: `bootstrap-static` and one `event/<gw>/live/` request per gameweek) and `scripts/fetch_current_pl.py` (PL archive: the premierleague.com stats leaderboard, one request per club so each player keeps the club he played for). The current season name is `CURRENT_SEASON` in `scripts/common.py`.

Two source quirks are handled by the builders: the PL archive repeats a loaned or transferred player's full season under every club he was registered with (the row is merged and the FPL club decides when available; the others appear as "también …"), and club names are normalized across sources and seasons (`A Villa` → `Aston Villa`, `Ipswich Town` → `Ipswich`, …).

### Tests

```powershell
.\.venv\Scripts\python.exe -m unittest discover tests   # builder helpers + checks on web/data
node --test tests\lib.test.js                               # search, URL state and chart helpers
```

The `Fetch Data` GitHub Action runs `build_all.py --fetch-current` and the Python tests twice a week during the season and commits the result.

## Downloading Your Team Data

You can download the data for your team by executing the following steps:

```
python teams_scraper.py <team_id>
#Eg: python teams_scraper.py 4582
```

This will create a new folder called "team_<team_id>_data18-19" with individual files of all the important data (ignored by git).

## Notable Usages of this Repository

+ [xA vs xG for Attacking Midfielders/Forwards by u/JLane1996](https://www.reddit.com/r/FantasyPL/comments/erfdy1/a_plot_of_xg_vs_xa_for_for_attacking_midsforwards/)

+ [Expected Goals vs Actual Goals for Manchester United by u/JLane1996](https://www.reddit.com/r/reddevils/comments/ecbn9j/corrected_plot_of_goals_vs_expected_goals_this/fba8vs3/)

+ [Tableau Viz by u/richkelana](https://www.reddit.com/r/tableau/comments/e2j0uq/my_first_tableu_viz_fpl/)

+ [Top Players against GW13 rival by u/LiuSiuMing](https://www.reddit.com/r/FantasyPL/comments/dz04hf/top_players_against_gw13_rival/)

+ [Captaincy Choice GW4 2019-20 post by Matthew Barnfield](https://mbarnfield.github.io/fpl.html)

+ [Building a dataset for Fantasy Premier League analysis by djfinnoy](http://www.didjfin.no/blog/fpl/fantasy-premier-league-data/)

+ [Value in FPL 2019-20 Report by Who Got The Assist?](https://whogottheassist.com/value-in-fpl-2019-20-report/)

+ [Talisman Theory 2018-19 Report by Who Got The Assist?](https://whogottheassist.com/talisman-theory-part-one-2018-19-report/)

+ [Historical Analyses in fplscrapR by Rasmus Chrisentsen](https://twitter.com/fplscrapR)

+ [Linearly Optimising Fantasy Premier League Teams by Joseph O'Connor](https://medium.com/@joseph.m.oconnor.88/linearly-optimising-fantasy-premier-league-teams-3b76e9694877)

+ [How to Win at Fantasy Premier league using Deep learning by Paul Solomon](https://medium.com/@sol.paul/how-to-win-at-fantasy-premier-league-using-data-part-1-forecasting-with-deep-learning-bf121f38643a)

+ [graphql API by u/jeppews](https://api.better-fpl.com/graphql)

+ [FPL modeling and prediction by @alsgregory](https://github.com/alsgregory/Fantasy-Football)

+ [FPL.co.id Talismans by @FPL_COID](http://fpl.co.id/tools/talismans/)

+ [Leicester City Brendan Rodgers Impact Analysis on twitter by @neilswmurrayFPL](https://twitter.com/neilswmurrayFPL/status/1147407501736009728)

+ [Stat Analysis on twitter by @StatOnScout](https://twitter.com/StatOnScout)

+ [Arsenal-Chelsea LinkedIn article by Velko Kamenov](https://www.linkedin.com/pulse/whoever-wins-2019-uefa-europe-league-final-still-ends-velko-kamenov/)

+ [Form vs Fixture Medium article by JinHyunCheong](https://towardsdatascience.com/mythbusting-fantasy-premier-league-form-over-fixtures-eecf9022e834)

+ [Visualization by u/dkattir](https://www.reddit.com/r/dataisbeautiful/comments/9zlx14/points_per_game_vs_predictability_after_12_weeks/)

+ [Visualization by u/Dray11](https://www.reddit.com/r/FantasyPL/comments/9bjwra/created_a_very_crude_and_basic_comparison_chart/)

+ [Visualization website by @antoniaelek](http://fantasy.elek.hr/)

+ [FPL Captain Classifier by Raghunandh GS](https://medium.com/datacomics/building-an-fpl-captain-classifier-cf4ee343ebcc)

+ [My Personal Blog](http://vaastavanand.com/blog/)
