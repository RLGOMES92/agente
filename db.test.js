import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-tenant-test-'));
process.env.DB_PATH = path.join(directory, 'test.db');
const db = await import('./db.js');

after(() => {
  db.closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('visões e auditoria de empresa não retornam dados de outro tenant', () => {
  db.touchConversation('empresa-a', '5511999990001');
  db.addMessage('empresa-a', '5511999990001', 'user', 'mensagem privada A');
  db.touchConversation('empresa-b', '5511999990002');
  db.addMessage('empresa-b', '5511999990002', 'user', 'mensagem privada B');

  db.addAuditLog({ company_id: 'empresa-a', action: 'tenant.a', metadata: {} });
  db.addAuditLog({ company_id: 'empresa-b', action: 'tenant.b', metadata: {} });

  const overviewA = db.getCompanyOverview('empresa-a');
  assert.equal(overviewA.companies.length, 1);
  assert.equal(overviewA.companies[0].company, 'empresa-a');
  assert.equal(overviewA.recent.length, 1);
  assert.equal(overviewA.recent[0].last_message, 'mensagem privada A');

  const auditA = db.getCompanyAuditLogs('empresa-a');
  assert.equal(auditA.length, 1);
  assert.equal(auditA[0].action, 'tenant.a');
  assert.equal(auditA.some((entry) => entry.company_id === 'empresa-b'), false);
});

test('desativar usuário revoga imediatamente suas sessões', () => {
  const id = db.createUser({
    email: 'operador@empresa-a.test',
    password_hash: 'hash-de-teste',
    password_salt: 'salt-de-teste',
    role: 'operator',
    company_id: 'empresa-a',
  });
  const tokenHash = crypto.createHash('sha256').update('token-de-teste').digest('hex');
  db.createUserSession(tokenHash, id, Date.now() + 60_000);
  assert.equal(db.getSessionUser(tokenHash).id, id);
  assert.equal(db.disableUser(id), 1);
  assert.equal(db.getSessionUser(tokenHash), undefined);
  assert.equal(db.getUserById(id).active, 0);
});
