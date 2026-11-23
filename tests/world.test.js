import test from 'node:test';
import assert from 'node:assert/strict';
import {
  World, MT, ITEM, wrapCoord, wrapDelta, worldDist,
} from '../js/world.js';
import { Game } from '../js/game.js';

test('world generation is deterministic for the same 16-bit seed', () => {
  const a = new World(4242);
  const b = new World(4242);
  assert.deepEqual(a.start, b.start);
  assert.deepEqual(a.beacons, b.beacons);
  assert.deepEqual(a.heart, b.heart);
  for (let dy = -12; dy <= 12; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      assert.equal(a.mtAt(a.start.x + dx, a.start.y + dy), b.mtAt(b.start.x + dx, b.start.y + dy));
    }
  }
});

test('toroidal wrap helpers handle 16-bit seam cleanly', () => {
  assert.equal(wrapCoord(-1), 65535);
  assert.equal(wrapCoord(65536), 0);
  assert.equal(wrapDelta(65534, 2), 4);
  assert.equal(wrapDelta(2, 65534), -4);
  assert.equal(worldDist(65535, 0, 1, 0), 2);
});

test('world places cold fire at start, 3 gated beacons, 2 shrines, and Heart', () => {
  const w = new World(1337);
  assert.equal(w.mtAt(w.start.x, w.start.y), MT.FIRE_COLD);
  for (let i = 0; i < 3; i++) {
    assert.equal(w.mtAt(w.beacons[i].x, w.beacons[i].y), MT.BEACON);
  }
  assert.equal(w.mtAt(w.shrines[0].x, w.shrines[0].y), MT.SHRINE);
  assert.equal(w.mtAt(w.shrines[1].x, w.shrines[1].y), MT.SHRINE);
  assert.equal(w.mtAt(w.heart.x, w.heart.y), MT.HEART);
  // Check distinct gate rings at radius 4 from each beacon
  assert.equal(w.mtAt(w.beacons[0].x, w.beacons[0].y + 4), MT.BRAMBLE);
  assert.equal(w.mtAt(w.beacons[1].x, w.beacons[1].y + 4), MT.SHALLOW);
  assert.equal(w.mtAt(w.beacons[2].x, w.beacons[2].y + 4), MT.ROCK);
});

test('lighting starting fire, burning bramble, claiming shrine, and lighting beacon work', () => {
  const g = new Game();
  // Player spawns just south of start cold fire, facing north
  const act0 = g.getContextAction();
  assert.equal(act0.kind, 'light-fire');
  assert.equal(g.performAction(), true);
  assert.equal(g.world.mtAt(g.world.start.x, g.world.start.y), MT.FIRE_LIT);

  // Move to south edge of Beacon 0's bramble ring and burn it
  const b0 = g.world.beacons[0];
  g.player.x = b0.x + 0.5;
  g.player.y = b0.y + 5.5;
  g.player.fx = 0;
  g.player.fy = -1;
  assert.equal(g.getContextAction().kind, 'burn');
  assert.equal(g.performAction(), true);
  assert.equal(g.world.mtAt(b0.x, b0.y + 4), MT.ASH);

  // Stand beside Beacon 0 and light it
  g.player.x = b0.x + 0.5;
  g.player.y = b0.y + 1.5;
  assert.equal(g.getContextAction().kind, 'light-beacon');
  assert.equal(g.performAction(), true);
  assert.equal(g.beaconsLit[0], true);
  assert.equal(g.world.mtAt(b0.x, b0.y), MT.BEACON_LIT);

  // Claim Stones from Shrine 0
  const s0 = g.world.shrines[0];
  g.player.x = s0.x + 0.5;
  g.player.y = s0.y + 1.5;
  assert.equal(g.getContextAction().kind, 'shrine');
  assert.equal(g.performAction(), true);
  assert.equal(g.items[ITEM.STONES], true);
});

test('stepping stones bridge shallows and cloak glides over crags', () => {
  const g = new Game();
  g.items[ITEM.STONES] = true;
  g.items[ITEM.CLOAK] = true;

  // Bridge Beacon 1's shallows ring
  const b1 = g.world.beacons[1];
  g.player.x = b1.x + 0.5;
  g.player.y = b1.y + 5.5;
  g.player.fx = 0;
  g.player.fy = -1;
  assert.equal(g.getContextAction().kind, 'stepstone');
  assert.equal(g.performAction(), true);
  assert.equal(g.world.mtAt(b1.x, b1.y + 4), MT.STEPSTONE);

  // Glide over Beacon 2's rock ring
  const b2 = g.world.beacons[2];
  g.player.x = b2.x + 0.5;
  g.player.y = b2.y + 5.5;
  g.player.fx = 0;
  g.player.fy = -1;
  const glideAct = g.getContextAction();
  assert.equal(glideAct.kind, 'glide');
  assert.equal(g.performAction(), true);
  assert.ok(g.glide !== null);
  // Advance simulation until glide completes
  for (let i = 0; i < 20; i++) g.update(0.05);
  assert.equal(g.glide, null);
  assert.ok(g.player.y < b2.y + 4);
});

test('serialization round-trips state and Heart carries cairns & stars to next world', () => {
  const g = new Game();
  g.stars = 9;
  g.world.placeCairn(g.world.start.x + 6, g.world.start.y + 2);
  g.beaconsLit = [true, true, true];
  const saved = g.serialize();
  const restored = new Game(saved);
  assert.equal(restored.stars, 9);
  assert.equal(restored.allBeaconsLit, true);
  assert.equal(restored.world.cairns.length, 1);

  // Trigger Heart rebirth
  const h = restored.world.heart;
  restored.player.x = h.x + 0.5;
  restored.player.y = h.y + 1.5;
  restored.player.fx = 0;
  restored.player.fy = -1;
  assert.equal(restored.getContextAction().kind, 'heart');
  assert.equal(restored.performAction(), true);
  for (let i = 0; i < 70; i++) restored.update(0.05);
  assert.equal(restored.worldNumber, 2);
  assert.equal(restored.stars, 9);
  assert.equal(restored.world.oldCairns.length, 1);

  // Ancient cairns persist across multiple rebirths
  restored.newWorld(9999, true);
  assert.equal(restored.worldNumber, 3);
  assert.equal(restored.world.oldCairns.length, 1);
});

test('holding Act while running continuously places stepping stones without stopping', () => {
  const g = new Game();
  g.items[ITEM.STONES] = true;
  const b1 = g.world.beacons[1];
  // Start on the outer sand ring just south of Beacon 1's shallow moat (radius 3.6..5.2)
  g.player.x = b1.x + 0.5;
  g.player.y = b1.y + 6.5;
  const startY = g.player.y;
  for (let i = 0; i < 30; i++) {
    g.update(0.05, { mx: 0, my: -1, run: true, actHeld: true });
  }
  assert.equal(g.world.mtAt(b1.x, b1.y + 5), MT.STEPSTONE);
  assert.equal(g.world.mtAt(b1.x, b1.y + 4), MT.STEPSTONE);
  assert.ok(g.player.y < startY - 3, 'player should keep running forward while placing stones');
});

// Fixed seed (overridable to sweep seeds locally) so these tests never depend on random terrain.
const TEST_SEED = Number(process.env.OW_TEST_SEED) || 1;

function clearGround(g, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) g.world.setMod(x, y, MT.GRASS);
  }
}

test('with the Cloak selected, Act jumps anywhere: open ground, over trees, or on the spot', () => {
  const g = new Game({ seed: TEST_SEED });
  g.items[ITEM.CLOAK] = true;
  g.selectedItem = ITEM.CLOAK;
  const bx = g.world.start.x + 20;
  const by = g.world.start.y + 20;
  clearGround(g, bx - 6, by - 6, bx + 6, by + 6);
  const land = () => { for (let i = 0; i < 20; i++) g.update(0.05); };

  // Open ground, nothing to cross: still jumps 3 tiles.
  g.player.x = bx + 0.5; g.player.y = by + 0.5; g.player.fx = 1; g.player.fy = 0;
  const act = g.getContextAction();
  assert.equal(act.kind, 'glide');
  assert.equal(act.label, 'Jump');
  assert.equal(g.performAction(), true);
  land();
  assert.equal(Math.floor(g.player.x), bx + 3);

  // Over trees (which the contextual glide refuses).
  g.world.setMod(bx + 1, by, MT.TREE);
  g.world.setMod(bx + 2, by, MT.TREE);
  g.player.x = bx + 0.5;
  g.selectedItem = ITEM.LANTERN;
  assert.equal(g.getContextAction(), null);
  g.selectedItem = ITEM.CLOAK;
  assert.equal(g.performAction(), true);
  land();
  assert.equal(Math.floor(g.player.x), bx + 3);

  // Boxed in by trees: hops on the spot rather than doing nothing.
  for (let d = 1; d <= 4; d++) g.world.setMod(bx + d, by, MT.TREE);
  g.player.x = bx + 0.5;
  assert.equal(g.performAction(), true);
  assert.ok(g.glide !== null);
  land();
  assert.equal(g.glide, null);
  assert.equal(g.player.x, bx + 0.5);
  assert.equal(g.isSolid(Math.floor(g.player.x), Math.floor(g.player.y)), false);
});

test('building a cairn on land never traps the player', () => {
  const g = new Game({ seed: TEST_SEED });
  g.items[ITEM.STONES] = true;
  g.selectedItem = ITEM.STONES;
  const bx = g.world.start.x + 20;
  const by = g.world.start.y + 20;
  clearGround(g, bx - 3, by - 3, bx + 3, by + 3);

  // Standing at the tile edge so the collision box pokes into the tile ahead.
  for (const [fx, fy, px, py] of [[1, 0, 0.9, 0.5], [0.7, 0.7, 0.9, 0.9], [0, -1, 0.5, 0.05]]) {
    g.player.x = bx + px; g.player.y = by + py; g.player.fx = fx; g.player.fy = fy;
    assert.equal(g.getContextAction().kind, 'build-cairn');
    assert.equal(g.performAction(), true);
    const cx = bx + Math.round(fx);
    const cy = by + Math.round(fy);
    assert.equal(g.world.mtAt(cx, cy), MT.CAIRN);
    const x0 = g.player.x;
    const y0 = g.player.y;
    g.update(0.05, { mx: -Math.round(fx), my: -Math.round(fy), run: true, actHeld: false });
    assert.ok(g.player.x !== x0 || g.player.y !== y0, 'player can walk away from the new cairn');
    g.player.x = x0; g.player.y = y0;
    g.update(0.05, { mx: Math.round(fx), my: Math.round(fy), run: true, actHeld: false });
    assert.notEqual(`${Math.floor(g.player.x)},${Math.floor(g.player.y)}`, `${cx},${cy}`);
    g.world.removeCairn(cx, cy);
    g.world.setMod(cx, cy, MT.GRASS); // removeCairn drops the override; keep the ground cleared
  }

  // A player already wedged inside a solid tile (e.g. an old save) can walk back out.
  g.world.placeCairn(bx + 1, by);
  g.player.x = bx + 0.9; g.player.y = by + 0.5;
  g.update(0.05, { mx: 1, my: 0, run: true, actHeld: false });
  assert.equal(g.player.x, bx + 0.9, 'cannot push deeper into the solid tile');
  g.update(0.05, { mx: -1, my: 0, run: true, actHeld: false });
  assert.ok(g.player.x < bx + 0.9);
});

test('a contextual glide keeps the selected item and does not chain into free jumps', () => {
  const g = new Game({ seed: TEST_SEED });
  g.items[ITEM.CLOAK] = true;
  g.selectedItem = ITEM.LANTERN;
  const bx = g.world.start.x + 20;
  const by = g.world.start.y + 20;
  clearGround(g, bx - 2, by - 2, bx + 12, by + 2);
  g.world.setMod(bx + 1, by, MT.ROCK);
  g.player.x = bx + 0.5; g.player.y = by + 0.5; g.player.fx = 1; g.player.fy = 0;
  for (let i = 0; i < 30; i++) g.update(0.05, { mx: 0, my: 0, run: false, actHeld: true });
  assert.equal(g.selectedItem, ITEM.LANTERN);
  assert.equal(Math.floor(g.player.x), bx + 3, 'one glide over the rock, then no more');
});

test('the world keeps simulating while jumps are chained', () => {
  const g = new Game({ seed: TEST_SEED });
  g.items[ITEM.CLOAK] = true;
  g.selectedItem = ITEM.CLOAK;
  const t0 = g.dayTime;
  for (let i = 0; i < 40; i++) g.update(0.05, { mx: 0, my: 0, run: false, actHeld: true });
  assert.ok(Math.abs(g.dayTime - (t0 + 2 / 480)) < 1e-6, 'day clock advances every frame');
});
