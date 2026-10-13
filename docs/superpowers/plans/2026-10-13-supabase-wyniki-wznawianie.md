# Zapis wyników i wznawianie gry (Supabase) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Każda zakończona gra trafia do bazy Supabase (globalny TOP 10 na poziom + osobista historia), a przerwaną grę można wznowić dokładnie od chwili przerwania, także po zamknięciu strony.

**Architecture:** Czysty `fetch` do REST API Supabase (PostgREST) w `js/db.js` — bez bibliotek. `js/snapshot.js` serializuje/odtwarza pełny stan logiczny gry (encje dostają `fromJSON`). `js/persistence.js` spina grę z bazą asynchronicznie (kopia lokalna, kolejka offline, ranking, historia) — pętla gry nigdy nie czeka na sieć. `js/game.js` dostaje nowe stany `NICK` i `HISTORY` oraz punkty zapisu.

**Tech Stack:** JavaScript ES2020+ (ES modules, bez bibliotek), Canvas 2D, `node --test` (Node 24), Supabase (Postgres + PostgREST + RLS + funkcje `security definer`).

**Spec:** `docs/superpowers/specs/2026-10-13-supabase-wyniki-wznawianie-design.md`

## Global Constraints

- Czysty JavaScript, ES modules, **żadnych bibliotek ani skryptów z CDN** — Supabase wyłącznie przez `fetch`.
- Testy: `node --test` (Node 24), pliki `js/tests/*.test.js`; pomocnicze moduły testów bez `.test` w nazwie.
- Komentarze krótkie, po polsku; styl jak w istniejącym kodzie (2 spacje, pojedyncze cudzysłowy, średniki).
- Wszystkie liczby do strojenia w `js/config.js` (nowa sekcja `PERSISTENCE`).
- Klucze `localStorage` z prefiksem `arcaneInvaders.`; każdy dostęp w `try/catch`.
- Poziomy: `'latwy' | 'normalny' | 'trudny'` (`DIFFICULTY_ORDER`).
- Pseudonim: 1–12 znaków po przycięciu spacji; litery (także polskie), cyfry, spacja, `_`, `-`.
- Każda metoda `db` zwraca `{ ok, data, error }` i **nigdy nie rzuca**; timeout 5000 ms.
- `update()` gry nigdy nie czeka na obietnicę (żadnego `await` w pętli gry).
- Błędy sieci tylko jako `console.warn`, raz na rodzaj błędu na sesję; zero nieobsłużonych wyjątków.
- Commity po polsku, zakończone linią `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

**Świadome doprecyzowania względem specyfikacji** (bez zmiany zachowania dla gracza):
- Encje serializują się domyślnym `JSON.stringify` (własne pola) — `toJSON()` ma tylko `Shield` (zapis bloków jako ciąg `0/1`); każda encja dostaje `static fromJSON`.
- `Authorization: Bearer` wysyłamy tylko dla klucza w formacie JWT (`eyJ…`, „anon”); nowy klucz `sb_publishable_…` idzie wyłącznie w nagłówku `apikey`.
- Zamknięcie karty: zdarzenie `pagehide` (pewniejsze niż `beforeunload`).
- `discard()` zostawia lokalny znacznik `{ discarded: true, savedAt }` zamiast czyścić kopię — dzięki temu gra zakończona offline nie wraca jako „do wznowienia”.
- `Persistence.saveNow` przyjmuje gotowy snapshot (gra wywołuje `serializeGame`), żeby moduł był testowalny bez gry.

## Review Focus

1. **Gra otwarta po adresie IP w sieci lokalnej (http, brak bezpiecznego kontekstu)** → `crypto.randomUUID` nie istnieje; identyfikator urządzenia musi powstać z `getRandomValues` / `Math.random`. Test: Task 2 (`randomUuid bez crypto.randomUUID`).
2. **Game over tuż po autozapisie, który jeszcze leci do bazy** → spóźniony zapis nie może „wskrzesić” zakończonej gry. Test: Task 5 (`discard w trakcie zapisu`).
3. **Game over bez sieci, potem sieć wraca** → stary zapis z bazy nie może być proponowany do wznowienia. Test: Task 5 (`gra zakończona offline nie wraca do wznowienia`).
4. **Zapis przy zamykaniu karty nie dotarł do bazy** → wznawiamy nowszą kopię lokalną, nie starszą z bazy. Test: Task 5 (`checkSaved: wybiera nowszy zapis`).
5. **Wpisywanie pseudonimu z literami M/P/C/H/N i polskimi znakami** → litery trafiają do pola, nie przełączają dźwięku ani akcji menu. Test: Task 7 (`pierwsze uruchomienie: ekran pseudonimu…`).

---

## Struktura plików

| Plik | Rola |
|---|---|
| `js/config.js` (zmiana) | sekcja `PERSISTENCE` |
| `js/storage.js` (zmiana) | + kopia lokalna snapshotu, kolejka wyników, eksport `defaultBackend` |
| `js/profile.js` (nowy) | UUID urządzenia, pseudonim, walidacja |
| `js/db.js` (nowy) | klient REST Supabase |
| `js/serial.js` (nowy) | `revive()` — wspólne odtwarzanie encji z JSON |
| `js/entities/*.js` (zmiana) | `static fromJSON`, `Shield.toJSON` |
| `js/snapshot.js` (nowy) | `serializeGame`, `restoreGame`, `isCompatibleSnapshot` |
| `js/persistence.js` (nowy) | zapis/wznawianie, wyniki, kolejka offline, ranking, historia |
| `js/render.js` (zmiana) | ekrany: menu z TOP 10, pseudonim, historia, wynik w rankingu |
| `js/input.js` (zmiana) | bufor wpisanych znaków |
| `js/game.js` (zmiana) | stany `NICK`/`HISTORY`, zapis, wznawianie, wysyłka wyniku |
| `js/main.js` (zmiana) | składanie zależności, `pagehide` |
| `js/db-config.js` (nowy) | URL i klucz Supabase |
| `supabase/migrations/20261013000000_wyniki_i_zapisy.sql` (nowy) | schemat bazy |
| `js/tests/fake-dom.js` (nowy) | atrapa DOM/canvas do testów modułów rysujących |
| `js/tests/{profile,db,snapshot,persistence,render,game}.test.js` (nowe) | testy |
| `wymagania.md` (zmiana) | aktualizacja rozdz. 2, 3, 5, 7, 8, 9 |

---

### Task 1: Konfiguracja i lokalny zapis (snapshot + kolejka wyników)

**Files:**
- Modify: `js/config.js` (dopisać na końcu)
- Modify: `js/storage.js`
- Test: `js/tests/storage.test.js`

**Interfaces:**
- Produces:
  - `PERSISTENCE = { autosaveInterval: 10, dbTimeoutMs: 5000, leaderboardSize: 10, historySize: 10, scoreQueueMax: 20, nickMaxLength: 12 }` z `config.js`
  - z `storage.js`: `export function defaultBackend()`, `SAVED_GAME_KEY = 'arcaneInvaders.savedGame'`, `SCORE_QUEUE_KEY = 'arcaneInvaders.scoreQueue'`
  - metody `createStorage()`: `loadLocalSave(): object | null`, `saveLocalSave(obj): boolean`, `loadScoreQueue(): object[]`, `saveScoreQueue(arr): boolean` (zachowuje najnowsze `scoreQueueMax`)

- [ ] **Step 1: Dopisz testy** na końcu `js/tests/storage.test.js` i rozszerz importy oraz atrapy:

Zmień import na:

```js
import { createStorage, updateHighscore, HIGHSCORES_KEY, MUTED_KEY, SAVED_GAME_KEY, SCORE_QUEUE_KEY } from '../storage.js';
import { PERSISTENCE } from '../config.js';
```

W teście `'niedostępny localStorage — gra działa dalej bez rekordów'` dopisz w pętli (po `saveMuted`):

```js
    assert.equal(storage.loadLocalSave(), null);
    assert.equal(storage.saveLocalSave({ version: 1 }), false);
    assert.deepEqual(storage.loadScoreQueue(), []);
    assert.equal(storage.saveScoreQueue([{ score: 1 }]), false);
```

Na końcu pliku:

```js
test('kopia lokalna przerwanej gry: zapis, odczyt, uszkodzone dane', () => {
  const backend = mockStorage();
  const storage = createStorage(backend);
  assert.equal(storage.loadLocalSave(), null);
  assert.equal(storage.saveLocalSave({ version: 1, savedAt: 5, score: 10 }), true);
  assert.deepEqual(storage.loadLocalSave(), { version: 1, savedAt: 5, score: 10 });
  backend.data[SAVED_GAME_KEY] = '{zepsute';
  assert.equal(storage.loadLocalSave(), null);
  backend.data[SAVED_GAME_KEY] = '42';
  assert.equal(storage.loadLocalSave(), null);
  backend.data[SAVED_GAME_KEY] = '[1,2]';
  assert.equal(storage.loadLocalSave(), null);
});

test('kolejka wyników: zapis, odczyt, limit najnowszych', () => {
  const storage = createStorage(mockStorage());
  assert.deepEqual(storage.loadScoreQueue(), []);
  const rows = Array.from({ length: PERSISTENCE.scoreQueueMax + 5 }, (_, i) => ({ score: i }));
  assert.equal(storage.saveScoreQueue(rows), true);
  const loaded = storage.loadScoreQueue();
  assert.equal(loaded.length, PERSISTENCE.scoreQueueMax);
  assert.equal(loaded[0].score, 5);               // najstarsze odrzucone
  assert.equal(loaded.at(-1).score, rows.length - 1);
});

test('kolejka wyników: uszkodzone dane → pusta lista', () => {
  const storage = createStorage(mockStorage({ [SCORE_QUEUE_KEY]: '{"a":1}' }));
  assert.deepEqual(storage.loadScoreQueue(), []);
});
```

- [ ] **Step 2: Uruchom testy — mają nie przejść**

Run: `node --test js/tests/storage.test.js`
Expected: FAIL — `SAVED_GAME_KEY` / `PERSISTENCE` nie istnieją (SyntaxError przy imporcie).

- [ ] **Step 3: Dopisz `PERSISTENCE` na końcu `js/config.js`**

```js
// Zapis wyników i przerwanej gry (Supabase + kopia w localStorage)
export const PERSISTENCE = {
  autosaveInterval: 10,  // s między automatycznymi zapisami w trakcie gry
  dbTimeoutMs: 5000,     // limit czasu jednego zapytania do bazy
  leaderboardSize: 10,   // TOP N w menu
  historySize: 10,       // ostatnie N gier gracza
  scoreQueueMax: 20,     // maks. niewysłanych wyników w kolejce offline
  nickMaxLength: 12,
};
```

- [ ] **Step 4: Rozszerz `js/storage.js`**

Zmień import i komentarz nagłówka, wyeksportuj `defaultBackend`, dodaj klucze i metody:

```js
// Rekordy, ustawienia, kopia przerwanej gry i kolejka wyników w localStorage.
// Każdy dostęp w try/catch — bez localStorage gra działa dalej, tylko nie pamięta danych.
import { DIFFICULTY_ORDER, PERSISTENCE } from './config.js';

export const HIGHSCORES_KEY = 'arcaneInvaders.highscores';
export const MUTED_KEY = 'arcaneInvaders.muted';
export const SAVED_GAME_KEY = 'arcaneInvaders.savedGame';
export const SCORE_QUEUE_KEY = 'arcaneInvaders.scoreQueue';
```

```js
export function defaultBackend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
```

Wewnątrz `createStorage`, przed `return {`:

```js
  function readJson(key) {
    try {
      const raw = backend?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null; // uszkodzone dane lub brak dostępu
    }
  }

  function writeJson(key, value) {
    try {
      if (!backend) return false;
      backend.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
```

Na końcu zwracanego obiektu (po `saveMuted`):

```js
    // Kopia przerwanej gry — zapasowe źródło wznowienia, gdy baza jest niedostępna
    loadLocalSave() {
      const data = readJson(SAVED_GAME_KEY);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    },

    saveLocalSave(data) {
      return writeJson(SAVED_GAME_KEY, data);
    },

    // Wyniki, których nie udało się wysłać do bazy
    loadScoreQueue() {
      const data = readJson(SCORE_QUEUE_KEY);
      return Array.isArray(data) ? data : [];
    },

    saveScoreQueue(queue) {
      return writeJson(SCORE_QUEUE_KEY, queue.slice(-PERSISTENCE.scoreQueueMax));
    },
```

- [ ] **Step 5: Uruchom wszystkie testy**

Run: `npm test`
Expected: PASS (37 dotychczasowych + 3 nowe).

- [ ] **Step 6: Commit**

```bash
git add js/config.js js/storage.js js/tests/storage.test.js
git commit -m "Lokalna kopia przerwanej gry i kolejka wyników w localStorage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Profil gracza (UUID urządzenia + pseudonim)

**Files:**
- Create: `js/profile.js`
- Test: `js/tests/profile.test.js`

**Interfaces:**
- Consumes: `PERSISTENCE.nickMaxLength`, `defaultBackend()` (Task 1)
- Produces (z `js/profile.js`):
  - `DEVICE_ID_KEY = 'arcaneInvaders.deviceId'`, `NICK_KEY = 'arcaneInvaders.nick'`
  - `NICK_CHAR: RegExp` — test jednego dozwolonego znaku
  - `normalizeNick(raw): string`, `isValidNick(raw): boolean`
  - `randomUuid(cryptoObj = globalThis.crypto): string` (UUID v4)
  - `createProfile(backend = defaultBackend(), uuid = randomUuid)` → `{ deviceId: string (getter), nick: string | null (getter), setNick(raw): boolean }`

- [ ] **Step 1: Napisz testy `js/tests/profile.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProfile, isValidNick, normalizeNick, randomUuid, NICK_CHAR, DEVICE_ID_KEY, NICK_KEY,
} from '../profile.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIXED_ID = '11111111-2222-4333-8444-555555555555';

function mockStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('poprawne i niepoprawne pseudonimy', () => {
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

test('identyfikator urządzenia tworzony raz i pamiętany', () => {
  const backend = mockStorage();
  let calls = 0;
  const uuid = () => { calls++; return FIXED_ID; };
  const first = createProfile(backend, uuid);
  const second = createProfile(backend, uuid);
  assert.equal(first.deviceId, FIXED_ID);
  assert.equal(second.deviceId, FIXED_ID);
  assert.equal(calls, 1);
  assert.equal(backend.data[DEVICE_ID_KEY], FIXED_ID);
});

test('niepoprawny zapisany identyfikator jest zastępowany', () => {
  const profile = createProfile(mockStorage({ [DEVICE_ID_KEY]: 'nie-uuid' }), () => FIXED_ID);
  assert.equal(profile.deviceId, FIXED_ID);
});

test('randomUuid bez crypto.randomUUID (strona po http z adresu IP)', () => {
  const onlyRandomValues = { getRandomValues: (arr) => arr.fill(0xab) };
  assert.match(randomUuid(onlyRandomValues), UUID_V4);
  assert.match(randomUuid(null), UUID_V4); // brak crypto w ogóle
  assert.match(randomUuid(), UUID_V4);     // prawdziwe crypto Node
});

test('pseudonim: zapis po normalizacji, odrzucenie niepoprawnego', () => {
  const backend = mockStorage();
  const profile = createProfile(backend);
  assert.equal(profile.nick, null);
  assert.equal(profile.setNick('  Mały   Joe '), true);
  assert.equal(profile.nick, 'Mały Joe');
  assert.equal(backend.data[NICK_KEY], 'Mały Joe');
  assert.equal(profile.setNick('a;b'), false);
  assert.equal(profile.nick, 'Mały Joe');
  assert.equal(createProfile(backend).nick, 'Mały Joe');
});

test('niedostępny localStorage — profil działa w pamięci', () => {
  for (const backend of [brokenStorage, null]) {
    const profile = createProfile(backend, () => FIXED_ID);
    assert.equal(profile.deviceId, FIXED_ID);
    assert.equal(profile.setNick('Joe'), true);
    assert.equal(profile.nick, 'Joe');
  }
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/profile.test.js`
Expected: FAIL — `Cannot find module '../profile.js'`.

- [ ] **Step 3: Utwórz `js/profile.js`**

```js
// Profil gracza: anonimowy identyfikator urządzenia i pseudonim (localStorage).
// Bez logowania — identyfikator wiąże z urządzeniem przerwaną grę i historię wyników.
import { PERSISTENCE } from './config.js';
import { defaultBackend } from './storage.js';

export const DEVICE_ID_KEY = 'arcaneInvaders.deviceId';
export const NICK_KEY = 'arcaneInvaders.nick';

// Jeden dozwolony znak pseudonimu: litery (także polskie), cyfry, spacja, _ i -
export const NICK_CHAR = /^[\p{L}\d _-]$/u;
const NICK_PATTERN = /^[\p{L}\d _-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeNick(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

export function isValidNick(raw) {
  const nick = normalizeNick(raw);
  return nick.length >= 1 && nick.length <= PERSISTENCE.nickMaxLength && NICK_PATTERN.test(nick);
}

// crypto.randomUUID działa tylko w bezpiecznym kontekście (https / localhost) —
// przy otwarciu gry po adresie IP w sieci lokalnej składamy UUID v4 sami.
export function randomUuid(cryptoObj = globalThis.crypto) {
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoObj?.getRandomValues === 'function') cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // wersja 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // wariant RFC 4122
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createProfile(backend = defaultBackend(), uuid = randomUuid) {
  const read = (key) => {
    try {
      return backend?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      backend?.setItem(key, value);
    } catch {
      // brak dostępu — wartość zostaje tylko w pamięci
    }
  };

  let deviceId = read(DEVICE_ID_KEY);
  if (!deviceId || !UUID_PATTERN.test(deviceId)) {
    deviceId = uuid();
    write(DEVICE_ID_KEY, deviceId);
  }
  const stored = read(NICK_KEY);
  let nick = isValidNick(stored) ? normalizeNick(stored) : null;

  return {
    get deviceId() {
      return deviceId;
    },

    get nick() {
      return nick;
    },

    // Zwraca false (i nic nie zmienia), gdy pseudonim jest niepoprawny
    setNick(raw) {
      if (!isValidNick(raw)) return false;
      nick = normalizeNick(raw);
      write(NICK_KEY, nick);
      return true;
    },
  };
}
```

- [ ] **Step 4: Uruchom testy**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/profile.js js/tests/profile.test.js
git commit -m "Profil gracza: anonimowy identyfikator urządzenia i pseudonim

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Klient bazy Supabase (`js/db.js`)

**Files:**
- Create: `js/db.js`
- Test: `js/tests/db.test.js`

**Interfaces:**
- Consumes: `PERSISTENCE.dbTimeoutMs`, `PERSISTENCE.leaderboardSize`, `PERSISTENCE.historySize`
- Produces (z `js/db.js`):
  - `parseContentRangeTotal(header): number | null`
  - `createDb({ url, key, fetchFn = globalThis.fetch, timeoutMs = 5000 })` → obiekt:
    - `enabled: boolean`
    - `submitScore({ deviceId, nick, difficulty, score, wave })`
    - `topScores(difficulty, limit = 10)` → `data`: `[{ nick, difficulty, score, wave, created_at }]`
    - `rankOf(difficulty, score)` → `data`: `number` (1 = najlepszy)
    - `myHistory(deviceId, limit = 10)` → `data` jak `topScores`
    - `saveGame(deviceId, nick, difficulty, snapshot, { keepalive = false } = {})`
    - `loadGame(deviceId)` → `data`: `{ nick, difficulty, snapshot, updated_at } | null`
    - `deleteGame(deviceId)`
  - Wszystkie metody: `Promise<{ ok: boolean, data, error: string | null }>`, nigdy nie odrzucają. Kody błędów: `'offline'`, `'timeout'`, `'network'`, `'bad-response'`, `'bad-count'`, `'http-<status>'`.

- [ ] **Step 1: Napisz testy `js/tests/db.test.js`**

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

const dbWith = (fetchFn) => createDb({ url: BASE, key: KEY, fetchFn });

test('bez konfiguracji: tryb offline, bez zapytań', async () => {
  const fetchFn = fakeFetch();
  for (const db of [createDb({ url: '', key: KEY, fetchFn }), createDb({ url: BASE, key: '', fetchFn })]) {
    assert.equal(db.enabled, false);
    assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'offline' });
  }
  assert.equal(fetchFn.calls.length, 0);
});

test('submitScore: POST do tabeli scores z mapowaniem pól', async () => {
  const fetchFn = fakeFetch([{ status: 201 }]);
  const res = await dbWith(fetchFn).submitScore({ deviceId: 'dev-1', nick: 'Joe', difficulty: 'trudny', score: 1500, wave: 4 });
  assert.equal(res.ok, true);
  const [call] = fetchFn.calls;
  assert.equal(call.url, `${BASE}/rest/v1/scores`);
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(call.body, { device_id: 'dev-1', nick: 'Joe', difficulty: 'trudny', score: 1500, wave: 4 });
  assert.equal(call.init.headers.apikey, KEY);
  assert.equal(call.init.headers.Prefer, 'return=minimal');
  assert.equal(call.init.headers.Authorization, undefined); // klucz publishable nie jest JWT
});

test('klucz anon (JWT) trafia też do nagłówka Authorization', async () => {
  const fetchFn = fakeFetch([{ body: '[]' }]);
  await createDb({ url: BASE, key: 'eyJhbGciOi.test', fetchFn }).topScores('latwy');
  assert.equal(fetchFn.calls[0].init.headers.Authorization, 'Bearer eyJhbGciOi.test');
});

test('topScores: filtr poziomu, sortowanie, limit', async () => {
  const rows = [{ nick: 'Joe', difficulty: 'trudny', score: 900, wave: 3, created_at: '2026-10-13T10:00:00Z' }];
  const fetchFn = fakeFetch([{ body: JSON.stringify(rows) }]);
  const res = await createDb({ url: `${BASE}/`, key: KEY, fetchFn }).topScores('trudny');
  assert.deepEqual(res.data, rows);
  const url = new URL(fetchFn.calls[0].url);
  assert.equal(url.origin + url.pathname, `${BASE}/rest/v1/scores`); // końcowy „/” adresu się nie podwaja
  assert.equal(url.searchParams.get('difficulty'), 'eq.trudny');
  assert.equal(url.searchParams.get('order'), 'score.desc,created_at.asc');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(fetchFn.calls[0].init.method, 'GET');
});

test('myHistory: filtr urządzenia, najnowsze najpierw', async () => {
  const fetchFn = fakeFetch([{ body: '[]' }]);
  await dbWith(fetchFn).myHistory('dev-1');
  const url = new URL(fetchFn.calls[0].url);
  assert.equal(url.searchParams.get('device_id'), 'eq.dev-1');
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
  assert.equal(url.searchParams.get('difficulty'), 'eq.normalny');
  assert.equal(url.searchParams.get('score'), 'gt.700');
  assert.equal(fetchFn.calls[0].init.headers.Prefer, 'count=exact');
});

test('parseContentRangeTotal', () => {
  assert.equal(parseContentRangeTotal('0-9/120'), 120);
  assert.equal(parseContentRangeTotal('*/0'), 0);
  assert.equal(parseContentRangeTotal('0-0/*'), null);
  assert.equal(parseContentRangeTotal(null), null);
});

test('saveGame / loadGame / deleteGame: wywołania RPC', async () => {
  const saved = { nick: 'Joe', difficulty: 'latwy', snapshot: { version: 1 }, updated_at: '2026-10-13T10:00:00Z' };
  const fetchFn = fakeFetch([{ status: 204 }, { body: JSON.stringify(saved) }, { body: 'null' }, { status: 204 }]);
  const db = dbWith(fetchFn);
  assert.equal((await db.saveGame('dev-1', 'Joe', 'latwy', { version: 1 }, { keepalive: true })).ok, true);
  assert.deepEqual((await db.loadGame('dev-1')).data, saved);
  assert.equal((await db.loadGame('dev-1')).data, null);
  assert.equal((await db.deleteGame('dev-1')).ok, true);
  const [save, load, , del] = fetchFn.calls;
  assert.equal(save.url, `${BASE}/rest/v1/rpc/save_game`);
  assert.equal(save.init.method, 'POST');
  assert.deepEqual(save.body, { p_device_id: 'dev-1', p_nick: 'Joe', p_difficulty: 'latwy', p_snapshot: { version: 1 } });
  assert.equal(save.init.keepalive, true);
  assert.equal(load.url, `${BASE}/rest/v1/rpc/load_game`);
  assert.deepEqual(load.body, { p_device_id: 'dev-1' });
  assert.equal(load.init.keepalive, false);
  assert.equal(del.url, `${BASE}/rest/v1/rpc/delete_game`);
  assert.deepEqual(del.body, { p_device_id: 'dev-1' });
});

test('błędy: HTTP, sieć, zła odpowiedź, timeout — bez wyjątków', async () => {
  const fetchFn = fakeFetch([{ status: 500 }, { throws: new TypeError('Failed to fetch') }, { body: '{zepsuty' }]);
  const db = dbWith(fetchFn);
  assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'http-500' });
  assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'network' });
  assert.deepEqual(await db.topScores('normalny'), { ok: false, data: null, error: 'bad-response' });

  // fetch, który odpowiada dopiero po przerwaniu przez AbortController
  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const slow = createDb({ url: BASE, key: KEY, fetchFn: hanging, timeoutMs: 10 });
  assert.deepEqual(await slow.loadGame('dev-1'), { ok: false, data: null, error: 'timeout' });
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/db.test.js`
Expected: FAIL — `Cannot find module '../db.js'`.

- [ ] **Step 3: Utwórz `js/db.js`**

```js
// Klient bazy Supabase przez REST API (PostgREST) — czysty fetch, bez bibliotek.
// Każda metoda zwraca { ok, data, error } i nigdy nie rzuca wyjątku:
// gra działa dalej także bez sieci i bez konfiguracji (error: 'offline').
import { PERSISTENCE } from './config.js';

const SCORE_COLUMNS = 'nick,difficulty,score,wave,created_at';

function fail(error) {
  return { ok: false, data: null, error };
}

// "0-0/42" albo "*/0" → 42 / 0; brak lub "*" → null
export function parseContentRangeTotal(header) {
  const total = Number(String(header ?? '').split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

// Klucz publishable (sb_publishable_…) idzie tylko w `apikey`;
// starszy klucz anon (JWT) także w Authorization.
function authHeaders(key) {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export function createDb({ url, key, fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = PERSISTENCE.dbTimeoutMs } = {}) {
  const enabled = Boolean(url && key && fetchFn);
  const base = String(url ?? '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
    if (!enabled) return fail('offline');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(base + path, {
        method,
        keepalive,
        signal: controller.signal,
        headers: { ...authHeaders(key), 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) return fail(`http-${res.status}`);
      const text = await res.text();
      return { ok: true, data: text ? JSON.parse(text) : null, error: null, headers: res.headers };
    } catch (e) {
      if (e?.name === 'AbortError') return fail('timeout');
      return fail(e instanceof SyntaxError ? 'bad-response' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  const rpc = (name, args, options = {}) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, ...options });
  const query = (params) => `/rest/v1/scores?${new URLSearchParams(params)}`;

  return {
    enabled,

    submitScore({ deviceId, nick, difficulty, score, wave }) {
      return request('/rest/v1/scores', {
        method: 'POST',
        body: { device_id: deviceId, nick, difficulty, score, wave },
        headers: { Prefer: 'return=minimal' },
      });
    },

    topScores(difficulty, limit = PERSISTENCE.leaderboardSize) {
      return request(query({ select: SCORE_COLUMNS, difficulty: `eq.${difficulty}`, order: 'score.desc,created_at.asc', limit: String(limit) }));
    },

    // Miejsce w rankingu = liczba lepszych wyników + 1 (baza zwraca samą liczbę)
    async rankOf(difficulty, score) {
      const res = await request(
        query({ select: 'id', difficulty: `eq.${difficulty}`, score: `gt.${score}`, limit: '1' }),
        { headers: { Prefer: 'count=exact' } },
      );
      if (!res.ok) return res;
      const total = parseContentRangeTotal(res.headers?.get?.('content-range'));
      return total === null ? fail('bad-count') : { ok: true, data: total + 1, error: null };
    },

    myHistory(deviceId, limit = PERSISTENCE.historySize) {
      return request(query({ select: SCORE_COLUMNS, device_id: `eq.${deviceId}`, order: 'created_at.desc', limit: String(limit) }));
    },

    // keepalive: zapytanie dokończy się także po zamknięciu karty (limit 64 kB treści)
    saveGame(deviceId, nick, difficulty, snapshot, { keepalive = false } = {}) {
      return rpc('save_game', { p_device_id: deviceId, p_nick: nick, p_difficulty: difficulty, p_snapshot: snapshot }, { keepalive });
    },

    loadGame(deviceId) {
      return rpc('load_game', { p_device_id: deviceId });
    },

    deleteGame(deviceId) {
      return rpc('delete_game', { p_device_id: deviceId });
    },
  };
}
```

> Uwaga: w teście `topScores` sprawdzane jest tylko `res.data` — zwracany obiekt ma też pole `headers`, a test trybu offline porównuje dokładnie `{ ok, data, error }` z `fail()`.

- [ ] **Step 4: Uruchom testy**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/db.js js/tests/db.test.js
git commit -m "Klient REST bazy Supabase (fetch, timeout, tryb offline)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Snapshot stanu gry (encje `fromJSON` + `js/snapshot.js`)

**Files:**
- Create: `js/serial.js`, `js/snapshot.js`
- Modify: `js/entities/player.js`, `js/entities/enemies.js`, `js/entities/boss.js`, `js/entities/vulture.js`, `js/entities/bullets.js`, `js/entities/shields.js`, `js/entities/powerups.js`
- Test: `js/tests/snapshot.test.js`

**Interfaces:**
- Produces:
  - `revive(Class, data, numberKeys): instance` z `js/serial.js` — rzuca `Error` przy braku danych / nieliczbowym polu
  - `static fromJSON(data)` w: `Player`, `Formation`, `Boss`, `Vulture`, `Bullet`, `Dynamite`, `PowerUp`, `Shield`; `Shield.prototype.toJSON()` → `{ x, y, alive: '0101…' }`
  - z `js/snapshot.js`: `SNAPSHOT_VERSION = 1`, `serializeGame(game, { nick, savedAt = Date.now() }) → object` (czysty JSON), `isCompatibleSnapshot(data): boolean`, `restoreGame(game, data): boolean`
  - Pola snapshotu: `version, savedAt, nick, difficulty, score, wave, bossCount, time, bannerTimer, vultureTimer, player, formation, boss, vulture, shields, playerBullets, enemyBullets, dynamites, powerups`
  - `restoreGame` ustawia w `game`: `difficultyIndex, score, wave, bossCount, time, bannerTimer, vultureTimer, player, formation, boss, vulture, shields, playerBullets, enemyBullets, dynamites, powerups, explosions = [], newRecord = false, shakeTime = 0, flashTime = 0` i wywołuje `game.effects.clear()`. **Nie** zmienia `game.state`.

- [ ] **Step 1: Napisz testy `js/tests/snapshot.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeGame, restoreGame, isCompatibleSnapshot, SNAPSHOT_VERSION } from '../snapshot.js';
import { getDifficulty, DIFFICULTY_ORDER } from '../config.js';
import { Player } from '../entities/player.js';
import { Formation, enemyRect } from '../entities/enemies.js';
import { Boss } from '../entities/boss.js';
import { Vulture } from '../entities/vulture.js';
import { Bullet, Dynamite } from '../entities/bullets.js';
import { createShields, Shield } from '../entities/shields.js';
import { PowerUp } from '../entities/powerups.js';

// Atrapa gry w „brudnym” stanie: część bandytów i bloków zniszczona, bonusy aktywne
function sampleGame({ withBoss = false } = {}) {
  const difficulty = getDifficulty('trudny');
  const player = new Player(difficulty.lives);
  player.x = 123.5;
  player.applyPowerup('double');
  player.applyPowerup('star');
  player.invuln = 0.7;

  let formation = null;
  let boss = null;
  if (withBoss) {
    boss = new Boss(2, difficulty);
    boss.y = 60;
    boss.hit();
    boss.hit();
  } else {
    formation = new Formation(3, difficulty);
    formation.hitTest(enemyRect(formation, formation.enemies[0]));
    formation.hitTest(enemyRect(formation, formation.enemies[17]));
    formation.x += 31;
    formation.dir = -1;
    formation.shootTimer = 0.42;
  }
  const shields = createShields();
  shields[1].destroyRadius(shields[1].rect.x + 20, shields[1].rect.y + 10, 15);
  const vulture = new Vulture(-1);
  vulture.update(0.5);

  return {
    difficultyKey: 'trudny',
    score: 4321,
    wave: withBoss ? 10 : 3,
    bossCount: withBoss ? 2 : 0,
    time: 87.25,
    bannerTimer: 0,
    vultureTimer: 6.5,
    player,
    formation,
    boss,
    vulture: withBoss ? null : vulture,
    shields,
    playerBullets: [new Bullet(100, 300, 0, -620, 3, 12, 'player')],
    enemyBullets: [new Bullet(200, 250, 30, 240, 4, 10, 'enemy')],
    dynamites: withBoss ? [new Dynamite(300, 200, -40, 170)] : [],
    powerups: [new PowerUp('fast', 400, 300)],
  };
}

// Pusta „gra”, do której odtwarzamy zapis
function blankGame() {
  const game = { effectsCleared: 0 };
  game.effects = { clear: () => { game.effectsCleared++; } };
  return game;
}

// W prawdziwej grze difficultyKey to getter liczony z difficultyIndex
const withKey = (g) => ({ ...g, difficultyKey: DIFFICULTY_ORDER[g.difficultyIndex] });

for (const withBoss of [false, true]) {
  test(`zapis → JSON → odtworzenie daje ten sam stan (${withBoss ? 'boss' : 'formacja'})`, () => {
    const snap = serializeGame(sampleGame({ withBoss }), { nick: 'Joe', savedAt: 1000 });
    const game = blankGame();
    assert.equal(restoreGame(game, JSON.parse(JSON.stringify(snap))), true);
    assert.deepEqual(serializeGame(withKey(game), { nick: 'Joe', savedAt: 1000 }), snap);
    assert.equal(game.effectsCleared, 1);
    assert.deepEqual(game.explosions, []);
    assert.equal(game.shakeTime, 0);
  });
}

test('odtworzone encje mają metody swoich klas', () => {
  const game = blankGame();
  assert.equal(restoreGame(game, serializeGame(sampleGame(), { nick: 'Joe' })), true);
  assert.ok(game.player instanceof Player);
  assert.ok(game.formation instanceof Formation);
  assert.ok(game.vulture instanceof Vulture);
  assert.ok(game.shields.every((s) => s instanceof Shield));
  assert.ok(game.playerBullets[0] instanceof Bullet);
  assert.ok(game.powerups[0] instanceof PowerUp);
  assert.equal(game.formation.alive, 48);
  assert.equal(game.player.maxBullets, 2); // aktywny „Podwójny rewolwer”
  assert.equal(game.player.star, true);
  assert.equal(game.difficultyIndex, DIFFICULTY_ORDER.indexOf('trudny'));
  // osłona z dziurą po wybuchu zostaje z dziurą, pozostałe całe
  const holes = (s) => s.blocks.filter((b) => !b.alive).length;
  assert.ok(holes(game.shields[1]) > 0);
  assert.equal(holes(game.shields[0]), 0);
});

test('zgodność wersji i poziomu', () => {
  const snap = serializeGame(sampleGame(), { nick: 'Joe' });
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(isCompatibleSnapshot(snap), true);
  assert.equal(isCompatibleSnapshot({ ...snap, version: SNAPSHOT_VERSION + 1 }), false);
  assert.equal(isCompatibleSnapshot({ ...snap, difficulty: 'koszmar' }), false);
  assert.equal(isCompatibleSnapshot(null), false);
});

test('uszkodzony zapis → false, gra nietknięta', () => {
  const good = serializeGame(sampleGame(), { nick: 'Joe' });
  const broken = [
    { ...good, version: 999 },
    { ...good, score: null },
    { ...good, player: null },
    { ...good, player: { ...good.player, bonuses: null } },
    { ...good, formation: { ...good.formation, enemies: 'x' } },
    { ...good, formation: { ...good.formation, enemies: [{ row: 0, col: 0, type: 'kowboj', alive: true }] } },
    { ...good, shields: [{ ...good.shields[0], alive: '101' }] },
    { ...good, powerups: [{ ...good.powerups[0], type: 'hack' }] },
    { ...good, enemyBullets: {} },
  ];
  for (const data of broken) {
    const game = blankGame();
    game.score = 5;
    assert.equal(restoreGame(game, data), false);
    assert.equal(game.score, 5);
    assert.equal(game.player, undefined);
    assert.equal(game.effectsCleared, 0);
  }
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `node --test js/tests/snapshot.test.js`
Expected: FAIL — `Cannot find module '../snapshot.js'`.

- [ ] **Step 3: Utwórz `js/serial.js`**

```js
// Odtwarzanie encji z zapisu (JSON). Rzuca wyjątek przy brakującym lub
// nieliczbowym polu — restoreGame łapie go i odrzuca cały zapis.
export function revive(Class, data, numberKeys) {
  if (!data || typeof data !== 'object') throw new Error(`${Class.name}: brak danych`);
  for (const key of numberKeys) {
    if (!Number.isFinite(data[key])) throw new Error(`${Class.name}: niepoprawne pole ${key}`);
  }
  return Object.assign(Object.create(Class.prototype), structuredClone(data));
}
```

- [ ] **Step 4: Dodaj `fromJSON` do encji**

`js/entities/bullets.js` — import na górze i metody w klasach:

```js
import { revive } from '../serial.js';
```

W klasie `Bullet` (po konstruktorze):

```js
  static fromJSON(data) {
    return revive(Bullet, data, ['x', 'y', 'vx', 'vy', 'w', 'h']);
  }
```

W klasie `Dynamite` (po konstruktorze):

```js
  static fromJSON(data) {
    return revive(Dynamite, data, ['x', 'y', 'vx', 'vy', 'w', 'h', 't']);
  }
```

`js/entities/powerups.js` — import i metoda w `PowerUp`:

```js
import { revive } from '../serial.js';
```

```js
  static fromJSON(data) {
    if (!(data?.type in POWERUP_INFO)) throw new Error('PowerUp: nieznany typ');
    return revive(PowerUp, data, ['x', 'y', 'w', 'h', 'speed', 't']);
  }
```

`js/entities/vulture.js`:

```js
import { revive } from '../serial.js';
```

```js
  static fromJSON(data) {
    return revive(Vulture, data, ['dir', 'w', 'h', 'x', 'y', 't']);
  }
```

`js/entities/boss.js`:

```js
import { revive } from '../serial.js';
```

```js
  static fromJSON(data) {
    return revive(Boss, data, [
      'number', 'maxHp', 'hp', 'w', 'h', 'x', 'y', 'dir', 'speed', 'fire', 'fanTimer', 'dynamiteTimer', 'flash', 't',
    ]);
  }
```

`js/entities/player.js`:

```js
import { revive } from '../serial.js';
```

```js
  static fromJSON(data) {
    const bonuses = data?.bonuses;
    if (!Number.isFinite(bonuses?.double) || !Number.isFinite(bonuses?.fast)) throw new Error('Player: niepoprawne bonusy');
    const player = revive(Player, data, ['w', 'h', 'x', 'y', 'lives', 'cooldown', 'invuln', 'golden', 't']);
    player.star = Boolean(player.star);
    return player;
  }
```

`js/entities/enemies.js` — import i metoda w `Formation`:

```js
import { FORMATION, ROW_TYPES, WIDTH, BOSS_EVERY, ENEMY_TYPES } from '../config.js';
import { revive } from '../serial.js';
```

```js
  static fromJSON(data) {
    const enemies = data?.enemies;
    const validEnemy = (e) => Number.isInteger(e?.row) && Number.isInteger(e?.col) && e.type in ENEMY_TYPES && typeof e.alive === 'boolean';
    if (!Array.isArray(enemies) || !enemies.every(validEnemy)) throw new Error('Formation: niepoprawni bandyci');
    const f = revive(Formation, data, [
      'x', 'y', 'dir', 'total', 'waveSpeed', 'difficultySpeed', 'shootInterval', 'shootTimer', 'animTimer', 'frame',
    ]);
    f.alive = f.enemies.filter((e) => e.alive).length; // liczba żywych zawsze zgodna z listą
    return f;
  }
```

`js/entities/shields.js` — w klasie `Shield` (po konstruktorze):

```js
  // Zapis zwięzły: pozycja + stan bloków jako ciąg „0/1” (kształt jest stały)
  toJSON() {
    return { x: this.rect.x, y: this.rect.y, alive: this.blocks.map((b) => (b.alive ? '1' : '0')).join('') };
  }

  static fromJSON(data) {
    if (!Number.isFinite(data?.x) || !Number.isFinite(data?.y)) throw new Error('Shield: niepoprawna pozycja');
    const shield = new Shield(data.x, data.y);
    if (typeof data.alive !== 'string' || data.alive.length !== shield.blocks.length) throw new Error('Shield: niepoprawne bloki');
    shield.blocks.forEach((b, i) => { b.alive = data.alive[i] === '1'; });
    return shield;
  }
```

- [ ] **Step 5: Utwórz `js/snapshot.js`**

```js
// Pełny zapis stanu rozgrywki (wznawianie przerwanej gry) i jego odtwarzanie.
// Zapisujemy tylko stan logiczny; efekty, cząsteczki, wybuchy, wstrząsy i błyski
// są kosmetyczne i po wznowieniu startują od zera.
import { DIFFICULTY_ORDER } from './config.js';
import { Player } from './entities/player.js';
import { Formation } from './entities/enemies.js';
import { Boss } from './entities/boss.js';
import { Vulture } from './entities/vulture.js';
import { Bullet, Dynamite } from './entities/bullets.js';
import { Shield } from './entities/shields.js';
import { PowerUp } from './entities/powerups.js';

// Zmieniamy przy każdej niezgodnej zmianie formatu — starsze zapisy są wtedy odrzucane
export const SNAPSHOT_VERSION = 1;

const GAME_NUMBERS = ['score', 'wave', 'bossCount', 'time', 'bannerTimer', 'vultureTimer'];

export function serializeGame(game, { nick, savedAt = Date.now() } = {}) {
  const data = {
    version: SNAPSHOT_VERSION,
    savedAt,
    nick,
    difficulty: game.difficultyKey,
    score: game.score,
    wave: game.wave,
    bossCount: game.bossCount,
    time: game.time,
    bannerTimer: game.bannerTimer,
    vultureTimer: game.vultureTimer,
    player: game.player,
    formation: game.formation,
    boss: game.boss,
    vulture: game.vulture,
    shields: game.shields,
    playerBullets: game.playerBullets,
    enemyBullets: game.enemyBullets,
    dynamites: game.dynamites,
    powerups: game.powerups,
  };
  // JSON.stringify wywołuje toJSON encji (osłony) i pomija gettery oraz metody
  return JSON.parse(JSON.stringify(data));
}

export function isCompatibleSnapshot(data) {
  return Boolean(data) && typeof data === 'object'
    && data.version === SNAPSHOT_VERSION && DIFFICULTY_ORDER.includes(data.difficulty);
}

function list(items, Class) {
  if (!Array.isArray(items)) throw new Error(`${Class.name}: oczekiwano listy`);
  return items.map((item) => Class.fromJSON(item));
}

// Odtwarza stan w `game`. Wszystko budujemy najpierw na boku — przy błędzie
// zwracamy false, a gra zostaje nietknięta (bez połowicznie wczytanego stanu).
export function restoreGame(game, data) {
  if (!isCompatibleSnapshot(data)) return false;
  let next;
  try {
    for (const key of GAME_NUMBERS) {
      if (!Number.isFinite(data[key])) throw new Error(`niepoprawne pole ${key}`);
    }
    next = {
      difficultyIndex: DIFFICULTY_ORDER.indexOf(data.difficulty),
      score: data.score,
      wave: data.wave,
      bossCount: data.bossCount,
      time: data.time,
      bannerTimer: data.bannerTimer,
      vultureTimer: data.vultureTimer,
      player: Player.fromJSON(data.player),
      formation: data.formation ? Formation.fromJSON(data.formation) : null,
      boss: data.boss ? Boss.fromJSON(data.boss) : null,
      vulture: data.vulture ? Vulture.fromJSON(data.vulture) : null,
      shields: list(data.shields, Shield),
      playerBullets: list(data.playerBullets, Bullet),
      enemyBullets: list(data.enemyBullets, Bullet),
      dynamites: list(data.dynamites, Dynamite),
      powerups: list(data.powerups, PowerUp),
      explosions: [],
      newRecord: false,
      shakeTime: 0,
      flashTime: 0,
    };
  } catch {
    return false;
  }
  Object.assign(game, next);
  game.effects?.clear();
  return true;
}
```

- [ ] **Step 6: Uruchom testy**

Run: `npm test`
Expected: PASS (wszystkie, w tym 6 nowych w `snapshot.test.js`).

- [ ] **Step 7: Commit**

```bash
git add js/serial.js js/snapshot.js js/entities js/tests/snapshot.test.js
git commit -m "Pełny zapis i odtwarzanie stanu gry (snapshot)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Warstwa zapisu (`js/persistence.js`)

**Files:**
- Create: `js/persistence.js`
- Test: `js/tests/persistence.test.js`

**Interfaces:**
- Consumes: `db` z Task 3 (metody i kody błędów), `storage` z Task 1 (`loadLocalSave/saveLocalSave/loadScoreQueue/saveScoreQueue`), `profile.deviceId` z Task 2, `isCompatibleSnapshot` z Task 4.
- Produces (z `js/persistence.js`):
  - `NOTICE_INCOMPATIBLE: string`
  - `class Persistence({ db, profile, storage, logger = console, now = () => Date.now() })`
  - Pola czytane przez grę i render:
    - `saved: { difficulty, wave, score, snapshot } | null`
    - `notice: string | null`
    - `leaderboard: { difficulty: string | null, status: 'idle'|'loading'|'ok'|'error', rows: [] }`
    - `history: { status, rows: [] }`
    - `lastResult: { status: 'sending'|'ok'|'queued', rank: number | null } | null`
  - Metody (asynchroniczne, nigdy nie odrzucają): `saveNow(snapshot, { keepalive = false } = {})`, `discard()`, `checkSaved()`, `submitResult({ nick, difficulty, score, wave })`, `flushQueue()`, `refreshLeaderboard(difficulty)`, `refreshHistory()`
  - Synchroniczna: `bestScore(difficulty): number`

- [ ] **Step 1: Napisz testy `js/tests/persistence.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Persistence, NOTICE_INCOMPATIBLE } from '../persistence.js';
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

function setup(replies, { now = () => 1000 } = {}) {
  const db = fakeDb(replies);
  const storage = createStorage(mockBackend());
  const warnings = [];
  const persistence = new Persistence({
    db, storage, profile: { deviceId: 'dev-1' }, logger: { warn: (m) => warnings.push(m) }, now,
  });
  return { db, storage, persistence, warnings };
}

const snap = (savedAt, extra = {}) => ({
  version: SNAPSHOT_VERSION, savedAt, nick: 'Joe', difficulty: 'normalny', score: savedAt, wave: 2, ...extra,
});
const remote = (snapshot) => ({ ok: true, data: { snapshot }, error: null });

test('saveNow: kopia lokalna od razu, zapis do bazy w tle', async () => {
  const { db, storage, persistence } = setup();
  const done = persistence.saveNow(snap(1));
  assert.deepEqual(storage.loadLocalSave(), snap(1));
  assert.deepEqual(persistence.saved, { difficulty: 'normalny', wave: 2, score: 1, snapshot: snap(1) });
  await done;
  assert.deepEqual(db.calls[0], { name: 'saveGame', args: ['dev-1', 'Joe', 'normalny', snap(1), { keepalive: false }] });
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
  assert.equal(db.calls[1].args[3].savedAt, 3);
});

test('discard w trakcie zapisu: spóźniony zapis zostaje usunięty z bazy', async () => {
  const first = deferred();
  const { db, persistence, storage } = setup({ saveGame: [first.promise] });
  const p1 = persistence.saveNow(snap(1));
  persistence.saveNow(snap(2)); // czeka na swoją kolej
  await persistence.discard();
  assert.equal(persistence.saved, null);
  assert.equal(storage.loadLocalSave().discarded, true);
  first.resolve(OK);
  await p1;
  assert.equal(db.count('saveGame'), 1);   // oczekujący zapis porzucony
  assert.equal(db.count('deleteGame'), 2); // discard + sprzątanie po spóźnionym zapisie
});

test('checkSaved: wybiera nowszy zapis — lokalny lub z bazy', async () => {
  // lokalny nowszy (np. zapis przy zamykaniu karty nie dotarł do bazy)
  let s = setup({ loadGame: [remote(snap(5))] });
  s.storage.saveLocalSave(snap(9));
  await s.persistence.checkSaved();
  assert.equal(s.persistence.saved.snapshot.savedAt, 9);
  // nowszy w bazie
  s = setup({ loadGame: [remote(snap(12))] });
  s.storage.saveLocalSave(snap(9));
  await s.persistence.checkSaved();
  assert.equal(s.persistence.saved.snapshot.savedAt, 12);
  // brak zapisów
  s = setup({ loadGame: [OK] });
  await s.persistence.checkSaved();
  assert.equal(s.persistence.saved, null);
});

test('checkSaved: baza niedostępna → kopia lokalna', async () => {
  const { persistence, storage, warnings } = setup({ loadGame: [NET] });
  storage.saveLocalSave(snap(4));
  await persistence.checkSaved();
  assert.equal(persistence.saved.score, 4);
  assert.equal(warnings.length, 1);
});

test('checkSaved: gra zakończona offline nie wraca do wznowienia', async () => {
  // discard nie dotarł do bazy, ale zostawił lokalny znacznik nowszy niż zapis w bazie
  const { db, persistence, storage } = setup({ deleteGame: [NET], loadGame: [remote(snap(5))] }, { now: () => 50 });
  await persistence.discard();
  assert.deepEqual(storage.loadLocalSave(), { discarded: true, savedAt: 50 });
  await persistence.checkSaved();
  assert.equal(persistence.saved, null);
  assert.equal(db.count('deleteGame'), 2); // ponowna próba usunięcia starego zapisu
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
  const done = persistence.submitResult({ nick: 'Joe', difficulty: 'trudny', score: 900, wave: 4 });
  assert.deepEqual(persistence.lastResult, { status: 'sending', rank: null });
  await done;
  assert.deepEqual(persistence.lastResult, { status: 'ok', rank: 3 });
  assert.deepEqual(db.calls[0].args[0], { deviceId: 'dev-1', nick: 'Joe', difficulty: 'trudny', score: 900, wave: 4 });
  assert.deepEqual(db.calls[1].args, ['trudny', 900]);
});

test('submitResult bez sieci → kolejka offline', async () => {
  const { persistence, storage } = setup({ submitScore: [NET] });
  await persistence.submitResult({ nick: 'Joe', difficulty: 'latwy', score: 10, wave: 1 });
  assert.deepEqual(persistence.lastResult, { status: 'queued', rank: null });
  assert.deepEqual(storage.loadScoreQueue(), [{ deviceId: 'dev-1', nick: 'Joe', difficulty: 'latwy', score: 10, wave: 1 }]);
});

test('flushQueue: po kolei, przy braku sieci zostawia resztę, odrzuca błędne (4xx)', async () => {
  const { db, persistence, storage } = setup({ submitScore: [OK, { ok: false, data: null, error: 'http-400' }, NET] });
  storage.saveScoreQueue([{ score: 1 }, { score: 2 }, { score: 3 }, { score: 4 }]);
  await persistence.flushQueue();
  assert.equal(db.count('submitScore'), 3);
  assert.deepEqual(storage.loadScoreQueue(), [{ score: 3 }, { score: 4 }]);
  await persistence.flushQueue(); // sieć wróciła
  assert.deepEqual(storage.loadScoreQueue(), []);
});

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

test('refreshHistory: ostatnie gry tego urządzenia; błąd → status error', async () => {
  const rows = [{ nick: 'Joe', score: 5 }];
  const { db, persistence } = setup({ myHistory: [{ ok: true, data: rows, error: null }, NET], topScores: [NET] });
  await persistence.refreshHistory();
  assert.deepEqual(persistence.history, { status: 'ok', rows });
  assert.deepEqual(db.calls[0].args, ['dev-1']);
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
Expected: FAIL — `Cannot find module '../persistence.js'`.

- [ ] **Step 3: Utwórz `js/persistence.js`**

```js
// Spina grę z bazą: zapis i wznawianie przerwanej gry, wysyłanie wyników
// (z kolejką offline), ranking i historia. Metody są asynchroniczne, nie rzucają
// wyjątków, a wyniki trafiają do pól czytanych przez render — pętla gry nigdy
// nie czeka na sieć.
import { isCompatibleSnapshot } from './snapshot.js';

export const NOTICE_INCOMPATIBLE = 'Zapis niekompatybilny — zaczynamy od nowa';

function summarize(snapshot) {
  return { difficulty: snapshot.difficulty, wave: snapshot.wave, score: snapshot.score, snapshot };
}

export class Persistence {
  constructor({ db, profile, storage, logger = console, now = () => Date.now() }) {
    this.db = db;
    this.profile = profile;
    this.storage = storage;
    this.logger = logger;
    this.now = now;

    this.saved = null;        // przerwana gra do wznowienia: { difficulty, wave, score, snapshot }
    this.notice = null;       // jednorazowy komunikat w menu
    this.leaderboard = { difficulty: null, status: 'idle', rows: [] };
    this.history = { status: 'idle', rows: [] };
    this.lastResult = null;   // wynik ostatniej gry: { status: 'sending' | 'ok' | 'queued', rank }

    this.saving = false;      // trwa zapis do bazy
    this.pendingSave = null;  // najnowszy snapshot czekający na zakończenie zapisu
    this.generation = 0;      // rośnie przy discard() — unieważnia zapisy w locie
    this.leaderboardRequest = 0;
    this.historyRequest = 0;
    this.flushing = false;
    this.warned = new Set();
  }

  get deviceId() {
    return this.profile.deviceId;
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

  // --- Przerwana gra ---------------------------------------------------------

  // Kopia lokalna od razu, do bazy w tle. Gdy poprzedni zapis jeszcze trwa,
  // po jego zakończeniu wysyłamy tylko najnowszy snapshot.
  async saveNow(snapshot, { keepalive = false } = {}) {
    this.storage.saveLocalSave(snapshot);
    this.saved = summarize(snapshot);
    if (this.saving && !keepalive) {
      this.pendingSave = snapshot;
      return;
    }
    await this.sendSave(snapshot, keepalive);
  }

  async sendSave(snapshot, keepalive) {
    const generation = this.generation;
    this.saving = true;
    const res = await this.db.saveGame(this.deviceId, snapshot.nick, snapshot.difficulty, snapshot, { keepalive });
    this.saving = false;
    if (!res.ok) this.warn('zapis gry', res.error);
    if (generation !== this.generation) {
      // W międzyczasie gra się skończyła — sprzątamy zapis, który dotarł za późno
      if (res.ok) await this.db.deleteGame(this.deviceId);
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
    this.storage.saveLocalSave({ discarded: true, savedAt: this.now() });
    const res = await this.db.deleteGame(this.deviceId);
    if (!res.ok) this.warn('usuwanie zapisu', res.error);
  }

  // Sprawdza, czy jest gra do wznowienia: nowszy z zapisów lokalnego i z bazy
  async checkSaved() {
    const generation = this.generation;
    const local = this.storage.loadLocalSave();
    const res = await this.db.loadGame(this.deviceId);
    if (generation !== this.generation) return; // w międzyczasie zaczęła się nowa gra
    if (!res.ok) this.warn('wczytanie zapisu', res.error);
    const remote = res.ok ? (res.data?.snapshot ?? null) : null;
    const newest = [local, remote].filter(Boolean).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0] ?? null;

    if (!newest || newest.discarded) {
      this.saved = null;
      if (remote) await this.db.deleteGame(this.deviceId); // stary zapis, którego wcześniej nie udało się usunąć
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

  async submitResult({ nick, difficulty, score, wave }) {
    const row = { deviceId: this.deviceId, nick, difficulty, score, wave };
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

  // Ponowna wysyłka wyników z kolejki offline (przy wejściu do menu)
  async flushQueue() {
    if (this.flushing) return;
    const queue = this.storage.loadScoreQueue();
    if (queue.length === 0) return;
    this.flushing = true;
    let done = 0;
    for (const row of queue) {
      const res = await this.db.submitScore(row);
      // Błąd 4xx = baza odrzuca dane (np. uszkodzony wpis) — porzucamy go zamiast blokować kolejkę
      if (!res.ok && !/^http-4/.test(res.error)) break;
      done++;
    }
    // Kolejkę czytamy ponownie: w trakcie wysyłki mogły dojść nowe wyniki
    if (done > 0) this.storage.saveScoreQueue(this.storage.loadScoreQueue().slice(done));
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
    const request = ++this.historyRequest;
    this.history = { status: 'loading', rows: this.history.rows };
    const res = await this.db.myHistory(this.deviceId);
    if (request !== this.historyRequest) return;
    if (!res.ok) this.warn('historia', res.error);
    this.history = res.ok && Array.isArray(res.data)
      ? { status: 'ok', rows: res.data }
      : { status: 'error', rows: [] };
  }
}
```

- [ ] **Step 4: Uruchom testy**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/persistence.js js/tests/persistence.test.js
git commit -m "Warstwa zapisu: przerwana gra, wyniki z kolejką offline, ranking i historia

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Ekrany — menu z TOP 10, pseudonim, historia, miejsce w rankingu

**Files:**
- Create: `js/tests/fake-dom.js`
- Modify: `js/render.js` (importy, `drawMenu`, `drawGameOver`; nowe `drawNickEntry`, `drawHistory`, `formatDate`, `drawLeaderboard`)
- Test: `js/tests/render.test.js`

**Interfaces:**
- Consumes (pola obiektu `game` czytane przez ekrany): `time, difficultyIndex, difficultyKey, difficulty, savedRecord, score, record, newRecord, nickDraft, profile.nick, persistence.{saved, notice, leaderboard, history, lastResult}` (Task 5; `savedRecord` i `nickDraft` dodaje Task 7).
- Produces: z `js/render.js` — `drawNickEntry(ctx, game)`, `drawHistory(ctx, game)`, `formatDate(iso): string`; zmienione `drawMenu`, `drawGameOver`. Z `js/tests/fake-dom.js` — `installFakeDom()`, `fakeContext`.

- [ ] **Step 1: Utwórz `js/tests/fake-dom.js`**

```js
// Minimalna atrapa DOM i canvasu, żeby moduły rysujące dało się zaimportować
// i wywołać w Node. Każda właściwość kontekstu to „pusta” funkcja zwracająca
// tę samą atrapę (np. gradient z addColorStop); w działaniach liczbowych daje 0.
export const fakeContext = new Proxy(function () {}, {
  get: (target, prop) => {
    if (prop === Symbol.toPrimitive) return () => 0;
    if (prop === 'then') return undefined; // nie udajemy obietnicy
    return fakeContext;
  },
  set: () => true,
  apply: () => fakeContext,
});

export function installFakeDom() {
  globalThis.document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext }),
  };
  globalThis.Image ??= class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
      this.src = '';
    }
  };
}
```

- [ ] **Step 2: Napisz testy `js/tests/render.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fakeContext } from './fake-dom.js';
import { getDifficulty } from '../config.js';

installFakeDom();
const { drawMenu, drawNickEntry, drawHistory, drawGameOver, formatDate } = await import('../render.js');

const rows = [{ nick: 'Joe', difficulty: 'normalny', score: 900, wave: 3, created_at: '2026-10-13T10:05:00Z' }];

function screenGame(persistence = {}, profile = { nick: 'Joe' }) {
  return {
    time: 1.3,
    difficultyIndex: 1,
    difficultyKey: 'normalny',
    difficulty: getDifficulty('normalny'),
    savedRecord: 100,
    score: 50,
    record: 100,
    newRecord: false,
    nickDraft: 'Jo',
    profile,
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

test('ekrany rysują się we wszystkich stanach danych', () => {
  const variants = [
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
      notice: 'Zapis niekompatybilny',
      lastResult: { status: 'queued', rank: null },
    },
    {
      leaderboard: { difficulty: 'normalny', status: 'ok', rows: [] },
      history: { status: 'ok', rows: [] },
      lastResult: { status: 'sending', rank: null },
    },
  ];
  for (const v of variants) {
    for (const profile of [{ nick: 'Joe' }, { nick: null }]) {
      const game = screenGame(v, profile);
      for (const draw of [drawMenu, drawNickEntry, drawHistory, drawGameOver]) {
        assert.doesNotThrow(() => draw(fakeContext, game), draw.name);
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

- [ ] **Step 3: Uruchom — ma nie przejść**

Run: `node --test js/tests/render.test.js`
Expected: FAIL — `drawNickEntry` / `formatDate` nie są eksportowane (`SyntaxError: ... does not provide an export named`).

- [ ] **Step 4: Zmień importy w `js/render.js`**

```js
// Rysowanie tła (pustynia o zachodzie słońca), HUD i ekranów: menu, pseudonim,
// historia gier, pauza, game over.
import {
  WIDTH, HEIGHT, HORIZON_Y, HUD_HEIGHT, WAVE_BANNER_TIME,
  FONT_TITLE, FONT_TEXT, DIFFICULTY_ORDER, DIFFICULTIES, ENEMY_TYPES, POWERUPS, VISUALS, PERSISTENCE,
} from './config.js';
```

- [ ] **Step 5: Zastąp całą funkcję `drawMenu` w `js/render.js`**

```js
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
  text(ctx, `szeryf: ${game.profile.nick}`, rx, 34, { size: 15, font: FONT_TEXT, color: '#f4c27a' });
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
  } else if (p.saved) {
    const level = DIFFICULTIES[p.saved.difficulty].label.toLowerCase();
    text(ctx, `C — wznów: ${level}, fala ${p.saved.wave}, $ ${p.saved.score}`, rx, 284, { size: 14, font: FONT_TEXT, color: GOLD });
  }

  drawLeaderboard(ctx, p.leaderboard, d.label, rx, 314);

  const controls = [
    '← → / A D — ruch  ·  SPACJA — strzał',
    'P / ESC — pauza  ·  M — dźwięk  ·  ↑ ↓ — poziom',
    'N — zmień pseudonim  ·  H — historia gier',
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
```

- [ ] **Step 6: W `drawGameOver` dopisz linię z wynikiem zapisu** — tuż przed ostatnią linią `text(ctx, 'ENTER — MENU        R — RESTART', ...)`:

```js
  // Co się stało z wynikiem w bazie
  const result = game.persistence.lastResult;
  if (result) {
    let msg = 'Zapisywanie wyniku…';
    if (result.status === 'ok') msg = result.rank ? `Miejsce w rankingu: #${result.rank}` : 'Wynik zapisany w rankingu';
    else if (result.status === 'queued') msg = 'Brak połączenia — wynik wyślemy później';
    text(ctx, msg, cx, 500, { size: 18, font: FONT_TEXT, color: GOLD });
  }
```

- [ ] **Step 7: Dodaj nowe ekrany na końcu `js/render.js`**

```js
// „13.10.2026 09:05” w strefie czasowej przeglądarki
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function drawNickEntry(ctx, game) {
  ctx.fillStyle = 'rgba(20, 8, 4, 0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const pw = 440;
  const ph = 300;
  const px = (WIDTH - pw) / 2;
  const py = 130;
  const cx = WIDTH / 2;
  poster(ctx, px, py, pw, ph);
  text(ctx, 'PODAJ PSEUDONIM', cx, py + 60, { size: 34, color: INK, shadow: false });
  text(ctx, 'tak cię zapamięta Dziki Zachód', cx, py + 100, { size: 15, font: FONT_TEXT, color: INK, shadow: false });

  // Pole tekstowe z migającym kursorem
  ctx.fillStyle = 'rgba(59, 35, 20, 0.15)';
  ctx.fillRect(cx - 150, py + 130, 300, 50);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 150, py + 130, 300, 50);
  const cursor = blink(game.time, 2) ? '_' : ' ';
  text(ctx, game.nickDraft + cursor, cx, py + 156, { size: 28, color: '#7a1f12', shadow: false });
  text(ctx, `1–${PERSISTENCE.nickMaxLength} znaków: litery, cyfry, spacja, _ -`, cx, py + 210, { size: 13, font: FONT_TEXT, color: INK, shadow: false });

  const hint = game.profile.nick ? 'ENTER — zatwierdź     ESC — anuluj' : 'ENTER — zatwierdź';
  text(ctx, hint, cx, py + ph + 40, { size: 20 });
}

export function drawHistory(ctx, game) {
  ctx.fillStyle = 'rgba(20, 8, 4, 0.55)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const cx = WIDTH / 2;
  poster(ctx, 120, 50, 560, 480);
  text(ctx, 'TWOJE OSTATNIE GRY', cx, 100, { size: 34, color: INK, shadow: false });
  text(ctx, `szeryf ${game.profile.nick ?? ''}`, cx, 138, { size: 15, font: FONT_TEXT, color: INK, shadow: false });

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
    const messages = { error: 'Historia niedostępna — brak połączenia z bazą', ok: 'Brak rozegranych gier' };
    text(ctx, messages[status] ?? 'Wczytywanie…', cx, 260, { size: 16, font: FONT_TEXT, color: INK, shadow: false });
  }
  rows.forEach((row, i) => {
    const y = 212 + i * 28;
    for (const c of cols) text(ctx, c.value(row), c.x, y, { size: 15, font: FONT_TEXT, color: INK, shadow: false, align: c.align });
  });

  text(ctx, 'ESC / ENTER — powrót', cx, 565, { size: 20 });
}
```

- [ ] **Step 8: Uruchom testy**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add js/render.js js/tests/fake-dom.js js/tests/render.test.js
git commit -m "Ekrany: ranking TOP 10 w menu, pseudonim, historia gier, miejsce w rankingu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Integracja z grą (stany, zapis, wznawianie, wpisywanie tekstu)

**Files:**
- Modify: `js/input.js`, `js/game.js`
- Test: `js/tests/game.test.js`

**Interfaces:**
- Consumes: `Persistence` (Task 5 — pola i metody jak w jego „Produces”), `profile` (Task 2), `serializeGame` / `restoreGame` (Task 4), `NICK_CHAR` (Task 2), `NOTICE_INCOMPATIBLE` (Task 5), `drawNickEntry` / `drawHistory` (Task 6), `PERSISTENCE` (Task 1).
- Produces:
  - `Input.typed: string[]` — znaki wpisane w bieżącej klatce (czyszczone w `endFrame`)
  - `STATE.NICK = 'nick'`, `STATE.HISTORY = 'history'`
  - `new Game({ input, audio, storage, persistence, profile })`
  - `Game`: `nickDraft: string`, `autosaveTimer: number`, `get savedRecord(): number`, `saveProgress({ keepalive = false } = {})`, `enterMenu()`, `resumeGame()`

- [ ] **Step 1: Napisz testy `js/tests/game.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { createStorage } from '../storage.js';
import { createProfile } from '../profile.js';
import { serializeGame, SNAPSHOT_VERSION } from '../snapshot.js';
import { NOTICE_INCOMPATIBLE } from '../persistence.js';
import { PERSISTENCE } from '../config.js';
import { Player } from '../entities/player.js';

installFakeDom();
const { Game, STATE } = await import('../game.js');

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

// Atrapa warstwy zapisu: zapisuje wywołania, nic nie wysyła
function persistenceSpy() {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve();
  };
  const names = ['saveNow', 'discard', 'checkSaved', 'flushQueue', 'refreshLeaderboard', 'refreshHistory', 'submitResult'];
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

function makeGame({ nick = 'Joe' } = {}) {
  const backend = mockBackend();
  const profile = createProfile(backend, () => '11111111-2222-4333-8444-555555555555');
  if (nick) profile.setNick(nick);
  const persistence = persistenceSpy();
  const audio = {
    muted: false,
    setMuted(m) { this.muted = m; },
    toggleMute() { this.muted = !this.muted; return this.muted; },
    play() {},
  };
  const game = new Game({ input: new FakeInput(), audio, storage: createStorage(backend), persistence, profile });
  return { game, persistence, profile, audio };
}

// Jedna klatka gry z naciśniętymi klawiszami i wpisanymi znakami
function step(game, { press = [], type = '' } = {}, dt = 1 / 60) {
  game.input.pressed = new Set(press);
  game.input.typed = [...type];
  game.update(dt);
  game.input.endFrame();
}

test('pierwsze uruchomienie: ekran pseudonimu, litery nie przełączają dźwięku ani akcji', () => {
  const { game, profile, audio, persistence } = makeGame({ nick: null });
  assert.equal(game.state, STATE.NICK);
  step(game, { press: ['KeyM'], type: 'Mały' });
  step(game, { press: ['KeyP', 'KeyH', 'KeyC', 'KeyN', 'Space'], type: ' Joex;' });
  step(game, { press: ['Backspace'] });
  assert.equal(game.nickDraft, 'Mały Joe');
  assert.equal(audio.muted, false);
  assert.equal(game.state, STATE.NICK);
  step(game, { press: ['Enter'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(profile.nick, 'Mały Joe');
  assert.deepEqual(persistence.last('refreshLeaderboard').args, ['normalny']);
  assert.equal(persistence.count('checkSaved'), 1);
  assert.equal(persistence.count('flushQueue'), 1);
});

test('pseudonim: limit długości, pusty nie przechodzi, Esc tylko gdy nick już jest', () => {
  const { game } = makeGame({ nick: null });
  step(game, { press: ['Enter'] });
  assert.equal(game.state, STATE.NICK);
  step(game, { press: ['Escape'] });
  assert.equal(game.state, STATE.NICK);
  step(game, { type: 'abcdefghijklmnop' });
  assert.equal(game.nickDraft, 'abcdefghijkl');
});

test('z zapisanym pseudonimem start w menu; N zmienia pseudonim, Esc anuluje', () => {
  const { game, profile, persistence } = makeGame();
  assert.equal(game.state, STATE.MENU);
  assert.equal(persistence.count('checkSaved'), 1);
  step(game, { press: ['KeyN'] });
  assert.equal(game.state, STATE.NICK);
  assert.equal(game.nickDraft, 'Joe');
  step(game, { type: 'y' });
  step(game, { press: ['Escape'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(profile.nick, 'Joe');
});

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
  assert.equal(snapshot.wave, 1);
  assert.deepEqual(options, { keepalive: false });
  step(game, { press: ['KeyP'] });
  assert.equal(game.state, STATE.PLAYING);
  game.pause(); // visibilitychange
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

test('C w menu wznawia zapisaną grę w pauzie', () => {
  const source = makeGame();
  step(source.game, { press: ['Enter'] });
  source.game.score = 777;
  source.game.player.lives = 1;
  const snapshot = serializeGame(source.game, { nick: 'Joe' });

  const { game, persistence } = makeGame();
  step(game, { press: ['KeyC'] }); // bez zapisu nic się nie dzieje
  assert.equal(game.state, STATE.MENU);
  persistence.saved = { difficulty: snapshot.difficulty, wave: snapshot.wave, score: snapshot.score, snapshot };
  step(game, { press: ['KeyC'] });
  assert.equal(game.state, STATE.PAUSED);
  assert.equal(game.score, 777);
  assert.equal(game.player.lives, 1);
  assert.ok(game.player instanceof Player);
  assert.equal(persistence.count('discard'), 0);
  step(game, { press: ['KeyP'] });
  assert.equal(game.state, STATE.PLAYING);
  step(game); // gra toczy się dalej bez błędów
});

test('C z niezgodnym zapisem: komunikat, usunięcie, zostajemy w menu', () => {
  const { game, persistence } = makeGame();
  persistence.saved = { difficulty: 'normalny', wave: 3, score: 1, snapshot: { version: 999 } };
  step(game, { press: ['KeyC'] });
  assert.equal(game.state, STATE.MENU);
  assert.equal(persistence.notice, NOTICE_INCOMPATIBLE);
  assert.equal(persistence.count('discard'), 1);
});

test('game over: wynik do bazy, zapis usunięty; R zaczyna od nowa', () => {
  const { game, persistence } = makeGame();
  step(game, { press: ['Enter'] });
  game.score = 1200;
  game.endGame();
  assert.equal(game.state, STATE.GAMEOVER);
  assert.deepEqual(persistence.last('submitResult').args, [{ nick: 'Joe', difficulty: 'normalny', score: 1200, wave: 1 }]);
  assert.equal(persistence.count('discard'), 2); // start gry + game over
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
Expected: FAIL — m.in. `STATE.NICK` niezdefiniowany / `game.state` = `'menu'` zamiast `'nick'`.

- [ ] **Step 3: Bufor znaków w `js/input.js`**

Dodaj `'Backspace'` do `GAME_KEYS`:

```js
const GAME_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyA', 'KeyD', 'KeyP', 'KeyM', 'KeyR', 'Escape', 'Enter', 'NumpadEnter', 'Backspace',
]);
```

W konstruktorze po `this.pressed = new Set();`:

```js
    this.typed = [];   // znaki wpisane w tej klatce (pole pseudonimu)
```

W obsłudze `keydown`, po `this.down.add(code);`:

```js
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) this.typed.push(e.key);
```

W `endFrame()`:

```js
  endFrame() {
    this.pressed.clear();
    this.typed = [];
  }
```

- [ ] **Step 4: Zmiany w `js/game.js`**

Importy — dopisz/zmień:

```js
import {
  WIDTH, HEIGHT, GROUND_Y, WAVE_BANNER_TIME, FORMATION, BOSS, VULTURE, POWERUPS,
  ENEMY_TYPES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, getDifficulty, VISUALS, PERSISTENCE,
} from './config.js';
```

```js
import { serializeGame, restoreGame } from './snapshot.js';
import { NOTICE_INCOMPATIBLE } from './persistence.js';
import { NICK_CHAR } from './profile.js';
```

```js
import {
  drawBackground, drawHUD, drawBossBar, drawBanner, drawMenu, drawPause, drawGameOver, drawMuteIndicator,
  drawVignette, drawFlash, drawNickEntry, drawHistory,
} from './render.js';
```

Komentarz nagłówka i `STATE`:

```js
// Maszyna stanów gry: PSEUDONIM → MENU ⇄ HISTORIA, MENU → GRA ⇄ PAUZA → GAME OVER
// oraz logika rozgrywki (fale, kolizje, punktacja, bonusy) i punkty zapisu gry.
```

```js
export const STATE = {
  NICK: 'nick', MENU: 'menu', HISTORY: 'history', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover',
};
```

Konstruktor — nowa sygnatura i końcówka:

```js
  constructor({ input, audio, storage, persistence, profile }) {
    this.input = input;
    this.audio = audio;
    this.storage = storage;
    this.persistence = persistence;
    this.profile = profile;
    this.state = STATE.MENU;
```

…(dotychczasowe pola bez zmian)…, a na końcu konstruktora:

```js
    this.nickDraft = profile.nick ?? '';
    this.autosaveTimer = 0;   // czas od ostatniego zapisu przerwanej gry
    if (profile.nick) this.enterMenu();
    else this.state = STATE.NICK;
  }
```

Zastąp getter `record`:

```js
  // Najlepszy znany wynik dla poziomu: lokalny rekord albo najlepszy z rankingu
  get savedRecord() {
    return Math.max(this.highscores[this.difficultyKey] ?? 0, this.persistence.bestScore(this.difficultyKey));
  }

  get record() {
    return Math.max(this.savedRecord, this.score);
  }
```

Zastąp `pause()`:

```js
  // Wywoływane klawiszem P / Esc oraz przy ukryciu karty (visibilitychange)
  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.saveProgress();
  }

  // Zapis przerwanej gry: pauza, wyjście do menu, autozapis, zamknięcie karty
  saveProgress({ keepalive = false } = {}) {
    if (this.state !== STATE.PLAYING && this.state !== STATE.PAUSED) return;
    this.autosaveTimer = 0;
    this.persistence.saveNow(serializeGame(this, { nick: this.profile.nick }), { keepalive });
  }
```

W sekcji „Przejścia między stanami” dodaj przed `startGame()`:

```js
  // Wejście do menu: dosłanie zaległych wyników, ranking, sprawdzenie zapisu gry
  enterMenu() {
    this.state = STATE.MENU;
    this.persistence.flushQueue();
    this.persistence.refreshLeaderboard(this.difficultyKey);
    this.persistence.checkSaved();
  }

  // Wznowienie przerwanej gry — w pauzie, żeby gracz zdążył się przygotować
  resumeGame() {
    const saved = this.persistence.saved;
    if (!saved) return;
    this.persistence.notice = null;
    if (restoreGame(this, saved.snapshot)) {
      this.autosaveTimer = 0;
      this.state = STATE.PAUSED;
      return;
    }
    this.persistence.notice = NOTICE_INCOMPATIBLE;
    this.persistence.discard();
  }
```

Na początku `startGame()` (nowa gra porzuca stary zapis):

```js
  startGame() {
    this.persistence.discard();
    this.persistence.notice = null;
    this.autosaveTimer = 0;
    this.state = STATE.PLAYING;
```

…(reszta `startGame` bez zmian).

W `endGame()` po `this.audio.play('gameover');`:

```js
    this.persistence.discard();
    this.persistence.submitResult({ nick: this.profile.nick, difficulty: this.difficultyKey, score: this.score, wave: this.wave });
```

W `update(dt)` zastąp obsługę `KeyM` i cały `switch`:

```js
    // Na ekranie pseudonimu „m” to litera, nie wyciszenie
    if (this.state !== STATE.NICK && input.wasPressed('KeyM')) {
      this.storage.saveMuted(this.audio.toggleMute());
    }

    switch (this.state) {
      case STATE.NICK:
        this.updateNick();
        break;
      case STATE.MENU: {
        const n = DIFFICULTY_ORDER.length;
        const before = this.difficultyIndex;
        if (input.wasPressed('ArrowUp')) this.difficultyIndex = (this.difficultyIndex + n - 1) % n;
        if (input.wasPressed('ArrowDown')) this.difficultyIndex = (this.difficultyIndex + 1) % n;
        if (this.difficultyIndex !== before) this.persistence.refreshLeaderboard(this.difficultyKey);
        if (input.wasPressed('Enter')) this.startGame();
        else if (input.wasPressed('KeyC')) this.resumeGame();
        else if (input.wasPressed('KeyN')) {
          this.nickDraft = this.profile.nick ?? '';
          this.state = STATE.NICK;
        } else if (input.wasPressed('KeyH')) {
          this.state = STATE.HISTORY;
          this.persistence.refreshHistory();
        }
        break;
      }
      case STATE.HISTORY:
        if (input.wasPressed('Escape', 'Enter')) this.state = STATE.MENU;
        break;
      case STATE.PLAYING:
        if (input.wasPressed('KeyP', 'Escape')) {
          this.pause();
          break;
        }
        this.autosaveTimer += dt;
        if (this.autosaveTimer >= PERSISTENCE.autosaveInterval) this.saveProgress();
        this.updatePlaying(dt);
        break;
      case STATE.PAUSED:
        if (input.wasPressed('KeyP', 'Escape')) this.state = STATE.PLAYING;
        else if (input.wasPressed('Enter')) {
          this.saveProgress();
          this.enterMenu();
        }
        break;
      case STATE.GAMEOVER:
        if (input.wasPressed('Enter')) this.enterMenu();
        else if (input.wasPressed('KeyR')) this.startGame();
        break;
      default:
        break;
    }
  }

  // Wpisywanie pseudonimu: dozwolone znaki, Backspace, Enter zatwierdza, Esc anuluje
  updateNick() {
    const input = this.input;
    for (const ch of input.typed) {
      if (NICK_CHAR.test(ch) && this.nickDraft.length < PERSISTENCE.nickMaxLength) this.nickDraft += ch;
    }
    if (input.wasPressed('Backspace')) this.nickDraft = this.nickDraft.slice(0, -1);
    if (input.wasPressed('Enter')) {
      if (this.profile.setNick(this.nickDraft)) this.enterMenu();
    } else if (input.wasPressed('Escape') && this.profile.nick) {
      this.enterMenu();
    }
  }
```

W `draw(ctx)` zastąp blok `if (this.state === STATE.MENU) { ... return; }`:

```js
    if (this.state === STATE.MENU || this.state === STATE.NICK || this.state === STATE.HISTORY) {
      this.ambient.draw(ctx);
      drawVignette(ctx);
      if (this.state === STATE.MENU) drawMenu(ctx, this);
      else if (this.state === STATE.NICK) drawNickEntry(ctx, this);
      else drawHistory(ctx, this);
      drawMuteIndicator(ctx, this.audio.muted);
      return;
    }
```

- [ ] **Step 5: Uruchom testy**

Run: `npm test`
Expected: PASS (wszystkie pliki, w tym 12 testów w `game.test.js`).

- [ ] **Step 6: Commit**

```bash
git add js/input.js js/game.js js/tests/game.test.js
git commit -m "Gra: pseudonim, historia, autozapis, wznawianie i wysyłka wyniku

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Składanie zależności (`main.js`, `db-config.js`) i test w przeglądarce offline

**Files:**
- Create: `js/db-config.js`
- Modify: `js/main.js`

**Interfaces:**
- Consumes: `createDb` (Task 3), `createProfile` (Task 2), `Persistence` (Task 5), `Game` (Task 7)
- Produces: `SUPABASE_URL`, `SUPABASE_ANON_KEY` z `js/db-config.js` (na razie puste — Task 9 je uzupełnia)

- [ ] **Step 1: Utwórz `js/db-config.js`**

```js
// Połączenie z Supabase. Klucz „publishable” / „anon” jest z założenia publiczny —
// dostęp do danych ograniczają RLS i funkcje w bazie (supabase/migrations/).
// Puste wartości = gra działa offline (rekordy i zapis gry tylko lokalnie).
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
```

- [ ] **Step 2: Zmień `js/main.js`**

Importy:

```js
// Inicjalizacja, składanie zależności i pętla gry (requestAnimationFrame + ograniczony delta time).
import { MAX_DT, FONT_TITLE } from './config.js';
import { Input } from './input.js';
import { SoundFx } from './audio.js';
import { createStorage } from './storage.js';
import { createProfile } from './profile.js';
import { createDb } from './db.js';
import { Persistence } from './persistence.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './db-config.js';
import { Game } from './game.js';
```

Zamiast `const storage = createStorage();` … `const game = new Game({ input, audio, storage });`:

```js
const storage = createStorage();
const profile = createProfile();
const db = createDb({ url: SUPABASE_URL, key: SUPABASE_ANON_KEY });
const persistence = new Persistence({ db, profile, storage });
const audio = new SoundFx();
const input = new Input(window, () => audio.init());
const game = new Game({ input, audio, storage, persistence, profile });
```

Po obsłudze `visibilitychange`:

```js
// Zamknięcie lub odświeżenie karty — ostatni zapis przerwanej gry (fetch z keepalive)
window.addEventListener('pagehide', () => game.saveProgress({ keepalive: true }));
```

- [ ] **Step 3: Uruchom testy**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Test ręczny w przeglądarce — tryb offline (puste `db-config.js`)**

Run: `npx serve .` i otwórz `http://localhost:3000`. Sprawdź:
1. Pierwsze uruchomienie → ekran „PODAJ PSEUDONIM”; wpisz `Mały Joe` (litera „m” nie wycisza dźwięku), Enter → menu z „szeryf: Mały Joe”.
2. Menu: „TOP 10 — NORMALNY” + „Ranking niedostępny”; ↑/↓ zmienia nagłówek; N → edycja pseudonimu, Esc wraca; H → „Historia niedostępna…”, Esc wraca.
3. Enter → gra; po kilku sekundach P → pauza; odśwież stronę (F5) → menu pokazuje „C — wznów: normalny, fala 1, $ …”; C → gra w pauzie z tym samym wynikiem, osłonami i położeniem bandytów; P → gra toczy się dalej.
4. Przegraj → game over z „Brak połączenia — wynik wyślemy później”; Enter → menu bez linii „C — wznów”.
5. DevTools → Console: jedno żółte ostrzeżenie `[baza] brak konfiguracji Supabase…`, **zero czerwonych błędów**. DevTools → Application → Local Storage: klucze `arcaneInvaders.deviceId`, `.nick`, `.savedGame`, `.scoreQueue`.

Expected: wszystkie punkty zgodnie z opisem.

- [ ] **Step 5: Commit**

```bash
git add js/db-config.js js/main.js
git commit -m "Podłączenie warstwy zapisu w main.js; zapis przy zamykaniu karty

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Baza Supabase — projekt, migracja, konfiguracja, test end-to-end

**Files:**
- Create: `supabase/migrations/20261013000000_wyniki_i_zapisy.sql`
- Modify: `js/db-config.js`

**Interfaces:**
- Consumes: ścieżki REST i nazwy/parametry RPC z Task 3 (`/rest/v1/scores`, `save_game(p_device_id, p_nick, p_difficulty, p_snapshot)`, `load_game(p_device_id)`, `delete_game(p_device_id)`; kolumny `device_id, nick, difficulty, score, wave, created_at`).
- Produces: działający projekt Supabase i uzupełnione `SUPABASE_URL` / `SUPABASE_ANON_KEY`.

- [ ] **Step 1: Utwórz migrację `supabase/migrations/20261013000000_wyniki_i_zapisy.sql`**

```sql
-- Bandyci z Nieba: wyniki gier (ranking + historia) i przerwane gry do wznowienia.
-- Gracz bez logowania: identyfikuje go losowy UUID urządzenia (device_id).

-- Wyniki zakończonych gier ---------------------------------------------------
create table public.scores (
  id          bigint generated always as identity primary key,
  device_id   uuid        not null,
  nick        text        not null check (char_length(nick) between 1 and 12),
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  score       integer     not null check (score between 0 and 10000000),
  wave        integer     not null check (wave >= 1),
  created_at  timestamptz not null default now()
);

create index scores_ranking_idx on public.scores (difficulty, score desc);
create index scores_history_idx on public.scores (device_id, created_at desc);

alter table public.scores enable row level security;

-- Ranking jest publiczny; dopisywać wolno, zmieniać i usuwać — nie
revoke all on public.scores from anon, authenticated;
grant select, insert on public.scores to anon, authenticated;

create policy "scores_select_all" on public.scores
  for select to anon, authenticated using (true);

create policy "scores_insert_all" on public.scores
  for insert to anon, authenticated with check (true);

-- Przerwane gry (jedna na urządzenie) ----------------------------------------
create table public.saved_games (
  device_id   uuid        primary key,
  nick        text        not null check (char_length(nick) between 1 and 12),
  difficulty  text        not null check (difficulty in ('latwy', 'normalny', 'trudny')),
  snapshot    jsonb       not null check (octet_length(snapshot::text) < 262144),
  updated_at  timestamptz not null default now()
);

-- Brak polityk = brak bezpośredniego dostępu; tylko przez funkcje poniżej
alter table public.saved_games enable row level security;
revoke all on public.saved_games from anon, authenticated;

create function public.save_game(p_device_id uuid, p_nick text, p_difficulty text, p_snapshot jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.saved_games (device_id, nick, difficulty, snapshot, updated_at)
  values (p_device_id, p_nick, p_difficulty, p_snapshot, now())
  on conflict (device_id) do update
    set nick = excluded.nick,
        difficulty = excluded.difficulty,
        snapshot = excluded.snapshot,
        updated_at = now();
$$;

create function public.load_game(p_device_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('nick', nick, 'difficulty', difficulty, 'snapshot', snapshot, 'updated_at', updated_at)
  from public.saved_games
  where device_id = p_device_id;
$$;

create function public.delete_game(p_device_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.saved_games where device_id = p_device_id;
$$;

revoke execute on function public.save_game(uuid, text, text, jsonb) from public;
revoke execute on function public.load_game(uuid) from public;
revoke execute on function public.delete_game(uuid) from public;
grant execute on function public.save_game(uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.load_game(uuid) to anon, authenticated;
grant execute on function public.delete_game(uuid) to anon, authenticated;
```

- [ ] **Step 2: Uwierzytelnij Supabase MCP**

Załaduj narzędzie przez `ToolSearch("select:mcp__claude_ai_Supabase__authenticate")` i wywołaj je; poproś użytkownika o dokończenie logowania w przeglądarce (`mcp__claude_ai_Supabase__complete_authentication`, jeśli potrzebne). Po uwierzytelnieniu pojawią się narzędzia Supabase (m.in. `list_organizations`, `get_cost`, `confirm_cost`, `create_project`, `get_project`, `apply_migration`, `execute_sql`, `get_advisors`, `get_project_url`, `get_publishable_keys` / `get_anon_key`) — załaduj je przez `ToolSearch`.

- [ ] **Step 3: Załóż projekt — za zgodą użytkownika**

1. `list_organizations` → wybór organizacji.
2. `get_cost` (type `project`) → **pokaż użytkownikowi koszt i zapytaj o zgodę** (organizacja, nazwa `bandyci-z-nieba`, region `eu-central-1`). Bez zgody nie zakładaj projektu.
3. Po zgodzie: `confirm_cost` → `create_project` (name `bandyci-z-nieba`, region `eu-central-1`).
4. `get_project` co kilkadziesiąt sekund, aż status `ACTIVE_HEALTHY`.

- [ ] **Step 4: Zastosuj migrację**

`apply_migration` z name `wyniki_i_zapisy` i treścią pliku z kroku 1.
Weryfikacja przez `execute_sql`:

```sql
select table_name from information_schema.tables where table_schema = 'public' order by 1;
select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1;
```

Expected: tabele `saved_games`, `scores`; funkcje `delete_game`, `load_game`, `save_game`.

- [ ] **Step 5: Sprawdź security advisors**

`get_advisors` (type `security`).
Expected: brak ostrzeżeń o wyłączonym RLS ani o `search_path`. **Akceptowane i opisane w specyfikacji:** ostrzeżenia, że funkcje `security definer` są wykonywalne przez `anon`, oraz że polityka `insert` na `scores` przepuszcza każdy wiersz (`with check (true)`) — wynikają z gry bez logowania. Każde inne ostrzeżenie: napraw nową migracją (`apply_migration` + nowy plik w `supabase/migrations/`).

- [ ] **Step 6: Uzupełnij `js/db-config.js`**

`get_project_url` i `get_publishable_keys` (preferuj klucz `sb_publishable_…`; gdy go brak — klucz `anon`). Wpisz:

```js
export const SUPABASE_URL = 'https://<ref>.supabase.co';
export const SUPABASE_ANON_KEY = '<publishable-lub-anon>';
```

(wartości z wyników narzędzi; nigdy nie wpisuj klucza `service_role` / `secret`).

- [ ] **Step 7: Test API z wiersza poleceń (bash)**

```bash
URL='https://<ref>.supabase.co'; KEY='<klucz z kroku 6>'
DEV='11111111-2222-4333-8444-555555555555'
H=(-H "apikey: $KEY" -H 'Content-Type: application/json')
# wynik: dopisanie → 201
curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" -H 'Prefer: return=minimal' \
  -d "{\"device_id\":\"$DEV\",\"nick\":\"Test\",\"difficulty\":\"normalny\",\"score\":10,\"wave\":1}" "$URL/rest/v1/scores"
# ranking → JSON z wierszem Test
curl -s "${H[@]}" "$URL/rest/v1/scores?select=nick,score&difficulty=eq.normalny&order=score.desc&limit=10"
# zmiana cudzego wyniku → 401/403 albo 0 zmienionych wierszy (brak uprawnień UPDATE)
curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" -X PATCH -d '{"score":999999}' "$URL/rest/v1/scores?nick=eq.Test"
# niepoprawny nick → 400 (check constraint)
curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" \
  -d "{\"device_id\":\"$DEV\",\"nick\":\"\",\"difficulty\":\"normalny\",\"score\":1,\"wave\":1}" "$URL/rest/v1/scores"
# zapis gry przez RPC → 204, odczyt → JSON, bezpośredni odczyt tabeli → 401/403
curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" -d "{\"p_device_id\":\"$DEV\",\"p_nick\":\"Test\",\"p_difficulty\":\"latwy\",\"p_snapshot\":{\"version\":1}}" "$URL/rest/v1/rpc/save_game"
curl -s "${H[@]}" -d "{\"p_device_id\":\"$DEV\"}" "$URL/rest/v1/rpc/load_game"
curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" "$URL/rest/v1/saved_games?select=*"
curl -s -o /dev/null -w '%{http_code}\n' "${H[@]}" -d "{\"p_device_id\":\"$DEV\"}" "$URL/rest/v1/rpc/delete_game"
```

Expected: `201`, wiersz `Test`, PATCH odrzucony (`401`/`403`), `400`, `204`, JSON z `snapshot`, `401`/`403` dla `saved_games`, `204`.
Na koniec usuń dane testowe przez `execute_sql`: `delete from public.scores where nick = 'Test';`

- [ ] **Step 8: Test end-to-end w przeglądarce (z bazą)**

`npx serve .` → `http://localhost:3000`:
1. Zagraj i przegraj → game over: „Miejsce w rankingu: #N”; Enter → TOP 10 pokazuje wynik z pseudonimem.
2. H → wynik na liście „TWOJE OSTATNIE GRY” z datą i godziną.
3. Nowa gra → P → odśwież stronę → „C — wznów…” → C → stan zgodny (wynik, życia, bandyci, osłony, boss na fali 5).
4. Zamknij kartę w trakcie gry (bez pauzy), otwórz ponownie → „C — wznów…” dostępne.
5. DevTools → Network → Offline; przegraj → „Brak połączenia — wynik wyślemy później”; wróć online, Enter do menu → wynik pojawia się w TOP 10 / historii (kolejka offline).
6. Konsola: bez czerwonych błędów; ostrzeżenia `[baza]` tylko w trybie offline.

Expected: wszystkie punkty zgodnie z opisem.

- [ ] **Step 9: Commit**

```bash
git add supabase js/db-config.js
git commit -m "Baza Supabase: migracja schematu i konfiguracja połączenia

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Aktualizacja `wymagania.md`

**Files:**
- Modify: `wymagania.md`

- [ ] **Step 1: Rozdział 2 „Technologia”** — zastąp punkt `- Zapis rekordów i ustawień w **localStorage**.`:

```markdown
- Zapis rekordów, ustawień, profilu gracza i kopii przerwanej gry w **localStorage**.
- **Supabase** (Postgres) jako baza wyników i przerwanych gier — wyłącznie przez `fetch` do REST API (PostgREST), **bez bibliotek**. Konfiguracja w `js/db-config.js`; bez niej gra działa offline.
```

- [ ] **Step 2: Rozdział 3 „Architektura”** — w drzewie plików dopisz pod `storage.js`:

```
  profile.js        – anonimowy identyfikator urządzenia i pseudonim
  db-config.js      – adres i publiczny klucz Supabase
  db.js             – klient REST Supabase (fetch, timeout, tryb offline)
  serial.js         – odtwarzanie encji z zapisu JSON
  snapshot.js       – pełny zapis i odtwarzanie stanu rozgrywki
  persistence.js    – zapis/wznawianie gry, wyniki z kolejką offline, ranking, historia
supabase/migrations – schemat bazy (tabele, RLS, funkcje RPC)
```

i w „Zasadach projektowych” dopisz:

```markdown
- Pętla gry nigdy nie czeka na sieć: zapytania do bazy są asynchroniczne, a ich wyniki trafiają do pól czytanych przez render.
```

- [ ] **Step 3: Rozdział 4.1 „Sterowanie”** — dopisz wiersze tabeli:

```markdown
| C | wznowienie przerwanej gry (w menu) |
| N | zmiana pseudonimu (w menu) |
| H | historia gier (w menu) |
| Backspace | usuwanie znaku przy wpisywaniu pseudonimu |
```

- [ ] **Step 4: Rozdział 5 „Ekrany i interfejs”** — zastąp listę:

```markdown
1. **Pseudonim** — przy pierwszym uruchomieniu (i klawiszem N w menu): wpisanie pseudonimu 1–12 znaków (litery, cyfry, spacja, `_`, `-`); Enter zatwierdza, Esc anuluje zmianę.
2. **Menu** — tytuł „BANDYCI Z NIEBA” w stylu listu gończego „WANTED”, rekord dla wybranego poziomu, pseudonim gracza, wybór poziomu trudności, „C — wznów” gdy jest przerwana gra, **TOP 10** dla wybranego poziomu, skrót sterowania. Enter = nowa gra.
3. **Historia** — ostatnie 10 gier z tego urządzenia: data, poziom, fala, wynik.
4. **Gra** — HUD u góry: wynik, rekord, życia (ikony kapeluszy), numer fali, aktywny bonus z paskiem czasu.
5. **Pauza** — półprzezroczysta nakładka z napisem „PAUZA”; wznowiona gra startuje w pauzie.
6. **Game over** — „WANTED: DEAD”, wynik końcowy, „NOWY REKORD!” gdy pobity, miejsce w rankingu (lub informacja o wysłaniu później); Enter = menu, R = restart.
```

- [ ] **Step 5: Rozdział 7 „Zapis danych”** — zastąp całość:

```markdown
## 7. Zapis danych

### localStorage
- `arcaneInvaders.highscores` → `{ latwy, normalny, trudny }` — lokalny najlepszy wynik na poziom.
- `arcaneInvaders.muted` → `true` / `false`.
- `arcaneInvaders.deviceId` → losowy UUID urządzenia (bez logowania).
- `arcaneInvaders.nick` → pseudonim gracza.
- `arcaneInvaders.savedGame` → kopia ostatniego zapisu przerwanej gry (albo znacznik `discarded` po jej zakończeniu).
- `arcaneInvaders.scoreQueue` → wyniki niewysłane do bazy (maks. 20), dosyłane przy wejściu do menu.
- Każdy odczyt i zapis w `try/catch`; przy braku dostępu do localStorage gra działa dalej.

### Supabase
- Tabela `scores` — każda zakończona gra: pseudonim, poziom, wynik, fala, data. Odczyt publiczny, dopisywanie dozwolone, zmiana i usuwanie zabronione (RLS).
- Tabela `saved_games` — jedna przerwana gra na urządzenie (pełny snapshot JSON). Dostęp wyłącznie przez funkcje `save_game`, `load_game`, `delete_game`.
- Zapis przerwanej gry: przy pauzie, ukryciu karty, wyjściu do menu, zamknięciu karty oraz co 10 s gry. Usunięcie: przy game over i rozpoczęciu nowej gry.
- Wznowienie z nowszego z zapisów: lokalnego lub z bazy. Zapis w innej wersji formatu jest odrzucany z komunikatem.
- Schemat w `supabase/migrations/`. Klucz publiczny w `js/db-config.js` jest jawny z założenia — bez logowania nie da się całkowicie wykluczyć sfałszowanych wyników.
```

- [ ] **Step 6: Rozdział 8 „Testy”** — dopisz do listy:

```markdown
  - profil gracza (walidacja pseudonimu, UUID także bez `crypto.randomUUID`),
  - klient bazy (atrapa `fetch`: adresy, nagłówki, błędy, timeout),
  - snapshot gry (zapis → JSON → odtworzenie, odrzucanie uszkodzonych zapisów),
  - warstwa zapisu (kolejność zapisów, kolejka offline, wybór nowszego zapisu),
  - przejścia stanów gry i ekrany (z atrapą DOM/canvas).
```

- [ ] **Step 7: Rozdział 9 „Poza zakresem”** — zastąp `- Ranking online.` linią:

```markdown
- Logowanie graczy i synchronizacja między urządzeniami; walidacja wyników po stronie serwera.
```

- [ ] **Step 8: Commit**

```bash
git add wymagania.md
git commit -m "Wymagania: zapis wyników i wznawianie gry w Supabase

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
