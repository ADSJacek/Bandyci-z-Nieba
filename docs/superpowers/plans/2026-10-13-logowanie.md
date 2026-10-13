# Logowanie użytkownika (Supabase Auth) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gracz zakłada konto (login + hasło) i loguje się w grze; wyniki i przerwana gra są przypięte do konta (RLS po `auth.uid()`), a gość gra dalej lokalnie, bez rankingu.

**Architecture:** Nowy `js/auth.js` rozmawia z Supabase Auth (`/auth/v1`) czystym `fetch` (wspólny helper `js/http.js`), trzyma sesję w `localStorage` i sam odświeża token. `js/db.js` dokleja `Authorization: Bearer <token>`; tabele `scores` / `saved_games` przechodzą z `device_id` na `user_id` (RPC znikają, zostaje zwykły REST z RLS). `Persistence` działa w trybie zalogowanym lub gościa; ekran pseudonimu zastępuje ekran „KTO JEDZIE?” (zaloguj / zarejestruj / gość).

**Tech Stack:** JavaScript ES2020+ (ES modules, bez bibliotek), Canvas 2D, `node --test` (Node 24), Supabase (Auth + Postgres + PostgREST + RLS).

**Spec:** `docs/superpowers/specs/2026-10-13-logowanie-design.md`

## Global Constraints

- Czysty JavaScript, ES modules, **żadnych bibliotek ani skryptów z CDN**.
- Testy: `node --test` (Node 24), `js/tests/*.test.js`; pomocnicze moduły testów bez `.test` w nazwie.
- Komentarze krótkie, po polsku; styl jak w istniejącym kodzie.
- Liczby do strojenia w `js/config.js` (nowa sekcja `AUTH`).
- Klucze `localStorage` z prefiksem `arcaneInvaders.`; każdy dostęp w `try/catch`.
- Login: 1–12 znaków po przycięciu spacji; litery (także polskie), cyfry, spacja, `_`, `-` (`isValidNick`, `NICK_CHAR`). Unikalny bez względu na wielkość liter.
- Hasło: min. 6, maks. 72 znaki; **nigdy** nie trafia do `localStorage`.
- Techniczny e-mail: `u<hex(UTF-8(lowercase(normalizeNick(login))))>@bandyci.local` (domena potwierdzona testem na żywej bazie 2026-10-13; część lokalna ≤ 64 znaki).
- Metody `auth` i `db` zwracają `{ ok, … error }` i **nigdy nie rzucają**; timeout 5000 ms.
- `update()` gry nigdy nie czeka na obietnicę.
- Konsola: tylko `console.warn` raz na rodzaj błędu.
- Commity po polsku, zakończone linią `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Gałąź `feat/logowanie` (odbita od `feat/supabase-wyniki`, PR #1). **Migracja z Task 8 zmienia wspólną bazę** — kod z gałęzi `feat/supabase-wyniki` przestaje po niej zapisywać do bazy (usunięte RPC); PR #2 trzeba scalić razem z / po PR #1.

**Świadome doprecyzowania względem specyfikacji:**
- `scores`: insert dozwolony tylko na kolumnach `difficulty, score, wave` (grant kolumnowy) — `user_id` bierze się z `default auth.uid()`, `nick` z triggera; podszycie się zablokowane już na poziomie uprawnień.
- Kolejka offline dostaje `id` wpisu (usuwanie po `id`, nie po pozycji) i odrzuca wynik tylko przy `400/409/422` — `401/403` (np. wygasła sesja) zostawia wynik w kolejce.
- `LOGIN_OPTIONS` mieszka w `render.js` (gra już importuje `render.js`; uniknięcie cyklu importów).
- Kod błędu `potwierdz-email` — gdy Supabase zwróci użytkownika bez sesji (włączone „Confirm email”).

## Review Focus

1. **Równoczesne zapytania przy wygasającym tokenie** (autozapis + ranking w tej samej chwili) → tylko jedno odświeżenie tokenu (rotacja refresh tokenu unieważnia drugie). Test: Task 2 (`równoczesne getToken → jedno odświeżenie`).
2. **Wygasła / odrzucona sesja przy wysyłce kolejki offline (401)** → wyniki zostają w kolejce, nie giną. Test: Task 4 (`flushQueue: tylko wiersze bieżącego konta…`).
3. **Wylogowanie w trakcie autozapisu** → zapis nie jest „sprzątany” ani nie trafia do następnego konta; następny gracz nie widzi przerwanej gry poprzedniego. Test: Task 4 (`wylogowanie w trakcie zapisu…`).
4. **Login z literami spoza łaciny (12 znaków po 3 bajty UTF-8)** → czytelny błąd `zly-login`, nie błąd serwera. Test: Task 2 (`loginToEmail…`).
5. **Wpisywanie hasła z literami M / L / H / P i spacją** → znaki trafiają do pola (nie wyciszają, nie wylogowują); hasło nie ląduje w `localStorage`. Testy: Task 6 (`ZALOGUJ: formularz…`), Task 2 (`sesja bez hasła…`).

---

## Struktura plików

| Plik | Rola |
|---|---|
| `js/config.js` (zmiana) | sekcja `AUTH` |
| `js/http.js` (nowy) | `requestJson` — wspólny `fetch` z JSON-em i timeoutem |
| `js/db.js` (zmiana) | token w nagłówku, `saved_games` przez REST, `user_id` |
| `js/auth.js` (nowy) | rejestracja, logowanie, sesja, odświeżanie tokenu |
| `js/profile.js` (zmiana) | tylko zasady loginu (bez UUID urządzenia) |
| `js/storage.js` (zmiana) | kopia lokalna zapisu osobno na właściciela |
| `js/persistence.js` (zmiana) | tryb zalogowany / gość, kolejka z `id` |
| `js/render.js` (zmiana) | ekran „KTO JEDZIE?”, menu / historia / game over dla gościa |
| `js/input.js` (zmiana) | `Tab` w `GAME_KEYS` |
| `js/game.js` (zmiana) | stan `LOGIN`, wylogowanie, utrata sesji |
| `js/main.js` (zmiana) | składanie `auth` → `db` → `persistence` → `game` |
| `supabase/migrations/20261013020000_logowanie.sql` (nowy) | profile, przebudowa tabel, RLS |
| `js/tests/{http,auth}.test.js` (nowe), `db`, `profile`, `storage`, `persistence`, `render`, `game` (zmiany) | testy |
| `wymagania.md` (zmiana) | opis logowania |

---

### Task 1: Wspólne zapytanie HTTP i baza z tokenem (`js/http.js`, `js/db.js`)

**Files:**
- Modify: `js/config.js` (dopisać na końcu)
- Create: `js/http.js`, `js/tests/http.test.js`
- Modify: `js/db.js`
- Test: `js/tests/db.test.js` (zastąpić całość)

**Interfaces:**
- Produces:
  - `AUTH = { emailDomain: 'bandyci.local', passwordMin: 6, passwordMax: 72, refreshMarginS: 60 }` z `config.js`
  - `requestJson(fetchFn, url, { method, headers, body, keepalive, timeoutMs }) → Promise<{ ok, status, data, error, headers }>` z `js/http.js`; `status = 0` przy błędzie sieci / timeoucie; przy błędzie HTTP `data` = treść odpowiedzi
  - `createDb({ url, key, getToken = async () => null, fetchFn, timeoutMs })` z metodami: `submitScore({ difficulty, score, wave })`, `topScores(difficulty, limit)`, `rankOf(difficulty, score)`, `myHistory(userId, limit)`, `saveGame(userId, difficulty, snapshot, { keepalive })`, `loadGame(userId)` → `data: { difficulty, snapshot, updated_at } | null`, `deleteGame(userId)`; wynik `{ ok, data, error }`

- [ ] **Step 1: Dopisz `AUTH` na końcu `js/config.js`**

```js
// Logowanie graczy (Supabase Auth): login + hasło, bez e-maila dla gracza
export const AUTH = {
  emailDomain: 'bandyci.local', // techniczny adres konta: u<hex loginu>@bandyci.local
  passwordMin: 6,
  passwordMax: 72,
  refreshMarginS: 60,           // odświeżamy token, gdy do wygaśnięcia zostało mniej (s)
};
```

- [ ] **Step 2: Napisz `js/tests/http.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../http.js';

const reply = (status, body = '', headers = {}) => async () => ({
  ok: status < 400, status, headers: new Headers(headers), text: async () => body,
});

test('sukces: JSON z odpowiedzi, nagłówki, Content-Type', async () => {
  let init;
  const fetchFn = async (url, i) => { init = i; return reply(200, '{"a":1}', { 'x-test': '1' })(); };
  const res = await requestJson(fetchFn, 'https://x/y', { method: 'POST', body: { b: 2 }, headers: { apikey: 'k' }, timeoutMs: 100 });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { a: 1 });
  assert.equal(res.headers.get('x-test'), '1');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.apikey, 'k');
  assert.equal(init.body, '{"b":2}');
});

test('błąd HTTP: kod i treść błędu (także nie-JSON)', async () => {
  const res = await requestJson(reply(422, '{"error_code":"weak_password"}'), 'https://x', { timeoutMs: 100 });
  assert.deepEqual([res.ok, res.status, res.error, res.data.error_code], [false, 422, 'http-422', 'weak_password']);
  const html = await requestJson(reply(502, '<html>Bad gateway</html>'), 'https://x', { timeoutMs: 100 });
  assert.deepEqual([html.ok, html.status, html.error, html.data], [false, 502, 'http-502', null]);
});

test('sieć, zła odpowiedź, timeout — bez wyjątków', async () => {
  const down = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await requestJson(down, 'https://x', { timeoutMs: 100 }), { ok: false, status: 0, data: null, error: 'network', headers: null });
  const bad = await requestJson(reply(200, '{zepsuty'), 'https://x', { timeoutMs: 100 });
  assert.equal(bad.error, 'bad-response');
  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  assert.equal((await requestJson(hanging, 'https://x', { timeoutMs: 10 })).error, 'timeout');
});
```

- [ ] **Step 3: Zastąp całe `js/tests/db.test.js`**

```js
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
```

- [ ] **Step 4: Uruchom — ma nie przejść**

Run: `node --test js/tests/http.test.js js/tests/db.test.js`
Expected: FAIL — `Cannot find module '../http.js'`; w `db.test.js` błędy asercji (stare ścieżki RPC / ciało `submitScore`).

- [ ] **Step 5: Utwórz `js/http.js`**

```js
// Wspólne zapytanie HTTP z JSON-em: limit czasu, nigdy nie rzuca wyjątku.
// Zwraca { ok, status, data, error, headers }. Przy błędzie HTTP `data` to treść
// odpowiedzi (np. kod błędu Supabase Auth), a `error` = 'http-<status>'.
// Błąd sieci / timeout: status 0, error 'network' | 'timeout' | 'bad-response'.
export async function requestJson(fetchFn, url, { method = 'GET', headers = {}, body, keepalive = false, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method,
      keepalive,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      if (res.ok) throw e; // treść błędu bywa HTML-em — wtedy wystarczy sam kod
    }
    if (!res.ok) return { ok: false, status: res.status, data, error: `http-${res.status}`, headers: res.headers };
    return { ok: true, status: res.status, data, error: null, headers: res.headers };
  } catch (e) {
    let error = 'network';
    if (e?.name === 'AbortError') error = 'timeout';
    else if (e instanceof SyntaxError) error = 'bad-response';
    return { ok: false, status: 0, data: null, error, headers: null };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 6: Zastąp całe `js/db.js`**

```js
// Klient bazy Supabase przez REST API (PostgREST) — czysty fetch, bez bibliotek.
// Zalogowany gracz wysyła swój token (RLS w bazie sprawdza auth.uid()), gość
// tylko klucz publiczny. Każda metoda zwraca { ok, data, error } i nigdy nie
// rzuca wyjątku: gra działa dalej bez sieci i bez konfiguracji (error: 'offline').
import { PERSISTENCE } from './config.js';
import { requestJson } from './http.js';

const SCORE_COLUMNS = 'nick,difficulty,score,wave,created_at';

function fail(error) {
  return { ok: false, data: null, error };
}

// "0-0/42" albo "*/0" → 42 / 0; brak lub "*" → null
export function parseContentRangeTotal(header) {
  const total = Number(String(header ?? '').split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

// Gość: klucz publishable (sb_publishable_…) tylko w `apikey`; starszy klucz anon (JWT) także w Authorization
function guestHeaders(key) {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export function createDb({
  url, key, getToken = async () => null, fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = PERSISTENCE.dbTimeoutMs,
} = {}) {
  const enabled = Boolean(url && key && fetchFn);
  const base = String(url ?? '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
    if (!enabled) return fail('offline');
    const token = await getToken();
    const auth = token ? { apikey: key, Authorization: `Bearer ${token}` } : guestHeaders(key);
    const res = await requestJson(fetchFn, base + path, { method, body, keepalive, timeoutMs, headers: { ...auth, ...headers } });
    return res.ok ? { ok: true, data: res.data, error: null, headers: res.headers } : fail(res.error);
  }

  const scores = (params) => `/rest/v1/scores?${new URLSearchParams(params)}`;
  const savedGame = (params) => `/rest/v1/saved_games?${new URLSearchParams(params)}`;

  return {
    enabled,

    // Konto (user_id) i login (nick) dopisuje baza — klient wysyła tylko wynik
    submitScore({ difficulty, score, wave }) {
      return request('/rest/v1/scores', {
        method: 'POST',
        body: { difficulty, score, wave },
        headers: { Prefer: 'return=minimal' },
      });
    },

    topScores(difficulty, limit = PERSISTENCE.leaderboardSize) {
      return request(scores({ select: SCORE_COLUMNS, difficulty: `eq.${difficulty}`, order: 'score.desc,created_at.asc', limit: String(limit) }));
    },

    // Miejsce w rankingu = liczba lepszych wyników + 1 (baza zwraca samą liczbę)
    async rankOf(difficulty, score) {
      const res = await request(
        scores({ select: 'id', difficulty: `eq.${difficulty}`, score: `gt.${score}`, limit: '1' }),
        { headers: { Prefer: 'count=exact' } },
      );
      if (!res.ok) return res;
      const total = parseContentRangeTotal(res.headers?.get?.('content-range'));
      return total === null ? fail('bad-count') : { ok: true, data: total + 1, error: null };
    },

    myHistory(userId, limit = PERSISTENCE.historySize) {
      return request(scores({ select: SCORE_COLUMNS, user_id: `eq.${userId}`, order: 'created_at.desc', limit: String(limit) }));
    },

    // Upsert jednego zapisu na konto; keepalive: zapytanie dokończy się po zamknięciu karty (limit 64 kB)
    saveGame(userId, difficulty, snapshot, { keepalive = false } = {}) {
      return request(savedGame({ on_conflict: 'user_id' }), {
        method: 'POST',
        keepalive,
        body: { user_id: userId, difficulty, snapshot, updated_at: new Date().toISOString() },
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    },

    async loadGame(userId) {
      const res = await request(savedGame({ select: 'difficulty,snapshot,updated_at', user_id: `eq.${userId}`, limit: '1' }));
      if (!res.ok) return res;
      return { ok: true, data: Array.isArray(res.data) ? (res.data[0] ?? null) : null, error: null };
    },

    deleteGame(userId) {
      return request(savedGame({ user_id: `eq.${userId}` }), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
  };
}
```

- [ ] **Step 7: Uruchom testy**

Run: `node --test js/tests/http.test.js js/tests/db.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS (atrapa db w `persistence.test.js` nie sprawdza sygnatur metod db).

- [ ] **Step 8: Commit**

```bash
git add js/config.js js/http.js js/db.js js/tests/http.test.js js/tests/db.test.js
git commit -m "Baza z tokenem gracza: wspólny requestJson, saved_games przez REST, user_id

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Logowanie (`js/auth.js`) i zasady loginu (`js/profile.js`)

**Files:**
- Create: `js/auth.js`, `js/tests/auth.test.js`
- Modify: `js/profile.js` (zastąpić całość), `js/tests/profile.test.js` (zastąpić całość)

**Interfaces:**
- Consumes: `requestJson` (Task 1), `AUTH`, `PERSISTENCE.dbTimeoutMs`, `defaultBackend()` (storage.js)
- Produces:
  - z `js/profile.js`: `NICK_CHAR`, `normalizeNick(raw)`, `isValidNick(raw)` (bez zmian w zachowaniu); usunięte `createProfile`, `randomUuid`, `DEVICE_ID_KEY`, `NICK_KEY`
  - z `js/auth.js`: `SESSION_KEY = 'arcaneInvaders.session'`, `loginToEmail(login): string | null`, `createAuth({ url, key, fetchFn, backend, now, timeoutMs })` → `{ user: {id, login} | null (getter), onSessionLost: fn | null, signUp(login, password), signIn(login, password), signOut(), getToken(): Promise<string | null> }`; `signUp/signIn/signOut` → `Promise<{ ok, error }>`; kody błędów: `login-zajety`, `zle-dane`, `slabe-haslo`, `zly-login`, `potwierdz-email`, `offline`, `network`, `timeout`, `bad-response`, `http-<status>`

- [ ] **Step 1: Zastąp `js/tests/profile.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidNick, normalizeNick, NICK_CHAR } from '../profile.js';

test('poprawne i niepoprawne loginy', () => {
  for (const nick of ['Joe', 'Łukasz_99', 'Mały Joe', 'a-b', 'ŻÓŁĆ', '123456789012', '  Joe  ']) {
    assert.equal(isValidNick(nick), true, nick);
  }
  for (const nick of ['', '   ', '1234567890123', 'a;b', '<script>', 'joe@x', null, undefined]) {
    assert.equal(isValidNick(nick), false, String(nick));
  }
});

test('normalizacja: przycięcie i pojedyncze spacje', () => {
  assert.equal(normalizeNick('  Mały \n  Joe '), 'Mały Joe');
  assert.equal(normalizeNick(null), '');
});

test('NICK_CHAR przepuszcza pojedyncze dozwolone znaki', () => {
  for (const ch of ['a', 'Ł', 'ż', '7', ' ', '_', '-']) assert.equal(NICK_CHAR.test(ch), true, ch);
  for (const ch of [';', '<', '.', '@', 'ab']) assert.equal(NICK_CHAR.test(ch), false, ch);
});
```

- [ ] **Step 2: Napisz `js/tests/auth.test.js`**

```js
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
```

- [ ] **Step 3: Uruchom — ma nie przejść**

Run: `node --test js/tests/auth.test.js js/tests/profile.test.js`
Expected: FAIL — `Cannot find module '../auth.js'` (profile.test.js przechodzi — testuje istniejące funkcje).

- [ ] **Step 4: Zastąp całe `js/profile.js`**

```js
// Zasady loginu gracza: ekran logowania i techniczny e-mail konta (js/auth.js).
import { PERSISTENCE } from './config.js';

// Jeden dozwolony znak loginu: litery (także polskie), cyfry, spacja, _ i -
export const NICK_CHAR = /^[\p{L}\d _-]$/u;
const NICK_PATTERN = /^[\p{L}\d _-]+$/u;

export function normalizeNick(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

export function isValidNick(raw) {
  const nick = normalizeNick(raw);
  return nick.length >= 1 && nick.length <= PERSISTENCE.nickMaxLength && NICK_PATTERN.test(nick);
}
```

- [ ] **Step 5: Utwórz `js/auth.js`**

```js
// Logowanie graczy przez Supabase Auth (REST /auth/v1) — czysty fetch, bez bibliotek.
// Gracz podaje login i hasło; Supabase wymaga e-maila, więc login zamieniamy na
// techniczny adres (niewidoczny dla gracza). Sesja w localStorage (bez hasła),
// token odświeżany automatycznie. Metody nie rzucają wyjątków.
import { AUTH, PERSISTENCE } from './config.js';
import { defaultBackend } from './storage.js';
import { isValidNick, normalizeNick } from './profile.js';
import { requestJson } from './http.js';

export const SESSION_KEY = 'arcaneInvaders.session';

// Kody błędów Supabase Auth → kody gry (komunikaty po polsku w render.js)
const ERROR_CODES = {
  user_already_exists: 'login-zajety',
  email_exists: 'login-zajety',
  invalid_credentials: 'zle-dane',
  weak_password: 'slabe-haslo',
};

// Login → techniczny e-mail: małe litery, bajty UTF-8 jako hex (polskie litery bezpieczne).
// null, gdy część lokalna adresu przekroczyłaby 64 znaki.
export function loginToEmail(login) {
  const bytes = new TextEncoder().encode(normalizeNick(login).toLowerCase());
  const local = `u${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  return local.length <= 64 ? `${local}@${AUTH.emailDomain}` : null;
}

function isSession(s) {
  return Boolean(s) && typeof s.access_token === 'string' && typeof s.refresh_token === 'string'
    && Number.isFinite(s.expires_at) && typeof s.user?.id === 'string' && typeof s.user?.login === 'string';
}

// Odpowiedź Supabase → zapisywana sesja (login z danych rejestracji)
function toSession(data, now) {
  const session = {
    access_token: data?.access_token,
    refresh_token: data?.refresh_token,
    expires_at: Number.isFinite(data?.expires_at) ? data.expires_at : Math.floor(now() / 1000) + (data?.expires_in ?? 3600),
    user: { id: data?.user?.id, login: data?.user?.user_metadata?.login },
  };
  return isSession(session) ? session : null;
}

export function createAuth({
  url, key, fetchFn = globalThis.fetch?.bind(globalThis), backend = defaultBackend(),
  now = () => Date.now(), timeoutMs = PERSISTENCE.dbTimeoutMs,
} = {}) {
  const enabled = Boolean(url && key && fetchFn);
  const base = String(url ?? '').replace(/\/+$/, '');
  let refreshing = null; // trwające odświeżanie — równoczesne getToken czekają na to samo

  function load() {
    try {
      const s = JSON.parse(backend?.getItem(SESSION_KEY) ?? 'null');
      return isSession(s) ? s : null;
    } catch {
      return null; // uszkodzona sesja — gracz jest gościem
    }
  }

  let session = load();

  function store(next) {
    session = next;
    try {
      backend?.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      // brak dostępu — sesja tylko w pamięci
    }
  }

  const call = (path, body, headers = {}) =>
    requestJson(fetchFn, base + path, { method: 'POST', body, timeoutMs, headers: { apikey: key, ...headers } });

  // Rejestracja / logowanie: zapisuje sesję albo zwraca kod błędu
  async function start(path, body) {
    if (!enabled) return { ok: false, error: 'offline' };
    const res = await call(path, body);
    if (!res.ok) return { ok: false, error: (res.status && ERROR_CODES[res.data?.error_code]) || res.error };
    const next = toSession(res.data, now);
    if (!next) return { ok: false, error: res.data?.id && !res.data?.access_token ? 'potwierdz-email' : 'bad-response' };
    store(next);
    return { ok: true, error: null };
  }

  async function refresh() {
    const current = session;
    const res = await call('/auth/v1/token?grant_type=refresh_token', { refresh_token: current.refresh_token });
    if (session !== current) return session?.access_token ?? null; // w międzyczasie wylogowanie lub nowe logowanie
    const next = res.ok ? toSession(res.data, now) : null;
    if (next) {
      store(next);
      return next.access_token;
    }
    if (res.status >= 400 && res.status < 500) {
      // Serwer odrzucił sesję (np. konto usunięte) — gracz staje się gościem
      store(null);
      auth.onSessionLost?.();
      return null;
    }
    return current.access_token; // brak sieci — sesja zostaje, zapytanie i tak pójdzie jak offline
  }

  const auth = {
    onSessionLost: null,

    get user() {
      return session?.user ?? null;
    },

    signUp(login, password) {
      const email = isValidNick(login) ? loginToEmail(login) : null;
      if (!email) return Promise.resolve({ ok: false, error: 'zly-login' });
      if (String(password ?? '').length < AUTH.passwordMin) return Promise.resolve({ ok: false, error: 'slabe-haslo' });
      return start('/auth/v1/signup', { email, password, data: { login: normalizeNick(login) } });
    },

    signIn(login, password) {
      const email = isValidNick(login) ? loginToEmail(login) : null;
      if (!email) return Promise.resolve({ ok: false, error: 'zle-dane' });
      return start('/auth/v1/token?grant_type=password', { email, password });
    },

    async signOut() {
      const token = session?.access_token;
      store(null);
      refreshing = null;
      if (enabled && token) await call('/auth/v1/logout', undefined, { Authorization: `Bearer ${token}` });
      return { ok: true, error: null };
    },

    // Ważny token zalogowanego gracza (odświeżany, gdy zaraz wygaśnie) albo null
    async getToken() {
      if (!session) return null;
      if (session.expires_at - now() / 1000 > AUTH.refreshMarginS) return session.access_token;
      refreshing ??= refresh().finally(() => { refreshing = null; });
      return refreshing;
    },
  };

  return auth;
}
```

- [ ] **Step 6: Uruchom testy**

Run: `node --test js/tests/auth.test.js js/tests/profile.test.js`
Expected: PASS.

Run: `npm test`
Expected: FAIL tylko w `js/tests/game.test.js` (importuje `createProfile`, które zniknęło) — zastępuje go Task 6. Pozostałe pliki PASS.

- [ ] **Step 7: Commit**

```bash
git add js/auth.js js/profile.js js/tests/auth.test.js js/tests/profile.test.js
git commit -m "Logowanie przez Supabase Auth: rejestracja, sesja, odświeżanie tokenu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Kopie lokalne zapisu osobno na właściciela (`js/storage.js`)

**Files:**
- Modify: `js/storage.js`
- Test: `js/tests/storage.test.js`

**Interfaces:**
- Produces: `loadLocalSave(owner): object | null`, `saveLocalSave(owner, data): boolean`; klucz `arcaneInvaders.savedGame:<owner>` (`owner` = `'gosc'` lub id konta)

- [ ] **Step 1: Zmień testy w `js/tests/storage.test.js`**

W teście `'niedostępny localStorage — gra działa dalej bez rekordów'` zamień dwie linie:

```js
    assert.equal(storage.loadLocalSave('gosc'), null);
    assert.equal(storage.saveLocalSave('gosc', { version: 1 }), false);
```

Zastąp test `'kopia lokalna przerwanej gry: zapis, odczyt, uszkodzone dane'`:

```js
test('kopia lokalna przerwanej gry: zapis, odczyt, uszkodzone dane', () => {
  const backend = mockStorage();
  const storage = createStorage(backend);
  const key = `${SAVED_GAME_KEY}:gosc`;
  assert.equal(storage.loadLocalSave('gosc'), null);
  assert.equal(storage.saveLocalSave('gosc', { version: 1, savedAt: 5, score: 10 }), true);
  assert.deepEqual(storage.loadLocalSave('gosc'), { version: 1, savedAt: 5, score: 10 });
  backend.data[key] = '{zepsute';
  assert.equal(storage.loadLocalSave('gosc'), null);
  backend.data[key] = '42';
  assert.equal(storage.loadLocalSave('gosc'), null);
  backend.data[key] = '[1,2]';
  assert.equal(storage.loadLocalSave('gosc'), null);
});

test('kopie lokalne gościa i kont są rozdzielne', () => {
  const storage = createStorage(mockStorage());
  storage.saveLocalSave('gosc', { score: 1 });
  storage.saveLocalSave('u-1', { score: 2 });
  assert.deepEqual(storage.loadLocalSave('gosc'), { score: 1 });
  assert.deepEqual(storage.loadLocalSave('u-1'), { score: 2 });
  assert.equal(storage.loadLocalSave('u-2'), null);
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/storage.test.js`
Expected: FAIL — `loadLocalSave('u-1')` zwraca kopię gościa (jeden wspólny klucz).

- [ ] **Step 3: Zmień metody w `js/storage.js`**

```js
    // Kopia przerwanej gry — osobna dla gościa ('gosc') i każdego konta (id użytkownika)
    loadLocalSave(owner) {
      const data = readJson(`${SAVED_GAME_KEY}:${owner}`);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    },

    saveLocalSave(owner, data) {
      return writeJson(`${SAVED_GAME_KEY}:${owner}`, data);
    },
```

- [ ] **Step 4: Uruchom testy**

Run: `node --test js/tests/storage.test.js`
Expected: PASS.

Run: `npm test`
Expected: FAIL tylko w `persistence.test.js` (stara warstwa zapisu wywołuje `saveLocalSave(snapshot)` bez właściciela) i `game.test.js` (z Task 2) — oba pliki zastępują Task 4 i Task 6.

- [ ] **Step 5: Commit**

```bash
git add js/storage.js js/tests/storage.test.js
git commit -m "Kopia lokalna przerwanej gry osobno dla gościa i każdego konta

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Warstwa zapisu — tryb zalogowany i gość (`js/persistence.js`)

**Files:**
- Modify: `js/persistence.js` (zastąpić całość)
- Test: `js/tests/persistence.test.js` (zastąpić całość)

**Interfaces:**
- Consumes: `db` z Task 1, `storage.loadLocalSave(owner)/saveLocalSave(owner, …)` z Task 3, `auth.user` z Task 2, `isCompatibleSnapshot`
- Produces:
  - `NOTICE_INCOMPATIBLE`, `GUEST = 'gosc'`
  - `new Persistence({ db, auth, storage, logger, now })`; pola jak dotąd (`saved`, `notice`, `leaderboard`, `history`, `lastResult`); `history.status` może być `'gosc'`, `lastResult.status` może być `'gosc'`
  - metody: `saveNow(snapshot, { keepalive })`, `discard()`, `checkSaved()`, `submitResult({ difficulty, score, wave })`, `flushQueue()`, `refreshLeaderboard(difficulty)`, `refreshHistory()`, `onUserChanged()`, `bestScore(difficulty)`
  - wiersz kolejki: `{ id, userId, difficulty, score, wave }`

- [ ] **Step 1: Zastąp `js/tests/persistence.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Persistence, NOTICE_INCOMPATIBLE, GUEST } from '../persistence.js';
import { createStorage } from '../storage.js';
import { SNAPSHOT_VERSION } from '../snapshot.js';

function mockBackend() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

// Obietnica rozwiązywana ręcznie — sterujemy kolejnością odpowiedzi „z sieci”
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const OK = { ok: true, data: null, error: null };
const NET = { ok: false, data: null, error: 'network' };
const USER = { id: 'u-1', login: 'Joe' };

// Atrapa db: zapisuje wywołania; odpowiedzi z kolejki replies[nazwa] (domyślnie OK)
function fakeDb(replies = {}) {
  const calls = [];
  const names = ['submitScore', 'topScores', 'rankOf', 'myHistory', 'saveGame', 'loadGame', 'deleteGame'];
  const db = Object.fromEntries(names.map((name) => [name, (...args) => {
    calls.push({ name, args });
    const queue = replies[name];
    const reply = queue?.length ? queue.shift() : OK;
    return reply instanceof Promise ? reply : Promise.resolve(reply);
  }]));
  db.calls = calls;
  db.count = (name) => calls.filter((c) => c.name === name).length;
  return db;
}

function setup(replies, { now = () => 1000, user = USER } = {}) {
  const db = fakeDb(replies);
  const storage = createStorage(mockBackend());
  const auth = { user };
  const warnings = [];
  const persistence = new Persistence({ db, storage, auth, logger: { warn: (m) => warnings.push(m) }, now });
  return { db, storage, auth, persistence, warnings };
}

const snap = (savedAt, extra = {}) => ({
  version: SNAPSHOT_VERSION, savedAt, nick: 'Joe', difficulty: 'normalny', score: savedAt, wave: 2, ...extra,
});
const remote = (snapshot) => ({ ok: true, data: { difficulty: snapshot.difficulty, snapshot }, error: null });

// --- Zalogowany gracz ---------------------------------------------------------

test('saveNow: kopia lokalna konta od razu, zapis na konto w tle', async () => {
  const { db, storage, persistence } = setup();
  const done = persistence.saveNow(snap(1));
  assert.deepEqual(storage.loadLocalSave('u-1'), snap(1));
  assert.equal(storage.loadLocalSave(GUEST), null);
  assert.deepEqual(persistence.saved, { difficulty: 'normalny', wave: 2, score: 1, snapshot: snap(1) });
  await done;
  assert.deepEqual(db.calls[0], { name: 'saveGame', args: ['u-1', 'normalny', snap(1), { keepalive: false }] });
});

test('zapis w trakcie poprzedniego: do bazy idzie potem tylko najnowszy', async () => {
  const first = deferred();
  const { db, persistence } = setup({ saveGame: [first.promise] });
  const p1 = persistence.saveNow(snap(1));
  persistence.saveNow(snap(2));
  persistence.saveNow(snap(3));
  assert.equal(db.count('saveGame'), 1);
  first.resolve(OK);
  await p1;
  assert.equal(db.count('saveGame'), 2);
  assert.equal(db.calls[1].args[2].savedAt, 3);
});

test('discard w trakcie zapisu: spóźniony zapis zostaje usunięty z konta', async () => {
  const first = deferred();
  const { db, persistence, storage } = setup({ saveGame: [first.promise] });
  const p1 = persistence.saveNow(snap(1));
  persistence.saveNow(snap(2));
  await persistence.discard();
  assert.equal(persistence.saved, null);
  assert.equal(storage.loadLocalSave('u-1').discarded, true);
  first.resolve(OK);
  await p1;
  assert.equal(db.count('saveGame'), 1);
  assert.deepEqual(db.calls.filter((c) => c.name === 'deleteGame').map((c) => c.args), [['u-1'], ['u-1']]);
});

test('wylogowanie w trakcie zapisu: zapis zostaje na starym koncie, nowy gracz go nie widzi', async () => {
  const first = deferred();
  const { db, persistence, auth } = setup({ saveGame: [first.promise] });
  const p1 = persistence.saveNow(snap(1));
  persistence.saveNow(snap(2)); // czeka w kolejce
  auth.user = null;
  persistence.onUserChanged();
  first.resolve(OK);
  await p1;
  assert.equal(db.count('deleteGame'), 0); // nie sprzątamy zapisu poprzedniego konta
  assert.equal(db.count('saveGame'), 1);   // oczekujący zapis nie trafia nigdzie
  assert.equal(persistence.saved, null);
  await persistence.checkSaved();
  assert.equal(persistence.saved, null);   // gość nie widzi gry konta
});

test('checkSaved: wybiera nowszy zapis — lokalny lub z konta (inne urządzenie)', async () => {
  let s = setup({ loadGame: [remote(snap(5))] });
  s.storage.saveLocalSave('u-1', snap(9));
  await s.persistence.checkSaved();
  assert.equal(s.persistence.saved.snapshot.savedAt, 9);
  assert.deepEqual(s.db.calls[0].args, ['u-1']);
  s = setup({ loadGame: [remote(snap(12))] }); // nowe urządzenie: brak kopii lokalnej
  await s.persistence.checkSaved();
  assert.equal(s.persistence.saved.snapshot.savedAt, 12);
  s = setup({ loadGame: [OK] });
  await s.persistence.checkSaved();
  assert.equal(s.persistence.saved, null);
});

test('checkSaved: baza niedostępna → kopia lokalna konta', async () => {
  const { persistence, storage, warnings } = setup({ loadGame: [NET] });
  storage.saveLocalSave('u-1', snap(4));
  await persistence.checkSaved();
  assert.equal(persistence.saved.score, 4);
  assert.equal(warnings.length, 1);
});

test('checkSaved: gra zakończona offline nie wraca do wznowienia', async () => {
  const { db, persistence, storage } = setup({ deleteGame: [NET], loadGame: [remote(snap(5))] }, { now: () => 50 });
  await persistence.discard();
  assert.deepEqual(storage.loadLocalSave('u-1'), { discarded: true, savedAt: 50 });
  await persistence.checkSaved();
  assert.equal(persistence.saved, null);
  assert.equal(db.count('deleteGame'), 2);
});

test('checkSaved: niezgodna wersja → komunikat i usunięcie', async () => {
  const { db, persistence } = setup({ loadGame: [remote(snap(5, { version: 999 }))] });
  await persistence.checkSaved();
  assert.equal(persistence.saved, null);
  assert.equal(persistence.notice, NOTICE_INCOMPATIBLE);
  assert.equal(db.count('deleteGame'), 1);
});

test('submitResult: wysyła wynik i ustala miejsce w rankingu', async () => {
  const { db, persistence } = setup({ rankOf: [{ ok: true, data: 3, error: null }] });
  const done = persistence.submitResult({ difficulty: 'trudny', score: 900, wave: 4 });
  assert.deepEqual(persistence.lastResult, { status: 'sending', rank: null });
  await done;
  assert.deepEqual(persistence.lastResult, { status: 'ok', rank: 3 });
  const row = db.calls[0].args[0];
  assert.deepEqual({ ...row, id: undefined }, { id: undefined, userId: 'u-1', difficulty: 'trudny', score: 900, wave: 4 });
  assert.equal(typeof row.id, 'string');
  assert.deepEqual(db.calls[1].args, ['trudny', 900]);
});

test('submitResult bez sieci → kolejka offline z kontem', async () => {
  const { persistence, storage } = setup({ submitScore: [NET] });
  await persistence.submitResult({ difficulty: 'latwy', score: 10, wave: 1 });
  assert.deepEqual(persistence.lastResult, { status: 'queued', rank: null });
  const [row] = storage.loadScoreQueue();
  assert.equal(row.userId, 'u-1');
  assert.equal(row.score, 10);
});

test('flushQueue: tylko wiersze bieżącego konta; 401 i sieć zostawiają, 400/422 odrzuca', async () => {
  const unauthorized = { ok: false, data: null, error: 'http-401' };
  const rejected = { ok: false, data: null, error: 'http-422' };
  const { db, persistence, storage } = setup({ submitScore: [OK, rejected, unauthorized] });
  storage.saveScoreQueue([
    { id: 'a', userId: 'u-1', score: 1 },
    { id: 'b', userId: 'u-2', score: 2 },
    { id: 'c', userId: 'u-1', score: 3 },
    { id: 'd', userId: 'u-1', score: 4 },
    { id: 'e', userId: 'u-1', score: 5 },
  ]);
  await persistence.flushQueue();
  assert.deepEqual(db.calls.map((c) => c.args[0].id), ['a', 'c', 'd']);
  assert.deepEqual(storage.loadScoreQueue().map((r) => r.id), ['b', 'd', 'e']);
  await persistence.flushQueue(); // sesja wróciła
  assert.deepEqual(storage.loadScoreQueue().map((r) => r.id), ['b']);
});

test('onUserChanged: czyści stan poprzedniego gracza', () => {
  const { persistence } = setup();
  persistence.saved = { score: 1 };
  persistence.lastResult = { status: 'ok', rank: 1 };
  persistence.history = { status: 'ok', rows: [{ score: 1 }] };
  persistence.onUserChanged();
  assert.equal(persistence.saved, null);
  assert.equal(persistence.lastResult, null);
  assert.deepEqual(persistence.history, { status: 'idle', rows: [] });
});

// --- Gość ---------------------------------------------------------------------

test('gość: zapis i wznawianie tylko lokalnie, bez zapytań do bazy', async () => {
  const { db, persistence, storage } = setup({}, { user: null });
  await persistence.saveNow(snap(7));
  assert.deepEqual(storage.loadLocalSave(GUEST), snap(7));
  persistence.saved = null;
  await persistence.checkSaved();
  assert.equal(persistence.saved.score, 7);
  await persistence.discard();
  assert.equal(storage.loadLocalSave(GUEST).discarded, true);
  assert.equal(db.calls.length, 0);
});

test('gość: wynik nie trafia do bazy ani kolejki; historia niedostępna', async () => {
  const { db, persistence, storage } = setup({}, { user: null });
  storage.saveScoreQueue([{ id: 'a', userId: 'u-1', score: 1 }]);
  await persistence.submitResult({ difficulty: 'latwy', score: 10, wave: 1 });
  await persistence.flushQueue();
  await persistence.refreshHistory();
  assert.deepEqual(persistence.lastResult, { status: 'gosc', rank: null });
  assert.deepEqual(persistence.history, { status: 'gosc', rows: [] });
  assert.equal(storage.loadScoreQueue().length, 1);
  assert.equal(db.calls.length, 0);
});

test('gość widzi ranking', async () => {
  const rows = [{ nick: 'Joe', score: 900 }];
  const { persistence } = setup({ topScores: [{ ok: true, data: rows, error: null }] }, { user: null });
  await persistence.refreshLeaderboard('normalny');
  assert.deepEqual(persistence.leaderboard, { difficulty: 'normalny', status: 'ok', rows });
});

// --- Ranking i historia -------------------------------------------------------

test('refreshLeaderboard: spóźniona odpowiedź dla poprzedniego poziomu jest ignorowana', async () => {
  const slow = deferred();
  const rowsTrudny = [{ nick: 'B', score: 900 }];
  const { persistence } = setup({ topScores: [slow.promise, { ok: true, data: rowsTrudny, error: null }] });
  const p1 = persistence.refreshLeaderboard('latwy');
  await persistence.refreshLeaderboard('trudny');
  slow.resolve({ ok: true, data: [{ nick: 'A', score: 100 }], error: null });
  await p1;
  assert.deepEqual(persistence.leaderboard, { difficulty: 'trudny', status: 'ok', rows: rowsTrudny });
  assert.equal(persistence.bestScore('trudny'), 900);
  assert.equal(persistence.bestScore('latwy'), 0);
});

test('refreshHistory: gry konta; błąd → status error', async () => {
  const rows = [{ nick: 'Joe', score: 5 }];
  const { db, persistence } = setup({ myHistory: [{ ok: true, data: rows, error: null }, NET], topScores: [NET] });
  await persistence.refreshHistory();
  assert.deepEqual(persistence.history, { status: 'ok', rows });
  assert.deepEqual(db.calls[0].args, ['u-1']);
  await persistence.refreshHistory();
  await persistence.refreshLeaderboard('normalny');
  assert.equal(persistence.history.status, 'error');
  assert.equal(persistence.leaderboard.status, 'error');
});

test('ostrzeżenie w konsoli raz na rodzaj błędu', async () => {
  const { persistence, warnings } = setup({ topScores: [NET, NET] });
  await persistence.refreshLeaderboard('normalny');
  await persistence.refreshLeaderboard('normalny');
  assert.equal(warnings.length, 1);
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/persistence.test.js`
Expected: FAIL — m.in. `GUEST` nie jest eksportowany (`undefined`), `saveGame` wywołane z `deviceId` `undefined`.

- [ ] **Step 3: Zastąp całe `js/persistence.js`**

```js
// Spina grę z bazą: zapis i wznawianie przerwanej gry, wysyłanie wyników
// (z kolejką offline), ranking i historia. Zalogowany gracz zapisuje wszystko
// na koncie; gość tylko lokalnie i bez rankingu. Metody są asynchroniczne,
// nie rzucają wyjątków, a wyniki trafiają do pól czytanych przez render —
// pętla gry nigdy nie czeka na sieć.
import { isCompatibleSnapshot } from './snapshot.js';

export const NOTICE_INCOMPATIBLE = 'Zapis niekompatybilny — zaczynamy od nowa';
export const GUEST = 'gosc'; // właściciel lokalnej kopii zapisu gościa

// Baza odrzuca same dane (np. uszkodzony wpis) — takiego wyniku nie ponawiamy.
// 401/403 (wygasła sesja) i błędy sieci zostawiają wynik w kolejce.
const REJECTED = /^http-(400|409|422)$/;

function summarize(snapshot) {
  return { difficulty: snapshot.difficulty, wave: snapshot.wave, score: snapshot.score, snapshot };
}

export class Persistence {
  constructor({ db, auth, storage, logger = console, now = () => Date.now() }) {
    this.db = db;
    this.auth = auth;
    this.storage = storage;
    this.logger = logger;
    this.now = now;

    this.saved = null;        // przerwana gra do wznowienia: { difficulty, wave, score, snapshot }
    this.notice = null;       // jednorazowy komunikat w menu
    this.leaderboard = { difficulty: null, status: 'idle', rows: [] };
    this.history = { status: 'idle', rows: [] };
    this.lastResult = null;   // wynik ostatniej gry: { status: 'sending' | 'ok' | 'queued' | 'gosc', rank }

    this.saving = false;      // trwa zapis do bazy
    this.pendingSave = null;  // najnowszy snapshot czekający na zakończenie zapisu
    this.generation = 0;      // rośnie przy discard() i zmianie gracza — unieważnia zapisy w locie
    this.leaderboardRequest = 0;
    this.historyRequest = 0;
    this.queueSeq = 0;
    this.flushing = false;
    this.warned = new Set();
  }

  get userId() {
    return this.auth.user?.id ?? null;
  }

  // Właściciel kopii lokalnej: konto albo gość
  get owner() {
    return this.userId ?? GUEST;
  }

  // Jedno ostrzeżenie na rodzaj błędu — konsola nie zalewa się przy braku sieci
  warn(kind, error) {
    const key = error === 'offline' ? 'offline' : kind;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const message = error === 'offline'
      ? 'brak konfiguracji Supabase (js/db-config.js) — gra działa offline'
      : `${kind}: ${error} — gra działa dalej`;
    this.logger.warn?.(`[baza] ${message}`);
  }

  // Najlepszy wynik z bazy dla poziomu (gdy ranking tego poziomu jest wczytany)
  bestScore(difficulty) {
    const lb = this.leaderboard;
    return lb.difficulty === difficulty ? (lb.rows[0]?.score ?? 0) : 0;
  }

  // Po zalogowaniu / wylogowaniu: zapominamy stan poprzedniego gracza
  onUserChanged() {
    this.generation++;
    this.pendingSave = null;
    this.saved = null;
    this.lastResult = null;
    this.history = { status: 'idle', rows: [] };
  }

  // --- Przerwana gra ---------------------------------------------------------

  // Kopia lokalna od razu; zalogowany — także na konto w tle. Gdy poprzedni
  // zapis jeszcze trwa, po jego zakończeniu wysyłamy tylko najnowszy snapshot.
  async saveNow(snapshot, { keepalive = false } = {}) {
    this.storage.saveLocalSave(this.owner, snapshot);
    this.saved = summarize(snapshot);
    if (!this.userId) return;
    if (this.saving && !keepalive) {
      this.pendingSave = snapshot;
      return;
    }
    await this.sendSave(snapshot, keepalive);
  }

  async sendSave(snapshot, keepalive) {
    const generation = this.generation;
    const userId = this.userId;
    this.saving = true;
    const res = await this.db.saveGame(userId, snapshot.difficulty, snapshot, { keepalive });
    this.saving = false;
    if (!res.ok) this.warn('zapis gry', res.error);
    if (generation !== this.generation) {
      // Gra się skończyła (ten sam gracz) — sprzątamy zapis, który dotarł za późno.
      // Po wylogowaniu zapis zostaje na koncie poprzedniego gracza.
      if (res.ok && userId === this.userId) await this.db.deleteGame(userId);
      return;
    }
    const next = this.pendingSave;
    this.pendingSave = null;
    if (next) await this.sendSave(next, false);
  }

  // Koniec gry lub nowa gra. Lokalny znacznik „usunięto” wygrywa ze starszym
  // zapisem w bazie, gdyby usunięcie nie dotarło (brak sieci).
  async discard() {
    this.generation++;
    this.pendingSave = null;
    this.saved = null;
    this.storage.saveLocalSave(this.owner, { discarded: true, savedAt: this.now() });
    if (!this.userId) return;
    const res = await this.db.deleteGame(this.userId);
    if (!res.ok) this.warn('usuwanie zapisu', res.error);
  }

  // Czy jest gra do wznowienia: nowszy z zapisów lokalnego i z konta (gość — tylko lokalny)
  async checkSaved() {
    const generation = this.generation;
    const userId = this.userId;
    const local = this.storage.loadLocalSave(this.owner);
    let remote = null;
    if (userId) {
      const res = await this.db.loadGame(userId);
      if (generation !== this.generation) return; // w międzyczasie nowa gra lub inny gracz
      if (!res.ok) this.warn('wczytanie zapisu', res.error);
      remote = res.ok ? (res.data?.snapshot ?? null) : null;
    }
    const newest = [local, remote].filter(Boolean).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null;

    if (!newest || newest.discarded) {
      this.saved = null;
      if (remote) await this.db.deleteGame(userId); // stary zapis, którego wcześniej nie udało się usunąć
      return;
    }
    if (!isCompatibleSnapshot(newest)) {
      this.notice = NOTICE_INCOMPATIBLE;
      await this.discard();
      return;
    }
    this.saved = summarize(newest);
  }

  // --- Wyniki ----------------------------------------------------------------

  async submitResult({ difficulty, score, wave }) {
    if (!this.userId) {
      this.lastResult = { status: 'gosc', rank: null };
      return;
    }
    const row = { id: `${this.now()}-${++this.queueSeq}`, userId: this.userId, difficulty, score, wave };
    const result = { status: 'sending', rank: null };
    this.lastResult = result;
    const res = await this.db.submitScore(row);
    if (!res.ok) {
      this.warn('wysłanie wyniku', res.error);
      this.storage.saveScoreQueue([...this.storage.loadScoreQueue(), row]);
      if (this.lastResult === result) this.lastResult = { status: 'queued', rank: null };
      return;
    }
    const rank = await this.db.rankOf(difficulty, score);
    if (this.lastResult === result) this.lastResult = { status: 'ok', rank: rank.ok ? rank.data : null };
  }

  // Ponowna wysyłka wyników bieżącego konta z kolejki offline (przy wejściu do menu)
  async flushQueue() {
    const userId = this.userId;
    if (this.flushing || !userId) return;
    const mine = this.storage.loadScoreQueue().filter((row) => row.userId === userId);
    if (mine.length === 0) return;
    this.flushing = true;
    const done = new Set();
    for (const row of mine) {
      const res = await this.db.submitScore(row);
      if (!res.ok && !REJECTED.test(res.error)) break; // brak sieci lub sesji — spróbujemy następnym razem
      if (!res.ok) this.warn('odrzucony wynik', res.error);
      done.add(row.id);
    }
    // Kolejkę czytamy ponownie: w trakcie wysyłki mogły dojść nowe wyniki
    if (done.size > 0) this.storage.saveScoreQueue(this.storage.loadScoreQueue().filter((row) => !done.has(row.id)));
    this.flushing = false;
  }

  async refreshLeaderboard(difficulty) {
    const request = ++this.leaderboardRequest;
    const rows = this.leaderboard.difficulty === difficulty ? this.leaderboard.rows : [];
    this.leaderboard = { difficulty, status: 'loading', rows };
    const res = await this.db.topScores(difficulty);
    if (request !== this.leaderboardRequest) return; // w międzyczasie wybrano inny poziom
    if (!res.ok) this.warn('ranking', res.error);
    this.leaderboard = res.ok && Array.isArray(res.data)
      ? { difficulty, status: 'ok', rows: res.data }
      : { difficulty, status: 'error', rows: [] };
  }

  async refreshHistory() {
    const userId = this.userId;
    if (!userId) {
      this.history = { status: 'gosc', rows: [] };
      return;
    }
    const request = ++this.historyRequest;
    this.history = { status: 'loading', rows: this.history.rows };
    const res = await this.db.myHistory(userId);
    if (request !== this.historyRequest) return;
    if (!res.ok) this.warn('historia', res.error);
    this.history = res.ok && Array.isArray(res.data)
      ? { status: 'ok', rows: res.data }
      : { status: 'error', rows: [] };
  }
}
```

- [ ] **Step 4: Uruchom testy**

Run: `node --test js/tests/persistence.test.js`
Expected: PASS. (`npm test`: nadal FAIL tylko `game.test.js` — do Task 6.)

- [ ] **Step 5: Commit**

```bash
git add js/persistence.js js/tests/persistence.test.js
git commit -m "Warstwa zapisu: tryb zalogowany i gość, kolejka wyników na konto

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ekrany — „KTO JEDZIE?”, menu, historia i game over dla gościa (`js/render.js`)

**Files:**
- Modify: `js/render.js`
- Test: `js/tests/render.test.js` (zastąpić całość)

**Interfaces:**
- Consumes (pola `game` czytane przez ekrany): `time, difficultyIndex, difficultyKey, difficulty, savedRecord, score, record, newRecord, playerName, auth.user, logoutArmed, loginForm: { step: 'choice'|'form', choice, mode: 'signin'|'signup', field: 0|1, login, password, busy, error }, persistence.{saved, notice, leaderboard, history, lastResult}` (pola gry dodaje Task 6)
- Produces: z `render.js` — `LOGIN_OPTIONS = ['signin', 'signup', 'guest']`, `drawLogin(ctx, game)`; usunięte `drawNickEntry`; zmienione `drawMenu`, `drawHistory`, `drawGameOver`

- [ ] **Step 1: Zastąp `js/tests/render.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakeContext } from './fake-dom.js';
import { getDifficulty } from '../config.js';

installFakeDom();
const { drawMenu, drawLogin, drawHistory, drawGameOver, formatDate, LOGIN_OPTIONS } = await import('../render.js');

const rows = [{ nick: 'Joe', difficulty: 'normalny', score: 900, wave: 3, created_at: '2026-10-13T10:05:00Z' }];
const form = (extra = {}) => ({ step: 'form', choice: 0, mode: 'signin', field: 0, login: 'Joe', password: 'tajne', busy: false, error: null, ...extra });

function screenGame({ persistence = {}, user = { id: 'u-1', login: 'Joe' }, loginForm = form(), logoutArmed = false } = {}) {
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
    ...['login-zajety', 'zle-dane', 'slabe-haslo', 'zly-login', 'potwierdz-email', 'network', 'http-500'].map((error) => form({ error })),
  ];
  for (const persistence of persistenceVariants) {
    for (const user of [{ id: 'u-1', login: 'Joe' }, null]) {
      for (const loginForm of loginForms) {
        for (const logoutArmed of [false, true]) {
          const game = screenGame({ persistence, user, loginForm, logoutArmed });
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
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/render.test.js`
Expected: FAIL — `LOGIN_OPTIONS` / `drawLogin` niezdefiniowane (`undefined`).

- [ ] **Step 3: Importy i stałe w `js/render.js`**

Zmień import z `config.js`, dopisując `AUTH`:

```js
import {
  WIDTH, HEIGHT, HORIZON_Y, HUD_HEIGHT, WAVE_BANNER_TIME,
  FONT_TITLE, FONT_TEXT, DIFFICULTY_ORDER, DIFFICULTIES, ENEMY_TYPES, POWERUPS, VISUALS, PERSISTENCE, AUTH,
} from './config.js';
```

Zmień komentarz nagłówka:

```js
// Rysowanie tła (pustynia o zachodzie słońca), HUD i ekranów: logowanie, menu,
// historia gier, pauza, game over.
```

Pod stałymi kolorów (`const GOLD = '#ffd700';`) dopisz:

```js
// Ekran „KTO JEDZIE?”: opcje (kolejność = wybór strzałkami) i komunikaty błędów logowania
export const LOGIN_OPTIONS = ['signin', 'signup', 'guest'];
const LOGIN_LABELS = { signin: 'ZALOGUJ', signup: 'ZAREJESTRUJ', guest: 'GRAJ JAKO GOŚĆ' };
const LOGIN_ERRORS = {
  'login-zajety': 'Ten login jest już zajęty',
  'zle-dane': 'Zły login lub hasło',
  'slabe-haslo': `Hasło musi mieć co najmniej ${AUTH.passwordMin} znaków`,
  'zly-login': `Login: 1–${PERSISTENCE.nickMaxLength} znaków, litery, cyfry, spacja, _ -`,
  'potwierdz-email': 'Konto czeka na potwierdzenie e-mail (wyłącz „Confirm email” w Supabase)',
};
const LOGIN_ERROR_OFFLINE = 'Brak połączenia z serwerem — możesz grać jako gość';
```

- [ ] **Step 4: Zmiany w `drawMenu`**

Zastąp linię `text(ctx, \`szeryf: ${game.profile.nick}\`, …)`:

```js
  const who = game.auth.user ? `szeryf: ${game.playerName}` : 'gość — wyniki nie trafiają do rankingu';
  text(ctx, who, rx, 34, { size: 15, font: FONT_TEXT, color: '#f4c27a' });
```

Zastąp blok `if (p.notice) { … } else if (p.saved) { … }`:

```js
  if (p.notice) {
    text(ctx, p.notice, rx, 284, { size: 13, font: FONT_TEXT, color: '#ff8a6a' });
  } else if (game.logoutArmed) {
    text(ctx, 'L ponownie — wyloguj (przerwana gra zostaje na koncie)', rx, 284, { size: 13, font: FONT_TEXT, color: '#ff8a6a' });
  } else if (p.saved) {
    const level = DIFFICULTIES[p.saved.difficulty].label.toLowerCase();
    text(ctx, `C — wznów: ${level}, fala ${p.saved.wave}, $ ${p.saved.score}`, rx, 284, { size: 14, font: FONT_TEXT, color: GOLD });
  }
```

Zastąp tablicę `controls`:

```js
  const controls = [
    '← → / A D — ruch  ·  SPACJA — strzał',
    'P / ESC — pauza  ·  M — dźwięk  ·  ↑ ↓ — poziom',
    game.auth.user ? 'L — wyloguj  ·  H — historia gier' : 'L — zaloguj się lub załóż konto',
  ];
```

- [ ] **Step 5: Zmiany w `drawGameOver`**

Zastąp blok wyboru komunikatu:

```js
  const result = game.persistence.lastResult;
  if (result) {
    let msg = 'Zapisywanie wyniku…';
    if (result.status === 'ok') msg = result.rank ? `Miejsce w rankingu: #${result.rank}` : 'Wynik zapisany w rankingu';
    else if (result.status === 'queued') msg = 'Brak połączenia — wynik wyślemy później';
    else if (result.status === 'gosc') msg = 'Gość — wynik nie trafia do rankingu';
    text(ctx, msg, cx, 500, { size: 18, font: FONT_TEXT, color: GOLD });
  }
```

- [ ] **Step 6: Zastąp `drawNickEntry` funkcją `drawLogin`; zmiany w `drawHistory`**

Usuń całą funkcję `drawNickEntry` i w jej miejscu wstaw:

```js
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
  else if (f.error) status = LOGIN_ERRORS[f.error] ?? LOGIN_ERROR_OFFLINE;
  if (status) text(ctx, status, cx, py + 305, { size: 14, font: FONT_TEXT, color: f.busy ? INK : '#9b1c1c', shadow: false });
  text(ctx, 'TAB — pole     ENTER — wyślij     ESC — wróć', cx, py + ph + 40, { size: 18 });
}
```

W `drawHistory` zastąp linię z `szeryf ${game.profile.nick ?? ''}`:

```js
  text(ctx, `szeryf ${game.playerName}`, cx, 138, { size: 15, font: FONT_TEXT, color: INK, shadow: false });
```

oraz obiekt `messages`:

```js
    const messages = {
      error: 'Historia niedostępna — brak połączenia z bazą',
      ok: 'Brak rozegranych gier',
      gosc: 'Zaloguj się, aby zapisywać wyniki',
    };
```

- [ ] **Step 7: Uruchom testy**

Run: `node --test js/tests/render.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/render.js js/tests/render.test.js
git commit -m "Ekrany: logowanie „KTO JEDZIE?”, menu, historia i game over dla gościa

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Integracja z grą — stan `LOGIN`, wylogowanie, utrata sesji (`js/game.js`, `js/input.js`)

**Files:**
- Modify: `js/game.js`, `js/input.js`
- Test: `js/tests/game.test.js` (zastąpić całość)

**Interfaces:**
- Consumes: `auth` (Task 2: `user`, `signIn`, `signUp`, `signOut`), `persistence.onUserChanged()` i `submitResult({ difficulty, score, wave })` (Task 4), `LOGIN_OPTIONS`, `drawLogin` (Task 5), `AUTH.passwordMax`, `NICK_CHAR`
- Produces:
  - `STATE.LOGIN = 'login'` (zamiast `STATE.NICK`); `NOTICE_SESSION_LOST = 'Sesja wygasła — zaloguj się ponownie'`
  - `new Game({ input, audio, storage, persistence, auth })`
  - `Game`: `loginForm`, `logoutArmed`, `get playerName()`, `resetLogin()`, `submitLogin()`, `onSessionLost()`; bez `nickDraft` / `updateNick`

- [ ] **Step 1: Zastąp `js/tests/game.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { createStorage } from '../storage.js';
import { serializeGame, SNAPSHOT_VERSION } from '../snapshot.js';
import { NOTICE_INCOMPATIBLE } from '../persistence.js';
import { PERSISTENCE } from '../config.js';
import { Player } from '../entities/player.js';

installFakeDom();
const { Game, STATE, NOTICE_SESSION_LOST } = await import('../game.js');

function mockBackend() {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

class FakeInput {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.typed = [];
  }

  isDown(...codes) { return codes.some((c) => this.down.has(c)); }

  wasPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }

  endFrame() {
    this.pressed.clear();
    this.typed = [];
  }
}

// Atrapa logowania: odpowiedź z `next`; udane logowanie ustawia użytkownika
function fakeAuth(user = null) {
  return {
    user,
    calls: [],
    next: { ok: true, error: null },
    onSessionLost: null,
    async signIn(login, password) { this.calls.push(['signIn', login, password]); return this.reply(login); },
    async signUp(login, password) { this.calls.push(['signUp', login, password]); return this.reply(login); },
    reply(login) {
      if (this.next.ok) this.user = { id: 'u-1', login };
      return this.next;
    },
    async signOut() { this.calls.push(['signOut']); this.user = null; return { ok: true, error: null }; },
    async getToken() { return null; },
  };
}

// Atrapa warstwy zapisu: zapisuje wywołania, nic nie wysyła
function persistenceSpy() {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve();
  };
  const names = ['saveNow', 'discard', 'checkSaved', 'flushQueue', 'refreshLeaderboard', 'refreshHistory', 'submitResult', 'onUserChanged'];
  return {
    ...Object.fromEntries(names.map((n) => [n, record(n)])),
    calls,
    saved: null,
    notice: null,
    lastResult: null,
    leaderboard: { difficulty: null, status: 'idle', rows: [] },
    history: { status: 'idle', rows: [] },
    best: 0,
    bestScore() { return this.best; },
    count(name) { return calls.filter((c) => c.name === name).length; },
    last(name) { return calls.filter((c) => c.name === name).at(-1); },
  };
}

function makeGame({ user = { id: 'u-1', login: 'Joe' } } = {}) {
  const auth = fakeAuth(user);
  const persistence = persistenceSpy();
  const audio = {
    muted: false,
    setMuted(m) { this.muted = m; },
    toggleMute() { this.muted = !this.muted; return this.muted; },
    play() {},
  };
  const game = new Game({ input: new FakeInput(), audio, storage: createStorage(mockBackend()), persistence, auth });
  return { game, persistence, auth, audio };
}

// Jedna klatka gry z naciśniętymi klawiszami i wpisanymi znakami
function step(game, { press = [], type = '' } = {}, dt = 1 / 60) {
  game.input.pressed = new Set(press);
  game.input.typed = [...type];
  game.update(dt);
  game.input.endFrame();
}

const flush = () => new Promise((r) => setImmediate(r));

// --- Ekran logowania ----------------------------------------------------------

test('bez sesji: ekran „KTO JEDZIE?”; GRAJ JAKO GOŚĆ → menu', () => {
  const { game, auth, persistence } = makeGame({ user: null });
  assert.equal(game.state, STATE.LOGIN);
  assert.equal(game.loginForm.step, 'choice');
  step(game, { press: ['ArrowDown'] });
  step(game, { press: ['ArrowDown'] });
  assert.equal(game.loginForm.choice, 2);
  step(game, { press: ['Enter'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(game.playerName, 'gość');
  assert.equal(auth.calls.length, 0);
  assert.equal(persistence.count('checkSaved'), 1);
});

test('ZALOGUJ: formularz, litery i spacja trafiają do pól (bez wyciszania), Enter loguje', async () => {
  const { game, auth, audio, persistence } = makeGame({ user: null });
  step(game, { press: ['Enter'] });
  assert.deepEqual([game.loginForm.step, game.loginForm.mode, game.loginForm.field], ['form', 'signin', 0]);
  step(game, { press: ['KeyM'], type: 'Mały Joe;' });
  step(game, { press: ['Tab'] });
  step(game, { press: ['KeyM', 'KeyL', 'KeyH', 'KeyP', 'Space'], type: 'mlhp 1' });
  assert.equal(game.loginForm.login, 'Mały Joe');
  assert.equal(game.loginForm.password, 'mlhp 1');
  assert.equal(audio.muted, false);
  assert.equal(game.state, STATE.LOGIN);
  step(game, { press: ['Enter'] });
  assert.equal(game.loginForm.busy, true);
  step(game, { press: ['Escape'] }); // w trakcie łączenia klawisze są ignorowane
  await flush();
  assert.deepEqual(auth.calls[0], ['signIn', 'Mały Joe', 'mlhp 1']);
  assert.equal(game.state, STATE.MENU);
  assert.equal(game.playerName, 'Mały Joe');
  assert.equal(game.loginForm.password, '');
  assert.equal(persistence.count('onUserChanged'), 1);
});

test('ZAREJESTRUJ → signUp; błąd zostaje w formularzu, Esc wraca do wyboru', async () => {
  const { game, auth } = makeGame({ user: null });
  step(game, { press: ['ArrowDown'] });
  step(game, { press: ['Enter'] });
  assert.equal(game.loginForm.mode, 'signup');
  step(game, { type: 'Joe' });
  step(game, { press: ['ArrowDown'], type: '' });
  step(game, { type: 'tajne123' });
  auth.next = { ok: false, error: 'login-zajety' };
  step(game, { press: ['Enter'] });
  await flush();
  assert.deepEqual(auth.calls[0], ['signUp', 'Joe', 'tajne123']);
  assert.equal(game.state, STATE.LOGIN);
  assert.equal(game.loginForm.error, 'login-zajety');
  assert.equal(game.loginForm.busy, false);
  step(game, { press: ['Escape'] });
  assert.equal(game.loginForm.step, 'choice');
  assert.equal(game.loginForm.choice, 1);
  assert.equal(game.loginForm.error, null);
});

test('formularz: limity długości, Backspace w aktywnym polu', () => {
  const { game } = makeGame({ user: null });
  step(game, { press: ['Enter'] });
  step(game, { type: 'abcdefghijklmnop' });
  assert.equal(game.loginForm.login, 'abcdefghijkl');
  step(game, { press: ['Backspace'] });
  assert.equal(game.loginForm.login, 'abcdefghijk');
  step(game, { press: ['Tab'] });
  step(game, { type: 'x'.repeat(80) });
  assert.equal(game.loginForm.password.length, 72);
  step(game, { press: ['Backspace'] });
  assert.equal(game.loginForm.password.length, 71);
  assert.equal(game.loginForm.login, 'abcdefghijk');
});

// --- Menu: wylogowanie, gość ---------------------------------------------------

test('z sesją start w menu; L wylogowuje', async () => {
  const { game, auth, persistence } = makeGame();
  assert.equal(game.state, STATE.MENU);
  assert.equal(game.playerName, 'Joe');
  step(game, { press: ['KeyL'] });
  await flush();
  assert.deepEqual(auth.calls, [['signOut']]);
  assert.equal(game.state, STATE.LOGIN);
  assert.equal(persistence.count('onUserChanged'), 1);
});

test('L przy przerwanej grze: najpierw ostrzeżenie, wylogowanie dopiero za drugim razem', () => {
  const { game, auth, persistence } = makeGame();
  persistence.saved = { difficulty: 'normalny', wave: 2, score: 10, snapshot: {} };
  step(game, { press: ['KeyL'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(game.logoutArmed, true);
  step(game, { press: ['ArrowDown'] }); // inny klawisz rozbraja
  assert.equal(game.logoutArmed, false);
  step(game, { press: ['KeyL'] });
  step(game, { press: ['KeyL'] });
  assert.equal(game.state, STATE.LOGIN);
  assert.deepEqual(auth.calls, [['signOut']]);
});

test('gość: L otwiera logowanie, H nic nie robi', () => {
  const { game, persistence } = makeGame({ user: null });
  step(game, { press: ['ArrowDown'] });
  step(game, { press: ['ArrowDown'] });
  step(game, { press: ['Enter'] });
  step(game, { press: ['KeyH'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(persistence.count('refreshHistory'), 0);
  step(game, { press: ['KeyL'] });
  assert.equal(game.state, STATE.LOGIN);
  assert.equal(game.loginForm.step, 'choice');
});

test('utrata sesji: gracz staje się gościem, komunikat w menu', () => {
  const { game, persistence, auth } = makeGame();
  step(game, { press: ['KeyH'] });
  assert.equal(game.state, STATE.HISTORY);
  auth.user = null;
  game.onSessionLost();
  assert.equal(game.state, STATE.MENU);
  assert.equal(persistence.notice, NOTICE_SESSION_LOST);
  assert.equal(persistence.count('onUserChanged'), 1);
  assert.equal(game.playerName, 'gość');
});

// --- Rozgrywka (jak dotąd) -----------------------------------------------------

test('menu: zmiana poziomu odświeża ranking, H otwiera historię', () => {
  const { game, persistence } = makeGame();
  step(game, { press: ['ArrowDown'] });
  assert.deepEqual(persistence.last('refreshLeaderboard').args, ['trudny']);
  step(game, { press: ['KeyH'] });
  assert.equal(game.state, STATE.HISTORY);
  assert.equal(persistence.count('refreshHistory'), 1);
  step(game, { press: ['Escape'] });
  assert.equal(game.state, STATE.MENU);
});

test('nowa gra usuwa stary zapis; pauza i ukrycie karty zapisują stan', () => {
  const { game, persistence } = makeGame();
  step(game, { press: ['Enter'] });
  assert.equal(game.state, STATE.PLAYING);
  assert.equal(persistence.count('discard'), 1);
  step(game, { press: ['KeyP'] });
  assert.equal(game.state, STATE.PAUSED);
  const [snapshot, options] = persistence.last('saveNow').args;
  assert.equal(snapshot.version, SNAPSHOT_VERSION);
  assert.equal(snapshot.nick, 'Joe');
  assert.deepEqual(options, { keepalive: false });
  step(game, { press: ['KeyP'] });
  game.pause();
  assert.equal(game.state, STATE.PAUSED);
  assert.equal(persistence.count('saveNow'), 2);
});

test('autozapis co PERSISTENCE.autosaveInterval s gry', () => {
  const { game, persistence } = makeGame();
  step(game, { press: ['Enter'] });
  game.autosaveTimer = PERSISTENCE.autosaveInterval - 0.001;
  step(game);
  assert.equal(persistence.count('saveNow'), 1);
  assert.equal(game.autosaveTimer, 0);
});

test('Enter w pauzie: zapis i powrót do menu', () => {
  const { game, persistence } = makeGame();
  step(game, { press: ['Enter'] });
  step(game, { press: ['KeyP'] });
  step(game, { press: ['Enter'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(persistence.count('saveNow'), 2);
  assert.equal(persistence.count('checkSaved'), 2);
});

test('C w menu wznawia zapisaną grę w pauzie (także gość)', () => {
  const source = makeGame();
  step(source.game, { press: ['Enter'] });
  source.game.score = 777;
  source.game.player.lives = 1;
  const snapshot = serializeGame(source.game, { nick: 'Joe' });
  for (const user of [{ id: 'u-1', login: 'Joe' }, null]) {
    const { game, persistence } = makeGame({ user });
    if (!user) step(game, { press: ['ArrowUp'] }); // na ekranie wyboru: ↑ z ZALOGUJ → GRAJ JAKO GOŚĆ
    if (!user) step(game, { press: ['Enter'] });
    step(game, { press: ['KeyC'] });
    assert.equal(game.state, STATE.MENU); // bez zapisu nic się nie dzieje
    persistence.saved = { difficulty: snapshot.difficulty, wave: snapshot.wave, score: snapshot.score, snapshot };
    step(game, { press: ['KeyC'] });
    assert.equal(game.state, STATE.PAUSED);
    assert.equal(game.score, 777);
    assert.ok(game.player instanceof Player);
    step(game, { press: ['KeyP'] });
    step(game);
  }
});

test('C z niezgodnym zapisem: komunikat, usunięcie, zostajemy w menu', () => {
  const { game, persistence } = makeGame();
  persistence.saved = { difficulty: 'normalny', wave: 3, score: 1, snapshot: { version: 999 } };
  step(game, { press: ['KeyC'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(persistence.notice, NOTICE_INCOMPATIBLE);
  assert.equal(persistence.count('discard'), 1);
});

test('game over: wynik do warstwy zapisu (bez loginu), zapis usunięty; R zaczyna od nowa', () => {
  const { game, persistence } = makeGame();
  step(game, { press: ['Enter'] });
  game.score = 1200;
  game.endGame();
  assert.equal(game.state, STATE.GAMEOVER);
  assert.deepEqual(persistence.last('submitResult').args, [{ difficulty: 'normalny', score: 1200, wave: 1 }]);
  assert.equal(persistence.count('discard'), 2);
  step(game, { press: ['KeyR'] });
  assert.equal(game.state, STATE.PLAYING);
  assert.equal(game.score, 0);
});

test('saveProgress z keepalive (zamknięcie karty) tylko w trakcie gry lub pauzy', () => {
  const { game, persistence } = makeGame();
  game.saveProgress({ keepalive: true });
  assert.equal(persistence.count('saveNow'), 0);
  step(game, { press: ['Enter'] });
  game.saveProgress({ keepalive: true });
  assert.deepEqual(persistence.last('saveNow').args[1], { keepalive: true });
});

test('rekord uwzględnia najlepszy wynik z bazy', () => {
  const { game, persistence } = makeGame();
  persistence.best = 5000;
  assert.equal(game.savedRecord, 5000);
  assert.equal(game.record, 5000);
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/game.test.js`
Expected: FAIL — `STATE.LOGIN` niezdefiniowany (gra startuje w `'nick'`), `NOTICE_SESSION_LOST` niezdefiniowany.

- [ ] **Step 3: `Tab` w `js/input.js`**

```js
const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyP', 'KeyM', 'KeyR', 'Escape', 'Enter', 'NumpadEnter', 'Backspace', 'Tab',
]);
```

- [ ] **Step 4: Zmiany w `js/game.js`**

Importy — zastąp `import { NICK_CHAR } from './profile.js';` i dopisz `AUTH` oraz render:

```js
import {
  WIDTH, HEIGHT, GROUND_Y, WAVE_BANNER_TIME, FORMATION, BOSS, VULTURE, POWERUPS,
  ENEMY_TYPES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, getDifficulty, VISUALS, PERSISTENCE, AUTH,
} from './config.js';
```

```js
import { NICK_CHAR } from './profile.js';
```

(zostaje), a import z `render.js`:

```js
import {
  drawBackground, drawHUD, drawBossBar, drawBanner, drawMenu, drawPause, drawGameOver, drawMuteIndicator,
  drawVignette, drawFlash, drawLogin, drawHistory, LOGIN_OPTIONS,
} from './render.js';
```

Nagłówek i stany:

```js
// Maszyna stanów gry: LOGOWANIE → MENU ⇄ HISTORIA, MENU → GRA ⇄ PAUZA → GAME OVER
// oraz logika rozgrywki (fale, kolizje, punktacja, bonusy) i punkty zapisu gry.
```

```js
export const STATE = {
  LOGIN: 'login', MENU: 'menu', HISTORY: 'history', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover',
};

export const NOTICE_SESSION_LOST = 'Sesja wygasła — zaloguj się ponownie';
```

Konstruktor: zamień sygnaturę i pola gracza:

```js
  constructor({ input, audio, storage, persistence, auth }) {
    this.input = input;
    this.audio = audio;
    this.storage = storage;
    this.persistence = persistence;
    this.auth = auth;
```

i na końcu konstruktora zastąp blok z `nickDraft` / `profile.nick`:

```js
    this.autosaveTimer = 0;   // czas od ostatniego zapisu przerwanej gry
    this.logoutArmed = false; // pierwsze L przy przerwanej grze tylko ostrzega
    this.resetLogin();
    if (auth.user) this.enterMenu();
    else this.state = STATE.LOGIN;
  }
```

Pod getterem `difficulty` dopisz:

```js
  // Login zalogowanego gracza albo „gość”
  get playerName() {
    return this.auth.user?.login ?? 'gość';
  }
```

W `saveProgress` zamień `{ nick: this.profile.nick }` na `{ nick: this.playerName }`.

W `endGame` zamień wywołanie `submitResult`:

```js
    this.persistence.submitResult({ difficulty: this.difficultyKey, score: this.score, wave: this.wave });
```

Pod `resumeGame()` dopisz:

```js
  resetLogin() {
    this.loginForm = { step: 'choice', choice: 0, mode: 'signin', field: 0, login: '', password: '', busy: false, error: null };
  }

  // L w menu: gość → ekran logowania; zalogowany → wylogowanie
  // (przy przerwanej grze dopiero za drugim naciśnięciem L)
  pressLogout(armed) {
    if (this.auth.user && this.persistence.saved && !armed) {
      this.logoutArmed = true;
      return;
    }
    if (this.auth.user) {
      this.auth.signOut();
      this.persistence.onUserChanged();
    }
    this.resetLogin();
    this.state = STATE.LOGIN;
  }

  // Token nie dał się odnowić (np. konto usunięte) — gracz staje się gościem
  onSessionLost() {
    this.persistence.onUserChanged();
    this.persistence.notice = NOTICE_SESSION_LOST;
    if (this.state === STATE.HISTORY) this.state = STATE.MENU;
  }
```

W `update(dt)` — wyciszenie:

```js
    // Na ekranie logowania „m” to litera, nie wyciszenie
    if (this.state !== STATE.LOGIN && input.wasPressed('KeyM')) {
      this.storage.saveMuted(this.audio.toggleMute());
    }
```

W `switch`: zastąp `case STATE.NICK: this.updateNick(); break;` przez:

```js
      case STATE.LOGIN:
        this.updateLogin();
        break;
```

a cały `case STATE.MENU: { … }` przez:

```js
      case STATE.MENU: {
        const armed = this.logoutArmed;
        this.logoutArmed = false;
        const n = DIFFICULTY_ORDER.length;
        const before = this.difficultyIndex;
        if (input.wasPressed('ArrowUp')) this.difficultyIndex = (this.difficultyIndex + n - 1) % n;
        if (input.wasPressed('ArrowDown')) this.difficultyIndex = (this.difficultyIndex + 1) % n;
        if (this.difficultyIndex !== before) this.persistence.refreshLeaderboard(this.difficultyKey);
        if (input.wasPressed('Enter')) this.startGame();
        else if (input.wasPressed('KeyC')) this.resumeGame();
        else if (input.wasPressed('KeyL')) this.pressLogout(armed);
        else if (input.wasPressed('KeyH') && this.auth.user) {
          this.state = STATE.HISTORY;
          this.persistence.refreshHistory();
        }
        break;
      }
```

Zastąp całą metodę `updateNick()` przez:

```js
  // Ekran „KTO JEDZIE?”: wybór zaloguj / zarejestruj / gość, potem formularz
  updateLogin() {
    const input = this.input;
    const f = this.loginForm;
    if (f.busy) return; // czekamy na odpowiedź serwera

    if (f.step === 'choice') {
      const n = LOGIN_OPTIONS.length;
      if (input.wasPressed('ArrowUp')) f.choice = (f.choice + n - 1) % n;
      if (input.wasPressed('ArrowDown')) f.choice = (f.choice + 1) % n;
      if (!input.wasPressed('Enter')) return;
      const option = LOGIN_OPTIONS[f.choice];
      if (option === 'guest') this.enterMenu();
      else Object.assign(f, { step: 'form', mode: option, field: 0, error: null });
      return;
    }

    // Formularz: login (znaki jak w pseudonimie) i hasło (dowolne znaki drukowalne)
    for (const ch of input.typed) {
      if (f.field === 0) {
        if (NICK_CHAR.test(ch) && f.login.length < PERSISTENCE.nickMaxLength) f.login += ch;
      } else if (f.password.length < AUTH.passwordMax) {
        f.password += ch;
      }
    }
    const key = f.field === 0 ? 'login' : 'password';
    if (input.wasPressed('Backspace')) f[key] = f[key].slice(0, -1);
    if (input.wasPressed('Tab', 'ArrowUp', 'ArrowDown')) f.field = 1 - f.field;
    if (input.wasPressed('Escape')) {
      this.resetLogin();
      this.loginForm.choice = LOGIN_OPTIONS.indexOf(f.mode);
    } else if (input.wasPressed('Enter')) {
      this.submitLogin();
    }
  }

  // Wysłanie formularza — wynik przychodzi asynchronicznie, pętla gry nie czeka
  submitLogin() {
    const f = this.loginForm;
    f.busy = true;
    f.error = null;
    const action = f.mode === 'signup' ? this.auth.signUp(f.login, f.password) : this.auth.signIn(f.login, f.password);
    action.then((res) => {
      f.busy = false;
      if (!res.ok) {
        f.error = res.error;
        return;
      }
      this.resetLogin(); // hasło znika z pamięci gry
      this.persistence.onUserChanged();
      this.enterMenu();
    });
  }
```

W `draw(ctx)` zastąp warunek i wybór ekranu:

```js
    if (this.state === STATE.MENU || this.state === STATE.LOGIN || this.state === STATE.HISTORY) {
      this.ambient.draw(ctx);
      drawVignette(ctx);
      if (this.state === STATE.MENU) drawMenu(ctx, this);
      else if (this.state === STATE.LOGIN) drawLogin(ctx, this);
      else drawHistory(ctx, this);
      drawMuteIndicator(ctx, this.audio.muted);
      return;
    }
```

- [ ] **Step 5: Uruchom testy**

Run: `node --test js/tests/game.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS (wszystkie pliki).

- [ ] **Step 6: Commit**

```bash
git add js/input.js js/game.js js/tests/game.test.js
git commit -m "Gra: ekran logowania, wylogowanie, tryb gościa i utrata sesji

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Składanie zależności (`js/main.js`) i test w przeglądarce jako gość

**Files:**
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `createAuth` (Task 2), `createDb({ getToken })` (Task 1), `Persistence({ auth })` (Task 4), `Game({ auth })`, `game.onSessionLost` (Task 6)

- [ ] **Step 1: Zmień `js/main.js`**

Importy — zamień `import { createProfile } from './profile.js';` na:

```js
import { createAuth } from './auth.js';
```

Zamień blok tworzenia zależności:

```js
const storage = createStorage();
const auth = createAuth({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });
const db = createDb({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY, getToken: () => auth.getToken() });
const persistence = new Persistence({ db, auth, storage });
const audio = new SoundFx();
const input = new Input(window, () => audio.init());
const game = new Game({ input, audio, storage, persistence, auth });
auth.onSessionLost = () => game.onSessionLost();
```

- [ ] **Step 2: Uruchom testy**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Test w przeglądarce jako gość (baza jeszcze bez migracji)**

Uruchom `python -m http.server 3000 --bind 127.0.0.1` (w tle). Skopiuj `scratchpad/drive.mjs` do `scratchpad/drive-guest.mjs` i zastąp sekwencję od `await shot('01-nick');` do `await shot('03-menu');` przez:

```js
await shot('01-login');
await key('ArrowDown'); await key('ArrowDown'); await key('Enter'); // GRAJ JAKO GOŚĆ
await sleep(800);
await shot('03-menu');
```

oraz warunek końca gry na: `` `(localStorage.getItem('arcaneInvaders.savedGame:gosc') || '').includes('discarded')` `` z pominięciem pierwszych 5 s (`if (i < 3) continue;`). Run: `node drive-guest.mjs <scratchpad>/guest`.

Expected: zrzuty — ekran „KTO JEDZIE?” z trzema opcjami; menu z „gość — wyniki nie trafiają do rankingu” i „L — zaloguj się lub załóż konto”; po odświeżeniu „C — wznów…”; game over z „Gość — wynik nie trafia do rankingu”; brak czerwonych błędów w konsoli (poza znanym `background.png`, jeśli dotyczy).

- [ ] **Step 4: Commit**

```bash
git add js/main.js
git commit -m "Podłączenie logowania w main.js

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Baza — migracja logowania, test bezpieczeństwa, test end-to-end

**Files:**
- Create: `supabase/migrations/20261013020000_logowanie.sql`

**Interfaces:**
- Consumes: ścieżki REST z Task 1 (`/rest/v1/scores` z ciałem `{difficulty, score, wave}`, `/rest/v1/saved_games?on_conflict=user_id` z `{user_id, difficulty, snapshot, updated_at}`, filtry `user_id=eq.`), dane rejestracji `data.login` z Task 2.

- [ ] **Step 1: Utwórz migrację**

```sql
-- Logowanie: konta Supabase Auth (login + hasło), profil gracza, wyniki i przerwana
-- gra przypięte do konta (RLS po auth.uid()). Tabele są puste — przebudowujemy je
-- bez przenoszenia danych; mechanizm UUID urządzenia i funkcje RPC znikają.

drop function if exists public.save_game(uuid, text, text, jsonb);
drop function if exists public.load_game(uuid);
drop function if exists public.delete_game(uuid);
drop function if exists public.my_history(uuid, integer);
drop table if exists public.saved_games;
drop table if exists public.scores;

-- Profil gracza -----------------------------------------------------------------
create table public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  login       text        not null check (char_length(login) between 1 and 12),
  created_at  timestamptz not null default now()
);

create unique index profiles_login_lower_idx on public.profiles (lower(login));

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;

create policy "profiles_select_all" on public.profiles
  for select to anon, authenticated using (true);

-- Profil zakładany przy rejestracji z loginu w danych rejestracji (data.login)
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, login) values (new.id, new.raw_user_meta_data ->> 'login');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Wyniki zakończonych gier -------------------------------------------------------
create table public.scores (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  nick        text        not null check (char_length(nick) between 1 and 12),
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  score       integer     not null check (score between 0 and 10000000),
  wave        integer     not null check (wave >= 1),
  created_at  timestamptz not null default now()
);

create index scores_ranking_idx on public.scores (difficulty, score desc);
create index scores_history_idx on public.scores (user_id, created_at desc);

-- Pseudonim w rankingu = login autora (wartość z klienta nie ma znaczenia)
create function public.scores_set_nick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.login into new.nick from public.profiles p where p.id = new.user_id;
  return new;
end;
$$;

create trigger scores_set_nick
  before insert on public.scores
  for each row execute function public.scores_set_nick();

revoke execute on function public.scores_set_nick() from public, anon, authenticated;

alter table public.scores enable row level security;

-- Ranking jest publiczny; dopisuje tylko zalogowany i tylko jako on sam
-- (klient może podać wyłącznie poziom, wynik i falę)
revoke all on public.scores from anon, authenticated;
grant select on public.scores to anon, authenticated;
grant insert (difficulty, score, wave) on public.scores to authenticated;

create policy "scores_select_all" on public.scores
  for select to anon, authenticated using (true);

create policy "scores_insert_own" on public.scores
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Przerwana gra (jedna na konto) ---------------------------------------------------
create table public.saved_games (
  user_id     uuid        primary key default auth.uid() references public.profiles (id) on delete cascade,
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  snapshot    jsonb       not null check (octet_length(snapshot::text) < 262144),
  updated_at  timestamptz not null default now()
);

alter table public.saved_games enable row level security;
revoke all on public.saved_games from anon, authenticated;
grant select, insert, update, delete on public.saved_games to authenticated;

create policy "saved_games_select_own" on public.saved_games
  for select to authenticated using (user_id = (select auth.uid()));

create policy "saved_games_insert_own" on public.saved_games
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "saved_games_update_own" on public.saved_games
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "saved_games_delete_own" on public.saved_games
  for delete to authenticated using (user_id = (select auth.uid()));
```

- [ ] **Step 2: Zastosuj migrację i sprawdź strukturę**

`apply_migration` (project `upjsigdipbbjizvtnckl`, name `logowanie`, treść pliku). Potem `execute_sql`:

```sql
select 'table' kind, table_name name from information_schema.tables where table_schema = 'public'
union all select 'func', proname from pg_proc where pronamespace = 'public'::regnamespace
union all select 'trigger', tgname from pg_trigger where tgname in ('on_auth_user_created', 'scores_set_nick')
order by 1, 2;
```

Expected: tabele `profiles`, `saved_games`, `scores`; funkcje `handle_new_user`, `scores_set_nick`; triggery `on_auth_user_created`, `scores_set_nick`; brak `save_game` / `load_game` / `delete_game` / `my_history`.

- [ ] **Step 3: Security advisors**

`get_advisors` (type `security`). Expected: brak ostrzeżeń `anon_security_definer_function_executable` / `rls_disabled`; dopuszczalne tylko ostrzeżenia ogólne projektu (np. ochrona przed wyciekami haseł — opcja planu płatnego). Każde inne ostrzeżenie dotyczące naszych tabel — popraw nową migracją.

- [ ] **Step 4: Test bezpieczeństwa API (Node — poprawne UTF-8)**

Utwórz `scratchpad/security.mjs`:

```js
// Sprawdza RLS po migracji logowania: gość, konto A, konto B.
const U = 'https://upjsigdipbbjizvtnckl.supabase.co';
const K = 'sb_publishable_ee8vqrP3CLEEw_7I1xgvIA_kZ5_SBso';
const H = (token) => ({ apikey: K, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
const hex = (s) => [...new TextEncoder().encode(s.toLowerCase())].map((b) => b.toString(16).padStart(2, '0')).join('');
async function signup(login) {
  const r = await fetch(`${U}/auth/v1/signup`, { method: 'POST', headers: H(), body: JSON.stringify({ email: `u${hex(login)}@bandyci.local`, password: 'tajne123', data: { login } }) });
  const d = await r.json();
  return { token: d.access_token, id: d.user.id };
}
const status = async (path, init = {}) => (await fetch(U + path, init)).status;
const json = async (path, init = {}) => (await fetch(U + path, init)).json();
const post = (token, body, prefer = 'return=minimal') => ({ method: 'POST', headers: { ...H(token), Prefer: prefer }, body: JSON.stringify(body) });
let failed = 0;
const check = (name, got, ok) => { const pass = ok(got); if (!pass) failed++; console.log(pass ? 'OK  ' : 'FAIL', name, JSON.stringify(got)); };

const A = await signup('Test Ąę');
const B = await signup('Test B');
const profile = await json(`/rest/v1/profiles?select=login&id=eq.${A.id}`, { headers: H() });
check('profil A z polskim loginem', profile, (p) => p[0]?.login === 'Test Ąę');
check('gość nie dopisze wyniku', await status('/rest/v1/scores', post(null, { difficulty: 'normalny', score: 1, wave: 1 })), (s) => s === 401 || s === 403);
check('A dopisuje wynik', await status('/rest/v1/scores', post(A.token, { difficulty: 'normalny', score: 100, wave: 2 })), (s) => s === 201);
check('A nie poda cudzego user_id', await status('/rest/v1/scores', post(A.token, { difficulty: 'normalny', score: 5, wave: 1, user_id: B.id })), (s) => s === 401 || s === 403);
check('A nie poda własnego nicku', await status('/rest/v1/scores', post(A.token, { difficulty: 'normalny', score: 5, wave: 1, nick: 'Hacker' })), (s) => s === 401 || s === 403);
const scores = await json(`/rest/v1/scores?select=nick,score,user_id&user_id=eq.${A.id}`, { headers: H() });
check('nick w rankingu = login A', scores, (rows) => rows.length === 1 && rows[0].nick === 'Test Ąę');
check('A nie zmieni wyniku', await status(`/rest/v1/scores?user_id=eq.${A.id}`, { method: 'PATCH', headers: H(A.token), body: JSON.stringify({ score: 999999 }) }), (s) => s === 401 || s === 403);
check('A nie zmieni loginu', await status(`/rest/v1/profiles?id=eq.${A.id}`, { method: 'PATCH', headers: H(A.token), body: JSON.stringify({ login: 'Inny' }) }), (s) => s === 401 || s === 403);

const game = (id, score) => ({ user_id: id, difficulty: 'latwy', snapshot: { version: 1, score }, updated_at: new Date().toISOString() });
const upsert = (token, body) => post(token, body, 'resolution=merge-duplicates,return=minimal');
check('A zapisuje grę', await status('/rest/v1/saved_games?on_conflict=user_id', upsert(A.token, game(A.id, 1))), (s) => s === 201);
check('A nadpisuje grę (upsert)', await status('/rest/v1/saved_games?on_conflict=user_id', upsert(A.token, game(A.id, 2))), (s) => s === 201 || s === 200);
check('B nie zapisze gry jako A', await status('/rest/v1/saved_games?on_conflict=user_id', upsert(B.token, game(A.id, 666))), (s) => s === 401 || s === 403);
check('B nie przeczyta gry A', await json(`/rest/v1/saved_games?user_id=eq.${A.id}`, { headers: H(B.token) }), (rows) => rows.length === 0);
check('gość nie przeczyta gier', await status('/rest/v1/saved_games?select=*', { headers: H() }), (s) => s === 401 || s === 403);
await fetch(`${U}/rest/v1/saved_games?user_id=eq.${A.id}`, { method: 'DELETE', headers: H(B.token) });
check('B nie usunie gry A', await json(`/rest/v1/saved_games?select=snapshot&user_id=eq.${A.id}`, { headers: H(A.token) }), (rows) => rows[0]?.snapshot?.score === 2);
check('A usuwa swoją grę', await status(`/rest/v1/saved_games?user_id=eq.${A.id}`, { method: 'DELETE', headers: H(A.token) }), (s) => s === 204);
console.log(failed ? `NIEUDANE: ${failed}` : 'WSZYSTKO OK');
```

Run: `node security.mjs`
Expected: wszystkie linie `OK`, na końcu `WSZYSTKO OK`.

- [ ] **Step 5: Test end-to-end w przeglądarce (dwa „urządzenia”)**

Skopiuj `scratchpad/drive.mjs` do `scratchpad/drive-login.mjs` z dodatkowym argumentem trybu `signup`/`signin` i ścieżką profilu Chrome; zastąp scenariusz (od `await shot('01-nick');` do końca pętli game over) przez:

```js
const mode = process.argv[4] ?? 'signup';
await shot('01-login');
if (mode === 'signup') await key('ArrowDown'); // ZAREJESTRUJ
await key('Enter');
for (const ch of 'Kowboj Ł') await key(ch);
await key('Tab');
for (const ch of 'tajne123') await key(ch);
await shot('02-form');
await key('Enter');
await sleep(2500);
await shot('03-menu');
if (mode === 'signup') {
  await key('Enter'); await sleep(3500); await key('p'); await sleep(1500); // gra → pauza → zapis na koncie
  await shot('04-pause');
  await key('Enter'); await sleep(1000);                                   // menu
  await key('l'); await key('l'); await sleep(1500);                       // wyloguj (dwa razy — jest przerwana gra)
  await shot('05-after-logout');
} else {
  await key('c'); await sleep(800); await shot('06-resumed-other-device');  // wznowienie z konta
  await key('p');
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const done = await evalJs(`fetch('https://upjsigdipbbjizvtnckl.supabase.co/rest/v1/scores?select=id&nick=eq.' + encodeURIComponent('Kowboj Ł'), { headers: { apikey: 'sb_publishable_ee8vqrP3CLEEw_7I1xgvIA_kZ5_SBso' } }).then(r => r.json()).then(a => a.length > 0)`);
    if (done) break;
  }
  await sleep(1500);
  await shot('07-gameover');
  await key('Enter'); await sleep(1500); await shot('08-menu-top10');
  await key('h'); await sleep(1500); await shot('09-history');
}
console.log('LS:', await ls());
```

Run: `node drive-login.mjs <scratchpad>/dev1 http://127.0.0.1:3000/ signup`, potem `node drive-login.mjs <scratchpad>/dev2 http://127.0.0.1:3000/ signin` (osobny katalog = osobny profil Chrome = „inne urządzenie”).

Expected:
- dev1: formularz z loginem „Kowboj Ł” i hasłem jako `••••••••`; menu „szeryf: Kowboj Ł”; po pauzie i dwóch L — ekran „KTO JEDZIE?”; w `LS` brak hasła (`tajne123` nie występuje).
- dev2: po zalogowaniu „C — wznów: …” widoczne mimo pustego `localStorage`; wznowienie w pauzie; game over „Miejsce w rankingu: #N”; TOP 10 z „Kowboj Ł”; historia z tą grą.
- Konsola obu: brak czerwonych błędów (poza `background.png`, jeśli brak pliku).

- [ ] **Step 6: Usuń dane testowe**

`execute_sql`:

```sql
delete from auth.users where email like '%@bandyci.local';
select (select count(*) from auth.users) users, (select count(*) from public.profiles) profiles,
       (select count(*) from public.scores) scores, (select count(*) from public.saved_games) saved_games;
```

Expected: wszystkie liczniki `0` (kaskada `on delete cascade` usuwa profile, wyniki i zapisy).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261013020000_logowanie.sql
git commit -m "Baza: konta graczy, profil, wyniki i zapis gry na koncie (RLS po auth.uid())

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Aktualizacja `wymagania.md`

**Files:**
- Modify: `wymagania.md`

- [ ] **Step 1: Rozdział 2** — zastąp punkt o Supabase:

```markdown
- **Supabase** (Postgres + Auth) jako baza wyników, przerwanych gier i kont graczy — wyłącznie przez `fetch` do REST API (`/rest/v1`, `/auth/v1`), **bez bibliotek**. Konfiguracja w `js/db-config.js`; bez niej gra działa offline jako gość.
```

- [ ] **Step 2: Rozdział 3** — w drzewie zastąp linie `profile.js` i `db.js`, dopisz `auth.js` i `http.js`:

```
  profile.js        – zasady loginu gracza
  auth.js           – logowanie przez Supabase Auth (login + hasło, sesja, token)
  http.js           – wspólne zapytanie HTTP z JSON-em i limitem czasu
  db.js             – klient REST Supabase (token gracza, tryb offline)
```

- [ ] **Step 3: Rozdział 4.1** — w tabeli sterowania zastąp wiersz `| N | zmiana pseudonimu (w menu) |` wierszami:

```markdown
| L | wylogowanie / logowanie (w menu) |
| Tab | przełączenie pola na ekranie logowania |
```

i wiersz Backspace na:

```markdown
| Backspace | usuwanie znaku na ekranie logowania |
```

- [ ] **Step 4: Rozdział 5** — zastąp punkt 1 i dopisz do punktów 2, 3 i 6:

```markdown
1. **Logowanie „KTO JEDZIE?”** — przy braku zapamiętanej sesji: ZALOGUJ / ZAREJESTRUJ / GRAJ JAKO GOŚĆ; formularz: login (1–12 znaków: litery, cyfry, spacja, `_`, `-`) i hasło (min. 6 znaków, wyświetlane jako `•`); błędy po polsku.
```

W punkcie 2 (Menu) zastąp „pseudonim gracza” na „login gracza albo „gość””, a na końcu dopisz: „L = wyloguj (zalogowany) / zaloguj (gość)”. W punkcie 3 (Historia) dopisz: „— tylko dla zalogowanych”. W punkcie 6 (Game over) dopisz: „; gość: „Gość — wynik nie trafia do rankingu””.

- [ ] **Step 5: Rozdział 7** — zastąp linie `arcaneInvaders.deviceId`, `arcaneInvaders.nick`, `arcaneInvaders.savedGame`:

```markdown
- `arcaneInvaders.session` → sesja Supabase Auth (tokeny i `{ id, login }`; **bez hasła**).
- `arcaneInvaders.savedGame:<właściciel>` → kopia ostatniego zapisu przerwanej gry osobno dla gościa (`gosc`) i każdego konta (albo znacznik `discarded`).
```

i w podrozdziale Supabase zastąp opis tabel:

```markdown
- **Konta:** Supabase Auth, login zamieniany na techniczny e-mail `u<hex loginu>@bandyci.local` (potwierdzanie e-maili wyłączone). Tabela `profiles` (id konta, unikalny login) zakładana triggerem przy rejestracji.
- Tabela `scores` — wynik każdej zakończonej gry zalogowanego gracza: konto, login (wpisywany przez bazę), poziom, wynik, fala, data. Odczyt publiczny; dopisuje tylko zalogowany i tylko jako on sam; zmiana i usuwanie zabronione.
- Tabela `saved_games` — jedna przerwana gra na konto; odczyt, zapis i usuwanie tylko przez właściciela (RLS po `auth.uid()`).
- Gość: wznawianie i rekord tylko lokalnie; wyniki nie trafiają do bazy.
```

- [ ] **Step 6: Rozdział 8** — w liście testów zastąp linię o profilu:

```markdown
  - logowanie (techniczny e-mail, rejestracja, błędy, odświeżanie tokenu, uszkodzona sesja),
  - zasady loginu (walidacja, znaki dozwolone),
```

- [ ] **Step 7: Rozdział 9** — zastąp linię o logowaniu:

```markdown
- Logowanie przez e-mail / Google / GitHub, reset hasła, zmiana loginu i usuwanie konta z gry; walidacja wyników po stronie serwera.
```

- [ ] **Step 8: Commit**

```bash
git add wymagania.md
git commit -m "Wymagania: logowanie graczy (Supabase Auth)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
