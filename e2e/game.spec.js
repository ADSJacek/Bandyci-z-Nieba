// Scenariusze E2E: logowanie → menu → rozgrywka → pauza → koniec gry
import {
  test, expect, LEADERBOARD, openGame, press, game, waitForState, enterAsGuest, startGame, forceGameOver, attachShot,
} from './fixtures.js';

test('start: ekran „KTO JEDZIE?” z wyborem opcji strzałkami', async ({ page }, testInfo) => {
  await openGame(page);
  expect(await game(page, () => window.__game.state)).toBe('login');
  expect(await game(page, () => window.__game.loginForm.choice)).toBe(0);

  await press(page, 'ArrowDown');
  expect(await game(page, () => window.__game.loginForm.choice)).toBe(1);
  await press(page, 'ArrowUp');
  await press(page, 'ArrowUp'); // z pierwszej opcji zawija na ostatnią
  expect(await game(page, () => window.__game.loginForm.choice)).toBe(2);
  await attachShot(page, testInfo, 'logowanie-wybor');
});

test('logowanie: puste pola dają błąd bez wołania serwera', async ({ page, supabaseCalls }, testInfo) => {
  await openGame(page);
  await press(page, 'Enter'); // ZALOGUJ → formularz
  expect(await game(page, () => window.__game.loginForm.step)).toBe('form');

  await press(page, 'Enter'); // wysłanie pustego formularza
  await page.waitForFunction(() => window.__game.loginForm.error);
  expect(await game(page, () => window.__game.loginForm.error)).toBe('zle-dane');
  expect(supabaseCalls.filter((c) => c.includes('/auth/'))).toEqual([]);
  await attachShot(page, testInfo, 'logowanie-blad');

  await press(page, 'Escape');
  expect(await game(page, () => window.__game.loginForm.step)).toBe('choice');
});

test('menu gościa: ranking z serwera i zmiana poziomu trudności', async ({ page }, testInfo) => {
  await enterAsGuest(page);
  expect(await game(page, () => window.__game.playerName)).toBe('gość');
  expect(await game(page, () => window.__game.difficultyKey)).toBe('normalny');

  await page.waitForFunction(() => window.__game.persistence.leaderboard.status === 'ok');
  const rows = await game(page, () => window.__game.persistence.leaderboard.rows);
  expect(rows.map((r) => r.nick)).toEqual(LEADERBOARD.map((r) => r.nick));
  await attachShot(page, testInfo, 'menu-gosc');

  await press(page, 'ArrowDown');
  expect(await game(page, () => window.__game.difficultyKey)).toBe('trudny');
  expect(await game(page, () => window.__game.difficulty.lives)).toBe(2);
});

test('rozgrywka: fala 1 to 50 bandytów, 3 życia i wynik 0', async ({ page }, testInfo) => {
  await enterAsGuest(page);
  await startGame(page);
  await page.waitForFunction(() => window.__game.formation); // po napisie „FALA 1”

  const s = await game(page, () => {
    const g = window.__game;
    return { wave: g.wave, score: g.score, lives: g.player.lives, total: g.formation.total, alive: g.formation.alive };
  });
  expect(s).toEqual({ wave: 1, score: 0, lives: 3, total: 50, alive: 50 });
  await attachShot(page, testInfo, 'rozgrywka-fala1');
});

test('pauza: P zatrzymuje i wznawia grę', async ({ page }, testInfo) => {
  await enterAsGuest(page);
  await startGame(page);
  await page.waitForFunction(() => window.__game.formation);

  await press(page, 'KeyP');
  expect(await game(page, () => window.__game.state)).toBe('paused');
  const frozen = await game(page, () => window.__game.formation.x);
  await page.waitForTimeout(500);
  expect(await game(page, () => window.__game.formation.x)).toBe(frozen);
  await attachShot(page, testInfo, 'pauza');

  await press(page, 'KeyP');
  expect(await game(page, () => window.__game.state)).toBe('playing');
  await expect.poll(() => game(page, () => window.__game.formation.x)).not.toBe(frozen);
});

test.describe('koniec gry', () => {
  test('wynik ponad rekordem: „NOWY REKORD!” i zapis w localStorage', async ({ page }, testInfo) => {
    await enterAsGuest(page);
    await startGame(page);
    await forceGameOver(page, 1230);

    expect(await game(page, () => window.__game.state)).toBe('gameover');
    expect(await game(page, () => window.__game.newRecord)).toBe(true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arcaneInvaders.highscores')));
    expect(saved.normalny).toBe(1230);
    await attachShot(page, testInfo, 'koniec-gry-rekord');

    await press(page, 'Enter');
    expect(await game(page, () => window.__game.state)).toBe('menu');
  });

  test('wynik poniżej rekordu: bez „NOWY REKORD!”, R restartuje', async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.setItem('arcaneInvaders.highscores', JSON.stringify({ normalny: 5000 })));
    await enterAsGuest(page);
    await startGame(page);
    await forceGameOver(page, 300);

    expect(await game(page, () => window.__game.newRecord)).toBe(false);
    await attachShot(page, testInfo, 'koniec-gry');

    await press(page, 'KeyR');
    expect(await game(page, () => window.__game.state)).toBe('playing');
    expect(await game(page, () => window.__game.score)).toBe(0);
  });
});
