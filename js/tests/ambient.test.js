import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { VISUALS } from '../config.js';

installFakeDom();
const { Ambient, stepLevel } = await import('../ambient.js');

// Przewija czas tła o `seconds` krokami po 50 ms
function run(ambient, seconds) {
  for (let t = 0; t < seconds; t += 0.05) ambient.update(0.05);
}

test('stepLevel: krok 10%, granice 0–100%, bez błędów zaokrągleń', () => {
  assert.equal(stepLevel(1, 1), 1);
  assert.equal(stepLevel(1, -1), 0.9);
  assert.equal(stepLevel(0.3, -1), 0.2);
  assert.equal(stepLevel(0, -1), 0);
  assert.equal(stepLevel(0.7, 1), 0.8);
});

test('100%: pojawia się pociąg z dymem, klucz ptaków, krążące sępy i pył', () => {
  const a = new Ambient(1);
  a.trainTimer = 0.01;
  a.flockTimer = 0.01;
  run(a, 1);
  assert.ok(a.train, 'pociąg');
  assert.ok(a.train.smoke.length > 0, 'dym z komina');
  assert.ok(a.flock && a.flock.birds.length >= VISUALS.birdFlockMin, 'klucz ptaków');
  assert.equal(a.circlers.length, VISUALS.circlerCount);
  assert.equal(a.visibleDust, VISUALS.dustCount);
  const x0 = a.train.x;
  run(a, 1);
  assert.ok(a.train.x > x0, 'pociąg jedzie w prawo');
});

test('pociąg znika po przejechaniu ekranu i rozwianiu dymu', () => {
  const a = new Ambient(1);
  a.trainTimer = 0.01;
  run(a, 0.1);
  a.train.x = 900;
  run(a, 8);
  assert.equal(a.train, null);
});

test('0%: nieruchome tło — bez ptaków, pyłu, pociągu i krzaka, chmury stoją', () => {
  const a = new Ambient(0);
  a.trainTimer = 0.01;
  a.flockTimer = 0.01;
  a.weedTimer = 0.01;
  const clouds = a.clouds.map((c) => c.x);
  run(a, 30);
  assert.equal(a.train, null);
  assert.equal(a.flock, null);
  assert.equal(a.weed, null);
  assert.equal(a.circlers.length, 0);
  assert.equal(a.visibleDust, 0);
  assert.deepEqual(a.clouds.map((c) => c.x), clouds);
});

test('setLevel(0) usuwa ruchome elementy; 50% — połowa pyłu, mniej sępów', () => {
  const a = new Ambient(1);
  a.trainTimer = 0.01;
  a.flockTimer = 0.01;
  run(a, 0.5);
  a.setLevel(0);
  assert.equal(a.train, null);
  assert.equal(a.flock, null);
  a.setLevel(0.5);
  assert.equal(a.visibleDust, Math.round(VISUALS.dustCount / 2));
  assert.equal(a.circlers.length, Math.round(VISUALS.circlerCount / 2));
});

test('rysowanie we wszystkich stanach nie rzuca wyjątków', async () => {
  const { fakeContext } = await import('./fake-dom.js');
  for (const level of [0, 0.5, 1]) {
    const a = new Ambient(level);
    a.trainTimer = 0.01;
    a.flockTimer = 0.01;
    a.gustTimer = 0.01;
    run(a, 2);
    assert.doesNotThrow(() => a.draw(fakeContext));
  }
});
