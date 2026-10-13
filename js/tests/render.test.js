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
