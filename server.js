import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
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
const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const USER_ROLES = new Set(['platform_admin', 'company_admin', 'operator', 'viewer']);
const loginAttempts = new Map();
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

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
function sessionUser(req) {
  const token = bearerToken(req);
  if (!token || token.length > 200) return null;
  return db.getSessionUser(crypto.createHash('sha256').update(token).digest('hex')) || null;
}
function loginBlocked(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.startedAt > 15 * 60 * 1000) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= 8;
}
function audit(action, user = null, targetType = null, targetId = null, metadata = {}) {
  try {
    db.addAuditLog({
      company_id: user?.company_id || null,
      actor_user_id: user?.id || null,
      action, target_type: targetType, target_id: targetId,
      metadata,
    });
  } catch (error) {
    console.error('[AUDITORIA] Falha ao registrar evento:', error.message);
  }
}
function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.startedAt > 15 * 60 * 1000) loginAttempts.set(ip, { count: 1, startedAt: now });
  else entry.count += 1;
}

app.post('/auth/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (loginBlocked(ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || email.length > 254 || password.length > 1024) return res.status(400).json({ ok: false, error: 'Credenciais inválidas.' });
  const user = db.getUserByEmail(email);
  const salt = user?.password_salt || 'veyrion-login-dummy-salt';
  const candidate = await scrypt(password, salt, 64);
  const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
  if (!user || !user.active || expected.length !== candidate.length || !crypto.timingSafeEqual(expected, candidate)) {
    recordLoginFailure(ip);
    return res.status(401).json({ ok: false, error: 'E-mail ou senha inválidos.' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.createUserSession(crypto.createHash('sha256').update(token).digest('hex'), user.id, expiresAt);
  db.updateUserLogin(user.id);
  audit('auth.login', user, 'user', String(user.id));
  return res.json({ ok: true, token, expires_at: expiresAt, user: { id: user.id, email: user.email, role: user.role, company_id: user.company_id } });
});

app.get('/auth/me', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  return res.json({ ok: true, user: { id: user.id, email: user.email, role: user.role, company_id: user.company_id } });
});

app.post('/auth/logout', (req, res) => {
  const token = bearerToken(req);
  const user = sessionUser(req);
  if (token) db.deleteUserSession(crypto.createHash('sha256').update(token).digest('hex'));
  if (user) audit('auth.logout', user, 'user', String(user.id));
  return res.json({ ok: true });
});

app.post('/auth/change-password', async (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
  const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
  if (newPassword.length < 12 || newPassword.length > 1024) {
    return res.status(400).json({ ok: false, error: 'A nova senha deve ter entre 12 e 1024 caracteres.' });
  }
  const stored = db.getUserByEmail(user.email);
  const candidate = await scrypt(currentPassword, stored.password_salt, 64);
  const expected = Buffer.from(stored.password_hash, 'hex');
  if (expected.length !== candidate.length || !crypto.timingSafeEqual(expected, candidate)) {
    return res.status(401).json({ ok: false, error: 'Senha atual incorreta.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(newPassword, salt, 64);
  db.changeUserPassword(user.id, hash.toString('hex'), salt);
  const token = bearerToken(req);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.revokeOtherUserSessions(user.id, tokenHash);
  audit('auth.password_changed', user, 'user', String(user.id));
  return res.json({ ok: true, message: 'Senha alterada. Outras sessões foram encerradas.' });
});

app.get('/tenant/audit', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  if (!user.company_id || !['company_admin', 'operator', 'viewer'].includes(user.role)) return res.sendStatus(403);
  if (user.role !== 'company_admin') return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, logs: db.getCompanyAuditLogs(user.company_id, req.query.limit) });
});

app.get('/admin/audit', (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, logs: db.getAuditLogs(req.query.limit) });
});

app.get('/admin/users', (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, users: db.listUsers() });
});

app.post('/admin/users', async (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  const { email, password, role, company_id: companyId = null } = req.body || {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    return res.status(400).json({ ok: false, error: 'A senha deve ter entre 12 e 1024 caracteres.' });
  }
  if (!USER_ROLES.has(role)) return res.status(400).json({ ok: false, error: 'Papel de usuário inválido.' });
  refreshCompanies();
  if (role === 'platform_admin' ? companyId !== null : (typeof companyId !== 'string' || !companies[companyId])) {
    return res.status(400).json({ ok: false, error: 'Vínculo de empresa inválido para este papel.' });
  }
  if (db.getUserByEmail(email.trim().toLowerCase())) return res.status(409).json({ ok: false, error: 'Este e-mail já está cadastrado.' });
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt, 64);
    const id = db.createUser({ email: email.trim().toLowerCase(), password_hash: hash.toString('hex'), password_salt: salt, role, company_id: companyId });
    audit('admin.user_created', null, 'user', String(id), { role, company_id: companyId });
    return res.status(201).json({ ok: true, user: db.getUserById(id) });
  } catch (error) {
    console.error('[ADMIN] Falha ao criar usuário:', error);
    return res.status(500).json({ ok: false, error: 'Não foi possível criar o usuário.' });
  }
});

app.get('/tenant/users', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  if (user.role !== 'company_admin' || !user.company_id) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, users: db.listCompanyUsers(user.company_id) });
});

app.post('/tenant/users', async (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  if (user.role !== 'company_admin' || !user.company_id) return res.sendStatus(403);
  const { email, password, role } = req.body || {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    return res.status(400).json({ ok: false, error: 'A senha deve ter entre 12 e 1024 caracteres.' });
  }
  if (!['operator', 'viewer'].includes(role)) return res.status(400).json({ ok: false, error: 'O administrador da empresa pode criar apenas operadores e visualizadores.' });
  if (db.getUserByEmail(email.trim().toLowerCase())) return res.status(409).json({ ok: false, error: 'Este e-mail já está cadastrado.' });
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await scrypt(password, salt, 64);
    const id = db.createUser({ email: email.trim().toLowerCase(), password_hash: hash.toString('hex'), password_salt: salt, role, company_id: user.company_id });
    audit('tenant.user_created', user, 'user', String(id), { role });
    return res.status(201).json({ ok: true, user: db.getUserById(id) });
  } catch (error) {
    console.error('[TENANT] Falha ao criar usuário da empresa:', error);
    return res.status(500).json({ ok: false, error: 'Não foi possível criar o usuário.' });
  }
});

app.post('/tenant/users/:id/disable', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  if (user.role !== 'company_admin' || !user.company_id) return res.sendStatus(403);
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1 || id === user.id) return res.sendStatus(400);
  const target = db.getUserById(id);
  if (!target || target.company_id !== user.company_id || !['operator', 'viewer'].includes(target.role)) return res.sendStatus(404);
  const disabled = db.disableUser(id) === 1;
  if (disabled) audit('tenant.user_disabled', user, 'user', String(id));
  return res.json({ ok: true, disabled });
});

app.get('/tenant/overview', (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.sendStatus(401);
  if (!user.company_id || !['company_admin', 'operator', 'viewer'].includes(user.role)) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  const limit = Number.parseInt(req.query.limit, 10) || 50;
  return res.json({ ok: true, company_id: user.company_id, ...db.getCompanyOverview(user.company_id, limit) });
});

app.post('/admin/users/:id/disable', (req, res) => {
  if (!isAdmin(req)) return res.sendStatus(401);
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) return res.sendStatus(400);
  const user = db.getUserById(id);
  if (!user) return res.sendStatus(404);
  if (!user.active) return res.json({ ok: true, already_disabled: true });
  const disabled = db.disableUser(id);
  if (disabled === 1) audit('admin.user_disabled', null, 'user', String(id));
  return res.json({ ok: true, disabled: disabled === 1 });
});

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
    audit('admin.company_created', null, 'company', id);
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
    audit('admin.company_updated', null, 'company', id);
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
  audit('admin.conversation_resumed', null, 'conversation', `${company}:${phone}`);
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
setInterval(db.purgeUserSessions, 3600 * 1000).unref();
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [ip, entry] of loginAttempts) if (entry.startedAt < cutoff) loginAttempts.delete(ip);
  while (loginAttempts.size > 10000) loginAttempts.delete(loginAttempts.keys().next().value);
}, 5 * 60 * 1000).unref();
app.listen(process.env.PORT || 3000, () => console.log('Agente no ar'));
