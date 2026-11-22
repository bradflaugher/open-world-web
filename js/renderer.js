// Lush 60fps Canvas 2D renderer for Open World (web port).
// Renders the 360-degree parallax horizon compass, painterly pixel-art terrain,
// volumetric night lantern & campfire lighting, weather, ambient life, and Map.

import {
  MT, MTF, MAX_STARS, wrapCoord, wrapDelta, worldBearing, worldDist,
} from './world.js';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r},${g},${b})`;
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Deterministic star positions on the 360-degree sky dome
const SKY_STARS = Array.from({ length: MAX_STARS }, (_, i) => ({
  angle: ((i * 2.399963229728653) % (Math.PI * 2)) - Math.PI,
  y: 0.14 + ((i * 37) % 52) / 100,
  phase: i * 1.7,
  big: i < 6 || i % 5 === 0,
}));

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d');
    this.horizonAngle = 0; // smoothed facing bearing (radians, 0 = North)
    this.tileSize = 42;
    this.horizonH = 88;
  }

  resize(w, h, dpr) {
    this.width = w;
    this.height = h;
    this.dpr = Math.min(2, dpr || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.horizonH = Math.max(74, Math.min(114, Math.round(h * 0.16)));
    this.tileSize = Math.max(36, Math.min(48, Math.round(Math.min(w, h) / 10.5)));

    // Low-res offscreen light canvas for silky-smooth soft radial lighting
    this.lightCanvas.width = Math.max(1, Math.round(w / 2));
    this.lightCanvas.height = Math.max(1, Math.round((h - this.horizonH) / 2));
  }

  // Convert screen (clientX, clientY) to world tile coordinates for tap-to-walk.
  screenToWorld(game, sx, sy) {
    if (sy <= this.horizonH) return null;
    const viewH = this.height - this.horizonH;
    const cx = this.width / 2;
    const cy = this.horizonH + viewH * 0.5;
    const wx = game.player.x + (sx - cx) / this.tileSize;
    const wy = game.player.y + (sy - cy) / this.tileSize;
    return { x: ((wx % 65536) + 65536) % 65536, y: ((wy % 65536) + 65536) % 65536 };
  }

  render(game, dt) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!w || !h) return;

    // Smoothly turn the 360-degree horizon toward the wanderer's heading
    const targetAng = Math.atan2(game.player.fx, -game.player.fy);
    this.horizonAngle += angleDiff(this.horizonAngle, targetAng) * Math.min(1, dt * 4.5);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. World viewport (below the horizon band)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.horizonH, w, h - this.horizonH);
    ctx.clip();
    this._renderWorld(ctx, game);
    ctx.restore();

    // 2. 360-degree Horizon Panorama Band (top)
    this._renderHorizon(ctx, game);

    // 3. Horizon seam hairline
    ctx.fillStyle = game.palette === 'dmg' ? '#0f380f' : 'rgba(18, 24, 38, 0.72)';
    ctx.fillRect(0, this.horizonH - 2, w, 2);

    // 4. Transition veil (white fade for Wake or radiant bloom for Heart)
    if (game.transition) {
      const p = game.transition.t / game.transition.dur;
      const alpha = p < 0.55 ? p / 0.55 : Math.max(0, 1 - (p - 0.55) / 0.45);
      ctx.fillStyle = game.transition.kind === 'heart'
        ? `rgba(255, 248, 224, ${alpha.toFixed(3)})`
        : `rgba(244, 248, 255, ${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 5. Optional classic 1989 Game Boy DMG green tint filter
    if (game.palette === 'dmg') {
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = '#8bac0f';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    ctx.restore();
  }

  _renderHorizon(ctx, game) {
    const w = this.width;
    const hh = this.horizonH;
    const night = game.nightAmount;
    const dusk = game.duskAmount;
    const t = game.time;

    // Sky gradient: day -> dusk -> night
    let topC = [164, 186, 206];
    let botC = [224, 228, 222];
    if (dusk > 0.01) {
      topC = [lerp(topC[0], 112, dusk), lerp(topC[1], 76, dusk), lerp(topC[2], 106, dusk)];
      botC = [lerp(botC[0], 238, dusk), lerp(botC[1], 144, dusk), lerp(botC[2], 98, dusk)];
    }
    if (night > 0.01) {
      topC = [lerp(topC[0], 14, night), lerp(topC[1], 20, night), lerp(topC[2], 38, night)];
      botC = [lerp(botC[0], 30, night), lerp(botC[1], 40, night), lerp(botC[2], 66, night)];
    }

    const sky = ctx.createLinearGradient(0, 0, 0, hh);
    sky.addColorStop(0, `rgb(${Math.round(topC[0])},${Math.round(topC[1])},${Math.round(topC[2])})`);
    sky.addColorStop(1, `rgb(${Math.round(botC[0])},${Math.round(botC[1])},${Math.round(botC[2])})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hh);

    // Project a world bearing onto the horizontal panorama (FOV = 150 degrees)
    const fov = Math.PI * 0.85;
    const project = (bearing) => {
      const diff = angleDiff(this.horizonAngle, bearing);
      if (Math.abs(diff) > fov * 0.6) return null;
      return w * 0.5 + (diff / (fov * 0.5)) * (w * 0.5);
    };

    // Collected permanent stars in the sky (visible at dusk & night)
    const starVis = Math.max(night, dusk * 0.55);
    if (starVis > 0.05) {
      for (let i = 0; i < game.stars; i++) {
        const st = SKY_STARS[i];
        const sx = project(st.angle);
        if (sx === null) continue;
        const twinkle = 0.55 + 0.45 * Math.sin(t * 2.2 + st.phase);
        ctx.fillStyle = `rgba(255, 248, 214, ${(starVis * twinkle).toFixed(3)})`;
        const r = st.big ? 2.1 : 1.35;
        ctx.fillRect(Math.round(sx - r / 2), Math.round(st.y * hh), Math.ceil(r), Math.ceil(r));
      }
    }

    // Subtle drifting mist clouds in the day/dusk sky
    if (night < 0.85) {
      ctx.fillStyle = `rgba(255, 250, 240, ${((1 - night) * 0.25).toFixed(3)})`;
      for (let i = 0; i < 6; i++) {
        const ang = ((i * 1.1 + t * 0.008) % (Math.PI * 2)) - Math.PI;
        const cx = project(ang);
        if (cx === null) continue;
        const cy = hh * (0.26 + (i % 3) * 0.14);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 34 + (i % 2) * 16, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Two parallax mountain ridge silhouettes
    const drawRidge = (scale, baseY, amp, color, phaseOff) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, hh);
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const ang = this.horizonAngle + (u - 0.5) * fov;
        const h1 = Math.sin(ang * scale + phaseOff) * 0.55
          + Math.sin(ang * scale * 2.3 + phaseOff * 1.7) * 0.3
          + Math.cos(ang * scale * 4.1 - phaseOff) * 0.15;
        const y = hh * baseY - h1 * amp;
        ctx.lineTo(u * w, y);
      }
      ctx.lineTo(w, hh);
      ctx.closePath();
      ctx.fill();
    };

    const farColor = lerpColor(
      dusk > 0.2 ? [108, 76, 98] : [120, 134, 152],
      [24, 30, 50],
      night,
    );
    const nearColor = lerpColor(
      dusk > 0.2 ? [54, 40, 58] : [64, 74, 92],
      [13, 17, 30],
      night,
    );
    drawRidge(2.5, 0.72, hh * 0.18, farColor, game.world.seed * 0.1);
    drawRidge(3.5, 0.84, hh * 0.15, nearColor, game.world.seed * 0.37 + 2.1);

    // Landmarks standing on the horizon at their true bearings!
    const px = Math.floor(game.player.x);
    const py = Math.floor(game.player.y);

    // 1. Nearest Wisp glint low on the far ridge
    const wisp = game.world.nearestWisp(px, py);
    if (wisp && wisp.dist > 5) {
      const wx = project(worldBearing(px, py, wisp.x, wisp.y));
      if (wx !== null) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 4.2);
        ctx.fillStyle = `rgba(255, 248, 200, ${pulse.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(wx, hh * 0.78, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 232, 140, ${(pulse * 0.35).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(wx, hh * 0.78, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Nearest Cairn marker
    const cairn = game.world.nearestCairn(px, py);
    if (cairn && cairn.dist > 4) {
      const cx = project(worldBearing(px, py, cairn.x, cairn.y));
      if (cx !== null) {
        ctx.fillStyle = night > 0.5 ? '#8a94ad' : '#3a4252';
        ctx.fillRect(Math.round(cx - 3), Math.round(hh - 12), 6, 4);
        ctx.fillRect(Math.round(cx - 2), Math.round(hh - 15), 4, 3);
      }
    }

    // 3. The Three Beacons
    for (let i = 0; i < 3; i++) {
      const b = game.world.beacons[i];
      const dist = worldDist(px, py, b.x, b.y);
      const bx = project(worldBearing(px, py, b.x, b.y));
      if (bx === null) continue;
      const lit = game.beaconsLit[i];
      const scale = Math.max(0.65, Math.min(1.35, 1.35 - dist / 90));
      const ph = Math.round(24 * scale);
      const pyTop = hh - ph - 3;

      if (lit) {
        // Luminous vertical beam into the sky
        const beam = ctx.createLinearGradient(0, 0, 0, hh);
        beam.addColorStop(0, 'rgba(255, 236, 168, 0)');
        beam.addColorStop(1, 'rgba(255, 224, 130, 0.36)');
        ctx.fillStyle = beam;
        ctx.fillRect(bx - 7, 0, 14, hh);
      }

      ctx.fillStyle = lit ? '#d98a3c' : (night > 0.5 ? '#26304a' : '#242c3d');
      ctx.fillRect(Math.round(bx - 2.5), pyTop + 6, 5, ph - 4);
      ctx.fillRect(Math.round(bx - 4.5), pyTop + 5, 9, 2.5);

      if (lit) {
        const flick = Math.sin(t * 9 + i) * 1.5;
        ctx.fillStyle = '#fff9d6';
        ctx.beginPath();
        ctx.arc(bx, pyTop + 2 + flick * 0.3, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. The Heart (rises once all 3 beacons burn!)
    if (game.allBeaconsLit) {
      const hx = project(worldBearing(px, py, game.world.heart.x, game.world.heart.y));
      if (hx !== null) {
        const pulse = 0.75 + 0.25 * Math.sin(t * 3);
        const beam = ctx.createLinearGradient(0, 0, 0, hh);
        beam.addColorStop(0, `rgba(255, 252, 235, ${(0.55 * pulse).toFixed(3)})`);
        beam.addColorStop(1, `rgba(255, 240, 190, ${(0.18 * pulse).toFixed(3)})`);
        ctx.fillStyle = beam;
        ctx.fillRect(hx - 10, 0, 20, hh);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(hx, hh * 0.42, 5.5 * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _renderWorld(ctx, game) {
    const w = this.width;
    const viewH = this.height - this.horizonH;
    const S = this.tileSize;
    const camX = game.player.x;
    const camY = game.player.y;
    const centerX = w / 2;
    const centerY = this.horizonH + viewH * 0.5;
    const t = game.time;

    const toScreenX = (wx) => centerX + (wrapDelta(Math.floor(camX), Math.floor(wx)) + (wx - Math.floor(wx)) - (camX - Math.floor(camX))) * S;
    const toScreenY = (wy) => centerY + (wrapDelta(Math.floor(camY), Math.floor(wy)) + (wy - Math.floor(wy)) - (camY - Math.floor(camY))) * S;

    const halfCols = Math.ceil(w / (2 * S)) + 2;
    const halfRows = Math.ceil(viewH / (2 * S)) + 2;
    const baseTx = Math.floor(camX);
    const baseTy = Math.floor(camY);

    const lightSources = []; // { sx, sy, radius, color }

    // 1. Draw terrain tiles
    for (let dy = -halfRows; dy <= halfRows; dy++) {
      for (let dx = -halfCols; dx <= halfCols; dx++) {
        const tx = wrapCoord(baseTx + dx);
        const ty = wrapCoord(baseTy + dy);
        const sx = Math.floor(centerX + (dx - (camX - baseTx)) * S);
        const sy = Math.floor(centerY + (dy - (camY - baseTy)) * S);
        const mt = game.world.mtAt(tx, ty);
        const det = game.world.detail(tx, ty);
        this._drawTile(ctx, game, mt, tx, ty, sx, sy, S, det, t, lightSources);
      }
    }

    // 2. Footprints in sand/snow/ash
    for (const fp of game.footprints) {
      const a = Math.max(0, 1 - fp.life / fp.maxLife) * 0.35;
      ctx.fillStyle = `rgba(38, 42, 54, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(toScreenX(fp.x), toScreenY(fp.y) + S * 0.2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Tap-to-walk subtle destination ring
    if (game.walkTarget) {
      const tx = toScreenX(game.walkTarget.x);
      const ty = toScreenY(game.walkTarget.y);
      const pulse = 0.65 + 0.35 * Math.sin(t * 7);
      ctx.strokeStyle = `rgba(255, 248, 210, ${(0.7 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 7 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Nearby glowing Wisps
    const baseCx = Math.floor(baseTx / 24);
    const baseCy = Math.floor(baseTy / 24);
    for (let cy = baseCy - 1; cy <= baseCy + 1; cy++) {
      for (let cx = baseCx - 1; cx <= baseCx + 1; cx++) {
        const wisp = game.world.wispInChunk(cx, cy);
        if (!wisp) continue;
        const sx = toScreenX(wisp.x + 0.5);
        const sy = toScreenY(wisp.y + 0.5);
        if (sx < -40 || sx > w + 40 || sy < this.horizonH - 40 || sy > this.height + 40) continue;
        const bob = Math.sin(t * 3.2 + wisp.x) * 4;
        const g = ctx.createRadialGradient(sx, sy + bob, 1, sx, sy + bob, S * 0.55);
        g.addColorStop(0, 'rgba(255, 252, 224, 0.95)');
        g.addColorStop(0.4, 'rgba(255, 226, 140, 0.45)');
        g.addColorStop(1, 'rgba(255, 226, 140, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy + bob, S * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy + bob, 3.6, 0, Math.PI * 2);
        ctx.fill();
        lightSources.push({ sx, sy: sy + bob, r: S * 1.6 });
      }
    }

    // 5. Startled birds
    for (const b of game.birds) {
      const bx = toScreenX(b.x);
      const by = toScreenY(b.y);
      ctx.fillStyle = '#242b38';
      if (b.flying) {
        const wing = Math.sin(b.flap) * 5;
        ctx.strokeStyle = '#1e2430';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx - 6, by - wing);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + 6, by - wing);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(bx, by, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(bx + 2, by - 3, 2, 2);
      }
    }

    // 6. Pale Watchers
    for (const wt of game.watchers) {
      const wx = toScreenX(wt.x);
      const wy = toScreenY(wt.y);
      const sway = Math.sin(wt.phase) * 2;
      ctx.fillStyle = 'rgba(225, 232, 248, 0.72)';
      ctx.beginPath();
      ctx.ellipse(wx + sway, wy - S * 0.15, S * 0.14, S * 0.44, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141926';
      ctx.fillRect(wx + sway - 3, wy - S * 0.36, 2, 2);
      ctx.fillRect(wx + sway + 1, wy - S * 0.36, 2, 2);
    }

    // 7. The Wanderer!
    this._drawWanderer(ctx, game, centerX, centerY, S, t);
    lightSources.push({
      sx: centerX,
      sy: centerY - S * 0.1,
      r: S * (game.selectedItem === 0 ? 3.2 : 2.3),
    });

    // 8. Bobbing context action indicator above the target tile (kid-friendly visual cue!)
    const act = game.getContextAction();
    if (act && act.kind !== 'build-cairn') {
      const ax = toScreenX(act.x + 0.5);
      const ay = toScreenY(act.y) - 6 + Math.sin(t * 5.2) * 4;
      ctx.save();
      ctx.fillStyle = 'rgba(20, 26, 40, 0.85)';
      ctx.strokeStyle = '#ffe599';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(ax - 13, ay - 13, 26, 24, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff6d6';
      ctx.font = '700 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const glyph = act.icon === 'flame' ? '🔥' : act.icon === 'stone' ? '🪨' : act.icon === 'cloak' ? '🪽' : act.icon === 'gift' ? '✦' : '★';
      ctx.fillText(glyph, ax, ay - 1);
      ctx.restore();
    }

    // 9. Particles (fire embers, wisp stars, glide wind, splashes)
    for (const p of game.particles) {
      const a = Math.max(0, 1 - p.life / p.maxLife);
      const px = toScreenX(p.x);
      const py = toScreenY(p.y);
      if (p.kind === 'fire' || p.kind === 'beacon') ctx.fillStyle = `rgba(255, ${Math.round(160 + a * 90)}, 90, ${a.toFixed(3)})`;
      else if (p.kind === 'star') ctx.fillStyle = `rgba(255, 250, 200, ${a.toFixed(3)})`;
      else if (p.kind === 'splash') ctx.fillStyle = `rgba(220, 244, 255, ${a.toFixed(3)})`;
      else if (p.kind === 'wind') ctx.fillStyle = `rgba(235, 242, 255, ${(a * 0.7).toFixed(3)})`;
      else ctx.fillStyle = `rgba(205, 195, 175, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // 10. Night & Dusk atmospheric lighting ("Only light stays light")
    const night = game.nightAmount;
    const dusk = game.duskAmount;
    if (dusk > 0.04) {
      ctx.fillStyle = `rgba(210, 108, 62, ${(dusk * 0.16).toFixed(3)})`;
      ctx.fillRect(0, this.horizonH, w, viewH);
    }
    if (night > 0.03) {
      const lc = this.lightCtx;
      const lw = this.lightCanvas.width;
      const lh = this.lightCanvas.height;
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, lw, lh);
      lc.fillStyle = `rgba(8, 12, 26, ${(night * 0.84).toFixed(3)})`;
      lc.fillRect(0, 0, lw, lh);

      lc.globalCompositeOperation = 'destination-out';
      for (const ls of lightSources) {
        const lx = ls.sx / 2;
        const ly = (ls.sy - this.horizonH) / 2;
        const lr = ls.r / 2;
        const g = lc.createRadialGradient(lx, ly, lr * 0.12, lx, ly, lr);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.62)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        lc.fillStyle = g;
        lc.beginPath();
        lc.arc(lx, ly, lr, 0, Math.PI * 2);
        lc.fill();
      }
      ctx.drawImage(this.lightCanvas, 0, this.horizonH, w, viewH);

      // Warm golden additive glow around lantern & fires at night
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (const ls of lightSources) {
        const g = ctx.createRadialGradient(ls.sx, ls.sy, 2, ls.sx, ls.sy, ls.r * 0.65);
        g.addColorStop(0, `rgba(255, 206, 118, ${(night * 0.28).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255, 180, 90, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ls.sx, ls.sy, ls.r * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 11. Fireflies (drawn ABOVE night veil so they glow brightly!)
    for (const f of game.fireflies) {
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(f.phase));
      const fx = toScreenX(f.x);
      const fy = toScreenY(f.y);
      ctx.fillStyle = `rgba(255, 244, 150, ${pulse.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 12. Weather overlay (rain / snow / fog)
    const weather = game.currentWeather();
    if (weather === 'rain') {
      ctx.strokeStyle = 'rgba(205, 224, 245, 0.38)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 42; i++) {
        const rx = ((i * 97 + t * 240) % (w + 60)) - 30;
        const ry = this.horizonH + ((i * 131 + t * 520) % viewH);
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 5, ry + 14);
      }
      ctx.stroke();
    } else if (weather === 'snow') {
      ctx.fillStyle = 'rgba(250, 252, 255, 0.72)';
      for (let i = 0; i < 45; i++) {
        const rx = ((i * 89 + Math.sin(t + i) * 24 + t * 26) % w + w) % w;
        const ry = this.horizonH + ((i * 113 + t * 68) % viewH);
        ctx.fillRect(rx, ry, 2.5, 2.5);
      }
    } else if (weather === 'fog') {
      ctx.fillStyle = 'rgba(218, 224, 232, 0.22)';
      ctx.fillRect(0, this.horizonH, w, viewH);
    }
  }

  _drawTile(ctx, game, mt, tx, ty, x, y, S, det, t, lightSources) {
    // Base ground fill
    switch (mt) {
      case MT.SEA:
      case MT.SEA_GLINT: {
        ctx.fillStyle = '#3f6c86';
        ctx.fillRect(x, y, S + 1, S + 1);
        const waveOff = Math.sin(t * 2 + ty * 0.9 + tx * 0.4) * 3;
        ctx.fillStyle = 'rgba(26, 52, 72, 0.45)';
        ctx.fillRect(x + S * 0.18 + waveOff, y + S * 0.36, S * 0.28, 2);
        ctx.fillRect(x + S * 0.54 - waveOff, y + S * 0.72, S * 0.24, 2);
        if (mt === MT.SEA_GLINT && Math.sin(t * 3 + det) > 0.2) {
          ctx.fillStyle = '#fff9df';
          ctx.fillRect(x + S * 0.44, y + S * 0.42, 4, 2);
        }
        return;
      }
      case MT.SHALLOW: {
        ctx.fillStyle = '#7ba8b8';
        ctx.fillRect(x, y, S + 1, S + 1);
        // Autotiled shoreline foam against non-water neighbors
        ctx.fillStyle = 'rgba(235, 248, 252, 0.65)';
        if (!(game.world.flagsAt(tx, ty - 1) & MTF.WATER)) ctx.fillRect(x, y, S, 3);
        if (!(game.world.flagsAt(tx, ty + 1) & MTF.WATER)) ctx.fillRect(x, y + S - 3, S, 3);
        if (!(game.world.flagsAt(tx - 1, ty) & MTF.WATER)) ctx.fillRect(x, y, 3, S);
        if (!(game.world.flagsAt(tx + 1, ty) & MTF.WATER)) ctx.fillRect(x + S - 3, y, 3, S);
        const rip = Math.sin(t * 2.5 + tx + ty) * 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x + S * 0.25 + rip, y + S * 0.5, S * 0.35, 2);
        return;
      }
      case MT.STEPSTONE:
        ctx.fillStyle = '#7ba8b8';
        ctx.fillRect(x, y, S + 1, S + 1);
        ctx.fillStyle = '#c8c0ad';
        ctx.beginPath();
        ctx.ellipse(x + S * 0.5, y + S * 0.52, S * 0.34, S * 0.26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e4decb';
        ctx.beginPath();
        ctx.ellipse(x + S * 0.47, y + S * 0.46, S * 0.24, S * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      case MT.SAND:
        ctx.fillStyle = '#d4c39c';
        ctx.fillRect(x, y, S + 1, S + 1);
        if (det & 3) {
          ctx.fillStyle = '#b9a67d';
          ctx.fillRect(x + (det % 7) * (S / 8), y + ((det >> 3) % 7) * (S / 8), 2, 2);
        }
        return;
      case MT.SNOW:
      case MT.PINE:
        ctx.fillStyle = '#dce5ec';
        ctx.fillRect(x, y, S + 1, S + 1);
        if (mt === MT.PINE) {
          ctx.fillStyle = '#304c42';
          ctx.beginPath();
          ctx.moveTo(x + S * 0.5, y + S * 0.1);
          ctx.lineTo(x + S * 0.86, y + S * 0.78);
          ctx.lineTo(x + S * 0.14, y + S * 0.78);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#f2f7fa';
          ctx.beginPath();
          ctx.moveTo(x + S * 0.5, y + S * 0.1);
          ctx.lineTo(x + S * 0.68, y + S * 0.42);
          ctx.lineTo(x + S * 0.32, y + S * 0.42);
          ctx.closePath();
          ctx.fill();
        }
        return;
      case MT.DUNE:
      case MT.BONES:
        ctx.fillStyle = '#d9b578';
        ctx.fillRect(x, y, S + 1, S + 1);
        ctx.fillStyle = 'rgba(166, 124, 64, 0.28)';
        ctx.fillRect(x + S * 0.1, y + S * 0.35, S * 0.5, 2);
        ctx.fillRect(x + S * 0.35, y + S * 0.7, S * 0.45, 2);
        if (mt === MT.BONES) {
          ctx.strokeStyle = '#f5eedc';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x + S * 0.5, y + S * 0.55, S * 0.22, Math.PI, 0);
          ctx.stroke();
        }
        return;
      case MT.ASH:
      case MT.GLASS:
        ctx.fillStyle = '#686b75';
        ctx.fillRect(x, y, S + 1, S + 1);
        if (mt === MT.GLASS) {
          ctx.fillStyle = '#fff9df';
          ctx.fillRect(x + S * 0.35, y + S * 0.38, 3, 5);
          ctx.fillRect(x + S * 0.62, y + S * 0.6, 2, 4);
        }
        return;
      case MT.RUIN_FLOOR:
      case MT.RUIN_WALL:
      case MT.PILLAR:
      case MT.ROAD:
      case MT.SHRINE:
      case MT.SHRINE_EMPTY:
      case MT.BEACON:
      case MT.BEACON_LIT:
      case MT.HEART:
        ctx.fillStyle = mt === MT.ROAD ? '#a7a093' : '#96928c';
        ctx.fillRect(x, y, S + 1, S + 1);
        ctx.strokeStyle = 'rgba(42, 46, 56, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
        if (mt === MT.RUIN_WALL) {
          ctx.fillStyle = '#5a5f6b';
          ctx.fillRect(x + 2, y + 3, S - 4, S - 6);
        } else if (mt === MT.PILLAR) {
          ctx.fillStyle = '#c5c1b8';
          ctx.fillRect(x + S * 0.3, y + S * 0.14, S * 0.4, S * 0.72);
          ctx.fillStyle = '#dedad0';
          ctx.fillRect(x + S * 0.22, y + S * 0.12, S * 0.56, S * 0.14);
        } else if (mt === MT.SHRINE || mt === MT.SHRINE_EMPTY) {
          ctx.fillStyle = '#535866';
          ctx.fillRect(x + S * 0.2, y + S * 0.48, S * 0.6, S * 0.34);
          ctx.fillStyle = '#c8c4b8';
          ctx.fillRect(x + S * 0.15, y + S * 0.42, S * 0.7, S * 0.12);
          if (mt === MT.SHRINE) {
            const bob = Math.sin(t * 4) * 3;
            ctx.fillStyle = '#ffe999';
            ctx.beginPath();
            ctx.arc(x + S * 0.5, y + S * 0.26 + bob, S * 0.16, 0, Math.PI * 2);
            ctx.fill();
            lightSources.push({ sx: x + S * 0.5, sy: y + S * 0.3, r: S * 1.8 });
          }
        } else if (mt === MT.BEACON || mt === MT.BEACON_LIT) {
          ctx.fillStyle = '#394052';
          ctx.fillRect(x + S * 0.28, y + S * 0.2, S * 0.44, S * 0.68);
          ctx.fillStyle = '#5b647a';
          ctx.fillRect(x + S * 0.2, y + S * 0.18, S * 0.6, S * 0.12);
          if (mt === MT.BEACON_LIT) {
            const fl = Math.sin(t * 11) * 2.5;
            ctx.fillStyle = '#ff9838';
            ctx.beginPath();
            ctx.arc(x + S * 0.5, y + S * 0.16, S * 0.24 + fl * 0.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff9d6';
            ctx.beginPath();
            ctx.arc(x + S * 0.5, y + S * 0.14, S * 0.14, 0, Math.PI * 2);
            ctx.fill();
            lightSources.push({ sx: x + S * 0.5, sy: y + S * 0.25, r: S * 4.5 });
          }
        } else if (mt === MT.HEART) {
          const pulse = 0.8 + 0.2 * Math.sin(t * 3.5);
          ctx.fillStyle = game.allBeaconsLit ? '#fff9d6' : '#6c7488';
          ctx.beginPath();
          ctx.moveTo(x + S * 0.5, y + S * 0.1);
          ctx.lineTo(x + S * 0.82, y + S * 0.5);
          ctx.lineTo(x + S * 0.5, y + S * 0.88);
          ctx.lineTo(x + S * 0.18, y + S * 0.5);
          ctx.closePath();
          ctx.fill();
          if (game.allBeaconsLit) {
            lightSources.push({ sx: x + S * 0.5, sy: y + S * 0.5, r: S * 5 * pulse });
          }
        }
        return;
      default:
        break;
    }

    // Meadow / Forest / Rock / Props ground base
    ctx.fillStyle = mt === MT.UNDERGROWTH ? '#6c7c54' : '#9ca676';
    ctx.fillRect(x, y, S + 1, S + 1);

    if (mt === MT.GRASS && (det & 7) === 0) {
      ctx.fillStyle = '#7f8a5c';
      ctx.fillRect(x + S * 0.4, y + S * 0.45, 2, 4);
      ctx.fillRect(x + S * 0.46, y + S * 0.48, 2, 3);
    } else if (mt === MT.GRASS_TALL) {
      const sway = Math.sin(t * 2.5 + tx * 0.8 + ty * 0.5) * 2.5;
      ctx.strokeStyle = '#5d6b43';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const bx = x + S * (0.2 + i * 0.2);
        ctx.moveTo(bx, y + S * 0.8);
        ctx.lineTo(bx + sway, y + S * 0.28);
      }
      ctx.stroke();
    } else if (mt === MT.FLOWERS) {
      ctx.fillStyle = '#f8f2d8';
      ctx.fillRect(x + S * 0.28, y + S * 0.34, 3, 3);
      ctx.fillStyle = '#f0c45a';
      ctx.fillRect(x + S * 0.62, y + S * 0.58, 3, 3);
    } else if (mt === MT.UNDERGROWTH) {
      ctx.fillStyle = '#53623f';
      ctx.fillRect(x + S * 0.2, y + S * 0.35, S * 0.26, 3);
      ctx.fillRect(x + S * 0.52, y + S * 0.62, S * 0.26, 3);
    } else if (mt === MT.TREE) {
      ctx.fillStyle = '#544538';
      ctx.fillRect(x + S * 0.42, y + S * 0.58, S * 0.16, S * 0.32);
      ctx.fillStyle = '#3f573d';
      ctx.beginPath();
      ctx.arc(x + S * 0.5, y + S * 0.42, S * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#577250';
      ctx.beginPath();
      ctx.arc(x + S * 0.45, y + S * 0.34, S * 0.22, 0, Math.PI * 2);
      ctx.fill();
    } else if (mt === MT.ROCK || mt === MT.ROCK_PEAK) {
      ctx.fillStyle = mt === MT.ROCK_PEAK ? '#434957' : '#656c7a';
      ctx.beginPath();
      ctx.moveTo(x + S * 0.1, y + S * 0.85);
      ctx.lineTo(x + S * 0.46, y + S * 0.15);
      ctx.lineTo(x + S * 0.9, y + S * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(x + S * 0.46, y + S * 0.15);
      ctx.lineTo(x + S * 0.62, y + S * 0.5);
      ctx.lineTo(x + S * 0.38, y + S * 0.5);
      ctx.closePath();
      ctx.fill();
    } else if (mt === MT.BRAMBLE) {
      ctx.fillStyle = '#3d332c';
      ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.strokeStyle = '#6e523d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 6);
      ctx.lineTo(x + S - 4, y + S - 6);
      ctx.moveTo(x + S - 4, y + 6);
      ctx.lineTo(x + 4, y + S - 6);
      ctx.stroke();
    } else if (mt === MT.FIRE_COLD || mt === MT.FIRE_LIT) {
      ctx.fillStyle = '#5d4a3a';
      ctx.beginPath();
      ctx.ellipse(x + S * 0.5, y + S * 0.68, S * 0.3, S * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      if (mt === MT.FIRE_LIT) {
        const fl = Math.sin(t * 12 + tx) * 2;
        ctx.fillStyle = '#ff8c2e';
        ctx.beginPath();
        ctx.moveTo(x + S * 0.5, y + S * 0.16 + fl);
        ctx.quadraticCurveTo(x + S * 0.78, y + S * 0.58, x + S * 0.5, y + S * 0.7);
        ctx.quadraticCurveTo(x + S * 0.22, y + S * 0.58, x + S * 0.5, y + S * 0.16 + fl);
        ctx.fill();
        ctx.fillStyle = '#fff7d1';
        ctx.beginPath();
        ctx.arc(x + S * 0.5, y + S * 0.54, S * 0.13, 0, Math.PI * 2);
        ctx.fill();
        lightSources.push({ sx: x + S * 0.5, sy: y + S * 0.5, r: S * 3.8 });
      }
    } else if (mt === MT.CAIRN || mt === MT.CAIRN_OLD) {
      ctx.fillStyle = mt === MT.CAIRN_OLD ? '#737882' : '#c6beab';
      ctx.beginPath();
      ctx.ellipse(x + S * 0.5, y + S * 0.7, S * 0.28, S * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + S * 0.5, y + S * 0.5, S * 0.2, S * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + S * 0.5, y + S * 0.34, S * 0.12, S * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (mt === MT.MONOLITH || mt === MT.STATUE_HAND) {
      ctx.fillStyle = '#252a36';
      ctx.fillRect(x + S * 0.34, y + S * 0.12, S * 0.32, S * 0.76);
    } else if (mt === MT.TABLE) {
      ctx.fillStyle = '#6c5440';
      ctx.fillRect(x + S * 0.2, y + S * 0.36, S * 0.6, S * 0.3);
      ctx.fillStyle = '#f2ece0';
      ctx.fillRect(x + S * 0.28, y + S * 0.44, 4, 4);
      ctx.fillRect(x + S * 0.64, y + S * 0.44, 4, 4);
    } else if (mt === MT.WELL) {
      ctx.fillStyle = '#6e737f';
      ctx.beginPath();
      ctx.arc(x + S * 0.5, y + S * 0.52, S * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2c475c';
      ctx.beginPath();
      ctx.arc(x + S * 0.5, y + S * 0.52, S * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawWanderer(ctx, game, cx, cy, S, t) {
    const p = game.player;
    const bob = game.glide ? -6 : (p.moving ? Math.abs(Math.sin(p.anim)) * -3.5 : (game.sitting ? 3 : Math.sin(t * 2) * 0.8));

    // Ground shadow
    ctx.fillStyle = 'rgba(18, 22, 32, 0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + S * 0.26, S * 0.24, S * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cloaked silhouette (Friedrich's Wanderer)
    ctx.fillStyle = '#1b2230';
    ctx.beginPath();
    ctx.moveTo(cx, cy - S * 0.26 + bob);
    ctx.lineTo(cx + S * 0.26, cy + S * 0.24 + bob);
    ctx.lineTo(cx - S * 0.26, cy + S * 0.24 + bob);
    ctx.closePath();
    ctx.fill();

    // Scarf / shoulder accent
    ctx.fillStyle = game.items[2] ? '#c86545' : '#4a5a75';
    ctx.fillRect(cx - S * 0.14, cy - S * 0.08 + bob, S * 0.28, S * 0.09);

    // Head / hood
    ctx.fillStyle = '#1b2230';
    ctx.beginPath();
    ctx.arc(cx, cy - S * 0.2 + bob, S * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Small glowing lantern held at the wanderer's side
    const lx = cx + p.fx * S * 0.24;
    const ly = cy + p.fy * S * 0.16 + bob;
    ctx.fillStyle = '#ffe999';
    ctx.beginPath();
    ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Render the parchment Map overlay onto a dedicated canvas
  renderMap(mapCanvas, game) {
    const ctx = mapCanvas.getContext('2d');
    const size = mapCanvas.width;
    ctx.fillStyle = '#ece4d0';
    ctx.fillRect(0, 0, size, size);

    // Subtle cartographic dot grid
    ctx.fillStyle = 'rgba(60, 56, 48, 0.18)';
    for (let y = 12; y < size; y += 14) {
      for (let x = 12; x < size; x += 14) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    const scale = size / 130; // 130 tiles across the chart
    const px = game.player.x;
    const py = game.player.y;
    const toMap = (wx, wy) => [
      size / 2 + wrapDelta(Math.floor(px), Math.floor(wx)) * scale,
      size / 2 + wrapDelta(Math.floor(py), Math.floor(wy)) * scale,
    ];

    // Visited trail
    ctx.fillStyle = 'rgba(116, 128, 92, 0.55)';
    for (const key of game.visited) {
      const [vx, vy] = key.split(',').map(Number);
      const [mx, my] = toMap(vx * 2, vy * 2);
      if (mx >= 0 && mx <= size && my >= 0 && my <= size) {
        ctx.fillRect(mx - 2, my - 2, 4.5, 4.5);
      }
    }

    // Dotted ancient roads for lit beacons (and the Heart once revealed)
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
    for (let i = 0; i < 3; i++) {
      if (game.beaconsLit[i]) drawDottedRoad(game.world.beacons[i], '#2c3648');
    }
    if (game.allBeaconsLit) drawDottedRoad(game.world.heart, '#c56b26');

    // Cairns
    ctx.fillStyle = '#5a5f6c';
    for (const c of game.world.cairns) {
      const [cx, cy] = toMap(c.x, c.y);
      if (cx >= 4 && cx <= size - 4 && cy >= 4 && cy <= size - 4) {
        ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
      }
    }

    // Beacons & Heart (pinned to chart edge if off-chart!)
    const pin = (wx, wy, color, lit, isHeart = false) => {
      let [mx, my] = toMap(wx, wy);
      const pad = 12;
      mx = Math.max(pad, Math.min(size - pad, mx));
      my = Math.max(pad, Math.min(size - pad, my));
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
        ctx.fillRect(mx - 3, my - 6, 6, 12);
        ctx.fillRect(mx - 5, my - 6, 10, 2.5);
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

    // Wanderer at center
    ctx.fillStyle = '#1b2230';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff8dc';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
