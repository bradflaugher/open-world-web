// Deterministic 65536x65536 toroidal world generator for Open World (web port).
// Faithful to the Game Boy original's 10 biomes, 36 metatiles, 3 gated beacons,
// 2 item shrines, ancient causeways, Heart, wisps, and persistent cairns.

export const WORLD_MASK = 0xffff;
export const WORLD_HALF = 0x8000;

export const MT = {
  SEA: 0,
  SEA_GLINT: 1,
  SHALLOW: 2,
  STEPSTONE: 3,
  SAND: 4,
  GRASS: 5,
  GRASS_TALL: 6,
  FLOWERS: 7,
  TREE: 8,
  UNDERGROWTH: 9,
  PINE: 10,
  SNOW: 11,
  DUNE: 12,
  BONES: 13,
  ROCK: 14,
  ROCK_PEAK: 15,
  ASH: 16,
  GLASS: 17,
  MONOLITH: 18,
  RUIN_WALL: 19,
  RUIN_FLOOR: 20,
  PILLAR: 21,
  STATUE_HAND: 22,
  ROAD: 23,
  BRAMBLE: 24,
  FIRE_COLD: 25,
  FIRE_LIT: 26,
  CAIRN: 27,
  CAIRN_OLD: 28,
  BEACON: 29,
  BEACON_LIT: 30,
  SHRINE: 31,
  SHRINE_EMPTY: 32,
  HEART: 33,
  TABLE: 34,
  WELL: 35,
};

export const MTF = {
  SOLID: 0x01,
  WATER: 0x02,
  HIDE: 0x04,
  SLOW: 0x08,
  COLD: 0x10,
  WARM: 0x20,
  INTERACT: 0x40,
  GLIDE: 0x80,
};

export const MT_FLAGS = new Uint8Array(36);
MT_FLAGS[MT.SEA] = MTF.SOLID | MTF.WATER | MTF.GLIDE;
MT_FLAGS[MT.SEA_GLINT] = MTF.SOLID | MTF.WATER | MTF.GLIDE;
MT_FLAGS[MT.SHALLOW] = MTF.SOLID | MTF.WATER | MTF.GLIDE | MTF.INTERACT;
MT_FLAGS[MT.STEPSTONE] = 0;
MT_FLAGS[MT.SAND] = 0;
MT_FLAGS[MT.GRASS] = 0;
MT_FLAGS[MT.GRASS_TALL] = MTF.HIDE;
MT_FLAGS[MT.FLOWERS] = 0;
MT_FLAGS[MT.TREE] = MTF.SOLID;
MT_FLAGS[MT.UNDERGROWTH] = MTF.HIDE | MTF.SLOW;
MT_FLAGS[MT.PINE] = MTF.SOLID;
MT_FLAGS[MT.SNOW] = MTF.COLD;
MT_FLAGS[MT.DUNE] = MTF.COLD; // desert nights chill quickly
MT_FLAGS[MT.BONES] = MTF.COLD;
MT_FLAGS[MT.ROCK] = MTF.SOLID | MTF.GLIDE;
MT_FLAGS[MT.ROCK_PEAK] = MTF.SOLID;
MT_FLAGS[MT.ASH] = 0;
MT_FLAGS[MT.GLASS] = 0;
MT_FLAGS[MT.MONOLITH] = MTF.SOLID;
MT_FLAGS[MT.RUIN_WALL] = MTF.SOLID | MTF.GLIDE;
MT_FLAGS[MT.RUIN_FLOOR] = 0;
MT_FLAGS[MT.PILLAR] = MTF.SOLID;
MT_FLAGS[MT.STATUE_HAND] = MTF.SOLID;
MT_FLAGS[MT.ROAD] = 0;
MT_FLAGS[MT.BRAMBLE] = MTF.SOLID | MTF.INTERACT | MTF.GLIDE;
MT_FLAGS[MT.FIRE_COLD] = MTF.SOLID | MTF.INTERACT;
MT_FLAGS[MT.FIRE_LIT] = MTF.SOLID | MTF.WARM | MTF.INTERACT;
MT_FLAGS[MT.CAIRN] = MTF.SOLID | MTF.INTERACT;
MT_FLAGS[MT.CAIRN_OLD] = MTF.SOLID;
MT_FLAGS[MT.BEACON] = MTF.SOLID | MTF.INTERACT;
MT_FLAGS[MT.BEACON_LIT] = MTF.SOLID | MTF.WARM | MTF.INTERACT;
MT_FLAGS[MT.SHRINE] = MTF.SOLID | MTF.INTERACT;
MT_FLAGS[MT.SHRINE_EMPTY] = MTF.SOLID;
MT_FLAGS[MT.HEART] = MTF.SOLID | MTF.WARM | MTF.INTERACT;
MT_FLAGS[MT.TABLE] = MTF.SOLID;
MT_FLAGS[MT.WELL] = MTF.SOLID;

export const BIOME = {
  SEA: 0,
  SHALLOW: 1,
  SHORE: 2,
  MEADOW: 3,
  FOREST: 4,
  DESERT: 5,
  TUNDRA: 6,
  ROCK: 7,
  ASH: 8,
  RUINS: 9,
};

export const ITEM = {
  LANTERN: 0,
  STONES: 1,
  CLOAK: 2,
};

export const MAX_OLD_CAIRNS = 32;
export const MAX_CAIRNS = 32;
export const MAX_STARS = 28;

export function wrapCoord(v) {
  return v & WORLD_MASK;
}

export function wrapDelta(from, to) {
  let d = ((to - from) & WORLD_MASK);
  if (d >= WORLD_HALF) d -= 0x10000;
  return d;
}

export function worldDist(ax, ay, bx, by) {
  const dx = Math.abs(wrapDelta(ax, bx));
  const dy = Math.abs(wrapDelta(ay, by));
  return Math.hypot(dx, dy);
}

// Bearing in radians: 0 = North (-y), PI/2 = East (+x), PI = South (+y), -PI/2 = West (-x).
export function worldBearing(fx, fy, tx, ty) {
  const dx = wrapDelta(fx, tx);
  const dy = wrapDelta(fy, ty);
  return Math.atan2(dx, -dy);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2d(x, y, salt) {
  let h = (Math.imul(x & 0xffff, 374761393) + Math.imul(y & 0xffff, 668265263) + Math.imul(salt & 0xffff, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) & 255;
}

function valueNoise(x, y, scale, salt) {
  const gx = Math.floor(x / scale);
  const gy = Math.floor(y / scale);
  const fx = (x - gx * scale) / scale;
  const fy = (y - gy * scale) / scale;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(gx, gy, salt) / 255;
  const n10 = hash2d(gx + 1, gy, salt) / 255;
  const n01 = hash2d(gx, gy + 1, salt) / 255;
  const n11 = hash2d(gx + 1, gy + 1, salt) / 255;
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(wx, wy);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

export class World {
  constructor(seed = 1, oldCairns = []) {
    this.seed = seed & 0xffff;
    this.oldCairns = oldCairns.slice(0, MAX_OLD_CAIRNS);
    this.mods = new Map(); // "x,y" -> mt
    this.cairns = []; // [{x, y}] ordered oldest -> newest
    this.collectedWisps = new Set(); // "cx,cy" chunk keys
    this._cache = new Map();
    this._initLayout();
  }

  _initLayout() {
    const rng = mulberry32((this.seed ^ 0x51a7) >>> 0);
    // Find a pleasant starting meadow/shore clearing near (32768, 32768).
    let sx = 32768;
    let sy = 32768;
    for (let r = 0; r < 40; r++) {
      const tx = wrapCoord(32768 + Math.round((rng() - 0.5) * r * 2));
      const ty = wrapCoord(32768 + Math.round((rng() - 0.5) * r * 2));
      const b = this.biomeAt(tx, ty);
      if (b === BIOME.MEADOW || b === BIOME.SHORE || b === BIOME.FOREST) {
        sx = tx;
        sy = ty;
        break;
      }
    }
    this.start = { x: sx, y: sy };

    // Place 3 beacons at well-spaced bearings (~120 deg apart) and approachable distances
    // so each beacon is a joyful 1-3 minute discovery on phone or desktop.
    const baseAngle = rng() * Math.PI * 2;
    const beaconDists = [26, 40, 52];
    this.beacons = [];
    this.shrines = [];
    for (let i = 0; i < 3; i++) {
      const ang = baseAngle + i * ((Math.PI * 2) / 3) + (rng() - 0.5) * 0.35;
      const dist = beaconDists[i] + Math.round((rng() - 0.5) * 4);
      const bx = wrapCoord(sx + Math.round(Math.sin(ang) * dist));
      const by = wrapCoord(sy - Math.round(Math.cos(ang) * dist));
      this.beacons.push({ x: bx, y: by });
      // Shrine pedestal sits 2 tiles east of Beacon 0 (Stones) and Beacon 1 (Cloak).
      this.shrines.push(i < 2 ? { x: wrapCoord(bx + 2), y: by } : { x: bx, y: by });
    }

    // Place the Heart opposite the average direction of the first two beacons.
    const heartAng = baseAngle + Math.PI + (rng() - 0.5) * 0.4;
    const heartDist = 44 + Math.round((rng() - 0.5) * 4);
    this.heart = {
      x: wrapCoord(sx + Math.round(Math.sin(heartAng) * heartDist)),
      y: wrapCoord(sy - Math.round(Math.cos(heartAng) * heartDist)),
    };

    // Ancient causeways from start to each beacon and to the Heart.
    // Road waypoints bend slightly for an organic ancient-path feel.
    this.roads = [
      ...this.beacons.map((b, i) => this._makeRoad(this.start, b, 10 + i)),
      this._makeRoad(this.start, this.heart, 20),
    ];

    // Precompute old cairn lookup map (relative to start).
    this.oldCairnMap = new Map();
    for (const oc of this.oldCairns) {
      const cx = wrapCoord(sx + oc.dx);
      const cy = wrapCoord(sy + oc.dy);
      if (worldDist(cx, cy, sx, sy) > 4) {
        this.oldCairnMap.set(`${cx},${cy}`, true);
      }
    }
  }

  _makeRoad(a, b, salt) {
    const dx = wrapDelta(a.x, b.x);
    const dy = wrapDelta(a.y, b.y);
    const perpX = -dy * 0.14;
    const perpY = dx * 0.14;
    const sign = (hash2d(this.seed, salt, 77) & 1) ? 1 : -1;
    const mx = a.x + dx * 0.5 + perpX * sign;
    const my = a.y + dy * 0.5 + perpY * sign;
    return { ax: a.x, ay: a.y, mx, my, bx: a.x + dx, by: a.y + dy };
  }

  elevation(x, y) {
    const s = this.seed;
    const e1 = valueNoise(x, y, 24, s ^ 0x1111);
    const e2 = valueNoise(x, y, 9, s ^ 0x2222);
    return e1 * 0.72 + e2 * 0.28;
  }

  moisture(x, y) {
    return valueNoise(x + 137, y - 91, 28, this.seed ^ 0x3333);
  }

  strangeness(x, y) {
    return valueNoise(x - 211, y + 307, 34, this.seed ^ 0x4444);
  }

  detail(x, y) {
    return hash2d(x, y, this.seed ^ 0x7777);
  }

  biomeAt(x, y) {
    const wx = wrapCoord(x);
    const wy = wrapCoord(y);
    const e = this.elevation(wx, wy);
    if (e < 0.27) return BIOME.SEA;
    if (e < 0.34) return BIOME.SHALLOW;
    if (e < 0.39) return BIOME.SHORE;
    if (e > 0.79) return BIOME.ROCK;
    const m = this.moisture(wx, wy);
    const st = this.strangeness(wx, wy);
    if (st > 0.77) return m > 0.5 ? BIOME.RUINS : BIOME.ASH;
    if (e > 0.67) return m > 0.45 ? BIOME.TUNDRA : BIOME.ROCK;
    if (m < 0.32) return BIOME.DESERT;
    if (m > 0.61) return BIOME.FOREST;
    return BIOME.MEADOW;
  }

  // Deterministic wisp position in a 24x24 cell chunk, or null if none.
  wispInChunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (this.collectedWisps.has(key)) return null;
    const h = hash2d(cx, cy, this.seed ^ 0x9911);
    if (h > 160) return null; // ~63% of chunks hold a wisp
    const ox = 4 + (hash2d(cx, cy, this.seed ^ 0x9922) % 16);
    const oy = 4 + (hash2d(cx, cy, this.seed ^ 0x9933) % 16);
    const wx = wrapCoord(cx * 24 + ox);
    const wy = wrapCoord(cy * 24 + oy);
    if (worldDist(wx, wy, this.start.x, this.start.y) < 5) return null;
    const mt = this.mtAt(wx, wy);
    if (MT_FLAGS[mt] & MTF.SOLID) return null;
    return { x: wx, y: wy, key };
  }

  nearestWisp(px, py) {
    const baseCx = Math.floor(px / 24);
    const baseCy = Math.floor(py / 24);
    let best = null;
    let bestDist = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const w = this.wispInChunk(baseCx + dx, baseCy + dy);
        if (!w) continue;
        const d = worldDist(px, py, w.x, w.y);
        if (d < bestDist) {
          bestDist = d;
          best = { ...w, dist: d };
        }
      }
    }
    return best;
  }

  _setPieceAt(wx, wy) {
    // 1. Start clearing: cold fire at start, open meadow around it.
    const sdx = wrapDelta(this.start.x, wx);
    const sdy = wrapDelta(this.start.y, wy);
    const sd2 = sdx * sdx + sdy * sdy;
    if (sdx === 0 && sdy === 0) return MT.FIRE_COLD;
    if (sd2 <= 10) return sd2 <= 4 ? MT.GRASS : (this.detail(wx, wy) < 40 ? MT.FLOWERS : MT.GRASS);

    // 2. Three Beacons with their distinct gate rings:
    //    Beacon 0: ring of BRAMBLE (burn with Lantern) + Shrine for Stones
    //    Beacon 1: ring of SHALLOW water (bridge with Stones) + Shrine for Cloak
    //    Beacon 2: ring of ROCK crags (glide over with Cloak)
    for (let i = 0; i < 3; i++) {
      const b = this.beacons[i];
      const dx = wrapDelta(b.x, wx);
      const dy = wrapDelta(b.y, wy);
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx <= 6 && ady <= 6) {
        if (dx === 0 && dy === 0) return MT.BEACON;
        if (i < 2 && dx === 2 && dy === 0) return MT.SHRINE;
        const d = Math.hypot(dx, dy);
        if (d <= 2.6) return MT.RUIN_FLOOR;
        if (d <= 3.6) return MT.GRASS;
        if (d <= 5.2) {
          if (i === 0) return MT.BRAMBLE;
          if (i === 1) return MT.SHALLOW;
          return MT.ROCK;
        }
        // Clear outer landing ring so player can always approach the gate cleanly
        return i === 1 ? MT.SAND : MT.GRASS;
      }
    }

    // 3. The Heart: tranquil flagstone sanctuary with four pillars.
    const hdx = wrapDelta(this.heart.x, wx);
    const hdy = wrapDelta(this.heart.y, wy);
    if (Math.abs(hdx) <= 5 && Math.abs(hdy) <= 5) {
      if (hdx === 0 && hdy === 0) return MT.HEART;
      if (Math.abs(hdx) === 3 && Math.abs(hdy) === 3) return MT.PILLAR;
      const hd = Math.hypot(hdx, hdy);
      if (hd <= 3.8) return MT.RUIN_FLOOR;
      return MT.FLOWERS;
    }

    // 4. Ancient cairns carried over from previous worlds.
    if (this.oldCairnMap.has(`${wx},${wy}`)) return MT.CAIRN_OLD;

    // 5. Ancient causeways connecting start -> beacons and start -> Heart.
    //    Stop just outside each beacon's gate ring so the gate puzzle stays intact!
    const px = this.start.x + wrapDelta(this.start.x, wx);
    const py = this.start.y + wrapDelta(this.start.y, wy);
    for (let r = 0; r < this.roads.length; r++) {
      const rd = this.roads[r];
      const d1 = distToSegment(px, py, rd.ax, rd.ay, rd.mx, rd.my);
      const d2 = distToSegment(px, py, rd.mx, rd.my, rd.bx, rd.by);
      if (Math.min(d1, d2) < 0.85) return MT.ROAD;
    }

    // 6. Points of interest (one per 16x16 cell): campfires, ruins, monoliths, well, table.
    const cx = wx >> 4;
    const cy = wy >> 4;
    const poiOx = 4 + (hash2d(cx, cy, this.seed ^ 0x5511) % 8);
    const poiOy = 4 + (hash2d(cx, cy, this.seed ^ 0x5522) % 8);
    const lx = wx & 15;
    const ly = wy & 15;
    const pdx = lx - poiOx;
    const pdy = ly - poiOy;
    if (Math.abs(pdx) <= 2 && Math.abs(pdy) <= 2) {
      const baseBiome = this.biomeAt(wx, wy);
      if (baseBiome !== BIOME.SEA && baseBiome !== BIOME.SHALLOW) {
        const roll = hash2d(cx, cy, this.seed ^ 0x5533);
        if (roll < 75) {
          // Campfire clearing (generous for kids & warmth!)
          if (pdx === 0 && pdy === 0) return MT.FIRE_COLD;
          if (Math.abs(pdx) <= 1 && Math.abs(pdy) <= 1) return MT.GRASS;
        } else if (roll < 115) {
          // Ruined shrine / flagstones
          if (pdx === 0 && pdy === 0) return MT.MONOLITH;
          if (Math.abs(pdx) === 2 && Math.abs(pdy) === 2) return MT.PILLAR;
          return MT.RUIN_FLOOR;
        } else if (roll < 135) {
          // A quiet table set for two (vignette)
          if (pdx === 0 && pdy === 0) return MT.TABLE;
          if (Math.abs(pdx) <= 1 && Math.abs(pdy) <= 1) return MT.FLOWERS;
        } else if (roll < 155) {
          // An old stone well (vignette)
          if (pdx === 0 && pdy === 0) return MT.WELL;
          if (Math.abs(pdx) <= 1 && Math.abs(pdy) <= 1) return MT.RUIN_FLOOR;
        } else if (roll < 170) {
          // Enormous statue hand emerging from the earth
          if (pdx === 0 && pdy === 0) return MT.STATUE_HAND;
        }
      }
    }

    return -1;
  }

  mtBaseAt(x, y) {
    const wx = wrapCoord(x);
    const wy = wrapCoord(y);
    const sp = this._setPieceAt(wx, wy);
    if (sp >= 0) return sp;

    const b = this.biomeAt(wx, wy);
    const d = this.detail(wx, wy);
    switch (b) {
      case BIOME.SEA:
        return d < 22 ? MT.SEA_GLINT : MT.SEA;
      case BIOME.SHALLOW:
        return MT.SHALLOW;
      case BIOME.SHORE:
        return d < 18 ? MT.GRASS : MT.SAND;
      case BIOME.MEADOW:
        if (d < 36) return MT.GRASS_TALL;
        if (d < 56) return MT.FLOWERS;
        if (d > 246) return MT.TREE;
        return MT.GRASS;
      case BIOME.FOREST:
        if (d < 64) return MT.TREE;
        if (d < 135) return MT.UNDERGROWTH;
        if (d < 165) return MT.GRASS_TALL;
        return MT.GRASS;
      case BIOME.DESERT:
        if (d < 16) return MT.BONES;
        return MT.DUNE;
      case BIOME.TUNDRA:
        if (d < 46) return MT.PINE;
        return MT.SNOW;
      case BIOME.ROCK:
        if (d < 72) return MT.ROCK_PEAK;
        if (d < 170) return MT.ROCK;
        return MT.ASH;
      case BIOME.ASH:
        if (d < 44) return MT.GLASS;
        if (d > 240) return MT.MONOLITH;
        return MT.ASH;
      case BIOME.RUINS:
        if (d < 32) return MT.RUIN_WALL;
        if (d < 44) return MT.PILLAR;
        return MT.RUIN_FLOOR;
      default:
        return MT.GRASS;
    }
  }

  mtAt(x, y) {
    const wx = wrapCoord(x);
    const wy = wrapCoord(y);
    const key = `${wx},${wy}`;
    if (this.mods.has(key)) return this.mods.get(key);
    if (this._cache.has(key)) return this._cache.get(key);
    const mt = this.mtBaseAt(wx, wy);
    if (this._cache.size > 16000) this._cache.clear();
    this._cache.set(key, mt);
    return mt;
  }

  setMod(x, y, mt) {
    const wx = wrapCoord(x);
    const wy = wrapCoord(y);
    const key = `${wx},${wy}`;
    if (mt === null) this.mods.delete(key);
    else this.mods.set(key, mt);
    this._cache.delete(key);
  }

  placeCairn(x, y) {
    const wx = wrapCoord(x);
    const wy = wrapCoord(y);
    // Keep at most MAX_CAIRNS standing; oldest comes down when building a new one.
    if (this.cairns.length >= MAX_CAIRNS) {
      const oldest = this.cairns.shift();
      if (this.mtAt(oldest.x, oldest.y) === MT.CAIRN) {
        this.setMod(oldest.x, oldest.y, null);
      }
    }
    this.cairns.push({ x: wx, y: wy });
    this.setMod(wx, wy, MT.CAIRN);
  }

  removeCairn(x, y) {
    const wx = wrapCoord(x);
    const wy = wrapCoord(y);
    this.cairns = this.cairns.filter((c) => c.x !== wx || c.y !== wy);
    this.setMod(wx, wy, null);
  }

  nearestCairn(px, py) {
    let best = null;
    let bestDist = Infinity;
    for (const c of this.cairns) {
      const d = worldDist(px, py, c.x, c.y);
      if (d < bestDist) {
        bestDist = d;
        best = { ...c, dist: d };
      }
    }
    return best;
  }

  flagsAt(x, y) {
    return MT_FLAGS[this.mtAt(x, y)];
  }
}
