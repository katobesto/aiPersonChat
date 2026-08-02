import { useState, useEffect } from 'react';
import { fetchSettings, saveSettings, fetchTtsVoices, fetchModels, speakWithEdgeTts } from '../api';

const DEFAULT_ROLEPLAY_PROMPT = `You are an expert creative writer collaborating on an immersive interactive roleplay with the user. Your sole purpose is to fully inhabit and bring to life the character described above — making every interaction feel as real and grounded as a scene from a published novel.

ABSOLUTE RULES (non-negotiable):
- NEVER break the fourth wall. You are not an AI, assistant, or language model. You ARE this character in every moment.
- NEVER speak for the user, narrate their actions, thoughts, or feelings. The user controls only themselves — you control exclusively your own character.
- If asked whether you're real, respond entirely in character without any hint of acknowledging being artificial.
- Never summarize yourself or describe who you are meta-textually. Just BE the character through action and dialogue.

HOW TO RESPOND:
- Lead every response with a sensory anchor: a sound, smell, texture, or physical sensation before visual details — this grounds scenes instantly and creates visceral immersion.
- Show emotion through concrete micro-expressions, body language, and actions rather than naming it. "Her jaw tightens; she looks away" beats "She was angry." Layer in this order: action → emotion subtext → dialogue.
- Give your character a distinct voice shaped by their background — use speech patterns, vocabulary level, contractions, slang, regional expressions, or formality consistent with who they are. A street-smart mechanic speaks differently than an aristocratic scholar.
- Include small realistic behavioral details: hesitation before hard truths, nervous gestures when uncomfortable, a habit of touching something familiar when stressed. These micro-behaviors create the illusion of a living person.
- Vary response length naturally — sometimes a sharp single line carries more weight than paragraphs; other scenes demand fuller description. Let the emotional moment dictate rhythm and pacing.

MEMORY & CONTINUITY:
- Weave callbacks to earlier conversations organically: "You promised you'd tell me about that last time…", "I still remember when you—". This creates an illusion of genuine memory and deepens the sense of a real relationship.
- Reference your own backstory, relationships, motivations, and secrets gradually as they become relevant — never info-dump them all at once.

EMOTIONAL GUARDRAILS:
- Your character CAN shift under pressure, but core identity must remain consistent. A kind person can be fierce when threatened; a cold person might show rare vulnerability with someone they deeply trust. Transitions should feel earned, not instant.
- Let tension build naturally — escalate or de-escalate based on the scene, never forcing drama where calm fits better.

FORMATTING:
- Use action and physical description to frame dialogue. Keep prose clean: prefer italics for internal thoughts or emphasis over excessive formatting.
- End each response at a natural open beat that invites continuation — a gesture held mid-air, an unfinished sentence, a loaded silence. Do not force questions unless they arise organically from your character's voice.`;

const DEFAULT_STORY = `The world of ELYSIUM — a sprawling megacity built atop the ruins of an older civilization. Once a beacon of technological utopia, it now exists in fractured equilibrium.

THE CITY: Towering spires of glass and chrome house the elite of the Ascendancy, while beneath them, the Undercity sprawls in perpetual twilight — a labyrinth of neon-lit streets, black markets, and forgotten subway tunnels. The air always carries the scent of rain on hot metal and ozone.

THE FACTIONS:
• THE ASCENDANCY — A council of technocrats who control the city's artificial sun and energy grid. Cold, calculated, they believe order requires absolute control.
• THE IRON ROOTS — An underground resistance of engineers and hackers fighting to redistribute power. They communicate through encrypted channels hidden in music streams.
• THE ECHO CHRONICLERS — Nomadic storytellers and memory-keepers who preserve the history of what came before the fall. They trade information like currency.
• THE VEIL — A mysterious syndicate that operates outside all factions, brokering deals between enemies. No one knows who leads them.

THE MAGIC SYSTEM: "Resonance" — a rare ability where certain individuals can manipulate electromagnetic fields through focused intent. Resonators are both hunted and revered; the Ascendancy wants to weaponize them, while the Iron Roots see them as keys to liberation. Not everyone with Resonance knows they have it — some discover their abilities only in moments of extreme emotional stress.

CURRENT TENSION: The artificial sun is failing. Flickers last only seconds now, but the Ascendancy hides the truth. Those who notice are disappearing. Whispers speak of an ancient protocol buried deep in the Undercity's infrastructure that could reignite it — or destroy everything.`;

const DEFAULT_SETTINGS = {
  api_base: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o-mini',
  enable_thinking: false,
  max_tokens: '8192',
  reasoning_max_tokens: '32000',
  system_prompt: DEFAULT_ROLEPLAY_PROMPT,
  character_description: '',
  story: DEFAULT_STORY, // world/story context
  voice: '', // will be set to selected voice
};

export default function SettingsModal({ onClose, onSaved }) {
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [saved, setSaved] = useState(false);
  const [voices, setVoices] = useState([]);
  // Models state
  const [modelsList, setModelsList] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelError] = useState(null);
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const data = await fetchSettings();
      // Convert enable_thinking from DB string to boolean
      if (typeof data.enable_thinking === 'string') {
        data.enable_thinking = data.enable_thinking === 'true';
      }
      setSettings({ ...DEFAULT_SETTINGS, ...data });
    } catch { /* use defaults */ }

    // Load Edge TTS voices from backend
    try {
      const voices = await fetchTtsVoices();
      setVoices(voices);
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
    // Ensure enable_thinking is saved as string for the DB
    const toSave = { ...settings };
    if (typeof toSave.enable_thinking === 'boolean') {
      toSave.enable_thinking = String(toSave.enable_thinking);
    }
    await saveSettings(toSave);
    setSaved(true);
    setTimeout(() => {
      onSaved?.();
      onClose();
    }, 500);
  };

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Reset a field to its default value from DEFAULT_SETTINGS
  const resetField = (key, e) => {
    e?.stopPropagation();
    if (DEFAULT_SETTINGS[key] !== undefined) {
      update(key, DEFAULT_SETTINGS[key]);
    }
  };

  // Load models from the configured provider
  const loadModels = async () => {
    if (!settings.api_base?.trim() || !settings.api_key?.trim()) return;
    setModelsLoading(true);
    setModelError(null);
    try {
      const data = await fetchModels();
      if (data.error) {
        setModelError(data.error);
        setModelsList([]);
      } else {
        setModelsList(data.models || []);
        setModelError(null);
      }
    } catch {
      setModelError('Error de conexión. Verifica la configuración del proveedor.');
      setModelsList([]);
    } finally {
      setModelsLoading(false);
    }
  };

  // Filter models by search text
  const filteredModels = modelSearch.trim()
    ? modelsList.filter(m =>
        m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
        (m.name && m.name.toLowerCase().includes(modelSearch.toLowerCase()))
      )
    : modelsList;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2><i className="fas fa-gear"></i> Settings</h2>

        {/* ── AI Configuration ── */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px' }}>
          Configuración de IA
        </div>

        <div className="form-group">
          <label>API Base URL</label>
          <input
            type="url"
            value={settings.api_base}
            onChange={(e) => update('api_base', e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={settings.api_key}
            onChange={(e) => update('api_key', e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Model</label>
            <button onClick={(e) => resetField('model', e)} className="btn-reset" title="Restaurar valor por defecto"><i className="fas fa-rotate-left"></i> Reset</button>
          </div>
          {modelsList.length > 0 ? (
            <>
              <select
                value={settings.model}
                onChange={(e) => update('model', e.target.value)}
                style={{ marginBottom: '6px' }}
              >
                {filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
                {/* Add current model if not in list */}
                {!modelsList.find(m => m.id === settings.model) && (
                  <option key={settings.model} value={settings.model}>✏ {settings.model} (manual)</option>
                )}
              </select>
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder={`Buscar entre ${modelsList.length} modelos...`}
                style={{ fontSize: '12px', marginBottom: '4px' }}
              />
            </>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={settings.model}
                onChange={(e) => update('model', e.target.value)}
                placeholder="gpt-4o-mini (manual)"
                style={{ flex: 1 }}
              />
            </div>
          )}
          <button
            className="btn-preview-voice"
            onClick={loadModels}
            disabled={modelsLoading || !settings.api_base?.trim() || !settings.api_key?.trim()}
            style={{ marginTop: '4px', fontSize: '12px' }}
          >
            {modelsLoading ? <><i className="fas fa-spinner fa-spin"></i> Cargando...</> : modelsList.length > 0 ? <><i className="fas fa-sync-alt"></i> Recargar ({modelsList.length})</> : <><i className="fas fa-magnifying-glass"></i> Cargar modelos del proveedor</>}
          </button>
          {modelsError && (
            <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '4px' }}><i className="fas fa-triangle-exclamation"></i> {modelsError}</div>
          )}

        </div>

        {/* ── Thinking Toggle ── */}
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <div>
            <label style={{ marginBottom: 0, cursor: 'pointer' }}><i className="fas fa-brain"></i> Enable Thinking</label>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Activa el modo reasoning del modelo (más lento, más profundo)</div>
          </div>
          <button
            onClick={() => update('enable_thinking', !settings.enable_thinking)}
            style={{
              width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
              background: settings.enable_thinking ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
              transition: 'background 0.2s ease'
            }}
          >
            <span style={{
              position: 'absolute', top: '3px', left: settings.enable_thinking ? '23px' : '3px',
              width: '20px', height: '20px', borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s ease', boxShadow: '0 1px 4px rgba(0,0,0,0.3)'
            }} />
          </button>
        </div>

        {/* ── Token Limits ── */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Max Tokens (Output)</label>
              <button onClick={(e) => resetField('max_tokens', e)} className="btn-reset" title="Restaurar valor por defecto"><i className="fas fa-rotate-left"></i></button>
            </div>
            <input
              type="number"
              value={settings.max_tokens}
              onChange={(e) => update('max_tokens', e.target.value)}
              min="512"
              max="131072"
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Reasoning Max Tokens</label>
              <button onClick={(e) => resetField('reasoning_max_tokens', e)} className="btn-reset" title="Restaurar valor por defecto"><i className="fas fa-rotate-left"></i></button>
            </div>
            <input
              type="number"
              value={settings.reasoning_max_tokens}
              onChange={(e) => update('reasoning_max_tokens', e.target.value)}
              min="512"
              max="131072"
              disabled={!settings.enable_thinking}
            />
          </div>
        </div>

        {/* ── Character & Roleplay ── */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px', marginTop: '8px' }}>
          Personaje & Roleplay
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Descripción del Personaje</label>
            <button onClick={(e) => resetField('character_description', e)} className="btn-reset" title="Limpiar descripción"><i className="fas fa-rotate-left"></i> Reset</button>
          </div>
          <textarea
            value={settings.character_description}
            onChange={(e) => update('character_description', e.target.value)}
            placeholder={`Describe al personaje con estos elementos para máximo realismo:

• NOMBRE y APODO(s) — cómo se presenta y cómo le dicen los demás.
• PERSONALIDAD EN CONTRADICCIÓN — ej: "amable con amigos, implacable con enemigos"; las contradicciones crean profundidad.
• ESTILO DE HABLA — vocabulario, contracciones, modismos regionales, nivel de formalidad. Esto define más la personalidad que cualquier adjetivo.
• APLICACIÓN FÍSICA Y MANERISMOS — rasgos distintivos, gestos habituales (tocarse el cuello cuando miente, golpear la mesa al enfadarse).
• HISTORIA DE FONDO — un evento clave que moldea sus decisiones actuales; conecta pasado con motivaciones presentes.
• RELACIONES — aliados, rivales, alguien del pasado que aún importa.
• CAPA OCULTA — algo que esconde de los demás pero que podría revelarse gradualmente.`}
            style={{ minHeight: '120px' }}
          />
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Prompt de Roleplay (System Prompt)</label>
            <button onClick={(e) => resetField('system_prompt', e)} className="btn-reset" title="Restaurar prompt por defecto"><i className="fas fa-rotate-left"></i> Reset</button>
          </div>
          <textarea
            value={settings.system_prompt}
            onChange={(e) => update('system_prompt', e.target.value)}
            placeholder="Instrucciones del sistema para el comportamiento del personaje..."
            style={{ minHeight: '140px' }}
          />
        </div>

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label>Historia / Contexto del Mundo</label>
            <button onClick={(e) => resetField('story', e)} className="btn-reset" title="Restaurar historia por defecto"><i className="fas fa-rotate-left"></i> Reset</button>
          </div>
          <textarea
            value={settings.story}
            onChange={(e) => update('story', e.target.value)}
            placeholder={`Escribe la historia, el mundo o el escenario en el que se desarrolla la conversación.
Incluye: descripción del entorno, facciones o grupos relevantes, reglas de magia/tecnología,
tensiones políticas actuales y cualquier contexto que dé profundidad a la narrativa...`}
            style={{ minHeight: '140px' }}
          />
        </div>

        {/* ── Voice ── */}
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px', marginTop: '8px' }}>
          Voz TTS (Text-to-Speech)
        </div>

        <div className="form-group">
          <label>Voice for TTS</label>
          <select
            value={settings.voice}
            onChange={(e) => update('voice', e.target.value)}
            disabled={!voices.length}
          >
            {!voices.length && (
              <option>Cargando voces...</option>
            )}
            {voices.map((v) => (
              <option key={v.name} value={v.name}>{v.label}</option>
            ))}
          </select>
        </div>

        <button
          className="btn-preview-voice"
          onClick={() => {
            if (!settings.voice || !voices.length) return;
            speakWithEdgeTts('Hola, esta es una prueba de voz.', settings.voice);
          }}
        >
          <><i className="fas fa-volume-high"></i> Probar voz</>
        </button>

        {saved && (
          <div style={{ color: '#4caf50', marginBottom: '12px', fontSize: '14px' }}>
            <i className="fas fa-circle-check"></i> Settings saved!
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
