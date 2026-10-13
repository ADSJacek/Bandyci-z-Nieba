// Boss „El Diablo” — jeździec na koniu, wachlarz pocisków i dynamit.
import { BOSS, WIDTH, PLAYER } from '../config.js';
import { revive } from '../serial.js';

export function bossMaxHp(bossNumber) {
  return BOSS.baseHp + (bossNumber - 1) * BOSS.hpPerBoss;
}

export class Boss {
  constructor(bossNumber, difficulty) {
    this.number = bossNumber;
    this.maxHp = bossMaxHp(bossNumber);
    this.hp = this.maxHp;
    this.w = BOSS.width;
    this.h = BOSS.height;
    this.x = (WIDTH - this.w) / 2;
    this.y = -this.h;               // wjeżdża z góry
    this.dir = 1;
    this.speed = BOSS.speed * difficulty.enemySpeed * (1 + BOSS.speedPerBoss * (bossNumber - 1));
    this.fire = difficulty.enemyFire;
    this.fanTimer = BOSS.fanInterval;
    this.dynamiteTimer = BOSS.dynamiteInterval;
    this.flash = 0;
    this.t = 0;
  }

  static fromJSON(data) {
    return revive(Boss, data, [
      'number', 'maxHp', 'hp', 'w', 'h', 'x', 'y', 'dir', 'speed', 'fire', 'fanTimer', 'dynamiteTimer', 'flash', 't',
    ]);
  }

  get entering() {
    return this.y < BOSS.y;
  }

  get rect() {
    return { x: this.x + 8, y: this.y + 4, w: this.w - 16, h: this.h - 8 };
  }

  // attacks: { fire(x, y, vx, vy), dynamite(x, y, vx, vy) }
  update(dt, playerCenterX, attacks) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);

    if (this.entering) {
      this.y = Math.min(BOSS.y, this.y + BOSS.enterSpeed * dt);
      return;
    }

    // Jazda w poziomie z odbiciem od krawędzi
    this.x += this.dir * this.speed * dt;
    if (this.x < 8) { this.x = 8; this.dir = 1; }
    if (this.x + this.w > WIDTH - 8) { this.x = WIDTH - 8 - this.w; this.dir = -1; }

    const cx = this.x + this.w / 2;
    const bottom = this.y + this.h - 10;

    this.fanTimer -= dt * this.fire;
    if (this.fanTimer <= 0) {
      this.fanTimer = BOSS.fanInterval;
      for (const a of [-BOSS.fanAngle, 0, BOSS.fanAngle]) {
        attacks.fire(cx, bottom, Math.sin(a) * BOSS.fanBulletSpeed, Math.cos(a) * BOSS.fanBulletSpeed);
      }
    }

    this.dynamiteTimer -= dt * this.fire;
    if (this.dynamiteTimer <= 0) {
      this.dynamiteTimer = BOSS.dynamiteInterval * (0.8 + Math.random() * 0.4);
      // Rzut w stronę szeryfa
      const fallTime = (PLAYER.y - bottom) / BOSS.dynamiteSpeed;
      const vx = Math.max(-BOSS.dynamiteMaxVx, Math.min(BOSS.dynamiteMaxVx, (playerCenterX - cx) / fallTime));
      attacks.dynamite(cx, bottom, vx, BOSS.dynamiteSpeed);
    }
  }

  // Zwraca true, gdy boss został pokonany
  hit() {
    this.hp--;
    this.flash = 0.08;
    return this.hp <= 0;
  }

  draw(ctx) {
    const c = (color) => (this.flash > 0 ? '#ffffff' : color);
    const x = this.x;
    const y = this.y;
    const cx = x + this.w / 2;
    const d = this.dir;
    const gallop = Math.sin(this.t * 14);

    ctx.save();
    // Nogi konia (galop)
    ctx.strokeStyle = c('#3b1f0e');
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const legs = [[-24, 1], [-12, -1], [14, 1], [26, -1]];
    ctx.beginPath();
    for (const [lx, phase] of legs) {
      ctx.moveTo(cx + lx, y + 52);
      ctx.lineTo(cx + lx + gallop * phase * 6, y + 70);
    }
    ctx.stroke();

    // Ogon
    ctx.strokeStyle = c('#1a0f08');
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - d * 34, y + 42);
    ctx.quadraticCurveTo(cx - d * 48, y + 44 + gallop * 3, cx - d * 44, y + 60);
    ctx.stroke();

    // Tułów konia
    ctx.fillStyle = c('#5a3218');
    ctx.beginPath();
    ctx.ellipse(cx, y + 46, 36, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Szyja i łeb
    ctx.beginPath();
    ctx.moveTo(cx + d * 22, y + 40);
    ctx.lineTo(cx + d * 36, y + 22);
    ctx.lineTo(cx + d * 48, y + 28);
    ctx.lineTo(cx + d * 46, y + 34);
    ctx.lineTo(cx + d * 36, y + 34);
    ctx.lineTo(cx + d * 32, y + 48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c('#1a0f08');
    ctx.fillRect(cx + d * 38 - 1, y + 25, 3, 3); // oko
    ctx.fillRect(cx + d * 30 - 3, y + 20, 6, 10); // grzywa

    // Jeździec
    ctx.fillStyle = c('#1b1b1b');
    ctx.fillRect(cx - 10, y + 22, 20, 18);          // czarny płaszcz
    ctx.fillStyle = c('#9b1c1c');
    ctx.fillRect(cx - 10, y + 32, 20, 4);           // czerwony pas
    ctx.fillStyle = c('#c0392b');
    ctx.beginPath();
    ctx.arc(cx, y + 16, 7, 0, Math.PI * 2);         // czerwona twarz diabła
    ctx.fill();
    ctx.fillStyle = c('#ffd700');
    ctx.fillRect(cx - 4 + d, y + 14, 2, 2);         // oczy
    ctx.fillRect(cx + 2 + d, y + 14, 2, 2);

    // Sombrero z rogami
    ctx.fillStyle = c('#111111');
    ctx.beginPath();
    ctx.ellipse(cx, y + 9, 24, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 8, y + 1, 16, 8);
    ctx.fillStyle = c('#e8d3a2');
    ctx.beginPath();
    ctx.moveTo(cx - 8, y + 3); ctx.lineTo(cx - 14, y - 6); ctx.lineTo(cx - 4, y + 1);
    ctx.moveTo(cx + 8, y + 3); ctx.lineTo(cx + 14, y - 6); ctx.lineTo(cx + 4, y + 1);
    ctx.fill();

    // Rewolwer w dłoni
    ctx.fillStyle = c('#b8bec4');
    ctx.fillRect(cx + d * 10 - (d < 0 ? 10 : 0), y + 28, 10, 3);
    ctx.restore();
  }
}
