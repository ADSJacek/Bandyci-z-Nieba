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
      if (this.userId !== userId) break; // gracz się zmienił — wyniki A nie mogą pójść z tokenem B
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
