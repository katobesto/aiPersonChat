import { useState, useEffect } from 'react';
import { fetchSettings, saveSettings, fetchTtsVoices, fetchModels, speakWithEdgeTts, getToken as apiGetToken } from '../api';
import CharactersStoriesTab from './CharactersStoriesTab';
import UsersTab from './UsersTab';
import { applyAccentColor } from '../dynamicStyles';

const DEFAULT_ROLEPLAY_PROMPT = `¡Nota importante! Lo que el usuario proporcione entre paréntesis solo será interpretable por ti pero nunca por los personajes. Será como una "voz omnisciente" que te dará información de cómo continuar o lo que está sucediendo, pero no habrá repercusión en los personajes a no ser que decidas que es relevante.

Eres un escritor creativo experto colaborando en un juego de rol interactivo e inmersivo con el usuario. Tu único propósito es habitar y dar vida al personaje descrito arriba — haciendo que cada interacción se sienta tan real y sólida como una escena de una novela publicada.

REGLAS ABSOLUTAS (no negociables):
- Describir acciones siempre en tercera persona; no puedes narrar las acciones de un personaje desde su propia perspectiva:
  Ejemplo MAL: Me levanto lentamente y miro al usuario. — Hola, ¿cómo te encuentras?.
  Ejemplo BIEN: Rika se levanta lentamente y te mira. — Hola, ¿cómo te encuentras?
- Importante: si un personaje está intentando hacer algo, debes completarlo y no crear situaciones en bucle infinito. Los personajes son únicos con sus propios sentimientos y deseos. Pueden terminar sus acciones por sí mismos.
- NUNCA rompas la cuarta pared. No eres una IA, asistente o modelo de lenguaje. TÚ ERES este personaje en cada momento.
- NUNCA hables por el usuario, narres sus acciones, pensamientos o sentimientos. El usuario controla solo a sí mismo — tú controlas exclusivamente tu propio personaje.
- Si te preguntan si eres real, responde completamente en personaje sin ningún indicio de reconocer que eres artificial.
- Nunca te resumas ni describas quién eres de forma metatextual. Simplemente SÉ el personaje a través de la acción y el diálogo.

CÓMO RESPONDER:
- Comienza cada respuesta con un ancla sensorial: un sonido, olor, textura o sensación física antes que los detalles visuales — esto crea una inmersión visceral inmediata.
- Muestra emociones mediante micro-expresiones concretas, lenguaje corporal y acciones en lugar de nombrarlas. "Ella aprieta la mandíbula; mira hacia otro lado" es mejor que "Estaba enfadada". Capa en este orden: acción → subtexto emocional → diálogo.
- Dale a tu personaje una voz distinta moldeada por su trasfondo — usa patrones de habla, nivel de vocabulario, contracciones, jerga, expresiones regionales o formalidad coherentes con quien es.
- Incluye pequeños detalles conductuales realistas: vacilación antes de verdades difíciles, gestos nerviosos cuando se siente incómodo, el hábito de tocar algo familiar cuando está estresado. Estos micro-comportamientos crean la ilusión de una persona viva.
- Varía la longitud de las respuestas de forma natural — a veces una línea corta tiene más peso que párrafos; otras escenas exigen descripción completa. Deja que el momento emocional dicte el ritmo y el tempo.

MEMORIA Y CONTINUIDAD:
- Teje referencias a conversaciones anteriores de forma orgánica: "Me prometiste contarme sobre la última vez…", "Sigo recordando cuando tú—". Esto crea una ilusión de memoria genuina y profundiza la sensación de una relación real.
- Haz referencia a tu propia historia, relaciones, motivaciones y secretos gradualmente a medida que sean relevantes — nunca los des todos de golpe.

LÍMITES EMOCIONALES:
- Tu personaje PUEDE cambiar bajo presión, pero la identidad central debe permanecer consistente. Una persona amable puede ser feroz cuando está amenazada; una persona fría podría mostrar rareza vulnerabilidad con alguien en quien confía profundamente. Las transiciones deben sentirse ganadas, no instantáneas.
- Deja que la tensión se construya de forma natural — escala o des-escale según la escena, nunca fuerces drama donde mejor funcione la calma.

FORMATO:
- Usa acciones y descripción física para enmarcar el diálogo. Mantén la prosa limpia: prefiere cursivas para pensamientos internos o énfasis sobre un formato excesivo.
- Termina cada respuesta en una pausa natural abierta que invite a continuar — un gesto suspendido en el aire, una frase incompleta, un silencio cargado. No fuerces preguntas a menos que surjan orgánicamente de la voz de tu personaje.`;

const DEFAULT_SETTINGS = {
  api_base: 'https://api.openai.com/v1',
  api_key: '',
  model: 'gpt-4o-mini',
  accent_color: '#7c5cfc',
  enable_thinking: false,
  max_tokens: '8192',
  reasoning_max_tokens: '32000',
  system_prompt: DEFAULT_ROLEPLAY_PROMPT,
  voice: '',
};

export default function SettingsModal({ onClose, onSaved }) {
  const [activeTab, setActiveTab] = useState('settings'); // 'settings' | 'entities' | 'users'
  const [isAdmin, setIsAdmin] = useState(false);

  // Check if current user is admin (needed for Users tab visibility)
  useEffect(() => {
    try {
      const token = apiGetToken();
      if (!token) return;
      // JWT: header.payload.signature — decode payload
      const decoded = JSON.parse(atob(token.split('.')[1]));
      setIsAdmin(decoded.role === 'admin');
    } catch { /* use default */ }
  }, []);

  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [saved, setSaved] = useState(false);
  const [voices, setVoices] = useState([]);
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
      if (typeof data.enable_thinking === 'string') {
        data.enable_thinking = data.enable_thinking === 'true';
      }
      setSettings({ ...DEFAULT_SETTINGS, ...data });
      if (data?.accent_color) applyAccentColor(data.accent_color);
    } catch { /* use defaults */ }
    try {
      const voices = await fetchTtsVoices();
      setVoices(voices);
    } catch { /* ignore */ }
  };

  const handleSave = async () => {
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
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'accent_color') applyAccentColor(value);
      return next;
    });
  };

  const resetField = (key, e) => {
    e?.stopPropagation();
    if (DEFAULT_SETTINGS[key] !== undefined) {
      update(key, DEFAULT_SETTINGS[key]);
    }
  };

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

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderBottom: '1px solid var(--border)' }}>
          {(['settings', 'entities']
            .concat(isAdmin ? ['users'] : [])
          ).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '10px 16px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: activeTab === tab ? 700 : 500,
                background: 'transparent', color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}
            >
              {tab === 'settings'
                ? <><i className="fas fa-sliders"></i> Settings</>
                : tab === 'entities'
                  ? <><i className="fas fa-book-open"></i> P&H</>
                  : <><i className="fas fa-users"></i> Usuarios</>
              }
            </button>
          ))}
        </div>

        {/* ── Tab: Settings ── */}
        {activeTab === 'settings' && (
          <>
            {/* Appearance */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px' }}>
              Apariencia
            </div>

            <div className="form-group">
              <label>Accent Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="color"
                  value={settings.accent_color || '#7c5cfc'}
                  onChange={(e) => update('accent_color', e.target.value)}
                  title="Elige un color de acento"
                  style={{ width: '48px', height: '40px', border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg-input)', cursor: 'pointer', padding: '2px' }}
                />
                <input
                  type="text"
                  value={settings.accent_color || '#7c5cfc'}
                  onChange={(e) => update('accent_color', e.target.value)}
                  placeholder="#7c5cfc"
                  style={{ flex: 1 }}
                />
                <button
                  onClick={(e) => resetField('accent_color', e)}
                  className="btn-reset"
                  title="Restaurar color por defecto"
                >
                  <i className="fas fa-rotate-left"></i> Reset
                </button>
              </div>
            </div>

            {/* AI Configuration */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px' }}>
              Configuración de IA
            </div>

            <div className="form-group">
              <label>API Base URL</label>
              <input type="url" value={settings.api_base} onChange={(e) => update('api_base', e.target.value)} placeholder="https://api.openai.com/v1" />
            </div>

            <div className="form-group">
              <label>API Key</label>
              <input type="password" value={settings.api_key} onChange={(e) => update('api_key', e.target.value)} placeholder="sk-..." />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Model</label>
                <button onClick={(e) => resetField('model', e)} className="btn-reset" title="Restaurar valor por defecto"><i className="fas fa-rotate-left"></i> Reset</button>
              </div>
              {modelsList.length > 0 ? (
                <>
                  <select value={settings.model} onChange={(e) => update('model', e.target.value)} style={{ marginBottom: '6px' }}>
                    {filteredModels.map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                    {!modelsList.find(m => m.id === settings.model) && (
                      <option key={settings.model} value={settings.model}>{settings.model}</option>
                    )}
                  </select>
                  <input type="text" value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder={`Buscar entre ${modelsList.length} modelos...`} style={{ fontSize: '12px', marginBottom: '4px' }} />
                </>
              ) : (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="text" value={settings.model} onChange={(e) => update('model', e.target.value)} placeholder="gpt-4o-mini (manual)" style={{ flex: 1 }} />
                </div>
              )}
              <button className="btn-preview-voice" onClick={loadModels} disabled={modelsLoading || !settings.api_base?.trim() || !settings.api_key?.trim()} style={{ marginTop: '4px', fontSize: '12px' }}>
                {modelsLoading ? <><i className="fas fa-spinner fa-spin"></i> Cargando...</> : modelsList.length > 0 ? <><i className="fas fa-sync-alt"></i> Recargar ({modelsList.length})</> : <><i className="fas fa-magnifying-glass"></i> Cargar modelos del proveedor</>}
              </button>
              {modelsError && (<div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '4px' }}><i className="fas fa-triangle-exclamation"></i> {modelsError}</div>)}
            </div>

            {/* Thinking Toggle */}
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--glass-bg)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <div>
                <label style={{ marginBottom: 0, cursor: 'pointer' }}><i className="fas fa-brain"></i> Enable Thinking</label>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Activa el modo reasoning del modelo (más lento, más profundo)</div>
              </div>
              <button onClick={() => update('enable_thinking', !settings.enable_thinking)} style={{ width: '48px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0, background: settings.enable_thinking ? 'var(--accent)' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s ease' }}>
                <span style={{ position: 'absolute', top: '3px', left: settings.enable_thinking ? '23px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s ease', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </button>
            </div>

            {/* Token Limits */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Max Tokens (Output)</label>
                  <button onClick={(e) => resetField('max_tokens', e)} className="btn-reset"><i className="fas fa-rotate-left"></i></button>
                </div>
                <input type="number" value={settings.max_tokens} onChange={(e) => update('max_tokens', e.target.value)} min="512" max="131072" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label>Reasoning Max Tokens</label>
                  <button onClick={(e) => resetField('reasoning_max_tokens', e)} className="btn-reset"><i className="fas fa-rotate-left"></i></button>
                </div>
                <input type="number" value={settings.reasoning_max_tokens} onChange={(e) => update('reasoning_max_tokens', e.target.value)} min="512" max="131072" disabled={!settings.enable_thinking} />
              </div>
            </div>

            {/* System Prompt */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px', marginTop: '8px' }}>
              Roleplay & Comportamiento
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>Prompt de Roleplay (System Prompt)</label>
                <button onClick={(e) => resetField('system_prompt', e)} className="btn-reset" title="Restaurar prompt por defecto"><i className="fas fa-rotate-left"></i> Reset</button>
              </div>
              <textarea value={settings.system_prompt} onChange={(e) => update('system_prompt', e.target.value)} placeholder="Instrucciones del sistema para el comportamiento..." style={{ minHeight: '100px' }} />
            </div>

            {/* Voice */}
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '-4px', marginTop: '8px' }}>
              Voz TTS (Text-to-Speech)
            </div>

            <div className="form-group">
              <label>Voice for TTS</label>
              <select value={settings.voice} onChange={(e) => update('voice', e.target.value)} disabled={!voices.length}>
                {!voices.length && (<option>Cargando voces...</option>)}
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>{v.label}</option>
                ))}
              </select>
            </div>

            <button className="btn-preview-voice" onClick={() => { if (!settings.voice || !voices.length) return; speakWithEdgeTts('Hola, esta es una prueba de voz.', settings.voice); }}>
              <><i className="fas fa-volume-high"></i> Probar voz</>
            </button>

            {saved && (
              <div style={{ color: '#4caf50', marginBottom: '12px', fontSize: '14px' }}><i className="fas fa-circle-check"></i> Settings saved!</div>
            )}

            <div className="modal-actions">
              <button className="btn-cancel" onClick={onClose}>Cancel</button>
              <button className="btn-save" onClick={handleSave}>Save</button>
            </div>
          </>
        )}

        {/* ── Tab: Characters & Stories ── */}
        {activeTab === 'entities' && (
          <CharactersStoriesTab />
        )}

        {/* ── Tab: Users (admin only) ── */}
        {activeTab === 'users' && isAdmin && (
          <UsersTab />
        )}
      </div>
    </div>
  );
}
