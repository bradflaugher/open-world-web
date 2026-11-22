// Main entry point for Open World (web port).
// Wires responsive canvas, kid-friendly touch joystick + tap-to-walk,
// keyboard controls, smart context action button, HUD, Map, and localStorage.

import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { SoundEngine } from './audio.js';
import { ITEM } from './world.js';
import { createPixelIcon } from './hud-icons.js';
import { ABILITY_CUTSCENES, renderCutsceneFrame } from './cutscene.js';

const SAVE_KEY = 'open_world_web_v1';
const SOUND_KEY = 'open_world_web_sound';

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const hud = $('hud');
const controls = $('controls');
const titleEl = $('title');
const mapModal = $('map-modal');
const mapCanvas = $('map-canvas');
const cutsceneModal = $('cutscene-modal');
const cutsceneCanvas = $('cutscene-canvas');
const stickEl = $('stick');
const stickKnob = $('stick-knob');
const toastEl = $('toast');

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveGame(game) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize()));
  } catch {
    // Private browsing or quota full
  }
}

const existingSave = loadSave();
const game = new Game(existingSave);
const renderer = new Renderer(canvas);
const sound = new SoundEngine();

try {
  if (localStorage.getItem(SOUND_KEY) === 'false') sound.setEnabled(false);
} catch {
  // ignore
}

let started = false;
let toastTimer = 0;
let cutsceneItem = null;
let cutsceneT = 0;
let cutsceneOpenedAt = 0;
let cutscenePrevFocus = null;

function showToast(msg, ms = 2400) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
}

// --- HUD & Title UI --------------------------------------------------------

const ITEM_META = [
  { id: ITEM.LANTERN, icon: 'lantern', name: 'Light' },
  { id: ITEM.STONES, icon: 'stones', name: 'Stones' },
  { id: ITEM.CLOAK, icon: 'cloak', name: 'Cloak' },
];

// Hydrate static pixel-art HUD icons and saved palette class once before title renders
$('btn-map').replaceChildren(createPixelIcon('map', 18));
$('btn-menu').replaceChildren(createPixelIcon('menu', 18));
$('btn-map-close').replaceChildren(createPixelIcon('close', 16));
document.body.classList.toggle('dmg', game.palette === 'dmg');

let lastHudSig = '';
let lastActSig = '';

function updateHud() {
  const embersFull = Math.ceil(game.warmth);
  const sig = `${embersFull}|${game.beaconsLit.join('')}|${game.stars}|${game.items.join('')}|${game.selectedItem}|${game.palette}|${sound.enabled}`;
  if (sig !== lastHudSig) {
    lastHudSig = sig;
    document.body.classList.toggle('dmg', game.palette === 'dmg');

    const embersEl = $('embers');
    embersEl.textContent = '';
    for (let i = 0; i < 4; i++) {
      embersEl.append(createPixelIcon(i < embersFull ? 'emberOn' : 'emberOff', 12));
    }

    const beaconsEl = $('beacons');
    beaconsEl.textContent = '';
    for (let i = 0; i < 3; i++) {
      beaconsEl.append(createPixelIcon(game.beaconsLit[i] ? 'beaconLit' : 'beaconOff', 12));
    }

    const starsEl = $('stars-pill');
    const starCount = document.createElement('span');
    starCount.textContent = String(game.stars);
    starsEl.replaceChildren(createPixelIcon('star', 11), starCount);

    $('btn-palette').classList.toggle('on', game.palette === 'dmg');
    $('btn-sound').replaceChildren(createPixelIcon(sound.enabled ? 'soundOn' : 'soundOff', 18));
    $('btn-sound').classList.toggle('muted', !sound.enabled);
    $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

    const bar = $('item-bar');
    bar.textContent = '';
    for (const m of ITEM_META) {
      if (!game.items[m.id]) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item-btn' + (game.selectedItem === m.id ? ' active' : '');
      btn.setAttribute('aria-label', m.name);
      btn.append(createPixelIcon(m.icon, 24));
      const lbl = document.createElement('span');
      lbl.textContent = m.name;
      btn.append(lbl);
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        sound.unlock();
        game.selectItem(m.id);
      });
      bar.append(btn);
    }
  }

  const act = game.getContextAction();
  const actSig = act ? `${act.kind}|${act.label}` : `none|${game.selectedItem}`;
  if (actSig !== lastActSig) {
    lastActSig = actSig;
    const btn = $('btn-act');
    const iconEl = $('act-icon');
    if (act) {
      btn.classList.add('ready');
      const iconName = act.icon === 'flame' ? 'flame' : act.icon === 'stone' ? 'stones' : act.icon === 'cloak' ? 'cloak' : act.icon === 'gift' ? 'gift' : act.icon === 'star' ? 'heart' : 'star';
      iconEl.replaceChildren(createPixelIcon(iconName, 26));
      $('act-label').textContent = act.label;
    } else {
      btn.classList.remove('ready');
      iconEl.replaceChildren(createPixelIcon(ITEM_META[game.selectedItem]?.icon || 'lantern', 24));
      $('act-label').textContent = 'Act';
    }
  }
}

function updateTitleButtons() {
  const hasSave = Boolean(loadSave());
  $('btn-play').textContent = hasSave ? 'Continue' : 'Play';
  $('btn-new-world').hidden = !hasSave;
}

function openGame() {
  started = true;
  sound.unlock();
  titleEl.hidden = true;
  hud.hidden = false;
  controls.hidden = false;
  handleResize();
  updateHud();
}

function openTitle() {
  started = false;
  mapModal.hidden = true;
  cutsceneModal.hidden = true;
  cutsceneItem = null;
  hud.hidden = true;
  controls.hidden = true;
  handleResize();
  updateTitleButtons();
  titleEl.hidden = false;
}

function showCutscene(item) {
  const meta = ABILITY_CUTSCENES[item];
  if (!meta) return;
  cutscenePrevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  cutsceneItem = item;
  cutsceneT = 0;
  cutsceneOpenedAt = performance.now();
  mapModal.hidden = true;
  keys.clear();
  actPointerHeld = false;
  stick = null;
  stickEl.hidden = true;
  stickKnob.style.transform = '';
  $('cutscene-eyebrow').textContent = meta.eyebrow;
  $('cutscene-icon').replaceChildren(createPixelIcon(meta.icon, 26));
  $('cutscene-title').textContent = meta.title;
  $('cutscene-summary').textContent = meta.summary;
  $('cutscene-hint').textContent = meta.hint;
  renderCutsceneFrame(cutsceneCanvas, item, 0, game.palette);
  cutsceneModal.hidden = false;
  $('btn-cutscene-close').focus({ preventScroll: true });
}

function closeCutscene(force = false) {
  if (cutsceneModal.hidden) return;
  if (!force && performance.now() - cutsceneOpenedAt < 450) return;
  cutsceneModal.hidden = true;
  cutsceneItem = null;
  if (cutscenePrevFocus && cutscenePrevFocus.isConnected) {
    cutscenePrevFocus.focus({ preventScroll: true });
  }
  cutscenePrevFocus = null;
}

function toggleMap(force) {
  if (!cutsceneModal.hidden) return;
  const show = force !== undefined ? force : mapModal.hidden;
  mapModal.hidden = !show;
  if (show) {
    $('map-title').textContent = `World #${game.worldNumber} · ★ ${game.stars}`;
    renderer.renderMap(mapCanvas, game);
  }
}

$('btn-play').addEventListener('click', openGame);
$('btn-new-world').addEventListener('click', () => {
  sound.unlock();
  game.newWorld(undefined, false);
  saveGame(game);
  openGame();
});
$('btn-map').addEventListener('click', () => toggleMap());
$('btn-map-close').addEventListener('click', () => toggleMap(false));
mapModal.addEventListener('click', (e) => {
  if (e.target === mapModal) toggleMap(false);
});
$('btn-cutscene-close').addEventListener('click', () => closeCutscene(true));
cutsceneModal.addEventListener('click', (e) => {
  if (e.target === cutsceneModal) closeCutscene(false);
});
$('btn-palette').addEventListener('click', () => {
  game.palette = game.palette === 'dmg' ? 'color' : 'dmg';
  saveGame(game);
  updateHud();
});
$('btn-sound').addEventListener('click', () => {
  sound.setEnabled(!sound.enabled);
  try {
    localStorage.setItem(SOUND_KEY, String(sound.enabled));
  } catch {
    // ignore
  }
  updateHud();
});
$('btn-menu').addEventListener('click', () => {
  saveGame(game);
  openTitle();
});
let actPointerHeld = false;
const actBtn = $('btn-act');
actBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sound.unlock();
  actPointerHeld = true;
  actBtn.setPointerCapture(e.pointerId);
  game.performAction();
});
const releaseAct = () => {
  actPointerHeld = false;
};
actBtn.addEventListener('pointerup', releaseAct);
actBtn.addEventListener('pointercancel', releaseAct);
actBtn.addEventListener('click', (e) => {
  // Fallback for synthetic/keyboard clicks when pointerdown didn't fire
  if (e.detail === 0) {
    sound.unlock();
    game.performAction();
  }
});

// --- Input: Keyboard + Floating Touch Thumbstick + Tap-to-Walk -------------

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (!cutsceneModal.hidden) {
    if (e.key === 'Tab') {
      e.preventDefault();
      $('btn-cutscene-close').focus({ preventScroll: true });
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) closeCutscene(false);
    }
    return;
  }
  if (e.key === 'Escape') {
    if (!mapModal.hidden) {
      e.preventDefault();
      toggleMap(false);
    }
    return;
  }
  if (!started) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openGame();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'm') {
    e.preventDefault();
    toggleMap();
    return;
  }
  if (k === 'p') {
    game.palette = game.palette === 'dmg' ? 'color' : 'dmg';
    saveGame(game);
    return;
  }
  if (!mapModal.hidden) return;
  if (k === ' ' || k === 'enter' || k === 'z') {
    e.preventDefault();
    keys.add(k);
    if (!e.repeat) {
      sound.unlock();
      game.performAction();
    }
    return;
  }
  if (k === 'tab' || k === 'e' || k === 'q') {
    e.preventDefault();
    sound.unlock();
    game.cycleItem();
    return;
  }
  keys.add(k);
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
});

window.addEventListener('blur', () => {
  keys.clear();
  actPointerHeld = false;
  stick = null;
  stickEl.hidden = true;
  stickKnob.style.transform = '';
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    keys.clear();
    actPointerHeld = false;
  }
});

// Touch / pointer floating joystick & tap-to-walk on the canvas
let stick = null; // { id, x0, y0, mx, my, moved }

canvas.addEventListener('pointerdown', (e) => {
  if (!started || !mapModal.hidden || !cutsceneModal.hidden || e.button > 0) return;
  sound.unlock();
  canvas.setPointerCapture(e.pointerId);
  stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mx: 0, my: 0, moved: false };
});

canvas.addEventListener('pointermove', (e) => {
  if (!stick || e.pointerId !== stick.id) return;
  const dx = e.clientX - stick.x0;
  const dy = e.clientY - stick.y0;
  const dist = Math.hypot(dx, dy);
  if (!stick.moved && dist > 12) {
    stick.moved = true;
    stickEl.hidden = false;
    stickEl.style.left = `${stick.x0}px`;
    stickEl.style.top = `${stick.y0}px`;
  }
  if (stick.moved) {
    const maxR = 46;
    const clamped = Math.min(maxR, dist);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    stick.mx = (nx * clamped) / maxR;
    stick.my = (ny * clamped) / maxR;
    stickKnob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
  }
});

function releaseStick(e) {
  if (!stick || e.pointerId !== stick.id) return;
  const wasDrag = stick.moved;
  stick = null;
  stickEl.hidden = true;
  stickKnob.style.transform = '';
  if (!wasDrag && started && mapModal.hidden && cutsceneModal.hidden) {
    // Tap-to-walk: walk right to the tapped tile!
    const rect = canvas.getBoundingClientRect();
    const target = renderer.screenToWorld(game, e.clientX - rect.left, e.clientY - rect.top);
    if (target) game.walkTarget = target;
  }
}

canvas.addEventListener('pointerup', releaseStick);
canvas.addEventListener('pointercancel', releaseStick);

function readInput() {
  let mx = 0;
  let my = 0;
  let run = keys.has('shift') || keys.has('x') || keys.has('b');

  if (keys.has('arrowleft') || keys.has('a')) mx -= 1;
  if (keys.has('arrowright') || keys.has('d')) mx += 1;
  if (keys.has('arrowup') || keys.has('w')) my -= 1;
  if (keys.has('arrowdown') || keys.has('s')) my += 1;

  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    mx /= len;
    my /= len;
  } else if (stick && stick.moved) {
    mx = stick.mx;
    my = stick.my;
    if (Math.hypot(mx, my) > 0.82) run = true;
  }
  const actHeld = actPointerHeld || keys.has(' ') || keys.has('z') || keys.has('enter');
  return { mx, my, run, actHeld };
}

// --- Main Loop -------------------------------------------------------------

function handleResize() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || window.innerWidth));
  const h = Math.max(1, Math.round(rect.height || window.innerHeight));
  renderer.resize(w, h, window.devicePixelRatio);
  toastEl.style.top = `${Math.round(rect.top + renderer.horizonH * renderer.scale + 12)}px`;
}
window.addEventListener('resize', handleResize);
handleResize();
updateTitleButtons();

let lastTs = performance.now();
let saveAccum = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastTs) / 1000);
  lastTs = now;

  const playing = started && mapModal.hidden && cutsceneModal.hidden;
  if (playing) {
    game.update(dt, readInput());
    sound.update(dt, game.currentBiome(), game.litBeaconCount);
  } else {
    game.time += dt;
    if (!cutsceneModal.hidden && cutsceneItem !== null) {
      cutsceneT += dt;
      renderCutsceneFrame(cutsceneCanvas, cutsceneItem, cutsceneT, game.palette);
    }
  }

  for (const ev of game.drainEvents()) {
    sound.handleEvent(ev);
    if (ev.type === 'fire-lit') {
      saveGame(game);
      showToast('Fire lit · Progress saved');
    } else if (ev.type === 'beacon-lit') {
      saveGame(game);
      showToast(ev.allLit ? 'All 3 beacons lit · The Heart rises!' : `Beacon ${ev.count} of 3 lit!`);
    } else if (ev.type === 'item-found') {
      saveGame(game);
      showCutscene(ev.item);
    } else if (ev.type === 'wisp-collected') {
      saveGame(game);
      showToast(`★ Star ${ev.stars} rose into the sky`);
    } else if (ev.type === 'heart-reached') {
      showToast('The world dissolves into a new dawn…', 3000);
    } else if (ev.type === 'world-reset') {
      saveGame(game);
    }
  }

  if (playing || !cutsceneModal.hidden) {
    updateHud();
  }
  if (playing) {
    saveAccum += dt;
    if (saveAccum >= 12) {
      saveAccum = 0;
      saveGame(game);
    }
  }

  renderer.render(game, dt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Expose hooks for automated playtesting
window.__ow = { game, renderer, sound, openGame, toggleMap, showCutscene, closeCutscene };
