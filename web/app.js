(() => {
  const datasets = { fpl: window.FPL_DATA, pl: window.PL_DATA };
  if (!datasets.fpl?.seasons?.length) return;

  const state = { mode: "fpl", season: "2025-26", search: "", club: "all", position: "all", sort: "points" };
  let randomFactIndex = -1;
  const randomFactHistory = { pl: [], fpl: [] };
  let fixtureWeek = 1;
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
  const initials = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const currentData = () => datasets[state.mode] || datasets.fpl;
  const currentSeason = () => new Map(currentData().seasons.map((season) => [season.season, season])).get(state.season);
  const formatNumber = (value) => new Intl.NumberFormat("es-AR").format(value);
  const formatCompact = (value) => new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(value);

  function modeConfig() {
    if (state.mode === "pl") {
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
        sortOptions: [["goals", "Goles"], ["assists", "Asistencias"], ["appearances", "Apariciones"], ["minutes", "Minutos"], ["expectedGoals", "xG"], ["expectedAssists", "xA"]],
        defaultSort: "goals",
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
      sortOptions: [["points", "Puntos"], ["goals", "Goles"], ["assists", "Asistencias"], ["ppg", "Puntos / partido"], ["minutes", "Minutos"], ["ict", "Índice ICT"]],
      defaultSort: "points",
    };
  }

  function renderSortOptions() {
    const config = modeConfig();
    $("#sort-select").innerHTML = config.sortOptions.map(([value, label]) => `<option value="${value}" ${value === state.sort ? "selected" : ""}>${label}</option>`).join("");
  }

  function setMode(mode) {
    if (!datasets[mode]) return;
    state.mode = mode;
    const seasons = currentData().seasons;
    if (!seasons.some((season) => season.season === state.season)) state.season = seasons.find((season) => season.status === "final")?.season || seasons.at(-1).season;
    state.club = "all";
    state.position = "all";
    state.sort = modeConfig().defaultSort;
    $("#mode-switch").querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
    renderSortOptions();
    renderSeasonTabs();
    renderClubOptions();
    renderDashboard();
    renderPlayers();
    focusSummary();
  }

  function renderSeasonTabs() {
    const data = currentData();
    $("#season-tabs").innerHTML = data.seasons.map((season) => `<button class="season-tab ${season.season === state.season ? "active" : ""}" data-season="${season.season}" type="button">${season.season.replace("-", " / ")}${season.status === "current" ? " <small>EN CURSO</small>" : ""}</button>`).join("");
    $("#season-select").innerHTML = data.seasons.map((season) => `<option value="${season.season}" ${season.season === state.season ? "selected" : ""}>${season.season}${season.status === "current" ? " · En curso" : ""}</option>`).join("");
    $("#season-tabs").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => setSeason(button.dataset.season, true)));
    $("#season-select").onchange = (event) => setSeason(event.target.value, false);
  }

  function setSeason(season, shouldFocus = false) {
    state.season = season;
    state.club = "all";
    renderSeasonTabs();
    renderClubOptions();
    renderDashboard();
    renderPlayers();
    if (shouldFocus) focusSummary();
  }

  function focusSummary() {
    const summary = $("#stats-grid");
    if (!summary) return;
    summary.classList.remove("data-refreshed");
    requestAnimationFrame(() => {
      summary.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      summary.classList.add("data-refreshed");
      window.setTimeout(() => summary.classList.remove("data-refreshed"), 900);
    });
  }

  function renderDashboard() {
    const season = currentSeason();
    const stats = season.stats;
    const config = modeConfig();
    const statCards = state.mode === "pl"
      ? [["GOLES EN LA LIGA", formatNumber(stats.goals), `${formatNumber(stats.assists)} asistencias`], ["ASISTENCIAS", formatNumber(stats.assists), `${formatNumber(stats.appearances)} apariciones`], ["MINUTOS JUGADOS", formatCompact(stats.minutes), `${stats.clubs} clubes representados`], ["PROMEDIO DE GOLES", stats.avgGoals, `líder: ${season.leaders[0]?.shortName ?? "—"}`]]
      : [["PUNTOS REGISTRADOS", formatCompact(stats.points), `${stats.players} futbolistas con datos`], ["GOLES EN EL ARCHIVO", formatNumber(stats.goals), `${formatNumber(stats.assists)} asistencias`], ["MINUTOS JUGADOS", formatCompact(stats.minutes), `${stats.clubs} clubes representados`], ["PROMEDIO POR JUGADOR", stats.avgPoints, `líder: ${season.leaders[0]?.shortName ?? "—"}`]];
    $("#stats-grid").innerHTML = statCards.map(([label, value, context], index) => `<article class="stat-card reveal" style="--delay:${index * 70}ms"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><p class="stat-context">${esc(context)}</p></article>`).join("");
    $("#row-count").textContent = `${formatNumber(currentData().seasons.reduce((sum, item) => sum + item.players.length, 0))} perfiles`;
    $("#hero-season-count").textContent = currentData().seasons.length;
    $("#season-range").textContent = `${currentData().seasons[0].season} → ${currentData().seasons.at(-1).season}`;
    $("#season-range-badge").textContent = `${currentData().seasons[0].season.slice(0, 4)}—${currentData().seasons.at(-1).season.slice(-2)}`;
    $("#mode-kicker").innerHTML = `<span class="eyebrow-line"></span> ${config.kicker}`;
    $("#pulse-kicker").textContent = state.mode === "pl" ? "PULSO DE LA LIGA" : "PULSO HISTÓRICO";
    $("#leader-kicker").textContent = config.leaderKicker;
    $("#explorer-kicker").innerHTML = `<span class="eyebrow-line"></span> 02 / ${config.label} EXPLORADOR`;
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
  }

  function renderSeasonBars() {
    const config = modeConfig();
    const data = currentData();
    const values = data.seasons.map((item) => item.stats[config.seasonMetric]);
    const max = Math.max(...values, 1);
    $("#season-bars").innerHTML = data.seasons.map((item) => {
      const value = item.stats[config.seasonMetric];
      const height = Math.max(12, Math.round((value / max) * 100));
      return `<div class="season-column" title="${item.season}: ${formatNumber(value)} ${config.seasonMetricLabel.toLowerCase()}"><div class="bar" style="--bar-height:${height}%" data-value="${formatCompact(value)}"></div><span>${item.season.slice(2)}</span></div>`;
    }).join("");
  }

  function renderSeasonStories() {
    const season = currentSeason();
    const config = modeConfig();
    const story = state.mode === "pl" ? window.SEASON_STORIES?.[state.season] : window.FPL_STORIES?.[state.season];
    const archivePlayers = currentData().seasons.flatMap((item) => item.players);
    const archiveLeader = archivePlayers.sort((a, b) => (Number(b[config.primary]) || 0) - (Number(a[config.primary]) || 0))[0];
    const seasonGoals = [...season.players].sort((a, b) => (Number(b.goals) || 0) - (Number(a.goals) || 0))[0];
    const seasonAssists = [...season.players].sort((a, b) => (Number(b.assists) || 0) - (Number(a.assists) || 0))[0];
    const cards = [
      story || {
        eyebrow: "LECTURA DEL ARCHIVO",
        title: `${formatNumber(season.stats[config.seasonMetric])} ${config.seasonMetricLabel.toLowerCase()}`,
        body: `La temporada quedó encabezada por ${season.stats.leader}, con ${formatNumber(season.leaders[0]?.[config.primary] ?? 0)} ${config.primaryLabel.toLowerCase()}.`,
      },
      {
        eyebrow: `RÉCORD ${config.label}`,
        title: `${archiveLeader?.shortName ?? "—"} · ${formatNumber(archiveLeader?.[config.primary] ?? 0)} ${config.primaryLabel.toLowerCase()}`,
        body: `${archiveLeader?.club ?? "—"} sostiene el mejor registro individual del archivo ${config.label} disponible en esta vista.`,
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

  function renderRandomFact(forceNext = false) {
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

  function renderFixture() {
    const officialUrl = `https://www.premierleague.com/en/matches/premier-league/${encodeURIComponent(state.season)}/matchweek-1`;
    const sourceUrl = window.FIXTURE_SOURCES?.[state.season] || officialUrl;
    const season = currentSeason();
    const fixtureData = window.FIXTURE_DATA?.[state.season];
    const availableWeeks = fixtureData ? Array.from({ length: 38 }, (_, index) => index + 1) : [];
    fixtureWeek = availableWeeks.includes(fixtureWeek) ? fixtureWeek : (availableWeeks[0] || 1);
    $("#fixture-badge").textContent = fixtureData ? `${availableWeeks.length} MW` : "LINK";
    $("#fixture-intro").textContent = fixtureData
      ? (season.status === "current" ? "Calendario cargado · fechas sujetas a cambios." : "Calendario cargado · resultados y horarios de la temporada.")
      : "Todavía no hay datos locales para esta temporada; podés abrir el calendario oficial.";
    $("#fixture-official-link").href = officialUrl;
    $("#fixture-source-link").href = sourceUrl;
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
    const leader = currentSeason().leaders[0];
    if (!leader) return;
    const primaryValue = leader[config.primary];
    const meta = state.mode === "pl"
      ? `${leader.club} · ${leader.position} · ${formatNumber(leader.assists)} asistencias`
      : `${leader.club} · ${leader.position} · ${formatNumber(leader.goals)} goles`;
    $("#leader-name").textContent = leader.shortName;
    $("#featured-body").innerHTML = `<div class="featured-copy"><strong class="featured-stat">${formatNumber(primaryValue)}</strong><span class="featured-label">${config.scoreLabel}</span><p class="featured-meta">${esc(meta)}</p></div><img class="featured-photo" src="${esc(leader.photo)}" alt="${esc(leader.name)}" loading="lazy" onerror="this.style.display='none'">`;
  }

  let scrollFieldFrame;

  function updateScrollField() {
    const field = $("#scroll-field");
    if (!field || scrollFieldFrame) return;
    scrollFieldFrame = requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const progress = reducedMotion ? 0 : Math.min(1, Math.max(0, window.scrollY / maxScroll));
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
    const current = state.club;
    const options = currentSeason().clubs.map((club) => `<option value="${esc(club.club)}" ${club.club === current ? "selected" : ""}>${esc(club.club)}</option>`).join("");
    $("#club-select").innerHTML = `<option value="all">Todos los clubes</option>${options}`;
    if (current !== "all" && !currentSeason().clubs.some((club) => club.club === current)) state.club = "all";
  }

  function filteredPlayers() {
    const query = state.search.trim().toLowerCase();
    return currentSeason().players.filter((player) => {
      const matchesSearch = !query || `${player.name} ${player.shortName} ${player.club}`.toLowerCase().includes(query);
      const matchesClub = state.club === "all" || player.club === state.club;
      const matchesPosition = state.position === "all" || player.position === state.position;
      return matchesSearch && matchesClub && matchesPosition;
    }).sort((a, b) => (Number(b[state.sort]) || 0) - (Number(a[state.sort]) || 0));
  }

  function meter(value, max, label) {
    const width = Math.min(100, Math.max(3, (Number(value) / max) * 100));
    return `<div class="meter-line"><span>${label}</span><div class="meter-track"><i style="width:${width}%"></i></div></div>`;
  }

  function playerRow(player, index) {
    const config = modeConfig();
    const photo = player.photo ? `<img class="player-avatar" src="${esc(player.photo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className:'player-avatar avatar-fallback', textContent:'${esc(initials(player.name))}'}))">` : `<span class="player-avatar avatar-fallback">${esc(initials(player.name))}</span>`;
    const subline = state.mode === "pl"
      ? `${formatNumber(player.minutes)} min. · ${formatNumber(player.appearances)} apar. · ${formatNumber(player.assists)} asist.`
      : `${formatNumber(player.minutes)} min. · ${formatNumber(player.goals)} goles · ${formatNumber(player.assists)} asist.`;
    const signals = state.mode === "pl"
      ? `${meter(player.shots, 100, "TIR")}${meter(player.expectedGoals, 30, "xG")}${meter(player.expectedAssists, 20, "xA")}`
      : `${meter(player.threat, 300, "THR")}${meter(player.creativity, 300, "CRE")}${meter(player.ict, 250, "ICT")}`;
    return `<article class="player-row reveal" style="--delay:${Math.min(index, 10) * 24}ms" data-player-id="${player.id}">
      <div class="player-identity">${photo}<div class="player-copy"><div class="player-name">${esc(player.name)}</div><div class="player-sub">${subline}</div></div></div>
      <div class="player-club"><strong>${esc(player.club)}</strong><span class="position-pill">${esc(player.position)}</span></div>
      <div class="player-points"><span>${formatNumber(player[config.primary])}</span><small>${config.primaryLabel}</small></div>
      <div class="signal-meters">${signals}</div>
      <span class="player-arrow">↗</span>
    </article>`;
  }

  function renderPlayers() {
    const config = modeConfig();
    const players = filteredPlayers();
    $("#result-count").textContent = `${formatNumber(players.length)} perfiles`;
    $("#primary-header").textContent = config.primaryLabel;
    $("#signal-header").textContent = state.mode === "pl" ? "LECTURAS" : "SEÑALES";
    $("#player-list").innerHTML = players.slice(0, 75).map(playerRow).join("");
    $("#empty-state").hidden = players.length > 0;
    $("#player-list").querySelectorAll(".player-row").forEach((row) => row.addEventListener("click", () => openDrawer(Number(row.dataset.playerId))));
    renderClubs();
  }

  function renderClubs() {
    const config = modeConfig();
    const clubs = currentSeason().clubs;
    const max = clubs[0]?.[config.primary] || 1;
    $("#club-list").innerHTML = clubs.slice(0, 10).map((club, index) => `<button type="button" class="club-row" data-club="${esc(club.club)}"><span class="club-rank">${String(index + 1).padStart(2, "0")}</span><span><strong class="club-name">${esc(club.club)}</strong><span class="club-meta">${club.players} jugadores · líder ${esc(club.leader)}</span></span><strong class="club-points">${formatNumber(club[config.primary])}</strong><span class="club-bar"><i style="width:${Math.round((club[config.primary] / max) * 100)}%"></i></span></button>`).join("");
    $("#club-list").querySelectorAll(".club-row").forEach((row) => row.addEventListener("click", () => { state.club = row.dataset.club; $("#club-select").value = state.club; renderPlayers(); document.querySelector("#player-list").scrollIntoView({ behavior: "smooth", block: "start" }); }));
  }

  function openDrawer(playerId) {
    const config = modeConfig();
    const player = currentSeason().players.find((item) => item.id === playerId);
    if (!player) return;
    const avatar = $("#drawer-avatar");
    avatar.innerHTML = player.photo ? `<img src="${esc(player.photo)}" alt="${esc(player.name)}" onerror="this.remove(); this.parentElement.querySelector('span').textContent='${esc(initials(player.name))}'"><span></span>` : `<span>${esc(initials(player.name))}</span>`;
    $("#drawer-season").textContent = state.season;
    $("#drawer-position").textContent = player.position;
    $("#drawer-name").textContent = player.name;
    $("#drawer-club").textContent = player.club;
    $("#drawer-score-label").textContent = config.scoreLabel;
    $("#drawer-points").textContent = formatNumber(player[config.primary]);
    const metrics = state.mode === "pl"
      ? [["GOLES", player.goals], ["ASISTENCIAS", player.assists], ["APARICIONES", player.appearances], ["MINUTOS", formatCompact(player.minutes)], ["xG", player.expectedGoals], ["xA", player.expectedAssists]]
      : [["GOLES", player.goals], ["ASISTENCIAS", player.assists], ["MINUTOS", formatCompact(player.minutes)], ["PPG", player.ppg], ["BONUS", player.bonus], ["PRECIO", `£${player.price}m`]];
    $("#drawer-metrics").innerHTML = metrics.map(([label, value]) => `<div class="drawer-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
    const attackScore = state.mode === "pl"
      ? Math.round((player.goals * 10) + (player.assists * 6) + (player.expectedGoals * 2) + (player.expectedAssists * 2))
      : Math.round((player.goals * 9) + (player.assists * 5) + (player.threat * .08) + (player.creativity * .06));
    const signal = attackScore > 90 ? "ALTA" : attackScore > 45 ? "MEDIA" : "EN DESARROLLO";
    $("#drawer-signal-kicker").textContent = config.signalKicker;
    $("#drawer-signal-label").textContent = signal;
    $("#signal-value").textContent = `${Math.min(99, attackScore)}%`;
    $("#signal-arc").style.transform = `rotate(${Math.min(140, attackScore * 1.15) - 35}deg)`;
    $("#modal-backdrop").hidden = false;
    requestAnimationFrame(() => { $("#modal-backdrop").classList.add("visible"); $("#player-drawer").classList.add("open"); $("#player-drawer").setAttribute("aria-hidden", "false"); });
    $("#drawer-close").focus();
  }

  function closeDrawer() {
    $("#modal-backdrop").classList.remove("visible");
    $("#player-drawer").classList.remove("open");
    $("#player-drawer").setAttribute("aria-hidden", "true");
    setTimeout(() => { $("#modal-backdrop").hidden = true; }, 310);
  }

  function wireControls() {
    $("#mode-switch").querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    $("#search-input").addEventListener("input", (event) => { state.search = event.target.value; renderPlayers(); });
    $("#club-select").addEventListener("change", (event) => { state.club = event.target.value; renderPlayers(); });
    $("#position-select").addEventListener("change", (event) => { state.position = event.target.value; renderPlayers(); });
    $("#sort-select").addEventListener("change", (event) => { state.sort = event.target.value; renderPlayers(); });
    $("#random-fact-button").addEventListener("click", () => renderRandomFact(true));
    $("#fixture-week-select").addEventListener("change", (event) => { fixtureWeek = Number(event.target.value) || 1; renderFixture(); });
    const reset = () => { state.search = ""; state.club = "all"; state.position = "all"; state.sort = modeConfig().defaultSort; $("#search-input").value = ""; $("#position-select").value = "all"; renderSortOptions(); renderClubOptions(); renderPlayers(); };
    $("#reset-button").addEventListener("click", reset); $("#empty-reset").addEventListener("click", reset);
    $("#drawer-close").addEventListener("click", closeDrawer); $("#modal-backdrop").addEventListener("click", closeDrawer);
    window.addEventListener("scroll", updateScrollField, { passive: true });
    window.addEventListener("resize", updateScrollField);
    document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#search-input").focus(); } if (event.key === "Escape") closeDrawer(); });
  }

  renderSortOptions();
  renderSeasonTabs();
  renderClubOptions();
  renderDashboard();
  renderPlayers();
  wireControls();
  updateScrollField();
})();
