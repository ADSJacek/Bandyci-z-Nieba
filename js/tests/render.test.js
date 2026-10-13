import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakeContext } from './fake-dom.js';
import { getDifficulty } from '../config.js';

installFakeDom();
const { drawMenu, drawLogin, drawHistory, drawGameOver, formatDate, LOGIN_OPTIONS } = await import('../render.js');

const rows = [{ nick: 'Joe', difficulty: 'normalny', score: 900, wave: 3, created_at: '2026-10-13T10:05:00Z' }];
const form = (extra = {}) => ({ step: 'form', choice: 0, mode: 'signin', field: 0, login: 'Joe', password: 'tajne', busy: false, error: null, ...extra });

function screenGame({ persistence = {}, user = { id: 'u-1', login: 'Joe' }, loginForm = form(), logoutArmed = false, animLevel = 1 } = {}) {
  return {
    time: 1.3,
    difficultyIndex: 1,
    difficultyKey: 'normalny',
    difficulty: getDifficulty('normalny'),
    savedRecord: 100,
    score: 50,
    record: 100,
    newRecord: false,
    playerName: user?.login ?? 'gość',
    animLevel,
    auth: { user },
    logoutArmed,
    loginForm,
    persistence: {
      saved: null,
      notice: null,
      lastResult: null,
      leaderboard: { difficulty: 'normalny', status: 'loading', rows: [] },
      history: { status: 'loading', rows: [] },
      ...persistence,
    },
  };
}

test('opcje ekranu logowania', () => {
  assert.deepEqual(LOGIN_OPTIONS, ['signin', 'signup', 'guest']);
});

test('ekrany rysują się we wszystkich stanach danych', () => {
  const persistenceVariants = [
    {},
    {
      leaderboard: { difficulty: 'normalny', status: 'ok', rows: Array(10).fill(rows[0]) },
      history: { status: 'ok', rows: Array(10).fill(rows[0]) },
      saved: { difficulty: 'trudny', wave: 7, score: 4200 },
      lastResult: { status: 'ok', rank: 2 },
    },
    {
      leaderboard: { difficulty: 'normalny', status: 'error', rows: [] },
      history: { status: 'error', rows: [] },
      notice: 'Sesja wygasła — zaloguj się ponownie',
      lastResult: { status: 'queued', rank: null },
    },
    { history: { status: 'gosc', rows: [] }, lastResult: { status: 'gosc', rank: null } },
    { lastResult: { status: 'sending', rank: null } },
  ];
  const loginForms = [
    { step: 'choice', choice: 2, mode: 'signin', field: 0, login: '', password: '', busy: false, error: null },
    form({ mode: 'signup', field: 1, password: 'x'.repeat(72) }),
    form({ busy: true }),
    ...['login-zajety', 'zle-dane', 'slabe-haslo', 'zly-login', 'potwierdz-email', 'za-duzo-prob', 'blad-serwera', 'nieudane', 'network', 'http-500'].map((error) => form({ error })),
  ];
  for (const persistence of persistenceVariants) {
    for (const user of [{ id: 'u-1', login: 'Joe' }, null]) {
      for (const loginForm of loginForms) {
        for (const [logoutArmed, animLevel] of [[false, 1], [true, 0], [false, 0.5]]) {
          const game = screenGame({ persistence, user, loginForm, logoutArmed, animLevel });
          for (const draw of [drawMenu, drawLogin, drawHistory, drawGameOver]) {
            assert.doesNotThrow(() => draw(fakeContext, game), draw.name);
          }
        }
      }
    }
  }
});

test('formatDate: data i godzina po polsku, zła data → kreska', () => {
  const iso = new Date(2026, 9, 13, 9, 5).toISOString();
  assert.equal(formatDate(iso), '13.10.2026 09:05');
  assert.equal(formatDate('zła'), '—');
});

// Kontekst nagrywający napisy (fillText) — reszta metod jak w atrapie
function recordingContext() {
  const texts = [];
  const ctx = new Proxy({}, {
    get: (target, prop) => (prop === 'fillText' ? (str, x, y) => texts.push({ str: String(str), x, y }) : fakeContext[prop]),
    set: () => true,
  });
  return { ctx, texts };
}

test('menu: wylogowanie widoczne u góry obok loginu, nie dubluje się na dole', () => {
  const { ctx, texts } = recordingContext();
  drawMenu(ctx, screenGame());
  const top = texts.filter((t) => t.y < 60).map((t) => t.str);
  assert.ok(top.some((s) => s.includes('szeryf: Joe')), top.join(' | '));
  assert.ok(top.some((s) => s.includes('L — wyloguj')), top.join(' | '));
  const bottom = texts.filter((t) => t.y > 500).map((t) => t.str);
  assert.ok(!bottom.some((s) => s.includes('L — wyloguj')), bottom.join(' | '));
  assert.ok(bottom.some((s) => s.includes('H — historia gier')));
});

test('menu gościa: bez opcji wylogowania u góry', () => {
  const { ctx, texts } = recordingContext();
  drawMenu(ctx, screenGame({ user: null }));
  assert.ok(!texts.some((t) => t.str.includes('wyloguj')));
});
