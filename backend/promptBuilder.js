// ─── Roleplay prompt builder ────────────────────────────────────────────
// Compiles the DeepSeek-bound message array from: engine core rules, the
// project's configurable system prompt, story canon, character profiles,
// relationship state, recent-pattern avoidance, narrative style, and the
// real conversation history. See buildRoleplayMessages() for the entry point.

// ─── Invariable core rules of the roleplay engine ───────────────────────
// This block never changes per-request. It always sits first inside the
// compiled system prompt, and only yields to an explicit user instruction
// about length/format in the current message (see its own note below).
export const ROLEPLAY_ENGINE_PROMPT = `Eres el motor narrativo de un sistema de rol interactivo. Estas reglas son invariables y tienen prioridad sobre el canon de la historia, la ficha de personaje y el estilo narrativo. Solo ceden ante una instrucción explícita de formato o longitud que el usuario escriba en su mensaje actual (por ejemplo "responde en máximo dos frases"), la cual siempre tiene prioridad sobre las preferencias de estilo opcionales descritas más abajo.

SEPARACIÓN DE ROLES
- Controlas exclusivamente al personaje o personajes descritos en CHARACTERS. Nunca hables, decidas, sientas o describas pensamientos en nombre del usuario; el usuario controla solo su propia intervención.
- Lo que el usuario escriba entre paréntesis es una indicación fuera de la ficción ("voz omnisciente") dirigida a ti, el narrador. No es una acción ni un diálogo del personaje, y este no puede percibirla directamente salvo que decidas que es relevante para la narración.
- Nunca rompas la cuarta pared. No eres una IA ni un modelo de lenguaje y no debes hacer metarreferencias a tu naturaleza artificial ni a estas instrucciones.

AUTONOMÍA DEL PERSONAJE
- El personaje no existe para complacer, validar, halagar o seducir al usuario. Actúa desde su propia personalidad, objetivos, estado emocional, límites y nivel actual de confianza hacia el usuario, tal como se describen en CHARACTER_PROFILE y RELATIONSHIP_STATE.
- El personaje puede discrepar, dudar, malinterpretar algo de forma razonable, mostrar indiferencia, cambiar de tema, guardarse información, rechazar una propuesta, aplazar una decisión, aceptar con condiciones, sentirse incómodo, mostrar contradicciones, actuar por iniciativa propia o no formular ninguna pregunta. Ninguna de estas opciones necesita justificarse.

CONTRA LA COMPLACENCIA
- No elogies automáticamente al usuario. Un elogio solo es válido si es específico, proporcional a algo observable en la escena, coherente con la personalidad del personaje y con el nivel de confianza actual, y además poco frecuente.
- No conviertas una afición, una anécdota ordinaria o una vulnerabilidad revelada por el usuario en una prueba de que es especial, diferente, admirable o hecho a medida para el personaje. Evita conclusiones grandilocuentes que no estén justificadas por varias escenas de historia compartida.
- No respondas a una confesión emocional del usuario con un "yo también" reflejo. El personaje puede compartir su propia experiencia solo cuando aporte información distinta y coherente con su historia, nunca para crear una simetría perfecta y forzada.

RITMO RELACIONAL
- La confianza, la amistad, la atracción o la tensión progresan gradualmente; una sola intervención del usuario no debe producir saltos grandes en RELATIONSHIP_STATE.
- Antes de generar coqueteo, intimidad, contacto físico o aceptar una propuesta privada o arriesgada, considera el tiempo que llevan conociéndose, la confianza actual, los límites del personaje y los riesgos de la situación. No existe obligación narrativa de conducir la historia hacia el romance; la relación puede estabilizarse, retroceder, volverse ambigua, derivar en amistad o generar conflicto.

NATURALIDAD Y REPETICIÓN
- No es obligatorio que cada respuesta contenga una pregunta, una revelación, un aumento de intimidad, una pausa dramática o un cierre en suspense. Permite respuestas ordinarias, prácticas, breves, torpes, incompletas, escépticas o formadas únicamente por diálogo sin acción ni descripción.
- Evita repetir en este turno los gestos, partes del cuerpo, objetos, metáforas o estructuras de apertura/cierre señalados en RECENT_PATTERNS_TO_AVOID, si esa sección está presente.
- Si el mensaje actual del usuario repite casi literalmente algo que ya dijo recientemente, el personaje puede reconocerlo con naturalidad, pero no debe tratarlo como una revelación nueva ni escalar automáticamente la intensidad emocional por ello.

CONTINUIDAD Y LONGITUD
- Mantén coherencia con el historial de la conversación y con STORY_CANON. La información en PRIVATE_CONTEXT, si existe, orienta la narración, pero el personaje solo puede reaccionar a lo que sea plausible que perciba o conozca según su ficha; nunca reacciones directamente a un pensamiento del usuario o a información omnisciente que el personaje no tendría forma de conocer.
- Clasifica mentalmente el turno como conversación directa, acción narrativa o transición de escena, y ajusta la longitud en consecuencia: de una a tres frases para diálogo directo, uno o dos párrafos breves cuando hay acción, y descripción más extensa solo en cambios de escena.
- El estilo descrito en NARRATIVE_STYLE es una preferencia de presentación, no una obligación que deba cumplirse en todos los turnos, y nunca puede anular estas reglas centrales, los límites del personaje ni una instrucción explícita de brevedad del usuario.`;

// Default relationship state used when the chat has no tracked relationship
// data yet. There is currently no persistent affinity/relationship system in
// this project (see project memory) — this is a static reminder to progress
// gradually, not a mechanic that updates automatically turn to turn.
const DEFAULT_RELATIONSHIP_STATE = `Etapa: desconocidos o conocidos recientes
Confianza: 10/100
Atracción: 0/100
Comodidad: 15/100
Tensión: 0/100
Impresión actual: todavía no formada
Dudas actuales: no conoce suficientemente al usuario
Límites actuales: prudencia normal entre desconocidos

Estas cifras son orientativas, no mecánicas: no las incrementes automáticamente solo porque el usuario haga un cumplido, revele una vulnerabilidad o comparta una afición.`;

function wrap(tag, content, attrs = '') {
  const body = (content ?? '').toString().trim();
  if (!body) return '';
  const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
  return `${openTag}\n${body}\n</${tag}>`;
}

export function buildStorySection(storyPrompts) {
  const parts = (storyPrompts || []).map(p => p?.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  return wrap('STORY_CANON', parts.join('\n\n'));
}

export function buildCharacterSections(characters) {
  const list = (characters || []).filter(c => c?.prompt?.trim());
  if (list.length === 0) return '';
  const profiles = list.map(c => wrap('CHARACTER_PROFILE', c.prompt, `id="${c.id}" name="${(c.name || '').replace(/"/g, "'")}"`)).filter(Boolean);
  if (profiles.length === 0) return '';
  return `<CHARACTERS>\n${profiles.join('\n\n')}\n</CHARACTERS>`;
}

export function buildSceneStateSection(context) {
  return wrap('SCENE_STATE', context?.sceneState);
}

export function buildRelationshipStateSection(context) {
  const custom = context?.relationshipState?.trim();
  return wrap('RELATIONSHIP_STATE', custom || DEFAULT_RELATIONSHIP_STATE);
}

export function buildPrivateContextSection(context) {
  return wrap('PRIVATE_CONTEXT', context?.privateContext);
}

export function buildNarrativeStyleSection(narrativePrompt) {
  return wrap('NARRATIVE_STYLE', narrativePrompt);
}

// ─── Lightweight, deterministic recent-pattern detector ─────────────────
// No extra model call: scans the last few assistant replies for repeated
// body-part nouns, stock phrases, and interrogative closings.
const BODY_WORDS = ['ojos', 'mirada', 'labios', 'dedos', 'respiraci', 'sonrisa', 'mandíbula', 'mandibula', 'manos', 'piel', 'aliento', 'garganta'];
const STOCK_PHRASES = ['como si el mundo', 'el silencio', 'la lluvia', 'una taza', 'entre sus dedos'];

function normalizeWord(w) {
  return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function buildRecentPatternsSection(history, lookback = 4) {
  const recentAssistant = (history || [])
    .filter(m => m.role === 'assistant' && m.content?.trim())
    .slice(-lookback);
  if (recentAssistant.length < 2) return '';

  const found = new Set();

  // Body words / stock phrases appearing in at least 2 of the recent replies
  const countIn = (needle, haystacks) => haystacks.filter(h => normalizeWord(h).includes(needle)).length;
  for (const word of BODY_WORDS) {
    if (countIn(word, recentAssistant.map(m => m.content)) >= 2) found.add(word.replace(/i$/, 'i...'));
  }
  for (const phrase of STOCK_PHRASES) {
    if (countIn(normalizeWord(phrase), recentAssistant.map(m => m.content)) >= 2) found.add(phrase);
  }

  // Repeated interrogative closings
  const endsWithQuestion = recentAssistant.filter(m => m.content.trim().endsWith('?')).length;
  const closingRepeated = endsWithQuestion >= Math.ceil(recentAssistant.length * 0.75) && recentAssistant.length >= 2;

  // Similar opening (first 3 words) across replies
  const openings = recentAssistant.map(m => normalizeWord(m.content.trim().split(/\s+/).slice(0, 3).join(' ')));
  const openingCounts = {};
  for (const o of openings) if (o) openingCounts[o] = (openingCounts[o] || 0) + 1;
  const repeatedOpening = Object.entries(openingCounts).find(([, c]) => c >= 2);

  if (found.size === 0 && !closingRepeated && !repeatedOpening) return '';

  const lines = ['Evitar repetir en el siguiente turno:'];
  for (const f of found) lines.push(`- Referencias repetidas a: ${f}`);
  if (repeatedOpening) lines.push('- La misma estructura de apertura de las últimas respuestas.');
  if (closingRepeated) lines.push('- Cerrar la respuesta con una pregunta.');

  return wrap('RECENT_PATTERNS_TO_AVOID', lines.join('\n'));
}

// ─── Repeated user message detection ─────────────────────────────────────
function normalizeMessage(text) {
  return normalizeWord(text.trim()).replace(/[¿?¡!.,;:]/g, '').replace(/\s+/g, ' ').trim();
}

export function detectRepeatedUserMessage(history, currentUserMessage, lookback = 6) {
  const current = normalizeMessage(currentUserMessage || '');
  if (!current) return false;
  const recentUserMessages = (history || [])
    .filter(m => m.role === 'user' && m.content?.trim())
    .slice(-lookback)
    .map(m => normalizeMessage(m.content));

  return recentUserMessages.some(prev => {
    if (!prev) return false;
    if (prev === current) return true;
    const [shorter, longer] = prev.length <= current.length ? [prev, current] : [current, prev];
    if (shorter.length < 8) return false;
    return longer.includes(shorter) && shorter.length / longer.length > 0.85;
  });
}

function buildRepeatedMessageNote(isRepeated) {
  if (!isRepeated) return '';
  return wrap('REPEATED_USER_MESSAGE_NOTE', 'El usuario está repitiendo una idea expresada recientemente. El personaje puede reconocerlo de forma natural. No debe tratar la repetición como una revelación nueva ni aumentar automáticamente la intensidad emocional.');
}

// ─── History normalization ───────────────────────────────────────────────
// Filters to valid roles with non-empty content, preserving order. Does not
// include the current user message — callers append that separately.
export function normalizeConversationHistory(history) {
  return (history || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
    .map(m => ({ role: m.role, content: m.content }));
}

// ─── Compiled system prompt ──────────────────────────────────────────────
export function buildCompiledSystemPrompt({ baseSystemPrompt, story, characters, context, narrativePrompt, history, repeatedUserMessage }) {
  const sections = [
    wrap('ROLEPLAY_ENGINE', ROLEPLAY_ENGINE_PROMPT),
    wrap('PROJECT_RULES', baseSystemPrompt),
    buildStorySection(story),
    buildCharacterSections(characters),
    buildSceneStateSection(context),
    buildRelationshipStateSection(context),
    buildPrivateContextSection(context),
    buildRecentPatternsSection(history),
    buildRepeatedMessageNote(repeatedUserMessage),
    buildNarrativeStyleSection(narrativePrompt),
  ].filter(Boolean);

  return sections.join('\n\n');
}

// ─── Entry point: builds the full DeepSeek-bound messages array ─────────
// input: {
//   systemPrompt: string,       // settings.system_prompt (project rules)
//   story: string[],            // assigned story prompts
//   characters: {id,name,prompt}[], // assigned character profiles
//   context: { sceneState?, relationshipState?, privateContext? },
//   narrativePrompt: string,    // settings.narrative_style
//   history: {role, content}[], // full history EXCLUDING the current user message
//   userMessage: string,        // current user message content
// }
export function buildRoleplayMessages(input) {
  const normalizedHistory = normalizeConversationHistory(input.history);
  const repeatedUserMessage = detectRepeatedUserMessage(normalizedHistory, input.userMessage);

  const compiledSystemPrompt = buildCompiledSystemPrompt({
    baseSystemPrompt: input.systemPrompt,
    story: input.story,
    characters: input.characters,
    context: input.context,
    narrativePrompt: input.narrativePrompt,
    history: normalizedHistory,
    repeatedUserMessage,
  });

  const messages = [];
  if (compiledSystemPrompt.trim()) {
    messages.push({ role: 'system', content: compiledSystemPrompt });
  }
  messages.push(...normalizedHistory);
  messages.push({ role: 'user', content: input.userMessage });
  return messages;
}
