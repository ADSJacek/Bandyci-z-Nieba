// Szeryf: ruch, strzał z cooldownem, życia, nietykalność i bonusy.
import { PLAYER, POWERUPS, WIDTH } from '../config.js';
import { Bullet } from './bullets.js';
import { applyExtraLife, applySuperBonus } from './powerups.js';
import { drawSprite, drawStar } from '../sprites.js';
import { revive } from '../serial.js';

export class Player {
  constructor(lives) {
    this.w = PLAYER.width;
    this.h = PLAYER.height;
    this.x = (WIDTH - this.w) / 2;
    this.y = PLAYER.y;
    this.lives = lives;
    this.cooldown = 0;
    this.invuln = 0;     // pozostały czas nietykalności
    this.golden = 0;     // złota poświata po „Złotej podkowie”
    this.star = false;   // tarcza „Gwiazda szeryfa”
    this.bonuses = { double: 0, fast: 0 }; // pozostały czas bonusów czasowych
    this.t = 0;
  }

  static fromJSON(data) {
    const bonuses = data?.bonuses;
    if (!Number.isFinite(bonuses?.double) || !Number.isFinite(bonuses?.fast)) throw new Error('Player: niepoprawne bonusy');
    const player = revive(Player, data, ['w', 'h', 'x', 'y', 'lives', 'cooldown', 'invuln', 'golden', 't']);
    player.star = Boolean(player.star);
    return player;
  }

  get rect() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }

  // Nieco mniejszy prostokąt trafień — uczciwsze kolizje
  get hitbox() {
    return { x: this.x + 5, y: this.y + 6, w: this.w - 10, h: this.h - 6 };
  }

  get maxBullets() {
    return this.bonuses.double > 0 ? 2 : 1;
  }

  update(dt, input) {
    this.t += dt;
    let dir = 0;
    if (input.isDown('ArrowLeft', 'KeyA')) dir -= 1;
    if (input.isDown('ArrowRight', 'KeyD')) dir += 1;
    const minX = PLAYER.margin;
    const maxX = WIDTH - this.w - PLAYER.margin;
    this.x = Math.max(minX, Math.min(maxX, this.x + dir * PLAYER.speed * dt));

    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.golden = Math.max(0, this.golden - dt);
    for (const key of Object.keys(this.bonuses)) {
      this.bonuses[key] = Math.max(0, this.bonuses[key] - dt);
    }
  }

  // Zwraca nowy pocisk albo null, gdy trwa cooldown lub osiągnięto limit pocisków
  tryShoot(activeBullets) {
    if (this.cooldown > 0 || activeBullets >= this.maxBullets) return null;
    this.cooldown = this.bonuses.fast > 0 ? PLAYER.fastCooldown : PLAYER.cooldown;
    return new Bullet(
      this.x + this.w / 2 - PLAYER.bulletW / 2, this.y - PLAYER.bulletH,
      0, -PLAYER.bulletSpeed, PLAYER.bulletW, PLAYER.bulletH, 'player',
    );
  }

  // Wynik: 'ignored' (nietykalny) | 'absorbed' (gwiazda) | 'lost' | 'dead'
  hit() {
    if (this.invuln > 0) return 'ignored';
    if (this.star) {
      this.star = false;
      this.invuln = 0.5;
      return 'absorbed';
    }
    this.lives--;
    if (this.lives <= 0) return 'dead';
    this.invuln = PLAYER.invulnTime;
    return 'lost';
  }

  // Zwraca true, gdy „Złota podkowa” dała punkty zamiast życia
  applyPowerup(type) {
    switch (type) {
      case 'double':
      case 'fast':
        this.bonuses[type] = POWERUPS.timedDuration;
        return false;
      case 'star':
        this.star = true;
        return false;
      case 'life':
        this.lives = applyExtraLife(this.lives);
        return false;
      case 'super': {
        const result = applySuperBonus(this.lives);
        this.lives = result.lives;
        this.invuln = Math.max(this.invuln, POWERUPS.superInvulnTime);
        this.golden = POWERUPS.superInvulnTime;
        return result.overflow;
      }
      default:
        return false;
    }
  }

  draw(ctx) {
    const blinking = this.invuln > 0 && this.golden <= 0;
    if (blinking && Math.floor(this.t * 14) % 2 === 0) return; // miganie

    ctx.save();
    if (this.golden > 0) {
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 18 + 6 * Math.sin(this.t * 12);
    }
    drawSprite(ctx, 'sheriff', 0, this.x, this.y, PLAYER.scale);
    ctx.restore();

    if (this.star) {
      // Tarcza gwiazdy szeryfa
      const cx = this.x + this.w / 2;
      const cy = this.y + this.h / 2;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(this.t * 6);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      drawStar(ctx, this.x + this.w + 4, this.y + 2, 6, '#ffd700');
    }
  }
}
