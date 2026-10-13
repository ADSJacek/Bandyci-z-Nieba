// Pełny zapis stanu rozgrywki (wznawianie przerwanej gry) i jego odtwarzanie.
// Zapisujemy tylko stan logiczny; efekty, cząsteczki, wybuchy, wstrząsy i błyski
// są kosmetyczne i po wznowieniu startują od zera.
import { DIFFICULTY_ORDER } from './config.js';
import { Player } from './entities/player.js';
import { Formation } from './entities/enemies.js';
import { Boss } from './entities/boss.js';
import { Vulture } from './entities/vulture.js';
import { Bullet, Dynamite } from './entities/bullets.js';
import { Shield } from './entities/shields.js';
import { PowerUp } from './entities/powerups.js';

// Zmieniamy przy każdej niezgodnej zmianie formatu — starsze zapisy są wtedy odrzucane
export const SNAPSHOT_VERSION = 1;

const GAME_NUMBERS = ['score', 'wave', 'bossCount', 'time', 'bannerTimer', 'vultureTimer'];

export function serializeGame(game, { nick, savedAt = Date.now() } = {}) {
  const data = {
    version: SNAPSHOT_VERSION,
    savedAt,
    nick,
    difficulty: game.difficultyKey,
    score: game.score,
    wave: game.wave,
    bossCount: game.bossCount,
    time: game.time,
    bannerTimer: game.bannerTimer,
    vultureTimer: game.vultureTimer,
    player: game.player,
    formation: game.formation,
    boss: game.boss,
    vulture: game.vulture,
    shields: game.shields,
    playerBullets: game.playerBullets,
    enemyBullets: game.enemyBullets,
    dynamites: game.dynamites,
    powerups: game.powerups,
  };
  // JSON.stringify wywołuje toJSON encji (osłony) i pomija gettery oraz metody
  return JSON.parse(JSON.stringify(data));
}

export function isCompatibleSnapshot(data) {
  return Boolean(data) && typeof data === 'object'
    && data.version === SNAPSHOT_VERSION && DIFFICULTY_ORDER.includes(data.difficulty);
}

function list(items, Class) {
  if (!Array.isArray(items)) throw new Error(`${Class.name}: oczekiwano listy`);
  return items.map((item) => Class.fromJSON(item));
}

// Odtwarza stan w `game`. Wszystko budujemy najpierw na boku — przy błędzie
// zwracamy false, a gra zostaje nietknięta (bez połowicznie wczytanego stanu).
export function restoreGame(game, data) {
  if (!isCompatibleSnapshot(data)) return false;
  let next;
  try {
    for (const key of GAME_NUMBERS) {
      if (!Number.isFinite(data[key])) throw new Error(`niepoprawne pole ${key}`);
    }
    next = {
      difficultyIndex: DIFFICULTY_ORDER.indexOf(data.difficulty),
      score: data.score,
      wave: data.wave,
      bossCount: data.bossCount,
      time: data.time,
      bannerTimer: data.bannerTimer,
      vultureTimer: data.vultureTimer,
      player: Player.fromJSON(data.player),
      formation: data.formation ? Formation.fromJSON(data.formation) : null,
      boss: data.boss ? Boss.fromJSON(data.boss) : null,
      vulture: data.vulture ? Vulture.fromJSON(data.vulture) : null,
      shields: list(data.shields, Shield),
      playerBullets: list(data.playerBullets, Bullet),
      enemyBullets: list(data.enemyBullets, Bullet),
      dynamites: list(data.dynamites, Dynamite),
      powerups: list(data.powerups, PowerUp),
      explosions: [],
      newRecord: false,
      shakeTime: 0,
      flashTime: 0,
    };
  } catch {
    return false;
  }
  Object.assign(game, next);
  game.effects?.clear();
  return true;
}
