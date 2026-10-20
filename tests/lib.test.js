// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");

require("../web/lib.js");
const { normalizeText, parseHash, serializeHash, niceTicks, shortcutLabel, isRateSort, photoUrl } = globalThis.FPLLib;

test("normalizeText ignores case, accents and special letters", () => {
  assert.equal(normalizeText("N'Golo Kanté"), "n'golo kante");
  assert.equal(normalizeText("Martin Ødegaard"), "martin odegaard");
  assert.equal(normalizeText("  Raúl   Jiménez "), "raul jimenez");
  assert.equal(normalizeText("Łukasz Fabiański"), "lukasz fabianski");
  assert.ok(normalizeText("Martin Ødegaard Arsenal").includes(normalizeText("odegaard")));
});

test("hash round-trips state and drops defaults", () => {
  const defaults = { mode: "fpl", season: "2025-26", search: "", club: "all", position: "all", sort: "points" };
  const state = { mode: "pl", season: "2023-24", search: "salah", club: "Man Utd", position: "MID", sort: "goals", player: "42", compare: [{ season: "2023-24", uid: "42" }, { season: "2019-20", uid: "7" }] };
  const hash = serializeHash(state, defaults);
  assert.deepEqual(parseHash(hash), state);
  assert.equal(serializeHash({ ...defaults, compare: [] }, defaults), "");
  assert.equal(serializeHash({ ...defaults, season: "2019-20", compare: [] }, defaults), "#season=2019-20");
});

test("parseHash tolerates junk", () => {
  assert.deepEqual(parseHash(""), { compare: [] });
  assert.deepEqual(parseHash("#cmp=bad,,2020-21~3"), { compare: [{ season: "2020-21", uid: "3" }] });
});

test("niceTicks returns round steps covering the range", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(4, 14.5, 6), [4, 6, 8, 10, 12, 14]);
  assert.deepEqual(niceTicks(0, 0), [0]);
});

test("shortcut label follows the platform", () => {
  assert.equal(shortcutLabel("MacIntel"), "⌘ K");
  assert.equal(shortcutLabel("macOS"), "⌘ K");
  assert.equal(shortcutLabel("Win32"), "Ctrl K");
  assert.equal(shortcutLabel(undefined), "Ctrl K");
});

test("rate sorts and photo urls", () => {
  assert.ok(isRateSort("pointsPerMillion"));
  assert.ok(!isRateSort("points"));
  assert.equal(photoUrl(0), "");
  assert.match(photoUrl(154561), /p154561\.png$/);
});
