import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, updateHighscore, HIGHSCORES_KEY, MUTED_KEY, SAVED_GAME_KEY, SCORE_QUEUE_KEY } from '../storage.js';
import { PERSISTENCE } from '../config.js';

// Atrapa localStorage
function mockStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

// localStorage, który rzuca wyjątkami (np. zablokowany w przeglądarce)
const brokenStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('brak zapisanych rekordów → zera', () => {
  assert.deepEqual(createStorage(mockStorage()).loadHighscores(), { latwy: 0, normalny: 0, trudny: 0 });
});

test('zapis i odczyt rekordów', () => {
  const backend = mockStorage();
  const storage = createStorage(backend);
  storage.saveHighscores({ latwy: 100, normalny: 2500, trudny: 0 });
  assert.deepEqual(JSON.parse(backend.data[HIGHSCORES_KEY]), { latwy: 100, normalny: 2500, trudny: 0 });
  assert.deepEqual(storage.loadHighscores(), { latwy: 100, normalny: 2500, trudny: 0 });
});

test('uszkodzone dane rekordów → zera, bez wyjątku', () => {
  const storage = createStorage(mockStorage({ [HIGHSCORES_KEY]: '{niepoprawny json' }));
  assert.deepEqual(storage.loadHighscores(), { latwy: 0, normalny: 0, trudny: 0 });
  const partial = createStorage(mockStorage({ [HIGHSCORES_KEY]: '{"normalny":"abc","trudny":700}' }));
  assert.deepEqual(partial.loadHighscores(), { latwy: 0, normalny: 0, trudny: 700 });
});

test('wyciszenie zapisywane jako true / false', () => {
  const backend = mockStorage();
  const storage = createStorage(backend);
  assert.equal(storage.loadMuted(), false);
  storage.saveMuted(true);
  assert.equal(backend.data[MUTED_KEY], 'true');
  assert.equal(storage.loadMuted(), true);
  storage.saveMuted(false);
  assert.equal(storage.loadMuted(), false);
});

test('niedostępny localStorage — gra działa dalej bez rekordów', () => {
  for (const backend of [brokenStorage, null]) {
    const storage = createStorage(backend);
    assert.deepEqual(storage.loadHighscores(), { latwy: 0, normalny: 0, trudny: 0 });
    assert.equal(storage.saveHighscores({ latwy: 1, normalny: 1, trudny: 1 }), false);
    assert.equal(storage.loadMuted(), false);
    assert.equal(storage.saveMuted(true), false);
    assert.equal(storage.loadLocalSave(), null);
    assert.equal(storage.saveLocalSave({ version: 1 }), false);
    assert.deepEqual(storage.loadScoreQueue(), []);
    assert.equal(storage.saveScoreQueue([{ score: 1 }]), false);
  }
});

test('updateHighscore: nowy rekord tylko przy wyższym wyniku', () => {
  const hs = { latwy: 0, normalny: 1000, trudny: 0 };
  assert.deepEqual(updateHighscore(hs, 'normalny', 900), { highscores: hs, isNew: false });
  assert.deepEqual(updateHighscore(hs, 'normalny', 1000).isNew, false);
  const result = updateHighscore(hs, 'normalny', 1200);
  assert.equal(result.isNew, true);
  assert.equal(result.highscores.normalny, 1200);
  assert.equal(hs.normalny, 1000); // oryginał bez zmian
});

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
