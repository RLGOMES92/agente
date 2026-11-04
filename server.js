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
app.use(express.json({ verify: (req, _res, buf) => { req.raw = buf; } }));

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': t, 'hub.challenge': ch } = req.query;
  if (mode === 'subscribe' && t === process.env.VERIFY_TOKEN) return res.status(200).send(ch);
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  if (process.env.APP_SECRET) {
    const sig = req.get('x-hub-signature-256') || '';
    const exp = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET).update(req.raw).digest('hex');
    const ok = sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
    if (!ok) return res.sendStatus(401);
  }
  res.sendStatus(200);

  for (const entry of req.body.entry || [])
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const company = byPhoneId[v.metadata?.phone_number_id];
      if (!company) continue;
      for (const msg of v.messages || [])
        enqueue(`${company.id}:${msg.from}`, () => handle(company, msg).catch((e) => console.error(e)));
    }
});

const queues = new Map();
function enqueue(key, job) {
  const next = (queues.get(key) || Promise.resolve()).then(job);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}

async function handoff(company, phone, summary) {
  db.setPaused(company.id, phone, true);
  if (company.team_number) {
    await sendText(
      company, company.team_number,
      `🔔 *Transbordo* (${company.variables.NOME_EMPRESA})\nCliente: +${phone}\nMotivo: ${summary || 'não informado'}\nLink: https://wa.me/${phone}\n\nPara reativar o bot: #reativar ${phone}`
    ).catch((e) => console.error('Falha ao avisar equipe', e));
  }
}

async function handle(company, msg) {
  if (!db.markSeen(msg.id)) return;
  const phone = msg.from;

  if (phone === company.team_number) {
    const m = msg.text?.body?.match(/^#reativar\s+(\d+)/i);
    if (m) {
      db.setPaused(company.id, m[1], false);
      db.clearHistory(company.id, m[1]);
      await sendText(company, phone, `✅ Bot reativado para +${m[1]}.`);
    }
    return;
  }

  if (db.isPaused(company.id, phone)) return;

  if (msg.type !== 'text') {
    await sendText(company, phone, 'Recebi seu arquivo! 😊 Um atendente da equipe vai analisar em instantes.');
    return handoff(company, phone, `Cliente enviou ${msg.type}`);
  }

  db.addMessage(company.id, phone, 'user', msg.text.body);
  let raw;
  try {
    raw = await askClaude(company.system, db.getHistory(company.id, phone));
  } catch (e) {
    console.error('Erro Claude', e);
    await sendText(company, phone, FALLBACK_HANDOFF);
    return handoff(company, phone, 'Erro técnico na IA');
  }

  const { text, handoff: h, summary } = parseReply(raw);
  db.addMessage(company.id, phone, 'assistant', raw);
  await sendText(company, phone, text);
  if (h) await handoff(company, phone, summary);
}

app.post('/admin/resume', (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.get('x-admin-token') !== process.env.ADMIN_TOKEN) return res.sendStatus(401);
  const { company, phone } = req.body || {};
  if (!companies[company] || !phone) return res.sendStatus(400);
  db.setPaused(company, phone, false);
  db.clearHistory(company, phone);
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'agente-whatsapp' }));
setInterval(db.purgeSeen, 3600 * 1000);
app.listen(process.env.PORT || 3000, () => console.log('Agente no ar'));
