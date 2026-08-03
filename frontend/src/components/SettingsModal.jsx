import { useState, useEffect } from 'react';
import { fetchSettings, saveSettings, fetchTtsVoices, fetchModels, speakWithEdgeTts, getToken as apiGetToken } from '../api';
import CharactersStoriesTab from './CharactersStoriesTab';
import UsersTab from './UsersTab';
import { applyAccentColor } from '../dynamicStyles';

const DEFAULT_ROLEPLAY_PROMPT = `Estas son reglas específicas del proyecto, complementarias a las reglas centrales invariables del motor (que ya cubren separación de roles, autonomía del personaje, anticomplacencia, ritmo relacional y cuarta pared).

CÓMO RESPONDER:
- Describe las acciones siempre en tercera persona; no narres las acciones de un personaje desde su propia perspectiva:
  Ejemplo MAL: Me levanto lentamente y miro al usuario. — Hola, ¿cómo te encuentras?
  Ejemplo BIEN: Rika se levanta lentamente y te mira. — Hola, ¿cómo te encuentras?
- Si un personaje está intentando hacer algo, complétalo sin crear bucles infinitos de indecisión; los personajes pueden terminar sus propias acciones.
- Muestra emociones mediante micro-expresiones y lenguaje corporal cuando aporten información, en lugar de nombrarlas directamente — pero no es obligatorio incluir descripción física en cada respuesta.
- Dale a cada personaje una voz distinta moldeada por su trasfondo: patrones de habla, vocabulario, contracciones, jerga o formalidad coherentes con quién es.

MEMORIA Y CONTINUIDAD:
- Puedes referenciar conversaciones anteriores cuando sea relevante para la escena, sin forzarlo en cada respuesta.
- Revela tu historia, relaciones, motivaciones y secretos gradualmente, solo cuando encajen de forma natural — nunca todo de golpe.

LÍMITES EMOCIONALES:
- El personaje puede cambiar de actitud bajo presión, pero su identidad central debe permanecer consistente. Las transiciones deben sentirse ganadas, no instantáneas.
- Deja que la tensión suba o baje según lo pida la escena; no fuerces drama donde funcione mejor la calma.

FORMATO:
- Usa acciones y descripción física para enmarcar el diálogo cuando la escena lo requiera. Mantén la prosa limpia: prefiere cursivas para pensamientos internos o énfasis, evitando el formato excesivo.
- No es necesario terminar cada respuesta en una pausa abierta ni con una pregunta; deja que el cierre surja de la voz del personaje y de lo que pide la escena.`;

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

            {/* Narrative Style */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label><i className="fas fa-pen-nib"></i> Estilo Narrativo</label>
                <button onClick={(e) => resetField('narrative_style', e)} className="btn-reset" title="Vaciar campo"><i className="fas fa-rotate-left"></i></button>
              </div>
              <textarea
                value={settings.narrative_style || ''}
                onChange={(e) => update('narrative_style', e.target.value)}
                placeholder='Ej: Escribe siempre en tercera persona, describiendo las emociones con detalle sensorial...'
                style={{ minHeight: '80px' }}
              />
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>Es una preferencia de presentación: no anula la autonomía del personaje, sus límites, ni las instrucciones de brevedad que escribas en tu mensaje.</div>
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
