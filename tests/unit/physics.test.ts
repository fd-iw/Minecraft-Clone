import { describe, expect, it } from 'vitest';
import { STONE, TALL_GRASS, makeBlock } from '../../src/engine/blocks';
import { Face } from '../../src/engine/facing';
import { Body, NO_INPUT, travel } from '../../src/engine/physics/movement';
import { raycast } from '../../src/engine/physics/raycast';
import { emptyWorld, fillRaw } from './helpers';

function flatWorld() {
  const w = emptyWorld(2);
  fillRaw(w, -32, 0, -32, 47, 9, 47, makeBlock(STONE));
  return w;
}

describe('movement', () => {
  it('falls and lands on the ground', () => {
    const w = flatWorld();
    const b = new Body();
    b.setPosition(0.5, 15, 0.5);
    for (let i = 0; i < 60; i++) travel(w, b, NO_INPUT);
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(10, 6);
  });

  it('walks at ~4.317 m/s and sprints at ~5.612 m/s', () => {
    const w = flatWorld();
    for (const [sprint, expected] of [
      [false, 4.317],
      [true, 5.612],
    ] as const) {
      const b = new Body();
      b.setPosition(0.5, 10, 0.5);
      b.yaw = Math.PI / 2; // facing -X
      const input = { forward: 1, strafe: 0, jump: false, sneak: false, sprint };
      for (let i = 0; i < 40; i++) travel(w, b, input);
      const x0 = b.x;
      for (let i = 0; i < 20; i++) travel(w, b, input);
      expect(Math.abs(b.x - x0)).toBeCloseTo(expected, 1);
      expect(b.x).toBeLessThan(x0);
    }
  });

  it('jumps about 1.25 blocks high', () => {
    const w = flatWorld();
    const b = new Body();
    b.setPosition(0.5, 10, 0.5);
    for (let i = 0; i < 3; i++) travel(w, b, NO_INPUT);
    expect(b.onGround).toBe(true);
    let maxY = 0;
    travel(w, b, { ...NO_INPUT, jump: true });
    for (let i = 0; i < 30; i++) {
      travel(w, b, NO_INPUT);
      maxY = Math.max(maxY, b.y);
    }
    expect(maxY - 10).toBeCloseTo(1.2522, 2);
  });

  it('cannot walk up a full block but can with a jump', () => {
    const w = flatWorld();
    fillRaw(w, -10, 10, -5, -3, 10, 5, makeBlock(STONE));
    const b = new Body();
    b.setPosition(0.5, 10, 0.5);
    b.yaw = Math.PI / 2;
    const walk = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false };
    for (let i = 0; i < 40; i++) travel(w, b, walk);
    expect(b.y).toBeCloseTo(10, 6);
    expect(b.x).toBeCloseTo(-2 + 0.3, 3);
    for (let i = 0; i < 10; i++) travel(w, b, { ...walk, jump: true });
    for (let i = 0; i < 20; i++) travel(w, b, walk);
    expect(b.y).toBeCloseTo(11, 6);
    expect(b.x).toBeLessThan(-3);
  });

  it('sneaking stops at edges', () => {
    const w = emptyWorld(1);
    fillRaw(w, 0, 0, 0, 3, 9, 3, makeBlock(STONE));
    const b = new Body();
    b.setPosition(2, 10, 2);
    b.yaw = -Math.PI / 2; // facing +X
    for (let i = 0; i < 5; i++) travel(w, b, NO_INPUT);
    const sneak = { forward: 1, strafe: 0, jump: false, sneak: true, sprint: false };
    for (let i = 0; i < 100; i++) travel(w, b, sneak);
    expect(b.y).toBeCloseTo(10, 6);
    expect(b.x).toBeLessThanOrEqual(4 + 0.3);
  });
});

describe('raycast', () => {
  it('hits the first solid block and reports the face', () => {
    const w = emptyWorld(1);
    w.setBlock(5, 10, 0, makeBlock(STONE));
    const hit = raycast(w, 0.5, 10.5, 0.5, 1, 0, 0, 10);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([5, 10, 0]);
    expect(hit!.face).toBe(Face.West);
    expect(hit!.distance).toBeCloseTo(4.5, 6);
  });

  it('works in negative directions and respects reach', () => {
    const w = emptyWorld(1);
    w.setBlock(-3, 4, -3, makeBlock(STONE));
    const d = 1 / Math.sqrt(3);
    const hit = raycast(w, 0.5, 7.5, 0.5, -d, -d, -d, 10);
    expect(hit && [hit.x, hit.y, hit.z]).toEqual([-3, 4, -3]);
    expect(raycast(w, 0.5, 7.5, 0.5, -d, -d, -d, 3)).toBeNull();
  });

  it('uses partial selection boxes for plants', () => {
    const w = emptyWorld(1);
    w.setBlock(2, 5, 0, makeBlock(TALL_GRASS));
    // A ray passing just above the plant's box (13/16 high) misses.
    expect(raycast(w, 0.5, 5.95, 0.5, 1, 0, 0, 10)).toBeNull();
    expect(raycast(w, 0.5, 5.5, 0.5, 1, 0, 0, 10)?.x).toBe(2);
  });
});
