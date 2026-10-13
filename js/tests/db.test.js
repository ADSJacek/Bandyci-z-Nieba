import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, parseContentRangeTotal } from '../db.js';

const BASE = 'https://abc.supabase.co';
const KEY = 'sb_publishable_test';

// Atrapa fetch: zapisuje wywołania i zwraca przygotowane odpowiedzi po kolei
function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const r = responses.shift() ?? {};
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    return { ok: status < 400, status, headers: new Headers(r.headers ?? {}), text: async () => r.body ?? '' };
  };
  fn.calls = calls;
  return fn;
}

const dbWith = (fetchFn, opts = {}) => createDb({ url: BASE, key: KEY, fetchFn, ...opts });

test('bez konfiguracji: tryb offline, bez zapytań', async () => {
  const fetchFn = fakeFetch();
  for (const db of [createDb({ url: '', key: KEY, fetchFn }), createDb({ url: BASE, key: '', fetchFn })]) {
    assert.equal(db.enabled, false);
    assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'offline' });
  }
  assert.equal(fetchFn.calls.length, 0);
});

test('zalogowany: token w Authorization; gość: tylko apikey', async () => {
  const fetchFn = fakeFetch([{ body: '[]' }, { body: '[]' }]);
  await dbWith(fetchFn, { getToken: async () => 'tok-1' }).topScores('latwy');
  await dbWith(fetchFn).topScores('latwy');
  assert.equal(fetchFn.calls[0].init.headers.Authorization, 'Bearer tok-1');
  assert.equal(fetchFn.calls[0].init.headers.apikey, KEY);
  assert.equal(fetchFn.calls[1].init.headers.Authorization, undefined); // klucz publishable nie jest JWT
});

test('gość ze starszym kluczem anon (JWT): klucz w Authorization', async () => {
  const fetchFn = fakeFetch([{ body: '[]' }]);
  await createDb({ url: BASE, key: 'eyJhbGciOi.test', fetchFn }).topScores('latwy');
  assert.equal(fetchFn.calls[0].init.headers.Authorization, 'Bearer eyJhbGciOi.test');
});

test('submitScore: tylko poziom, wynik i fala (konto i login dopisuje baza)', async () => {
  const fetchFn = fakeFetch([{ status: 201 }]);
  const res = await dbWith(fetchFn).submitScore({ id: 'q-1', userId: 'u-1', difficulty: 'trudny', score: 1500, wave: 4 });
  assert.equal(res.ok, true);
  const [call] = fetchFn.calls;
  assert.equal(call.url, `${BASE}/rest/v1/scores`);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(call.body, { difficulty: 'trudny', score: 1500, wave: 4 });
  assert.equal(call.init.headers.Prefer, 'return=minimal');
});

test('topScores: filtr poziomu, sortowanie, limit', async () => {
  const rows = [{ nick: 'Joe', difficulty: 'trudny', score: 900, wave: 3, created_at: '2026-10-13T10:00:00Z' }];
  const fetchFn = fakeFetch([{ body: JSON.stringify(rows) }]);
  const res = await createDb({ url: `${BASE}/`, key: KEY, fetchFn }).topScores('trudny');
  assert.deepEqual(res.data, rows);
  const url = new URL(fetchFn.calls[0].url);
  assert.equal(url.origin + url.pathname, `${BASE}/rest/v1/scores`);
  assert.equal(url.searchParams.get('difficulty'), 'eq.trudny');
  assert.equal(url.searchParams.get('order'), 'score.desc,created_at.asc');
  assert.equal(url.searchParams.get('limit'), '10');
});

test('myHistory: gry konta, najnowsze najpierw', async () => {
  const fetchFn = fakeFetch([{ body: '[]' }]);
  await dbWith(fetchFn).myHistory('u-1');
  const url = new URL(fetchFn.calls[0].url);
  assert.equal(url.pathname, '/rest/v1/scores');
  assert.equal(url.searchParams.get('user_id'), 'eq.u-1');
  assert.equal(url.searchParams.get('order'), 'created_at.desc');
  assert.equal(url.searchParams.get('limit'), '10');
});

test('rankOf: liczba lepszych wyników + 1 z nagłówka Content-Range', async () => {
  const fetchFn = fakeFetch([
    { body: '[{"id":1}]', headers: { 'content-range': '0-0/4' } },
    { body: '[]', headers: { 'content-range': '*/0' } },
    { body: '[]' },
  ]);
  const db = dbWith(fetchFn);
  assert.deepEqual(await db.rankOf('normalny', 700), { ok: true, data: 5, error: null });
  assert.deepEqual(await db.rankOf('normalny', 99999), { ok: true, data: 1, error: null });
  assert.deepEqual(await db.rankOf('normalny', 1), { ok: false, data: null, error: 'bad-count' });
  const url = new URL(fetchFn.calls[0].url);
  assert.equal(url.searchParams.get('score'), 'gt.700');
  assert.equal(fetchFn.calls[0].init.headers.Prefer, 'count=exact');
});

test('parseContentRangeTotal', () => {
  assert.equal(parseContentRangeTotal('0-9/120'), 120);
  assert.equal(parseContentRangeTotal('*/0'), 0);
  assert.equal(parseContentRangeTotal('0-0/*'), null);
  assert.equal(parseContentRangeTotal(null), null);
});

test('saveGame / loadGame / deleteGame: REST na saved_games', async () => {
  const row = { difficulty: 'latwy', snapshot: { version: 1 }, updated_at: '2026-10-13T10:00:00Z' };
  const fetchFn = fakeFetch([{ status: 201 }, { body: JSON.stringify([row]) }, { body: '[]' }, { status: 204 }]);
  const db = dbWith(fetchFn, { getToken: async () => 'tok-1' });
  assert.equal((await db.saveGame('u-1', 'latwy', { version: 1 }, { keepalive: true })).ok, true);
  assert.deepEqual((await db.loadGame('u-1')).data, row);
  assert.equal((await db.loadGame('u-1')).data, null);
  assert.equal((await db.deleteGame('u-1')).ok, true);
  const [save, load, , del] = fetchFn.calls;

  const saveUrl = new URL(save.url);
  assert.equal(saveUrl.pathname, '/rest/v1/saved_games');
  assert.equal(saveUrl.searchParams.get('on_conflict'), 'user_id');
  assert.equal(save.init.method, 'POST');
  assert.equal(save.init.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(save.init.keepalive, true);
  assert.equal(save.body.user_id, 'u-1');
  assert.equal(save.body.difficulty, 'latwy');
  assert.deepEqual(save.body.snapshot, { version: 1 });
  assert.ok(!Number.isNaN(Date.parse(save.body.updated_at)));

  const loadUrl = new URL(load.url);
  assert.equal(loadUrl.searchParams.get('user_id'), 'eq.u-1');
  assert.equal(loadUrl.searchParams.get('select'), 'difficulty,snapshot,updated_at');
  assert.equal(load.init.method, 'GET');

  assert.equal(new URL(del.url).searchParams.get('user_id'), 'eq.u-1');
  assert.equal(del.init.method, 'DELETE');
});

test('błędy: HTTP, sieć, zła odpowiedź, timeout — bez wyjątków', async () => {
  const fetchFn = fakeFetch([{ status: 500 }, { throws: new TypeError('Failed to fetch') }, { body: '{zepsuty' }]);
  const db = dbWith(fetchFn);
  assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'http-500' });
  assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'network' });
  assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'bad-response' });
  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const slow = createDb({ url: BASE, key: KEY, fetchFn: hanging, timeoutMs: 10 });
  assert.deepEqual(await slow.loadGame('u-1'), { ok: false, data: null, error: 'timeout' });
});
