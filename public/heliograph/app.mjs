import { COLS, LANES, LAST_TIDE, createGame, traceLight, rotate, undo, defend, oracle, serializeGame, restoreGame } from "./engine.mjs";
import { HeliographBoard } from "./board.mjs";
import { browserStore, campaignStore, SLOTS, dateSeed, challengeSeed, challengeURL } from "./storage.mjs";
import { createSound } from "./sound.mjs";

const $ = id => document.getElementById(id);
const TIDES = ["First light", "The double bend", "A divided beam", "The iron prow", "Twin sails", "Crosscurrent", "The Black Flagship"];
const TACTICS = [
  "Follow the solid beam to its first wrong turn. Tap a mirror to turn it toward the scout.",
  "Trace both bends. A turn that lights the next mirror can be useful even before it hits the ironclad.",
  "A prism sends half the light straight and half around the bend. Find a line to both ships.",
  "An ironclad needs three light. Keep the main beam together.",
  "Two raiders approach. Bend the beam into position before splitting it.",
  "Follow both branches. Each raider needs half the full beam.",
  "The flagship needs all four light. A surviving flagship costs the harbor three hull.",
];
const prefKey = "sea-gates.heliograph.v1.sound";
const storage = browserStore();
const store = campaignStore(storage);
const sound = createSound();
const sharedSeed = challengeSeed(location.href);
const dialogs = [...document.querySelectorAll("dialog")];
let state = null;
let slot = "campaign";
let assists = [];
let selected = null;
let hint = null;
let suggestedTrace = null;
let shot = null;
let shotNumber = 0;
let status = "";
let report = "";
let saveStatus = "saved";
let resumeSlot = null;
let pendingStart = null;
let audioEnabled = false;
try { audioEnabled = storage?.getItem(prefKey) === "on"; } catch { /* Sound remains optional. */ }
sound.setEnabled(audioEnabled);

const board = new HeliographBoard($("board"), {
  onSelect(index) {
    if (state && !shot && selected !== index) { selected = index; paintBoard(); }
  },
  onRotate(index) {
    if (!state || shot || state.phase !== "planning" || dialogs.some(d => d.open)) return;
    const next = rotate(state, Math.floor(index / COLS), index % COLS);
    if (next === state) { setStatus("No orders remain. Fire the volley, or undo a turn."); return; }
    state = next;
    selected = index;
    clearHint();
    const trace = traceLight(state);
    const safe = state.ships.filter(s => trace.ports[s.row] >= s.hp).length;
    if (safe === state.ships.length) status = "All incoming ships are in the light. Fire when ready.";
    else if (!state.orders) status = "No orders left. Check the forecast, or undo a turn.";
    else if (state.tide === 2 && !safe) status = "Follow the illuminated path to the next mirror. Turn that mirror to send the beam east.";
    else status = safe ? `${safe} of ${state.ships.length} ships in the light. Check the other channel before firing.` : "Trace the solid line from the sun. A beam leaving the top or bottom of the chart misses the fleet.";
    sound.play("rotate");
    save();
    render();
  },
});

function clearHint() { hint = null; suggestedTrace = null; }
function setStatus(message) { status = message; $("status").textContent = message; }
function setSoundUI() {
  $("sound").setAttribute("aria-pressed", String(audioEnabled));
  const label = audioEnabled ? "Mute sound" : "Enable sound";
  $("sound").title = label;
  $("sound").setAttribute("aria-label", label);
  $("sound-label").textContent = label;
}
function read(slotName) {
  const entry = store.read(slotName);
  const saved = restoreGame(entry?.replay);
  if (!saved) return null;
  const hinted = Array.isArray(entry.assists) ? [...new Set(entry.assists.filter(n => Number.isInteger(n) && n > 0 && n <= saved.tide))] : [];
  return { state: saved, assists: hinted };
}
function save() {
  saveStatus = store.write(slot, { replay: serializeGame(state), assists });
  $("save-note").textContent = saveStatus === "saved" ? "" : saveStatus === "other-tab"
    ? "Another tab saved a different position. Return to the title screen to resume its campaign."
    : "This browser cannot save this run. Keep this tab open to finish the siege.";
}
function randomSeed() {
  if (globalThis.crypto?.getRandomValues) return 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 0x7fffffff);
  return 1 + Math.floor(Math.random() * 0x7fffffff);
}
function updateTitle() {
  const ordered = sharedSeed ? ["challenge"] : [...new Set([store.last(), ...SLOTS].filter(s => SLOTS.includes(s)))];
  resumeSlot = null;
  let previous;
  for (const name of ordered) {
    const entry = read(name);
    if (entry?.state.phase === "planning" && (!sharedSeed || entry.state.seed === sharedSeed)) { resumeSlot = name; previous = entry.state; break; }
  }
  $("resume").hidden = !resumeSlot;
  $("begin").firstChild.textContent = sharedSeed ? "Play shared siege " : resumeSlot ? "New campaign " : "Begin campaign ";
  $("title-notice").textContent = sharedSeed ? `Shared chart · ${sharedSeed}` :
    previous ? `Saved siege · Tide ${previous.tide} of ${LAST_TIDE} · Harbor ${previous.hull}/${previous.maxHull}` : "";
}
function returnToTitle() {
  dialogs.forEach(dialog => { if (dialog.open) dialog.close(); });
  $("game-screen").hidden = true; $("title-screen").hidden = false;
  updateTitle();
  (resumeSlot ? $("resume") : $("begin")).focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function askToReplace(copy, action) {
  pendingStart = action;
  $("replace-copy").textContent = copy;
  $("replace-dialog").showModal();
}
function enter(name, saved, seed) {
  slot = name;
  state = saved?.state ?? createGame(seed);
  assists = saved?.assists ?? [];
  selected = null; clearHint(); shot = null;
  status = TACTICS[state.tide - 1];
  report = state.lastResult ? summarize(state.lastResult) : "";
  dialogs.forEach(dialog => { if (dialog.open) dialog.close(); });
  $("title-screen").hidden = true; $("game-screen").hidden = false;
  save(); render();
  $("chart-title").tabIndex = -1;
  $("chart-title").focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (state.phase !== "planning") showEnd();
}
function start(name, seed) {
  const prior = read(name);
  if (prior && prior.state.seed === seed) { enter(name, prior, seed); return; }
  const action = () => enter(name, null, seed);
  if (name !== "daily" && prior?.state.phase === "planning") {
    askToReplace(`Starting this siege will replace your saved ${name} at Tide ${prior.state.tide}. Your other campaigns are kept separately.`, action);
  } else action();
}
function paintBoard() {
  if (!state) return;
  const shown = shot?.before ?? state;
  board.render({ state: shown, trace: traceLight(shown), selected, hint, suggestedTrace,
    locked: Boolean(shot) || shown.phase !== "planning", volley: shot });
}
function render() {
  const shown = shot?.before ?? state;
  const trace = traceLight(shown);
  $("tide").textContent = `${shown.tide} / ${LAST_TIDE}`;
  $("hull").textContent = `${shown.hull} / ${shown.maxHull}`;
  $("orders").textContent = `${shown.orders} / ${shown.budget}`;
  $("chart-title").textContent = TIDES[shown.tide - 1];
  $("seed").textContent = slot === "daily" ? `Daily · ${shown.seed}` : String(shown.seed);
  for (let row = 0; row < LANES.length; row++) {
    const cell = $("forecast").children[row];
    const value = cell.querySelector(".forecast-value");
    const ship = shown.ships.find(s => s.row === row);
    const light = trace.ports[row];
    const lit = ship && light >= ship.hp;
    cell.dataset.state = ship ? (lit ? "hit" : "risk") : "clear";
    const title = document.createElement("strong");
    title.textContent = ship?.name ?? "Open water";
    const detail = document.createElement("small");
    detail.textContent = ship ? `${light} / ${ship.hp} light · ${lit ? "will sink" : "−" + ship.breach + " harbor"}` :
      light ? `${light} light · no target` : "No incoming sail";
    value.replaceChildren(title, detail);
  }
  const locked = Boolean(shot) || state.phase !== "planning";
  $("undo").disabled = locked || !state.history.length;
  $("fire").disabled = locked;
  $("oracle").disabled = locked;
  $("pause").disabled = Boolean(shot);
  $("help").disabled = Boolean(shot);
  $("status").textContent = status;
  $("battle-report").textContent = report;
  paintBoard();
}
function summarize(result) {
  const sunk = result.ships.filter(s => s.sunk).length;
  const fell = result.ships.length - sunk;
  return `Tide ${result.tide} · ${sunk} sunk${fell ? `, ${fell} through · −${result.damage} harbor` : " · harbor held"}`;
}
function fire() {
  if (!state || shot || state.phase !== "planning" || dialogs.some(d => d.open)) return;
  const before = state;
  state = defend(before);
  const result = state.lastResult;
  clearHint();
  shot = { id: ++shotNumber, before, result };
  status = "Volley away.";
  save(); render(); sound.play("volley");
  const id = shot.id;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.setTimeout(() => {
    if (shot?.id !== id) return;
    shot = null; selected = null;
    report = summarize(result);
    status = TACTICS[state.tide - 1];
    if (result.damage) sound.play("hit");
    render();
    if (state.phase !== "planning") showEnd();
    else if (document.activeElement === document.body) $("fire").focus({ preventScroll: true });
  }, reduced ? 320 : 1440);
}
function showEnd() {
  const won = state.phase === "victory";
  $("end-title").textContent = won ? "The harbor holds." : "The gates have fallen.";
  const turns = state.completed.reduce((n, moves) => n + moves.length, 0);
  $("end-copy").textContent = (won ? `All seven tides repelled. The harbor finishes with ${state.hull} of ${state.maxHull} hull.` :
    `The fleet broke through on Tide ${state.tide}. Try the same chart and trace another route.`) +
    `\n\n${turns} committed turns · ${assists.length ? `Oracle consulted on ${assists.length} ${assists.length === 1 ? "tide" : "tides"}` : "Unaided siege"}`;
  $("play-again").firstChild.textContent = "Replay this siege ";
  $("end-share-status").textContent = "";
  $("end-dialog").showModal(); sound.play(won ? "victory" : "defeat");
}
function requestHint() {
  if (!state || shot || state.phase !== "planning") return;
  const plan = oracle(state);
  clearHint();
  if (!assists.includes(state.tide)) assists = [...assists, state.tide];
  if (plan.move) {
    hint = plan.move.row * COLS + plan.move.col;
    suggestedTrace = traceLight(rotate(state, plan.move.row, plan.move.col));
    const remaining = plan.moves.length - 1;
    status = `${plan.message} ${remaining ? `${remaining} further ${remaining === 1 ? "turn" : "turns"} ${remaining === 1 ? "completes" : "complete"} this line.` : "Check the dashed route."}`;
  } else status = plan.message;
  sound.play("hint"); save(); render();
}
async function share(target) {
  const url = challengeURL(location.href, state.seed);
  try {
    await navigator.clipboard.writeText(url);
    $(target).textContent = "Challenge link copied. It opens this chart from Tide I.";
  } catch {
    const a = document.createElement("a"); a.href = url; a.textContent = url;
    $(target).replaceChildren("Share this siege: ", a);
  }
}

$("begin").addEventListener("click", () => start(sharedSeed ? "challenge" : "campaign", sharedSeed ?? randomSeed()));
$("daily").addEventListener("click", () => start("daily", dateSeed()));
$("resume").addEventListener("click", () => {
  const prior = resumeSlot && read(resumeSlot);
  if (prior) enter(resumeSlot, prior, prior.state.seed);
  else updateTitle();
});
$("replace-confirm").addEventListener("click", () => {
  const action = pendingStart; pendingStart = null; $("replace-dialog").close(); action?.();
});
$("replace-cancel").addEventListener("click", () => $("replace-dialog").close());
$("replace-dialog").addEventListener("close", () => { pendingStart = null; });
$("undo").addEventListener("click", () => {
  if (shot || !state || !state.history.length) return;
  state = undo(state); clearHint(); sound.play("undo"); status = "Turn undone. Your order is restored."; save(); render();
});
$("oracle").addEventListener("click", requestHint);
$("fire").addEventListener("click", fire);
$("title-help").addEventListener("click", () => $("help-dialog").showModal());
$("help").addEventListener("click", () => $("help-dialog").showModal());
$("help-close").addEventListener("click", () => $("help-dialog").close());
function pause() {
  if (!state || shot || state.phase !== "planning" || $("game-screen").hidden || dialogs.some(d => d.open)) return;
  $("share-status").textContent = ""; $("pause-dialog").showModal();
}
$("pause").addEventListener("click", pause);
$("continue").addEventListener("click", () => $("pause-dialog").close());
$("to-title").addEventListener("click", returnToTitle);
$("share").addEventListener("click", () => void share("share-status"));
$("end-share").addEventListener("click", () => void share("end-share-status"));
$("end-to-title").addEventListener("click", returnToTitle);
$("end-dialog").addEventListener("cancel", event => { event.preventDefault(); returnToTitle(); });
$("play-again").addEventListener("click", () => enter(slot, null, state.seed));
$("sound").addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  sound.setEnabled(audioEnabled); setSoundUI();
  try { storage?.setItem(prefKey, audioEnabled ? "on" : "off"); } catch { /* Play without persistence. */ }
  if (audioEnabled) sound.play("rotate");
});
document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
    $("game-screen").hidden || shot || dialogs.some(d => d.open)) return;
  if (event.key === "Escape" || event.key.toLowerCase() === "p") { event.preventDefault(); pause(); }
  else if (event.key.toLowerCase() === "z") { event.preventDefault(); $("undo").click(); }
});
setSoundUI(); updateTitle();
