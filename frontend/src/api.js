const BASE = '/api';

export async function fetchSettings() {
  const res = await fetch(`${BASE}/settings`);
  return res.json();
}

export async function saveSettings(settings) {
  const res = await fetch(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

export async function fetchChats() {
  const res = await fetch(`${BASE}/chats`);
  return res.json();
}

export async function createChat(title) {
  const res = await fetch(`${BASE}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function deleteChat(id) {
  const res = await fetch(`${BASE}/chats/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function renameChat(id, title) {
  const res = await fetch(`${BASE}/chats/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function fetchMessages(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}/messages`);
  return res.json();
}

/**
 * Rewind — delete all messages after the given message ID in a chat.
 * @param {number} chatId
 * @param {number} msgId - Keep this message, delete everything after it.
 */
export async function rewindMessages(chatId, msgId) {
  const res = await fetch(`${BASE}/chats/${chatId}/messages/after/${msgId}`, { method: 'DELETE' });
  return res.json();
}

/**
 * Send a message and stream the AI response back via SSE.
 * @param {number} chatId
 * @param {string} content
 * @param {(token: string) => void} onToken — called for each text chunk
 * @param {() => void} onDone   — called when the stream finishes successfully
 * @param {(error: string) => void} onError — called on error
 */
export function sendMessageStream(chatId, content, onToken, onDone, onError) {
  const url = `${BASE}/chats/${chatId}/messages`;

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).then(async (res) => {
    // If the response is NOT an SSE stream, handle as regular JSON error
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

      // Process complete SSE lines
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
        } catch {
          // Skip malformed lines
        }
      }
    }
  }).catch((err) => {
    console.error('Stream error:', err);
    onError('Network error. Please try again.');
  });
}

/**
 * Fetch available models from the configured provider.
 */
export async function fetchModels() {
  const res = await fetch(`${BASE}/models`);
  return res.json(); // { models: [{ id, name, ... }], error?: string }
}

/**
 * Get list of available Edge TTS voices from the backend.
 */
export async function fetchTtsVoices() {
  const res = await fetch(`${BASE}/tts/voices`);
  return res.json();
}

/**
 * Synthesize speech using Microsoft Edge TTS and play it in the browser.
 * @param {string} text - Text to speak
 * @param {string} voice - Voice name (e.g. 'es-ES-AlvaroNeural')
 */
export function speakWithEdgeTts(text, voice) {
  return fetch(`${BASE}/tts`, {
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
  }).catch((err) => {
    console.error('TTS error:', err);
  });
}
