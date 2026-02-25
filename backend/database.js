import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

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

// Insert default user if none exists
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  // Default user: admin / admin (Should be changed by user immediately)
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('admin', salt, 1000, 64, 'sha512').toString('hex');
  const password_hash = `${salt}:${hash}`;

  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', password_hash);
}

// Ensure default settings exist
const defaultSettings = {
  host_ip: '172.17.0.1',
  ssh_username: 'root',
  ssh_password: '',
  ssh_key_path: '/root/.ssh/id_rsa',
  portainer_url: 'http://localhost:9000',
  portainer_token: ''
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run(key, value);
}

export default {
  // User methods
  getUser: (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username),
  updatePassword: (username, newPasswordHash) => db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newPasswordHash, username),

  // Settings methods
  getSettings: () => {
    const rows = db.prepare('SELECT * FROM settings').all();
    return rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
  },
  updateSetting: (key, value) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  },

  // Custom names methods
  getCustomNames: () => db.prepare('SELECT * FROM custom_names').all(),
  setCustomName: (port, protocol, name) => {
    db.prepare('INSERT INTO custom_names (port, protocol, name) VALUES (?, ?, ?) ON CONFLICT(port, protocol) DO UPDATE SET name=excluded.name').run(port, protocol, name);
  },
  deleteCustomName: (port, protocol) => db.prepare('DELETE FROM custom_names WHERE port = ? AND protocol = ?').run(port, protocol),

  // Raw db instance if needed
  raw: db
};
