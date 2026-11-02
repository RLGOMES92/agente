// Simulador no terminal, sem WhatsApp. Uso: npm run chat dapaz
import 'dotenv/config';
import readline from 'node:readline/promises';
import { loadCompanies, askClaude, parseReply } from './agent.js';

const id = process.argv[2] || 'dapaz';
const company = loadCompanies()[id];
if (!company) { console.error(`Empresa "${id}" não encontrada em companies/`); process.exit(1); }

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const history = [];
console.log(`Simulando atendimento da ${company.variables.NOME_EMPRESA}. Ctrl+C para sair.\n`);
while (true) {
  const q = await rl.question('Cliente: ');
  history.push({ role: 'user', content: q });
  const raw = await askClaude(company.system, history.slice(-20));
  const { text, handoff, summary } = parseReply(raw);
  history.push({ role: 'assistant', content: raw });
  console.log(`\nAgente: ${text}`);
  if (handoff) console.log(`[BOT PAUSADO | resumo para a equipe: ${summary}]`);
  console.log();
  if (handoff) history.length = 0;
}
