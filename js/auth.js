// Logowanie graczy przez Supabase Auth (REST /auth/v1) — czysty fetch, bez bibliotek.
// Gracz podaje login i hasło; Supabase wymaga e-maila, więc login zamieniamy na
// techniczny adres (niewidoczny dla gracza). Sesja w localStorage (bez hasła),
// token odświeżany automatycznie. Metody nie rzucają wyjątków.
import { AUTH, PERSISTENCE } from './config.js';
import { defaultBackend } from './storage.js';
import { isValidNick, normalizeNick } from './profile.js';
import { requestJson } from './http.js';

export const SESSION_KEY = 'arcaneInvaders.session';

// Kody błędów Supabase Auth → kody gry (komunikaty po polsku w render.js)
const ERROR_CODES = {
  user_already_exists: 'login-zajety',
  email_exists: 'login-zajety',
  invalid_credentials: 'zle-dane',
  weak_password: 'slabe-haslo',
};

// Login → techniczny e-mail: małe litery, bajty UTF-8 jako hex (polskie litery bezpieczne).
// null, gdy część lokalna adresu przekroczyłaby 64 znaki.
export function loginToEmail(login) {
  const bytes = new TextEncoder().encode(normalizeNick(login).toLowerCase());
  const local = `u${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  return local.length <= 64 ? `${local}@${AUTH.emailDomain}` : null;
}

function isSession(s) {
  return Boolean(s) && typeof s.access_token === 'string' && typeof s.refresh_token === 'string'
    && Number.isFinite(s.expires_at) && typeof s.user?.id === 'string' && typeof s.user?.login === 'string';
}

// Odpowiedź Supabase → zapisywana sesja (login z danych rejestracji)
function toSession(data, now) {
  const session = {
    access_token: data?.access_token,
    refresh_token: data?.refresh_token,
    // Liczymy od własnego zegara: przy przestawionym zegarze komputera expires_at serwera myli
    expires_at: Number.isFinite(data?.expires_in) ? Math.floor(now() / 1000) + data.expires_in
      : Number.isFinite(data?.expires_at) ? data.expires_at : Math.floor(now() / 1000) + 3600,
    user: { id: data?.user?.id, login: data?.user?.user_metadata?.login },
  };
  return isSession(session) ? session : null;
}

export function createAuth({
  url, key, fetchFn = globalThis.fetch?.bind(globalThis), backend = defaultBackend(),
  now = () => Date.now(), timeoutMs = PERSISTENCE.dbTimeoutMs,
} = {}) {
  const enabled = Boolean(url && key && fetchFn);
  const base = String(url ?? '').replace(/\/+$/, '');
  let refreshing = null; // trwające odświeżanie — równoczesne getToken czekają na to samo

  function load() {
    try {
      const s = JSON.parse(backend?.getItem(SESSION_KEY) ?? 'null');
      return isSession(s) ? s : null;
    } catch {
      return null; // uszkodzona sesja — gracz jest gościem
    }
  }

  let session = load();

  function store(next) {
    session = next;
    try {
      backend?.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      // brak dostępu — sesja tylko w pamięci
    }
  }

  const call = (path, body, headers = {}) =>
    requestJson(fetchFn, base + path, { method: 'POST', body, timeoutMs, headers: { apikey: key, ...headers } });

  // Kod błędu dla gracza: brak sieci, znany błąd Supabase, limit prób, błąd serwera, inne
  function errorOf(res) {
    if (!res.status) return res.error; // network / timeout / bad-response
    if (ERROR_CODES[res.data?.error_code]) return ERROR_CODES[res.data.error_code];
    if (res.status === 429) return 'za-duzo-prob';
    return res.status >= 500 ? 'blad-serwera' : 'nieudane';
  }

  // Rejestracja / logowanie: zapisuje sesję albo zwraca kod błędu
  async function start(path, body) {
    if (!enabled) return { ok: false, error: 'offline' };
    const res = await call(path, body);
    if (!res.ok) return { ok: false, error: errorOf(res) };
    const next = toSession(res.data, now);
    if (!next) return { ok: false, error: res.data?.id && !res.data?.access_token ? 'potwierdz-email' : 'bad-response' };
    store(next);
    return { ok: true, error: null };
  }

  // Inna karta mogła już odświeżyć sesję (refresh token jest jednorazowy) — przejmujemy nowszą
  function adoptNewerStored() {
    const stored = load();
    if (stored && stored.user.id === session.user.id && stored.refresh_token !== session.refresh_token
      && stored.expires_at > session.expires_at) session = stored;
  }

  async function refresh() {
    const current = session;
    const res = await call('/auth/v1/token?grant_type=refresh_token', { refresh_token: current.refresh_token });
    if (session !== current) return null; // w międzyczasie wylogowanie lub nowe logowanie — nie oddajemy cudzego tokenu
    const next = res.ok ? toSession(res.data, now) : null;
    if (next) {
      store(next);
      return next.access_token;
    }
    if ([400, 401, 403].includes(res.status)) {
      // Serwer odrzucił sesję (np. konto usunięte) — gracz staje się gościem.
      // Limit prób (429) i błędy serwera traktujemy jak brak sieci.
      store(null);
      auth.onSessionLost?.();
      return null;
    }
    return current.access_token; // brak sieci / limit / błąd serwera — sesja zostaje
  }

  const auth = {
    onSessionLost: null,

    get user() {
      return session?.user ?? null;
    },

    signUp(login, password) {
      const email = isValidNick(login) ? loginToEmail(login) : null;
      if (!email) return Promise.resolve({ ok: false, error: 'zly-login' });
      if (String(password ?? '').length < AUTH.passwordMin) return Promise.resolve({ ok: false, error: 'slabe-haslo' });
      return start('/auth/v1/signup', { email, password, data: { login: normalizeNick(login) } });
    },

    signIn(login, password) {
      const email = isValidNick(login) ? loginToEmail(login) : null;
      if (!email) return Promise.resolve({ ok: false, error: 'zle-dane' });
      return start('/auth/v1/token?grant_type=password', { email, password });
    },

    async signOut() {
      const token = session?.access_token;
      store(null);
      refreshing = null;
      // scope=local: wylogowanie tylko tego urządzenia, inne zostają zalogowane
      if (enabled && token) await call('/auth/v1/logout?scope=local', undefined, { Authorization: `Bearer ${token}` });
      return { ok: true, error: null };
    },

    // Ważny token zalogowanego gracza (odświeżany, gdy zaraz wygaśnie) albo null
    async getToken() {
      if (!session) return null;
      adoptNewerStored();
      if (session.expires_at - now() / 1000 > AUTH.refreshMarginS) return session.access_token;
      refreshing ??= refresh().finally(() => { refreshing = null; });
      return refreshing;
    },
  };

  return auth;
}
