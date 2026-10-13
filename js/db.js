// Klient bazy Supabase przez REST API (PostgREST) — czysty fetch, bez bibliotek.
// Zalogowany gracz wysyła swój token (RLS w bazie sprawdza auth.uid()), gość
// tylko klucz publiczny. Każda metoda zwraca { ok, data, error } i nigdy nie
// rzuca wyjątku: gra działa dalej bez sieci i bez konfiguracji (error: 'offline').
import { PERSISTENCE } from './config.js';
import { requestJson } from './http.js';

const SCORE_COLUMNS = 'nick,difficulty,score,wave,created_at';

function fail(error) {
  return { ok: false, data: null, error };
}

// "0-0/42" albo "*/0" → 42 / 0; brak lub "*" → null
export function parseContentRangeTotal(header) {
  const total = Number(String(header ?? '').split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

// Gość: klucz publishable (sb_publishable_…) tylko w `apikey`; starszy klucz anon (JWT) także w Authorization
function guestHeaders(key) {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export function createDb({
  url, key, getToken = async () => null, fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = PERSISTENCE.dbTimeoutMs,
} = {}) {
  const enabled = Boolean(url && key && fetchFn);
  const base = String(url ?? '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
    if (!enabled) return fail('offline');
    const token = await getToken();
    const auth = token ? { apikey: key, Authorization: `Bearer ${token}` } : guestHeaders(key);
    const res = await requestJson(fetchFn, base + path, { method, body, keepalive, timeoutMs, headers: { ...auth, ...headers } });
    return res.ok ? { ok: true, data: res.data, error: null, headers: res.headers } : fail(res.error);
  }

  const scores = (params) => `/rest/v1/scores?${new URLSearchParams(params)}`;
  const savedGame = (params) => `/rest/v1/saved_games?${new URLSearchParams(params)}`;

  return {
    enabled,

    // Konto (user_id) i login (nick) dopisuje baza — klient wysyła tylko wynik
    submitScore({ difficulty, score, wave }) {
      return request('/rest/v1/scores', {
        method: 'POST',
        body: { difficulty, score, wave },
        headers: { Prefer: 'return=minimal' },
      });
    },

    topScores(difficulty, limit = PERSISTENCE.leaderboardSize) {
      return request(scores({ select: SCORE_COLUMNS, difficulty: `eq.${difficulty}`, order: 'score.desc,created_at.asc', limit: String(limit) }));
    },

    // Miejsce w rankingu = liczba lepszych wyników + 1 (baza zwraca samą liczbę)
    async rankOf(difficulty, score) {
      const res = await request(
        scores({ select: 'id', difficulty: `eq.${difficulty}`, score: `gt.${score}`, limit: '1' }),
        { headers: { Prefer: 'count=exact' } },
      );
      if (!res.ok) return res;
      const total = parseContentRangeTotal(res.headers?.get?.('content-range'));
      return total === null ? fail('bad-count') : { ok: true, data: total + 1, error: null };
    },

    myHistory(userId, limit = PERSISTENCE.historySize) {
      return request(scores({ select: SCORE_COLUMNS, user_id: `eq.${userId}`, order: 'created_at.desc', limit: String(limit) }));
    },

    // Upsert jednego zapisu na konto; keepalive: zapytanie dokończy się po zamknięciu karty (limit 64 kB)
    saveGame(userId, difficulty, snapshot, { keepalive = false } = {}) {
      return request(savedGame({ on_conflict: 'user_id' }), {
        method: 'POST',
        keepalive,
        body: { user_id: userId, difficulty, snapshot, updated_at: new Date().toISOString() },
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    },

    async loadGame(userId) {
      const res = await request(savedGame({ select: 'difficulty,snapshot,updated_at', user_id: `eq.${userId}`, limit: '1' }));
      if (!res.ok) return res;
      return { ok: true, data: Array.isArray(res.data) ? (res.data[0] ?? null) : null, error: null };
    },

    deleteGame(userId) {
      return request(savedGame({ user_id: `eq.${userId}` }), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    },
  };
}
