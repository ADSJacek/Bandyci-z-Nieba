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
  for (const r of a.train.riders) r.x = 880; // jeźdźcy też już za ekranem
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

test('pociąg od razu po starcie, kolejne co 10–18 s; tory na dole ekranu', () => {
  const a = new Ambient(1);
  a.update(0.05);
  assert.ok(a.train, 'pociąg w pierwszej klatce');
  assert.ok(a.trainTimer >= 10 && a.trainTimer <= 18);
  assert.equal(VISUALS.trainY, 548); // pod napisem „↑ ↓ — wybór / ENTER — dalej” (y = 490)
  assert.equal(VISUALS.trainScale, 1.5); // pociąg i jeźdźcy większe niż pierwotnie
});

test('napad: 2–4 jeźdźców dogania wagony i strzela z łuków', () => {
  const a = new Ambient(1);
  a.trainTimer = 0.01;
  run(a, 0.1);
  const { riders } = a.train;
  assert.ok(riders.length >= VISUALS.ridersMin && riders.length <= VISUALS.ridersMax, `jeźdźców: ${riders.length}`);
  const gap0 = a.train.x - riders[0].x;
  let arrows = 0;
  for (let t = 0; t < 8; t += 0.05) {
    a.update(0.05);
    arrows = Math.max(arrows, a.train.arrows.length);
  }
  assert.ok(a.train.x - riders[0].x < gap0, 'jeździec zbliżył się do pociągu');
  assert.ok(arrows > 0, 'strzały w locie');
  assert.ok(a.train.kicks.length > 0, 'kurz spod kopyt');
});

test('napad kończy się razem z przejazdem: jeźdźcy odjeżdżają za pociągiem', () => {
  const a = new Ambient(1);
  a.trainTimer = 0.01;
  run(a, 0.1);
  a.train.x = 900;
  for (const r of a.train.riders) r.x = 860;
  run(a, 10);
  assert.equal(a.train, null);
});

test('mniej jeźdźców przy niższym suwaku', () => {
  for (let i = 0; i < 20; i++) {
    const a = new Ambient(0.5);
    a.trainTimer = 0.01;
    run(a, 0.3);
    assert.ok(a.train.riders.length <= Math.round(VISUALS.ridersMax * 0.5));
  }
});
