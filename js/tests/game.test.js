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
