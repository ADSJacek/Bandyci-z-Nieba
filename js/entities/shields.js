// Osłony (wozy z beczkami) zbudowane z siatki zniszczalnych bloków.
import { SHIELDS, WIDTH } from '../config.js';
import { aabb, circleRect } from '../collision.js';

// '#' = blok drewna, 'o' = obręcz beczki (inny kolor), '.' = pusto
const SHAPE = [
  '...########...',
  '.##oo####oo##.',
  '##############',
  '##oo######oo##',
  '##############',
  '##############',
  '###........###',
  '##..........##',
];

const COLORS = { '#': '#8b5a2b', o: '#5a3a1a' };

export class Shield {
  constructor(x, y) {
    const s = SHIELDS.blockSize;
    this.blocks = [];
    SHAPE.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch === '.') return;
        this.blocks.push({ x: x + c * s, y: y + r * s, w: s, h: s, color: COLORS[ch], alive: true });
      });
    });
    this.rect = { x, y, w: SHAPE[0].length * s, h: SHAPE.length * s };
  }

  // Zapis zwięzły: pozycja + stan bloków jako ciąg „0/1” (kształt jest stały)
  toJSON() {
    return { x: this.rect.x, y: this.rect.y, alive: this.blocks.map((b) => (b.alive ? '1' : '0')).join('') };
  }

  static fromJSON(data) {
    if (!Number.isFinite(data?.x) || !Number.isFinite(data?.y)) throw new Error('Shield: niepoprawna pozycja');
    const shield = new Shield(data.x, data.y);
    if (typeof data.alive !== 'string' || data.alive.length !== shield.blocks.length) throw new Error('Shield: niepoprawne bloki');
    shield.blocks.forEach((b, i) => { b.alive = data.alive[i] === '1'; });
    return shield;
  }

  // Niszczy jeden blok trafiony przez `rect`. Pocisk lecący w górę (fromBelow)
  // trafia najpierw najniższy blok, lecący w dół — najwyższy.
  hitRect(rect, fromBelow) {
    if (!aabb(rect, this.rect)) return false;
    let target = null;
    for (const b of this.blocks) {
      if (!b.alive || !aabb(rect, b)) continue;
      if (!target || (fromBelow ? b.y > target.y : b.y < target.y)) target = b;
    }
    if (!target) return false;
    target.alive = false;
    return true;
  }

  // Niszczy wszystkie bloki pod `rect` (bandyci przechodzący przez osłonę)
  eraseRect(rect) {
    if (!aabb(rect, this.rect)) return;
    for (const b of this.blocks) {
      if (b.alive && aabb(rect, b)) b.alive = false;
    }
  }

  // Dynamit niszczy kilka bloków naraz
  destroyRadius(cx, cy, r) {
    let count = 0;
    for (const b of this.blocks) {
      if (b.alive && circleRect(cx, cy, r, b)) {
        b.alive = false;
        count++;
      }
    }
    return count;
  }

  draw(ctx) {
    for (const b of this.blocks) {
      if (!b.alive) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);  // słoje drewna
    }
  }
}

export function createShields() {
  const w = SHAPE[0].length * SHIELDS.blockSize;
  const gap = (WIDTH - SHIELDS.count * w) / (SHIELDS.count + 1);
  return Array.from({ length: SHIELDS.count }, (_, i) => new Shield(Math.round(gap + i * (w + gap)), SHIELDS.y));
}
