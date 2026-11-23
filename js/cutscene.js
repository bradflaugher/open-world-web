// Animated 1:1 Game Boy Color / DMG ability cutscenes.
// Uses the authentic cartridge tiles, sprites, and palettes to show how each new ability works.

import {
  BG_TILES,
  SPR_TILES,
  MT_TILES,
  MT_ATTR,
  CGB_BG_PAL,
  CGB_OBJ_PAL,
  DMG_BGP,
  DMG_OBP0,
} from './gb-assets.js';
import { MT, ITEM } from './world.js';

const DMG_SHADES = [
  [224, 248, 208],
  [136, 192, 112],
  [52, 104, 86],
  [8, 24, 32],
];

const SPR_PL_SIDE0 = 16;
const SPR_PL_SIDE1 = 20;
const SPR_PL_GLIDE = 32;

export const ABILITY_CUTSCENES = {
  [ITEM.STONES]: {
    eyebrow: 'NEW ABILITY CLAIMED',
    title: 'STEPPING STONES',
    icon: 'stones',
    summary: 'Drop flat stones to cross shallow water, or stack cairns on dry land to mark your path.',
    hint: 'Hold ACT (or Space) while running to place stones without stopping.',
  },
  [ITEM.CLOAK]: {
    eyebrow: 'NEW ABILITY CLAIMED',
    title: 'WIND CLOAK',
    icon: 'cloak',
    summary: 'Leap off the ground any time and catch the wind to soar right over trees, crags, and water.',
    hint: 'With the Cloak selected, tap or hold ACT (or Space) to jump anywhere and chain glides.',
  },
};

function decodeDmgPal(reg) {
  return [
    DMG_SHADES[reg & 3],
    DMG_SHADES[(reg >> 2) & 3],
    DMG_SHADES[(reg >> 4) & 3],
    DMG_SHADES[(reg >> 6) & 3],
  ];
}

function blitBgTile(buf, w, h, tileIdx, pal, dx, dy) {
  const base = tileIdx * 16;
  for (let py = 0; py < 8; py++) {
    const sy = dy + py;
    if (sy < 0 || sy >= h) continue;
    const lo = BG_TILES[base + py * 2];
    const hi = BG_TILES[base + py * 2 + 1];
    const rowOff = sy * w;
    for (let px = 0; px < 8; px++) {
      const sx = dx + px;
      if (sx < 0 || sx >= w) continue;
      const bit = 7 - px;
      const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      const rgb = pal[ci];
      const o = (rowOff + sx) * 4;
      buf[o] = rgb[0];
      buf[o + 1] = rgb[1];
      buf[o + 2] = rgb[2];
      buf[o + 3] = 255;
    }
  }
}

function blitMetatile(buf, w, h, mt, bgPals, dx, dy) {
  const m = mt * 4;
  for (let q = 0; q < 4; q++) {
    const ti = MT_TILES[m + q];
    const pal = bgPals[MT_ATTR[m + q] & 7];
    blitBgTile(buf, w, h, ti, pal, dx + (q & 1) * 8, dy + ((q >> 1) & 1) * 8);
  }
}

function blitSpr8x16(buf, w, h, sprIdx, pal, dx, dy) {
  const base = sprIdx * 16;
  for (let py = 0; py < 16; py++) {
    const sy = dy + py;
    if (sy < 0 || sy >= h) continue;
    const lo = SPR_TILES[base + py * 2];
    const hi = SPR_TILES[base + py * 2 + 1];
    const rowOff = sy * w;
    for (let px = 0; px < 8; px++) {
      const sx = dx + px;
      if (sx < 0 || sx >= w) continue;
      const bit = 7 - px;
      const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
      if (ci === 0) continue;
      const rgb = pal[ci];
      const o = (rowOff + sx) * 4;
      buf[o] = rgb[0];
      buf[o + 1] = rgb[1];
      buf[o + 2] = rgb[2];
      buf[o + 3] = 255;
    }
  }
}

function blitPlayer16x16(buf, w, h, sprIdx, pal, dx, dy) {
  blitSpr8x16(buf, w, h, sprIdx, pal, dx, dy);
  blitSpr8x16(buf, w, h, sprIdx + 2, pal, dx + 8, dy);
}

function putPixel(buf, w, h, x, y, rgb) {
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const o = (y * w + x) * 4;
  buf[o] = rgb[0];
  buf[o + 1] = rgb[1];
  buf[o + 2] = rgb[2];
  buf[o + 3] = 255;
}

const STONES_MAP = [
  [MT.TREE, MT.GRASS, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.FLOWERS, MT.TREE],
  [MT.GRASS, MT.SAND, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SAND, MT.GRASS],
  [MT.GRASS, MT.SAND, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SAND, MT.BEACON_LIT],
  [MT.FLOWERS, MT.SAND, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SAND, MT.GRASS],
  [MT.TREE, MT.GRASS, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.SHALLOW, MT.GRASS, MT.TREE],
];

const CLOAK_MAP = [
  [MT.TREE, MT.GRASS, MT.ROCK_PEAK, MT.ROCK, MT.SEA, MT.SEA_GLINT, MT.SEA, MT.ROCK_PEAK, MT.GRASS, MT.TREE],
  [MT.GRASS, MT.GRASS, MT.ROCK, MT.ROCK, MT.SEA, MT.SEA, MT.SEA, MT.ROCK, MT.FLOWERS, MT.GRASS],
  [MT.GRASS, MT.GRASS, MT.ROCK, MT.ROCK, MT.SEA, MT.SEA_GLINT, MT.SEA, MT.ROCK, MT.GRASS, MT.BEACON_LIT],
  [MT.FLOWERS, MT.GRASS, MT.ROCK, MT.ROCK, MT.SEA, MT.SEA, MT.SEA, MT.ROCK, MT.GRASS, MT.GRASS],
  [MT.TREE, MT.GRASS, MT.ROCK_PEAK, MT.ROCK, MT.SEA_GLINT, MT.SEA, MT.SEA, MT.ROCK_PEAK, MT.GRASS, MT.TREE],
];

// Reusable 160x80 native GB framebuffer
let fbCanvas = null;
let fbCtx = null;
let fbImg = null;

export function renderCutsceneFrame(canvas, item, t, palette = 'color') {
  const vw = 160;
  const vh = 80;
  if (!fbCanvas) {
    fbCanvas = document.createElement('canvas');
    fbCanvas.width = vw;
    fbCanvas.height = vh;
    fbCtx = fbCanvas.getContext('2d');
    fbImg = fbCtx.createImageData(vw, vh);
  }

  const dmg = palette === 'dmg';
  const bgPals = dmg
    ? Array.from({ length: 8 }, () => decodeDmgPal(DMG_BGP[1]))
    : CGB_BG_PAL[1];
  const playerPal = dmg ? decodeDmgPal(DMG_OBP0[1]) : CGB_OBJ_PAL[1][0];
  const splashRgb = dmg ? DMG_SHADES[0] : [247, 247, 232];
  const shadowRgb = dmg ? DMG_SHADES[3] : [24, 32, 46];

  const buf = fbImg.data;
  const loop = (t % 3.6) / 3.6; // 0..1

  if (item === ITEM.STONES) {
    // Player runs smoothly across x = 0.6 -> 8.2 while laying stones on x = 2..7
    const moveT = Math.min(1, loop / 0.82);
    const px = 0.6 + moveT * 7.6;
    const placedMax = Math.floor(px + 0.55);

    for (let ty = 0; ty < 5; ty++) {
      for (let tx = 0; tx < 10; tx++) {
        let mt = STONES_MAP[ty][tx];
        if (ty === 2 && tx >= 2 && tx <= 7 && tx <= placedMax) {
          mt = MT.STEPSTONE;
        }
        blitMetatile(buf, vw, vh, mt, bgPals, tx * 16, ty * 16);
      }
    }

    // Crisp splash pixels on the most recently placed stepping stone
    if (placedMax >= 2 && placedMax <= 7) {
      const stoneAge = (px + 0.55) - placedMax;
      if (stoneAge < 0.45) {
        const cx = placedMax * 16 + 8;
        const cy = 2 * 16 + 8;
        const r = Math.round(3 + stoneAge * 10);
        for (const [ox, oy] of [[-r, -2], [r, -2], [-r + 1, 3], [r - 1, 3], [0, -r + 1]]) {
          putPixel(buf, vw, vh, cx + ox, cy + oy, splashRgb);
          putPixel(buf, vw, vh, cx + ox + 1, cy + oy, splashRgb);
        }
      }
    }

    const spr = moveT < 1 && (Math.floor(t * 9) & 1) ? SPR_PL_SIDE1 : SPR_PL_SIDE0;
    blitPlayer16x16(buf, vw, vh, spr, playerPal, Math.round(px * 16 - 4), 2 * 16 - 2);
  } else {
    // Wind Cloak: run on left ledge, leap & glide over crags + sea, land on right shore
    for (let ty = 0; ty < 5; ty++) {
      for (let tx = 0; tx < 10; tx++) {
        blitMetatile(buf, vw, vh, CLOAK_MAP[ty][tx], bgPals, tx * 16, ty * 16);
      }
    }

    let px = 0.6;
    let lift = 0;
    let gliding = false;
    if (loop < 0.16) {
      px = 0.6 + (loop / 0.16) * 1.1;
    } else if (loop < 0.78) {
      gliding = true;
      const gt = (loop - 0.16) / 0.62;
      px = 1.7 + gt * 6.4;
      lift = Math.sin(gt * Math.PI) * 14;
    } else {
      const lt = Math.min(1, (loop - 0.78) / 0.12);
      px = 8.1 + lt * 0.3;
    }

    const sx = Math.round(px * 16 - 4);
    const groundY = 2 * 16 - 2;

    // Grounded shadow beneath gliding wanderer
    if (gliding) {
      for (let ox = 4; ox < 12; ox++) {
        putPixel(buf, vw, vh, sx + ox, groundY + 14, shadowRgb);
        putPixel(buf, vw, vh, sx + ox, groundY + 15, shadowRgb);
      }
      // Crisp pixel wind streaks trailing behind the cloak
      const wy = Math.round(groundY - lift + 7);
      for (let i = 0; i < 3; i++) {
        const lx = sx - 5 - i * 6 - (Math.floor(t * 24) % 4);
        const ly = wy + (i - 1) * 3;
        for (let k = 0; k < 4; k++) putPixel(buf, vw, vh, lx + k, ly, splashRgb);
      }
    }

    const spr = gliding
      ? SPR_PL_GLIDE
      : ((loop < 0.16 || loop < 0.9) && (Math.floor(t * 9) & 1) ? SPR_PL_SIDE1 : SPR_PL_SIDE0);
    blitPlayer16x16(buf, vw, vh, spr, playerPal, sx, Math.round(groundY - lift));
  }

  fbCtx.putImageData(fbImg, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(fbCanvas, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height);
}
