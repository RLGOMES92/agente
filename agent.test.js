import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReply, FALLBACK_HANDOFF, loadCompanies } from './agent.js';

test('carrega a configuração da DaPaz', () => {
  const companies = loadCompanies();
  assert.ok(companies.dapaz);
  assert.equal(companies.dapaz.variables.NOME_EMPRESA, 'DaPaz Confeitaria');
});

test('mantém resposta normal sem transbordo', () => {
  assert.deepEqual(parseReply('Olá! Como posso ajudar?'), {
    text: 'Olá! Como posso ajudar?',
    handoff: false,
    summary: ''
  });
});

test('remove as tags e identifica transbordo', () => {
  assert.deepEqual(parseReply('Vou chamar a equipe.\n[TRANSBORDO_HUMANO]\n[RESUMO: pedido personalizado]'), {
    text: 'Vou chamar a equipe.',
    handoff: true,
    summary: 'pedido personalizado'
  });
});

test('bloqueia placeholder antes de enviar ao cliente', () => {
  const result = parseReply('Preço: {{PRECO}}');
  assert.equal(result.handoff, true);
  assert.equal(result.text, FALLBACK_HANDOFF);
});
