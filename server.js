import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadCompanies, askClaude, parseReply, FALLBACK_HANDOFF } from './agent.js';
import { sendText } from './whatsapp.js';
import * as db from './db.js';

let companies = loadCompanies();
let byPhoneId = {};
function refreshCompanies() {
  companies = loadCompanies();
  byPhoneId = Object.fromEntries(Object.values(companies).filter((c) => c.phone_number_id).map((c) => [c.phone_number_id, c]));
  return companies;
}
refreshCompanies();
console.log('Empresas carregadas:', Object.keys(companies).join(', '));
for (const company of Object.values(companies)) {
  if (!company.phone_number_id) console.warn(`[CONFIG] ${company.id}: phone_number_id ainda não configurado; WhatsApp não receberá mensagens.`);
  if (!company.team_number) console.warn(`[CONFIG] ${company.id}: team_number ainda não configurado; avisos de transbordo não serão enviados.`);
}
if (!process.env.APP_SECRET) console.warn('[SEGURANÇA] APP_SECRET ausente: validação da assinatura dos webhooks está desativada.');

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const companiesDir = path.join(root, 'companies');
const companyIdPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const tokenEnvPattern = /^[A-Z][A-Z0-9_]{2,63}$/;
const companyVariableKeys = [
  'NOME_EMPRESA', 'OBJETIVO_FINAL', 'TOM_DE_VOZ', 'EMOJIS',
  'REGRAS_ESPECIFICAS', 'DADOS_INSTITUCIONAIS', 'CATALOGO_PRECOS',
  'RESTRICOES', 'LINK_FECHAMENTO', 'PERGUNTA_QUALIFICACAO',
  'REGRA_DE_FECHAMENTO', 'DESCRICAO_CURTA_NEGOCIO',
];
function validateCompanyConfig(id, input) {
  if (!companyIdPattern.test(id) || id.startsWith('_')) return 'Identificador inválido.';
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Configuração inválida.';
  if (typeof input.phone_number_id !== 'string' || input.phone_number_id.length > 80) return 'phone_number_id inválido.';
  if (typeof input.team_number !== 'string' || (input.team_number && !/^\d{8,15}$/.test(input.team_number))) return 'team_number deve conter de 8 a 15 dígitos.';
  if (typeof input.token_env !== 'string' || !tokenEnvPattern.test(input.token_env)) return 'token_env inválido.';
  if (!input.variables || typeof input.variables !== 'object' || Array.isArray(input.variables)) return 'variables é obrigatório.';
  for (const key of companyVariableKeys) {
    const value = input.variables[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 4000) return `Campo variables.${key} inválido.`;
  }
  const duplicate = Object.values(companies).find((company) => company.id !== id && input.phone_number_id && company.phone_number_id === input.phone_number_id);
  if (duplicate) return 'Este phone_number_id já está associado a outra empresa.';
  return null;
}
function safeCompanyConfig(company) {
  return {
    id: company.id,
    phone_number_id: company.phone_number_id || '',
    token_env: company.token_env,
    team_number: company.team_number || '',
    variables: company.variables || {},
  };
}
async function writeCompanyConfig(id, input) {
  const destination = path.join(companiesDir, `${id}.json`);
  const temporary = path.join(companiesDir, `.${id}.json.tmp`);
  const config = {
    id,
    phone_number_id: input.phone_number_id || '',
    token_env: input.token_env,
    team_number: input.team_number || '',
    variables: input.variables,
  };
  await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temporary, destination);
}

app.use('/painel', express.static(path.join(root, 'public'), { index: 'index.html', maxAge: '1h' }));
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.raw = buf; } }));

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN && process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  if (process.env.APP_SECRET) {
    const signature = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET).update(req.raw || Buffer.alloc(0)).digest('hex');
    const valid = signature.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) return res.sendStatus(401);
  }

  // Confirma o recebimento rapidamente; o processamento acontece na fila.
  res.sendStatus(200);

  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const company = byPhoneId[value.metadata?.phone_number_id];
      if (!company) continue;
      for (const message of value.messages || []) {
        if (!message?.id || !message?.from || !message?.type) {
          console.warn('[WEBHOOK] Mensagem ignorada: payload sem id, remetente ou tipo.');
          continue;
        }
        enqueue(`${company.id}:${message.from}`, () => handle(company, message));
      }
    }
  }
});

const queues = new Map();
function enqueue(key, job) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous
    .catch((error) => console.error('[FILA] Erro anterior:', error))
    .then(job)
    .catch((error) => console.error('[FILA] Falha ao processar conversa:', error));

  queues.set(key, next);
  void next.then(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

async function handoff(company, phone, summary) {
  db.setPaused(company.id, phone, true);
  if (!company.team_number) {
    console.warn(`[TRANSBORDO] ${company.id}: equipe sem team_number; conversa ${phone} foi pausada, mas não houve notificação.`);
    return;
  }

  const businessName = company.variables?.NOME_EMPRESA || company.id;
  const message = `🔔 *Transbordo* (${businessName})\nCliente: +${phone}\nMotivo: ${summary || 'não informado'}\nLink: https://wa.me/${phone}\n\nPara reativar o bot: #reativar ${phone}`;
  try {
    await sendText(company, company.team_number, message);
  } catch (error) {
    console.error('[TRANSBORDO] Conversa pausada, mas falhou o aviso à equipe:', error);
  }
}

async function notifyCustomer(company, phone, message) {
  try {
    await sendText(company, phone, message);
  } catch (error) {
    console.error(`[WHATSAPP] Falha ao responder ao cliente +${phone} (${company.id}):`, error);
  }
}

async function handle(company, msg) {
  if (!db.markSeen(msg.id)) return;
  const phone = msg.from;

  if (phone === company.team_number) {
    const command = msg.text?.body?.trim().match(/^#reativar\s+(\d{8,15})$/i);
    if (command) {
      db.setPaused(company.id, command[1], false);
      db.clearHistory(company.id, command[1]);
      await notifyCustomer(company, phone, `✅ Bot reativado para +${command[1]}.`);
    }
    return;
  }

  db.touchConversation(company.id, phone);
  if (db.isPaused(company.id, phone)) return;

  if (msg.type !== 'text' || typeof msg.text?.body !== 'string' || !msg.text.body.trim()) {
    await handoff(company, phone, `Cliente enviou conteúdo do tipo ${msg.type || 'desconhecido'}`);
    await notifyCustomer(company, phone, 'Recebi sua mensagem! 😊 Vou encaminhar para nossa equipe continuar o atendimento.');
    return;
  }

  db.addMessage(company.id, phone, 'user', msg.text.body.trim());
  let raw;
  try {
    raw = await askClaude(company.system, db.getHistory(company.id, phone));
  } catch (error) {
    console.error('[CLAUDE] Erro ao gerar resposta:', error);
    await handoff(company, phone, 'Erro técnico na IA');
    await notifyCustomer(company, phone, FALLBACK_HANDOFF);
    return;
  }

  const { text, handoff: shouldHandoff, summary } = parseReply(raw);
  db.addMessage(company.id, phone, 'assistant', raw);

  // Pausa e notifica a equipe antes de tentar enviar a resposta de transbordo.
  if (shouldHandoff) await handoff(company, phone, summary);
  await notifyCustomer(company, phone, text);
}

function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN || '';
  const provided = req.get('x-admin-token') || '';
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/admin/companies', (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  res.set('Cache-Control', 'no-store');
  refreshCompanies();
  return res.json({ ok: true, companies: Object.values(companies).map(safeCompanyConfig) });
});

app.post('/admin/companies', async (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  refreshCompanies();
  const { id, ...config } = req.body || {};
  if (typeof id !== 'string' || companies[id]) return res.status(400).json({ ok: false, error: 'ID inválido ou já cadastrado.' });
  const error = validateCompanyConfig(id, config);
  if (error) return res.status(400).json({ ok: false, error });
  try {
    await writeCompanyConfig(id, config);
    refreshCompanies();
    return res.status(201).json({ ok: true, company: safeCompanyConfig(companies[id]) });
  } catch (cause) {
    console.error('[ADMIN] Falha ao cadastrar empresa:', cause);
    return res.status(500).json({ ok: false, error: 'Não foi possível salvar a empresa.' });
  }
});

app.put('/admin/companies/:id', async (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  const { id } = req.params;
  refreshCompanies();
  if (!companies[id] || id.startsWith('_')) return res.sendStatus(404);
  const error = validateCompanyConfig(id, req.body);
  if (error) return res.status(400).json({ ok: false, error });
  try {
    await writeCompanyConfig(id, req.body);
    refreshCompanies();
    return res.json({ ok: true, company: safeCompanyConfig(companies[id]) });
  } catch (cause) {
    console.error('[ADMIN] Falha ao atualizar empresa:', cause);
    return res.status(500).json({ ok: false, error: 'Não foi possível atualizar a empresa.' });
  }
});

app.get('/admin/overview', (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  res.set('Cache-Control', 'no-store');
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  return res.json({ ok: true, ...db.getOverview(limit) });
});

app.post('/admin/resume', (req, res) => {
  if (!isAdmin(req)) {
    return res.sendStatus(401);
  }
  refreshCompanies();
  const { company, phone } = req.body || {};
  if (!companies[company] || typeof phone !== 'string' || !/^\d{8,15}$/.test(phone)) {
    return res.sendStatus(400);
  }
  db.setPaused(company, phone, false);
  db.clearHistory(company, phone);
  return res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({
  ok: true,
  service: 'agente-whatsapp',
  companies: Object.keys(companies).length,
  whatsappConfigured: Object.keys(byPhoneId).length > 0,
}));

app.use((error, _req, res, _next) => {
  console.error('[HTTP] Erro na requisição:', error);
  if (res.headersSent) return;
  return res.status(error.status || 400).json({ ok: false, error: 'Requisição inválida.' });
});

setInterval(db.purgeSeen, 3600 * 1000).unref();
app.listen(process.env.PORT || 3000, () => console.log('Agente no ar'));
