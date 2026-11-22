// Core simulation for Open World (web port).
// Pure ES module (no DOM dependency) so all mechanics are testable in Node.

import {
  World, MT, MTF, BIOME, ITEM, MAX_STARS, MAX_OLD_CAIRNS,
  wrapCoord, wrapDelta,
} from './world.js';

export const DAY_DURATION_SEC = 480; // 8-minute day/night cycle
export const WALK_SPEED = 4.2; // tiles/sec
export const RUN_SPEED = 7.0; // tiles/sec
export const GLIDE_SPEED = 11.5; // tiles/sec

export class Game {
  constructor(saved = null) {
    this.events = []; // transient events consumed by renderer/audio each frame
    this.particles = [];
    this.birds = [];
    this.fireflies = [];
    this.watchers = [];
    this.footprints = [];
    this.walkTarget = null; // optional tap-to-walk { x, y }
    this.glide = null; // active glide { sx, sy, ex, ey, t, dur }
    this.glideBuffer = 0; // input buffer so pressing/holding Act near landing chains glides
    this.actCooldown = 0; // brief cooldown for continuous run-and-place rocks/brambles
    this.transition = null; // { kind: 'wake' | 'heart', t, dur, swapped }
    this.idleSec = 0;
    this.sitting = false;
    this.stepAccum = 0;
    this.dayCount = 0;
    this.time = 0;
    this.palette = 'color'; // 'color' | 'dmg'

    if (saved) {
      this._loadState(saved);
    } else {
      this._startFreshWorld((Math.floor(Math.random() * 65535) + 1) & 0xffff, 3, [], 1);
    }
  }

  _startFreshWorld(seed, stars, oldCairns, worldNumber) {
    this.world = new World(seed, oldCairns);
    this.worldNumber = worldNumber;
    this.stars = Math.min(MAX_STARS, Math.max(3, stars));
    this.player = {
      x: this.world.start.x + 0.5,
      y: this.world.start.y + 1.5,
      fx: 0,
      fy: -1, // facing north toward the cold fire & horizon
      moving: false,
      running: false,
      anim: 0,
    };
    this.lastFire = { x: this.world.start.x + 0.5, y: this.world.start.y + 1.5 };
    this.items = [true, false, false]; // [Lantern, Stones, Cloak]
    this.selectedItem = ITEM.LANTERN;
    this.beaconsLit = [false, false, false];
    this.shrinesClaimed = [false, false];
    this.warmth = 4.0;
    this.dayTime = 0.22; // bright morning
    this.visited = new Set();
    this.visited.add(`${Math.floor(this.player.x) >> 1},${Math.floor(this.player.y) >> 1}`);
    this.walkTarget = null;
    this.glide = null;
    this.sitting = false;
    this.idleSec = 0;
    this.birds = [];
    this.fireflies = [];
    this.watchers = [];
    this.footprints = [];
  }

  _loadState(s) {
    const oldCairns = Array.isArray(s.oldCairns) ? s.oldCairns.slice(0, MAX_OLD_CAIRNS) : [];
    const seed = typeof s.seed === 'number' ? (s.seed & 0xffff) : 1;
    this._startFreshWorld(seed, typeof s.stars === 'number' ? s.stars : 3, oldCairns, s.worldNumber || 1);
    if (Array.isArray(s.mods)) {
      for (const [x, y, mt] of s.mods) {
        if (typeof x === 'number' && typeof y === 'number' && typeof mt === 'number') {
          this.world.setMod(x, y, mt);
        }
      }
    }
    if (Array.isArray(s.cairns)) {
      this.world.cairns = s.cairns.filter((c) => c && typeof c.x === 'number' && typeof c.y === 'number');
    }
    if (Array.isArray(s.collectedWisps)) {
      this.world.collectedWisps = new Set(s.collectedWisps.filter((k) => typeof k === 'string'));
    }
    if (s.player && typeof s.player.x === 'number' && typeof s.player.y === 'number') {
      this.player.x = s.player.x;
      this.player.y = s.player.y;
      if (typeof s.player.fx === 'number') this.player.fx = s.player.fx;
      if (typeof s.player.fy === 'number') this.player.fy = s.player.fy;
    }
    if (s.lastFire && typeof s.lastFire.x === 'number' && typeof s.lastFire.y === 'number') {
      this.lastFire = { x: s.lastFire.x, y: s.lastFire.y };
    }
    if (Array.isArray(s.items) && s.items.length === 3) {
      this.items = [true, Boolean(s.items[1]), Boolean(s.items[2])];
    }
    if (typeof s.selectedItem === 'number' && this.items[s.selectedItem]) {
      this.selectedItem = s.selectedItem;
    }
    if (Array.isArray(s.beaconsLit) && s.beaconsLit.length === 3) {
      this.beaconsLit = s.beaconsLit.map(Boolean);
    }
    if (Array.isArray(s.shrinesClaimed) && s.shrinesClaimed.length === 2) {
      this.shrinesClaimed = s.shrinesClaimed.map(Boolean);
    }
    if (typeof s.warmth === 'number') this.warmth = Math.max(0.5, Math.min(4, s.warmth));
    if (typeof s.dayTime === 'number') this.dayTime = ((s.dayTime % 1) + 1) % 1;
    if (Array.isArray(s.visited)) {
      this.visited = new Set(s.visited.slice(-3000).filter((k) => typeof k === 'string'));
    }
    if (s.palette === 'dmg' || s.palette === 'color') this.palette = s.palette;
  }

  serialize() {
    const mods = [];
    for (const [k, mt] of this.world.mods) {
      const [x, y] = k.split(',').map(Number);
      mods.push([x, y, mt]);
    }
    return {
      v: 1,
      seed: this.world.seed,
      worldNumber: this.worldNumber,
      stars: this.stars,
      oldCairns: this.world.oldCairns,
      mods,
      cairns: this.world.cairns,
      collectedWisps: [...this.world.collectedWisps],
      player: { x: this.player.x, y: this.player.y, fx: this.player.fx, fy: this.player.fy },
      lastFire: this.lastFire,
      items: this.items,
      selectedItem: this.selectedItem,
      beaconsLit: this.beaconsLit,
      shrinesClaimed: this.shrinesClaimed,
      warmth: this.warmth,
      dayTime: this.dayTime,
      visited: [...this.visited].slice(-3000),
      palette: this.palette,
    };
  }

  newWorld(seed = ((Math.floor(Math.random() * 65535) + 1) & 0xffff), carryLegacy = false) {
    const newCairns = carryLegacy
      ? this.world.cairns.map((c) => ({
        dx: Math.max(-120, Math.min(120, wrapDelta(this.world.start.x, c.x))),
        dy: Math.max(-120, Math.min(120, wrapDelta(this.world.start.y, c.y))),
      }))
      : [];
    const oldCairns = carryLegacy
      ? [...this.world.oldCairns, ...newCairns].slice(-MAX_OLD_CAIRNS)
      : [];
    const nextStars = carryLegacy ? this.stars : 3;
    const nextNum = carryLegacy ? this.worldNumber + 1 : 1;
    this._startFreshWorld(seed, nextStars, oldCairns, nextNum);
    this.emit('world-reset', { seed, worldNumber: nextNum });
  }

  emit(type, payload = {}) {
    this.events.push({ type, ...payload });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  get allBeaconsLit() {
    return this.beaconsLit[0] && this.beaconsLit[1] && this.beaconsLit[2];
  }

  get litBeaconCount() {
    return (this.beaconsLit[0] ? 1 : 0) + (this.beaconsLit[1] ? 1 : 0) + (this.beaconsLit[2] ? 1 : 0);
  }

  get nightAmount() {
    // 0 during bright day, 1 at deep night, smooth transitions at dawn & dusk.
    const t = this.dayTime;
    if (t >= 0.16 && t <= 0.58) return 0;
    if (t >= 0.76 || t <= 0.04) return 1;
    if (t > 0.58 && t < 0.76) return (t - 0.58) / 0.18;
    return 1 - (t - 0.04) / 0.12;
  }

  get duskAmount() {
    const t = this.dayTime;
    if (t > 0.55 && t < 0.78) return Math.sin(((t - 0.55) / 0.23) * Math.PI);
    if (t > 0.02 && t < 0.18) return Math.sin(((t - 0.02) / 0.16) * Math.PI) * 0.85;
    return 0;
  }

  currentBiome() {
    return this.world.biomeAt(Math.floor(this.player.x), Math.floor(this.player.y));
  }

  currentWeather() {
    const b = this.currentBiome();
    const wx = Math.floor(this.player.x) >> 5;
    const wy = Math.floor(this.player.y) >> 5;
    const h = ((wx * 73 + wy * 151 + this.dayCount * 37 + this.world.seed) & 255);
    if (b === BIOME.TUNDRA) return h < 140 ? 'snow' : 'clear';
    if (b === BIOME.DESERT) return 'clear';
    if (b === BIOME.ASH) return h < 120 ? 'fog' : 'clear';
    if (h < 42) return 'rain';
    if (h < 68) return 'fog';
    return 'clear';
  }

  isSolid(tx, ty) {
    return (this.world.flagsAt(tx, ty) & MTF.SOLID) !== 0;
  }

  isNearWarmth(px = this.player.x, py = this.player.y) {
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (this.world.flagsAt(cx + dx, cy + dy) & MTF.WARM) return true;
      }
    }
    return false;
  }

  isHidden() {
    return (this.world.flagsAt(Math.floor(this.player.x), Math.floor(this.player.y)) & MTF.HIDE) !== 0;
  }

  cycleItem() {
    const owned = [0, 1, 2].filter((i) => this.items[i]);
    if (owned.length <= 1) return this.selectedItem;
    const idx = owned.indexOf(this.selectedItem);
    this.selectedItem = owned[(idx + 1) % owned.length];
    this.emit('item-switch', { item: this.selectedItem });
    return this.selectedItem;
  }

  selectItem(item) {
    if (this.items[item]) {
      this.selectedItem = item;
      this.emit('item-switch', { item });
    }
  }

  _findGlideLanding(fx, fy) {
    // Facing unit step (8-way), plus fallback to cardinal axes if diagonal is blocked.
    const dirs = [[Math.round(fx), Math.round(fy)]];
    if (dirs[0][0] !== 0 && dirs[0][1] !== 0) {
      dirs.push([dirs[0][0], 0], [0, dirs[0][1]]);
    }
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);

    for (const [dx, dy] of dirs) {
      if (dx === 0 && dy === 0) continue;
      const t1x = wrapCoord(px + dx);
      const t1y = wrapCoord(py + dy);
      if (!(this.world.flagsAt(t1x, t1y) & MTF.GLIDE)) continue;
      // Try 3 cells, then 2, then 4 (faithful to the Game Boy cloak!).
      for (const dist of [3, 2, 4]) {
        const lx = wrapCoord(px + dx * dist);
        const ly = wrapCoord(py + dy * dist);
        if (this.isSolid(lx, ly)) continue;
        // Make sure intermediate cells are glideable or open
        let clear = true;
        for (let s = 1; s < dist; s++) {
          const ix = wrapCoord(px + dx * s);
          const iy = wrapCoord(py + dy * s);
          const f = this.world.flagsAt(ix, iy);
          if ((f & MTF.SOLID) && !(f & MTF.GLIDE)) {
            clear = false;
            break;
          }
        }
        if (clear) return { x: lx, y: ly, dx, dy, dist };
      }
    }
    return null;
  }

  // Kid-friendly smart context resolver: inspects the tile in front of the player
  // (plus immediate neighbors for forgiving touch targeting) and returns the best action.
  getContextAction() {
    if (this.glide || this.transition) return null;
    const px = Math.floor(this.player.x);
    const py = Math.floor(this.player.y);
    const fx = Math.round(this.player.fx);
    const fy = Math.round(this.player.fy);
    const frontX = wrapCoord(px + fx);
    const frontY = wrapCoord(py + fy);

    // Candidate cells ordered by priority: directly in front first, then adjacent cardinals.
    const candidates = [
      { x: frontX, y: frontY, direct: true },
      { x: wrapCoord(px), y: wrapCoord(py - 1), direct: false },
      { x: wrapCoord(px), y: wrapCoord(py + 1), direct: false },
      { x: wrapCoord(px - 1), y: wrapCoord(py), direct: false },
      { x: wrapCoord(px + 1), y: wrapCoord(py), direct: false },
    ];

    const seen = new Set();
    let secondary = null;

    for (const c of candidates) {
      const k = `${c.x},${c.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const mt = this.world.mtAt(c.x, c.y);

      if (mt === MT.SHRINE) {
        return { kind: 'shrine', x: c.x, y: c.y, item: null, label: 'Claim', icon: 'gift' };
      }
      if (mt === MT.BEACON) {
        return { kind: 'light-beacon', x: c.x, y: c.y, item: ITEM.LANTERN, label: 'Light', icon: 'flame' };
      }
      if (mt === MT.HEART && this.allBeaconsLit) {
        return { kind: 'heart', x: c.x, y: c.y, item: null, label: 'Heart', icon: 'star' };
      }
      if (mt === MT.FIRE_COLD) {
        return { kind: 'light-fire', x: c.x, y: c.y, item: ITEM.LANTERN, label: 'Light', icon: 'flame' };
      }
      if (mt === MT.BRAMBLE && c.direct) {
        return { kind: 'burn', x: c.x, y: c.y, item: ITEM.LANTERN, label: 'Burn', icon: 'flame' };
      }
      if (mt === MT.SHALLOW && this.items[ITEM.STONES] && c.direct) {
        return { kind: 'stepstone', x: c.x, y: c.y, item: ITEM.STONES, label: 'Stone', icon: 'stone' };
      }
      if (mt === MT.CAIRN && this.items[ITEM.STONES] && c.direct) {
        return { kind: 'pickup-cairn', x: c.x, y: c.y, item: ITEM.STONES, label: 'Take', icon: 'stone' };
      }
      if (!secondary && (mt === MT.BRAMBLE)) {
        secondary = { kind: 'burn', x: c.x, y: c.y, item: ITEM.LANTERN, label: 'Burn', icon: 'flame' };
      }
      if (!secondary && mt === MT.SHALLOW && this.items[ITEM.STONES]) {
        secondary = { kind: 'stepstone', x: c.x, y: c.y, item: ITEM.STONES, label: 'Stone', icon: 'stone' };
      }
      if (!secondary && (mt === MT.FIRE_LIT || mt === MT.BEACON_LIT)) {
        secondary = { kind: 'sit', x: c.x, y: c.y, item: null, label: 'Rest', icon: 'rest' };
      }
    }

    if (this.items[ITEM.CLOAK]) {
      const landing = this._findGlideLanding(this.player.fx, this.player.fy);
      if (landing) {
        return { kind: 'glide', x: landing.x, y: landing.y, landing, item: ITEM.CLOAK, label: 'Glide', icon: 'cloak' };
      }
    }

    if (secondary) return secondary;

    // Building a cairn on open ground when Stones is manually selected.
    if (this.selectedItem === ITEM.STONES && this.items[ITEM.STONES] && !this.isSolid(frontX, frontY)) {
      const mt = this.world.mtAt(frontX, frontY);
      if (mt !== MT.ROAD && mt !== MT.STEPSTONE) {
        return { kind: 'build-cairn', x: frontX, y: frontY, item: ITEM.STONES, label: 'Cairn', icon: 'stone' };
      }
    }

    return null;
  }

  performAction(continuous = false) {
    // Buffer glide input when Act is pressed mid-glide so players can chain glides seamlessly!
    if (this.glide) {
      this.glideBuffer = 0.24;
      return false;
    }
    const act = this.getContextAction();
    if (!act) return false;
    // Continuous hold only auto-fires traversal actions (stepping stones, burning brambles, gliding)
    // so holding Act while sprinting never accidentally sits down or picks up cairns.
    if (continuous && act.kind !== 'stepstone' && act.kind !== 'burn' && act.kind !== 'glide') {
      return false;
    }
    // Keep movement/walkTarget flowing when placing rocks, burning brambles, or gliding!
    if (act.kind !== 'stepstone' && act.kind !== 'burn' && act.kind !== 'glide' && act.kind !== 'build-cairn') {
      this.walkTarget = null;
    }
    this.sitting = false;
    this.idleSec = 0;
    this.actCooldown = 0.14;

    // Auto-select the appropriate carried item so kids never get stuck switching items.
    if (act.item !== null && this.items[act.item]) {
      this.selectedItem = act.item;
    }

    switch (act.kind) {
      case 'light-fire': {
        this.world.setMod(act.x, act.y, MT.FIRE_LIT);
        this.lastFire = { x: this.player.x, y: this.player.y };
        this.warmth = 4.0;
        this._burstParticles(act.x + 0.5, act.y + 0.5, 16, 'fire');
        this.emit('fire-lit', { x: act.x, y: act.y });
        return true;
      }
      case 'light-beacon': {
        this.world.setMod(act.x, act.y, MT.BEACON_LIT);
        this.lastFire = { x: this.player.x, y: this.player.y };
        this.warmth = 4.0;
        const idx = this.world.beacons.findIndex((b) => b.x === act.x && b.y === act.y);
        if (idx >= 0) this.beaconsLit[idx] = true;
        this._burstParticles(act.x + 0.5, act.y + 0.3, 36, 'beacon');
        this.emit('beacon-lit', { index: idx, count: this.litBeaconCount, allLit: this.allBeaconsLit });
        return true;
      }
      case 'burn': {
        this.world.setMod(act.x, act.y, MT.ASH);
        this._burstParticles(act.x + 0.5, act.y + 0.5, 18, 'fire');
        this.emit('bramble-burnt', { x: act.x, y: act.y });
        return true;
      }
      case 'shrine': {
        this.world.setMod(act.x, act.y, MT.SHRINE_EMPTY);
        const idx = this.world.shrines.findIndex((s) => s.x === act.x && s.y === act.y);
        const granted = idx === 1 ? ITEM.CLOAK : ITEM.STONES;
        this.items[granted] = true;
        this.selectedItem = granted;
        if (idx >= 0 && idx < 2) this.shrinesClaimed[idx] = true;
        this._burstParticles(act.x + 0.5, act.y + 0.4, 28, 'star');
        this.emit('item-found', { item: granted });
        return true;
      }
      case 'stepstone': {
        this.world.setMod(act.x, act.y, MT.STEPSTONE);
        this._burstParticles(act.x + 0.5, act.y + 0.5, 12, 'splash');
        this.emit('stepstone', { x: act.x, y: act.y });
        return true;
      }
      case 'build-cairn': {
        this.world.placeCairn(act.x, act.y);
        this._burstParticles(act.x + 0.5, act.y + 0.5, 10, 'dust');
        this.emit('cairn-built', { x: act.x, y: act.y });
        return true;
      }
      case 'pickup-cairn': {
        this.world.removeCairn(act.x, act.y);
        this._burstParticles(act.x + 0.5, act.y + 0.5, 8, 'dust');
        this.emit('cairn-removed', { x: act.x, y: act.y });
        return true;
      }
      case 'glide': {
        const { x, y, dist } = act.landing;
        const sx = this.player.x;
        const sy = this.player.y;
        const ex = sx + wrapDelta(Math.floor(sx), x) + (0.5 - (sx - Math.floor(sx)));
        const ey = sy + wrapDelta(Math.floor(sy), y) + (0.5 - (sy - Math.floor(sy)));
        this.glide = { sx, sy, ex, ey, t: 0, dur: Math.max(0.22, dist / GLIDE_SPEED) };
        this._burstParticles(sx, sy, 14, 'wind');
        this.emit('glide', { dist });
        return true;
      }
      case 'sit': {
        this.sitting = true;
        this.warmth = Math.min(4, this.warmth + 0.8);
        this.emit('sit');
        return true;
      }
      case 'heart': {
        this.sitting = true;
        this.transition = { kind: 'heart', t: 0, dur: 2.8, swapped: false };
        this._burstParticles(act.x + 0.5, act.y + 0.5, 50, 'star');
        this.emit('heart-reached', { worldNumber: this.worldNumber });
        return true;
      }
      default:
        return false;
    }
  }

  _burstParticles(x, y, count, kind) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const spd = 0.6 + Math.random() * 2.2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - (kind === 'fire' || kind === 'beacon' || kind === 'star' ? 1.4 : 0.2),
        life: 0,
        maxLife: 0.45 + Math.random() * 0.6,
        kind,
        size: 1.5 + Math.random() * 2.2,
      });
    }
  }

  _tryMove(dx, dy) {
    const r = 0.28; // generous kid-friendly collision radius
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    const blocked = (px, py) => (
      this.isSolid(Math.floor(px - r), Math.floor(py - r))
      || this.isSolid(Math.floor(px + r), Math.floor(py - r))
      || this.isSolid(Math.floor(px - r), Math.floor(py + r))
      || this.isSolid(Math.floor(px + r), Math.floor(py + r))
    );

    if (!blocked(nx, ny)) {
      this.player.x = ((nx % 65536) + 65536) % 65536;
      this.player.y = ((ny % 65536) + 65536) % 65536;
      return true;
    }
    // Slide along X or Y axis so players glide smoothly around corners.
    let moved = false;
    if (dx !== 0 && !blocked(nx, this.player.y)) {
      this.player.x = ((nx % 65536) + 65536) % 65536;
      moved = true;
    }
    if (dy !== 0 && !blocked(this.player.x, ny)) {
      this.player.y = ((ny % 65536) + 65536) % 65536;
      moved = true;
    }
    return moved;
  }

  update(dt, input = { mx: 0, my: 0, run: false, actHeld: false }) {
    const step = Math.min(0.05, Math.max(0, dt));
    this.time += step;
    if (this.actCooldown > 0) this.actCooldown = Math.max(0, this.actCooldown - step);
    if (this.glideBuffer > 0) this.glideBuffer = Math.max(0, this.glideBuffer - step);
    if (input.actHeld && this.glide) this.glideBuffer = 0.16;

    // 1. Handle transitions (Heart world rebirth or Wake at last fire)
    if (this.transition) {
      this.transition.t += step;
      if (!this.transition.swapped && this.transition.t >= this.transition.dur * 0.55) {
        this.transition.swapped = true;
        if (this.transition.kind === 'heart') {
          const nextSeed = ((this.world.seed * 25173 + 13849) & 0xffff) || 1;
          this.newWorld(nextSeed, true);
        } else if (this.transition.kind === 'wake') {
          this.player.x = this.lastFire.x;
          this.player.y = this.lastFire.y;
          this.warmth = 4.0;
          this.watchers = [];
          this.walkTarget = null;
          this.emit('woke-at-fire');
        }
      }
      if (this.transition.t >= this.transition.dur) {
        this.transition = null;
      }
      this._updateParticles(step);
      return;
    }

    // 2. Active cloak glide
    if (this.glide) {
      this.glide.t += step;
      const k = Math.min(1, this.glide.t / this.glide.dur);
      this.player.x = ((this.glide.sx + (this.glide.ex - this.glide.sx) * k) % 65536 + 65536) % 65536;
      this.player.y = ((this.glide.sy + (this.glide.ey - this.glide.sy) * k) % 65536 + 65536) % 65536;
      if (Math.random() < 0.6) {
        this.particles.push({
          x: this.player.x, y: this.player.y, vx: 0, vy: 0, life: 0, maxLife: 0.35, kind: 'wind', size: 2.2,
        });
      }
      if (k >= 1) {
        this.glide = null;
        this._markVisited();
        // Update facing from current stick/keyboard before checking buffered chained glide
        if (Math.hypot(input.mx || 0, input.my || 0) > 0.12) {
          const m = Math.hypot(input.mx, input.my);
          this.player.fx = input.mx / m;
          this.player.fy = input.my / m;
        }
        if (this.glideBuffer > 0 || input.actHeld) {
          this.glideBuffer = 0;
          this.performAction(true);
        }
      }
      this._updateParticles(step);
      return;
    }

    // 3. Movement from joystick/keyboard or tap-to-walk
    let mx = input.mx || 0;
    let my = input.my || 0;
    let run = Boolean(input.run);

    // Run-and-place rocks / burn brambles / glide continuously while holding Act!
    if (input.actHeld && this.actCooldown <= 0) {
      if (Math.hypot(mx, my) > 0.12) {
        const m = Math.hypot(mx, my);
        this.player.fx = mx / m;
        this.player.fy = my / m;
      }
      if (this.performAction(true)) {
        this.actCooldown = 0.12;
        if (this.glide) {
          this._updateParticles(step);
          return;
        }
      }
    }

    if (Math.hypot(mx, my) > 0.12) {
      this.walkTarget = null;
    } else if (this.walkTarget) {
      const dx = wrapDelta(Math.floor(this.player.x), Math.floor(this.walkTarget.x))
        + (this.walkTarget.x - Math.floor(this.walkTarget.x)) - (this.player.x - Math.floor(this.player.x));
      const dy = wrapDelta(Math.floor(this.player.y), Math.floor(this.walkTarget.y))
        + (this.walkTarget.y - Math.floor(this.walkTarget.y)) - (this.player.y - Math.floor(this.player.y));
      const d = Math.hypot(dx, dy);
      if (d < 0.25) {
        this.walkTarget = null;
      } else {
        mx = dx / d;
        my = dy / d;
        run = d > 2.2;
      }
    }

    const mag = Math.hypot(mx, my);
    if (mag > 0.12) {
      const nx = mx / Math.max(1, mag);
      const ny = my / Math.max(1, mag);
      const sprinting = run;
      const underFlags = this.world.flagsAt(Math.floor(this.player.x), Math.floor(this.player.y));
      const slowMul = (underFlags & MTF.SLOW) ? 0.62 : 1;
      const spd = (sprinting ? RUN_SPEED : WALK_SPEED) * Math.min(1, mag) * slowMul;

      this.player.fx = nx;
      this.player.fy = ny;
      this.player.moving = true;
      this.player.running = sprinting;
      this.sitting = false;
      this.idleSec = 0;

      const moved = this._tryMove(nx * spd * step, ny * spd * step);
      if (!moved && this.walkTarget) this.walkTarget = null;
      this.player.anim += step * (sprinting ? 10 : 6.5);

      this.stepAccum += spd * step;
      if (this.stepAccum >= 1.05) {
        this.stepAccum = 0;
        const mt = this.world.mtAt(Math.floor(this.player.x), Math.floor(this.player.y));
        if (mt === MT.SAND || mt === MT.SNOW || mt === MT.DUNE || mt === MT.ASH) {
          this.footprints.push({ x: this.player.x, y: this.player.y, life: 0, maxLife: 4.5 });
          if (this.footprints.length > 48) this.footprints.shift();
        }
        this.emit('step', { biome: this.currentBiome() });
      }
      this._markVisited();
    } else {
      this.player.moving = false;
      this.player.running = false;
      this.idleSec += step;
      if (this.idleSec > 4.5) this.sitting = true;
    }

    // 4. Collect nearby wisps -> permanent sky stars!
    const wisp = this.world.nearestWisp(this.player.x, this.player.y);
    if (wisp && wisp.dist < 0.95) {
      this.world.collectedWisps.add(wisp.key);
      if (this.stars < MAX_STARS) this.stars++;
      this._burstParticles(wisp.x + 0.5, wisp.y + 0.5, 22, 'star');
      this.emit('wisp-collected', { stars: this.stars, x: wisp.x, y: wisp.y });
    }

    // 5. Day/night clock (passes faster when sitting near a fire)
    const nearFire = this.isNearWarmth();
    const timeScale = (this.sitting && nearFire) ? 14 : 1;
    const prevDay = this.dayTime;
    this.dayTime = (this.dayTime + (step * timeScale) / DAY_DURATION_SEC) % 1;
    if (this.dayTime < prevDay) this.dayCount++;

    // 6. Warmth (gentle & forgiving for kids)
    if (nearFire) {
      this.warmth = Math.min(4, this.warmth + step * 0.95);
    } else {
      const night = this.nightAmount;
      const flags = this.world.flagsAt(Math.floor(this.player.x), Math.floor(this.player.y));
      const weather = this.currentWeather();
      if (night > 0.35) {
        let drain = 0.032 * night;
        if (flags & MTF.COLD) drain += 0.025;
        if (weather === 'rain' || weather === 'snow') drain += 0.02;
        this.warmth = Math.max(0, this.warmth - drain * step);
      } else {
        // Day slowly warms you back up.
        this.warmth = Math.min(4, this.warmth + step * 0.05);
      }
    }
    if (this.warmth <= 0 && !this.transition) {
      this.transition = { kind: 'wake', t: 0, dur: 1.4, swapped: false };
      this.emit('warmth-out');
    }

    // 7. Ambient life (birds by day, fireflies & Watchers at night)
    this._updateAmbientLife(step, nearFire);
    this._updateParticles(step);
  }

  _markVisited() {
    const key = `${Math.floor(this.player.x) >> 1},${Math.floor(this.player.y) >> 1}`;
    this.visited.add(key);
  }

  _updateAmbientLife(dt, nearFire) {
    const night = this.nightAmount;
    const px = this.player.x;
    const py = this.player.y;

    // Birds by day
    if (night < 0.3 && this.birds.length < 4 && Math.random() < dt * 0.45) {
      const bx = px + (Math.random() - 0.5) * 16;
      const by = py + (Math.random() - 0.5) * 12;
      if (!this.isSolid(Math.floor(bx), Math.floor(by)) && Math.hypot(bx - px, by - py) > 4) {
        this.birds.push({ x: bx, y: by, flying: false, vx: 0, vy: 0, flap: Math.random() * 6 });
      }
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      const d = Math.hypot(b.x - px, b.y - py);
      if (!b.flying && d < 3.4) {
        b.flying = true;
        const ang = Math.atan2(b.y - py, b.x - px) + (Math.random() - 0.5) * 0.6;
        b.vx = Math.cos(ang) * 7.5;
        b.vy = Math.sin(ang) * 7.5 - 2.2;
      }
      if (b.flying) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.flap += dt * 16;
      }
      if (d > 22) this.birds.splice(i, 1);
    }

    // Fireflies on clear nights
    if (night > 0.4 && this.fireflies.length < 18 && Math.random() < dt * 2.5) {
      this.fireflies.push({
        x: px + (Math.random() - 0.5) * 18,
        y: py + (Math.random() - 0.5) * 14,
        phase: Math.random() * Math.PI * 2,
        life: 0,
        maxLife: 5 + Math.random() * 5,
      });
    }
    for (let i = this.fireflies.length - 1; i >= 0; i--) {
      const f = this.fireflies[i];
      f.life += dt;
      f.phase += dt * 2.4;
      f.x += Math.cos(f.phase * 0.7) * 0.45 * dt;
      f.y += Math.sin(f.phase) * 0.35 * dt;
      if (f.life >= f.maxLife || Math.hypot(f.x - px, f.y - py) > 22) this.fireflies.splice(i, 1);
    }

    // Pale Watchers at night (or in Ash biome) — shy of fire and blind to tall grass
    const inAsh = this.currentBiome() === BIOME.ASH;
    if ((night > 0.65 || inAsh) && this.watchers.length < 2 && Math.random() < dt * 0.18) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * 5;
      const wx = px + Math.cos(ang) * dist;
      const wy = py + Math.sin(ang) * dist;
      if (!this.isNearWarmth(wx, wy)) {
        this.watchers.push({ x: wx, y: wy, phase: Math.random() * 6 });
      }
    }
    const hidden = this.isHidden();
    for (let i = this.watchers.length - 1; i >= 0; i--) {
      const w = this.watchers[i];
      w.phase += dt * 1.8;
      const d = Math.hypot(w.x - px, w.y - py);
      if ((night < 0.35 && !inAsh) || d > 24) {
        this.watchers.splice(i, 1);
        continue;
      }
      if (!nearFire && !hidden && d > 0.4) {
        const spd = 1.25; // slow, eerie, easy for kids to outrun or hide from
        const nx = w.x + ((px - w.x) / d) * spd * dt;
        const ny = w.y + ((py - w.y) / d) * spd * dt;
        if (!this.isNearWarmth(nx, ny)) {
          w.x = nx;
          w.y = ny;
        }
      }
      if (d < 0.65 && !nearFire && !hidden && !this.transition) {
        this.warmth = Math.max(0, this.warmth - 1.5);
        this.watchers.splice(i, 1);
        this.emit('watcher-touch');
      }
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'fire' || p.kind === 'beacon' || p.kind === 'star') p.vy -= 0.8 * dt;
      if (p.life >= p.maxLife) this.particles.splice(i, 1);
    }
    for (let i = this.footprints.length - 1; i >= 0; i--) {
      this.footprints[i].life += dt;
      if (this.footprints[i].life >= this.footprints[i].maxLife) this.footprints.splice(i, 1);
    }
  }
}
