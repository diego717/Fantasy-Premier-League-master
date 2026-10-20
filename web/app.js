(() => {
  const { RATE_MIN_MINUTES, normalizeText, isRateSort, parseHash, serializeHash, niceTicks, shortcutLabel, photoUrl } = window.FPLLib;
  const MODES = ["fpl", "pl"];
  const PAGE_SIZE = 75;
  const COMPARE_LIMIT = 3;

  const state = { mode: "fpl", season: null, search: "", club: "all", position: "all", sort: "points", player: null, compare: [] };
  let active = null; // index entry of the selected season + its players
  let visibleCount = PAGE_SIZE;
  let refreshToken = 0;
  let drawerToken = 0;
  let lastFocus = null;
  let randomFactIndex = -1;
  const randomFactHistory = { pl: [], fpl: [] };
  let fixtureWeek = 1;
  const jsonCache = new Map();

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
  const initials = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const formatNumber = (value) => new Intl.NumberFormat("es-AR").format(value);
  const formatCompact = (value) => new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const playerPhoto = (player) => photoUrl(state.mode === "pl" ? player.id : player.code);
  const careerKey = (player) => String(state.mode === "pl" ? player.id : player.code);
  const uidOf = (player) => String(player.id);

  function loadJSON(path) {
    if (!jsonCache.has(path)) {
      jsonCache.set(path, fetch(`data/${path}`).then((response) => {
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        return response.json();
      }).catch((error) => { jsonCache.delete(path); throw error; }));
    }
    return jsonCache.get(path);
  }

  async function loadSeasonPlayers(mode, season) {
    const payload = await loadJSON(`${mode}/${season}.json`);
    if (!payload._indexed) {
      payload.players.forEach((player) => {
        player._search = normalizeText(`${player.name} ${player.shortName} ${player.club} ${(player.otherClubs || []).join(" ")}`);
      });
      payload._indexed = true;
    }
    return payload.players;
  }

  function modeConfig(mode = state.mode) {
    if (mode === "pl") {
      return {
        label: "PL",
        kicker: "PL / LECTURA RÁPIDA",
        primary: "goals",
        primaryLabel: "GOLES",
        scoreLabel: "GOLES EN LIGA",
        seasonMetric: "goals",
        seasonMetricLabel: "GOLES TOTALES",
        leaderKicker: "TOP GOLEADOR",
        clubIntro: "Goles acumulados por jugador en la temporada seleccionada.",
        signalKicker: "CONTRIBUCIÓN OFENSIVA",
        sortOptions: [["goals", "Goles"], ["assists", "Asistencias"], ["appearances", "Apariciones"], ["minutes", "Minutos"], ["expectedGoals", "xG"], ["expectedAssists", "xA"], ["goalsPer90", "Goles / 90'"], ["contributionsPer90", "G+A / 90'"]],
        defaultSort: "goals",
        compareMetrics: [["goals", "Goles"], ["assists", "Asistencias"], ["appearances", "Apariciones"], ["minutes", "Minutos"], ["expectedGoals", "xG"], ["expectedAssists", "xA"], ["shots", "Tiros"], ["goalsPer90", "Goles / 90'"], ["contributionsPer90", "G+A / 90'"], ["passes", "Pases"], ["tackles", "Entradas"]],
      };
    }
    return {
      label: "FPL",
      kicker: "FPL / LECTURA RÁPIDA",
      primary: "points",
      primaryLabel: "PUNTOS",
      scoreLabel: "PUNTOS TOTALES",
      seasonMetric: "points",
      seasonMetricLabel: "PUNTOS TOTALES",
      leaderKicker: "TOP PERFORMER",
      clubIntro: "Puntos FPL acumulados por jugador en la temporada seleccionada.",
      signalKicker: "SEÑAL DE ATAQUE",
      sortOptions: [["points", "Puntos"], ["goals", "Goles"], ["assists", "Asistencias"], ["ppg", "Puntos / partido"], ["pointsPerMillion", "Puntos / £m"], ["pointsPer90", "Puntos / 90'"], ["minutes", "Minutos"], ["ict", "Índice ICT"]],
      defaultSort: "points",
      compareMetrics: [["points", "Puntos"], ["ppg", "Puntos / partido"], ["pointsPerMillion", "Puntos / £m"], ["pointsPer90", "Puntos / 90'"], ["goals", "Goles"], ["assists", "Asistencias"], ["minutes", "Minutos"], ["bonus", "Bonus"], ["cleanSheets", "Vallas invictas"], ["ict", "Índice ICT"], ["price", "Precio (£m)", false], ["selected", "Elegido por (%)", false]],
    };
  }

  // ---------------------------------------------------------------- URL state

  const defaultSeason = (index) => index.seasons.filter((season) => season.status === "final").at(-1)?.season || index.seasons.at(-1).season;

  function hashDefaults() {
    return { mode: "fpl", season: active ? defaultSeason(active.index) : null, search: "", club: "all", position: "all", sort: modeConfig().defaultSort };
  }

  function syncHash(push = false) {
    const hash = serializeHash(state, hashDefaults());
    if (hash === location.hash || (!hash && !location.hash)) return;
    history[push ? "pushState" : "replaceState"](null, "", hash || `${location.pathname}${location.search}`);
  }

  function applyHash() {
    const parsed = parseHash(location.hash);
    state.mode = MODES.includes(parsed.mode) ? parsed.mode : "fpl";
    state.season = parsed.season || null;
    state.search = parsed.search || "";
    state.club = parsed.club || "all";
    state.position = ["GK", "DEF", "MID", "FWD"].includes(parsed.position) ? parsed.position : "all";
    state.sort = modeConfig().sortOptions.some(([value]) => value === parsed.sort) ? parsed.sort : modeConfig().defaultSort;
    state.player = parsed.player || null;
    state.compare = parsed.compare.slice(0, COMPARE_LIMIT);
    visibleCount = PAGE_SIZE;
  }

  // ---------------------------------------------------------------- loading

  async function refresh({ focus = false } = {}) {
    const token = ++refreshToken;
    document.body.classList.add("is-loading");
    try {
      const index = await loadJSON(`${state.mode}/index.json`);
      if (!index.seasons.some((season) => season.season === state.season)) state.season = defaultSeason(index);
      const players = await loadSeasonPlayers(state.mode, state.season);
      if (token !== refreshToken) return;
      active = { ...index.seasons.find((season) => season.season === state.season), index, players };
      $("#load-error").hidden = true;
    } catch (error) {
      if (token === refreshToken) showLoadError(error);
      return;
    } finally {
      if (token === refreshToken) document.body.classList.remove("is-loading");
    }

    $("#mode-switch").querySelectorAll(".mode-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    });
    $("#search-input").value = state.search;
    $("#position-select").value = state.position;
    renderSortOptions();
    renderSeasonTabs();
    renderClubOptions();
    renderDashboard();
    renderPlayers();
    renderCompareTray();
    if (state.player) openDrawer(state.player, { push: false });
    else if ($("#player-drawer").classList.contains("open")) closeDrawer({ push: false });
    if (focus) focusSummary();
  }

  function showLoadError(error) {
    console.error(error);
    const panel = $("#load-error");
    panel.hidden = false;
    $("#load-error-detail").textContent = location.protocol === "file:"
      ? "El navegador bloquea la carga de datos al abrir el archivo directamente. Serví la carpeta web con un servidor local:"
      : `No pudimos leer ${error.message}. Regenerá los datos y recargá la página:`;
  }

  // ---------------------------------------------------------------- controls

  function renderSortOptions() {
    const config = modeConfig();
    $("#sort-select").innerHTML = config.sortOptions.map(([value, label]) => `<option value="${value}" ${value === state.sort ? "selected" : ""}>${label}</option>`).join("");
  }

  async function setMode(mode) {
    if (!MODES.includes(mode) || mode === state.mode) return;
    state.mode = mode;
    state.club = "all";
    state.position = "all";
    state.search = "";
    state.sort = modeConfig().defaultSort;
    state.player = null;
    state.compare = [];
    visibleCount = PAGE_SIZE;
    await refresh({ focus: true });
    syncHash(true);
  }

  function renderSeasonTabs() {
    const seasons = active.index.seasons;
    $("#season-tabs").innerHTML = seasons.map((season) => `<button class="season-tab ${season.season === state.season ? "active" : ""}" data-season="${season.season}" type="button" aria-pressed="${season.season === state.season}">${season.season.replace("-", " / ")}${season.status === "current" ? " <small>EN CURSO</small>" : ""}</button>`).join("");
    $("#season-select").innerHTML = seasons.map((season) => `<option value="${season.season}" ${season.season === state.season ? "selected" : ""}>${season.season}${season.status === "current" ? " · En curso" : ""}</option>`).join("");
  }

  async function setSeason(season, { focus = false, player = null } = {}) {
    state.season = season;
    state.club = "all";
    state.player = player;
    visibleCount = PAGE_SIZE;
    await refresh({ focus });
    syncHash(true);
  }

  function focusSummary() {
    const summary = $("#stats-grid");
    if (!summary) return;
    summary.classList.remove("data-refreshed");
    requestAnimationFrame(() => {
      summary.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      summary.classList.add("data-refreshed");
      window.setTimeout(() => summary.classList.remove("data-refreshed"), 900);
    });
  }

  // ---------------------------------------------------------------- dashboard

  function renderDashboard() {
    const season = active;
    const stats = season.stats;
    const config = modeConfig();
    const seasons = active.index.seasons;
    const statCards = state.mode === "pl"
      ? [["GOLES EN LA LIGA", formatNumber(stats.goals), `${formatNumber(stats.assists)} asistencias`], ["ASISTENCIAS", formatNumber(stats.assists), `${formatNumber(stats.appearances)} apariciones`], ["MINUTOS JUGADOS", formatCompact(stats.minutes), `${stats.clubs} clubes representados`], ["PROMEDIO DE GOLES", stats.avgGoals, `líder: ${season.leaders[0]?.shortName ?? "—"}`]]
      : [["PUNTOS REGISTRADOS", formatCompact(stats.points), `${stats.players} futbolistas con datos`], ["GOLES EN EL ARCHIVO", formatNumber(stats.goals), `${formatNumber(stats.assists)} asistencias`], ["MINUTOS JUGADOS", formatCompact(stats.minutes), `${stats.clubs} clubes representados`], ["PROMEDIO POR JUGADOR", stats.avgPoints, `líder: ${season.leaders[0]?.shortName ?? "—"}`]];
    $("#stats-grid").innerHTML = statCards.map(([label, value, context], index) => `<article class="stat-card reveal" style="--delay:${index * 70}ms"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><p class="stat-context">${esc(context)}</p></article>`).join("");
    $("#row-count").textContent = `${formatNumber(seasons.reduce((sum, item) => sum + item.stats.players, 0))} perfiles`;
    $("#hero-season-count").textContent = seasons.length;
    $("#season-range").textContent = `${seasons[0].season} → ${seasons.at(-1).season}`;
    $("#season-range-badge").textContent = `${seasons[0].season.slice(0, 4)}—${seasons.at(-1).season.slice(-2)}`;
    $("#mode-kicker").innerHTML = `<span class="eyebrow-line"></span> ${config.kicker}`;
    $("#pulse-kicker").textContent = state.mode === "pl" ? "PULSO DE LA LIGA" : "PULSO HISTÓRICO";
    $("#leader-kicker").textContent = config.leaderKicker;
    $("#explorer-kicker").innerHTML = `<span class="eyebrow-line"></span> 03 / ${config.label} EXPLORADOR`;
    $("#season-metric-label").textContent = config.seasonMetricLabel;
    $("#club-intro").textContent = config.clubIntro;
    renderSeasonStories();
    renderRandomFact();
    renderFixture();
    $("#strip-caption").textContent = season.status === "current"
      ? `Corte en curso · ${season.stats.leader} lidera con ${formatNumber(season.leaders[0]?.[config.primary] ?? 0)} ${config.primaryLabel.toLowerCase()}.`
      : `${season.stats.leader} lideró el tablero con ${formatNumber(season.leaders[0]?.[config.primary] ?? 0)} ${config.primaryLabel.toLowerCase()}.`;
    $("#club-season-badge").textContent = season.status === "current" ? `${season.season} · EN CURSO` : season.season;
    renderSeasonBars();
    renderFeatured();
    renderScatter();
  }

  function renderSeasonBars() {
    const config = modeConfig();
    const seasons = active.index.seasons;
    const max = Math.max(...seasons.map((item) => item.stats[config.seasonMetric]), 1);
    $("#season-bars").innerHTML = seasons.map((item) => {
      const value = item.stats[config.seasonMetric];
      const height = Math.max(12, Math.round((value / max) * 100));
      return `<div class="season-column ${item.season === state.season ? "is-active" : ""}" title="${item.season}: ${formatNumber(value)} ${config.seasonMetricLabel.toLowerCase()}"><div class="bar" style="--bar-height:${height}%" data-value="${formatCompact(value)}"></div><span>${item.season.slice(2, 4)}<i class="season-end">${item.season.slice(4)}</i></span></div>`;
    }).join("");
  }

  function renderSeasonStories() {
    const season = active;
    const config = modeConfig();
    const story = state.mode === "pl" ? window.SEASON_STORIES?.[state.season] : window.FPL_STORIES?.[state.season];
    const archiveLeader = active.index.archiveLeader;
    const seasonGoals = season.topGoals;
    const seasonAssists = season.topAssists;
    const cards = [
      story || {
        eyebrow: "LECTURA DEL ARCHIVO",
        title: `${formatNumber(season.stats[config.seasonMetric])} ${config.seasonMetricLabel.toLowerCase()}`,
        body: `La temporada quedó encabezada por ${season.stats.leader}, con ${formatNumber(season.leaders[0]?.[config.primary] ?? 0)} ${config.primaryLabel.toLowerCase()}.`,
      },
      {
        eyebrow: `RÉCORD ${config.label}`,
        title: `${archiveLeader?.shortName ?? "—"} · ${formatNumber(archiveLeader?.[config.primary] ?? 0)} ${config.primaryLabel.toLowerCase()}`,
        body: `${archiveLeader?.club ?? "—"} (${archiveLeader?.season ?? "—"}) sostiene el mejor registro individual del archivo ${config.label} disponible en esta vista.`,
      },
      {
        eyebrow: "LECTURA RÁPIDA",
        title: state.mode === "pl"
          ? `${seasonGoals?.shortName ?? "—"} goleó · ${formatNumber(seasonGoals?.goals ?? 0)}`
          : `${seasonAssists?.shortName ?? "—"} asistió · ${formatNumber(seasonAssists?.assists ?? 0)}`,
        body: state.mode === "pl"
          ? `El máximo anotador de ${state.season} fue ${seasonGoals?.name ?? "—"}; ${seasonAssists?.shortName ?? "—"} lideró las asistencias con ${formatNumber(seasonAssists?.assists ?? 0)}.`
          : `El líder de asistencias fue ${seasonAssists?.name ?? "—"}, mientras que ${seasonGoals?.shortName ?? "—"} terminó como máximo goleador con ${formatNumber(seasonGoals?.goals ?? 0)}.`,
      },
    ];
    $("#stories-badge").textContent = state.mode === "pl" ? "PL" : "FPL";
    $("#stories-title").textContent = state.mode === "pl" ? "Lo que dejó la liga" : "Lo que dejó el fantasy";
    $("#season-stories").innerHTML = cards.map((card) => `<article class="season-story"><span class="story-eyebrow">${esc(card.eyebrow)}</span><strong>${esc(card.title)}</strong><p>${esc(card.body)}</p>${card.source ? `<a href="${esc(card.source)}" target="_blank" rel="noreferrer">FUENTE OFICIAL <span>↗</span></a>` : ""}</article>`).join("");
  }

  function renderRandomFact() {
    const facts = window.RANDOM_FACTS?.[state.mode] || [];
    if (!facts.length || !$("#random-fact")) return;
    const history = randomFactHistory[state.mode];
    let available = facts.map((_, index) => index).filter((index) => !history.includes(index));
    if (!available.length) {
      history.length = 0;
      available = facts.map((_, index) => index);
    }
    randomFactIndex = available[Math.floor(Math.random() * available.length)];
    history.push(randomFactIndex);
    const fact = facts[randomFactIndex];
    $("#random-fact-kicker").textContent = fact.eyebrow;
    $("#random-fact-title").textContent = fact.title;
    $("#random-fact-body").textContent = fact.body;
    $("#random-fact-source").href = fact.source;
    $("#random-fact").classList.remove("fact-refreshed");
    requestAnimationFrame(() => {
      $("#random-fact").classList.add("fact-refreshed");
      window.setTimeout(() => $("#random-fact").classList.remove("fact-refreshed"), 520);
    });
  }

  async function renderFixture() {
    const season = state.season;
    const officialUrl = `https://www.premierleague.com/en/matches/premier-league/${encodeURIComponent(season)}/matchweek-1`;
    const fixtureData = await loadJSON(`fixtures/${season}.json`).catch(() => null);
    if (season !== state.season) return;
    const availableWeeks = fixtureData ? [...new Set(fixtureData.matches.map((match) => match.event))].sort((a, b) => a - b) : [];
    fixtureWeek = availableWeeks.includes(fixtureWeek) ? fixtureWeek : (availableWeeks[0] || 1);
    $("#fixture-badge").textContent = fixtureData ? `${availableWeeks.length} MW` : "LINK";
    $("#fixture-intro").textContent = fixtureData
      ? (active.status === "current" ? "Calendario cargado · fechas sujetas a cambios." : "Calendario cargado · resultados y horarios de la temporada.")
      : "Todavía no hay datos locales para esta temporada; podés abrir el calendario oficial.";
    $("#fixture-official-link").href = officialUrl;
    $("#fixture-source-link").href = window.FIXTURE_SOURCES?.[season] || officialUrl;
    $("#fixture-week-select").innerHTML = availableWeeks.length
      ? availableWeeks.map((week) => `<option value="${week}" ${week === fixtureWeek ? "selected" : ""}>Jornada ${String(week).padStart(2, "0")}</option>`).join("")
      : `<option>Calendario externo</option>`;
    const matches = fixtureData?.matches.filter((match) => match.event === fixtureWeek) || [];
    $("#fixture-matches").innerHTML = matches.length
      ? matches.map((match) => {
        const home = fixtureData.teams[String(match.home)] || { name: "Local", short: "LOC" };
        const away = fixtureData.teams[String(match.away)] || { name: "Visitante", short: "VIS" };
        const kickoff = match.kickoff ? new Date(match.kickoff) : null;
        const dateLabel = kickoff && !Number.isNaN(kickoff.getTime())
          ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(kickoff).replace(".", "")
          : "Fecha por confirmar";
        const score = match.finished && match.homeScore !== null && match.awayScore !== null ? `${match.homeScore} — ${match.awayScore}` : "—";
        return `<article class="fixture-match"><div class="fixture-match-meta"><span>${esc(dateLabel)}</span><span>${match.finished ? "FINAL" : "PROGRAMADO"}</span></div><div class="fixture-teams"><span title="${esc(home.name)}">${esc(home.short)}</span><strong>${score}</strong><span title="${esc(away.name)}">${esc(away.short)}</span></div></article>`;
      }).join("")
      : `<div class="fixture-empty">Para esta temporada todavía no tenemos el detalle descargado. Usá el enlace oficial para abrirlo.</div>`;
  }

  function renderFeatured() {
    const config = modeConfig();
    const leader = active.leaders[0];
    if (!leader) return;
    const meta = state.mode === "pl"
      ? `${leader.club} · ${leader.position} · ${formatNumber(leader.assists)} asistencias`
      : `${leader.club} · ${leader.position} · ${formatNumber(leader.goals)} goles`;
    $("#leader-name").textContent = leader.shortName;
    $("#featured-body").innerHTML = `<div class="featured-copy"><strong class="featured-stat">${formatNumber(leader[config.primary])}</strong><span class="featured-label">${config.scoreLabel}</span><p class="featured-meta">${esc(meta)}</p><button class="featured-open" type="button" data-open-player="${uidOf(leader)}">VER PERFIL <span>↗</span></button></div><img class="featured-photo" src="${esc(playerPhoto(leader))}" alt="${esc(leader.name)}" loading="lazy" data-fallback="hide">`;
  }

  // ---------------------------------------------------------------- scatter

  function scatterConfig() {
    if (state.mode === "fpl") {
      return {
        kicker: "VALOR FPL", title: "Precio contra puntos", badge: `${state.season} · 900'+`,
        intro: "Cada punto es un jugador con al menos 900 minutos. Arriba y a la izquierda están los que más puntos dieron por cada millón invertido.",
        x: "price", y: "points", xLabel: "PRECIO FINAL (£M)", yLabel: "PUNTOS",
        include: (player) => player.minutes >= 900 && player.price > 0,
        groups: [{ key: "top", label: "Mejor puntos / £m", rank: (player) => player.pointsPerMillion, count: 6, describe: (player) => `${formatNumber(player.pointsPerMillion)} pts/£m` }],
      };
    }
    const hasXg = active.stats.expectedGoals > 0;
    if (!hasXg) {
      return {
        kicker: "FINALIZACIÓN", title: "Tiros contra goles", badge: `${state.season} · SIN xG`,
        intro: "La fuente no publica xG para esta temporada, así que comparamos tiros totales contra goles. Destacados: la mejor conversión con 20 tiros o más.",
        x: "shots", y: "goals", xLabel: "TIROS", yLabel: "GOLES",
        include: (player) => player.shots >= 10,
        groups: [{ key: "top", label: "Mejor conversión", rank: (player) => (player.shots >= 20 ? player.goals / player.shots : -1), count: 6, describe: (player) => `${formatNumber(Math.round((player.goals / player.shots) * 100))}% de conversión` }],
      };
    }
    return {
      kicker: "FINALIZACIÓN", title: "Goles contra xG", badge: `${state.season} · xG 1+`,
      intro: "La diagonal marca goles = xG. Por encima, jugadores que convirtieron más de lo esperado; por debajo, los que dejaron goles en el camino.",
      x: "expectedGoals", y: "goals", xLabel: "GOLES ESPERADOS (xG)", yLabel: "GOLES", diagonal: true,
      include: (player) => player.expectedGoals >= 1 || player.goals >= 3,
      groups: [
        { key: "top", label: "Por encima del xG", rank: (player) => player.goals - player.expectedGoals, count: 4, describe: (player) => `+${formatNumber(Number((player.goals - player.expectedGoals).toFixed(1)))} vs xG` },
        { key: "low", label: "Por debajo del xG", rank: (player) => player.expectedGoals - player.goals, count: 4, describe: (player) => `−${formatNumber(Number((player.expectedGoals - player.goals).toFixed(1)))} vs xG` },
      ],
    };
  }

  let scatterPoints = [];
  let scatterWidth = 720;

  function renderScatter() {
    const config = scatterConfig();
    const players = active.players.filter(config.include);
    const highlighted = new Map();
    config.groups.forEach((group) => {
      [...players].filter((player) => group.rank(player) > 0).sort((a, b) => group.rank(b) - group.rank(a)).slice(0, group.count)
        .forEach((player) => { if (!highlighted.has(uidOf(player))) highlighted.set(uidOf(player), group); });
    });

    $("#scatter-kicker").textContent = config.kicker;
    $("#scatter-title").textContent = config.title;
    $("#scatter-badge").textContent = config.badge;
    $("#scatter-intro").textContent = config.intro;

    const chart = $("#scatter-chart");
    if (players.length < 3) {
      scatterPoints = [];
      chart.innerHTML = `<div class="fixture-empty">No hay suficientes jugadores para dibujar esta temporada.</div>`;
      $("#scatter-legend").innerHTML = "";
      $("#scatter-list").innerHTML = "";
      return;
    }

    // Drawn at the container's real width so text stays at its CSS size on phones.
    const width = Math.round(Math.max(300, chart.clientWidth || 720));
    const height = width < 520 ? Math.round(width * 0.82) : 380;
    const margin = { top: 18, right: 18, bottom: 46, left: width < 520 ? 40 : 52 };
    scatterWidth = width;
    const xValues = players.map((player) => player[config.x]);
    const yValues = players.map((player) => player[config.y]);
    const xMin = config.diagonal ? 0 : Math.floor(Math.min(...xValues));
    const xMaxRaw = Math.max(...xValues);
    const yMaxRaw = Math.max(...yValues);
    const sharedMax = config.diagonal ? Math.max(xMaxRaw, yMaxRaw) : null;
    const xTicks = niceTicks(xMin, sharedMax ?? xMaxRaw, 6);
    const yTicks = niceTicks(0, sharedMax ?? yMaxRaw, 5);
    const xMax = Math.max(xTicks.at(-1), xMaxRaw);
    const yMax = Math.max(yTicks.at(-1), yMaxRaw);
    const sx = (value) => margin.left + ((value - xMin) / (xMax - xMin || 1)) * (width - margin.left - margin.right);
    const sy = (value) => height - margin.bottom - (value / (yMax || 1)) * (height - margin.top - margin.bottom);

    scatterPoints = players.map((player) => ({ player, x: sx(player[config.x]), y: sy(player[config.y]), group: highlighted.get(uidOf(player)) }));
    const background = scatterPoints.filter((point) => !point.group);
    const front = scatterPoints.filter((point) => point.group);
    const grid = yTicks.map((tick) => `<line class="scatter-grid" x1="${margin.left}" x2="${width - margin.right}" y1="${sy(tick)}" y2="${sy(tick)}"></line><text class="scatter-tick" x="${margin.left - 8}" y="${sy(tick) + 4}" text-anchor="end">${formatNumber(tick)}</text>`).join("")
      + xTicks.map((tick) => `<text class="scatter-tick" x="${sx(tick)}" y="${height - margin.bottom + 18}" text-anchor="middle">${formatNumber(tick)}</text>`).join("");
    const diagonalLimit = Math.min(xMax, yMax);
    const diagonal = config.diagonal ? `<line class="scatter-diagonal" x1="${sx(0)}" y1="${sy(0)}" x2="${sx(diagonalLimit)}" y2="${sy(diagonalLimit)}"></line><text class="scatter-note" x="${sx(diagonalLimit) - 6}" y="${sy(diagonalLimit) + 14}" text-anchor="end">GOLES = xG</text>` : "";
    const marks = background.map((point) => `<circle class="scatter-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.5"></circle>`).join("")
      + front.map((point) => `<circle class="scatter-dot scatter-dot-${point.group.key}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5.5" data-uid="${uidOf(point.player)}"></circle>`).join("");
    // Greedy placement: right, left, above, below; a label that fits nowhere is
    // dropped (the player is still in the side list and in the tooltip).
    const placed = front.map((point) => ({ x0: point.x - 6, x1: point.x + 6, y0: point.y - 6, y1: point.y + 6 }));
    const overlaps = (box) => placed.some((other) => other.x0 < box.x1 && box.x0 < other.x1 && other.y0 < box.y1 && box.y0 < other.y1);
    const labels = [...front].sort((a, b) => a.y - b.y).map((point) => {
      const text = point.player.shortName;
      const textWidth = text.length * 6.4 + 4;
      const candidates = [[9, 4, "start"], [-9, 4, "end"], [0, -11, "middle"], [0, 19, "middle"]];
      for (const [dx, dy, anchor] of candidates) {
        const x0 = anchor === "start" ? point.x + dx : anchor === "end" ? point.x + dx - textWidth : point.x - textWidth / 2;
        const box = { x0, x1: x0 + textWidth, y0: point.y + dy - 12, y1: point.y + dy + 3 };
        if (box.x0 < margin.left || box.x1 > width || box.y0 < 0 || box.y1 > height - margin.bottom || overlaps(box)) continue;
        placed.push(box);
        return `<text class="scatter-label" x="${(point.x + dx).toFixed(1)}" y="${(point.y + dy).toFixed(1)}" text-anchor="${anchor}">${esc(text)}</text>`;
      }
      return "";
    }).join("");

    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(config.title)}: ${players.length} jugadores. Los destacados están listados al costado.">
      <line class="scatter-axis" x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}"></line>
      ${grid}${diagonal}${marks}${labels}
      <circle class="scatter-hover" r="8" cx="0" cy="0" visibility="hidden"></circle>
      <text class="scatter-axis-label" x="${width - margin.right}" y="${height - 8}" text-anchor="end">${config.xLabel} →</text>
      <text class="scatter-axis-label" x="12" y="${margin.top}" transform="rotate(-90 12 ${margin.top})" text-anchor="end">${config.yLabel} →</text>
    </svg><div class="chart-tooltip" id="scatter-tooltip" hidden></div>`;

    $("#scatter-legend").innerHTML = config.groups.map((group) => `<span class="legend-item"><i class="legend-mark legend-mark-${group.key}"></i>${esc(group.label)}</span>`).join("")
      + `<span class="legend-item"><i class="legend-mark"></i>Resto (${formatNumber(background.length)})</span>`;
    $("#scatter-list").innerHTML = front
      .sort((a, b) => (config.groups.indexOf(a.group) - config.groups.indexOf(b.group)) || (b.group.rank(b.player) - a.group.rank(a.player)))
      .map((point) => `<li><button type="button" class="scatter-pick" data-open-player="${uidOf(point.player)}" data-uid="${uidOf(point.player)}"><i class="legend-mark legend-mark-${point.group.key}"></i><span><strong>${esc(point.player.name)}</strong><small>${esc(point.player.club)} · ${formatNumber(point.player[config.y])} ${config.yLabel.toLowerCase()} · ${esc(point.group.describe(point.player))}</small></span></button></li>`).join("");
  }

  function nearestScatterPoint(event) {
    const svg = $("#scatter-chart svg");
    if (!svg || !scatterPoints.length) return null;
    const rect = svg.getBoundingClientRect();
    const scale = scatterWidth / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    let best = null;
    let bestDistance = (24 * scale) ** 2;
    for (const point of scatterPoints) {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < bestDistance) { best = point; bestDistance = distance; }
    }
    return best;
  }

  function showScatterTooltip(point) {
    const tooltip = $("#scatter-tooltip");
    const hover = $("#scatter-chart .scatter-hover");
    if (!tooltip || !hover) return;
    if (!point) {
      tooltip.hidden = true;
      hover.setAttribute("visibility", "hidden");
      $("#scatter-chart").style.cursor = "";
      return;
    }
    const config = scatterConfig();
    const svg = $("#scatter-chart svg");
    const scale = svg.getBoundingClientRect().width / scatterWidth;
    hover.setAttribute("cx", point.x);
    hover.setAttribute("cy", point.y);
    hover.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const value = document.createElement("strong");
    value.textContent = `${formatNumber(point.player[config.y])} ${config.yLabel.toLowerCase()}`;
    const name = document.createElement("span");
    name.textContent = `${point.player.name} · ${point.player.club}`;
    const detail = document.createElement("small");
    detail.textContent = `${config.xLabel.toLowerCase()}: ${formatNumber(point.player[config.x])}`;
    tooltip.append(value, name, detail);
    tooltip.hidden = false;
    const left = point.x * scale;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${point.y * scale}px`;
    tooltip.classList.toggle("flip", left > svg.getBoundingClientRect().width / 2);
    $("#scatter-chart").style.cursor = "pointer";
  }

  // ---------------------------------------------------------------- explorer

  let scrollFieldFrame;

  function updateScrollField() {
    const field = $("#scroll-field");
    if (!field || scrollFieldFrame) return;
    scrollFieldFrame = requestAnimationFrame(() => {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const progress = reducedMotion() ? 0 : Math.min(1, Math.max(0, window.scrollY / maxScroll));
      field.style.setProperty("--field-grid-y", `${(-window.scrollY * .08).toFixed(1)}px`);
      field.style.setProperty("--field-orbit-x", `${(progress * 42).toFixed(1)}px`);
      field.style.setProperty("--field-orbit-y", `${(window.scrollY * .1).toFixed(1)}px`);
      field.style.setProperty("--field-rotate", `${(-16 + progress * 18).toFixed(2)}deg`);
      field.style.setProperty("--field-signal-x", `${(-45 + progress * 120).toFixed(1)}px`);
      field.style.setProperty("--field-opacity", (0.72 + progress * .28).toFixed(2));
      scrollFieldFrame = null;
    });
  }

  function renderClubOptions() {
    if (state.club !== "all" && !active.clubs.some((club) => club.club === state.club)) state.club = "all";
    const options = active.clubs.map((club) => club.club).sort((a, b) => a.localeCompare(b, "es")).map((club) => `<option value="${esc(club)}" ${club === state.club ? "selected" : ""}>${esc(club)}</option>`).join("");
    $("#club-select").innerHTML = `<option value="all">Todos los clubes</option>${options}`;
  }

  function filteredPlayers() {
    const query = normalizeText(state.search);
    const rateSort = isRateSort(state.sort);
    return active.players.filter((player) => {
      const matchesSearch = !query || player._search.includes(query);
      const matchesClub = state.club === "all" || player.club === state.club || (player.otherClubs || []).includes(state.club);
      const matchesPosition = state.position === "all" || player.position === state.position;
      const matchesMinutes = !rateSort || player.minutes >= RATE_MIN_MINUTES;
      return matchesSearch && matchesClub && matchesPosition && matchesMinutes;
    }).sort((a, b) => (Number(b[state.sort]) || 0) - (Number(a[state.sort]) || 0));
  }

  function meter(value, max, label) {
    const width = Math.min(100, Math.max(3, (Number(value) / max) * 100));
    return `<div class="meter-line"><span>${label}</span><div class="meter-track"><i style="width:${width}%"></i></div></div>`;
  }

  function avatar(player, className) {
    const photo = playerPhoto(player);
    const fallback = esc(initials(player.name));
    return photo
      ? `<img class="${className}" src="${esc(photo)}" alt="" loading="lazy" data-fallback="initials" data-initials="${fallback}">`
      : `<span class="${className} avatar-fallback">${fallback}</span>`;
  }

  function sortValueLabel(player) {
    const config = modeConfig();
    if (state.sort === config.primary || !config.sortOptions.some(([value]) => value === state.sort)) return [player[config.primary], config.primaryLabel];
    const label = config.sortOptions.find(([value]) => value === state.sort)[1];
    return [player[state.sort], label.toUpperCase()];
  }

  function playerRow(player, index) {
    const subline = state.mode === "pl"
      ? `${formatNumber(player.minutes)} min. · ${formatNumber(player.appearances)} apar. · ${formatNumber(player.assists)} asist.`
      : `${formatNumber(player.minutes)} min. · ${formatNumber(player.goals)} goles · ${formatNumber(player.assists)} asist.`;
    const signals = state.mode === "pl"
      ? `${meter(player.shots, 100, "TIR")}${meter(player.expectedGoals, 30, "xG")}${meter(player.expectedAssists, 20, "xA")}`
      : `${meter(player.threat, 300, "THR")}${meter(player.creativity, 300, "CRE")}${meter(player.ict, 250, "ICT")}`;
    const [value, label] = sortValueLabel(player);
    const otherClubs = player.otherClubs?.length ? `<span class="club-also">también ${esc(player.otherClubs.join(", "))}</span>` : "";
    return `<article class="player-row reveal" style="--delay:${Math.min(index % PAGE_SIZE, 10) * 24}ms" data-uid="${uidOf(player)}" role="button" tabindex="0" aria-label="Ver perfil de ${esc(player.name)}, ${esc(player.club)}">
      <div class="player-identity">${avatar(player, "player-avatar")}<div class="player-copy"><div class="player-name">${esc(player.name)}</div><div class="player-sub">${subline}</div></div></div>
      <div class="player-club"><strong>${esc(player.club)}</strong>${otherClubs}<span class="position-pill">${esc(player.position)}</span></div>
      <div class="player-points"><span>${formatNumber(value)}</span><small>${esc(label)}</small></div>
      <div class="signal-meters" aria-hidden="true">${signals}</div>
      <span class="player-arrow" aria-hidden="true">↗</span>
    </article>`;
  }

  function renderPlayers() {
    const config = modeConfig();
    const players = filteredPlayers();
    const shown = Math.min(players.length, visibleCount);
    const rateNote = isRateSort(state.sort) ? ` · mín. ${RATE_MIN_MINUTES}'` : "";
    $("#result-count").textContent = `${formatNumber(players.length)} perfiles${rateNote}`;
    $("#primary-header").textContent = sortValueLabel(players[0] || {})[1] || config.primaryLabel;
    $("#signal-header").textContent = state.mode === "pl" ? "LECTURAS" : "SEÑALES";
    $("#player-list").innerHTML = players.slice(0, shown).map(playerRow).join("");
    $("#empty-state").hidden = players.length > 0;
    $("#list-more").hidden = players.length === 0;
    $("#list-status").textContent = `Mostrando ${formatNumber(shown)} de ${formatNumber(players.length)}`;
    const remaining = players.length - shown;
    $("#load-more").hidden = remaining <= 0;
    $("#load-more").textContent = `VER ${formatNumber(Math.min(PAGE_SIZE, remaining))} MÁS`;
    renderClubs();
  }

  function renderClubs() {
    const config = modeConfig();
    const clubs = active.clubs;
    const max = clubs[0]?.[config.primary] || 1;
    $("#club-list").innerHTML = clubs.slice(0, 10).map((club, index) => `<button type="button" class="club-row ${club.club === state.club ? "is-active" : ""}" data-club="${esc(club.club)}" aria-pressed="${club.club === state.club}"><span class="club-rank">${String(index + 1).padStart(2, "0")}</span><span><strong class="club-name">${esc(club.club)}</strong><span class="club-meta">${club.players} jugadores · líder ${esc(club.leader)}</span></span><strong class="club-points">${formatNumber(club[config.primary])}</strong><span class="club-bar"><i style="width:${Math.round((club[config.primary] / max) * 100)}%"></i></span></button>`).join("");
  }

  function resetFilters() {
    state.search = "";
    state.club = "all";
    state.position = "all";
    state.sort = modeConfig().defaultSort;
    visibleCount = PAGE_SIZE;
    $("#search-input").value = "";
    $("#position-select").value = "all";
    renderSortOptions();
    renderClubOptions();
    renderPlayers();
    syncHash();
  }

  // ---------------------------------------------------------------- drawer

  const overlays = () => [$(".site-header"), $("main"), $(".site-footer"), $("#compare-tray")];

  function setBackgroundInert(isInert) {
    overlays().forEach((element) => { if (element) element.inert = isInert; });
  }

  function showBackdrop() {
    $("#modal-backdrop").hidden = false;
    requestAnimationFrame(() => $("#modal-backdrop").classList.add("visible"));
    setBackgroundInert(true);
  }

  function hideBackdrop() {
    $("#modal-backdrop").classList.remove("visible");
    setTimeout(() => { if (!document.querySelector(".player-drawer.open, .compare-panel.open")) $("#modal-backdrop").hidden = true; }, 310);
    setBackgroundInert(false);
  }

  function openDrawer(uid, { push = true } = {}) {
    const config = modeConfig();
    const player = active.players.find((item) => uidOf(item) === String(uid));
    if (!player) {
      state.player = null;
      if (push) syncHash();
      return;
    }
    if (push && document.activeElement && !$("#player-drawer").contains(document.activeElement)) lastFocus = document.activeElement;
    if ($("#compare-panel").classList.contains("open")) closeCompare({ restoreFocus: false });
    state.player = uidOf(player);
    if (push) syncHash(true);

    const photo = playerPhoto(player);
    $("#drawer-avatar").innerHTML = photo ? `<img src="${esc(photo)}" alt="${esc(player.name)}" data-fallback="initials" data-initials="${esc(initials(player.name))}">` : `<span>${esc(initials(player.name))}</span>`;
    $("#drawer-season").textContent = active.status === "current" ? `${state.season} · EN CURSO` : state.season;
    $("#drawer-position").textContent = player.position;
    $("#drawer-name").textContent = player.name;
    $("#drawer-club").textContent = player.otherClubs?.length ? `${player.club} · también ${player.otherClubs.join(", ")}` : player.club;
    $("#drawer-score-label").textContent = config.scoreLabel;
    $("#drawer-points").textContent = formatNumber(player[config.primary]);
    const metrics = state.mode === "pl"
      ? [["GOLES", player.goals], ["ASISTENCIAS", player.assists], ["APARICIONES", player.appearances], ["MINUTOS", formatCompact(player.minutes)], ["xG", player.expectedGoals], ["xA", player.expectedAssists], ["GOLES / 90'", player.goalsPer90 || "—"], ["TIROS", player.shots], ["G+A / 90'", player.contributionsPer90 || "—"]]
      : [["GOLES", player.goals], ["ASISTENCIAS", player.assists], ["MINUTOS", formatCompact(player.minutes)], ["PPG", player.ppg], ["BONUS", player.bonus], ["PRECIO", `£${formatNumber(player.price)}m`], ["PTS / £M", player.pointsPerMillion || "—"], ["PTS / 90'", player.pointsPer90 || "—"], ["ELEGIDO", `${formatNumber(player.selected)}%`]];
    $("#drawer-metrics").innerHTML = metrics.map(([label, value]) => `<div class="drawer-metric"><span>${label}</span><strong>${typeof value === "number" ? formatNumber(value) : esc(value)}</strong></div>`).join("");
    $("#drawer-rate-note").textContent = `Los valores por 90' y por £m se calculan desde ${RATE_MIN_MINUTES} minutos jugados.`;
    const attackScore = state.mode === "pl"
      ? Math.round((player.goals * 10) + (player.assists * 6) + (player.expectedGoals * 2) + (player.expectedAssists * 2))
      : Math.round((player.goals * 9) + (player.assists * 5) + (player.threat * .08) + (player.creativity * .06));
    $("#drawer-signal-kicker").textContent = config.signalKicker;
    $("#drawer-signal-label").textContent = attackScore > 90 ? "ALTA" : attackScore > 45 ? "MEDIA" : "EN DESARROLLO";
    $("#signal-value").textContent = `${Math.min(99, attackScore)}%`;
    $("#signal-arc").style.transform = `rotate(${Math.min(140, attackScore * 1.15) - 35}deg)`;
    renderCompareToggle(player);

    const token = ++drawerToken;
    renderCareer(player, token);
    renderGameweeks(player, token);

    const drawer = $("#player-drawer");
    if (!drawer.classList.contains("open")) {
      showBackdrop();
      requestAnimationFrame(() => { drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); });
      drawer.hidden = false;
    }
    drawer.scrollTop = 0;
    $("#drawer-close").focus({ preventScroll: true });
  }

  function closeDrawer({ push = true } = {}) {
    const drawer = $("#player-drawer");
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    hideBackdrop();
    state.player = null;
    if (push) syncHash(true);
    const target = lastFocus?.isConnected ? lastFocus : (lastFocus?.dataset?.uid && $(`.player-row[data-uid="${lastFocus.dataset.uid}"]`));
    if (target) target.focus({ preventScroll: true });
    lastFocus = null;
  }

  async function renderCareer(player, token) {
    const config = modeConfig();
    const container = $("#drawer-career");
    $("#career-kicker").textContent = `TRAYECTORIA · ${config.primaryLabel}`;
    container.innerHTML = `<p class="drawer-empty">Cargando trayectoria…</p>`;
    let careers;
    try {
      careers = await loadJSON(`${state.mode}/careers.json`);
    } catch {
      if (token === drawerToken) container.innerHTML = `<p class="drawer-empty">No pudimos cargar la trayectoria.</p>`;
      return;
    }
    if (token !== drawerToken) return;
    const fields = careers.fields;
    const rows = (careers.players[careerKey(player)] || []).map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
    $("#career-meta").textContent = `${rows.length} ${rows.length === 1 ? "temporada" : "temporadas"} · ${formatNumber(rows.reduce((sum, row) => sum + (row[config.primary] || 0), 0))} total`;
    if (rows.length < 2) {
      container.innerHTML = `<p class="drawer-empty">Es su única temporada en el archivo ${config.label}.</p>`;
      return;
    }
    const max = Math.max(...rows.map((row) => row[config.primary]), 1);
    const best = rows.reduce((top, row) => (row[config.primary] > top[config.primary] ? row : top), rows[0]);
    container.innerHTML = rows.map((row) => {
      const value = row[config.primary];
      const isCurrent = row.season === state.season;
      const showValue = isCurrent || row === best;
      return `<button type="button" class="career-bar ${isCurrent ? "is-active" : ""} ${showValue ? "show-value" : ""}" data-season="${row.season}" data-uid="${row.id}" aria-label="${row.season}, ${esc(row.club)}: ${formatNumber(value)} ${config.primaryLabel.toLowerCase()}${isCurrent ? " (temporada abierta)" : ". Abrir esa temporada"}" ${isCurrent ? "aria-current=\"true\"" : ""}>
        <span class="career-value">${formatNumber(value)}</span>
        <span class="career-fill" style="--h:${Math.max(4, Math.round((value / max) * 100))}%"></span>
        <span class="career-season">${row.season.slice(2)}</span>
        <span class="chart-tip">${row.season} · ${esc(row.club)}<strong>${formatNumber(value)} ${config.primaryLabel.toLowerCase()}</strong></span>
      </button>`;
    }).join("");
  }

  async function renderGameweeks(player, token) {
    const section = $("#drawer-gws-section");
    const container = $("#drawer-gws");
    if (state.mode !== "fpl") {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    if (!active.hasGameweeks) {
      $("#gws-meta").textContent = "";
      container.innerHTML = `<p class="drawer-empty">No hay datos jornada a jornada para ${state.season}.</p>`;
      return;
    }
    container.innerHTML = `<p class="drawer-empty">Cargando jornadas…</p>`;
    let payload;
    try {
      payload = await loadJSON(`fpl/gws/${state.season}.json`);
    } catch {
      if (token === drawerToken) container.innerHTML = `<p class="drawer-empty">No pudimos cargar las jornadas.</p>`;
      return;
    }
    if (token !== drawerToken) return;
    const weeks = new Map((payload.players[uidOf(player)] || []).map((row) => [row[0], { gw: row[0], points: row[1], minutes: row[2], goals: row[3], assists: row[4] }]));
    if (!weeks.size) {
      $("#gws-meta").textContent = "";
      container.innerHTML = `<p class="drawer-empty">Sin jornadas registradas.</p>`;
      return;
    }
    const lastWeek = Math.max(...Object.values(payload.players).flatMap((rows) => rows.map((row) => row[0])));
    const series = Array.from({ length: lastWeek }, (_, index) => weeks.get(index + 1) || { gw: index + 1, points: 0, minutes: 0, goals: 0, assists: 0 });
    const played = series.filter((week) => week.minutes > 0);
    const best = series.reduce((top, week) => (week.points > top.points ? week : top), series[0]);
    const high = Math.max(...series.map((week) => week.points), 1);
    const low = Math.min(...series.map((week) => week.points), 0);
    const range = high - low || 1;
    $("#gws-meta").textContent = `${played.length} de ${lastWeek} jugadas · mejor J${best.gw} (${best.points})`;
    container.style.setProperty("--zero", `${(high / range) * 100}%`);
    container.innerHTML = series.map((week) => {
      const height = (Math.abs(week.points) / range) * 100;
      const status = week.minutes === 0 ? "no jugó" : `${week.minutes}'${week.goals ? ` · ${week.goals} gol${week.goals > 1 ? "es" : ""}` : ""}${week.assists ? ` · ${week.assists} asist.` : ""}`;
      return `<span class="gw-bar ${week.minutes === 0 ? "is-idle" : ""} ${week.points < 0 ? "is-negative" : ""} ${week === best ? "is-best" : ""}" style="--h:${Math.max(week.minutes ? 3 : 1.5, height)}%"><span class="chart-tip">J${week.gw} · ${status}<strong>${formatNumber(week.points)} pts</strong></span></span>`;
    }).join("");
    container.setAttribute("aria-label", `Puntos por jornada en ${state.season}: jugó ${played.length} de ${lastWeek}; su mejor jornada fue la ${best.gw} con ${best.points} puntos.`);
  }

  // ---------------------------------------------------------------- compare

  const inCompare = (player) => state.compare.some((entry) => entry.season === state.season && entry.uid === uidOf(player));

  function renderCompareToggle(player) {
    const button = $("#compare-toggle");
    const selected = inCompare(player);
    const full = !selected && state.compare.length >= COMPARE_LIMIT;
    button.disabled = full;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.innerHTML = selected ? "EN EL COMPARADOR <span>✓</span>" : full ? `COMPARADOR LLENO (${COMPARE_LIMIT})` : "AÑADIR AL COMPARADOR <span>+</span>";
  }

  function toggleCompare() {
    const player = active.players.find((item) => uidOf(item) === state.player);
    if (!player) return;
    if (inCompare(player)) state.compare = state.compare.filter((entry) => !(entry.season === state.season && entry.uid === uidOf(player)));
    else if (state.compare.length < COMPARE_LIMIT) state.compare = [...state.compare, { season: state.season, uid: uidOf(player) }];
    renderCompareToggle(player);
    renderCompareTray();
    syncHash();
  }

  async function resolveCompare() {
    const resolved = await Promise.all(state.compare.map(async (entry) => {
      const players = await loadSeasonPlayers(state.mode, entry.season).catch(() => []);
      const player = players.find((item) => uidOf(item) === entry.uid);
      return player ? { ...entry, player } : null;
    }));
    return resolved.filter(Boolean);
  }

  async function renderCompareTray() {
    const tray = $("#compare-tray");
    const entries = await resolveCompare();
    if (entries.length !== state.compare.length) {
      state.compare = entries.map(({ season, uid }) => ({ season, uid }));
      syncHash();
    }
    tray.hidden = entries.length === 0;
    document.body.classList.toggle("has-compare", entries.length > 0);
    $("#compare-chips").innerHTML = entries.map((entry) => `<span class="compare-chip">${avatar(entry.player, "compare-chip-avatar")}<span><strong>${esc(entry.player.shortName)}</strong><small>${entry.season}</small></span><button type="button" data-remove="${entry.season}~${entry.uid}" aria-label="Quitar a ${esc(entry.player.name)} (${entry.season}) del comparador">×</button></span>`).join("");
    $("#compare-open").disabled = entries.length < 2;
    $("#compare-open").innerHTML = entries.length < 2 ? "ELEGÍ OTRO JUGADOR" : `COMPARAR ${entries.length} <span>↗</span>`;
  }

  async function openCompare() {
    const entries = await resolveCompare();
    if (entries.length < 2) return;
    const config = modeConfig();
    lastFocus = document.activeElement;
    const head = `<div class="compare-row compare-head" style="--cols:${entries.length}"><span></span>${entries.map((entry) => `<div class="compare-player">${avatar(entry.player, "compare-avatar")}<div><strong>${esc(entry.player.name)}</strong><small>${esc(entry.player.club)} · ${esc(entry.player.position)} · ${entry.season}</small></div></div>`).join("")}</div>`;
    const rows = config.compareMetrics.map(([key, label, rankable = true]) => {
      // Rates under the minutes threshold are not comparable: shown as "—" and left out of the ranking.
      const values = entries.map((entry) => (isRateSort(key) && entry.player.minutes < RATE_MIN_MINUTES ? null : Number(entry.player[key]) || 0));
      const numbers = values.filter((value) => value !== null);
      const max = Math.max(...numbers, 0);
      return `<div class="compare-row" style="--cols:${entries.length}"><span class="compare-label">${label}</span>${values.map((value) => {
        if (value === null) return `<div class="compare-cell"><strong title="Menos de ${RATE_MIN_MINUTES} minutos">—</strong><span class="compare-track"></span></div>`;
        const isBest = rankable && max > 0 && value === max && numbers.filter((item) => item === max).length < numbers.length;
        return `<div class="compare-cell ${isBest ? "is-best" : ""}"><strong>${formatNumber(value)}${isBest ? '<span class="sr-only"> (mejor)</span>' : ""}</strong><span class="compare-track"><i style="width:${max ? Math.max(2, (value / max) * 100) : 0}%"></i></span></div>`;
      }).join("")}</div>`;
    }).join("");
    $("#compare-mode").textContent = `${config.label} · ${entries.length} JUGADORES`;
    $("#compare-table").innerHTML = head + rows;
    const panel = $("#compare-panel");
    showBackdrop();
    panel.hidden = false;
    requestAnimationFrame(() => { panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); });
    $("#compare-close").focus({ preventScroll: true });
  }

  function closeCompare({ restoreFocus = true } = {}) {
    const panel = $("#compare-panel");
    if (!panel.classList.contains("open")) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    hideBackdrop();
    setTimeout(() => { if (!panel.classList.contains("open")) panel.hidden = true; }, 310);
    if (restoreFocus && lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- wiring

  function wireControls() {
    $("#search-kbd").textContent = shortcutLabel(navigator.userAgentData?.platform || navigator.platform);
    $("#mode-switch").addEventListener("click", (event) => { const button = event.target.closest(".mode-button"); if (button) setMode(button.dataset.mode); });
    $("#season-tabs").addEventListener("click", (event) => { const button = event.target.closest(".season-tab"); if (button) setSeason(button.dataset.season, { focus: true }); });
    $("#season-select").addEventListener("change", (event) => setSeason(event.target.value));
    $("#search-input").addEventListener("input", (event) => { state.search = event.target.value; visibleCount = PAGE_SIZE; renderPlayers(); syncHash(); });
    $("#club-select").addEventListener("change", (event) => { state.club = event.target.value; visibleCount = PAGE_SIZE; renderPlayers(); syncHash(); });
    $("#position-select").addEventListener("change", (event) => { state.position = event.target.value; visibleCount = PAGE_SIZE; renderPlayers(); syncHash(); });
    $("#sort-select").addEventListener("change", (event) => { state.sort = event.target.value; visibleCount = PAGE_SIZE; renderPlayers(); syncHash(); });
    $("#load-more").addEventListener("click", () => {
      const firstNew = visibleCount;
      visibleCount += PAGE_SIZE;
      renderPlayers();
      $("#player-list").children[firstNew]?.focus({ preventScroll: true });
    });
    $("#random-fact-button").addEventListener("click", () => renderRandomFact());
    $("#fixture-week-select").addEventListener("change", (event) => { fixtureWeek = Number(event.target.value) || 1; renderFixture(); });
    $("#reset-button").addEventListener("click", resetFilters);
    $("#empty-reset").addEventListener("click", resetFilters);

    $("#player-list").addEventListener("click", (event) => { const row = event.target.closest(".player-row"); if (row) openDrawer(row.dataset.uid); });
    $("#player-list").addEventListener("keydown", (event) => {
      const row = event.target.closest(".player-row");
      if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDrawer(row.dataset.uid); }
    });
    $("#club-list").addEventListener("click", (event) => {
      const row = event.target.closest(".club-row");
      if (!row) return;
      state.club = state.club === row.dataset.club ? "all" : row.dataset.club;
      $("#club-select").value = state.club;
      visibleCount = PAGE_SIZE;
      renderPlayers();
      syncHash();
      $("#player-list").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    });
    document.addEventListener("click", (event) => { const trigger = event.target.closest("[data-open-player]"); if (trigger) openDrawer(trigger.dataset.openPlayer); });

    const chart = $("#scatter-chart");
    chart.addEventListener("pointermove", (event) => showScatterTooltip(nearestScatterPoint(event)));
    chart.addEventListener("pointerleave", () => showScatterTooltip(null));
    chart.addEventListener("click", (event) => { const point = nearestScatterPoint(event); if (point) openDrawer(uidOf(point.player)); });
    const pickHighlight = (event) => {
      const pick = event.target.closest(".scatter-pick");
      showScatterTooltip(pick ? scatterPoints.find((point) => uidOf(point.player) === pick.dataset.uid) : null);
    };
    $("#scatter-list").addEventListener("pointerover", pickHighlight);
    $("#scatter-list").addEventListener("focusin", pickHighlight);
    $("#scatter-list").addEventListener("pointerleave", () => showScatterTooltip(null));
    $("#scatter-list").addEventListener("focusout", () => showScatterTooltip(null));

    $("#drawer-career").addEventListener("click", (event) => {
      const bar = event.target.closest(".career-bar");
      if (bar && bar.dataset.season !== state.season) setSeason(bar.dataset.season, { player: bar.dataset.uid });
    });
    $("#compare-toggle").addEventListener("click", toggleCompare);
    $("#compare-chips").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove]");
      if (!button) return;
      state.compare = state.compare.filter((entry) => `${entry.season}~${entry.uid}` !== button.dataset.remove);
      renderCompareTray();
      syncHash();
    });
    $("#compare-open").addEventListener("click", openCompare);
    $("#compare-clear").addEventListener("click", () => { state.compare = []; renderCompareTray(); syncHash(); });
    $("#compare-close").addEventListener("click", () => closeCompare());
    $("#drawer-close").addEventListener("click", () => closeDrawer());
    $("#modal-backdrop").addEventListener("click", () => { closeDrawer(); closeCompare(); });

    // Broken photos fall back to initials (rows, drawer) or disappear (featured).
    document.addEventListener("error", (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.dataset.fallback) return;
      if (image.dataset.fallback === "hide") { image.style.display = "none"; return; }
      const fallback = document.createElement("span");
      fallback.className = `${image.className} avatar-fallback`.trim();
      fallback.textContent = image.dataset.initials || "";
      image.replaceWith(fallback);
    }, true);

    window.addEventListener("popstate", () => { applyHash(); refresh(); });
    window.addEventListener("scroll", updateScrollField, { passive: true });
    let resizeTimer;
    let lastChartWidth = 0;
    window.addEventListener("resize", () => {
      updateScrollField();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const chartWidth = Math.round($("#scatter-chart").clientWidth);
        if (active && chartWidth !== lastChartWidth) { lastChartWidth = chartWidth; renderScatter(); }
      }, 150);
    });
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if ($("#player-drawer").classList.contains("open")) closeDrawer();
        closeCompare({ restoreFocus: false });
        $("#search-input").focus();
      }
      if (event.key === "Escape") { closeCompare(); closeDrawer(); }
    });
  }

  wireControls();
  applyHash();
  refresh().then(() => syncHash());
  updateScrollField();
})();
