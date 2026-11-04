import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyMetaSignature } from './security.js';

test('aceita assinatura Meta válida sobre o corpo bruto', () => {
  const body = Buffer.from(JSON.stringify({ entry: [{ id: '123' }] }));
  const secret = 'test-app-secret';
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, signature, secret), true);
});

test('rejeita assinatura ausente, segredo ausente e corpo alterado', () => {
  const body = Buffer.from('{"event":"message"}');
  const secret = 'test-app-secret';
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, '', secret), false);
  assert.equal(verifyMetaSignature(body, signature, ''), false);
  assert.equal(verifyMetaSignature(Buffer.from('{"event":"changed"}'), signature, secret), false);
  assert.equal(verifyMetaSignature(null, signature, secret), false);
});
