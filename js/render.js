// Rysowanie tła (pustynia o zachodzie słońca), HUD i ekranów: logowanie, menu,
// historia gier, pauza, game over.
import {
  WIDTH, HEIGHT, HORIZON_Y, HUD_HEIGHT, WAVE_BANNER_TIME,
  FONT_TITLE, FONT_TEXT, DIFFICULTY_ORDER, DIFFICULTIES, ENEMY_TYPES, POWERUPS, VISUALS, PERSISTENCE, AUTH,
} from './config.js';
import { drawSprite, drawHat } from './sprites.js';
import { drawPowerupIcon } from './entities/powerups.js';

const INK = '#3b2314';
const CREAM = '#ffe2a8';
const GOLD = '#ffd700';

// Ekran „KTO JEDZIE?”: opcje (kolejność = wybór strzałkami) i komunikaty błędów logowania
export const LOGIN_OPTIONS = ['signin', 'signup', 'guest'];
const LOGIN_LABELS = { signin: 'ZALOGUJ', signup: 'ZAREJESTRUJ', guest: 'GRAJ JAKO GOŚĆ' };
const LOGIN_ERRORS = {
  'login-zajety': 'Ten login jest już zajęty',
  'zle-dane': 'Zły login lub hasło',
  'slabe-haslo': `Hasło musi mieć co najmniej ${AUTH.passwordMin} znaków`,
  'zly-login': `Login: 1–${PERSISTENCE.nickMaxLength} znaków, litery, cyfry, spacja, _ -`,
  'potwierdz-email': 'Konto czeka na potwierdzenie e-mail (wyłącz „Confirm email” w Supabase)',
  'za-duzo-prob': 'Za dużo prób — spróbuj za chwilę',
  'blad-serwera': 'Błąd serwera — spróbuj ponownie',
};
const LOGIN_ERROR_OFFLINE = 'Brak połączenia z serwerem — możesz grać jako gość';
const LOGIN_ERROR_OTHER = 'Nie udało się — spróbuj ponownie';
const OFFLINE_ERRORS = ['offline', 'network', 'timeout', 'bad-response'];

// --- Tło ---------------------------------------------------------------------

let background = null;

// Opcjonalna grafika tła z pliku; dopóki się nie wczyta (lub gdy jej brak) — tło rysowane kodem
const bgImage = new Image();
bgImage.src = 'assets/jacek.png';

export function drawBackground(ctx) {
  if (bgImage.complete && bgImage.naturalWidth) {
    ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);
    return;
  }
  if (!background) background = buildBackground();
  ctx.drawImage(background, 0, 0);
}

// Tło jest statyczne — malujemy je raz do osobnego canvasu
function buildBackground() {
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = HEIGHT;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, HORIZON_Y);
  sky.addColorStop(0, '#2a1740');
  sky.addColorStop(0.35, '#6b2a4a');
  sky.addColorStop(0.65, '#c4492e');
  sky.addColorStop(0.88, '#f08a3c');
  sky.addColorStop(1, '#f9c66b');
  g.fillStyle = sky;
  g.fillRect(0, 0, WIDTH, HORIZON_Y);

  // Pierwsze gwiazdy (stałe ziarno — to samo tło przy każdym uruchomieniu)
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(255, 240, 220, 0.7)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.floor(rand() * WIDTH), 45 + Math.floor(rand() * 120), 1, 1);

  // Słońce z poświatą — zachodzi za dalekimi górami
  const { sunX, sunY, sunRadius } = VISUALS;
  const glow = g.createRadialGradient(sunX, sunY, sunRadius * 0.6, sunX, sunY, sunRadius * 4.2);
  glow.addColorStop(0, 'rgba(255, 214, 120, 0.7)');
  glow.addColorStop(0.4, 'rgba(255, 160, 80, 0.25)');
  glow.addColorStop(1, 'rgba(255, 160, 80, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, WIDTH, HORIZON_Y);
  g.drawImage(buildSun(sunRadius), sunX - sunRadius, sunY - sunRadius);

  // Dalekie góry
  polygon(g, '#8a3a3f', [
    [0, HORIZON_Y], [0, 350], [60, 332], [120, 360], [190, 305], [260, 348], [330, 322], [390, 352],
    [450, 318], [520, 350], [590, 300], [660, 342], [730, 318], [800, 345], [800, HORIZON_Y],
  ]);
  // Bliższe mesy (płaskie szczyty)
  polygon(g, '#5a2533', [
    [0, HORIZON_Y], [0, 382], [40, 382], [52, 368], [150, 368], [162, 392], [240, 398], [300, 398],
    [312, 384], [360, 384], [372, 404], [470, 404], [492, 372], [505, 362], [615, 362], [630, 380],
    [700, 392], [760, 388], [800, 380], [800, HORIZON_Y],
  ]);

  // Piaszczysta ziemia
  const ground = g.createLinearGradient(0, HORIZON_Y, 0, HEIGHT);
  ground.addColorStop(0, '#d39a5a');
  ground.addColorStop(1, '#9e5f2e');
  g.fillStyle = ground;
  g.fillRect(0, HORIZON_Y, WIDTH, HEIGHT - HORIZON_Y);

  // Wydmy
  g.strokeStyle = 'rgba(110, 55, 20, 0.25)';
  g.lineWidth = 2;
  for (const [y, amp] of [[440, 6], [478, 9], [520, 7], [566, 10]]) {
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= WIDTH; x += 100) g.quadraticCurveTo(x + 50, y - amp, x + 100, y);
    g.stroke();
  }

  // Kaktusy — ciemne sylwetki, żeby nie myliły się z obiektami gry
  cactus(g, 60, 428, 0.9);
  cactus(g, 745, 432, 1.1);
  cactus(g, 250, 412, 0.4);
  cactus(g, 560, 410, 0.35);
  cactus(g, 690, 414, 0.45);

  // Kamienie
  g.fillStyle = 'rgba(80, 40, 20, 0.45)';
  for (const [x, y, w] of [[140, 505, 10], [330, 575, 14], [610, 520, 8], [480, 590, 12], [40, 560, 9]]) {
    g.beginPath();
    g.ellipse(x, y, w, w * 0.45, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// Tarcza słońca: gradient od żółtego do pomarańczowego, dolna część pocięta
// poziomymi paskami (coraz szerszymi ku dołowi) — klasyczny „retro” zachód
function buildSun(r) {
  const c = document.createElement('canvas');
  c.width = r * 2;
  c.height = r * 2;
  const g = c.getContext('2d');
  const fill = g.createLinearGradient(0, 0, 0, r * 2);
  fill.addColorStop(0, '#fff1b0');
  fill.addColorStop(0.5, '#ffc861');
  fill.addColorStop(1, '#ff7a3d');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();

  g.globalCompositeOperation = 'destination-out';
  // Paski zaczynają się nad linią gór, żeby było je widać
  for (let i = 0, y = r * 0.45; y < r * 2; i++) {
    const gap = 1.5 + i;
    g.fillRect(0, y, r * 2, gap);
    y += gap + Math.max(3, 8 - i);
  }
  return c;
}

// Przyciemnione rogi ekranu — skupiają wzrok na środku planszy
let vignette = null;

export function drawVignette(ctx) {
  if (!vignette) {
    vignette = document.createElement('canvas');
    vignette.width = WIDTH;
    vignette.height = HEIGHT;
    const g = vignette.getContext('2d');
    const grad = g.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.45, WIDTH / 2, HEIGHT / 2, HEIGHT * 0.85);
    grad.addColorStop(0, 'rgba(20, 8, 4, 0)');
    grad.addColorStop(1, 'rgba(20, 8, 4, 0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, WIDTH, HEIGHT);
  }
  ctx.drawImage(vignette, 0, 0);
}

// Błysk całego ekranu (np. czerwony po trafieniu); k: 1 → 0
export function drawFlash(ctx, color, k) {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.35 * k;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

function polygon(g, color, points) {
  g.fillStyle = color;
  g.beginPath();
  points.forEach(([x, y]) => g.lineTo(x, y));
  g.closePath();
  g.fill();
}

// Saguaro: pień + dwa ramiona
function cactus(g, x, baseY, s) {
  g.fillStyle = '#2e3a1f';
  const pill = (px, py, w, h) => {
    const r = w / 2;
    g.beginPath();
    g.arc(px + r, py + r, r, Math.PI, 0);
    g.lineTo(px + w, py + h);
    g.lineTo(px, py + h);
    g.closePath();
    g.fill();
  };
  pill(x - 7 * s, baseY - 80 * s, 14 * s, 80 * s);
  pill(x - 24 * s, baseY - 62 * s, 9 * s, 28 * s);
  g.fillRect(x - 24 * s, baseY - 38 * s, 20 * s, 8 * s);
  pill(x + 15 * s, baseY - 70 * s, 9 * s, 26 * s);
  g.fillRect(x + 4 * s, baseY - 48 * s, 20 * s, 8 * s);
}

// --- Pomocnicze ------------------------------------------------------------

function text(ctx, str, x, y, { font = FONT_TITLE, size = 20, color = CREAM, align = 'center', shadow = true } = {}) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (shadow) {
    ctx.fillStyle = 'rgba(30, 12, 4, 0.8)';
    ctx.fillText(str, x + 2, y + 2);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function blink(time, rate = 2) {
  return Math.floor(time * rate * 2) % 2 === 0;
}

// List gończy na starym papierze
function poster(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(x + 6, y + 6, w, h);
  const paper = ctx.createRadialGradient(x + w / 2, y + h / 2, 40, x + w / 2, y + h / 2, h * 0.75);
  paper.addColorStop(0, '#f1e1b5');
  paper.addColorStop(1, '#c9a86a');
  ctx.fillStyle = paper;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 15, y + 15, w - 30, h - 30);
  // gwóźdź
  ctx.fillStyle = '#4a4a4a';
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 6, 4, 0, Math.PI * 2);
  ctx.fill();
}

// --- HUD -------------------------------------------------------------------

export function drawHUD(ctx, game) {
  ctx.fillStyle = 'rgba(30, 15, 8, 0.78)';
  ctx.fillRect(0, 0, WIDTH, HUD_HEIGHT);
  ctx.fillStyle = '#d4a017';
  ctx.fillRect(0, HUD_HEIGHT - 2, WIDTH, 2);

  const y = HUD_HEIGHT / 2;
  text(ctx, `WYNIK ${game.score}`, 14, y, { size: 16, align: 'left' });
  text(ctx, `REKORD ${game.record}`, 170, y, { size: 16, align: 'left', color: '#f4c27a' });
  text(ctx, `FALA ${game.wave}`, 345, y, { size: 16, align: 'left' });

  // Aktywne bonusy z paskiem pozostałego czasu
  const p = game.player;
  let bx = 440;
  for (const type of ['double', 'fast']) {
    const left = p.bonuses[type];
    if (left <= 0) continue;
    drawPowerupIcon(ctx, type, bx + 8, y, 16);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(bx + 20, y - 3, 38, 6);
    ctx.fillStyle = type === 'double' ? '#e67e22' : '#5dade2';
    ctx.fillRect(bx + 20, y - 3, 38 * (left / POWERUPS.timedDuration), 6);
    bx += 66;
  }
  if (p.star) drawPowerupIcon(ctx, 'star', bx + 8, y, 16);

  // Życia jako kapelusze (od prawej)
  for (let i = 0; i < p.lives; i++) {
    const golden = i >= 5; // szóste życie z „Złotej podkowy”
    drawHat(ctx, WIDTH - 34 - i * 23, y - 6, golden ? GOLD : '#b07a42', golden ? '#8b5a2b' : '#d4a017');
  }
}

export function drawBossBar(ctx, boss) {
  const w = 320;
  const x = (WIDTH - w) / 2;
  const y = HUD_HEIGHT + 5;
  ctx.fillStyle = 'rgba(30, 10, 5, 0.8)';
  ctx.fillRect(x - 2, y - 2, w + 4, 14);
  ctx.fillStyle = '#9b1c1c';
  ctx.fillRect(x, y, w * (boss.hp / boss.maxHp), 10);
  text(ctx, 'EL DIABLO', WIDTH / 2, y + 5, { size: 10, font: FONT_TEXT, color: '#fff', shadow: false });
}

export function drawBanner(ctx, game) {
  const k = game.bannerTimer / WAVE_BANNER_TIME;   // 1 → 0
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 4, (1 - k) * 6 + 0.2);
  text(ctx, `FALA ${game.wave}`, WIDTH / 2, 250, { size: 56 });
  if (game.isBossWave) {
    text(ctx, 'EL DIABLO NADJEŻDŻA!', WIDTH / 2, 305, { size: 26, color: '#ff6b4a' });
  }
  ctx.restore();
}

export function drawMuteIndicator(ctx, muted) {
  if (!muted) return;
  text(ctx, 'DŹWIĘK WYŁ. (M)', WIDTH - 10, HEIGHT - 12, { size: 12, font: FONT_TEXT, align: 'right', color: CREAM });
}

// --- Ekrany ----------------------------------------------------------------

export function drawMenu(ctx, game) {
  ctx.fillStyle = 'rgba(20, 8, 4, 0.35)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // List gończy z tytułem
  const px = 60;
  const py = 50;
  const pw = 330;
  const cx = px + pw / 2;
  poster(ctx, px, py, pw, 480);
  text(ctx, 'WANTED', cx, py + 70, { size: 62, color: INK, shadow: false });
  ctx.fillStyle = 'rgba(59, 35, 20, 0.15)';
  ctx.fillRect(cx - 60, py + 110, 120, 96);
  drawSprite(ctx, 'herszt', Math.floor(game.time * 2) % 2, cx - 44, py + 122, 8);
  text(ctx, 'BANDYCI', cx, py + 250, { size: 40, color: '#7a1f12', shadow: false });
  text(ctx, 'Z NIEBA', cx, py + 294, { size: 40, color: '#7a1f12', shadow: false });
  text(ctx, 'ŻYWI LUB MARTWI', cx, py + 332, { size: 16, font: FONT_TEXT, color: INK, shadow: false });
  text(ctx, 'NAGRODA', cx, py + 378, { size: 20, color: INK, shadow: false });
  text(ctx, `$ ${game.savedRecord}`, cx, py + 418, { size: 34, color: INK, shadow: false });
  text(ctx, `rekord — poziom ${game.difficulty.label.toLowerCase()}`, cx, py + 450, { size: 13, font: FONT_TEXT, color: INK, shadow: false });

  // Cennik bandytów pod listem gończym
  ['herszt', 'rewolwerowiec', 'opryszek'].forEach((type, i) => {
    const x = 80 + i * 105;
    drawSprite(ctx, type, 0, x, 548, 2);
    text(ctx, `= ${ENEMY_TYPES[type].points}`, x + 44, 557, { size: 15, font: FONT_TEXT });
  });

  // Prawy panel: gracz, poziom trudności, wznowienie, ranking, sterowanie
  const rx = 600;
  const who = game.auth.user ? `szeryf: ${game.playerName}` : 'gość — wyniki nie trafiają do rankingu';
  text(ctx, who, rx, 34, { size: 15, font: FONT_TEXT, color: '#f4c27a' });
  text(ctx, 'POZIOM TRUDNOŚCI', rx, 74, { size: 22 });
  DIFFICULTY_ORDER.forEach((key, i) => {
    const y = 112 + i * 38;
    const selected = i === game.difficultyIndex;
    if (selected) {
      ctx.fillStyle = '#7a4a22';
      ctx.fillRect(rx - 110, y - 16, 220, 32);
      ctx.strokeStyle = '#3b2314';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx - 110, y - 16, 220, 32);
      text(ctx, '►', rx - 92, y, { size: 16, color: GOLD, shadow: false });
      text(ctx, '◄', rx + 92, y, { size: 16, color: GOLD, shadow: false });
    }
    text(ctx, DIFFICULTIES[key].label.toUpperCase(), rx, y, { size: 20, color: selected ? '#fff3d6' : 'rgba(255, 226, 168, 0.55)' });
  });
  const d = game.difficulty;
  text(ctx, `życia: ${d.lives}  ·  punkty ×${d.scoreMultiplier.toFixed(1)}`, rx, 222, { size: 14, font: FONT_TEXT });

  if (blink(game.time, 1)) text(ctx, 'ENTER — NOWA GRA', rx, 254, { size: 24, color: GOLD });

  const p = game.persistence;
  if (p.notice) {
    text(ctx, p.notice, rx, 284, { size: 13, font: FONT_TEXT, color: '#ff8a6a' });
  } else if (game.logoutArmed) {
    text(ctx, 'L ponownie — wyloguj (przerwana gra zostaje na koncie)', rx, 284, { size: 13, font: FONT_TEXT, color: '#ff8a6a' });
  } else if (p.saved) {
    const level = DIFFICULTIES[p.saved.difficulty].label.toLowerCase();
    text(ctx, `C — wznów: ${level}, fala ${p.saved.wave}, $ ${p.saved.score}`, rx, 284, { size: 14, font: FONT_TEXT, color: GOLD });
  }

  drawLeaderboard(ctx, p.leaderboard, d.label, rx, 314);

  const controls = [
    '← → / A D — ruch  ·  SPACJA — strzał',
    'P / ESC — pauza  ·  M — dźwięk  ·  ↑ ↓ — poziom',
    game.auth.user ? 'L — wyloguj  ·  H — historia gier' : 'L — zaloguj się lub załóż konto',
  ];
  controls.forEach((line, i) => text(ctx, line, rx, 520 + i * 20, { size: 13, font: FONT_TEXT }));
}

// TOP 10 dla wybranego poziomu; przy wczytywaniu zostają poprzednie wiersze
function drawLeaderboard(ctx, board, label, cx, y) {
  text(ctx, `TOP ${PERSISTENCE.leaderboardSize} — ${label.toUpperCase()}`, cx, y, { size: 18 });
  const rows = board.rows;
  if (rows.length === 0) {
    const messages = { error: 'Ranking niedostępny', ok: 'Brak wyników — bądź pierwszy!' };
    text(ctx, messages[board.status] ?? 'Wczytywanie…', cx, y + 30, { size: 14, font: FONT_TEXT, color: 'rgba(255, 226, 168, 0.7)' });
    return;
  }
  rows.forEach((row, i) => {
    const ry = y + 26 + i * 17;
    const style = { size: 13, font: FONT_TEXT, color: i === 0 ? GOLD : CREAM, shadow: false };
    text(ctx, `${i + 1}.`, cx - 146, ry, { ...style, align: 'right' });
    text(ctx, row.nick, cx - 138, ry, { ...style, align: 'left' });
    text(ctx, `fala ${row.wave}`, cx + 70, ry, { ...style, align: 'right' });
    text(ctx, String(row.score), cx + 160, ry, { ...style, align: 'right' });
  });
}

export function drawPause(ctx) {
  ctx.fillStyle = 'rgba(10, 5, 2, 0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  text(ctx, 'PAUZA', WIDTH / 2, 260, { size: 72 });
  text(ctx, 'P / ESC — wznów     ENTER — menu', WIDTH / 2, 330, { size: 18, font: FONT_TEXT });
}

export function drawGameOver(ctx, game) {
  ctx.fillStyle = 'rgba(15, 5, 0, 0.6)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const pw = 360;
  const ph = 400;
  const px = (WIDTH - pw) / 2;
  const py = 70;
  const cx = WIDTH / 2;
  poster(ctx, px, py, pw, ph);
  text(ctx, 'WANTED', cx, py + 70, { size: 58, color: INK, shadow: false });

  // Czerwona pieczątka „DEAD”
  ctx.save();
  ctx.translate(cx, py + 170);
  ctx.rotate(-0.12);
  ctx.strokeStyle = '#9b1c1c';
  ctx.lineWidth = 5;
  ctx.strokeRect(-130, -48, 260, 96);
  text(ctx, 'DEAD', 0, 4, { size: 84, color: '#9b1c1c', shadow: false });
  ctx.restore();

  text(ctx, 'WYNIK', cx, py + 270, { size: 22, color: INK, shadow: false });
  text(ctx, `$ ${game.score}`, cx, py + 312, { size: 38, color: INK, shadow: false });
  if (game.newRecord && blink(game.time, 2)) {
    text(ctx, 'NOWY REKORD!', cx, py + 360, { size: 26, color: '#b3261e', shadow: false });
  } else if (!game.newRecord) {
    text(ctx, `rekord: ${game.record}`, cx, py + 360, { size: 16, font: FONT_TEXT, color: INK, shadow: false });
  }

  // Co się stało z wynikiem w bazie
  const result = game.persistence.lastResult;
  if (result) {
    let msg = 'Zapisywanie wyniku…';
    if (result.status === 'ok') msg = result.rank ? `Miejsce w rankingu: #${result.rank}` : 'Wynik zapisany w rankingu';
    else if (result.status === 'queued') msg = 'Brak połączenia — wynik wyślemy później';
    else if (result.status === 'gosc') msg = 'Gość — wynik nie trafia do rankingu';
    text(ctx, msg, cx, 500, { size: 18, font: FONT_TEXT, color: GOLD });
  }

  text(ctx, 'ENTER — MENU        R — RESTART', cx, 530, { size: 22 });
}

// „13.10.2026 09:05” w strefie czasowej przeglądarki
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Ekran „KTO JEDZIE?”: wybór (zaloguj / zarejestruj / gość) albo formularz login + hasło
export function drawLogin(ctx, game) {
  ctx.fillStyle = 'rgba(20, 8, 4, 0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const f = game.loginForm;
  const pw = 460;
  const ph = 340;
  const px = (WIDTH - pw) / 2;
  const py = 110;
  const cx = WIDTH / 2;
  poster(ctx, px, py, pw, ph);
  text(ctx, 'KTO JEDZIE?', cx, py + 60, { size: 40, color: INK, shadow: false });

  if (f.step === 'choice') {
    LOGIN_OPTIONS.forEach((option, i) => {
      const y = py + 130 + i * 56;
      const selected = i === f.choice;
      if (selected) {
        ctx.fillStyle = 'rgba(122, 74, 34, 0.25)';
        ctx.fillRect(cx - 150, y - 22, 300, 44);
        text(ctx, '►', cx - 135, y, { size: 16, color: '#7a1f12', shadow: false });
      }
      text(ctx, LOGIN_LABELS[option], cx, y, { size: 24, color: selected ? '#7a1f12' : INK, shadow: false });
    });
    text(ctx, 'gość gra bez zapisywania wyników w rankingu', cx, py + ph - 30, { size: 13, font: FONT_TEXT, color: INK, shadow: false });
    text(ctx, '↑ ↓ — wybór     ENTER — dalej', cx, py + ph + 40, { size: 20 });
    return;
  }

  text(ctx, f.mode === 'signup' ? 'nowe konto' : 'logowanie', cx, py + 98, { size: 16, font: FONT_TEXT, color: INK, shadow: false });
  const cursor = blink(game.time, 2) ? '_' : ' ';
  const fields = [
    { label: 'LOGIN', value: f.login },
    { label: 'HASŁO', value: '•'.repeat(Math.min(f.password.length, 16)) }, // hasło nigdy nie jest widoczne
  ];
  fields.forEach((field, i) => {
    const y = py + 150 + i * 70;
    const active = i === f.field;
    text(ctx, field.label, cx - 150, y - 24, { size: 13, font: FONT_TEXT, color: INK, shadow: false, align: 'left' });
    ctx.fillStyle = 'rgba(59, 35, 20, 0.15)';
    ctx.fillRect(cx - 150, y - 12, 300, 40);
    ctx.strokeStyle = INK;
    ctx.lineWidth = active ? 3 : 1;
    ctx.strokeRect(cx - 150, y - 12, 300, 40);
    text(ctx, field.value + (active && !f.busy ? cursor : ' '), cx, y + 8, { size: 24, color: '#7a1f12', shadow: false });
  });

  let status = '';
  if (f.busy) status = 'Łączenie…';
  else if (f.error) status = LOGIN_ERRORS[f.error] ?? (OFFLINE_ERRORS.includes(f.error) ? LOGIN_ERROR_OFFLINE : LOGIN_ERROR_OTHER);
  if (status) text(ctx, status, cx, py + 305, { size: 14, font: FONT_TEXT, color: f.busy ? INK : '#9b1c1c', shadow: false });
  text(ctx, 'TAB — pole     ENTER — wyślij     ESC — wróć', cx, py + ph + 40, { size: 18 });
}

export function drawHistory(ctx, game) {
  ctx.fillStyle = 'rgba(20, 8, 4, 0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const cx = WIDTH / 2;
  poster(ctx, 120, 50, 560, 480);
  text(ctx, 'TWOJE OSTATNIE GRY', cx, 100, { size: 34, color: INK, shadow: false });
  text(ctx, `szeryf ${game.playerName}`, cx, 138, { size: 15, font: FONT_TEXT, color: INK, shadow: false });

  const cols = [
    { x: 175, align: 'left', label: 'DATA', value: (r) => formatDate(r.created_at) },
    { x: 390, align: 'left', label: 'POZIOM', value: (r) => DIFFICULTIES[r.difficulty]?.label ?? r.difficulty },
    { x: 540, align: 'right', label: 'FALA', value: (r) => String(r.wave) },
    { x: 630, align: 'right', label: 'WYNIK', value: (r) => String(r.score) },
  ];
  for (const c of cols) text(ctx, c.label, c.x, 178, { size: 14, font: FONT_TEXT, color: INK, shadow: false, align: c.align });
  ctx.fillStyle = INK;
  ctx.fillRect(165, 190, 470, 2);

  const { status, rows } = game.persistence.history;
  if (rows.length === 0) {
    const messages = {
      error: 'Historia niedostępna — brak połączenia z bazą',
      ok: 'Brak rozegranych gier',
      gosc: 'Zaloguj się, aby zapisywać wyniki',
    };
    text(ctx, messages[status] ?? 'Wczytywanie…', cx, 260, { size: 16, font: FONT_TEXT, color: INK, shadow: false });
  }
  rows.forEach((row, i) => {
    const y = 212 + i * 28;
    for (const c of cols) text(ctx, c.value(row), c.x, y, { size: 15, font: FONT_TEXT, color: INK, shadow: false, align: c.align });
  });

  text(ctx, 'ESC / ENTER — powrót', cx, 565, { size: 20 });
}
