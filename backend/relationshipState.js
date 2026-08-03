// ─── Persistent relationship-state tracking ─────────────────────────────
// Previously RELATIONSHIP_STATE was a hardcoded, static block re-sent every
// turn — stats never actually moved. This module makes it real:
//   1. The compiled roleplay prompt shows the CURRENT persisted state (see
//      formatRelationshipState, used by promptBuilder.js) so the character's
//      behavior is informed by it.
//   2. After the visible reply streams to the user, the server makes a
//      SEPARATE small, non-streaming follow-up call (see
//      buildStateUpdateMessages + server.js) whose only job is to report the
//      updated state as JSON. This runs in the background — it never delays
//      the user-visible reply — and its result is parsed + clamped here
//      before being persisted for next turn.
//
// Why a separate call instead of asking the same in-character reply to also
// emit a hidden JSON block: tested against the project's real DeepSeek
// endpoint, character/roleplay-tuned models reliably ignore an in-band
// "break character to output JSON" instruction even when it's the very last
// thing in the prompt. A dedicated call has no competing "stay in character"
// pressure and actually gets followed.
//
// One state row per chat (not per character): this app renders a single
// blended assistant reply per turn even when multiple characters are
// assigned, so there is no per-character response to attribute state to.

// Maximum absolute change allowed per turn for any numeric field, enforced
// server-side regardless of what the model outputs — this is what actually
// guarantees "avanza gradualmente" instead of trusting the model's restraint.
const MAX_DELTA_PER_TURN = 12;

export const DEFAULT_STATE = {
  stage: 'desconocidos o conocidos recientes',
  trust: 10,
  attraction: 0,
  comfort: 15,
  tension: 0,
  impression: 'todavía no formada',
  doubts: 'no conoce suficientemente al usuario',
  boundaries: 'prudencia normal entre desconocidos',
};

export function formatRelationshipState(state) {
  const s = { ...DEFAULT_STATE, ...(state || {}) };
  return `Etapa: ${s.stage}
Confianza: ${s.trust}/100
Atracción: ${s.attraction}/100
Comodidad: ${s.comfort}/100
Tensión: ${s.tension}/100
Impresión actual: ${s.impression}
Dudas actuales: ${s.doubts}
Límites actuales: ${s.boundaries}

Estas cifras son orientativas, no mecánicas: no las incrementes automáticamente solo porque el usuario haga un cumplido, revele una vulnerabilidad o comparta una afición.`;
}

const STATE_ANALYST_SYSTEM_PROMPT = `Eres un analizador de estado relacional para un sistema de rol. Tu única tarea es leer el turno más reciente de una conversación y devolver el estado relacional actualizado del personaje hacia el usuario.

Responde ÚNICAMENTE con un objeto JSON de una sola línea, sin texto adicional, sin markdown, sin bloques de código, sin explicación alguna. El objeto debe tener exactamente estas ocho claves: trust (0-100), attraction (0-100), comfort (0-100), tension (0-100), stage (texto breve), impression (texto breve), doubts (texto breve), boundaries (texto breve).

Ajusta los valores solo ligeramente respecto a los actuales (nunca saltos grandes en un solo turno); si nada relevante cambió en este intercambio, repite los mismos valores. No premies cumplidos, vulnerabilidades compartidas o aficiones ordinarias con subidas automáticas de confianza o atracción — solo si el contenido del turno realmente lo justifica.`;

// Builds the messages array for the dedicated, non-streaming follow-up call.
// Kept intentionally small: current state + the one turn that just happened.
export function buildStateUpdateMessages({ previousState, characterSummary, userMessage, assistantReply }) {
  const state = { ...DEFAULT_STATE, ...(previousState || {}) };
  const userParts = [
    `ESTADO ACTUAL:\n${JSON.stringify(state)}`,
    characterSummary?.trim() ? `PERSONAJE:\n${characterSummary.trim()}` : null,
    `MENSAJE DEL USUARIO:\n${userMessage || ''}`,
    `RESPUESTA DEL PERSONAJE:\n${assistantReply || ''}`,
    'Devuelve el nuevo estado como el objeto JSON descrito, con las ocho claves: trust, attraction, comfort, tension, stage, impression, doubts, boundaries.',
  ].filter(Boolean);

  return [
    { role: 'system', content: STATE_ANALYST_SYSTEM_PROMPT },
    { role: 'user', content: userParts.join('\n\n') },
  ];
}

// ─── JSON extraction + parsing ───────────────────────────────────────────
// Finds the first balanced {...} object in text, honoring quoted strings
// and escapes, so it survives minor formatting noise (stray prose, markdown
// fences) around the actual JSON.
export function extractFirstJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function clampNumber(value, previous) {
  if (typeof value !== 'number' || Number.isNaN(value)) return previous;
  const target = Math.min(100, Math.max(0, value));
  const delta = target - previous;
  const limitedDelta = Math.max(-MAX_DELTA_PER_TURN, Math.min(MAX_DELTA_PER_TURN, delta));
  return Math.round(Math.min(100, Math.max(0, previous + limitedDelta)));
}

function cleanText(value, previous, maxLen) {
  if (typeof value !== 'string' || !value.trim()) return previous;
  return value.trim().slice(0, maxLen);
}

// Parses the analyst call's raw response against the previous persisted
// state. Any failure (no JSON found, malformed JSON, wrong types) silently
// falls back to the previous state unchanged — never throws, never corrupts
// state, regardless of how the model responds.
export function parseStateUpdate(rawResponse, previousState) {
  const base = { ...DEFAULT_STATE, ...(previousState || {}) };
  const jsonText = extractFirstJsonObject(rawResponse || '');
  if (!jsonText) return { state: base, changed: false };

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { state: base, changed: false };
  }
  if (!parsed || typeof parsed !== 'object') return { state: base, changed: false };

  const next = {
    trust: clampNumber(parsed.trust, base.trust),
    attraction: clampNumber(parsed.attraction, base.attraction),
    comfort: clampNumber(parsed.comfort, base.comfort),
    tension: clampNumber(parsed.tension, base.tension),
    stage: cleanText(parsed.stage, base.stage, 60),
    impression: cleanText(parsed.impression, base.impression, 200),
    doubts: cleanText(parsed.doubts, base.doubts, 200),
    boundaries: cleanText(parsed.boundaries, base.boundaries, 200),
  };
  return { state: next, changed: true };
}
