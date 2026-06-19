const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');

let db = null;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      pseudo TEXT UNIQUE NOT NULL,
      roblox_username TEXT UNIQUE NOT NULL,
      roblox_id TEXT DEFAULT NULL,
      email_verified INTEGER DEFAULT 0,
      roblox_verified INTEGER DEFAULT 0,
      verification_token TEXT DEFAULT NULL,
      roblox_verification_code TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add UNIQUE constraint on pseudo if the table already existed without it
  // SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we use a unique index instead
  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pseudo_unique ON users(pseudo)`);
  } catch (e) {
    console.warn('[DB] Could not create unique index on pseudo (may already exist):', e.message);
  }

  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_roblox ON users(roblox_username)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_verification ON users(verification_token)`);

  saveDB();
  return db;
}

function saveDB() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB, saveDB };