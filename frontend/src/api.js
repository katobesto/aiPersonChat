const BASE = '/api';

/** Get the stored auth token */
export function getToken() {
  return localStorage.getItem('authToken');
}

/** Save or clear the auth token */
export function setToken(token) { localStorage.setItem('authToken', token); }
export function clearToken() { localStorage.removeItem('authToken'); }

/** Shared fetch that injects Bearer token automatically */
function authFetch(url, options = {}) {
  const headers = { ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

export async function fetchSettings() {
  const res = await authFetch(`${BASE}/settings`);
  return res.json();
}

export async function saveSettings(settings) {
  const res = await authFetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function fetchChats() {
  const res = await authFetch(`${BASE}/chats`);
  return res.json();
}

export async function createChat(title) {
  const res = await authFetch(`${BASE}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function deleteChat(id) {
  const res = await authFetch(`${BASE}/chats/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function renameChat(id, title) {
  const res = await authFetch(`${BASE}/chats/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function exportChat(chatId) {
  const res = await authFetch(`${BASE}/chats/${chatId}/export`);
  if (!res.ok) throw new Error('Export failed');
  const data = await res.json();
  // Trigger file download
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.title.replace(/[^a-z0-9áéíóúñ ]/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return data;
}

export async function importChat(data) {
  const res = await authFetch(`${BASE}/chats/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Import failed');
  return res.json();
}

export async function fetchMessages(chatId) {
  const res = await authFetch(`${BASE}/chats/${chatId}/messages`);
  return res.json();
}

/**
 * Rewind — delete all messages after the given message ID in a chat.
 */
export async function rewindMessages(chatId, msgId) {
  const res = await authFetch(`${BASE}/chats/${chatId}/messages/after/${msgId}`, { method: 'DELETE' });
  return res.json();
}

/**
 * Send a message and stream the AI response back via SSE.
 */
export function sendMessageStream(chatId, content, onToken, onDone, onError) {
  const url = `${BASE}/chats/${chatId}/messages`;
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
  }).then(async (res) => {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      const data = await res.json().catch(() => ({}));
      onError(data.error || 'Unexpected server response');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        try {
          const data = JSON.parse(trimmed.slice(5));
          if (data.done) {
            onDone?.({ content: data.content, prompt: data.prompt });
          } else if (data.error) {
            onError(data.error);
          } else if (data.delta !== undefined) {
            onToken({ delta: data.delta, type: data.type || 'content' });
          }
        } catch { /* skip malformed */ }
      }
    }
  }).catch((err) => {
    console.error('Stream error:', err);
    onError('Network error. Please try again.');
  });
}

export async function fetchModels() {
  const res = await authFetch(`${BASE}/models`);
  return res.json();
}

export async function fetchTtsVoices() {
  const res = await authFetch(`${BASE}/tts/voices`);
  return res.json();
}

export function speakWithEdgeTts(text, voice) {
  return authFetch(`${BASE}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  }).then(async (res) => {
    if (!res.ok) throw new Error('TTS failed');
    const blob = await res.blob();
    return new Promise((resolve) => {
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.onended = () => { URL.revokeObjectURL(audioUrl); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(audioUrl); resolve(); };
      audio.play().catch(() => resolve());
    });
  }).catch((err) => { console.error('TTS error:', err); });
}

// ─── Auth API (no token needed for login) ──────────────────────
export async function loginUser(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');
  setToken(data.token);
  return data; // { token, role, username }
}

export function logoutUser() { clearToken(); }

/** Get current user info (requires token). Returns null if not authenticated. */
export async function getCurrentUser() {
  try {
    const res = await authFetch(`${BASE}/auth/me`);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ─── Characters API ──────────────────────────────────────────────
export async function fetchCharacters() {
  const res = await authFetch(`${BASE}/characters`);
  return res.json();
}
export async function createCharacter(name, prompt) {
  const res = await authFetch(`${BASE}/characters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, prompt }),
  });
  return res.json();
}
export async function updateCharacter(id, name, prompt) {
  const res = await authFetch(`${BASE}/characters/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, prompt }),
  });
  return res.json();
}
export async function deleteCharacter(id) {
  const res = await authFetch(`${BASE}/characters/${id}`, { method: 'DELETE' });
  return res.json();
}

// ─── Stories API ──────────────────────────────────────────────
export async function fetchStories() {
  const res = await authFetch(`${BASE}/stories`);
  return res.json();
}
export async function createStory(name, prompt) {
  const res = await authFetch(`${BASE}/stories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, prompt }),
  });
  return res.json();
}
export async function updateStory(id, name, prompt) {
  const res = await authFetch(`${BASE}/stories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, prompt }),
  });
  return res.json();
}
export async function deleteStory(id) {
  const res = await authFetch(`${BASE}/stories/${id}`, { method: 'DELETE' });
  return res.json();
}

// ─── Chat Assignments API ──────────────────────────────────────
export async function fetchChatAssignments(chatId) {
  const res = await authFetch(`${BASE}/chats/${chatId}/assignments`);
  return res.json(); // { characters: [...], stories: [...] }
}
export async function addChatAssignment(chatId, assign_type, entity_id) {
  const res = await authFetch(`${BASE}/chats/${chatId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assign_type, entity_id }),
  });
  return res.json();
}
export async function removeChatAssignment(chatId, assign_type, entity_id) {
  const res = await authFetch(`${BASE}/chats/${chatId}/assignments`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assign_type, entity_id }),
  });
  return res.json();
}

// ─── Users API (admin only) ──────────────────────────────────────
export async function fetchUsers() {
  const res = await authFetch(`${BASE}/users`);
  return res.json();
}
export async function registerUser(username, password, role) {
  const res = await authFetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role: role || 'user' }),
  });
  return res.json();
}
export async function updateUser(id, fields) {
  const res = await authFetch(`${BASE}/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  return res.json();
}
export async function deleteUser(id) {
  const res = await authFetch(`${BASE}/users/${id}`, { method: 'DELETE' });
  return res.json();
}

// ─── User Assignments API (admin only) ──────────────────────────
export async function fetchUserAssignments(userId) {
  const res = await authFetch(`${BASE}/users/${userId}/assignments`);
  return res.json(); // { chats: [...], characters: [...], stories: [...] }
}
export async function addUserAssignment(userId, assign_type, entity_id) {
  const res = await authFetch(`${BASE}/users/${userId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assign_type, entity_id }),
  });
  return res.json();
}
export async function removeUserAssignment(userId, assign_type, entity_id) {
  const res = await authFetch(`${BASE}/users/${userId}/assignments`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assign_type, entity_id }),
  });
  return res.json();
}
