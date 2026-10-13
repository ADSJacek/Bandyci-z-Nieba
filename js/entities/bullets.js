// Pociski gracza i wrogów, dynamit bossa oraz (wizualny) wybuch.
import { WIDTH, HEIGHT } from '../config.js';
import { revive } from '../serial.js';

export class Bullet {
  constructor(x, y, vx, vy, w, h, owner) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.w = w;
    this.h = h;
    this.owner = owner; // 'player' | 'enemy'
    this.dead = false;
  }

  static fromJSON(data) {
    return revive(Bullet, data, ['x', 'y', 'vx', 'vy', 'w', 'h']);
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  isOffscreen() {
    return this.y + this.h < 0 || this.y > HEIGHT || this.x + this.w < 0 || this.x > WIDTH;
  }

  draw(ctx) {
    if (this.owner === 'player') {
      ctx.fillStyle = 'rgba(255, 176, 0, 0.45)';
      ctx.fillRect(this.x - 1, this.y + 4, this.w + 2, this.h);  // smuga
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    } else {
      ctx.fillStyle = '#ff5a1f';
      ctx.fillRect(this.x, this.y, this.w, this.h);
      ctx.fillStyle = '#ffd08a';
      ctx.fillRect(this.x + 1, this.y + this.h - 4, this.w - 2, 3);
    }
  }
}

export class Dynamite {
  constructor(x, y, vx, vy) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.w = 8;
    this.h = 16;
    this.t = 0;
    this.dead = false;
  }

  static fromJSON(data) {
    return revive(Dynamite, data, ['x', 'y', 'vx', 'vy', 'w', 'h', 't']);
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  get center() {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }

  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx) {
    const { x, y } = this.center;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.t * 7);
    ctx.fillStyle = '#b3261e';
    ctx.fillRect(-4, -8, 8, 16);
    ctx.fillStyle = '#e8d3a2';
    ctx.fillRect(-4, -3, 8, 2);
    ctx.fillStyle = '#3b2314';
    ctx.fillRect(-1, -12, 2, 4);  // lont
    // iskra na lońcie
    ctx.fillStyle = Math.floor(this.t * 20) % 2 ? '#fff3b0' : '#ffb000';
    ctx.fillRect(-2, -15, 4, 4);
    ctx.restore();
  }
}

export class Explosion {
  constructor(x, y, radius, duration = 0.5) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.duration = duration;
    this.t = 0;
  }

  get done() {
    return this.t >= this.duration;
  }

  update(dt) {
    this.t += dt;
  }

  draw(ctx) {
    const k = Math.min(1, this.t / this.duration);
    const r = this.radius * (0.4 + 0.6 * k);
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
