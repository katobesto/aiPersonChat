import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoleplayMessages, detectRepeatedUserMessage, buildRecentPatternsSection, normalizeConversationHistory } from './promptBuilder.js';

const sampleInput = () => ({
  systemPrompt: 'Reglas del proyecto de ejemplo.',
  story: ['El mundo es una ciudad flotante en el año 2140.'],
  characters: [{ id: 1, name: 'Rika', prompt: 'Rika es reservada y desconfiada al principio.' }],
  context: {},
  narrativePrompt: 'Escribe en tercera persona con frases cortas.',
  history: [
    { role: 'user', content: 'Hola, ¿cómo estás?' },
    { role: 'assistant', content: 'Rika te mira de reojo. — Bien, supongo.' },
  ],
  userMessage: '¿Quieres que te cuente algo sobre mí?',
});

test('exactly one system message, at position 0', () => {
  const messages = buildRoleplayMessages(sampleInput());
  const systemMessages = messages.filter(m => m.role === 'system');
  assert.equal(systemMessages.length, 1);
  assert.equal(messages[0].role, 'system');
});

test('narrative style is inside the system message, not a separate trailing message', () => {
  const messages = buildRoleplayMessages(sampleInput());
  assert.match(messages[0].content, /<NARRATIVE_STYLE>/);
  assert.match(messages[0].content, /Escribe en tercera persona/);
  const last = messages[messages.length - 1];
  assert.equal(last.role, 'user');
  assert.doesNotMatch(last.content, /NARRATIVE_STYLE/);
});

test('current user message is last and not duplicated', () => {
  const input = sampleInput();
  const messages = buildRoleplayMessages(input);
  const last = messages[messages.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content, input.userMessage);
  const occurrences = messages.filter(m => m.content === input.userMessage).length;
  assert.equal(occurrences, 1);
});

test('history preserves chronological order and valid roles', () => {
  const messages = buildRoleplayMessages(sampleInput());
  const roles = messages.map(m => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
});

test('story and characters appear in distinct sections', () => {
  const messages = buildRoleplayMessages(sampleInput());
  assert.match(messages[0].content, /<STORY_CANON>/);
  assert.match(messages[0].content, /<CHARACTER_PROFILE id="1" name="Rika">/);
});

test('relationship state has safe defaults when none provided', () => {
  const messages = buildRoleplayMessages(sampleInput());
  assert.match(messages[0].content, /<RELATIONSHIP_STATE>/);
  assert.match(messages[0].content, /Confianza: 10\/100/);
});

test('empty sections are omitted, no undefined/null leaks', () => {
  const input = sampleInput();
  input.story = [];
  input.context = {};
  const messages = buildRoleplayMessages(input);
  assert.doesNotMatch(messages[0].content, /<STORY_CANON>/);
  assert.doesNotMatch(messages[0].content, /<SCENE_STATE>/);
  assert.doesNotMatch(messages[0].content, /<PRIVATE_CONTEXT>/);
  assert.doesNotMatch(messages[0].content, /undefined/);
  assert.doesNotMatch(messages[0].content, /null/);
  assert.doesNotMatch(messages[0].content, /\[object Object\]/);
});

test('a two-sentence-max instruction in the current message is not contradicted by narrative style', () => {
  const input = sampleInput();
  input.userMessage = 'Contesta con un máximo de dos frases. ¿Qué opinas?';
  const messages = buildRoleplayMessages(input);
  const last = messages[messages.length - 1];
  assert.equal(last.content, input.userMessage);
  // The engine core explicitly states explicit user length instructions win over style.
  assert.match(messages[0].content, /prioridad sobre las preferencias de estilo/);
});

test('preserves unicode and Spanish text unmodified', () => {
  const input = sampleInput();
  input.userMessage = '¿Qué tal tu día? ñoño café';
  const messages = buildRoleplayMessages(input);
  assert.equal(messages[messages.length - 1].content, input.userMessage);
});

test('detectRepeatedUserMessage flags near-identical recent messages', () => {
  const history = normalizeConversationHistory([
    { role: 'user', content: 'Me encanta programar pequeños robots' },
    { role: 'assistant', content: 'Interesante.' },
  ]);
  assert.equal(detectRepeatedUserMessage(history, 'Me encanta programar pequeños robots'), true);
  assert.equal(detectRepeatedUserMessage(history, 'Me encanta programar pequeños robots.'), true);
  assert.equal(detectRepeatedUserMessage(history, 'Hoy quiero hablar de otra cosa'), false);
});

test('detectRepeatedUserMessage does not mutate or alter the user text itself', () => {
  const original = 'Hola de nuevo';
  const history = normalizeConversationHistory([{ role: 'user', content: original }]);
  detectRepeatedUserMessage(history, original);
  const messages = buildRoleplayMessages({ ...sampleInput(), history: [{ role: 'user', content: original }], userMessage: original });
  const last = messages[messages.length - 1];
  assert.equal(last.content, original);
});

test('recent patterns section only derives from recent assistant replies', () => {
  const history = [
    { role: 'assistant', content: 'Ella sonríe y sus ojos brillan.' },
    { role: 'user', content: 'ok' },
    { role: 'assistant', content: 'Sus ojos siguen fijos en ti mientras sonríe de nuevo.' },
  ];
  const section = buildRecentPatternsSection(history);
  assert.match(section, /<RECENT_PATTERNS_TO_AVOID>/);
});

test('normalizeConversationHistory drops empty messages and invalid roles', () => {
  const result = normalizeConversationHistory([
    { role: 'user', content: '  ' },
    { role: 'system', content: 'should be dropped' },
    { role: 'user', content: 'kept message' },
  ]);
  assert.deepEqual(result, [{ role: 'user', content: 'kept message' }]);
});
