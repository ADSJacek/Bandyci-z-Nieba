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
