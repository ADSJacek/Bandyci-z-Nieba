import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Effects } from '../effects.js';

test('liczba odłamków zależy od natężenia animacji; napisy i błysk lufy zostają', () => {
  const fx = new Effects();
  fx.burst(10, 10, '#fff', 12);
  assert.equal(fx.particles.length, 12);
  fx.clear();
  fx.level = 0.5;
  fx.burst(10, 10, '#fff', 12);
  assert.equal(fx.particles.length, 6);
  fx.clear();
  fx.level = 0;
  fx.burst(10, 10, '#fff', 30);
  fx.popup('+10', 0, 0);
  fx.muzzle(0, 0);
  assert.deepEqual([fx.particles.length, fx.popups.length, fx.muzzles.length], [0, 1, 1]);
});
