// 1:1 Game Boy / Game Boy Color pixel-art renderer for Open World (web port).
// Renders the exact original 2bpp BG tiles, autotiled water edges, 4-frame tile
// animations, 8x16 sprites (Wanderer with cloak, Watchers, birds, wisps, glow),
// 360-degree horizon band, and 4-phase CGB / 1989 DMG palettes at crisp integer scale.

import {
  MT, MAX_STARS, wrapCoord, wrapDelta, worldBearing,
} from './world.js';
import {
  BG_TILES, SPR_TILES, ANIM_FRAMES, ANIM_TILE,
  MT_TILES, MT_ATTR, EDGE_TILES,
  DMG_BGP, DMG_OBP0, DMG_OBP1,
  CGB_BG_PAL, CGB_OBJ_PAL,
} from './gb-assets.js';

// Exact sprite tile indices from src/gb/assets.h
const SPR = {
  PL_DOWN0: 0,
  PL_DOWN1: 4,
  PL_UP0: 8,
  PL_UP1: 12,
  PL_SIDE0: 16,
  PL_SIDE1: 20,
  PL_SIT: 24,
  PL_GLIDE: 32,
  BAND_BEACON: 48,
  BAND_BEACON_LIT: 50,
  BAND_HEART: 52,
  BAND_CAIRN: 54,
  GLOW0: 60,
  WATCHER: 64,
  BIRD0: 72,
  BIRD1: 74,
  WISP0: 92,
  WISP1: 94,
  BAND_WISP: 96,
  BIRD_SIT: 98,
  FIREFLY: 100,
};

const OPAL = {
  PLAYER: 0,
  WEATHER: 3,
  WATCHER: 4,
  BAND: 5,
  LIGHT: 6,
  GLOW: 7,
};

// Classic 1989 DMG Game Boy 4-shade green palette (0 lightest .. 3 darkest)
const DMG_SHADES = [
  [224, 248, 208],
  [136, 192, 112],
  [52, 104, 86],
  [8, 24, 32],
];

// Deterministic star positions on the 360-degree sky dome
const SKY_STARS = Array.from({ length: MAX_STARS }, (_, i) => ({
  angle: ((i * 2.399963229728653) % (Math.PI * 2)) - Math.PI,
  y: 2 + ((i * 7) % 10),
  phase: i * 1.7,
}));

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Map dayTime in [0, 1) to Game Boy 4-phase blend (0=DAWN, 1=DAY, 2=DUSK, 3=NIGHT)
function phaseBlend(dayTime) {
  // Dawn ~0.06, Day ~0.20..0.56, Dusk ~0.68, Night ~0.82..0.98
  if (dayTime < 0.06) return { a: 3, b: 0, t: dayTime / 0.06 };
  if (dayTime < 0.18) return { a: 0, b: 1, t: (dayTime - 0.06) / 0.12 };
  if (dayTime < 0.56) return { a: 1, b: 1, t: 0 };
  if (dayTime < 0.68) return { a: 1, b: 2, t: (dayTime - 0.56) / 0.12 };
  if (dayTime < 0.80) return { a: 2, b: 3, t: (dayTime - 0.68) / 0.12 };
  return { a: 3, b: 3, t: 0 };
}

function decodeDmgPal(reg) {
  return [
    DMG_SHADES[reg & 3],
    DMG_SHADES[(reg >> 2) & 3],
    DMG_SHADES[(reg >> 4) & 3],
    DMG_SHADES[(reg >> 6) & 3],
  ];
}

// Map bg tile index -> animation index (0..8) or -1
const ANIM_BY_TILE = new Int8Array(256).fill(-1);
for (let i = 0; i < ANIM_TILE.length; i++) {
  ANIM_BY_TILE[ANIM_TILE[i]] = i;
}

// Corner neighbor offsets matching assets.h: TL(N,W,NW), TR(N,E,NE), BL(S,W,SW), BR(S,E,SE)
const CORNER_DIRS = [
  [[0, -1], [-1, 0], [-1, -1]],
  [[0, -1], [1, 0], [1, -1]],
  [[0, 1], [-1, 0], [-1, 1]],
  [[0, 1], [1, 0], [1, 1]],
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fb = document.createElement('canvas'); // crisp native GB-resolution framebuffer
    this.fbCtx = this.fb.getContext('2d');
    this.imgData = null;
    this.horizonAngle = 0;
    this.scale = 3;
    this.vw = 320;
    this.vh = 200;
    this.horizonH = 24; // exact 24 GB pixels, just like the cartridge!
    this.bgPal = Array.from({ length: 8 }, () => [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    this.objPal = Array.from({ length: 8 }, () => [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  }

  resize(w, h, dpr) {
    this.width = w;
    this.height = h;
    this.dpr = Math.min(2, dpr || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    // Choose crisp integer Game Boy pixel scale (3x on phones, 3x-4x on desktop)
    const minDim = Math.min(w, h);
    this.scale = minDim < 440 ? 2.5 : minDim < 700 ? 3.5 : 4;
    this.vw = Math.max(160, Math.ceil(w / this.scale));
    this.vh = Math.max(144, Math.ceil(h / this.scale));
    this.horizonH = 24; // authentic 24px Game Boy horizon band

    this.fb.width = this.vw;
    this.fb.height = this.vh;
    this.imgData = this.fbCtx.createImageData(this.vw, this.vh);
  }

  screenToWorld(game, sx, sy) {
    const vy = sy / this.scale;
    if (vy <= this.horizonH) return null;
    const vx = sx / this.scale;
    const viewH = this.vh - this.horizonH;
    const cx = this.vw / 2;
    const cy = this.horizonH + viewH / 2;
    const wx = game.player.x + (vx - cx) / 16;
    const wy = game.player.y + (vy - cy) / 16;
    return { x: ((wx % 65536) + 65536) % 65536, y: ((wy % 65536) + 65536) % 65536 };
  }

  _computePalettes(game) {
    const { a, b, t } = phaseBlend(game.dayTime);
    const dmg = game.palette === 'dmg';

    if (dmg) {
      const p = t >= 0.5 ? b : a;
      const bg = decodeDmgPal(DMG_BGP[p]);
      const o0 = decodeDmgPal(DMG_OBP0[p]);
      const o1 = decodeDmgPal(DMG_OBP1[p]);
      for (let s = 0; s < 8; s++) this.bgPal[s] = bg;
      this.objPal[OPAL.PLAYER] = o0;
      this.objPal[OPAL.BAND] = o0;
      this.objPal[OPAL.WEATHER] = o1;
      this.objPal[OPAL.WATCHER] = o1;
      this.objPal[OPAL.LIGHT] = o1;
      this.objPal[OPAL.GLOW] = o1;
      return;
    }

    for (let s = 0; s < 8; s++) {
      for (let c = 0; c < 4; c++) {
        const ca = CGB_BG_PAL[a][s][c];
        const cb = CGB_BG_PAL[b][s][c];
        this.bgPal[s][c] = [
          Math.round(lerp(ca[0], cb[0], t)),
          Math.round(lerp(ca[1], cb[1], t)),
          Math.round(lerp(ca[2], cb[2], t)),
        ];
        const oa = CGB_OBJ_PAL[a][s][c];
        const ob = CGB_OBJ_PAL[b][s][c];
        this.objPal[s][c] = [
          Math.round(lerp(oa[0], ob[0], t)),
          Math.round(lerp(oa[1], ob[1], t)),
          Math.round(lerp(oa[2], ob[2], t)),
        ];
      }
    }
  }

  _blitBgTile(buf, vw, vh, tileIdx, palSlot, dx, dy, animFrame, minY) {
    const anim = ANIM_BY_TILE[tileIdx];
    const src = anim >= 0 ? ANIM_FRAMES : BG_TILES;
    const base = anim >= 0 ? (anim * 4 + animFrame) * 16 : tileIdx * 16;
    const pal = this.bgPal[palSlot];

    for (let row = 0; row < 8; row++) {
      const py = dy + row;
      if (py < minY || py >= vh) continue;
      const lo = src[base + row * 2];
      const hi = src[base + row * 2 + 1];
      const rowOff = py * vw;
      for (let col = 0; col < 8; col++) {
        const px = dx + col;
        if (px < 0 || px >= vw) continue;
        const bit = 7 - col;
        const ci = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        const rgb = pal[ci];
        const idx = (rowOff + px) * 4;
        buf[idx] = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
        buf[idx + 3] = 255;
      }
    }
  }

  _blitSpr8x16(buf, vw, vh, tileIdx, opalSlot, dx, dy, flipX = false, flipY = false, minY = 0) {
    const pal = this.objPal[opalSlot];
    const base = tileIdx * 16;
    for (let row = 0; row < 16; row++) {
      const py = dy + row;
      if (py < minY || py >= vh) continue;
      const sr = flipY ? 15 - row : row;
      const lo = SPR_TILES[base + sr * 2];
      const hi = SPR_TILES[base + sr * 2 + 1];
      const rowOff = py * vw;
      for (let col = 0; col < 8; col++) {
        const px = dx + col;
        if (px < 0 || px >= vw) continue;
        const sc = flipX ? 7 - col : col;
        const bit = 7 - sc;
        const ci = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        if (ci === 0) continue; // sprite index 0 is transparent
        const rgb = pal[ci];
        const idx = (rowOff + px) * 4;
        buf[idx] = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
        buf[idx + 3] = 255;
      }
    }
  }

  _blitSpr16x16(buf, vw, vh, tileIdx, opalSlot, dx, dy, flipX = false, minY = 0) {
    if (flipX) {
      this._blitSpr8x16(buf, vw, vh, tileIdx + 2, opalSlot, dx, dy, true, false, minY);
      this._blitSpr8x16(buf, vw, vh, tileIdx, opalSlot, dx + 8, dy, true, false, minY);
    } else {
      this._blitSpr8x16(buf, vw, vh, tileIdx, opalSlot, dx, dy, false, false, minY);
      this._blitSpr8x16(buf, vw, vh, tileIdx + 2, opalSlot, dx + 8, dy, false, false, minY);
    }
  }

  _edgeTileFor(world, mt, tx, ty, q) {
    let cls = -1;
    let isOther = null;
    if (mt === MT.SEA || mt === MT.SEA_GLINT) {
      cls = 0;
      isOther = (m) => m !== MT.SEA && m !== MT.SEA_GLINT;
    } else if (mt === MT.SHALLOW) {
      cls = 1;
      isOther = (m) => m !== MT.SEA && m !== MT.SEA_GLINT && m !== MT.SHALLOW && m !== MT.STEPSTONE;
    } else {
      return MT_TILES[mt * 4 + q];
    }

    const dirs = CORNER_DIRS[q];
    const hOther = isOther(world.mtAt(tx + dirs[0][0], ty + dirs[0][1]));
    const vOther = isOther(world.mtAt(tx + dirs[1][0], ty + dirs[1][1]));
    if (hOther && vOther) return EDGE_TILES[(cls * 4 + q) * 4 + 2]; // OUTER
    if (hOther) return EDGE_TILES[(cls * 4 + q) * 4 + 0]; // H
    if (vOther) return EDGE_TILES[(cls * 4 + q) * 4 + 1]; // V
    const dOther = isOther(world.mtAt(tx + dirs[2][0], ty + dirs[2][1]));
    if (dOther) return EDGE_TILES[(cls * 4 + q) * 4 + 3]; // INNER
    return MT_TILES[mt * 4 + q];
  }

  render(game, dt) {
    const ctx = this.ctx;
    if (!this.width || !this.height || !this.imgData) return;

    const targetAng = Math.atan2(game.player.fx, -game.player.fy);
    this.horizonAngle += angleDiff(this.horizonAngle, targetAng) * Math.min(1, dt * 4.5);

    this._computePalettes(game);
    const buf = this.imgData.data;
    const vw = this.vw;
    const vh = this.vh;
    const hh = this.horizonH;
    const animFrame = Math.floor(game.time * 3.8) & 3;
    const t = game.time;

    // 1. Render world metatiles (exact 16x16 GB metatiles) below horizonH
    const camX = game.player.x;
    const camY = game.player.y;
    const cx = Math.floor(vw / 2);
    const cy = hh + Math.floor((vh - hh) / 2);
    const baseTx = Math.floor(camX);
    const baseTy = Math.floor(camY);
    const fracX = Math.round((camX - baseTx) * 16);
    const fracY = Math.round((camY - baseTy) * 16);

    const halfCols = Math.ceil(vw / 32) + 2;
    const halfRows = Math.ceil((vh - hh) / 32) + 2;

    for (let dy = -halfRows; dy <= halfRows; dy++) {
      for (let dx = -halfCols; dx <= halfCols; dx++) {
        const tx = wrapCoord(baseTx + dx);
        const ty = wrapCoord(baseTy + dy);
        const sx = cx + dx * 16 - fracX;
        const sy = cy + dy * 16 - fracY;
        const mt = game.world.mtAt(tx, ty);

        for (let q = 0; q < 4; q++) {
          const qx = sx + (q & 1) * 8;
          const qy = sy + (q >> 1) * 8;
          if (qx + 8 <= 0 || qx >= vw || qy + 8 <= hh || qy >= vh) continue;
          const tileIdx = this._edgeTileFor(game.world, mt, tx, ty, q);
          const palSlot = MT_ATTR[mt * 4 + q];
          this._blitBgTile(buf, vw, vh, tileIdx, palSlot, qx, qy, animFrame, hh);
        }
      }
    }

    const toFbX = (wx) => Math.round(cx + (wrapDelta(baseTx, Math.floor(wx)) + (wx - Math.floor(wx)) - (camX - baseTx)) * 16);
    const toFbY = (wy) => Math.round(cy + (wrapDelta(baseTy, Math.floor(wy)) + (wy - Math.floor(wy)) - (camY - baseTy)) * 16);

    // 2. Dithered 32x32 Game Boy Lantern Glow ring behind the wanderer at dusk/night!
    if (game.nightAmount > 0.25 || game.duskAmount > 0.45) {
      const gx = cx;
      const gy = cy;
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0, OPAL.GLOW, gx - 16, gy - 16, false, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0 + 2, OPAL.GLOW, gx - 8, gy - 16, false, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0 + 2, OPAL.GLOW, gx, gy - 16, true, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0, OPAL.GLOW, gx + 8, gy - 16, true, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0, OPAL.GLOW, gx - 16, gy, false, true, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0 + 2, OPAL.GLOW, gx - 8, gy, false, true, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0 + 2, OPAL.GLOW, gx, gy, true, true, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.GLOW0, OPAL.GLOW, gx + 8, gy, true, true, hh);
    }

    // 3. Wisps (authentic 2-frame Game Boy wisp sprites)
    const wispFrame = (Math.floor(t * 4) & 1) ? SPR.WISP1 : SPR.WISP0;
    const baseCx = Math.floor(baseTx / 24);
    const baseCy = Math.floor(baseTy / 24);
    for (let wcy = baseCy - 1; wcy <= baseCy + 1; wcy++) {
      for (let wcx = baseCx - 1; wcx <= baseCx + 1; wcx++) {
        const wisp = game.world.wispInChunk(wcx, wcy);
        if (!wisp) continue;
        const wx = toFbX(wisp.x + 0.5) - 4;
        const wy = toFbY(wisp.y + 0.5) - 10 + Math.round(Math.sin(t * 3.5 + wisp.x) * 2);
        this._blitSpr8x16(buf, vw, vh, wispFrame, OPAL.LIGHT, wx, wy, false, false, hh);
      }
    }

    // 4. Birds (exact Game Boy sitting & flapping bird sprites)
    for (const b of game.birds) {
      const bx = toFbX(b.x) - 4;
      const by = toFbY(b.y) - 10;
      const spr = b.flying ? ((Math.floor(b.flap) & 1) ? SPR.BIRD1 : SPR.BIRD0) : SPR.BIRD_SIT;
      this._blitSpr8x16(buf, vw, vh, spr, OPAL.PLAYER, bx, by, b.vx < 0, false, hh);
    }

    // 5. Watchers (exact 16x32 Game Boy pale Watcher sprites)
    for (const wt of game.watchers) {
      const wx = toFbX(wt.x) - 8;
      const wy = toFbY(wt.y) - 24;
      this._blitSpr8x16(buf, vw, vh, SPR.WATCHER, OPAL.WATCHER, wx, wy, false, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.WATCHER + 2, OPAL.WATCHER, wx + 8, wy, false, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.WATCHER + 4, OPAL.WATCHER, wx, wy + 16, false, false, hh);
      this._blitSpr8x16(buf, vw, vh, SPR.WATCHER + 6, OPAL.WATCHER, wx + 8, wy + 16, false, false, hh);
    }

    // 6. The Wanderer (exact 16x16 Game Boy sprites with little cloak!)
    const p = game.player;
    let plSpr = SPR.PL_DOWN0;
    let plFlipX = false;
    const stepFrame = p.moving ? (Math.floor(p.anim) & 1) : 0;
    if (game.glide) {
      plSpr = SPR.PL_GLIDE;
      plFlipX = p.fx < -0.2;
    } else if (game.sitting) {
      plSpr = SPR.PL_SIT;
    } else if (Math.abs(p.fx) > Math.abs(p.fy) * 1.15) {
      plSpr = stepFrame ? SPR.PL_SIDE1 : SPR.PL_SIDE0;
      plFlipX = p.fx < 0;
    } else if (p.fy < 0) {
      plSpr = stepFrame ? SPR.PL_UP1 : SPR.PL_UP0;
    } else {
      plSpr = stepFrame ? SPR.PL_DOWN1 : SPR.PL_DOWN0;
    }
    const glideLift = game.glide ? -Math.round(Math.sin((game.glide.t / game.glide.dur) * Math.PI) * 5) : 0;
    this._blitSpr16x16(buf, vw, vh, plSpr, OPAL.PLAYER, cx - 8, cy - 10 + glideLift, plFlipX, hh);

    // 7. Fireflies (exact Game Boy firefly sprite)
    for (const f of game.fireflies) {
      if (Math.sin(f.phase) < 0) continue;
      this._blitSpr8x16(buf, vw, vh, SPR.FIREFLY, OPAL.LIGHT, toFbX(f.x) - 4, toFbY(f.y) - 8, false, false, hh);
    }

    // 8. 360-degree Pixel-Art Horizon Band (top 24 GB pixels, PAL_SKY slot 7)
    const skyPal = this.bgPal[7];
    const skyCol = skyPal[1];
    const rimCol = skyPal[2];
    const landCol = skyPal[3];
    const lightCol = skyPal[0];
    const fov = Math.PI * 0.85;

    for (let x = 0; x < vw; x++) {
      const u = x / vw;
      const ang = this.horizonAngle + (u - 0.5) * fov;
      const ridgeH = Math.round(
        5
        + Math.sin(ang * 2.5 + game.world.seed * 0.1) * 3.2
        + Math.sin(ang * 5.7 + game.world.seed * 0.37) * 2.1
        + Math.cos(ang * 9.3) * 1.1,
      );
      const ridgeY = Math.max(8, Math.min(hh - 3, hh - Math.max(3, ridgeH)));
      for (let y = 0; y < hh; y++) {
        const rgb = y < ridgeY ? skyCol : (y === ridgeY ? rimCol : landCol);
        const idx = (y * vw + x) * 4;
        buf[idx] = rgb[0];
        buf[idx + 1] = rgb[1];
        buf[idx + 2] = rgb[2];
        buf[idx + 3] = 255;
      }
    }

    const projectBand = (bearing) => {
      const diff = angleDiff(this.horizonAngle, bearing);
      if (Math.abs(diff) > fov * 0.55) return null;
      return Math.round(vw * 0.5 + (diff / (fov * 0.5)) * (vw * 0.5));
    };

    // Collected permanent stars in the horizon sky (colour 0 = light)
    if (game.nightAmount > 0.15 || game.duskAmount > 0.35) {
      for (let i = 0; i < game.stars; i++) {
        const st = SKY_STARS[i];
        const sx = projectBand(st.angle);
        if (sx === null || sx < 1 || sx >= vw - 1) continue;
        if (Math.sin(t * 2.5 + st.phase) < -0.65) continue;
        const idx = (st.y * vw + sx) * 4;
        buf[idx] = lightCol[0];
        buf[idx + 1] = lightCol[1];
        buf[idx + 2] = lightCol[2];
        buf[idx + 3] = 255;
      }
    }

    // Horizon landmarks (exact Game Boy band sprites: wisp, cairn, 3 beacons, Heart)
    const wispNear = game.world.nearestWisp(baseTx, baseTy);
    if (wispNear && wispNear.dist > 5) {
      const bx = projectBand(worldBearing(baseTx, baseTy, wispNear.x, wispNear.y));
      if (bx !== null && (Math.floor(t * 3) & 1) === 0) {
        this._blitSpr8x16(buf, vw, vh, SPR.BAND_WISP, OPAL.LIGHT, bx - 4, hh - 10, false, false, 0);
      }
    }
    const cairnNear = game.world.nearestCairn(baseTx, baseTy);
    if (cairnNear && cairnNear.dist > 4) {
      const bx = projectBand(worldBearing(baseTx, baseTy, cairnNear.x, cairnNear.y));
      if (bx !== null) {
        this._blitSpr8x16(buf, vw, vh, SPR.BAND_CAIRN, OPAL.BAND, bx - 4, hh - 11, false, false, 0);
      }
    }
    for (let i = 0; i < 3; i++) {
      const b = game.world.beacons[i];
      const bx = projectBand(worldBearing(baseTx, baseTy, b.x, b.y));
      if (bx === null) continue;
      const lit = game.beaconsLit[i];
      this._blitSpr8x16(buf, vw, vh, lit ? SPR.BAND_BEACON_LIT : SPR.BAND_BEACON, lit ? OPAL.LIGHT : OPAL.BAND, bx - 4, hh - 16, false, false, 0);
    }
    if (game.allBeaconsLit) {
      const hx = projectBand(worldBearing(baseTx, baseTy, game.world.heart.x, game.world.heart.y));
      if (hx !== null) {
        this._blitSpr8x16(buf, vw, vh, SPR.BAND_HEART, OPAL.LIGHT, hx - 4, hh - 16, false, false, 0);
      }
    }

    // Flush native pixel-art framebuffer to display canvas with ZERO blur!
    this.fbCtx.putImageData(this.imgData, 0, 0);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fb, 0, 0, this.vw, this.vh, 0, 0, this.vw * this.scale, this.vh * this.scale);

    // Subtle crisp overlays in screen space (tap target, particles, weather, bobbing prompt, transition)
    const S = 16 * this.scale;
    const toScreenX = (wx) => toFbX(wx) * this.scale;
    const toScreenY = (wy) => toFbY(wy) * this.scale;

    if (game.walkTarget) {
      const tx = toScreenX(game.walkTarget.x);
      const ty = toScreenY(game.walkTarget.y);
      const pulse = 0.65 + 0.35 * Math.sin(t * 7);
      ctx.strokeStyle = `rgba(255, 248, 210, ${(0.75 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 6 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const pt of game.particles) {
      const a = Math.max(0, 1 - pt.life / pt.maxLife);
      const px = toScreenX(pt.x);
      const py = toScreenY(pt.y);
      ctx.fillStyle = pt.kind === 'fire' || pt.kind === 'beacon'
        ? `rgba(255, ${Math.round(180 + a * 70)}, 110, ${a.toFixed(3)})`
        : pt.kind === 'star'
          ? `rgba(255, 250, 204, ${a.toFixed(3)})`
          : `rgba(235, 244, 250, ${(a * 0.75).toFixed(3)})`;
      const sz = Math.max(2, Math.round(pt.size * 1.4));
      ctx.fillRect(Math.round(px - sz / 2), Math.round(py - sz / 2), sz, sz);
    }

    // Bobbing context prompt above interactable target
    const act = game.getContextAction();
    if (act && act.kind !== 'build-cairn') {
      const ax = toScreenX(act.x + 0.5);
      const ay = toScreenY(act.y) - 8 + Math.sin(t * 5.2) * 4;
      ctx.fillStyle = 'rgba(20, 26, 40, 0.88)';
      ctx.strokeStyle = '#ffe599';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(ax - 13, ay - 13, 26, 24, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff6d6';
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const glyph = act.icon === 'flame' ? '🔥' : act.icon === 'stone' ? '🪨' : act.icon === 'cloak' ? '🪽' : act.icon === 'gift' ? '✦' : '★';
      ctx.fillText(glyph, ax, ay - 1);
    }

    // Weather (crisp pixel rain / snow / light fog)
    const weather = game.currentWeather();
    const viewTop = hh * this.scale;
    const viewH = this.height - viewTop;
    if (weather === 'rain') {
      ctx.strokeStyle = 'rgba(220, 236, 250, 0.42)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 38; i++) {
        const rx = ((i * 97 + t * 220) % (this.width + 60)) - 30;
        const ry = viewTop + ((i * 131 + t * 500) % viewH);
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 4, ry + 12);
      }
      ctx.stroke();
    } else if (weather === 'snow') {
      ctx.fillStyle = 'rgba(250, 252, 255, 0.78)';
      for (let i = 0; i < 40; i++) {
        const rx = ((i * 89 + Math.sin(t + i) * 20 + t * 24) % this.width + this.width) % this.width;
        const ry = viewTop + ((i * 113 + t * 60) % viewH);
        ctx.fillRect(Math.round(rx), Math.round(ry), 3, 3);
      }
    } else if (weather === 'fog') {
      ctx.fillStyle = 'rgba(218, 224, 230, 0.18)';
      ctx.fillRect(0, viewTop, this.width, viewH);
    }

    // Transition veil (Heart rebirth or Wake at last fire)
    if (game.transition) {
      const prog = game.transition.t / game.transition.dur;
      const alpha = prog < 0.55 ? prog / 0.55 : Math.max(0, 1 - (prog - 0.55) / 0.45);
      ctx.fillStyle = `rgba(255, 250, 236, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // Subtle tile size export for any caller
    this.tileSize = S;
    ctx.restore();
  }

  renderMap(mapCanvas, game) {
    const ctx = mapCanvas.getContext('2d');
    const size = mapCanvas.width;
    ctx.fillStyle = '#ece4d0';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = 'rgba(60, 56, 48, 0.22)';
    for (let y = 12; y < size; y += 14) {
      for (let x = 12; x < size; x += 14) ctx.fillRect(x, y, 2, 2);
    }

    const scale = size / 130;
    const px = game.player.x;
    const py = game.player.y;
    const toMap = (wx, wy) => [
      size / 2 + wrapDelta(Math.floor(px), Math.floor(wx)) * scale,
      size / 2 + wrapDelta(Math.floor(py), Math.floor(wy)) * scale,
    ];

    ctx.fillStyle = 'rgba(116, 128, 92, 0.65)';
    for (const key of game.visited) {
      const [vx, vy] = key.split(',').map(Number);
      const [mx, my] = toMap(vx * 2, vy * 2);
      if (mx >= 0 && mx <= size && my >= 0 && my <= size) ctx.fillRect(Math.round(mx - 2), Math.round(my - 2), 5, 5);
    }

    const drawDottedRoad = (target, color) => {
      const [ax, ay] = toMap(game.world.start.x, game.world.start.y);
      const [bx, by] = toMap(target.x, target.y);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    };
    for (let i = 0; i < 3; i++) if (game.beaconsLit[i]) drawDottedRoad(game.world.beacons[i], '#242c3d');
    if (game.allBeaconsLit) drawDottedRoad(game.world.heart, '#c56b26');

    ctx.fillStyle = '#5a5f6c';
    for (const c of game.world.cairns) {
      const [cx, cy] = toMap(c.x, c.y);
      if (cx >= 4 && cx <= size - 4 && cy >= 4 && cy <= size - 4) ctx.fillRect(Math.round(cx - 2), Math.round(cy - 2), 5, 5);
    }

    const pin = (wx, wy, color, lit, isHeart = false) => {
      let [mx, my] = toMap(wx, wy);
      mx = Math.max(12, Math.min(size - 12, mx));
      my = Math.max(12, Math.min(size - 12, my));
      ctx.fillStyle = color;
      if (isHeart) {
        ctx.beginPath();
        ctx.moveTo(mx, my - 7);
        ctx.lineTo(mx + 6, my);
        ctx.lineTo(mx, my + 7);
        ctx.lineTo(mx - 6, my);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(Math.round(mx - 3), Math.round(my - 6), 6, 12);
        ctx.fillRect(Math.round(mx - 5), Math.round(my - 6), 10, 3);
        if (lit) {
          ctx.fillStyle = '#ff9838';
          ctx.beginPath();
          ctx.arc(mx, my - 8, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    for (let i = 0; i < 3; i++) {
      const b = game.world.beacons[i];
      pin(b.x, b.y, game.beaconsLit[i] ? '#c86a20' : '#242c3d', game.beaconsLit[i], false);
    }
    if (game.allBeaconsLit) pin(game.world.heart.x, game.world.heart.y, '#d97a22', true, true);

    ctx.fillStyle = '#1b2230';
    ctx.fillRect(Math.round(size / 2 - 4), Math.round(size / 2 - 4), 8, 8);
    ctx.strokeStyle = '#fff8dc';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(size / 2 - 4), Math.round(size / 2 - 4), 8, 8);
  }
}
