import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const root = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic(); // usa ANTHROPIC_API_KEY
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';

function fill(tpl, vars, id) {
  const s = tpl.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? String(vars[k]).trim() : m));
  const left = s.match(/\{\{[A-Z_]+\}\}/g);
  if (left) throw new Error(`Empresa "${id}": variáveis faltando: ${[...new Set(left)].join(', ')}`);
  return s;
}

export function loadCompanies() {
  const tpl = fs.readFileSync(path.join(root, 'prompt.template.txt'), 'utf8');
  const dir = path.join(root, 'companies');
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    c.id = f.replace('.json', '');
    c.system = fill(tpl, c.variables, c.id);
    out[c.id] = c;
  }
  return out;
}

export async function askClaude(system, history) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    messages: history,
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export const FALLBACK_HANDOFF =
  'Vou conectar você com um de nossos especialistas para prosseguir. Só um instante! 😊';

// Separa texto do cliente, gatilho de transbordo e resumo
export function parseReply(raw) {
  let handoff = /\[TRANSBORDO_HUMANO\]/.test(raw);
  const m = raw.match(/\[RESUMO:\s*([\s\S]*?)\]/);
  let summary = m ? m[1].trim() : '';
  let text = raw
    .replace(/\[TRANSBORDO_HUMANO\]/g, '')
    .replace(/\[RESUMO:[\s\S]*?\]/g, '')
    .trim();
  // Trava de segurança: nunca deixar vazar variável/placeholder ao cliente
  if (/\{\{|\[PREENCHER/.test(text)) {
    handoff = true;
    summary = summary || 'Resposta bloqueada: continha placeholder não preenchido';
    text = FALLBACK_HANDOFF;
  }
  if (handoff && !text) text = FALLBACK_HANDOFF;
  return { text, handoff, summary };
}
