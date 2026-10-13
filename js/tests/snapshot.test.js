import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeGame, restoreGame, isCompatibleSnapshot, SNAPSHOT_VERSION } from '../snapshot.js';
import { getDifficulty, DIFFICULTY_ORDER } from '../config.js';
import { Player } from '../entities/player.js';
import { Formation, enemyRect } from '../entities/enemies.js';
import { Boss } from '../entities/boss.js';
import { Vulture } from '../entities/vulture.js';
import { Bullet, Dynamite } from '../entities/bullets.js';
import { createShields, Shield } from '../entities/shields.js';
import { PowerUp } from '../entities/powerups.js';

// Atrapa gry w „brudnym” stanie: część bandytów i bloków zniszczona, bonusy aktywne
function sampleGame({ withBoss = false } = {}) {
  const difficulty = getDifficulty('trudny');
  const player = new Player(difficulty.lives);
  player.x = 123.5;
  player.applyPowerup('double');
  player.applyPowerup('star');
  player.invuln = 0.7;

  let formation = null;
  let boss = null;
  if (withBoss) {
    boss = new Boss(2, difficulty);
    boss.y = 60;
    boss.hit();
    boss.hit();
  } else {
    formation = new Formation(3, difficulty);
    formation.hitTest(enemyRect(formation, formation.enemies[0]));
    formation.hitTest(enemyRect(formation, formation.enemies[17]));
    formation.x += 31;
    formation.dir = -1;
    formation.shootTimer = 0.42;
  }
  const shields = createShields();
  shields[1].destroyRadius(shields[1].rect.x + 20, shields[1].rect.y + 10, 15);
  const vulture = new Vulture(-1);
  vulture.update(0.5);

  return {
    difficultyKey: 'trudny',
    score: 4321,
    wave: withBoss ? 10 : 3,
    bossCount: withBoss ? 2 : 0,
    time: 87.25,
    bannerTimer: 0,
    vultureTimer: 6.5,
    player,
    formation,
    boss,
    vulture: withBoss ? null : vulture,
    shields,
    playerBullets: [new Bullet(100, 300, 0, -620, 3, 12, 'player')],
    enemyBullets: [new Bullet(200, 250, 30, 240, 4, 10, 'enemy')],
    dynamites: withBoss ? [new Dynamite(300, 200, -40, 170)] : [],
    powerups: [new PowerUp('fast', 400, 300)],
  };
}

// Pusta „gra”, do której odtwarzamy zapis
function blankGame() {
  const game = { effectsCleared: 0 };
  game.effects = { clear: () => { game.effectsCleared++; } };
  return game;
}

// W prawdziwej grze difficultyKey to getter liczony z difficultyIndex
const withKey = (g) => ({ ...g, difficultyKey: DIFFICULTY_ORDER[g.difficultyIndex] });

for (const withBoss of [false, true]) {
  test(`zapis → JSON → odtworzenie daje ten sam stan (${withBoss ? 'boss' : 'formacja'})`, () => {
    const snap = serializeGame(sampleGame({ withBoss }), { nick: 'Joe', savedAt: 1000 });
    const game = blankGame();
    assert.equal(restoreGame(game, JSON.parse(JSON.stringify(snap))), true);
    assert.deepEqual(serializeGame(withKey(game), { nick: 'Joe', savedAt: 1000 }), snap);
    assert.equal(game.effectsCleared, 1);
    assert.deepEqual(game.explosions, []);
    assert.equal(game.shakeTime, 0);
  });
}

test('odtworzone encje mają metody swoich klas', () => {
  const game = blankGame();
  assert.equal(restoreGame(game, serializeGame(sampleGame(), { nick: 'Joe' })), true);
  assert.ok(game.player instanceof Player);
  assert.ok(game.formation instanceof Formation);
  assert.ok(game.vulture instanceof Vulture);
  assert.ok(game.shields.every((s) => s instanceof Shield));
  assert.ok(game.playerBullets[0] instanceof Bullet);
  assert.ok(game.powerups[0] instanceof PowerUp);
  assert.equal(game.formation.alive, 48);
  assert.equal(game.player.maxBullets, 2); // aktywny „Podwójny rewolwer”
  assert.equal(game.player.star, true);
  assert.equal(game.difficultyIndex, DIFFICULTY_ORDER.indexOf('trudny'));
  // osłona z dziurą po wybuchu zostaje z dziurą, pozostałe całe
  const holes = (s) => s.blocks.filter((b) => !b.alive).length;
  assert.ok(holes(game.shields[1]) > 0);
  assert.equal(holes(game.shields[0]), 0);
});

test('zgodność wersji i poziomu', () => {
  const snap = serializeGame(sampleGame(), { nick: 'Joe' });
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(isCompatibleSnapshot(snap), true);
  assert.equal(isCompatibleSnapshot({ ...snap, version: SNAPSHOT_VERSION + 1 }), false);
  assert.equal(isCompatibleSnapshot({ ...snap, difficulty: 'koszmar' }), false);
  assert.equal(isCompatibleSnapshot(null), false);
});

test('uszkodzony zapis → false, gra nietknięta', () => {
  const good = serializeGame(sampleGame(), { nick: 'Joe' });
  const broken = [
    { ...good, version: 999 },
    { ...good, score: null },
    { ...good, player: null },
    { ...good, player: { ...good.player, bonuses: null } },
    { ...good, formation: { ...good.formation, enemies: 'x' } },
    { ...good, formation: { ...good.formation, enemies: [{ row: 0, col: 0, type: 'kowboj', alive: true }] } },
    { ...good, shields: [{ ...good.shields[0], alive: '101' }] },
    { ...good, powerups: [{ ...good.powerups[0], type: 'hack' }] },
    { ...good, enemyBullets: {} },
  ];
  for (const data of broken) {
    const game = blankGame();
    game.score = 5;
    assert.equal(restoreGame(game, data), false);
    assert.equal(game.score, 5);
    assert.equal(game.player, undefined);
    assert.equal(game.effectsCleared, 0);
  }
});
