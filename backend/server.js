import express from 'express';
import cors from 'cors';
import { initDB, getDB, save } from './db.js';
import http from 'http';
import https from 'https';
import { EdgeTTS } from 'edge-tts-universal';

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

app.get('/api/chats', (_req, res) => {
  const chats = execQuery('SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC');
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
  runSQL('DELETE FROM messages WHERE chat_id = ?', [Number(req.params.id)]);
  const info = runSQL('DELETE FROM chats WHERE id = ?', [Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Chat not found' });
  save();
  res.json({ ok: true });
});

// ─── Rename chat ───────────────────────────────────────────────────────

app.put('/api/chats/:id', (req, res) => {
  const info = runSQL(
    'UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [req.body.title || 'New Chat', Number(req.params.id)]
  );
  if (info.changes === 0) return res.status(404).json({ error: 'Chat not found' });
  save();
  res.json({ ok: true });
});

// ─── Messages ──────────────────────────────────────────────────────────

app.get('/api/chats/:id/messages', (req, res) => {
  const messages = execQuery(`SELECT id, role, content, created_at FROM messages WHERE chat_id = ${Number(req.params.id)} ORDER BY created_at ASC`);
  for (const msg of messages) msg.id = Number(msg.id);
  res.json(messages);
});

// ─── Rewind — delete all messages from a given ID onward ──────────────

app.delete('/api/chats/:chatId/messages/after/:msgId', (req, res) => {
  const chatId = Number(req.params.chatId);
  const msgId = Number(req.params.msgId);

  // Delete all messages with id > the given msgId in this chat
  runSQL('DELETE FROM messages WHERE chat_id = ? AND id > ?', [chatId, msgId]);
  save();
  res.json({ ok: true });
});

// ─── Send message to AI with streaming ─────────────────────────────────

app.post('/api/chats/:id/messages', async (req, res) => {
  const chatId = Number(req.params.id);
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

    // Build full context: system prompt + all messages (memory)
    const historyRaw = getDB().exec(`SELECT role, content FROM messages WHERE chat_id = ${chatId} ORDER BY created_at ASC`);
    const history = (historyRaw?.[0]?.values || []).map(row => ({ role: row[0], content: row[1] }));

    const apiMessages = [];

    // Build combined system prompt: character description + story context + roleplay guidelines
    const systemParts = [];
    if (settings.character_description?.trim()) {
      systemParts.push(`CHARACTER DESCRIPTION:\n${settings.character_description.trim()}`);
    }
    if (settings.story?.trim()) {
      systemParts.push(`STORY CONTEXT:\n${settings.story.trim()}`);
    }
    if (settings.system_prompt?.trim()) {
      systemParts.push(settings.system_prompt.trim());
    }
    if (systemParts.length > 0) {
      apiMessages.push({ role: 'system', content: systemParts.join('\n\n') });
    }

    // Full conversation history (memory)
    for (const msg of history) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

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

            // Qwen / OpenRouter style: reasoning_content in delta (separate from content)
            if (delta.reasoning_content !== undefined) {
              onToken({ type: 'thinking', content: delta.reasoning_content });
            }
            // Anthropic/Claude style: thinking_blocks as separate field
            else if (parsed.thinking) {
              onToken({ type: 'thinking', content: parsed.thinking });
            } else if (delta.type === 'thinking_delta' && delta.thinking?.content) {
              onToken({ type: 'thinking', content: delta.thinking.content });
            }
            // OpenAI-compatible thinking_delta
            else if (parsed.choices?.[0]?.thinking_delta?.content) {
              onToken({ type: 'thinking', content: parsed.choices[0].thinking_delta.content });
            }
            // Standard content token
            else if (delta.content) {
              onToken({ type: 'content', content: delta.content });
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      res.on('end', () => resolve());
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

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 AI Chat Backend running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
