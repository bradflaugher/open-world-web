// Main entry point for Open World (web port).
// Wires responsive canvas, kid-friendly touch joystick + tap-to-walk,
// keyboard controls, smart context action button, HUD, Map, and localStorage.

import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { SoundEngine } from './audio.js';
import { ITEM } from './world.js';

const SAVE_KEY = 'open_world_web_v1';
const SOUND_KEY = 'open_world_web_sound';

const $ = (id) => document.getElementById(id);

const canvas = $('canvas');
const hud = $('hud');
const controls = $('controls');
const titleEl = $('title');
const mapModal = $('map-modal');
const mapCanvas = $('map-canvas');
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
  { id: ITEM.LANTERN, icon: '🏮', name: 'Light' },
  { id: ITEM.STONES, icon: '🪨', name: 'Stones' },
  { id: ITEM.CLOAK, icon: '🪽', name: 'Cloak' },
];

let lastHudSig = '';
let lastActSig = '';

function updateHud() {
  const embersFull = Math.ceil(game.warmth);
  const sig = `${embersFull}|${game.beaconsLit.join('')}|${game.stars}|${game.items.join('')}|${game.selectedItem}|${game.palette}|${sound.enabled}`;
  if (sig !== lastHudSig) {
    lastHudSig = sig;
    const embersEl = $('embers');
    embersEl.textContent = '';
    for (let i = 0; i < 4; i++) {
      const e = document.createElement('span');
      e.className = 'ember' + (i < embersFull ? ' on' : '');
      embersEl.append(e);
    }

    const beaconsEl = $('beacons');
    beaconsEl.textContent = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'bdot' + (game.beaconsLit[i] ? ' lit' : '');
      beaconsEl.append(d);
    }

    $('stars-pill').textContent = `★ ${game.stars}`;
    $('btn-palette').classList.toggle('on', game.palette === 'dmg');
    $('btn-sound').style.opacity = sound.enabled ? '1' : '0.45';
    $('btn-sound').setAttribute('aria-pressed', String(sound.enabled));

    const bar = $('item-bar');
    bar.textContent = '';
    for (const m of ITEM_META) {
      if (!game.items[m.id]) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item-btn' + (game.selectedItem === m.id ? ' active' : '');
      btn.setAttribute('aria-label', m.name);
      btn.textContent = m.icon;
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
  const actSig = act ? `${act.kind}|${act.label}` : 'none';
  if (actSig !== lastActSig) {
    lastActSig = actSig;
    const btn = $('btn-act');
    if (act) {
      btn.classList.add('ready');
      $('act-icon').textContent = act.icon === 'flame' ? '🔥' : act.icon === 'stone' ? '🪨' : act.icon === 'cloak' ? '🪽' : act.icon === 'gift' ? '✦' : act.icon === 'star' ? '★' : '✨';
      $('act-label').textContent = act.label;
    } else {
      btn.classList.remove('ready');
      $('act-icon').textContent = ITEM_META[game.selectedItem]?.icon || '🏮';
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
  updateHud();
}

function openTitle() {
  started = false;
  mapModal.hidden = true;
  hud.hidden = true;
  controls.hidden = true;
  updateTitleButtons();
  titleEl.hidden = false;
}

function toggleMap(force) {
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
$('btn-act').addEventListener('click', () => {
  sound.unlock();
  game.performAction();
});

// --- Input: Keyboard + Floating Touch Thumbstick + Tap-to-Walk -------------

const keys = new Set();
window.addEventListener('keydown', (e) => {
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
    sound.unlock();
    game.performAction();
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

// Touch / pointer floating joystick & tap-to-walk on the canvas
let stick = null; // { id, x0, y0, mx, my, moved }

canvas.addEventListener('pointerdown', (e) => {
  if (!started || !mapModal.hidden || e.button > 0) return;
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
  if (!wasDrag && started && mapModal.hidden) {
    // Tap-to-walk: walk right to the tapped tile!
    const target = renderer.screenToWorld(game, e.clientX, e.clientY);
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
  return { mx, my, run };
}

// --- Main Loop -------------------------------------------------------------

function handleResize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
}
window.addEventListener('resize', handleResize);
handleResize();
updateTitleButtons();

let lastTs = performance.now();
let saveAccum = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - lastTs) / 1000);
  lastTs = now;

  const input = started && mapModal.hidden ? readInput() : { mx: 0, my: 0, run: false };
  game.update(dt, input);
  sound.update(dt, game.currentBiome(), game.litBeaconCount);

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
      showToast(ev.item === ITEM.STONES ? 'Claimed Stones · Bridge shallows & build cairns' : 'Claimed Cloak · Glide across rock & water');
    } else if (ev.type === 'wisp-collected') {
      saveGame(game);
      showToast(`★ Star ${ev.stars} rose into the sky`);
    } else if (ev.type === 'heart-reached') {
      saveGame(game);
      showToast('The world dissolves into a new dawn…', 3000);
    }
  }

  if (started) {
    updateHud();
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
window.__ow = { game, renderer, sound, openGame, toggleMap };
