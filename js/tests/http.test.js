import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../http.js';

const reply = (status, body = '', headers = {}) => async () => ({
  ok: status < 400, status, headers: new Headers(headers), text: async () => body,
});

test('sukces: JSON z odpowiedzi, nagłówki, Content-Type', async () => {
  let init;
  const fetchFn = async (url, i) => { init = i; return reply(200, '{"a":1}', { 'x-test': '1' })(); };
  const res = await requestJson(fetchFn, 'https://x/y', { method: 'POST', body: { b: 2 }, headers: { apikey: 'k' }, timeoutMs: 100 });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { a: 1 });
  assert.equal(res.headers.get('x-test'), '1');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers.apikey, 'k');
  assert.equal(init.body, '{"b":2}');
});

test('błąd HTTP: kod i treść błędu (także nie-JSON)', async () => {
  const res = await requestJson(reply(422, '{"error_code":"weak_password"}'), 'https://x', { timeoutMs: 100 });
  assert.deepEqual([res.ok, res.status, res.error, res.data.error_code], [false, 422, 'http-422', 'weak_password']);
  const html = await requestJson(reply(502, '<html>Bad gateway</html>'), 'https://x', { timeoutMs: 100 });
  assert.deepEqual([html.ok, html.status, html.error, html.data], [false, 502, 'http-502', null]);
});

test('sieć, zła odpowiedź, timeout — bez wyjątków', async () => {
  const down = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await requestJson(down, 'https://x', { timeoutMs: 100 }), { ok: false, status: 0, data: null, error: 'network', headers: null });
  const bad = await requestJson(reply(200, '{zepsuty'), 'https://x', { timeoutMs: 100 });
  assert.equal(bad.error, 'bad-response');
  const hanging = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  assert.equal((await requestJson(hanging, 'https://x', { timeoutMs: 10 })).error, 'timeout');
});
