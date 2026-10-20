# Traspaso: fotos y datos curiosos para LaLiga, Bundesliga, Serie A y Ligue 1

Estado al 19/10/2026. Todo lo anterior está commiteado (último commit: `e3a8ab6`). El repo no tiene remoto.

## Contexto rápido

- La web está en `web/` (HTML + JS sin dependencias) y lee JSON de `web/data/`. Se sirve con:
  `.\.venv\Scripts\python.exe -m http.server 8765 --directory web`
- Para regenerar los datos: `.\.venv\Scripts\python.exe scripts\build_all.py` (con `--fetch-current` actualiza la temporada en curso y con `--skip-fixtures` no usa la red).
- Tests: `.\.venv\Scripts\python.exe -m unittest discover tests` y `node --test tests\lib.test.js`.
- Las ligas no inglesas salen de Understat: `scripts/fetch_understat.py` las baja y `scripts/build_league_data.py` genera `web/data/<liga>/` (las claves son `laliga`, `bundesliga`, `seriea` y `ligue1`).
- En el front (`web/app.js`), `dataKey()` devuelve `"fpl"`, `"pl"` o la clave de la liga. Las fotos salen de `playerPhoto(player, key)`: hoy devuelve `""` para las ligas de Understat, y entonces se muestran las iniciales.

## Tarea 1: fotos de jugadores en las ligas de Understat

### Qué se averiguó

- Understat no tiene fotos, y Wikidata no tiene una propiedad con el id de Understat. Hay que emparejar por **nombre y club**.
- La fuente elegida es **Wikidata, con las fotos de Wikimedia Commons**: tienen licencia libre y no hay que scrapear nada. La foto es la propiedad `P18` del jugador.
- El prototipo está en `scripts/prototypes/wikidata_photos_proto.py`: hace la prueba con LaLiga y mide la cobertura.
- Primer resultado (con filtros que estaban mal): 43% de los jugadores y 63% de los minutos jugados.

### Problemas encontrados y cómo resolverlos

1. **Filtro de fecha.** Messi no aparecía porque llegó al Barcelona en 2004 y el filtro era "inicio ≥ 2005". Hay que filtrar por fin del paso por el club: `OPTIONAL { ?st pq:P582 ?end } FILTER(!BOUND(?end) || YEAR(?end) >= 2014)`.
2. **Tipo de club.** El FC Barcelona no tiene `wdt:P31 wd:Q476028`. Hay que sacar ese filtro y quedarse sólo con `?club wdt:P17 wd:<país>`.
3. **Timeouts.** Pedir nombres y clubes en la misma consulta da error 504. Ya está dividido: primero jugador-foto-club como ids, después las etiquetas y alias (`rdfs:label`, `skos:altLabel`) en lotes con `VALUES`.
4. **Respuesta truncada.** La última corrida falló con `JSONDecodeError` porque la respuesta de la consulta base, sin el filtro de tipo de club, es muy grande. Opciones: (a) partir la consulta por club, tomando los clubes de los datos de Understat de cada liga y mapeándolos a items de Wikidata; (b) agregar `LIMIT`/`OFFSET` y paginar; (c) devolver `?img` sólo con `SAMPLE()` agrupando por jugador. Recomiendo la (a), que además mejora la precisión.
5. **Nombres cortos.** Understat usa apodos o apellidos ("Yuri", "Remiro", "De Marcos"). El prototipo ya prueba una segunda pasada en la que los tokens del nombre de Understat tienen que estar incluidos en un nombre de Wikidata, siempre con el club confirmado y con un único candidato. Falta medir cuánto mejora la cobertura.

Los códigos de país en Wikidata son: España `Q29`, Alemania `Q183`, Italia `Q38`, Francia `Q142` y Mónaco `Q235` (el AS Monaco juega la Ligue 1).

### Cómo integrarlo (propuesta)

1. Crear `scripts/fetch_wikidata_photos.py` a partir del prototipo. Que guarde `data/wikidata/<liga>.json` con `{understat_id: "Archivo.jpg"}`, sólo con los emparejamientos únicos y con el club confirmado.
2. En `scripts/build_league_data.py`, leer ese mapa y agregar `"photo": "<archivo de Commons>"` a cada jugador.
3. En `web/app.js`, dentro de `playerPhoto`, para las ligas de Understat devolver `https://commons.wikimedia.org/wiki/Special:FilePath/<archivo>?width=240` cuando `player.photo` exista. El respaldo con iniciales ya funciona solo (`data-fallback`).
4. **Atribución (obligatoria por la licencia CC):** en el panel lateral, enlazar la foto a `https://commons.wikimedia.org/wiki/File:<archivo>` y cambiar la nota al pie (`.drawer-footnote`) para que diga que las fotos de esas ligas vienen de Wikimedia Commons.
5. Las fotos de Commons no son de estudio y tienen proporciones distintas. `object-fit: cover; object-position: top` ya está aplicado y conviene revisar cómo se ven.
6. Sumar a `fetch_understat` el paso que corresponda en `build_all.py --fetch-current`, y un test que verifique que los ids del mapa existen en los datos.

## Tarea 2: datos curiosos por liga

- Hoy los datos curiosos están en `web/season_stories.js`, en `window.RANDOM_FACTS = { pl: [...], fpl: [...] }`. Cada uno tiene la forma `{ eyebrow, title, body, source }`.
- En `web/app.js`, `renderRandomFact()` sólo los muestra en FPL y en la Premier. En las demás ligas oculta la caja (`#random-fact`).
- **Propuesta:**
  1. Agregar `RANDOM_FACTS.laliga`, `.bundesliga`, `.seriea` y `.ligue1` a `season_stories.js`. Cada dato tiene que tener una **fuente verificable** (sitio oficial de la liga o una nota periodística) y hay que revisar cada uno antes de publicarlo.
  2. Sumar datos calculados de los propios datos, que no pueden estar mal: el récord de goles de cada temporada, quién más superó su xG en el archivo, el máximo asistidor, etc. Se pueden generar en `build_league_data.py` como `index.json → facts` (con `source` apuntando a la página de la liga en Understat) y mezclarlos con los curados.
  3. En `renderRandomFact()`, cuando el modo es `"pl"`, usar `RANDOM_FACTS[state.league]` más `active.index.facts`, y el historial `randomFactHistory` por liga en vez de por modo.
- Algunos datos ya verificados en estos datos, que sirven como punto de partida: Cristiano Ronaldo hizo 48 goles en LaLiga 2014-15, Lewandowski 41 en la Bundesliga 2020-21 (récord histórico, superó los 40 de Gerd Müller), Higuaín 36 en la Serie A 2015-16 e Ibrahimović 38 en la Ligue 1 2015-16.

## Cómo verificar

- Abrir `http://localhost:8765/#mode=pl&liga=laliga`, buscar un jugador y abrir su panel para ver la foto y la nota de atribución.
- Que no haya errores en la consola y que una foto inexistente muestre las iniciales.
- Correr los tests de arriba.
