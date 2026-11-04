import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || 'agente.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  company TEXT, phone TEXT, paused INTEGER DEFAULT 0, updated INTEGER,
  PRIMARY KEY (company, phone)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT, phone TEXT,
  role TEXT, content TEXT, ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_msg ON messages(company, phone, id);
CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, ts INTEGER);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('platform_admin','company_admin','operator','viewer')),
  company_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id, active);
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON user_sessions(expires_at);
`);

const q = {
  isPaused: db.prepare('SELECT paused FROM conversations WHERE company=? AND phone=?'),
  setPaused: db.prepare(`INSERT INTO conversations (company, phone, paused, updated) VALUES (?,?,?,?)
    ON CONFLICT(company, phone) DO UPDATE SET paused=excluded.paused, updated=excluded.updated`),
  touch: db.prepare(`INSERT INTO conversations (company, phone, paused, updated) VALUES (?,?,0,?)
    ON CONFLICT(company, phone) DO UPDATE SET updated=excluded.updated`),
  add: db.prepare('INSERT INTO messages (company, phone, role, content, ts) VALUES (?,?,?,?,?)'),
  hist: db.prepare('SELECT role, content FROM messages WHERE company=? AND phone=? ORDER BY id DESC LIMIT ?'),
  clear: db.prepare('DELETE FROM messages WHERE company=? AND phone=?'),
  seen: db.prepare('INSERT OR IGNORE INTO seen (id, ts) VALUES (?, ?)'),
  purge: db.prepare('DELETE FROM seen WHERE ts < ?'),
  statsByCompany: db.prepare(`SELECT company, COUNT(*) AS conversations FROM conversations WHERE company=? GROUP BY company`),
  recentByCompany: db.prepare(`SELECT c.company, c.phone, c.paused, c.updated,
    (SELECT m.content FROM messages m WHERE m.company=c.company AND m.phone=c.phone ORDER BY m.id DESC LIMIT 1) AS last_message,
    (SELECT m.ts FROM messages m WHERE m.company=c.company AND m.phone=c.phone ORDER BY m.id DESC LIMIT 1) AS last_message_at
    FROM conversations c WHERE c.company=? ORDER BY COALESCE(c.updated,0) DESC LIMIT ?`),
  stats: db.prepare(`SELECT company, COUNT(*) AS conversations,
    SUM(CASE WHEN paused=1 THEN 1 ELSE 0 END) AS paused
    FROM conversations GROUP BY company`),
  recent: db.prepare(`SELECT c.company, c.phone, c.paused, c.updated,
    (SELECT m.content FROM messages m WHERE m.company=c.company AND m.phone=c.phone ORDER BY m.id DESC LIMIT 1) AS last_message,
    (SELECT m.ts FROM messages m WHERE m.company=c.company AND m.phone=c.phone ORDER BY m.id DESC LIMIT 1) AS last_message_at
    FROM conversations c ORDER BY COALESCE(c.updated,0) DESC LIMIT ?`),
};

export const isPaused = (c, p) => !!q.isPaused.get(c, p)?.paused;
export const setPaused = (c, p, v) => q.setPaused.run(c, p, v ? 1 : 0, Date.now());
export const touchConversation = (c, p) => q.touch.run(c, p, Date.now());
export const addMessage = (c, p, role, content) => q.add.run(c, p, role, content, Date.now());
export const getHistory = (c, p, n = 20) => q.hist.all(c, p, n).reverse();
export const clearHistory = (c, p) => q.clear.run(c, p);
// true se a mensagem é nova; false se já foi processada (a Meta reenvia webhooks)
export const markSeen = (id) => q.seen.run(id, Date.now()).changes === 1;
export const purgeSeen = () => q.purge.run(Date.now() - 24 * 3600 * 1000);

// Visão administrativa resumida: não retorna histórico completo nem credenciais.
export const getOverview = (limit = 50) => ({
  companies: q.stats.all(),
  recent: q.recent.all(Math.min(100, Math.max(1, Number(limit) || 50))).map((row) => ({
    ...row,
    last_message: row.last_message ? String(row.last_message).slice(0, 160) : null,
  })),
});

const userQ = {
  create: db.prepare('INSERT INTO users (email,password_hash,password_salt,role,company_id,active,created_at) VALUES (?,?,?,?,?,1,?)'),
  byEmail: db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE'),
  byId: db.prepare('SELECT id,email,role,company_id,active,created_at,last_login_at FROM users WHERE id=?'),
  list: db.prepare('SELECT id,email,role,company_id,active,created_at,last_login_at FROM users ORDER BY created_at DESC'),
  setLogin: db.prepare('UPDATE users SET last_login_at=? WHERE id=?'),
  disable: db.prepare('UPDATE users SET active=0 WHERE id=?'),
  deleteSessionsForUser: db.prepare('DELETE FROM user_sessions WHERE user_id=?'),
  saveSession: db.prepare('INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)'),
  session: db.prepare(`SELECT u.id,u.email,u.role,u.company_id,u.active,s.expires_at
    FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`),
  deleteSession: db.prepare('DELETE FROM user_sessions WHERE token_hash=?'),
  purgeSessions: db.prepare('DELETE FROM user_sessions WHERE expires_at<=?'),
};
export const createUser = (user) => userQ.create.run(user.email,user.password_hash,user.password_salt,user.role,user.company_id,Date.now()).lastInsertRowid;
export const getUserByEmail = (email) => userQ.byEmail.get(email);
export const getUserById = (id) => userQ.byId.get(id);
export const listUsers = () => userQ.list.all();
export const updateUserLogin = (id) => userQ.setLogin.run(Date.now(),id);
export const createUserSession = (hash,userId,expiresAt) => userQ.saveSession.run(hash,userId,expiresAt,Date.now());
export const getSessionUser = (hash) => userQ.session.get(hash,Date.now());
export const deleteUserSession = (hash) => userQ.deleteSession.run(hash);
export const purgeUserSessions = () => userQ.purgeSessions.run(Date.now());

export const getCompanyOverview = (companyId, limit = 50) => ({
  companies: q.statsByCompany.all(companyId),
  recent: q.recentByCompany.all(companyId, Math.min(100, Math.max(1, Number(limit) || 50))).map((row) => ({
    ...row,
    last_message: row.last_message ? String(row.last_message).slice(0, 160) : null,
  })),
});

export const disableUser = (id) => { const result = userQ.disable.run(id); userQ.deleteSessionsForUser.run(id); return result.changes; };
