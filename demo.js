// Demonstração local sem API paga e sem WhatsApp.
// Este modo usa respostas simuladas; não representa a qualidade/resposta do Claude.
import 'dotenv/config';
import readline from 'node:readline/promises';
import { loadCompanies, parseReply } from './agent.js';

const id = process.argv[2] || 'dapaz';
const company = loadCompanies()[id];
if (!company) {
  console.error(`Empresa "${id}" não encontrada em companies/.`);
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let paused = false;
console.log(`DEMONSTRAÇÃO LOCAL — ${company.variables.NOME_EMPRESA}`);
console.log('Sem cobrança de IA e sem conexão com WhatsApp. Digite "sair" para encerrar.\n');

function mockReply(message) {
  const q = message.toLowerCase();
  if (/humano|pessoa|atendente|reclama|problema|preço|preco|valor|quanto|prazo|agenda|disponibilidade/.test(q)) {
    return 'Vou encaminhar você para nossa equipe confirmar essas informações. 😊\n[TRANSBORDO_HUMANO]\n[RESUMO: cliente solicitou atendimento humano ou informação que precisa de confirmação]';
  }
  if (/bolo|doce|topo|produto|serviço|servico/.test(q)) {
    return 'Trabalhamos com bolos personalizados, bolos de aniversário, bolos temáticos, doces personalizados e topos de bolo. 🎂✨\nPara qual data você precisa do pedido?';
  }
  if (/oi|olá|ola|bom dia|boa tarde|boa noite/.test(q)) {
    return 'Olá! Seja bem-vindo(a) à DaPaz Confeitaria! 🎂✨ Como posso ajudar você hoje?';
  }
  return 'Que bom receber sua mensagem! 😊 Você procura um bolo, doces personalizados ou um topo de bolo?';
}

while (true) {
  const input = await rl.question(paused ? '[BOT PAUSADO] Cliente: ' : 'Cliente: ');
  if (input.trim().toLowerCase() === 'sair') break;
  if (paused) {
    console.log('Agente automático pausado. A equipe assumiria esta conversa.\n');
    continue;
  }
  const result = parseReply(mockReply(input));
  console.log(`\nAgente: ${result.text}`);
  if (result.handoff) {
    paused = true;
    console.log(`[SIMULAÇÃO DE TRANSBORDO | ${result.summary}]`);
  }
  console.log();
}
rl.close();
