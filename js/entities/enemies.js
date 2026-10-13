// Formacja bandytów: ruch w bok, zejście w dół, strzały najniższych w kolumnach.
// Logika ruchu i wyboru strzelca to czyste funkcje — testowane w js/tests/.
import { FORMATION, ROW_TYPES, WIDTH, BOSS_EVERY, ENEMY_TYPES } from '../config.js';
import { revive } from '../serial.js';
import { aabb } from '../collision.js';
import { drawSprite } from '../sprites.js';

// --- Czyste funkcje ---------------------------------------------------------

export function isBossWave(wave) {
  return wave % BOSS_EVERY === 0;
}

// Parametry fali formacji: kolejne fale (bez bossów) zaczynają niżej i są szybsze
export function formationWaveParams(wave) {
  const index = (wave - 1) - Math.floor((wave - 1) / BOSS_EVERY); // ile fal formacji było wcześniej
  const startY = FORMATION.startY + Math.min(index * FORMATION.startYStepPerWave, FORMATION.startYMaxOffset);
  const waveSpeed = Math.min(1 + index * FORMATION.speedPerWave, FORMATION.maxWaveSpeedFactor);
  return { index, startY, waveSpeed };
}

export function createFormation(startY, rows = FORMATION.rows, cols = FORMATION.cols) {
  const enemies = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      enemies.push({ row, col, type: ROW_TYPES[row] ?? ROW_TYPES[ROW_TYPES.length - 1], alive: true });
    }
  }
  const width = (cols - 1) * FORMATION.cellW + FORMATION.enemyW;
  return { x: (WIDTH - width) / 2, y: startY, dir: 1, enemies };
}

export function enemyRect(f, e) {
  return {
    x: f.x + e.col * FORMATION.cellW,
    y: f.y + e.row * FORMATION.cellH,
    w: FORMATION.enemyW,
    h: FORMATION.enemyH,
  };
}

// Skrajne pozycje żywych bandytów (null, gdy nikt nie żyje)
export function aliveBounds(f) {
  let minCol = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const e of f.enemies) {
    if (!e.alive) continue;
    minCol = Math.min(minCol, e.col);
    maxCol = Math.max(maxCol, e.col);
    maxRow = Math.max(maxRow, e.row);
  }
  if (maxRow < 0) return null;
  return {
    left: f.x + minCol * FORMATION.cellW,
    right: f.x + maxCol * FORMATION.cellW + FORMATION.enemyW,
    bottom: f.y + maxRow * FORMATION.cellH + FORMATION.enemyH,
  };
}

// Przesuwa formację o `dx` w bieżącym kierunku. Po dotknięciu krawędzi:
// dosunięcie do granicy, zejście w dół i zmiana kierunku. Zwraca true przy zejściu.
export function stepFormation(f, dx, minX = FORMATION.margin, maxX = WIDTH - FORMATION.margin, stepDown = FORMATION.stepDown) {
  if (!aliveBounds(f)) return false;
  f.x += f.dir * dx;
  const b = aliveBounds(f);
  let overshoot = 0;
  if (b.left < minX) overshoot = minX - b.left;
  else if (b.right > maxX) overshoot = maxX - b.right;
  if (overshoot === 0) return false;
  f.x += overshoot;
  f.y += stepDown;
  f.dir *= -1;
  return true;
}

// Prędkość rośnie, gdy ubywa bandytów
export function formationSpeed(alive, total, waveSpeed = 1, difficultySpeed = 1) {
  if (alive <= 0 || total <= 0) return 0;
  const killed = 1 - alive / total;
  const factor = 1 + (FORMATION.maxSpeedFactor - 1) * killed * killed;
  return FORMATION.baseSpeed * factor * waveSpeed * difficultySpeed;
}

// Najniższy żywy bandyta w każdej kolumnie (posortowane po kolumnie)
export function bottomShooters(enemies) {
  const byCol = new Map();
  for (const e of enemies) {
    if (!e.alive) continue;
    const current = byCol.get(e.col);
    if (!current || e.row > current.row) byCol.set(e.col, e);
  }
  return [...byCol.values()].sort((a, b) => a.col - b.col);
}

export function pickShooter(enemies, rng = Math.random) {
  const shooters = bottomShooters(enemies);
  if (shooters.length === 0) return null;
  return shooters[Math.floor(rng() * shooters.length)];
}

// --- Encja formacji ---------------------------------------------------------

export class Formation {
  constructor(wave, difficulty) {
    const { startY, waveSpeed } = formationWaveParams(wave);
    Object.assign(this, createFormation(startY));
    this.total = this.enemies.length;
    this.alive = this.total;
    this.waveSpeed = waveSpeed;
    this.difficultySpeed = difficulty.enemySpeed;
    const fire = difficulty.enemyFire * (1 + FORMATION.firePerWave * (wave - 1));
    this.shootInterval = Math.max(FORMATION.minShootInterval, FORMATION.shootInterval / fire);
    this.shootTimer = this.shootInterval * 1.5;
    this.animTimer = 0;
    this.frame = 0;
  }

  static fromJSON(data) {
    const enemies = data?.enemies;
    const validEnemy = (e) => Number.isInteger(e?.row) && Number.isInteger(e?.col) && e.type in ENEMY_TYPES && typeof e.alive === 'boolean';
    if (!Array.isArray(enemies) || !enemies.every(validEnemy)) throw new Error('Formation: niepoprawni bandyci');
    const f = revive(Formation, data, [
      'x', 'y', 'dir', 'total', 'waveSpeed', 'difficultySpeed', 'shootInterval', 'shootTimer', 'animTimer', 'frame',
    ]);
    f.alive = f.enemies.filter((e) => e.alive).length; // liczba żywych zawsze zgodna z listą
    return f;
  }

  get speed() {
    return formationSpeed(this.alive, this.total, this.waveSpeed, this.difficultySpeed);
  }

  // `shoot(x, y)` tworzy pocisk wroga
  update(dt, shoot) {
    if (this.alive === 0) return;
    const speed = this.speed;
    stepFormation(this, speed * dt);

    // Animacja przyspiesza razem z formacją
    this.animTimer += dt * Math.sqrt(speed / FORMATION.baseSpeed);
    if (this.animTimer >= FORMATION.animInterval) {
      this.animTimer -= FORMATION.animInterval;
      this.frame = 1 - this.frame;
    }

    this.shootTimer -= dt;
    if (this.shootTimer <= 0) {
      this.shootTimer = this.shootInterval * (0.5 + Math.random());
      const shooter = pickShooter(this.enemies);
      if (shooter) {
        const r = enemyRect(this, shooter);
        shoot(r.x + r.w / 2, r.y + r.h);
      }
    }
  }

  // Trafia pierwszego żywego bandytę pod `rect`; zwraca { enemy, rect } lub null
  hitTest(rect) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const r = enemyRect(this, e);
      if (aabb(rect, r)) {
        e.alive = false;
        this.alive--;
        return { enemy: e, rect: r };
      }
    }
    return null;
  }

  aliveRects() {
    return this.enemies.filter((e) => e.alive).map((e) => enemyRect(this, e));
  }

  draw(ctx) {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const r = enemyRect(this, e);
      drawSprite(ctx, e.type, this.frame, r.x, r.y, FORMATION.scale);
    }
  }
}
