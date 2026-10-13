// Ożywione tło: dryfujące chmury, migoczące gwiazdy, toczący się krzak (tumbleweed),
// klucze ptaków, krążące sępy, pył z podmuchami wiatru i pociąg parowy na horyzoncie.
// Czysto dekoracyjne — nie biorą udziału w kolizjach. Natężenie 0–1 (suwak „ANIMACJE”):
// liczba drobin i sępów, częstotliwość ptaków / pociągu / krzaka, prędkość chmur i migotanie.
import { WIDTH, HORIZON_Y, HUD_HEIGHT, VISUALS } from './config.js';

const between = (min, max) => min + Math.random() * (max - min);
const SILHOUETTE = '#2a1622';

// Suwak: krok 10% w zakresie 0–100%, bez błędów zaokrągleń (0.3 − 0.1 = 0.2)
export function stepLevel(level, dir) {
  const max = Math.round(1 / VISUALS.animStep);
  const steps = Math.round(level * max) + dir;
  return Math.max(0, Math.min(max, steps)) / max;
}

export class Ambient {
  constructor(level = 1) {
    this.t = 0;
    this.clouds = [];
    for (let i = 0; i < VISUALS.cloudCount; i++) {
      const w = between(90, 170);
      this.clouds.push({
        x: between(-w, WIDTH),
        y: between(HUD_HEIGHT + 20, 230),
        w,
        speed: between(VISUALS.cloudMinSpeed, VISUALS.cloudMaxSpeed),
        img: paintCloud(w),
      });
    }
    this.stars = [];
    for (let i = 0; i < VISUALS.starTwinkleCount; i++) {
      this.stars.push({ x: between(10, WIDTH - 10), y: between(HUD_HEIGHT + 8, 160), phase: between(0, Math.PI * 2), rate: between(1.5, 3.5) });
    }
    this.weed = null;
    this.weedTimer = between(2, VISUALS.tumbleweedMinDelay);
    this.weedImg = paintTumbleweed(14);

    this.flock = null;
    this.flockTimer = between(2, VISUALS.birdMinDelay);
    this.dust = Array.from({ length: VISUALS.dustCount }, () => ({
      x: between(0, WIDTH), y: between(HORIZON_Y + 15, 585), vx: between(8, 22), size: between(1.5, 3), phase: between(0, Math.PI * 2),
    }));
    this.gust = 0;            // pozostały czas podmuchu wiatru
    this.gustTimer = between(VISUALS.dustGustMinDelay, VISUALS.dustGustMaxDelay);
    this.train = null;
    this.trainTimer = between(5, VISUALS.trainMinDelay);
    this.circlers = [];
    this.setLevel(level);
  }

  // Natężenie animacji 0–1; przy 0 ruchome elementy znikają, chmury i gwiazdy stoją
  setLevel(level) {
    this.level = level;
    if (level <= 0) {
      this.weed = null;
      this.flock = null;
      this.train = null;
      this.gust = 0;
    }
    const count = Math.round(VISUALS.circlerCount * level);
    while (this.circlers.length > count) this.circlers.pop();
    while (this.circlers.length < count) {
      const i = this.circlers.length;
      this.circlers.push({
        cx: 180 + i * 420 + between(-40, 40), cy: between(150, 200), r: between(35, 55),
        a: between(0, Math.PI * 2), speed: between(0.25, 0.4) * (i % 2 ? -1 : 1),
      });
    }
  }

  get visibleDust() {
    return Math.round(VISUALS.dustCount * this.level);
  }

  // Podmuch: drobiny przyspieszają do ×4 (łagodne narastanie i wygasanie)
  get gustBoost() {
    if (this.gust <= 0) return 1;
    return 1 + 3 * Math.sin((this.gust / VISUALS.dustGustTime) * Math.PI);
  }

  update(dt) {
    const k = this.level;
    this.t += dt * k; // migotanie gwiazd i falowanie zwalniają razem z natężeniem
    for (const c of this.clouds) {
      c.x += c.speed * k * dt;
      if (c.x > WIDTH) {
        c.x = -c.w;
        c.y = between(HUD_HEIGHT + 20, 230);
      }
    }
    this.updateWeed(dt, k);
    this.updateBirds(dt, k);
    this.updateDust(dt, k);
    this.updateTrain(dt, k);
  }

  // Liczniki pojawiania się biegną wolniej przy mniejszym natężeniu (przy 0 — wcale)
  updateWeed(dt, k) {
    if (this.weed) {
      const w = this.weed;
      w.x += w.dir * VISUALS.tumbleweedSpeed * dt;
      w.angle += w.dir * (VISUALS.tumbleweedSpeed / 14) * dt;
      w.hop += dt * 5;
      if (w.x < -40 || w.x > WIDTH + 40) this.weed = null;
      return;
    }
    this.weedTimer -= dt * k;
    if (this.weedTimer <= 0 && k > 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.weed = { x: dir > 0 ? -30 : WIDTH + 30, y: between(HORIZON_Y + 30, 520), dir, angle: 0, hop: 0 };
      this.weedTimer = between(VISUALS.tumbleweedMinDelay, VISUALS.tumbleweedMaxDelay);
    }
  }

  updateBirds(dt, k) {
    for (const c of this.circlers) c.a += c.speed * dt;
    if (this.flock) {
      const f = this.flock;
      f.x += f.dir * VISUALS.birdSpeed * dt;
      f.t += dt;
      if (f.x < -120 || f.x > WIDTH + 120) this.flock = null;
      return;
    }
    this.flockTimer -= dt * k;
    if (this.flockTimer <= 0 && k > 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const n = Math.floor(between(VISUALS.birdFlockMin, VISUALS.birdFlockMax + 1));
      // Klucz w kształcie litery V: przewodnik z przodu, reszta na zmianę po bokach
      const birds = Array.from({ length: n }, (_, i) => {
        const rank = Math.ceil(i / 2);
        return { dx: -dir * rank * 14, dy: (i % 2 ? -1 : 1) * rank * 7, phase: between(0, Math.PI * 2) };
      });
      this.flock = { x: dir > 0 ? -60 : WIDTH + 60, y: between(70, 200), dir, t: 0, birds };
      this.flockTimer = between(VISUALS.birdMinDelay, VISUALS.birdMaxDelay);
    }
  }

  updateDust(dt, k) {
    if (this.gust > 0) {
      this.gust = Math.max(0, this.gust - dt);
    } else {
      this.gustTimer -= dt * k;
      if (this.gustTimer <= 0 && k > 0) {
        this.gust = VISUALS.dustGustTime;
        this.gustTimer = between(VISUALS.dustGustMinDelay, VISUALS.dustGustMaxDelay);
      }
    }
    const boost = this.gustBoost;
    for (let i = 0; i < this.visibleDust; i++) {
      const d = this.dust[i];
      d.x += d.vx * boost * dt;
      d.y += Math.sin(this.t * 2 + d.phase) * 6 * dt;
      if (d.x > WIDTH + 4) d.x = -4;
    }
  }

  updateTrain(dt, k) {
    const tr = this.train;
    if (tr) {
      tr.x += VISUALS.trainSpeed * dt;
      tr.puffTimer -= dt;
      if (tr.puffTimer <= 0 && tr.x < WIDTH + 10) {
        tr.puffTimer = VISUALS.trainPuffInterval;
        tr.smoke.push({ x: tr.x + 5, y: VISUALS.trainY - 17, r: 2.5, t: 0 });
      }
      for (const s of tr.smoke) {
        s.t += dt;
        s.y -= 9 * dt;
        s.x -= 7 * dt;          // wiatr rozwiewa dym do tyłu
        s.r += 3.5 * dt;
      }
      tr.smoke = tr.smoke.filter((s) => s.t < VISUALS.smokeLife);
      if (tr.x > WIDTH + 140 && tr.smoke.length === 0) this.train = null;
      return;
    }
    this.trainTimer -= dt * k;
    if (this.trainTimer <= 0 && k > 0) {
      this.train = { x: -20, smoke: [], puffTimer: 0 };
      this.trainTimer = between(VISUALS.trainMinDelay, VISUALS.trainMaxDelay);
    }
  }

  draw(ctx) {
    ctx.fillStyle = '#fff4dc';
    for (const s of this.stars) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(this.t * s.rate + s.phase));
      ctx.globalAlpha = a;
      ctx.fillRect(s.x, s.y - 1, 1, 3);   // mały krzyżyk
      ctx.fillRect(s.x - 1, s.y, 3, 1);
    }
    ctx.globalAlpha = 1;

    ctx.globalAlpha = 0.5;
    for (const c of this.clouds) ctx.drawImage(c.img, Math.round(c.x), Math.round(c.y));
    ctx.globalAlpha = 1;

    this.drawCirclers(ctx);
    this.drawTrain(ctx);
    this.drawFlock(ctx);
    this.drawDust(ctx);
    this.drawWeed(ctx);
  }

  // Sępy szybujące po okręgu — szeroka, płaska sylwetka
  drawCirclers(ctx) {
    ctx.strokeStyle = SILHOUETTE;
    ctx.lineWidth = 2;
    for (const c of this.circlers) {
      const x = c.cx + Math.cos(c.a) * c.r;
      const y = c.cy + Math.sin(c.a) * c.r * 0.35;
      const tilt = Math.sin(c.a) * 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 2 + tilt);
      ctx.quadraticCurveTo(x - 4, y - 4, x, y);
      ctx.quadraticCurveTo(x + 4, y - 4, x + 9, y - 2 - tilt);
      ctx.stroke();
    }
  }

  // Ptaki machające skrzydłami: dwie kreski w kształcie litery V
  drawFlock(ctx) {
    const f = this.flock;
    if (!f) return;
    ctx.strokeStyle = SILHOUETTE;
    ctx.lineWidth = 2;
    for (const b of f.birds) {
      const x = f.x + b.dx;
      const y = f.y + b.dy + Math.sin(f.t * 2 + b.phase) * 2;
      const flap = Math.sin(f.t * 9 + b.phase) * 3;
      ctx.beginPath();
      ctx.moveTo(x - 8, y - flap);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 8, y - flap);
      ctx.stroke();
    }
  }

  // Lokomotywa z wagonami jako ciemna sylwetka na horyzoncie, dym z komina
  drawTrain(ctx) {
    const tr = this.train;
    if (!tr) return;
    for (const s of tr.smoke) {
      ctx.globalAlpha = 0.45 * (1 - s.t / VISUALS.smokeLife);
      ctx.fillStyle = '#d9c3b0';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const y = VISUALS.trainY;
    const x = Math.round(tr.x); // przód lokomotywy
    ctx.fillStyle = SILHOUETTE;
    ctx.fillRect(x - 20, y - 9, 26, 7);   // kocioł
    ctx.fillRect(x - 26, y - 15, 8, 13);  // budka maszynisty
    ctx.fillRect(x + 3, y - 15, 3, 6);    // komin
    for (let i = 0; i < VISUALS.trainCars; i++) {
      ctx.fillRect(x - 50 - i * 23, y - 10, 20, 8); // wagony za lokomotywą
    }
    for (let wx = x + 2; wx > x - 50 - VISUALS.trainCars * 23; wx -= 8) {
      ctx.fillRect(wx, y - 2, 3, 2);      // koła
    }
  }

  // Drobiny pyłu migoczące w świetle zachodu; w podmuchu jaśniejsze
  drawDust(ctx) {
    ctx.fillStyle = '#f6dcb0';
    const n = this.visibleDust;
    for (let i = 0; i < n; i++) {
      const d = this.dust[i];
      ctx.globalAlpha = 0.35 + 0.35 * Math.max(0, Math.sin(this.t * 3 + d.phase)) + (this.gust > 0 ? 0.2 : 0);
      ctx.fillRect(d.x, d.y, d.size, d.size);
    }
    ctx.globalAlpha = 1;
  }

  drawWeed(ctx) {
    if (!this.weed) return;
    const w = this.weed;
    const hop = Math.abs(Math.sin(w.hop)) * 10;   // podskoki
    // cień na piasku
    ctx.fillStyle = 'rgba(80, 40, 20, 0.3)';
    ctx.beginPath();
    ctx.ellipse(w.x, w.y + 14, 12 - hop * 0.4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(w.x, w.y - hop);
    ctx.rotate(w.angle);
    ctx.drawImage(this.weedImg, -this.weedImg.width / 2, -this.weedImg.height / 2);
    ctx.restore();
  }
}

// Chmura z kilku elips: ciemnofioletowa góra, podświetlony od słońca dół.
// Kolory kryjące — przezroczystość nadaje draw(), więc elipsy nie tworzą ciemnych plam
function paintCloud(w) {
  const h = Math.round(w * 0.32);
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = h;
  const g = c.getContext('2d');
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, '#5c2e58');
  fill.addColorStop(0.7, '#c45c54');
  fill.addColorStop(1, '#ffaa6e');
  g.fillStyle = fill;
  const blobs = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < blobs; i++) {
    const bx = w * (0.15 + (0.7 * i) / (blobs - 1));
    const rx = w * between(0.12, 0.2);
    const ry = h * between(0.25, 0.4);
    g.beginPath();
    g.ellipse(bx, h - ry - 2, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// Kłębek suchych gałązek: losowe łuki w okręgu
function paintTumbleweed(r) {
  const size = r * 2 + 4;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  g.lineWidth = 1.5;
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = i % 3 === 0 ? '#6e4a24' : '#9a6a36';
    g.beginPath();
    const a = Math.random() * Math.PI * 2;
    g.arc(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, between(r * 0.4, r * 0.75), a, a + between(1.5, 3.5));
    g.stroke();
  }
  return c;
}
