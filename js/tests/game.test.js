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

  anyPressed() { return this.pressed.size > 0; }

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

test('L przy przerwanej grze: puste klatki między naciśnięciami nie rozbrajają ostrzeżenia', () => {
  const { game, auth, persistence } = makeGame();
  persistence.saved = { difficulty: 'normalny', wave: 2, score: 10, snapshot: {} };
  step(game, { press: ['KeyL'] });
  step(game);
  step(game);
  assert.equal(game.logoutArmed, true);
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
