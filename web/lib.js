// Pure helpers shared by app.js and the node tests (tests/lib.test.js).
(() => {
  // Must match RATE_MIN_MINUTES in scripts/common.py.
  const RATE_MIN_MINUTES = 450;
  const RATE_SORTS = new Set(["pointsPer90", "pointsPerMillion", "goalsPer90", "contributionsPer90"]);
  const SEASON_PATTERN = /^\d{4}-\d{2}$/;
  const ID_PATTERN = /^\d{1,9}$/;
  const LEAGUE_PATTERN = /^[a-z0-9]{2,12}$/;
  const HASH_KEYS = { mode: "mode", league: "liga", season: "season", search: "q", club: "club", position: "pos", sort: "sort", player: "player", compare: "cmp" };
  // Letters NFD does not decompose into base + accent.
  const SPECIAL_LETTERS = { "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };

  const normalizeText = (value) => String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[øæœßłđðþı]/g, (char) => SPECIAL_LETTERS[char])
    .replace(/\s+/g, " ")
    .trim();

  const isRateSort = (sort) => RATE_SORTS.has(sort);

  function parseHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    const state = {};
    for (const [key, param] of Object.entries(HASH_KEYS)) {
      if (params.has(param)) state[key] = params.get(param);
    }
    // The hash comes from shared links: anything that is not a well-formed season or numeric id is dropped.
    if (state.season && !SEASON_PATTERN.test(state.season)) delete state.season;
    if (state.player && !ID_PATTERN.test(state.player)) delete state.player;
    if (state.league && !LEAGUE_PATTERN.test(state.league)) delete state.league;
    // Compare entries are "season~uid", or "league:season~uid" when they come from another league.
    state.compare = state.compare ? state.compare.split(",").filter(Boolean).map((entry) => {
      const [scope, uid] = entry.split("~");
      const [league, season] = (scope || "").includes(":") ? scope.split(":") : [undefined, scope];
      return league ? { league, season, uid } : { season, uid };
    }).filter((entry) => SEASON_PATTERN.test(entry.season || "") && ID_PATTERN.test(entry.uid || "") && (entry.league === undefined || LEAGUE_PATTERN.test(entry.league))) : [];
    return state;
  }

  const compareKey = (entry) => `${entry.league ? `${entry.league}:` : ""}${entry.season}~${entry.uid}`;

  // Only values that differ from `defaults` are written, so plain links stay short.
  function serializeHash(state, defaults = {}) {
    const params = new URLSearchParams();
    for (const [key, param] of Object.entries(HASH_KEYS)) {
      let value = state[key];
      if (key === "compare") value = (value || []).map(compareKey).join(",");
      if (value === undefined || value === null || value === "" || value === defaults[key]) continue;
      params.set(param, value);
    }
    const serialized = params.toString();
    return serialized ? `#${serialized}` : "";
  }

  // Round tick steps (1, 2, 5 × 10^n) covering [min, max].
  function niceTicks(min, max, count = 5) {
    if (!(max > min)) return [min];
    const rough = (max - min) / Math.max(1, count);
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough);
    const ticks = [];
    for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toFixed(10)));
    return ticks;
  }

  const shortcutLabel = (platform) => (/mac|iphone|ipad|ipod/i.test(String(platform || "")) ? "⌘ K" : "Ctrl K");
  const photoUrl = (code) => (code ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png` : "");

  globalThis.FPLLib = { RATE_MIN_MINUTES, compareKey, normalizeText, isRateSort, parseHash, serializeHash, niceTicks, shortcutLabel, photoUrl };
})();
