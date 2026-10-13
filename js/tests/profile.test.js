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
