// Wspólne zapytanie HTTP z JSON-em: limit czasu, nigdy nie rzuca wyjątku.
// Zwraca { ok, status, data, error, headers }. Przy błędzie HTTP `data` to treść
// odpowiedzi (np. kod błędu Supabase Auth), a `error` = 'http-<status>'.
// Błąd sieci / timeout: status 0, error 'network' | 'timeout' | 'bad-response'.
export async function requestJson(fetchFn, url, { method = 'GET', headers = {}, body, keepalive = false, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method,
      keepalive,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      if (res.ok) throw e; // treść błędu bywa HTML-em — wtedy wystarczy sam kod
    }
    if (!res.ok) return { ok: false, status: res.status, data, error: `http-${res.status}`, headers: res.headers };
    return { ok: true, status: res.status, data, error: null, headers: res.headers };
  } catch (e) {
    let error = 'network';
    if (e?.name === 'AbortError') error = 'timeout';
    else if (e instanceof SyntaxError) error = 'bad-response';
    return { ok: false, status: 0, data: null, error, headers: null };
  } finally {
    clearTimeout(timer);
  }
}
