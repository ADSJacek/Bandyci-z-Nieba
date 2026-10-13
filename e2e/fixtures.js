// Wspólne przygotowanie testów E2E: dostęp do obiektu gry, atrapa Supabase, stabilne tło.
import { test as base, expect } from '@playwright/test';

export const LEADERBOARD = [
  { nick: 'SZERYF', score: 900, wave: 3, difficulty: 'normalny', created_at: '2026-10-01T10:00:00Z' },
  { nick: 'KOWBOJ', score: 450, wave: 2, difficulty: 'normalny', created_at: '2026-10-02T10:00:00Z' },
];

export const test = base.extend({
  // Zapytania do Supabase (żeby sprawdzić, że gra nie woła serwera, gdy nie powinna)
  supabaseCalls: async ({}, use) => use([]),

  page: async ({ page, supabaseCalls }, use) => {
    // Hak testowy: instancja gry na window — czekamy na stan zamiast na upływ czasu
    await page.route('**/js/main.js', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: `${await res.text()}\nwindow.__game = game;\n` });
    });
    // Atrapa Supabase: testy nie zależą od sieci ani od prawdziwego rankingu
    await page.route('https://*.supabase.co/**', async (route) => {
      const req = route.request();
      supabaseCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
      const isTop = req.method() === 'GET' && req.url().includes('/rest/v1/scores');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isTop ? LEADERBOARD : []) });
    });
    // Tło bez animacji (ANIMACJE 0%) — zrzuty są porównywalne między uruchomieniami
    await page.addInitScript(() => localStorage.setItem('arcaneInvaders.animLevel', '0'));
    await use(page);
  },
});

export { expect };

export async function openGame(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__game);
}

// Pojedyncze naciśnięcie — gra czyta klawisze raz na klatkę, więc czekamy dwie klatki
export async function press(page, key) {
  await page.keyboard.press(key);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export const game = (page, fn) => page.evaluate(fn);

export async function waitForState(page, state) {
  await page.waitForFunction((s) => window.__game.state === s, state);
}

export async function enterAsGuest(page) {
  await openGame(page);
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await waitForState(page, 'menu');
}

export async function startGame(page) {
  await press(page, 'Enter');
  await waitForState(page, 'playing');
}

// Przegrana wymuszona przez stan — bez sterowania trwałaby kilka minut
export async function forceGameOver(page, score) {
  await page.evaluate((sc) => {
    const g = window.__game;
    g.score = sc;
    g.player.lives = 0;
    g.endGame();
  }, score);
}

export async function attachShot(page, testInfo, name) {
  await testInfo.attach(name, { body: await page.locator('#game').screenshot(), contentType: 'image/png' });
}
