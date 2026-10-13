// Sęp przelatujący przez górną część ekranu — bonus punktowy.
import { VULTURE, WIDTH } from '../config.js';
import { revive } from '../serial.js';

// Losowo 50–300 pkt, co 50
export function vulturePoints(rng = Math.random) {
  const steps = (VULTURE.maxPoints - VULTURE.minPoints) / VULTURE.pointsStep;
  return VULTURE.minPoints + Math.floor(rng() * (steps + 1)) * VULTURE.pointsStep;
}

export function nextVultureDelay(rng = Math.random) {
  return VULTURE.minInterval + rng() * (VULTURE.maxInterval - VULTURE.minInterval);
}

export class Vulture {
  constructor(dir) {
    this.dir = dir; // 1 = w prawo, -1 = w lewo
    this.w = VULTURE.width;
    this.h = VULTURE.height;
    this.x = dir > 0 ? -this.w : WIDTH;
    this.y = VULTURE.y;
    this.t = 0;
  }

  static fromJSON(data) {
    return revive(Vulture, data, ['dir', 'w', 'h', 'x', 'y', 't']);
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get gone() {
    return this.dir > 0 ? this.x > WIDTH : this.x + this.w < 0;
  }

  update(dt) {
    this.t += dt;
    this.x += this.dir * VULTURE.speed * dt;
    this.y = VULTURE.y + Math.sin(this.t * 3) * 4;
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const flap = Math.sin(this.t * 10) * 9;
    const d = this.dir;

    ctx.save();
    // Skrzydła
    ctx.fillStyle = '#1f1612';
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx - 22, cy - flap);
    ctx.lineTo(cx - 12, cy + 3);
    ctx.moveTo(cx + 6, cy);
    ctx.lineTo(cx + 22, cy - flap);
    ctx.lineTo(cx + 12, cy + 3);
    ctx.fill();
    // Tułów
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, 11, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Biała kryza i łysa, różowa głowa
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(cx + d * 8 - 3, cy - 3, 6, 4);
    ctx.fillStyle = '#d98c8c';
    ctx.beginPath();
    ctx.arc(cx + d * 13, cy - 3, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e3b43b';
    ctx.beginPath();
    ctx.moveTo(cx + d * 16, cy - 4);
    ctx.lineTo(cx + d * 21, cy - 1);
    ctx.lineTo(cx + d * 16, cy);
    ctx.fill();
    ctx.restore();
  }
}
