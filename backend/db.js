import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'ai-chat.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let dbInstance = null;

export async function initDB() {
  console.log('[db] Loading sql.js WASM...');
  const SQL = await initSqlJs({ locateFile: (f) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', f) });
  console.log('[db] sql.js loaded successfully');

  // Load existing database or create new one
  let buffer;
  if (fs.existsSync(DB_PATH)) {
    console.log(`[db] Loading existing DB from ${DB_PATH}`);
    buffer = fs.readFileSync(DB_PATH);
  } else {
    console.log('[db] No existing DB found, creating new one');
  }

  dbInstance = new SQL.Database(buffer || undefined);
  console.log('[db] Database instance created');

  // Create tables
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);

    -- Characters: reusable character prompts
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Stories: reusable story/world context prompts
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Many-to-many mapping between chats and characters/stories
    CREATE TABLE IF NOT EXISTS chat_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      assign_type TEXT NOT NULL CHECK(assign_type IN ('character', 'story')),
      entity_id INTEGER NOT NULL,
      UNIQUE(chat_id, assign_type, entity_id),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    -- Users: authentication & roles
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User → resource assignments (for non-admin users)
    CREATE TABLE IF NOT EXISTS user_chat_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      UNIQUE(user_id, chat_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_character_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      UNIQUE(user_id, character_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_story_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      story_id INTEGER NOT NULL,
      UNIQUE(user_id, story_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
    );

    -- Persisted relationship state per chat (one row per chat, updated after
    -- each assistant turn). See backend/relationshipState.js.
    CREATE TABLE IF NOT EXISTS chat_relationship_state (
      chat_id INTEGER PRIMARY KEY,
      trust INTEGER NOT NULL DEFAULT 10,
      attraction INTEGER NOT NULL DEFAULT 0,
      comfort INTEGER NOT NULL DEFAULT 15,
      tension INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'desconocidos o conocidos recientes',
      impression TEXT NOT NULL DEFAULT 'todavía no formada',
      doubts TEXT NOT NULL DEFAULT 'no conoce suficientemente al usuario',
      boundaries TEXT NOT NULL DEFAULT 'prudencia normal entre desconocidos',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );
  `);

  // Insert default settings
  const defaults = [
    ['api_base', 'https://api.openai.com/v1'],
    ['api_key', ''],
    ['model', 'gpt-4o-mini'],
    ['accent_color', '#7c5cfc'],
    ['system_prompt', 'You are a helpful assistant.'],
  ];
  // INSERT OR IGNORE ensures we never duplicate existing keys
  const sInsert = dbInstance.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) {
    sInsert.run([k, v]);
  }
  sInsert.free();

  // Seed default admin user (password: 'admin')
  const adminExists = dbInstance.exec('SELECT COUNT(*) as c FROM users WHERE username = \'admin\'');
  if (!adminExists?.[0]?.values?.[0]?.[0] || Number(adminExists[0].values[0][0]) === 0) {
    const pwHash = hashPassword('admin');
    dbInstance.run('INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', pwHash, 'admin']);
  }

  saveDB();
}

export function getDB() {
  return dbInstance;
}

function saveDB() {
  if (!dbInstance) return;
  const data = dbInstance.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function save() {
  saveDB();
}
