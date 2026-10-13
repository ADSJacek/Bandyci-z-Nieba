// Wszystkie stałe gry i ustawienia poziomów trudności — tutaj stroimy rozgrywkę.

// Rozdzielczość logiczna canvasu
export const WIDTH = 800;
export const HEIGHT = 600;

export const MAX_DT = 0.05;          // maks. krok czasu w sekundach (50 ms)
export const HUD_HEIGHT = 40;        // wysokość paska HUD u góry
export const HORIZON_Y = 420;        // linia horyzontu na tle
export const GROUND_Y = 592;         // poziom ziemi — tu wybucha dynamit
export const WAVE_BANNER_TIME = 2;   // czas napisu „FALA N” (s)
export const BOSS_EVERY = 5;         // co która fala to boss

export const FONT_TITLE = "'Rye', 'Georgia', serif";
export const FONT_TEXT = "'Georgia', 'Times New Roman', serif";

export const PLAYER = {
  scale: 3,
  width: 39,
  height: 42,
  y: 544,
  margin: 8,
  speed: 330,            // px/s
  cooldown: 0.4,         // s między strzałami
  fastCooldown: 0.15,    // cooldown z bonusem „Szybki spust”
  bulletSpeed: 620,
  bulletW: 3,
  bulletH: 12,
  invulnTime: 2,         // nietykalność po trafieniu (s)
  maxLives: 5,
  superMaxLives: 6,
};

export const FORMATION = {
  rows: 5,
  cols: 10,
  cellW: 50,
  cellH: 38,
  enemyW: 33,
  enemyH: 27,
  scale: 3,
  startY: 80,
  startYStepPerWave: 20,  // każda kolejna fala zaczyna niżej…
  startYMaxOffset: 100,   // …ale nie niżej niż o tyle
  margin: 12,
  stepDown: 16,           // zejście w dół po dotknięciu krawędzi
  baseSpeed: 28,          // px/s przy pełnej formacji
  maxSpeedFactor: 6,      // mnożnik prędkości dla ostatniego bandyty
  speedPerWave: 0.12,     // przyrost prędkości na falę
  maxWaveSpeedFactor: 3,
  shootInterval: 0.9,     // średni odstęp między strzałami (s)
  minShootInterval: 0.25,
  firePerWave: 0.08,
  bulletSpeed: 240,
  bulletW: 4,
  bulletH: 10,
  animInterval: 0.5,      // zmiana klatki animacji (s)
};

export const ENEMY_TYPES = {
  herszt: { points: 30, color: '#e3b43b' },
  rewolwerowiec: { points: 20, color: '#2f8f83' },
  opryszek: { points: 10, color: '#c0392b' },
};

// Typ bandyty dla danego rzędu (0 = górny)
export const ROW_TYPES = ['herszt', 'rewolwerowiec', 'rewolwerowiec', 'opryszek', 'opryszek'];

export const BOSS = {
  width: 96,
  height: 72,
  y: 60,                 // docelowa pozycja górnej krawędzi
  enterSpeed: 70,        // prędkość wjazdu z góry
  baseHp: 20,            // trafienia pierwszego bossa
  hpPerBoss: 5,          // dodatkowe trafienia dla kolejnych bossów
  speed: 150,
  speedPerBoss: 0.1,
  fanInterval: 1.6,      // odstęp wachlarza 3 pocisków (s)
  fanAngle: 0.35,        // rad
  fanBulletSpeed: 230,
  dynamiteInterval: 4.5, // odstęp rzutów dynamitem (s)
  dynamiteSpeed: 170,
  dynamiteMaxVx: 140,
  explosionRadius: 55,
  rewardPerBoss: 500,
};

export const VULTURE = {
  width: 44,
  height: 24,
  y: 50,
  speed: 160,
  minInterval: 12,       // s między przelotami
  maxInterval: 24,
  minPoints: 50,
  maxPoints: 300,
  pointsStep: 50,
  superChance: 0.02,     // szansa na „Złotą podkowę”
};

export const SHIELDS = {
  count: 4,
  y: 440,
  blockSize: 6,
};

export const POWERUPS = {
  size: 22,
  fallSpeed: 110,
  superFallSpeed: 55,
  timedDuration: 10,     // czas bonusów czasowych (s)
  weights: { double: 4, fast: 4, star: 3, life: 1 }, // „life” rzadki
  superInvulnTime: 3,
  superOverflowPoints: 1000,
};

// Efekty wizualne: animowane tło, wstrząsy ekranu i błyski
export const VISUALS = {
  sunX: 400,
  sunY: 335,             // słońce zachodzi za dalekimi górami
  sunRadius: 58,
  cloudCount: 5,
  cloudMinSpeed: 6,      // px/s
  cloudMaxSpeed: 16,
  starTwinkleCount: 14,  // gwiazdy migoczące (reszta jest statyczna)
  tumbleweedMinDelay: 6, // s między przetoczeniami krzaka
  tumbleweedMaxDelay: 14,
  tumbleweedSpeed: 120,
  shakeHit: 7,           // siła wstrząsu po utracie życia (px)
  shakeExplosion: 5,     // siła wstrząsu po wybuchu dynamitu
  shakeBoss: 10,         // siła wstrząsu po pokonaniu bossa
  shakeDecay: 0.35,      // czas wygasania wstrząsu (s)
  flashTime: 0.35,       // czas błysku ekranu (s)
};

export const DIFFICULTIES = {
  latwy:    { key: 'latwy',    label: 'Łatwy',    enemySpeed: 0.7, enemyFire: 0.5, lives: 5, powerupChance: 0.15, scoreMultiplier: 0.5 },
  normalny: { key: 'normalny', label: 'Normalny', enemySpeed: 1.0, enemyFire: 1.0, lives: 3, powerupChance: 0.10, scoreMultiplier: 1.0 },
  trudny:   { key: 'trudny',   label: 'Trudny',   enemySpeed: 1.4, enemyFire: 1.6, lives: 2, powerupChance: 0.06, scoreMultiplier: 1.5 },
};

export const DIFFICULTY_ORDER = ['latwy', 'normalny', 'trudny'];
export const DEFAULT_DIFFICULTY = 'normalny';

// Zwraca ustawienia poziomu; nieznany klucz → poziom normalny
export function getDifficulty(key) {
  return DIFFICULTIES[key] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}

// Zapis wyników i przerwanej gry (Supabase + kopia w localStorage)
export const PERSISTENCE = {
  autosaveInterval: 10,  // s między automatycznymi zapisami w trakcie gry
  dbTimeoutMs: 5000,     // limit czasu jednego zapytania do bazy
  leaderboardSize: 10,   // TOP N w menu
  historySize: 10,       // ostatnie N gier gracza
  scoreQueueMax: 20,     // maks. niewysłanych wyników w kolejce offline
  nickMaxLength: 12,
};

// Logowanie graczy (Supabase Auth): login + hasło, bez e-maila dla gracza
export const AUTH = {
  emailDomain: 'bandyci.local', // techniczny adres konta: u<hex loginu>@bandyci.local
  passwordMin: 6,
  passwordMax: 72,
  refreshMarginS: 60,           // odświeżamy token, gdy do wygaśnięcia zostało mniej (s)
};
