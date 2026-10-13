// Klient bazy Supabase przez REST API (PostgREST) — czysty fetch, bez bibliotek.
// Każda metoda zwraca { ok, data, error } i nigdy nie rzuca wyjątku:
// gra działa dalej także bez sieci i bez konfiguracji (error: 'offline').
import { PERSISTENCE } from './config.js';

const SCORE_COLUMNS = 'nick,difficulty,score,wave,created_at';

function fail(error) {
  return { ok: false, data: null, error };
}

// "0-0/42" albo "*/0" → 42 / 0; brak lub "*" → null
export function parseContentRangeTotal(header) {
  const total = Number(String(header ?? '').split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

// Klucz publishable (sb_publishable_…) idzie tylko w `apikey`;
// starszy klucz anon (JWT) także w Authorization.
function authHeaders(key) {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

export function createDb({ url, key, fetchFn = globalThis.fetch?.bind(globalThis), timeoutMs = PERSISTENCE.dbTimeoutMs } = {}) {
  const enabled = Boolean(url && key && fetchFn);
  const base = String(url ?? '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, headers = {}, keepalive = false } = {}) {
    if (!enabled) return fail('offline');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(base + path, {
        method,
        keepalive,
        signal: controller.signal,
        headers: { ...authHeaders(key), 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) return fail(`http-${res.status}`);
      const text = await res.text();
      return { ok: true, data: text ? JSON.parse(text) : null, error: null, headers: res.headers };
    } catch (e) {
      if (e?.name === 'AbortError') return fail('timeout');
      return fail(e instanceof SyntaxError ? 'bad-response' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  const rpc = (name, args, options = {}) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args, ...options });
  const query = (params) => `/rest/v1/scores?${new URLSearchParams(params)}`;

  return {
    enabled,

    submitScore({ deviceId, nick, difficulty, score, wave }) {
      return request('/rest/v1/scores', {
        method: 'POST',
        body: { device_id: deviceId, nick, difficulty, score, wave },
        headers: { Prefer: 'return=minimal' },
      });
    },

    topScores(difficulty, limit = PERSISTENCE.leaderboardSize) {
      return request(query({ select: SCORE_COLUMNS, difficulty: `eq.${difficulty}`, order: 'score.desc,created_at.asc', limit: String(limit) }));
    },

    // Miejsce w rankingu = liczba lepszych wyników + 1 (baza zwraca samą liczbę)
    async rankOf(difficulty, score) {
      const res = await request(
        query({ select: 'id', difficulty: `eq.${difficulty}`, score: `gt.${score}`, limit: '1' }),
        { headers: { Prefer: 'count=exact' } },
      );
      if (!res.ok) return res;
      const total = parseContentRangeTotal(res.headers?.get?.('content-range'));
      return total === null ? fail('bad-count') : { ok: true, data: total + 1, error: null };
    },

    // Przez funkcję w bazie — kolumna device_id nie jest publicznie czytelna
    myHistory(deviceId, limit = PERSISTENCE.historySize) {
      return rpc('my_history', { p_device_id: deviceId, p_limit: limit });
    },

    // keepalive: zapytanie dokończy się także po zamknięciu karty (limit 64 kB treści)
    saveGame(deviceId, nick, difficulty, snapshot, { keepalive = false } = {}) {
      return rpc('save_game', { p_device_id: deviceId, p_nick: nick, p_difficulty: difficulty, p_snapshot: snapshot }, { keepalive });
    },

    loadGame(deviceId) {
      return rpc('load_game', { p_device_id: deviceId });
    },

    deleteGame(deviceId) {
      return rpc('delete_game', { p_device_id: deviceId });
    },
  };
}
