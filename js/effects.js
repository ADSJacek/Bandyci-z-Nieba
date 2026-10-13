// Efekty wizualne: odłamki po trafieniu, błyski z lufy i unoszące się napisy (punkty, „SUPER BONUS!”).
import { FONT_TITLE } from './config.js';

const MUZZLE_TIME = 0.08; // czas błysku z lufy (s)

export class Effects {
  constructor() {
    this.particles = [];
    this.popups = [];
    this.muzzles = [];
    this.level = 1; // natężenie animacji (suwak w menu) — mnoży liczbę odłamków
  }

  clear() {
    this.particles.length = 0;
    this.popups.length = 0;
    this.muzzles.length = 0;
  }

  // Krótki błysk przy wylocie lufy szeryfa
  muzzle(x, y) {
    this.muzzles.push({ x, y, t: 0 });
  }

  burst(x, y, color, count = 12, speed = 140) {
    const n = Math.round(count * this.level);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.6, t: 0, color });
    }
  }

  popup(text, x, y, { color = '#ffe2a8', size = 18, duration = 1, rise = 40 } = {}) {
    this.popups.push({ text, x, y, color, size, duration, rise, t: 0 });
  }

  update(dt) {
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt; // grawitacja
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < p.duration);
    for (const m of this.muzzles) m.t += dt;
    this.muzzles = this.muzzles.filter((m) => m.t < MUZZLE_TIME);
  }

  draw(ctx) {
    // Odłamki gasną i kurczą się (5 px → 1 px)
    for (const p of this.particles) {
      const k = p.t / p.life;
      const s = 5 - 4 * k;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    for (const m of this.muzzles) {
      const k = 1 - m.t / MUZZLE_TIME;
      const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 14);
      glow.addColorStop(0, `rgba(255, 245, 200, ${0.95 * k})`);
      glow.addColorStop(0.4, `rgba(255, 180, 60, ${0.6 * k})`);
      glow.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(m.x - 14, m.y - 14, 28, 28);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const k = p.t / p.duration;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `${p.size}px ${FONT_TITLE}`;
      const y = p.y - p.rise * k;
      ctx.fillStyle = '#2b1a0f';
      ctx.fillText(p.text, p.x + 2, y + 2);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
}
