import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STATE,
  formatRelationshipState,
  buildStateUpdateMessages,
  extractFirstJsonObject,
  parseStateUpdate,
} from './relationshipState.js';

test('formatRelationshipState renders the current values', () => {
  const text = formatRelationshipState();
  assert.match(text, /Confianza: 10\/100/);
  assert.match(text, /Atracción: 0\/100/);
});

test('formatRelationshipState reflects a persisted state', () => {
  const text = formatRelationshipState({ ...DEFAULT_STATE, trust: 42, stage: 'amigos cercanos' });
  assert.match(text, /Confianza: 42\/100/);
  assert.match(text, /Etapa: amigos cercanos/);
});

test('buildStateUpdateMessages produces a system + user message with the turn context', () => {
  const messages = buildStateUpdateMessages({
    previousState: { ...DEFAULT_STATE, trust: 20 },
    characterSummary: 'Rika es reservada.',
    userMessage: 'Hola, ¿qué tal?',
    assistantReply: 'Rika te mira de reojo. — Bien.',
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /"trust":20/);
  assert.match(messages[1].content, /Hola, ¿qué tal\?/);
  assert.match(messages[1].content, /Rika te mira de reojo/);
  assert.match(messages[1].content, /Rika es reservada/);
});

test('buildStateUpdateMessages omits the character section when none is provided', () => {
  const messages = buildStateUpdateMessages({
    previousState: DEFAULT_STATE,
    userMessage: 'hola',
    assistantReply: 'hola de vuelta',
  });
  assert.doesNotMatch(messages[1].content, /\nPERSONAJE:\n/);
});

test('extractFirstJsonObject finds a balanced object amid other text', () => {
  const raw = 'blah blah {"trust": 20, "note": "a { nested } string \\"quote\\""} trailing junk';
  const json = extractFirstJsonObject(raw);
  assert.equal(JSON.parse(json).trust, 20);
});

test('extractFirstJsonObject survives a markdown code fence around the JSON', () => {
  const raw = '```json\n{"trust": 30, "attraction": 5}\n```';
  const json = extractFirstJsonObject(raw);
  assert.equal(JSON.parse(json).trust, 30);
});

test('extractFirstJsonObject returns null when there is no object', () => {
  assert.equal(extractFirstJsonObject('no json here'), null);
  assert.equal(extractFirstJsonObject(''), null);
});

test('parseStateUpdate applies a small delta within the allowed range', () => {
  const previous = { ...DEFAULT_STATE, trust: 10 };
  const raw = '{"trust": 15, "attraction": 0, "comfort": 15, "tension": 0, "stage": "conocidos recientes", "impression": "curiosidad", "doubts": "poca", "boundaries": "normal"}';
  const { state, changed } = parseStateUpdate(raw, previous);
  assert.equal(changed, true);
  assert.equal(state.trust, 15);
});

test('parseStateUpdate clamps large jumps to the max delta per turn', () => {
  const previous = { ...DEFAULT_STATE, trust: 10 };
  const raw = '{"trust": 100, "attraction": 0, "comfort": 15, "tension": 0, "stage": "x", "impression": "x", "doubts": "x", "boundaries": "x"}';
  const { state } = parseStateUpdate(raw, previous);
  assert.ok(state.trust > previous.trust);
  assert.ok(state.trust < 100);
});

test('parseStateUpdate clamps values into the 0-100 range', () => {
  const previous = { ...DEFAULT_STATE, trust: 5 };
  const raw = '{"trust": -50}';
  const { state } = parseStateUpdate(raw, previous);
  assert.ok(state.trust >= 0);
});

test('parseStateUpdate falls back to previous state on malformed JSON', () => {
  const previous = { ...DEFAULT_STATE, trust: 33 };
  const { state, changed } = parseStateUpdate('not json at all', previous);
  assert.equal(changed, false);
  assert.equal(state.trust, 33);
});

test('parseStateUpdate falls back to previous state when response is empty', () => {
  const previous = { ...DEFAULT_STATE, trust: 44 };
  const { state, changed } = parseStateUpdate(null, previous);
  assert.equal(changed, false);
  assert.equal(state.trust, 44);
});

test('parseStateUpdate ignores unrelated extra keys and keeps text fields bounded', () => {
  const previous = { ...DEFAULT_STATE };
  const raw = `{"trust": 12, "attraction": 1, "comfort": 16, "tension": 0, "stage": "x", "impression": "${'y'.repeat(500)}", "doubts": "z", "boundaries": "w", "unexpected": true}`;
  const { state } = parseStateUpdate(raw, previous);
  assert.ok(state.impression.length <= 200);
});
