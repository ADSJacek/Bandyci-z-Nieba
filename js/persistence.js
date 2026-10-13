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
