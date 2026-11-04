import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || 'agente.db');
db.pragma('journal_mode = WAL');
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
`);

const q = {
  isPaused: db.prepare('SELECT paused FROM conversations WHERE company=? AND phone=?'),
  setPaused: db.prepare(`INSERT INTO conversations (company, phone, paused, updated) VALUES (?,?,?,?)
    ON CONFLICT(company, phone) DO UPDATE SET paused=excluded.paused, updated=excluded.updated`),
  add: db.prepare('INSERT INTO messages (company, phone, role, content, ts) VALUES (?,?,?,?,?)'),
  hist: db.prepare('SELECT role, content FROM messages WHERE company=? AND phone=? ORDER BY id DESC LIMIT ?'),
  clear: db.prepare('DELETE FROM messages WHERE company=? AND phone=?'),
  seen: db.prepare('INSERT OR IGNORE INTO seen (id, ts) VALUES (?, ?)'),
  purge: db.prepare('DELETE FROM seen WHERE ts < ?'),
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
