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
