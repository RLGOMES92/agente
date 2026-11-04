import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { loadCompanies, askClaude, parseReply, FALLBACK_HANDOFF } from './agent.js';
import { sendText } from './whatsapp.js';
import * as db from './db.js';

const companies = loadCompanies();
const byPhoneId = Object.fromEntries(Object.values(companies).filter((c) => c.phone_number_id).map((c) => [c.phone_number_id, c]));
console.log('Empresas carregadas:', Object.keys(companies).join(', '));
for (const company of Object.values(companies)) {
  if (!company.phone_number_id) console.warn(`[CONFIG] ${company.id}: phone_number_id ainda não configurado; WhatsApp não receberá mensagens.`);
  if (!company.team_number) console.warn(`[CONFIG] ${company.id}: team_number ainda não configurado; avisos de transbordo não serão enviados.`);
}
if (!process.env.APP_SECRET) console.warn('[SEGURANÇA] APP_SECRET ausente: validação da assinatura dos webhooks está desativada.');

const app = express();
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
  return Boolean(process.env.ADMIN_TOKEN) && req.get('x-admin-token') === process.env.ADMIN_TOKEN;
}

app.get('/admin/overview', (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  return res.json({ ok: true, ...db.getOverview(limit) });
});

app.post('/admin/resume', (req, res) => {
  if (!isAdmin(req)) {
    return res.sendStatus(401);
  }
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
