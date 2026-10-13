import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, loginToEmail, SESSION_KEY } from '../auth.js';

const BASE = 'https://abc.supabase.co';
const KEY = 'sb_publishable_test';
const NOW = 1_800_000_000_000; // ms

function mockBackend(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

// Odpowiedź Supabase Auth z sesją
const sessionBody = (login, { id = 'u-1', access = 'at-1', refresh = 'rt-1', expiresAt = NOW / 1000 + 3600 } = {}) => JSON.stringify({
  access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: expiresAt, token_type: 'bearer',
  user: { id, user_metadata: { login } },
});

function fakeFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const r = responses.shift() ?? {};
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    return { ok: status < 400, status, headers: new Headers(), text: async () => r.body ?? '' };
  };
  fn.calls = calls;
  return fn;
}

const authWith = (fetchFn, { backend = mockBackend(), now = () => NOW } = {}) => ({
  backend, auth: createAuth({ url: BASE, key: KEY, fetchFn, backend, now }),
});

test('loginToEmail: małe litery, UTF-8 jako hex, stała domena', () => {
  assert.equal(loginToEmail('Łukasz'), 'uc582756b61737a@bandyci.local');
  assert.equal(loginToEmail('  ŁUKASZ '), loginToEmail('łukasz'));
  assert.equal(loginToEmail('Mały  Joe'), loginToEmail('mały joe'));
  assert.match(loginToEmail('a-b_1'), /^u[0-9a-f]+@bandyci\.local$/);
  // 12 liter po 3 bajty → część lokalna > 64 znaki → brak adresu
  assert.equal(loginToEmail('漢字漢字漢字漢字漢字漢字'), null);
});

test('rejestracja: e-mail techniczny, login w danych, sesja zapamiętana bez hasła', async () => {
  const fetchFn = fakeFetch([{ body: sessionBody('Mały Joe') }]);
  const { auth, backend } = authWith(fetchFn);
  assert.equal(auth.user, null);
  assert.deepEqual(await auth.signUp('  Mały Joe ', 'tajne123'), { ok: true, error: null });
  const [call] = fetchFn.calls;
  assert.equal(call.url, `${BASE}/auth/v1/signup`);
  assert.equal(call.init.headers.apikey, KEY);
  assert.deepEqual(call.body, { email: loginToEmail('Mały Joe'), password: 'tajne123', data: { login: 'Mały Joe' } });
  assert.deepEqual(auth.user, { id: 'u-1', login: 'Mały Joe' });
  const stored = backend.data[SESSION_KEY];
  assert.ok(stored.includes('rt-1'));
  assert.ok(!stored.includes('tajne123')); // hasło nigdy nie trafia do localStorage
  assert.deepEqual(createAuth({ url: BASE, key: KEY, fetchFn, backend, now: () => NOW }).user, { id: 'u-1', login: 'Mały Joe' });
});

test('logowanie: grant_type=password', async () => {
  const fetchFn = fakeFetch([{ body: sessionBody('Joe') }]);
  const { auth } = authWith(fetchFn);
  assert.equal((await auth.signIn('Joe', 'tajne123')).ok, true);
  assert.equal(fetchFn.calls[0].url, `${BASE}/auth/v1/token?grant_type=password`);
  assert.deepEqual(fetchFn.calls[0].body, { email: loginToEmail('Joe'), password: 'tajne123' });
  assert.equal(auth.user.login, 'Joe');
});

test('błędy Supabase → czytelne kody', async () => {
  const fetchFn = fakeFetch([
    { status: 422, body: '{"code":422,"error_code":"user_already_exists","msg":"User already registered"}' },
    { status: 400, body: '{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}' },
    { status: 422, body: '{"code":422,"error_code":"weak_password","msg":"Password should be at least 6 characters."}' },
    { status: 200, body: '{"id":"u-9","user_metadata":{"login":"Joe"}}' }, // włączone „Confirm email”: użytkownik bez sesji
    { throws: new TypeError('Failed to fetch') },
    { status: 500, body: '<html>błąd</html>' },
  ]);
  const { auth } = authWith(fetchFn);
  assert.equal((await auth.signUp('Joe', 'tajne123')).error, 'login-zajety');
  assert.equal((await auth.signIn('Joe', 'zle1234')).error, 'zle-dane');
  assert.equal((await auth.signUp('Joe', 'tajne123')).error, 'slabe-haslo');
  assert.equal((await auth.signUp('Joe', 'tajne123')).error, 'potwierdz-email');
  assert.equal((await auth.signIn('Joe', 'tajne123')).error, 'network');
  assert.equal((await auth.signIn('Joe', 'tajne123')).error, 'http-500');
  assert.equal(auth.user, null);
});

test('walidacja przed wysłaniem: zły login, za krótkie hasło, brak konfiguracji', async () => {
  const fetchFn = fakeFetch();
  const { auth } = authWith(fetchFn);
  assert.equal((await auth.signUp('a;b', 'tajne123')).error, 'zly-login');
  assert.equal((await auth.signUp('漢字漢字漢字漢字漢字漢字', 'tajne123')).error, 'zly-login');
  assert.equal((await auth.signUp('Joe', '12345')).error, 'slabe-haslo');
  assert.equal((await auth.signIn('', 'tajne123')).error, 'zle-dane');
  assert.equal(fetchFn.calls.length, 0);
  const offline = createAuth({ url: '', key: KEY, fetchFn, backend: mockBackend() });
  assert.equal((await offline.signIn('Joe', 'tajne123')).error, 'offline');
});

test('getToken: ważny token bez zapytania; tuż przed wygaśnięciem — odświeżenie', async () => {
  let now = NOW;
  const fetchFn = fakeFetch([
    { body: sessionBody('Joe', { expiresAt: NOW / 1000 + 120 }) },
    { body: sessionBody('Joe', { access: 'at-2', refresh: 'rt-2', expiresAt: NOW / 1000 + 3700 }) },
  ]);
  const { auth, backend } = authWith(fetchFn, { now: () => now });
  await auth.signIn('Joe', 'tajne123');
  assert.equal(await auth.getToken(), 'at-1');
  assert.equal(fetchFn.calls.length, 1);
  now = NOW + 70_000; // do wygaśnięcia zostało 50 s < 60 s
  assert.equal(await auth.getToken(), 'at-2');
  assert.equal(fetchFn.calls[1].url, `${BASE}/auth/v1/token?grant_type=refresh_token`);
  assert.deepEqual(fetchFn.calls[1].body, { refresh_token: 'rt-1' });
  assert.ok(backend.data[SESSION_KEY].includes('rt-2'));
});

test('równoczesne getToken → jedno odświeżenie (rotacja refresh tokenu)', async () => {
  const fetchFn = fakeFetch([
    { body: sessionBody('Joe', { expiresAt: NOW / 1000 + 10 }) },
    { body: sessionBody('Joe', { access: 'at-2', refresh: 'rt-2' }) },
  ]);
  const { auth } = authWith(fetchFn);
  await auth.signIn('Joe', 'tajne123');
  const tokens = await Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
  assert.deepEqual(tokens, ['at-2', 'at-2', 'at-2']);
  assert.equal(fetchFn.calls.length, 2);
});

test('odrzucone odświeżenie (4xx) → gość i onSessionLost; brak sieci → sesja zostaje', async () => {
  const fetchFn = fakeFetch([
    { body: sessionBody('Joe', { expiresAt: NOW / 1000 + 10 }) },
    { throws: new TypeError('Failed to fetch') },
    { status: 400, body: '{"error_code":"validation_failed","msg":"Refresh token is not valid"}' },
  ]);
  const { auth, backend } = authWith(fetchFn);
  let lost = 0;
  auth.onSessionLost = () => { lost++; };
  await auth.signIn('Joe', 'tajne123');
  assert.equal(await auth.getToken(), 'at-1'); // sieć padła — stary token, sesja zostaje
  assert.equal(auth.user.login, 'Joe');
  assert.equal(await auth.getToken(), null);   // serwer odrzucił sesję
  assert.equal(auth.user, null);
  assert.equal(lost, 1);
  assert.equal(JSON.parse(backend.data[SESSION_KEY]), null);
});

test('wylogowanie: sesja usunięta, wywołanie /logout z tokenem (błąd sieci ignorowany)', async () => {
  const fetchFn = fakeFetch([{ body: sessionBody('Joe') }, { throws: new TypeError('Failed to fetch') }]);
  const { auth, backend } = authWith(fetchFn);
  await auth.signIn('Joe', 'tajne123');
  assert.deepEqual(await auth.signOut(), { ok: true, error: null });
  assert.equal(auth.user, null);
  assert.equal(await auth.getToken(), null);
  assert.equal(fetchFn.calls[1].url, `${BASE}/auth/v1/logout`);
  assert.equal(fetchFn.calls[1].init.headers.Authorization, 'Bearer at-1');
  assert.equal(JSON.parse(backend.data[SESSION_KEY]), null);
});

test('uszkodzona lub niepełna sesja w localStorage → gość, bez wyjątku', () => {
  for (const raw of ['{zepsute', '42', '{"access_token":"a"}', 'null']) {
    const auth = createAuth({ url: BASE, key: KEY, fetchFn: fakeFetch(), backend: mockBackend({ [SESSION_KEY]: raw }) });
    assert.equal(auth.user, null, raw);
  }
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(createAuth({ url: BASE, key: KEY, fetchFn: fakeFetch(), backend: broken }).user, null);
});
