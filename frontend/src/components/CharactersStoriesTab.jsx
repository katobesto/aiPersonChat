import { useState, useEffect } from 'react';
import { fetchCharacters, createCharacter, updateCharacter, deleteCharacter, fetchStories, createStory, updateStory, deleteStory } from '../api';

export default function CharactersStoriesTab() {
  const [activeSubTab, setActiveSubTab] = useState('characters'); // 'characters' | 'stories'
  const [entities, setEntities] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  // Load entities based on active sub-tab
  useEffect(() => {
    loadEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);

  const loadEntities = async () => {
    setLoading(true);
    try {
      const data = activeSubTab === 'characters' ? await fetchCharacters() : await fetchStories();
      setEntities(data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleCreate = () => {
    if (!editName.trim()) return;
    if (activeSubTab === 'characters') {
      createCharacter(editName.trim(), editPrompt).then(() => loadEntities());
    } else {
      createStory(editName.trim(), editPrompt).then(() => loadEntities());
    }
    setEditName('');
    setEditPrompt('');
  };

  const handleUpdate = (id) => {
    if (!editName.trim()) return;
    if (activeSubTab === 'characters') {
      updateCharacter(id, editName.trim(), editPrompt).then(() => loadEntities());
    } else {
      updateStory(id, editName.trim(), editPrompt).then(() => loadEntities());
    }
    setEditingId(null);
    setEditName('');
    setEditPrompt('');
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este elemento?')) return;
    if (activeSubTab === 'characters') {
      await deleteCharacter(id);
    } else {
      await deleteStory(id);
    }
    loadEntities();
  };

  const startEdit = (entity) => {
    setEditingId(entity.id);
    setEditName(entity.name);
    setEditPrompt(entity.prompt || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditPrompt('');
  };

  // Shared styles for inputs inside this tab (mimic .form-group style)
  const inputStyle = { display: 'block', width: '100%', padding: '10px 14px', fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '12px', outline: 'none' };
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' };

  const typeLabel = activeSubTab === 'characters' ? 'Personaje' : 'Historia';
  const icon = activeSubTab === 'characters' ? 'fa-masks-theater' : 'fa-book-open';

  // Renders the inline form (create or edit) inside a card
  const renderForm = () => (
    <div style={{ background: 'var(--glass-bg)', borderRadius: '12px', padding: '14px', border: '1px solid var(--border)' }}>
      <div className="form-group">
        <label style={labelStyle}>Nombre</label>
        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={`Nombre del ${typeLabel.toLowerCase()}...`} style={inputStyle} />
      </div>
      <div className="form-group">
        <label style={labelStyle}>Prompt</label>
        <textarea value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder={`Escribe el prompt del ${typeLabel.toLowerCase()}...`} style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }} />
      </div>
    </div>
  );

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        {['characters', 'stories'].map(tab => (
          <button key={tab} onClick={() => setActiveSubTab(tab)} style={{
            flex: 1, padding: '8px 12px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: activeSubTab === tab ? 700 : 500,
            background: 'transparent', color: activeSubTab === tab ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeSubTab === tab ? '2px solid var(--accent)' : '2px solid transparent', transition: 'all 0.15s ease'
          }}>
            <i className={`fas ${tab === 'characters' ? 'fa-masks-theater' : 'fa-book-open'}`}></i>{' '}
            {tab === 'characters' ? 'Personajes' : 'Historias'} ({entities.length})
          </button>
        ))}
      </div>

      {/* ── Create form (always visible when nothing is being edited) ── */}
      {!editingId && (
        <>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
            <i className={`fas ${icon}`}></i> Nuevo {typeLabel}
          </div>
          {renderForm()}
          <button className="btn-preview-voice" onClick={handleCreate} disabled={!editName.trim()} style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}>
            <i className="fas fa-plus"></i> Crear {typeLabel}
          </button>
        </>
      )}

      {/* ── Edit form (replaces create form when editing) ── */}
      {editingId && (
        <>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', marginBottom: '8px' }}>
            <i className={`fas ${icon}`}></i> Editando {typeLabel}
          </div>
          {renderForm()}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button className="btn-preview-voice" onClick={() => handleUpdate(editingId)} disabled={!editName.trim()} style={{ flex: 1, justifyContent: 'center' }}><i className="fas fa-check"></i> Guardar</button>
            <button className="btn-cancel" onClick={cancelEdit}>Cancelar</button>
          </div>
        </>
      )}

      {/* ── Divider ── */}
      {entities.length > 0 && (
        <div style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0 14px' }} />
      )}

      {/* ── Entities list ── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}><i className="fas fa-spinner fa-spin"></i> Cargando...</div>
      ) : entities.length === 0 && !editingId ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px', fontSize: '13px' }}>
          No hay {typeLabel.toLowerCase()}es aún. Crea uno arriba.
        </div>
      ) : entities.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '25vh', overflowY: 'auto', paddingRight: '4px' }}>
          {entities.map(entity => (
            // Card view — edit form is shown above, not inline
            <div key={entity.id} style={{ background: 'var(--glass-bg)', borderRadius: '12px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}><i className={`fas ${icon}`} style={{ marginRight: '6px', color: 'var(--accent)' }}></i> {entity.name}</span>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entity.prompt ? entity.prompt.slice(0, 80) + (entity.prompt.length > 80 ? '…' : '') : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Sin prompt</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px', marginLeft: '12px', flexShrink: 0 }}>
                <button onClick={() => startEdit(entity)} title="Editar" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', padding: '5px 8px', borderRadius: '8px', fontSize: '12px' }}><i className="fas fa-pen"></i></button>
                <button onClick={() => handleDelete(entity.id)} title="Eliminar" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', cursor: 'pointer', padding: '5px 8px', borderRadius: '8px', fontSize: '12px' }}><i className="fas fa-trash-alt"></i></button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
