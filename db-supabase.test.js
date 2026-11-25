import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only-server-key';

const db = await import('./db-supabase.js');
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJsonFetch(handler) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    const body = await handler(url, init, calls.length);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return calls;
}

test('getHistory sempre restringe a consulta ao tenant e telefone', async () => {
  const calls = mockJsonFetch(async () => [
    { role: 'assistant', content: 'resposta' },
    { role: 'user', content: 'pergunta' },
  ]);

  const history = await db.getHistory('tenant-a', '5511999990001');

  assert.deepEqual(history, [
    { role: 'user', content: 'pergunta' },
    { role: 'assistant', content: 'resposta' },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('company_id'), 'eq.tenant-a');
  assert.equal(calls[0].url.searchParams.get('phone'), 'eq.5511999990001');
});

test('clearHistory não remove mensagens de outros tenants ou telefones', async () => {
  const calls = mockJsonFetch(async () => null);

  await db.clearHistory('tenant-a', '5511999990001');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].url.searchParams.get('company_id'), 'eq.tenant-a');
  assert.equal(calls[0].url.searchParams.get('phone'), 'eq.5511999990001');
});

test('getCompanyOverview filtra conversas e mensagens pelo mesmo tenant', async () => {
  const calls = mockJsonFetch(async (url) => {
    if (url.pathname.endsWith('/conversations')) {
      return [{
        company_id: 'tenant-a',
        phone: '5511999990001',
        paused: false,
        updated_at: '2026-11-26T10:00:00.000Z',
      }];
    }
    if (url.pathname.endsWith('/messages')) {
      return [{
        company_id: 'tenant-a',
        phone: '5511999990001',
        content: 'mensagem do tenant A',
        created_at: '2026-11-26T10:01:00.000Z',
      }];
    }
    throw new Error(`Unexpected table: ${url.pathname}`);
  });

  const overview = await db.getCompanyOverview('tenant-a');

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url.searchParams.get('company_id'), 'eq.tenant-a');
  }
  assert.equal(overview.recent.length, 1);
  assert.equal(overview.recent[0].company, 'tenant-a');
  assert.equal(overview.recent[0].last_message, 'mensagem do tenant A');
});

test('listCompanyUsers não consulta usuários de outras empresas', async () => {
  const calls = mockJsonFetch(async () => [{
    id: 7,
    email: 'operator@tenant-a.test',
    role: 'operator',
    company_id: 'tenant-a',
    active: true,
    created_at: '2026-11-26T10:00:00.000Z',
    last_login_at: null,
  }]);

  const users = await db.listCompanyUsers('tenant-a');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('company_id'), 'eq.tenant-a');
  assert.equal(users.length, 1);
  assert.equal(users[0].company_id, 'tenant-a');
});
