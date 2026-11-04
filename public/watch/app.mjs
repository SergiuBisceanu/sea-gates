import * as Engine from './engine.mjs';
import { HarborBoard, artifactSVG, BATTLE_DURATION } from './board.mjs';
import { HOSTED_ORIGIN, PUBLIC_GAME_URL } from './config.mjs';
import * as Content from './content.mjs';
import * as Transfer from './transfer.mjs';

const $ = (id) => document.getElementById(id);
const PREFIX = 'sea-gates.watch.v1.';
const expected = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const hosted = location.origin === HOSTED_ORIGIN || location.hostname === 'terminal.local' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const github = location.origin === new URL(PUBLIC_GAME_URL).origin;
let storage;
try { storage = window.localStorage; } catch { storage = null; }
let game = null, run = null, selected = null, suggestion = null, locked = false, battleTimer = null;
let screen = 'home', dialogKind = null, beforeDialog = null, renderEpoch = 0;
let account = { signedIn: false, profile: null, signinUrl: null, signoutUrl: null };
let accountAvailable = false, accountLoading = hosted, serverOffset = 0, accountError = '', claimStatus = '', claiming = false;
let accountRequest = 0;
let incomingTransfer = null, transferMessage = '', transferReviewDay = null, acceptedTransferDay = null;
let soundOn = readJSON('sound', false) === true, audioContext;
const board = new HarborBoard($('board'), { onSelect: selectPiece, onSwap: makeSwap });

function readRaw(key) { try { return storage?.getItem(PREFIX + key) ?? null; } catch { return null; } }
function readJSON(key, fallback) { try { const raw = readRaw(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } }
function writeJSON(key, value) { try { if (!storage) return false; storage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; } }
function safeDay(day) { try { Engine.seedForDay(day); return true; } catch { return false; } }
function today() { return new Date(Date.now() + serverOffset).toISOString().slice(0, 10); }
function formatDay(day) { return Content.formatDay?.(day) || new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z')); }
function dayBefore(day, n) { return new Date(Date.parse(day + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10); }
function slot(mode, day) { return mode === 'voyage' ? 'run.voyage' : 'run.daily.' + day; }
function randomSeed() { try { return crypto.getRandomValues(new Uint32Array(1))[0] || 1; } catch { return (Date.now() ^ Math.floor(Math.random() * 4294967295)) >>> 0 || 1; } }
function say(message) { $('announcement').textContent = ''; requestAnimationFrame(() => { $('announcement').textContent = message; }); }
function text(id, value) { $(id).textContent = value; }
function el(tag, className, value) { const node = document.createElement(tag); if (className) node.className = className; if (value !== undefined) node.textContent = value; return node; }
function note(message) { $('save-note').hidden = !message; text('save-note', message || ''); }
function validClaims(claims) { return Array.isArray(claims) ? claims.filter(c => c && safeDay(c.day) && ['victory', 'defeat'].includes(c.phase) && Number.isFinite(c.score)) : []; }
function localClaims() { return validClaims(readJSON('claims', [])); }
function betterClaim(next, previous) {
  return Transfer.betterResult(next, previous);
}
function progress() {
  const claims = account.signedIn && account.profile ? validClaims(account.profile.claims) : localClaims();
  const days = account.signedIn && account.profile ? Number(account.profile.daysPlayed) || new Set(claims.map(c => c.day)).size : new Set(claims.map(c => c.day)).size;
  return { claims, days, source: account.signedIn && account.profile ? 'account' : 'device' };
}
function savedRun(mode, day) {
  const key = slot(mode, day), raw = readRaw(key);
  expected.set(key, raw);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.v !== 1 || value.mode !== mode || (mode === 'daily' && value.day !== day)) return null;
    const restored = Engine.restoreGame(value.replay);
    if (!restored || restored.mode !== mode || (mode === 'daily' && restored.seed !== Engine.seedForDay(day))) return null;
    return restored;
  } catch { return null; }
}
function peekRun(mode, day) {
  const key = slot(mode, day), old = expected.get(key), had = expected.has(key);
  const value = savedRun(mode, day);
  if (had) expected.set(key, old); else expected.delete(key);
  return value;
}
function persistRun() {
  if (!game || !run) return;
  const key = run.key;
  if (!storage) { note('This browser cannot save the watch. Keep this tab open to finish.'); return; }
  if (readRaw(key) !== (expected.get(key) ?? null)) { note('Another tab has a newer watch. Your moves remain here, but will not replace its save.'); return; }
  const value = { v: 1, day: run.day, mode: run.mode, replay: Engine.serializeGame(game), at: Date.now() };
  try {
    const raw = JSON.stringify(value);
    storage.setItem(PREFIX + key, raw); expected.set(key, raw); note('');
  } catch { note('Your browser could not save this move. Keep this tab open to finish.'); }
}
function refreshHome() {
  const day = today(), saved = peekRun('daily', day), voyage = peekRun('voyage', null), p = progress();
  text('daily-date', formatDay(day)); $('daily-date').dateTime = day;
  text('daily-play-label', saved ? saved.phase === 'planning' ? 'Continue your watch' : 'Review your watch' : 'Take the watch');
  const completed = p.claims.find(c => c.day === day);
  text('daily-status', completed ? 'Today’s watch recorded' : 'A new watch at 00:00 UTC');
  text('voyage-description', voyage?.phase === 'planning' ? `Continue at tide ${voyage.tide}. The gates still stand.` : 'An escalating siege. Find your limit.');
  text('collection-description', p.days ? `${p.days} ${p.days === 1 ? 'watch' : 'watches'} recorded · ${unlockedRewards(p.days)} treasures collected` : 'Complete watches. Collect the harbor’s treasures.');
  text('account-label', account.signedIn ? 'Captain’s log' : 'Your logbook');
}
function unlockedRewards(days) { return (Content.REWARDS || []).filter(r => days >= (r.threshold ?? r.days)).length; }
function showHome() {
  if (locked) finishBattle();
  closeModal(); screen = 'home'; $('home-screen').hidden = false; $('game-screen').hidden = true;
  writeJSON('view', { screen: 'home' });
  refreshHome(); document.title = 'The Sea Gates · Daily Watch'; window.scrollTo({ top: 0, behavior: 'instant' });
}
function startRun(mode, day = today(), fresh = false) {
  if (locked) finishBattle();
  closeModal();
  const key = slot(mode, day);
  game = fresh ? null : savedRun(mode, day);
  if (!game) {
    expected.set(key, readRaw(key));
    game = Engine.createGame(mode === 'daily' ? Engine.seedForDay(day) : randomSeed(), mode);
  }
  run = { mode, day: mode === 'daily' ? day : null, key };
  writeJSON('view', { screen: 'game', mode, day: run.day });
  selected = null; suggestion = null; claimStatus = ''; locked = false;
  screen = 'game'; $('home-screen').hidden = true; $('game-screen').hidden = false;
  note(''); persistRun(); renderGame(); window.scrollTo({ top: 0, behavior: 'instant' });
  if (game.phase !== 'planning') { recordCompletion(); openResult(); }
  else say(`Tide ${game.tide}. ${game.orders} orders. ${game.hull} gate strength.`);
}
function renderGame(battle = null, before = null) {
  if (!game || !run) return;
  renderEpoch++;
  const visible = before || game, forecast = Engine.forecast(visible), daily = run.mode === 'daily', practice = daily && run.day !== today();
  text('game-mode-label', daily ? practice ? `PAST WATCH · ${formatDay(run.day)}` : `DAILY WATCH · ${formatDay(run.day)}` : 'THE LONG VOYAGE');
  const theme = daily ? Content.themeForDay?.(run.day) : null;
  text('game-title', theme?.title || (daily ? 'Hold the harbor.' : 'Beyond the seventh tide.'));
  $('tide-value').replaceChildren(document.createTextNode(String(visible.tide)), el('small', '', daily ? '/ 7' : '/ 150'));
  $('hull-value').replaceChildren(document.createTextNode(String(visible.hull)), el('small', '', '/ ' + visible.maxHull));
  $('orders-value').replaceChildren(document.createTextNode(String(visible.orders)), el('small', '', '/ 5'));
  $('hull-pips').replaceChildren(...Array.from({ length: visible.maxHull }, (_, i) => el('i', i >= visible.hull ? 'spent' : '')));
  board.render({ state: visible, selected, hint: suggestion, forecast, locked, battle });
  text('board-instruction', locked ? 'The fleet is approaching…' : selected !== null ? 'Choose an adjacent piece to swap.' : 'Tap a piece, then its neighbor.');
  renderThreats(forecast);
  renderPiece();
  $('undo-button').disabled = locked || !game.history?.length || game.phase !== 'planning';
  $('hint-button').disabled = locked || game.orders < 1 || game.phase !== 'planning';
  $('defend-button').disabled = locked || game.phase !== 'planning';
  text('defend-label', locked ? 'Defending…' : 'Defend');
  $('hint-note').hidden = !suggestion;
  text('hint-note', suggestion?.reason || '');
  document.title = `Tide ${visible.tide} · The Sea Gates`;
}
function renderThreats(forecast) {
  const enemies = forecast.enemies || [], total = forecast.total ?? enemies.length;
  text('fleet-count', `${total} ${total === 1 ? 'ship' : 'ships'}`);
  const groups = new Map();
  for (const enemy of enemies) {
    const key = `${enemy.kind}|${enemy.lane}`;
    const group = groups.get(key) || { ...enemy, count: 0 };
    group.count++; groups.set(key, group);
  }
  const rows = [...groups.values()].map(enemy => {
    const row = el('div', 'threat'), label = el('span');
    label.append(el('strong', '', `${enemy.count > 1 ? enemy.count + '× ' : ''}${enemy.name || enemy.kind}`), el('span', 'lane', enemy.lane === 2 ? 'WEST' : 'EAST'));
    row.append(label, el('span', enemy.boss ? 'danger' : '', `${enemy.maxHp} HP${enemy.armor ? ' · armor ' + enemy.armor : ''}`));
    return row;
  });
  $('threat-list').replaceChildren(...rows);
  const damage = Math.max(0, Number(forecast.damage) || 0);
  text('forecast-copy', damage ? `Current forecast · ${damage} gate damage. ${forecast.sunk ?? 0} of ${total} ships stopped.` : `Current forecast · the gates hold. ${forecast.sunk ?? total} of ${total} ships stopped.`);
  $('forecast-copy').classList.toggle('danger', damage > 0);
}
function renderPiece() {
  const piece = selected === null ? null : game.board[selected], meta = piece && Engine.KINDS?.[piece.kind];
  text('piece-category', piece ? (piece.tier ? `MACHINE · TIER ${piece.tier}` : 'HARBOR MATERIAL') : 'YOUR NEXT ORDER');
  text('piece-name', meta?.name || meta?.label || (piece ? piece.kind : selected !== null ? 'An empty quay.' : 'Build from what you have.'));
  text('piece-description', meta?.description || (selected !== null ? 'An empty quay. Move a neighboring piece into this space for one order.' : 'Swap neighboring pieces. Connect three of a kind to build a machine.'));
  const chips = selected === null ? ['3 materials → machine', '3 machines → upgrade'] : piece?.tier === 3 ? ['Highest tier', 'Position still matters'] : [piece?.tier ? 'Merge three to upgrade' : 'Connect three to build'];
  $('recipe-strip').replaceChildren(...chips.map(value => el('span', 'recipe-chip', value)));
}
function selectPiece(index) {
  if (locked || !game || game.phase !== 'planning' || !Number.isInteger(index)) return;
  if (index % 8 === 2 || index % 8 === 5) return;
  if (selected === index) { selected = null; renderGame(); return; }
  if (selected !== null) {
    const a = selected, adjacent = Math.abs(Math.floor(a / 8) - Math.floor(index / 8)) + Math.abs(a % 8 - index % 8) === 1;
    if (adjacent) { makeSwap(a, index); return; }
  }
  selected = index; suggestion = null; renderGame(); tone('select');
}
function makeSwap(from, to) {
  if (locked || !game || game.phase !== 'planning') return;
  const next = Engine.swap(game, from, to);
  if (next === game) { say(game.orders ? 'Choose two neighboring land squares.' : 'All five orders are spent. Defend the gates to begin the next tide.'); return; }
  const previous = game; game = next; selected = null; suggestion = null;
  persistRun(); renderGame();
  const merged = game.board.some((piece, i) => piece && piece.tier > (previous.board[i]?.tier || 0));
  tone(merged ? 'merge' : 'swap'); say(`${merged ? 'Machine assembled. ' : ''}${game.orders} orders left.`);
}
function undoMove() {
  if (!game || locked) return;
  const next = Engine.undo(game); if (next === game) return;
  game = next; selected = null; suggestion = null; persistRun(); renderGame(); tone('select'); say(`Order undone. ${game.orders} orders left.`);
}
async function suggestMove() {
  if (!game || locked || !game.orders) return;
  $('hint-button').disabled = true; const epoch = renderEpoch;
  await new Promise(resolve => setTimeout(resolve, 0));
  if (epoch !== renderEpoch || screen !== 'game' || locked) return;
  suggestion = Engine.hint(game);
  if (suggestion) { selected = suggestion.from; renderGame(); say(suggestion.reason || 'A suggested swap is highlighted.'); }
  else { selected = null; renderGame(); say('No useful swap found. You can defend when ready.'); }
}
function defend() {
  if (!game || locked || game.phase !== 'planning') return;
  const before = game, next = Engine.defend(game);
  if (next === game) return;
  game = next; locked = true; selected = null; suggestion = null;
  persistRun(); renderGame(game.lastBattle, before); tone('defend');
  battleTimer = setTimeout(finishBattle, reducedMotion.matches ? 150 : BATTLE_DURATION + 180);
}
function finishBattle() {
  if (!locked) return;
  clearTimeout(battleTimer); battleTimer = null; locked = false;
  renderGame();
  if (game.phase !== 'planning') { recordCompletion(); openResult(); tone(game.phase === 'victory' ? 'win' : 'loss'); }
  else {
    const damage = game.lastBattle?.damage || 0;
    say(damage ? `The fleet dealt ${damage} damage. Tide ${game.tide}. ${game.hull} gate strength remains.` : `The gates held. Tide ${game.tide}. Five new orders.`);
  }
}
function recordCompletion() {
  if (!game || !run || game.phase === 'planning') return;
  if (run.mode === 'voyage') {
    const best = readJSON('voyage-best', { tide: 0, score: 0 });
    if (game.tide > best.tide || game.score > best.score) writeJSON('voyage-best', { tide: Math.max(game.tide, best.tide || 0), score: Math.max(game.score, best.score || 0) });
    return;
  }
  if (run.day !== today()) { claimStatus = 'Past watches are practice. Your current daily watch can earn a new day in the logbook.'; return; }
  const claim = { day: run.day, score: game.score, hull: game.hull, phase: game.phase, tide: game.tide, movesUsed: game.movesUsed };
  const claims = localClaims(), old = claims.find(c => c.day === run.day);
  if (betterClaim(claim, old)) {
    if (!writeJSON('claims', [...claims.filter(c => c.day !== run.day), claim].slice(-370))) claimStatus = 'Your browser could not store this result. Keep this tab open.';
  }
  if (hosted) {
    const pending = pendingClaims(), priorPending = pending.find(p => p.day === run.day);
    const priorResult = priorPending ? Engine.replayRun(priorPending.replay).result : null;
    if (betterClaim(claim, priorResult)) {
      writeJSON('pending', [...pending.filter(p => p.day !== run.day), { day: run.day, replay: Engine.serializeGame(game) }]);
    }
    if (account.signedIn) void submitPending();
    else claimStatus ||= 'Recorded on this device. Sign in today to add this watch to your account.';
  } else claimStatus ||= 'Recorded on this device. Account watches are available in the hosted game.';
  refreshHome();
}
function pendingClaims() { const p = readJSON('pending', []); return Array.isArray(p) ? p.filter(x => x && safeDay(x.day) && x.replay).slice(-3) : []; }
function removePending(item) { const replay = JSON.stringify(item.replay); writeJSON('pending', pendingClaims().filter(p => p.day !== item.day || JSON.stringify(p.replay) !== replay)); }
function completedWatchForTransfer() {
  if (!github) return null;
  const day = today();
  const candidates = [game && run?.mode === 'daily' && run.day === day ? game : null, peekRun('daily', day)].filter(state => state && state.mode === 'daily' && state.phase !== 'planning' && state.seed === Engine.seedForDay(day));
  let best = null;
  for (const state of candidates) if (betterClaim(state, best)) best = state;
  return best ? { day, replay: Engine.serializeGame(best) } : null;
}
function readIncomingTransfer() {
  if (!hosted || !location.hash?.startsWith('#watch=')) return;
  transferReviewDay = null; acceptedTransferDay = null;
  incomingTransfer = Transfer.decodeWatchFragment(location.hash);
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* A restricted history does not affect replay validation. */ }
  transferMessage = incomingTransfer ? 'Your completed watch has arrived. Checking today’s harbor date before saving it…' : 'That watch link could not be read. Your existing watches are safe.';
}
function acceptIncomingTransfer(serverDay) {
  if (!incomingTransfer || !safeDay(serverDay)) return;
  const imported = incomingTransfer; incomingTransfer = null;
  if (imported.day !== serverDay) {
    transferMessage = 'This watch belongs to a different UTC day. Only the current watch can earn an account reward.';
    return;
  }
  const pending = pendingClaims(), previous = pending.find(item => item.day === imported.day);
  const checkedPrevious = previous ? Engine.replayRun(previous.replay).result : null;
  const previousResult = checkedPrevious?.completed && checkedPrevious.mode === 'daily' && checkedPrevious.seed === Engine.seedForDay(imported.day) ? checkedPrevious : null;
  if (betterClaim(imported.result, previousResult) && !writeJSON('pending', [...pending.filter(item => item.day !== imported.day), { day: imported.day, replay: imported.replay }])) {
    transferMessage = 'This browser could not save the transferred watch. Keep the original game open and allow browser storage before trying again.';
    return;
  }
  // A hosted board may already be in progress. Importing a result never
  // replaces its checkpoint, active screen, selection, or saved view.
  const key = slot('daily', imported.day);
  if (readRaw(key) === null && writeJSON(key, { v: 1, day: imported.day, mode: 'daily', replay: imported.replay, at: Date.now() })) transferReviewDay = imported.day;
  acceptedTransferDay = imported.day;
  transferMessage = account.signedIn ? 'Your completed watch arrived from GitHub. It is ready for account verification.' : 'Your completed watch arrived from GitHub. Sign in to save it to your account without replaying.';
  refreshHome();
}
async function requestJSON(url, options = {}) {
  const control = new AbortController(), timeout = setTimeout(() => control.abort(), 9000);
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: control.signal });
    let data; try { data = await response.json(); } catch { throw new Error('The harbor service returned an unreadable response.'); }
    if (!response.ok) { const error = new Error(data?.error || 'The harbor service is unavailable.'); error.status = response.status; error.code = data?.code; throw error; }
    return data;
  } finally { clearTimeout(timeout); }
}
async function loadAccount() {
  if (!hosted) return;
  accountLoading = true; const request = ++accountRequest;
  try {
    const data = await requestJSON('/api/player');
    if (request !== accountRequest) return;
    account = { signedIn: data.signedIn === true, profile: data.profile || null, signinUrl: data.signinUrl || null, signoutUrl: data.signoutUrl || null };
    accountAvailable = true; accountError = '';
    const timestamp = typeof data.serverTime === 'number' ? data.serverTime : Date.parse(data.serverTime);
    if (Number.isFinite(timestamp)) serverOffset = timestamp - Date.now();
    else if (safeDay(data.day) && data.day !== today()) serverOffset = Date.parse(data.day + 'T12:00:00Z') - Date.now();
    acceptIncomingTransfer(data.day);
    refreshHome();
    if (screen === 'game' && !locked) renderGame();
    if (account.signedIn) await submitPending();
  } catch { if (request === accountRequest) accountError = 'The account service is unavailable. Your watch can still be played and saved on this device.'; }
  finally { if (request === accountRequest) { accountLoading = false; if (dialogKind === 'account') openAccount(); } }
}
async function submitPending() {
  if (!hosted || !account.signedIn || claiming) return;
  claiming = true;
  try {
    for (const item of pendingClaims()) {
      if (item.day !== today()) {
        removePending(item);
        claimStatus = 'An older watch remains in this device’s logbook. Account rewards can only be claimed on its UTC day.';
        continue;
      }
      try {
        const result = await requestJSON('/api/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
        if (result.profile) account.profile = result.profile;
        removePending(item);
        claimStatus = result.alreadyClaimed && !result.improved ? 'Today’s watch is already in your account logbook.' : 'Watch verified. Your account logbook is up to date.';
        if (acceptedTransferDay === item.day) transferMessage = claimStatus;
      } catch (error) {
        if ([400, 403, 409, 410, 413, 422].includes(error.status)) { removePending(item); claimStatus = 'This result could not earn an account reward. It remains in your device’s logbook.'; }
        else if (error.status === 401) { account.signedIn = false; claimStatus = 'Your sign-in expired. Sign in again today to sync this watch.'; }
        else claimStatus = 'Saved on this device. Account sync will retry when you reopen the game.';
        if (acceptedTransferDay === item.day) transferMessage = claimStatus;
      }
    }
  } finally {
    claiming = false; refreshHome();
    if (dialogKind === 'result') updateResultSync();
    if (dialogKind === 'collection') openCollection();
  }
}
function openModal(kind, eyebrow, title) {
  const alreadyOpen = $('modal').open;
  if (!alreadyOpen) beforeDialog = document.activeElement;
  dialogKind = kind; text('modal-eyebrow', eyebrow); text('modal-title', title);
  $('modal-body').replaceChildren(); $('modal-actions').replaceChildren();
  if (!alreadyOpen) $('modal').showModal();
  $('modal').scrollTop = 0;
  return $('modal-body');
}
function closeModal() { if ($('modal').open) $('modal').close(); dialogKind = null; }
function modalAction(label, action, primary = false, href = null) {
  const button = el(href ? 'a' : 'button', 'button ' + (primary ? 'button-primary' : 'button-secondary'), label);
  if (href) { button.href = href; button.target = '_top'; } else button.addEventListener('click', action);
  $('modal-actions').append(button); return button;
}
function safeAuthURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, location.origin); return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function signInLink() {
  if (hosted) return safeAuthURL(account.signinUrl);
  const completed = completedWatchForTransfer();
  return `${HOSTED_ORIGIN}/play/index.html${completed ? Transfer.encodeWatchFragment(completed) : ''}`;
}
function openPause() {
  if (locked) { finishBattle(); if (game.phase !== 'planning') return; }
  const body = openModal('pause', 'THE WATCH CAN WAIT', 'A moment ashore.');
  body.append(el('p', '', 'Your current watch is saved after each order. Return whenever you are ready.'));
  if (!storage || $('save-note').textContent) body.append(el('p', 'small-note', $('save-note').textContent || 'Saving is unavailable in this browser. Keep this tab open.'));
  modalAction('Resume the watch', closeModal, true); modalAction('Back to the harbor', showHome);
}
function openHelp() {
  const body = openModal('help', 'THE HARBOR MANUAL', 'Every order matters.');
  const steps = el('div', 'manual-steps');
  for (const [title, copy] of [
    ['Swap two neighbors', 'Tap a land piece, then a neighboring land square. Every swap costs one of your five orders. You can also drag a piece to its neighbor.'],
    ['Connect three. Build a machine.', 'Three matching materials connected along their edges become a machine at your destination. Three matching machines of the same tier become a stronger one. Machines reach tier III.'],
    ['Watch both sea lanes', 'Ships approach from the top toward the gates. Machine position and range matter. The forecast shows what your current defenses will stop.'],
    ['Commit to the tide', 'Defend whenever you are ready. Machines fire automatically, surviving ships damage the gates, and empty quays refill for your next five orders. Spare supplies refresh when they can restore a match. Hold through seven tides to win the daily watch.']
  ]) { const step = el('div', 'manual-step'), content = el('div'); content.append(el('strong', '', title), el('p', '', copy)); step.append(content); steps.append(step); }
  body.append(steps);
  const recipes = el('div', 'manual-recipes');
  const resourceKinds = Object.entries(Engine.KINDS || {}).filter(([, value]) => value.type === 'resource');
  for (const [kind, meta] of resourceKinds) {
    const item = el('div', 'manual-recipe'); item.append(el('span', '', '3 × ' + (meta.name || kind).toUpperCase()), el('strong', '', Engine.KINDS[meta.machine]?.name || 'Harbor machine'), el('small', '', Engine.KINDS[meta.machine]?.description || 'Merge matching machines to upgrade.')); recipes.append(item);
  }
  body.append(recipes, el('p', 'small-note', 'Undo returns an order and restores its exact board. Suggest highlights a useful swap. Arrow keys move between pieces. Enter or Space selects and swaps. Escape closes a dialog.'));
  modalAction('I have the watch', closeModal, true);
}
function openResult() {
  if (!game || !run || game.phase === 'planning') return;
  const victory = game.phase === 'victory', daily = run.mode === 'daily', body = openModal('result', daily ? 'THE WATCH IS OVER' : 'THE VOYAGE IS RECORDED', victory ? 'The harbor still stands.' : 'The sea found a way.');
  body.append(el('div', 'result-emblem', victory ? '☀' : '≈'));
  body.append(el('p', '', victory ? `${daily ? 'Seven' : game.tide} tides crossed the harbor. Your machines held the gates until dawn.` : `The gates fell on tide ${game.tide}. The next watch begins with everything you learned.`));
  const grid = el('div', 'result-grid');
  for (const [value, label] of [[game.score, 'SCORE'], [game.hull + '/' + game.maxHull, 'GATE STRENGTH'], [game.movesUsed, 'ORDERS USED']]) { const stat = el('div'); stat.append(el('strong', '', String(value)), el('span', '', label)); grid.append(stat); }
  body.append(grid);
  const sync = el('p', 'small-note'); sync.id = 'result-sync'; body.append(sync); updateResultSync();
  modalAction('Return to the harbor', showHome, true);
  modalAction(daily ? 'Sail this watch again' : 'Begin another voyage', () => startRun(run.mode, run.day || today(), true));
  if (daily && run.day === today() && !account.signedIn && signInLink()) modalAction(hosted ? 'Sign in & save this watch' : 'Open account play', null, false, signInLink());
}
function updateResultSync() { const node = $('result-sync'); if (node) node.textContent = run?.mode === 'voyage' ? 'This voyage is recorded on this device. Daily watches earn cabinet treasures.' : claiming ? 'Verifying the watch with the harbor…' : claimStatus || 'This watch is recorded on this device.'; }
function openCollection() {
  const p = progress(), body = openModal('collection', 'THE CAPTAIN’S CABINET', 'Small things, well earned.');
  body.append(el('p', '', 'Complete a daily watch on different days to recover treasures from the harbor. A difficult watch counts too. Replaying the same day does not add another day.'));
  body.append(el('p', 'small-note', `${p.days} ${p.days === 1 ? 'day' : 'days'} recorded ${p.source === 'account' ? 'in your account' : 'on this device'}.`));
  const grid = el('div', 'collection-grid');
  for (const reward of Content.REWARDS || []) {
    const threshold = reward.threshold ?? reward.days, earned = p.days >= threshold, card = el('div', 'collectible' + (earned ? ' earned' : ''));
    const art = el('div', 'collectible-art'); art.setAttribute('aria-hidden', 'true'); art.innerHTML = artifactSVG(reward.motif || reward.icon, earned);
    card.append(art, el('strong', '', reward.title || reward.name), el('small', '', earned ? reward.description : `${threshold} different daily watches`), el('small', 'earned-mark', earned ? 'COLLECTED' : `${Math.min(p.days, threshold)} / ${threshold} DAYS`)); grid.append(card);
  }
  body.append(grid); modalAction('Back to the harbor', closeModal, true);
  if (!account.signedIn && signInLink()) modalAction(hosted ? 'Sign in to keep your collection' : 'Open account play', null, false, signInLink());
}
function openAccount() {
  const p = progress(), body = openModal('account', 'YOUR LOGBOOK', account.signedIn ? account.profile?.alias || 'A captain of the Aegean.' : 'Keep a little history.');
  if (transferMessage) body.append(el('p', 'inline-note', transferMessage));
  if (accountLoading) body.append(el('p', '', 'Opening the harbor logbook…'));
  else if (account.signedIn) {
    body.append(el('span', 'status-tag', 'SIGNED IN · SAVED TO YOUR ACCOUNT'));
    const stats = el('div', 'profile-stats');
    for (const [value, label] of [[p.days, 'daily watches'], [unlockedRewards(p.days), 'treasures'], [Math.max(0, ...p.claims.map(c => c.score)), 'best score']]) { const stat = el('div'); stat.append(el('strong', '', String(value)), el('span', '', label)); stats.append(stat); }
    body.append(stats, el('p', '', 'Daily results are verified and saved across your devices. Your in-progress board and long voyages remain on this device.'));
    if (claimStatus) body.append(el('p', 'small-note', claimStatus));
    modalAction('Open the cabinet', openCollection, true);
    modalAction('Today’s captains', openRecords);
    const out = safeAuthURL(account.signoutUrl); if (out) modalAction('Sign out', null, false, out);
  } else {
    body.append(el('span', 'status-tag', 'PLAYING AS A GUEST'));
    body.append(el('p', '', hosted ? 'Your watches are saved in this browser. Sign in with ChatGPT to keep completed daily watches and your collection across devices.' : 'Your watches are saved in this browser. Open the hosted game to sign in with ChatGPT and save future daily watches across devices.'));
    if (!hosted) body.append(el('p', 'small-note', completedWatchForTransfer() ? 'Today’s completed watch will travel with you. Sign in there to add it to your account.' : 'Your existing browser save stays here. Account play opens a separate copy of the game.'));
    if (accountError) body.append(el('p', 'inline-note', accountError));
    const href = signInLink();
    if (href) modalAction(hosted ? 'Continue with ChatGPT' : 'Open account play', null, true, href);
    else if (hosted && !accountLoading) modalAction('Retry connection', () => { accountLoading = true; openAccount(); void loadAccount(); }, true);
    modalAction('Continue as guest', closeModal);
    if (hosted && accountAvailable) modalAction('Today’s captains', openRecords);
  }
  if (transferReviewDay && !accountLoading) modalAction('Review the transferred watch', () => startRun('daily', transferReviewDay));
}
async function openRecords() {
  const day = today(), body = openModal('records', 'THE DAILY LOGBOOK', 'Today’s captains.');
  body.append(el('p', 'small-note', `${formatDay(day)} · Verified daily watches. Captains use generated names.`));
  const listing = el('div', 'records-list'); listing.append(el('p', '', 'Opening the harbor records…')); body.append(listing);
  modalAction('Back to your logbook', openAccount);
  try {
    const data = await requestJSON('/api/leaderboard?day=' + encodeURIComponent(day));
    if (dialogKind !== 'records') return;
    listing.replaceChildren();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (!entries.length) listing.append(el('p', '', 'No watches have been recorded yet. The harbor is waiting for its first captain.'));
    entries.slice(0, 20).forEach((entry, index) => {
      const row = el('div', 'record-row'), identity = el('div'), result = el('div');
      identity.append(el('small', '', String(index + 1).padStart(2, '0')), el('strong', '', entry.alias || 'A harbor captain'));
      result.append(el('strong', '', Number(entry.score || 0).toLocaleString()), el('small', '', entry.phase === 'victory' ? `${entry.hull}/12 gates · held` : `Tide ${entry.tide} · fallen`));
      row.append(identity, result); listing.append(row);
    });
  } catch { if (dialogKind === 'records') listing.replaceChildren(el('p', '', 'The logbook is unavailable for a moment. Your own watch can still be played.')); }
}
function openArchive() {
  const body = openModal('archive', 'THE LAST SEVEN WATCHES', 'Return to another tide.');
  body.append(el('p', '', 'Earlier watches are open for practice. Only today’s watch can add a new day to your cabinet.'));
  const list = el('div', 'archive-list');
  for (let i = 0; i < 7; i++) {
    const day = dayBefore(today(), i), saved = peekRun('daily', day), row = el('button', 'archive-row'), left = el('div');
    left.append(el('strong', '', Content.themeForDay?.(day)?.title || 'Daily watch'), el('span', '', formatDay(day)));
    row.append(left, el('span', '', i === 0 ? 'TODAY ↗' : saved?.phase === 'planning' ? 'CONTINUE ↗' : 'PRACTICE ↗'));
    row.addEventListener('click', () => startRun('daily', day)); list.append(row);
  }
  body.append(list); modalAction('Close the logbook', closeModal);
}
function tone(type) {
  if (!soundOn) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
    audioContext ||= new Audio(); if (audioContext.state === 'suspended') void audioContext.resume().catch(() => {});
    const patterns = { select: [330], swap: [294, 392], merge: [392, 494, 587], defend: [147, 196], win: [392, 494, 587, 784], loss: [220, 165] };
    (patterns[type] || [330]).forEach((frequency, i) => {
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), at = audioContext.currentTime + i * .065;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.045, at + .012); gain.gain.exponentialRampToValueAtTime(.001, at + .24);
      oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(at); oscillator.stop(at + .25);
    });
  } catch { /* Sound is optional. The simulation never depends on audio. */ }
}
function renderSound() { $('sound-button').setAttribute('aria-pressed', String(soundOn)); $('sound-button').setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on'); $('sound-button').title = soundOn ? 'Sound on' : 'Sound off'; $('sound-button').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z${soundOn ? 'M17 8q4 4 0 8M19 5q7 7 0 14' : 'M17 9l5 6m0-6-5 6'}"/></svg>`; }

$('daily-play').addEventListener('click', () => startRun('daily', today()));
$('voyage-play').addEventListener('click', () => startRun('voyage'));
$('home-link').addEventListener('click', () => screen === 'game' && game?.phase === 'planning' ? openPause() : showHome());
$('collection-button').addEventListener('click', openCollection);
$('account-button').addEventListener('click', openAccount);
$('archive-button').addEventListener('click', openArchive);
$('help-button').addEventListener('click', openHelp);
$('pause-button').addEventListener('click', openPause);
$('undo-button').addEventListener('click', undoMove);
$('hint-button').addEventListener('click', () => { void suggestMove(); });
$('defend-button').addEventListener('click', defend);
$('sound-button').addEventListener('click', () => { soundOn = !soundOn; writeJSON('sound', soundOn); renderSound(); if (soundOn) tone('merge'); });
$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', event => { if (event.target !== $('modal')) return; const rect = $('modal').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeModal(); });
$('modal').addEventListener('close', () => { dialogKind = null; if (beforeDialog instanceof HTMLElement && beforeDialog.isConnected && !beforeDialog.closest('[hidden]')) beforeDialog.focus({ preventScroll: true }); });
window.addEventListener('storage', event => { if (event.key?.startsWith(PREFIX)) { refreshHome(); if (run && event.key === PREFIX + run.key && readRaw(run.key) !== expected.get(run.key)) note('Another tab has updated this watch. Your moves remain here, but will not replace its save.'); } });
window.addEventListener('hashchange', () => { if (hosted && location.hash?.startsWith('#watch=')) { readIncomingTransfer(); openAccount(); void loadAccount(); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshHome(); if (hosted) void loadAccount(); } });
setInterval(() => { refreshHome(); if (screen === 'game' && !locked) renderGame(); }, 60000);
renderSound(); refreshHome();
const lastView = readJSON('view', null);
if (lastView?.screen === 'game' && ['daily', 'voyage'].includes(lastView.mode) && (lastView.mode === 'voyage' || safeDay(lastView.day)) && peekRun(lastView.mode, lastView.day)) startRun(lastView.mode, lastView.day);
readIncomingTransfer();
if (transferMessage) openAccount();
if (hosted) void loadAccount();
