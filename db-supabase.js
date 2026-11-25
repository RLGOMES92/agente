
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY no ambiente do servidor.');
  }
}

async function request(table, { method = 'GET', query = {}, body, prefer } = {}) {
  assertConfigured();
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = typeof data === 'object' ? (data?.message || data?.hint || data?.details || data?.error) : data;
    const error = new Error(`Supabase ${method} ${table} (${response.status}): ${message || 'request failed'}`);
    error.code = data?.code || null;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function rpc(name, params) {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error(`Supabase RPC ${name} (${response.status}): ${data?.message || 'request failed'}`);
  return data;
}

export async function isLoginBlocked(keys) {
  return Boolean(await rpc('check_login_attempts', { p_keys: keys }));
}

export async function recordLoginFailure(keys) {
  return Boolean(await rpc('record_login_failure', { p_keys: keys }));
}

export async function clearLoginAttempts(keys) {
  return rpc('clear_login_attempts', { p_keys: keys });
}

const iso = (value) => new Date(Number(value)).toISOString();
const ms = (value) => value ? new Date(value).getTime() : null;
const safeLimit = (value, fallback = 50, max = 100) =>
  Math.min(max, Math.max(1, Number(value) || fallback));

export async function listCompanies() {
  return request('companies', { query: { select: 'id,phone_number_id,token_env,team_number,variables,active', active: 'eq.true', order: 'id.asc' } });
}

export async function isPaused(companyId, phone) {
  const rows = await request('conversations', { query: { select: 'paused', company_id: `eq.${companyId}`, phone: `eq.${phone}`, limit: 1 } });
  return Boolean(rows?.[0]?.paused);
}

export async function setPaused(companyId, phone, paused) {
  return request('conversations', {
    method: 'POST',
    query: { on_conflict: 'company_id,phone' },
    body: { company_id: companyId, phone, paused: Boolean(paused), updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export async function touchConversation(companyId, phone) {
  return request('conversations', {
    method: 'POST',
    query: { on_conflict: 'company_id,phone' },
    body: { company_id: companyId, phone, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export async function addMessage(companyId, phone, role, content) {
  return request('messages', {
    method: 'POST',
    body: { company_id: companyId, phone, role, content },
    prefer: 'return=minimal',
  });
}

export async function getHistory(companyId, phone, limit = 20) {
  const rows = await request('messages', {
    query: {
      select: 'role,content',
      company_id: `eq.${companyId}`,
      phone: `eq.${phone}`,
      order: 'id.desc',
      limit: safeLimit(limit, 20, 100),
    },
  });
  return (rows || []).reverse();
}

export async function clearHistory(companyId, phone) {
  return request('messages', {
    method: 'DELETE',
    query: { company_id: `eq.${companyId}`, phone: `eq.${phone}` },
    prefer: 'return=minimal',
  });
}

export async function markSeen(id) {
  const rows = await request('seen_webhook_events', {
    method: 'POST',
    query: { on_conflict: 'id' },
    body: { id },
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  return Array.isArray(rows) && rows.length === 1;
}

export async function purgeSeen() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return request('seen_webhook_events', {
    method: 'DELETE',
    query: { created_at: `lt.${cutoff}` },
    prefer: 'return=minimal',
  });
}

async function recentRows(companyId, limit) {
  const query = {
    select: 'company_id,phone,paused,updated_at',
    order: 'updated_at.desc',
    limit: safeLimit(limit, 50, 100),
  };
  if (companyId) query.company_id = `eq.${companyId}`;
  const conversations = await request('conversations', { query });
  if (!conversations?.length) return [];
  const messages = await request('messages', {
    query: {
      select: 'company_id,phone,content,created_at',
      ...(companyId ? { company_id: `eq.${companyId}` } : {}),
      order: 'created_at.desc',
      limit: Math.min(1000, conversations.length * 20),
    },
  });
  const latest = new Map();
  for (const message of messages || []) {
    const key = `${message.company_id}:${message.phone}`;
    if (!latest.has(key)) latest.set(key, message);
  }
  return conversations.map((row) => {
    const last = latest.get(`${row.company_id}:${row.phone}`);
    return {
      company: row.company_id,
      phone: row.phone,
      paused: row.paused,
      updated: ms(row.updated_at),
      last_message: last?.content ? String(last.content).slice(0, 160) : null,
      last_message_at: ms(last?.created_at),
    };
  });
}

export async function getCompanyOverview(companyId, limit = 50) {
  const rows = await recentRows(companyId, limit);
  return {
    companies: [{ company: companyId, conversations: rows.length }],
    recent: rows,
  };
}

export async function getOverview(limit = 50) {
  const [companies, recent] = await Promise.all([
    listCompanies(),
    recentRows(null, limit),
  ]);
  const counts = new Map();
  for (const row of recent) {
    const item = counts.get(row.company) || { company: row.company, conversations: 0, paused: 0 };
    item.conversations += 1;
    if (row.paused) item.paused += 1;
    counts.set(row.company, item);
  }
  return {
    companies: companies.map((company) => counts.get(company.id) || { company: company.id, conversations: 0, paused: 0 }),
    recent,
  };
}

export async function createUser(user) {
  const rows = await request('users', {
    method: 'POST',
    body: {
      email: user.email,
      password_hash: user.password_hash,
      password_salt: user.password_salt,
      role: user.role,
      company_id: user.company_id ?? null,
    },
    prefer: 'return=representation',
  });
  return Number(rows?.[0]?.id);
}

export async function getUserByEmail(email) {
  const rows = await request('users', {
    query: { select: '*', email: `eq.${email}`, limit: 1 },
  });
  return rows?.[0];
}

export async function getUserById(id) {
  const rows = await request('users', {
    query: { select: 'id,email,role,company_id,active,created_at,last_login_at', id: `eq.${id}`, limit: 1 },
  });
  const user = rows?.[0];
  return user ? { ...user, id: Number(user.id), created_at: ms(user.created_at), last_login_at: ms(user.last_login_at) } : undefined;
}

async function listUsersQuery(companyId) {
  const query = {
    select: 'id,email,role,company_id,active,created_at,last_login_at',
    order: 'created_at.desc',
  };
  if (companyId) query.company_id = `eq.${companyId}`;
  const rows = await request('users', { query });
  return (rows || []).map((user) => ({
    ...user,
    id: Number(user.id),
    created_at: ms(user.created_at),
    last_login_at: ms(user.last_login_at),
  }));
}

export const listUsers = () => listUsersQuery(null);
export const listCompanyUsers = (companyId) => listUsersQuery(companyId);

export async function updateUserLogin(id) {
  return request('users', {
    method: 'PATCH',
    query: { id: `eq.${id}` },
    body: { last_login_at: new Date().toISOString() },
    prefer: 'return=minimal',
  });
}

export async function createUserSession(hash, userId, expiresAt) {
  return request('user_sessions', {
    method: 'POST',
    body: { token_hash: hash, user_id: userId, expires_at: iso(expiresAt) },
    prefer: 'return=minimal',
  });
}

export async function getSessionUser(hash) {
  const sessions = await request('user_sessions', {
    query: { select: 'user_id,expires_at', token_hash: `eq.${hash}`, expires_at: `gt.${new Date().toISOString()}`, limit: 1 },
  });
  if (!sessions?.length) return undefined;
  const user = await getUserById(sessions[0].user_id);
  return user?.active ? { ...user, expires_at: ms(sessions[0].expires_at) } : undefined;
}

export async function deleteUserSession(hash) {
  return request('user_sessions', {
    method: 'DELETE',
    query: { token_hash: `eq.${hash}` },
    prefer: 'return=minimal',
  });
}

export async function purgeUserSessions() {
  return request('user_sessions', {
    method: 'DELETE',
    query: { expires_at: `lte.${new Date().toISOString()}` },
    prefer: 'return=minimal',
  });
}

export async function changeUserPassword(id, hash, salt) {
  return request('users', {
    method: 'PATCH',
    query: { id: `eq.${id}` },
    body: { password_hash: hash, password_salt: salt },
    prefer: 'return=minimal',
  });
}

export async function revokeOtherUserSessions(id, keepHash) {
  return request('user_sessions', {
    method: 'DELETE',
    query: { user_id: `eq.${id}`, token_hash: `neq.${keepHash}` },
    prefer: 'return=minimal',
  });
}

export async function addAuditLog({ company_id = null, actor_user_id = null, action, target_type = null, target_id = null, metadata = {} }) {
  return request('audit_logs', {
    method: 'POST',
    body: { company_id, actor_user_id, action, target_type, target_id, metadata },
    prefer: 'return=minimal',
  });
}

export async function getAuditLogs(limit = 100) {
  const rows = await request('audit_logs', {
    query: { select: '*', order: 'id.desc', limit: safeLimit(limit, 100, 200) },
  });
  return (rows || []).map((row) => ({ ...row, id: Number(row.id), actor_user_id: row.actor_user_id == null ? null : Number(row.actor_user_id), created_at: ms(row.created_at) }));
}

export async function getCompanyAuditLogs(companyId, limit = 100) {
  const rows = await request('audit_logs', {
    query: { select: '*', company_id: `eq.${companyId}`, order: 'id.desc', limit: safeLimit(limit, 100, 200) },
  });
  return (rows || []).map((row) => ({ ...row, id: Number(row.id), actor_user_id: row.actor_user_id == null ? null : Number(row.actor_user_id), created_at: ms(row.created_at) }));
}

export async function disableUser(id) {
  const rows = await request('users', {
    method: 'PATCH',
    query: { id: `eq.${id}`, select: 'id' },
    body: { active: false },
    prefer: 'return=representation',
  });
  if (rows?.length) {
    await request('user_sessions', {
      method: 'DELETE',
      query: { user_id: `eq.${id}` },
      prefer: 'return=minimal',
    });
  }
  return rows?.length || 0;
}

export async function enqueueMessageJob(companyId, phone, message) {
  const rows = await request('message_jobs', {
    method: 'POST',
    query: { on_conflict: 'message_id' },
    body: {
      company_id: companyId,
      phone,
      message_id: message.id,
      payload: message,
    },
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  return Array.isArray(rows) && rows.length === 1;
}

export async function claimMessageJobs(limit = 10) {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_message_jobs`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_limit: safeLimit(limit, 10, 20) }),
  });
  const raw = await response.text();
  let rows;
  try { rows = raw ? JSON.parse(raw) : []; } catch { rows = []; }
  if (!response.ok) throw new Error(`Supabase claim_message_jobs (${response.status}): ${rows?.message || 'request failed'}`);
  return (rows || []).map((row) => ({ ...row, id: Number(row.id), attempts: Number(row.attempts) }));
}

export async function hasCustomerReplyForInbound(inboundId) {
  const rows = await request('message_outbox', {
    query: { select: 'id', idempotency_key: `eq.${inboundId}:customer`, limit: 1 },
  });
  return Array.isArray(rows) && rows.length > 0;
}

export async function saveInboundResponse(response) {
  await request('inbound_responses', {
    method: 'POST',
    query: { on_conflict: 'inbound_message_id' },
    body: {
      inbound_message_id: response.inbound_message_id,
      company_id: response.company_id,
      phone: response.phone,
      inbound_text: response.inbound_text || '',
      assistant_content: response.assistant_content,
      customer_reply: response.customer_reply,
      should_handoff: Boolean(response.should_handoff),
      handoff_summary: String(response.handoff_summary || '').slice(0, 1000),
    },
    prefer: 'resolution=ignore-duplicates,return=minimal',
  });
  return getInboundResponse(response.inbound_message_id);
}

export async function getInboundResponse(inboundId) {
  const rows = await request('inbound_responses', {
    query: {
      select: 'inbound_message_id,company_id,phone,inbound_text,assistant_content,customer_reply,should_handoff,handoff_summary,history_saved',
      inbound_message_id: `eq.${inboundId}`,
      limit: 1,
    },
  });
  return rows?.[0] || null;
}

export async function commitInboundResponseHistory(inboundId) {
  return Boolean(await rpc('commit_inbound_response_history', { p_inbound_message_id: inboundId }));
}

export async function purgeInboundResponses() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return request('inbound_responses', {
    method: 'DELETE',
    query: { created_at: `lt.${cutoff}` },
    prefer: 'return=minimal',
  });
}

export async function markHandoffInbound(companyId, phone, inboundId, summary = '') {
  return request('message_handoffs', {
    method: 'POST',
    query: { on_conflict: 'inbound_message_id' },
    body: {
      inbound_message_id: inboundId,
      company_id: companyId,
      phone,
      summary: String(summary || '').slice(0, 1000),
    },
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
}

export async function hasHandoffForInbound(inboundId) {
  const rows = await request('message_handoffs', {
    query: { select: 'inbound_message_id', inbound_message_id: `eq.${inboundId}`, limit: 1 },
  });
  return Array.isArray(rows) && rows.length > 0;
}

export async function getHandoffForInbound(inboundId) {
  const rows = await request('message_handoffs', {
    query: { select: 'company_id,phone,summary', inbound_message_id: `eq.${inboundId}`, limit: 1 },
  });
  return rows?.[0] || null;
}

export async function enqueueOutbound(companyId, destination, body, idempotencyKey) {
  const rows = await request('message_outbox', {
    method: 'POST',
    query: { on_conflict: 'idempotency_key' },
    body: { company_id: companyId, destination, body, idempotency_key: idempotencyKey },
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  return Array.isArray(rows) && rows.length === 1;
}

export async function claimOutbound(limit = 10) {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_message_outbox`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limit: safeLimit(limit, 10, 20) }),
  });
  const raw = await response.text();
  let rows;
  try { rows = raw ? JSON.parse(raw) : []; } catch { rows = []; }
  if (!response.ok) throw new Error(`Supabase claim_message_outbox (${response.status}): ${rows?.message || 'request failed'}`);
  return (rows || []).map(row => ({ ...row, id: Number(row.id), attempts: Number(row.attempts) }));
}

export async function completeOutbound(id, providerMessageId = null) {
  return request('message_outbox', {
    method: 'PATCH', query: { id: `eq.${id}` },
    body: { status: 'sent', sent_at: new Date().toISOString(), locked_at: null, provider_message_id: providerMessageId },
    prefer: 'return=minimal',
  });
}

export async function failOutbound(id, attempts, error) {
  const terminal = Number(attempts) >= 8;
  const delayMs = Math.min(60 * 60 * 1000, 30 * 1000 * 2 ** Math.max(0, Number(attempts) - 1));
  return request('message_outbox', {
    method: 'PATCH', query: { id: `eq.${id}` },
    body: {
      status: terminal ? 'failed' : 'pending',
      available_at: new Date(Date.now() + delayMs).toISOString(),
      locked_at: null,
      last_error: String(error?.message || error || 'unknown').slice(0, 1000),
    },
    prefer: 'return=minimal',
  });
}

export async function purgeOutbound() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return request('message_outbox', {
    method: 'DELETE',
    query: { status: 'in.(sent,failed)', created_at: `lt.${cutoff}` },
    prefer: 'return=minimal',
  });
}

export async function purgeHandoffs() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return request('message_handoffs', {
    method: 'DELETE',
    query: { created_at: `lt.${cutoff}` },
    prefer: 'return=minimal',
  });
}

export async function purgeMessageJobs() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return request('message_jobs', {
    method: 'DELETE',
    query: { status: 'in.(completed,failed)', created_at: `lt.${cutoff}` },
    prefer: 'return=minimal',
  });
}

export async function completeMessageJob(id) {
  return request('message_jobs', {
    method: 'PATCH',
    query: { id: `eq.${id}` },
    body: { status: 'completed', completed_at: new Date().toISOString(), locked_at: null },
    prefer: 'return=minimal',
  });
}

export async function failMessageJob(id, attempts, error) {
  const terminal = Number(attempts) >= 5;
  const delayMs = Math.min(15 * 60 * 1000, 2 ** Math.max(0, Number(attempts) - 1) * 30 * 1000);
  return request('message_jobs', {
    method: 'PATCH',
    query: { id: `eq.${id}` },
    body: {
      status: terminal ? 'failed' : 'pending',
      available_at: new Date(Date.now() + delayMs).toISOString(),
      locked_at: null,
      last_error: String(error?.message || error || 'unknown').slice(0, 1000),
    },
    prefer: 'return=minimal',
  });
}

export const closeDatabase = () => {};


export async function saveCompany(id, input) {
  return request('companies', {
    method: 'POST',
    query: { on_conflict: 'id' },
    body: {
      id,
      phone_number_id: input.phone_number_id || null,
      token_env: input.token_env,
      team_number: input.team_number || '',
      variables: input.variables || {},
      active: true,
      updated_at: new Date().toISOString(),
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}
