import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB, getDB, save } from './db.js';
import jwt from 'jsonwebtoken';
import { authMiddleware, createToken, hashPassword, verifyPassword } from './auth.js';
import http from 'http';
import https from 'https';
import { EdgeTTS } from 'edge-tts-universal';
import { buildRoleplayMessages } from './promptBuilder.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── Helpers for sql.js ────────────────────────────────────────────────

function execQuery(sql) {
  const db = getDB();
  if (!db) return [];
  try {
    const results = db.exec(sql);
    if (!results || results.length === 0) return [];
    const { columns, values } = results[0];
    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  } catch {
    return [];
  }
}

// Parameterized query helper (execQuery doesn't support params)
function query(sql, params = []) {
  const db = getDB();
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } catch (e) {
    console.error('Query error:', e.message, sql, params);
    return [];
  }
}

function runSQL(sql, params = []) {
  const db = getDB();
  if (!db) return { lastInsertRowid: 0, changes: 0 };
  try {
    db.prepare(sql).run(params);
  } catch (e) {
    console.error('SQL error:', e.message, sql, params);
  }
  const changes = db.getRowsModified();

  let lastInsertRowid = 0;
  if (changes > 0) {
    const result = db.exec('SELECT last_insert_rowid() as rid');
    if (result && result[0] && result[0].values.length > 0) {
      lastInsertRowid = Number(result[0].values[0][0]);
    }
  }

  save();
  return { lastInsertRowid, changes };
}

// ─── Auth endpoints (public — no token required) ──────────────

// POST /api/auth/login — authenticate and return JWT token
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const db = getDB();
  const stmt = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?');
  stmt.bind([username]);
  let user = null;
  if (stmt.step()) user = stmt.getAsObject();
  stmt.free();

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // JWT token via jsonwebtoken
  const token = createToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, role: user.role, username: user.username });
});

// POST /api/auth/register — create a new user (admin only)
app.post('/api/auth/register', requireAdminLegacy(), (req, res) => {
  const { username, password, role } = req.body;
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Username and password required' });
  const userRole = (role === 'admin') ? 'admin' : 'user';

  try {
    runSQL('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username.trim(), hashPassword(password), userRole]);
    save();
    res.status(201).json({ ok: true });
  } catch {
    return res.status(409).json({ error: 'Username already exists' });
  }
});

// GET /api/auth/me — verify current token
app.get('/api/auth/me', (req, res) => {
  const user = getUserFromHeader(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(user);
});

// ─── Health check endpoint (public — for Docker/Coolify) ─────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Serve frontend static files (production) + SPA fallback ────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, '..', 'dist');
console.log(`[server] Checking for frontend at: ${staticDir}`);
if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  console.log('[server] Frontend found — serving static files + SPA fallback');
  app.use(express.static(staticDir));
  // SPA fallback — any non-API route serves index.html
  app.get('*', (_req, res, next) => {
    if (!_req.originalUrl.startsWith('/api/')) {
      return res.sendFile(path.join(staticDir, 'index.html'));
    }
    next();
  });
} else {
  console.log('[server] WARNING: No frontend found at ' + staticDir + ', serving API only');
}

// ─── Auth middleware (everything below requires a token) ──────────
app.use(authMiddleware);

// ─── User management (admin only) ────────────────────────────────

function requireAdminLegacy() {
  return (req, res, next) => {
    const user = getUserFromHeader(req);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    req.user = user;
    next();
  };
}

function getUserFromHeader(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    // Try JWT first
    const decoded = jwtVerify(match[1]);
    if (decoded) return decoded;
    // Fallback: base64 for backward compat during migration
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'));
  } catch { return null; }
}
// Lightweight JWT verify for legacy endpoints before middleware
const _jwtSecret = process.env.JWT_SECRET || 'ai-chat-secret-key-change-me-in-production';
function jwtVerify(token) {
  try { return jwt.verify(token, _jwtSecret); } catch { return null; }
}

// GET /api/users — list all users (admin)
app.get('/api/users', requireAdminLegacy(), (_req, res) => {
  const rows = execQuery('SELECT id, username, role, created_at FROM users ORDER BY username');
  for (const r of rows) r.id = Number(r.id);
  res.json(rows);
});

// PUT /api/users/:id — update user role or password (admin)
app.put('/api/users/:id', requireAdminLegacy(), (req, res) => {
  const uid = Number(req.params.id);
  const { username, password, role } = req.body;
  let clauses = [];
  let params = [];

  if (username?.trim()) { clauses.push('username = ?'); params.push(username.trim()); }
  if (password) { clauses.push('password_hash = ?'); params.push(hashPassword(password)); }
  if (role === 'admin' || role === 'user') { clauses.push('role = ?'); params.push(role); }

  if (!clauses.length) return res.status(400).json({ error: 'Nothing to update' });

  const info = runSQL(`UPDATE users SET ${clauses.join(', ')} WHERE id = ?`, [...params, uid]);
  if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
  save();
  res.json({ ok: true });
});

// DELETE /api/users/:id — delete user (admin, can't self-delete if last admin)
app.delete('/api/users/:id', requireAdminLegacy(), (req, res) => {
  const uid = Number(req.params.id);
  // Prevent deleting the last admin
  if (uid === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  runSQL('DELETE FROM user_chat_assignments WHERE user_id = ?', [uid]);
  runSQL('DELETE FROM user_character_assignments WHERE user_id = ?', [uid]);
  runSQL('DELETE FROM user_story_assignments WHERE user_id = ?', [uid]);
  const info = runSQL('DELETE FROM users WHERE id = ?', [uid]);
  if (info.changes === 0) return res.status(404).json({ error: 'User not found' });
  save();
  res.json({ ok: true });
});

// ─── User resource assignments ──────────────────────────────────

// GET /api/users/:id/assignments — get all assignments for a user (admin)
app.get('/api/users/:id/assignments', requireAdminLegacy(), (req, res) => {
  const uid = Number(req.params.id);
  // Check user exists
  const uRows = query('SELECT id FROM users WHERE id = ?', [uid]);
  if (!uRows.length) return res.status(404).json({ error: 'User not found' });

  const chats = query(`SELECT c.id, c.title FROM chats c JOIN user_chat_assignments a ON a.chat_id = c.id WHERE a.user_id = ? ORDER BY c.title`, [uid]);
  for (const r of chats) r.id = Number(r.id);

  const chars = query(`SELECT c.id, c.name FROM characters c JOIN user_character_assignments a ON a.character_id = c.id WHERE a.user_id = ? ORDER BY c.name`, [uid]);
  for (const r of chars) r.id = Number(r.id);

  const stors = query(`SELECT s.id, s.name FROM stories s JOIN user_story_assignments a ON a.story_id = s.id WHERE a.user_id = ? ORDER BY s.name`, [uid]);
  for (const r of stors) r.id = Number(r.id);

  res.json({ chats, characters: chars, stories: stors });
});

// POST /api/users/:id/assignments — add assignment to user (admin)
app.post('/api/users/:id/assignments', requireAdminLegacy(), (req, res) => {
  const uid = Number(req.params.id);
  const { assign_type, entity_id } = req.body;
  if (!assign_type || !entity_id) return res.status(400).json({ error: 'Missing assign_type or entity_id' });

  let table = '';
  let entityIdCol = '';
  switch (assign_type) {
    case 'chat': table = 'user_chat_assignments'; entityIdCol = 'chat_id'; break;
    case 'character': table = 'user_character_assignments'; entityIdCol = 'character_id'; break;
    case 'story': table = 'user_story_assignments'; entityIdCol = 'story_id'; break;
    default: return res.status(400).json({ error: 'Invalid assign_type' });
  }

  runSQL(`INSERT OR IGNORE INTO ${table} (user_id, ${entityIdCol}) VALUES (?, ?)`, [uid, Number(entity_id)]);
  save();
  res.json({ ok: true });
});

// DELETE /api/users/:id/assignments — remove assignment from user (admin)
app.delete('/api/users/:id/assignments', requireAdminLegacy(), (req, res) => {
  const uid = Number(req.params.id);
  const { assign_type, entity_id } = req.body;

  let table = '';
  let entityIdCol = '';
  switch (assign_type) {
    case 'chat': table = 'user_chat_assignments'; entityIdCol = 'chat_id'; break;
    case 'character': table = 'user_character_assignments'; entityIdCol = 'character_id'; break;
    case 'story': table = 'user_story_assignments'; entityIdCol = 'story_id'; break;
    default: return res.status(400).json({ error: 'Invalid assign_type' });
  }

  runSQL(`DELETE FROM ${table} WHERE user_id = ? AND ${entityIdCol} = ?`, [uid, Number(entity_id)]);
  save();
  res.json({ ok: true });
});

// ─── Quick access check helpers ───────────────────────────────

function userIsAdmin(userId) {
  const db = getDB();
  const stmt = db.prepare('SELECT role FROM users WHERE id = ?');
  stmt.bind([userId]);
  let isAdmin = false;
  if (stmt.step()) isAdmin = stmt.getAsObject().role === 'admin';
  stmt.free();
  return isAdmin;
}

function canAccessChat(userId, chatId) {
  if (userIsAdmin(userId)) return true;
  const rows = query('SELECT 1 FROM user_chat_assignments WHERE user_id = ? AND chat_id = ?', [userId, Number(chatId)]);
  return rows.length > 0;
}

// ─── Helper to get accessible resource IDs for non-admin users ──

function getUserAccessibleIds(userId, assignType) {
  // Admins see everything (return null = no filter)
  const db = getDB();
  const uStmt = db.prepare('SELECT role FROM users WHERE id = ?');
  uStmt.bind([userId]);
  let isAdmin = false;
  if (uStmt.step()) isAdmin = uStmt.getAsObject().role === 'admin';
  uStmt.free();

  if (isAdmin) return null; // no filter — see all

  let table, entityIdCol;
  switch (assignType) {
    case 'chat': table = 'user_chat_assignments'; entityIdCol = 'chat_id'; break;
    case 'character': table = 'user_character_assignments'; entityIdCol = 'character_id'; break;
    case 'story': table = 'user_story_assignments'; entityIdCol = 'story_id'; break;
    default: return null;
  }

  const rows = query(`SELECT ${entityIdCol} FROM ${table} WHERE user_id = ?`, [userId]);
  if (!rows.length) return []; // no access to anything
  return rows.map(r => r[entityIdCol]);
}

// ─── Settings ──────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  const rows = execQuery('SELECT key, value FROM settings');
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  for (const [key, value] of Object.entries(req.body)) {
    runSQL('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }
  save();
  res.json({ ok: true });
});

// ─── Fetch available models from provider ─────────────────────────────

app.get('/api/models', async (_req, res) => {
  try {
    // Load settings to get the configured provider
    const rows = execQuery('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;

    if (!settings.api_base?.trim() || !settings.api_key?.trim()) {
      return res.json({ models: [], error: 'Configure API Base URL and API Key first.' });
    }

    const baseUrl = settings.api_base.replace(/\/+$/, '');
    // Try /v1/models (OpenAI-compatible) or /api/v1/models (OpenRouter)
    const url = new URL(`${baseUrl}/models`);

    const result = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${settings.api_key}` },
    });

    if (!result.ok) {
      return res.json({ models: [], error: `Provider returned ${result.status}. Check API key and base URL.` });
    }

    const data = await result.json();
    // Normalize: support OpenAI format ({ data: [{ id, ... }] }) and OpenRouter format
    let rawModels = [];
    if (data.data && Array.isArray(data.data)) {
      rawModels = data.data;
    } else if (Array.isArray(data)) {
      rawModels = data;
    }

    // Extract useful fields, filter to chat/text models only when possible
    const models = rawModels
      .filter(m => {
        // Filter out embedding/image/audio-only models
        const modality = m?.architecture?.modality || '';
        if (modality && !modality.includes('text')) return false;
        return true;
      })
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length || null,
        pricing: m.pricing ? `${Number(m.pricing.prompt)?.toFixed(2)} in / ${Number(m.pricing.completion)?.toFixed(2)} out` : '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    res.json({ models });
  } catch (err) {
    console.error('[Models fetch error]', err.message);
    res.json({ models: [], error: 'Failed to connect to provider. Check network and settings.' });
  }
});

// ─── Chats list ────────────────────────────────────────────────────────

app.get('/api/chats', (req, res) => {
  const accessibleIds = getUserAccessibleIds(req.user.userId, 'chat');
  let sql = 'SELECT id, title, created_at, updated_at FROM chats';
  if (accessibleIds && accessibleIds.length > 0) {
    const placeholders = accessibleIds.map(() => '?').join(',');
    sql += ` WHERE id IN (${placeholders})`;
  } else if (!Array.isArray(accessibleIds)) {
    // admin: accessibleIds is null — see all (no filter)
  } else {
    return res.json([]); // no access to any chats
  }
  sql += ' ORDER BY updated_at DESC';
  const chats = accessibleIds && accessibleIds.length > 0 ? query(sql, accessibleIds) : execQuery(sql);
  for (const chat of chats) chat.id = Number(chat.id);
  res.json(chats);
});

// ─── Create chat ───────────────────────────────────────────────────────

app.post('/api/chats', (req, res) => {
  const title = req.body?.title || 'New Chat';
  const result = runSQL('INSERT INTO chats (title) VALUES (?)', [title]);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

// ─── Delete chat ───────────────────────────────────────────────────────

app.delete('/api/chats/:id', (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });
  runSQL('DELETE FROM messages WHERE chat_id = ?', [chatId]);
  const info = runSQL('DELETE FROM chats WHERE id = ?', [chatId]);
  if (info.changes === 0) return res.status(404).json({ error: 'Chat not found' });
  save();
  res.json({ ok: true });
});

// ─── Rename chat ───────────────────────────────────────────────────────

app.put('/api/chats/:id', (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });
  const info = runSQL(
    'UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.body.title || 'New Chat', chatId]
  );
  if (info.changes === 0) return res.status(404).json({ error: 'Chat not found' });
  save();
  res.json({ ok: true });
});

// ─── Export chat (downloadable JSON) ──────────────────────────────

app.get('/api/chats/:id/export', (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });

  // Get chat title
  const chatInfo = query('SELECT id, title FROM chats WHERE id = ?', [chatId]);
  if (chatInfo.length === 0) return res.status(404).json({ error: 'Chat not found' });

  // Get messages
  const msgs = query('SELECT role, content, thinking, created_at FROM messages WHERE chat_id = ? ORDER BY id ASC', [chatId]);

  // Get assignments (characters + stories)
  const charIds = query("SELECT entity_id FROM chat_assignments WHERE chat_id = ? AND assign_type = 'character'", [chatId]);
  const chars = [];
  for (const { entity_id } of charIds) {
    const row = query('SELECT name, prompt FROM characters WHERE id = ?', [entity_id]);
    if (row.length) chars.push(row[0]);
  }

  const storyIds = query("SELECT entity_id FROM chat_assignments WHERE chat_id = ? AND assign_type = 'story'", [chatId]);
  const stories = [];
  for (const { entity_id } of storyIds) {
    const row = query('SELECT name, prompt FROM stories WHERE id = ?', [entity_id]);
    if (row.length) stories.push(row[0]);
  }

  res.json({
    version: 1,
    title: chatInfo[0].title,
    messages: msgs,
    characters: chars,
    stories: stories,
  });
});

// ─── Import chat (from JSON) ──────────────────────────────────────

app.post('/api/chats/import', (req, res) => {
  const { title, messages, characters, stories } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Invalid format' });

  // Create the chat
  const chatResult = runSQL('INSERT INTO chats (title) VALUES (?)', [title || 'Imported Chat']);
  const chatId = Number(chatResult.lastInsertRowid);

  // Insert messages
  for (const msg of messages) {
    if (msg.role && msg.content != null) {
      runSQL('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
        [chatId, msg.role, msg.content || '']);
    }
  }

  // Import characters if provided and don't exist already by name
  const charsToImport = Array.isArray(characters) ? characters : [];
  for (const char of charsToImport) {
    if (!char.name) continue;
    const existing = query('SELECT id FROM characters WHERE name = ?', [char.name]);
    let charId;
    if (existing.length > 0) {
      charId = Number(existing[0].id);
    } else {
      const r = runSQL('INSERT INTO characters (name, prompt) VALUES (?, ?)', [char.name, char.prompt || '']);
      charId = Number(r.lastInsertRowid);
    }
    runSQL("INSERT OR IGNORE INTO chat_assignments (chat_id, assign_type, entity_id) VALUES (?, 'character', ?)", [chatId, charId]);
  }

  // Import stories if provided and don't exist already by name
  const storiesToImport = Array.isArray(stories) ? stories : [];
  for (const story of storiesToImport) {
    if (!story.name) continue;
    const existing = query('SELECT id FROM stories WHERE name = ?', [story.name]);
    let storyId;
    if (existing.length > 0) {
      storyId = Number(existing[0].id);
    } else {
      const r = runSQL('INSERT INTO stories (name, prompt) VALUES (?, ?)', [story.name, story.prompt || '']);
      storyId = Number(r.lastInsertRowid);
    }
    runSQL("INSERT OR IGNORE INTO chat_assignments (chat_id, assign_type, entity_id) VALUES (?, 'story', ?)", [chatId, storyId]);
  }

  save();
  res.status(201).json({ id: chatId });
});

// ─── Characters CRUD ──────────────────────────────────────────────────

app.get('/api/characters', (req, res) => {
  const accessibleIds = getUserAccessibleIds(req.user.userId, 'character');
  let sql = 'SELECT id, name, prompt, created_at FROM characters';
  if (accessibleIds && accessibleIds.length > 0) {
    const placeholders = accessibleIds.map(() => '?').join(',');
    sql += ` WHERE id IN (${placeholders})`;
  } else if (!Array.isArray(accessibleIds)) {
    // admin: accessibleIds is null — see all (no filter)
  } else {
    return res.json([]); // no access to any characters
  }
  sql += ' ORDER BY name ASC';
  const rows = accessibleIds && accessibleIds.length > 0 ? query(sql, accessibleIds) : execQuery(sql);
  for (const r of rows) r.id = Number(r.id);
  res.json(rows);
});

app.post('/api/characters', (req, res) => {
  const { name, prompt } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = runSQL('INSERT INTO characters (name, prompt) VALUES (?, ?)', [name.trim(), prompt || '']);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/characters/:id', (req, res) => {
  const { name, prompt } = req.body;
  const info = runSQL('UPDATE characters SET name = ?, prompt = ? WHERE id = ?', [name?.trim() || '', prompt ?? '', Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Character not found' });
  save();
  res.json({ ok: true });
});

app.delete('/api/characters/:id', (req, res) => {
  // Remove any assignments to this character first
  runSQL('DELETE FROM chat_assignments WHERE assign_type = \'character\' AND entity_id = ?', [Number(req.params.id)]);
  const info = runSQL('DELETE FROM characters WHERE id = ?', [Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Character not found' });
  save();
  res.json({ ok: true });
});

// ─── Stories CRUD ──────────────────────────────────────────────────────

app.get('/api/stories', (req, res) => {
  const accessibleIds = getUserAccessibleIds(req.user.userId, 'story');
  let sql = 'SELECT id, name, prompt, created_at FROM stories';
  if (accessibleIds && accessibleIds.length > 0) {
    const placeholders = accessibleIds.map(() => '?').join(',');
    sql += ` WHERE id IN (${placeholders})`;
  } else if (!Array.isArray(accessibleIds)) {
    // admin: accessibleIds is null — see all (no filter)
  } else {
    return res.json([]); // no access to any stories
  }
  sql += ' ORDER BY name ASC';
  const rows = accessibleIds && accessibleIds.length > 0 ? query(sql, accessibleIds) : execQuery(sql);
  for (const r of rows) r.id = Number(r.id);
  res.json(rows);
});

app.post('/api/stories', (req, res) => {
  const { name, prompt } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = runSQL('INSERT INTO stories (name, prompt) VALUES (?, ?)', [name.trim(), prompt || '']);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/stories/:id', (req, res) => {
  const { name, prompt } = req.body;
  const info = runSQL('UPDATE stories SET name = ?, prompt = ? WHERE id = ?', [name?.trim() || '', prompt ?? '', Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Story not found' });
  save();
  res.json({ ok: true });
});

app.delete('/api/stories/:id', (req, res) => {
  runSQL('DELETE FROM chat_assignments WHERE assign_type = \'story\' AND entity_id = ?', [Number(req.params.id)]);
  const info = runSQL('DELETE FROM stories WHERE id = ?', [Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Story not found' });
  save();
  res.json({ ok: true });
});

// ─── Chat Assignments ──────────────────────────────────────────────────

app.get('/api/chats/:id/assignments', (req, res) => {
  const chatId = Number(req.params.id);
  // Get assigned characters
  const charRows = query(`SELECT c.id, c.name FROM characters c JOIN chat_assignments a ON a.entity_id = c.id WHERE a.chat_id = ? AND a.assign_type = 'character' ORDER BY c.name`, [chatId]);
  for (const r of charRows) r.id = Number(r.id);
  // Get assigned stories
  const storyRows = query(`SELECT s.id, s.name FROM stories s JOIN chat_assignments a ON a.entity_id = s.id WHERE a.chat_id = ? AND a.assign_type = 'story' ORDER BY s.name`, [chatId]);
  for (const r of storyRows) r.id = Number(r.id);
  res.json({ characters: charRows, stories: storyRows });
});

app.post('/api/chats/:id/assignments', (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });
  const { assign_type, entity_id } = req.body;
  if (!assign_type || !entity_id) return res.status(400).json({ error: 'Missing assign_type or entity_id' });
  runSQL('INSERT OR IGNORE INTO chat_assignments (chat_id, assign_type, entity_id) VALUES (?, ?, ?)', [chatId, assign_type, Number(entity_id)]);
  save();
  res.json({ ok: true });
});

app.delete('/api/chats/:id/assignments', (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });
  const { assign_type, entity_id } = req.body;
  runSQL('DELETE FROM chat_assignments WHERE chat_id = ? AND assign_type = ? AND entity_id = ?', [chatId, assign_type, Number(entity_id)]);
  save();
  res.json({ ok: true });
});

// ─── Messages ──────────────────────────────────────────────────────────

app.get('/api/chats/:id/messages', (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access to this chat' });
  const messages = execQuery(`SELECT id, role, content, created_at FROM messages WHERE chat_id = ${chatId} ORDER BY created_at ASC`);
  for (const msg of messages) msg.id = Number(msg.id);
  res.json(messages);
});

// ─── Rewind — delete all messages from a given ID onward ──────────────

app.delete('/api/chats/:chatId/messages/after/:msgId', (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });
  const msgId = Number(req.params.msgId);

  // Delete all messages with id > the given msgId in this chat
  runSQL('DELETE FROM messages WHERE chat_id = ? AND id > ?', [chatId, msgId]);
  save();
  res.json({ ok: true });
});

// ─── Send message to AI with streaming ─────────────────────────────────

app.post('/api/chats/:id/messages', async (req, res) => {
  const chatId = Number(req.params.id);
  if (!canAccessChat(req.user.userId, chatId)) return res.status(403).json({ error: 'No access' });
  const { content } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  // Save user message
  runSQL('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', [chatId, 'user', content.trim()]);

  // Update chat timestamp; auto-generate title on first message
  const countResult = getDB().exec(`SELECT COUNT(*) as c FROM messages WHERE chat_id = ${chatId}`);
  const msgCount = countResult?.[0]?.values?.[0]?.[0] || 0;
  if (Number(msgCount) <= 1) {
    const autoTitle = content.trim().slice(0, 50).replace(/'/g, "''");
    runSQL(`UPDATE chats SET title = '${autoTitle}', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [chatId]);
  } else {
    runSQL('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [chatId]);
  }

  save();

  try {
    // Load settings
    const rows = execQuery('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;

    if (!settings.api_key?.trim()) {
      throw new Error('No API key configured. Please set your API key in Settings.');
    }

    // Load full history ordered by insertion, excluding the current user
    // message we just inserted above (it is always the last row by id).
    const historyRows = query('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', [chatId]);
    const history = historyRows.slice(0, -1).map(row => ({ role: row.role, content: row.content }));

    // Load assigned characters for this chat
    const charRows = query(`SELECT c.id, c.name, c.prompt FROM characters c JOIN chat_assignments a ON a.entity_id = c.id WHERE a.chat_id = ? AND a.assign_type = 'character' ORDER BY c.name`, [chatId]);

    // Load assigned stories for this chat
    const storyRows = query(`SELECT s.prompt FROM stories s JOIN chat_assignments a ON a.entity_id = s.id WHERE a.chat_id = ? AND a.assign_type = 'story' ORDER BY s.name`, [chatId]);

    const apiMessages = buildRoleplayMessages({
      systemPrompt: settings.system_prompt,
      story: (storyRows || []).map(r => r.prompt),
      characters: charRows || [],
      context: {},
      narrativePrompt: settings.narrative_style,
      history,
      userMessage: content.trim(),
    });

    // ── Streaming response to the client via SSE ────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let fullReply = '';
    let fullThinking = '';
    let insideThinking = false;

    // Qwen sends thinking tags (````) inline with content.
    // We need to track state across tokens since a tag may span multiple chunks.
    const THINK_OPEN = '\uE276';
    const THINK_CLOSE = '\uE277';

    // Pipe the AI stream to the client; onToken receives { type, content }
    const enableThinking = settings.enable_thinking === true || settings.enable_thinking === 'true';
    const maxTokens = parseInt(settings.max_tokens) || 8192;
    const reasoningMaxTokens = parseInt(settings.reasoning_max_tokens) || 32000;
    console.log(`[AI-STREAM] model=${settings.model}, api_base=${settings.api_base}, enable_thinking=${enableThinking}`);
    await callAISTream(settings.api_base, settings.api_key, settings.model, apiMessages, ({ type, content }) => {
      if (!content) return;

      // When thinking is disabled: treat everything as regular content
      if (!enableThinking) {
        fullReply += content;
        res.write(`data: ${JSON.stringify({ delta: content, type: 'content' })}\n\n`);
        return;
      }

      // If the API already classified as thinking (e.g. Anthropic), use it directly
      if (type === 'thinking') {
        fullThinking += content;
        res.write(`data: ${JSON.stringify({ delta: content, type: 'thinking' })}\n\n`);
        return;
      }

      // For inline tags (Qwen style), parse boundaries inside the content token
      let remaining = content;
      while (remaining.length > 0) {
        if (!insideThinking && remaining.includes(THINK_OPEN)) {
          const parts = remaining.split(THINK_OPEN, 2);
          // Text before tag → content
          if (parts[0]) {
            fullReply += parts[0];
            res.write(`data: ${JSON.stringify({ delta: parts[0], type: 'content' })}\n\n`);
          }
          insideThinking = true;
          remaining = parts[1] || '';
        } else if (insideThinking && remaining.includes(THINK_CLOSE)) {
          const parts = remaining.split(THINK_CLOSE, 2);
          // Text inside tag → thinking
          if (parts[0]) {
            fullThinking += parts[0];
            res.write(`data: ${JSON.stringify({ delta: parts[0], type: 'thinking' })}\n\n`);
          }
          insideThinking = false;
          remaining = parts[1] || '';
        } else if (insideThinking) {
          // All remaining is thinking
          fullThinking += remaining;
          res.write(`data: ${JSON.stringify({ delta: remaining, type: 'thinking' })}\n\n`);
          break;
        } else {
          // All remaining is content
          fullReply += remaining;
          res.write(`data: ${JSON.stringify({ delta: remaining, type: 'content' })}\n\n`);
          break;
        }
      }
    }, enableThinking, maxTokens, reasoningMaxTokens);

    console.log(`[AI-STREAM] Final — fullThinking length: ${fullThinking.length}, fullReply length: ${fullReply.length}`);
    if (fullReply.length === 0) {
      console.error('[AI-STREAM] WARNING: fullReply is empty! No content tokens were received.');
    }
    // Send a done signal with final clean content + the prompt used
    res.write(`data: ${JSON.stringify({ done: true, content: fullReply, prompt: apiMessages })}\n\n`);
    res.end();

    // Save assistant message (after stream ends)
    runSQL('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', [chatId, 'assistant', fullReply]);
    save();

  } catch (err) {
    console.error('AI call error:', err.message);
    // Try to send an error event if response headers not sent yet
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ─── Edge TTS (Text-to-Speech) via WebSocket ──────────────────────

// Curated Spanish neural voices — verified available in Edge TTS
const SPANISH_VOICES = [
  // ── España ──
  { name: 'es-ES-AlvaroNeural',   label: 'Álvaro 🇪🇸 (España) — Masculino' },
  { name: 'es-ES-ElviraNeural',   label: 'Elvira 🇪🇸 (España) — Femenino' },
  { name: 'es-ES-XimenaNeural',   label: 'Ximena 🇪🇸 (España) — Femenino' },
  // ── México ──
  { name: 'es-MX-DaliaNeural',    label: 'Dalía 🇲🇽 (México) — Femenino' },
  { name: 'es-MX-JorgeNeural',    label: 'Jorge 🇲🇽 (México) — Masculino' },
  // ── Latinoamérica (Chile) ──
  { name: 'es-CL-CatalinaNeural', label: 'Catalina 🇨🇱 (Chile) — Femenino' },
  { name: 'es-CL-LorenzoNeural',  label: 'Lorenzo 🇨🇱 (Chile) — Masculino' },
  // ── Latinoamérica (Colombia) ──
  { name: 'es-CO-SalomeNeural',   label: 'Salomé 🇨🇴 (Colombia) — Femenino' },
  { name: 'es-CO-GonzaloNeural',  label: 'Gonzalo 🇨🇴 (Colombia) — Masculino' },
  // ── Latinoamérica (Perú) ──
  { name: 'es-PE-CamilaNeural',   label: 'Camila 🇵🇪 (Perú) — Femenino' },
  { name: 'es-PE-AlexNeural',     label: 'Alex 🇵🇪 (Perú) — Masculino' },
  // ── Latinoamérica (Argentina) ──
  { name: 'es-AR-ElenaNeural',    label: 'Elena 🇦🇷 (Argentina) — Femenino' },
  { name: 'es-AR-TomasNeural',    label: 'Tomás 🇦🇷 (Argentina) — Masculino' },
];

app.get('/api/tts/voices', (_req, res) => {
  res.json(SPANISH_VOICES);
});

// POST /api/tts — synthesize speech using Microsoft Edge TTS (WebSocket)
app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body;
  if (!text || !voice) return res.status(400).json({ error: 'Missing text or voice' });

  try {
    const tts = new EdgeTTS(text, voice);
    const result = await tts.synthesize();

    // result.audio is a Blob — convert to Buffer for Node.js response
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    if (audioBuffer.length === 0) {
      return res.status(500).json({ error: 'No audio data received from Edge TTS' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error('[TTS Error]', err.message, err.stack?.split('\n')[1]);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

// ─── Delete a single message ──────────────────────────────────────────

app.delete('/api/messages/:id', (req, res) => {
  const info = runSQL('DELETE FROM messages WHERE id = ?', [Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Message not found' });
  save();
  res.json({ ok: true });
});

// ─── AI Provider call — non-streaming fallback ────────────────────────

function callAI(apiBase, apiKey, model, messages) {
  return new Promise((resolve, reject) => {
    const baseUrl = apiBase.replace(/\/+$/, '');
    const fullUrl = `${baseUrl}/chat/completions`;
    const url = new URL(fullUrl);

    const data = JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API returned ${res.statusCode}: ${body.slice(0, 500)}`));
          return;
        }
        try {
          const json = JSON.parse(body);
          resolve(json.choices?.[0]?.message?.content || 'No response from model.');
        } catch (e) {
          reject(new Error('Failed to parse AI response'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timed out after 120s'));
    });
    req.write(data);
    req.end();
  });
}

// ─── AI Provider call — streaming (SSE) ──────────────────────────────

function callAISTream(apiBase, apiKey, model, messages, onToken, enableThinking = false, maxTokens = 8192, reasoningMaxTokens = 32000) {
  return new Promise((resolve, reject) => {
    const baseUrl = apiBase.replace(/\/+$/, '');
    const fullUrl = `${baseUrl}/chat/completions`;
    const url = new URL(fullUrl);

    // Build request body — always send thinking flags (on or off)
    const bodyFields = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: enableThinking ? maxTokens + reasoningMaxTokens : maxTokens,
      stream: true,
    };

    if (enableThinking) {
      // OpenRouter / Anthropic style: reasoning config
      bodyFields.reasoning = { max_tokens: reasoningMaxTokens };
      // DeepSeek / Qwen style: enable_thinking flag
      bodyFields.enable_thinking = true;
    } else {
      // Explicitly disable reasoning on both API styles
      // OpenRouter: exclude the reasoning output
      bodyFields.reasoning = { exclude: true };
      // DeepSeek / Qwen: explicitly turn off thinking mode
      bodyFields.enable_thinking = false;
    }

    const data = JSON.stringify(bodyFields);
    console.log('[AI-STREAM] Request body:', data.slice(0, 500));

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, options, (res) => {
      if (res.statusCode >= 400) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => reject(new Error(`API returned ${res.statusCode}: ${body.slice(0, 500)}`)));
        return;
      }

      // Accumulate buffer to handle partial SSE lines
      let buffer = '';
      let totalThinkingTokens = 0;
      let totalContentTokens = 0;
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        // Process complete SSE lines
        const lines = buffer.split('\n');
        // Keep last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data:')) continue;

          try {
            const jsonStr = trimmed.slice(5); // remove "data: " prefix
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta || {};

            // Process reasoning/thinking and content independently so both can exist in same chunk

            // Qwen / DeepSeek / OpenRouter style: reasoning_content in delta
            if (delta.reasoning_content && typeof delta.reasoning_content === 'string') {
              totalThinkingTokens++;
              onToken({ type: 'thinking', content: delta.reasoning_content });
            }
            // Anthropic/Claude style: thinking_blocks as separate field
            else if (parsed.thinking) {
              totalThinkingTokens++;
              onToken({ type: 'thinking', content: parsed.thinking });
            } else if (delta.type === 'thinking_delta' && delta.thinking?.content) {
              totalThinkingTokens++;
              onToken({ type: 'thinking', content: delta.thinking.content });
            }
            // OpenAI-compatible thinking_delta
            else if (parsed.choices?.[0]?.thinking_delta?.content) {
              totalThinkingTokens++;
              onToken({ type: 'thinking', content: parsed.choices[0].thinking_delta.content });
            }

            // Standard content token — process independently of reasoning
            if (delta.content && typeof delta.content === 'string') {
              totalContentTokens++;
              onToken({ type: 'content', content: delta.content });
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      res.on('end', () => {
        console.log(`[AI-STREAM] Stream ended — thinking_tokens: ${totalThinkingTokens}, content_tokens: ${totalContentTokens}`);
        resolve();
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error('Request timed out after 120s'));
    });
    req.write(data);
    req.end();
  });
}

// ─── Start server ──────────────────────────────────────────────────────

console.log('[server] Starting AI Chat Backend...');
console.log(`[server] PORT=${PORT}, NODE_ENV=${process.env.NODE_ENV || '(not set)'}`);

initDB().then(() => {
  console.log('[server] Database initialized successfully');
  const host = '0.0.0.0';
  app.listen(PORT, host, () => {
    console.log(`[server] AI Chat Backend running on http://${host}:${PORT}`);
  });
}).catch((err) => {
  console.error('[server] FATAL: Failed to initialize database:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
