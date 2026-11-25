import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.VERCEL = '1';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only-server-key';
delete process.env.APP_SECRET;

const realFetch = globalThis.fetch;
let ipFailures = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.hostname !== 'example.supabase.co') return realFetch(input, init);

  if (url.pathname.endsWith('/companies')) {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.pathname.endsWith('/check_login_attempts')) {
    return new Response('false', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.pathname.endsWith('/record_login_failure')) {
    ipFailures += 1;
    return new Response(ipFailures >= 8 ? 'true' : 'false', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  throw new Error(`Unexpected Supabase request: ${url.pathname}`);
};

const { default: app } = await import('./server.js');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  globalThis.fetch = realFetch;
});

test('tentativas de login com formato inválido também consomem o limite por IP', async () => {
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    const response = await realFetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '', password: 'senha-invalida' }),
    });
    assert.equal(response.status, 400, `attempt ${attempt}`);
  }

  const eighth = await realFetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '', password: 'senha-invalida' }),
  });
  assert.equal(eighth.status, 429);
  assert.equal(ipFailures, 8);
});
