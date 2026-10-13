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

test('flushQueue: zmiana gracza w trakcie wysyłki zatrzymuje kolejkę (wyniki A nie idą jako B)', async () => {
  const first = deferred();
  const { db, persistence, storage, auth } = setup({ submitScore: [first.promise] });
  storage.saveScoreQueue([{ id: 'a', userId: 'u-1', score: 1 }, { id: 'c', userId: 'u-1', score: 3 }]);
  const flushing = persistence.flushQueue();
  auth.user = { id: 'u-2', login: 'B' }; // A wylogował się, zalogował się B
  first.resolve(OK);
  await flushing;
  assert.deepEqual(db.calls.map((c) => c.args[0].id), ['a']);
  assert.deepEqual(storage.loadScoreQueue().map((r) => r.id), ['c']);
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
