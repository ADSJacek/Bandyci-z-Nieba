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
