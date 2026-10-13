// Bonusy wypadające z wrogów oraz super bonus „Złota podkowa”.
import { POWERUPS, PLAYER, HEIGHT } from '../config.js';
import { drawStar, drawHat } from '../sprites.js';
import { revive } from '../serial.js';

export const POWERUP_INFO = {
  double: { label: 'Podwójny rewolwer', color: '#e67e22' },
  fast:   { label: 'Szybki spust',      color: '#2e86c1' },
  star:   { label: 'Gwiazda szeryfa',   color: '#6b4423' },
  life:   { label: 'Dodatkowe życie',   color: '#c0392b' },
  super:  { label: 'Złota podkowa',     color: '#ffd700' },
};

// Losowanie z wagami; r ∈ [0, 1)
export function weightedPick(weights, r) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w;
    if (r * total < acc) return key;
  }
  return entries[entries.length - 1][0];
}

// Czy z pokonanego bandyty wypada bonus, a jeśli tak — jaki
export function rollPowerup(chance, rng = Math.random) {
  if (rng() >= chance) return null;
  return weightedPick(POWERUPS.weights, rng());
}

// „Dodatkowe życie”: +1, maks. 5 (życie zdobyte „Złotą podkową” ponad limit zostaje)
export function applyExtraLife(lives) {
  return lives < PLAYER.maxLives ? lives + 1 : lives;
}

// „Złota podkowa”: +1 życie do 6; przy 6 życiach — punkty zamiast życia
export function applySuperBonus(lives) {
  if (lives < PLAYER.superMaxLives) return { lives: lives + 1, overflow: false };
  return { lives, overflow: true };
}

export class PowerUp {
  constructor(type, cx, cy) {
    this.type = type;
    this.w = POWERUPS.size;
    this.h = POWERUPS.size;
    this.x = cx - this.w / 2;
    this.y = cy - this.h / 2;
    this.speed = type === 'super' ? POWERUPS.superFallSpeed : POWERUPS.fallSpeed;
    this.t = 0;
    this.dead = false;
  }

  static fromJSON(data) {
    if (!(data?.type in POWERUP_INFO)) throw new Error('PowerUp: nieznany typ');
    return revive(PowerUp, data, ['x', 'y', 'w', 'h', 'speed', 't']);
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  update(dt) {
    this.t += dt;
    this.y += this.speed * dt;
  }

  isOffscreen() {
    return this.y > HEIGHT;
  }

  draw(ctx) {
    drawPowerupIcon(ctx, this.type, this.x + this.w / 2, this.y + this.h / 2, this.w, this.t);
  }
}

// Ikona bonusu — używana także w HUD
export function drawPowerupIcon(ctx, type, cx, cy, size, t = 0) {
  const r = size / 2;
  ctx.save();

  if (type === 'super') {
    // Pulsująca złota poświata, żeby łatwo było zauważyć
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 12 + 8 * Math.sin(t * 8);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = size * 0.22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r * 0.72, Math.PI * 0.8, Math.PI * 2.2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7a5a00';
    for (const a of [0.95, 1.3, 1.7, 2.05]) {
      const ang = Math.PI * a;
      ctx.fillRect(cx + Math.cos(ang) * r * 0.72 - 1, cy - r * 0.1 + Math.sin(ang) * r * 0.72 - 1, 2, 2);
    }
    ctx.restore();
    return;
  }

  // Okrągła odznaka
  ctx.fillStyle = POWERUP_INFO[type].color;
  ctx.strokeStyle = '#2b1a0f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (type === 'double') {
    ctx.fillStyle = '#fff3d6';
    ctx.font = `bold ${Math.round(size * 0.55)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('2×', cx, cy + 1);
  } else if (type === 'fast') {
    // Błyskawica
    const s = size / 22;
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(cx + 2 * s, cy - 8 * s);
    ctx.lineTo(cx - 5 * s, cy + 1 * s);
    ctx.lineTo(cx - 0.5 * s, cy + 1 * s);
    ctx.lineTo(cx - 2 * s, cy + 8 * s);
    ctx.lineTo(cx + 5 * s, cy - 1 * s);
    ctx.lineTo(cx + 0.5 * s, cy - 1 * s);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'star') {
    drawStar(ctx, cx, cy, r * 0.75, '#ffd700');
  } else if (type === 'life') {
    const k = size / 22;
    ctx.translate(cx - 10 * k, cy - 6 * k);
    ctx.scale(k, k);
    drawHat(ctx, 0, 0, '#f0e6d0', '#3b2314');
  }
  ctx.restore();
}
