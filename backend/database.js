import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'database.sqlite');
const db = new Database(dbPath);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS custom_names (
    port INTEGER,
    protocol TEXT,
    name TEXT,
    PRIMARY KEY (port, protocol)
  );
`);

// Create the admin user on first run. The password comes from ADMIN_PASSWORD,
// or is randomly generated and printed once to the container logs.
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hashPassword(password));

  if (generated) {
    console.log('==================================================');
    console.log(' PortWarden first run: created user "admin"');
    console.log(` Generated password: ${password}`);
    console.log(' Change it under Settings after logging in.');
    console.log('==================================================');
  }
} else {
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (admin && verifyPassword('admin', admin.password_hash)) {
    console.warn('WARNING: user "admin" still has the default password "admin". Change it under Settings.');
  }
}

// Ensure default settings exist
const defaultSettings = {
  host_ip: process.env.HOST_IP || '172.17.0.1',
  ssh_username: '',
  ssh_password: '',
  ssh_key_path: '/root/.ssh/id_ed25519'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

// Settings the UI may read/write. Anything else (JWT secret, pinned host key) is internal.
export const EDITABLE_SETTINGS = ['host_ip', 'ssh_username', 'ssh_password', 'ssh_key_path'];

// JWT signing secret: JWT_SECRET env var if provided, otherwise a random secret persisted in the DB
const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('jwt_secret');
  if (row?.value) return row.value;
  const secret = crypto.randomBytes(48).toString('hex');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('jwt_secret', secret);
  return secret;
};

const getSettings = () => {
  const rows = db.prepare('SELECT * FROM settings').all();
  return rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
};

const updateSetting = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
};

// Names are per port; the protocol column is kept for schema compatibility and always 'any'
const setCustomName = db.transaction((port, name) => {
  db.prepare('DELETE FROM custom_names WHERE port = ?').run(port);
  db.prepare('INSERT INTO custom_names (port, protocol, name) VALUES (?, ?, ?)').run(port, 'any', name);
});

export default {
  jwtSecret: getJwtSecret(),

  // User methods
  getUser: (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username),
  updatePassword: (username, newPasswordHash) => db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newPasswordHash, username),

  // Settings methods
  getSettings,
  updateSetting,

  // Custom names methods
  getCustomNames: () => db.prepare('SELECT port, name FROM custom_names ORDER BY port').all(),
  setCustomName,
  deleteCustomName: (port) => db.prepare('DELETE FROM custom_names WHERE port = ?').run(port),

  // Replace or merge custom names in a single transaction (used by restore)
  importCustomNames: db.transaction((names, replace) => {
    if (replace) db.prepare('DELETE FROM custom_names').run();
    for (const { port, name } of names) setCustomName(port, name);
  }),

  // Raw db instance if needed
  raw: db
};
