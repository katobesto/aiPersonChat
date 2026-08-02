import { useState, useEffect } from 'react';
import { fetchCharacters, fetchStories, fetchChatAssignments, addChatAssignment, removeChatAssignment } from '../api';

export default function AssignmentsPanel({ chatId, onClose }) {
  const [characters, setCharacters] = useState([]); // all available characters
  const [stories, setStories] = useState([]); // all available stories
  const [assignedCharIds, setAssignedCharIds] = useState(new Set());
  const [assignedStoryIds, setAssignedStoryIds] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    setLoading(true);
    try {
      const [chars, stor, assignments] = await Promise.all([
        fetchCharacters(),
        fetchStories(),
        fetchChatAssignments(chatId),
      ]);
      setCharacters(chars || []);
      setStories(stor || []);
      setAssignedCharIds(new Set((assignments?.characters || []).map(c => c.id)));
      setAssignedStoryIds(new Set((assignments?.stories || []).map(s => s.id)));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const toggleAssignment = async (type, id) => {
    if (type === 'character') {
      if (assignedCharIds.has(id)) {
        await removeChatAssignment(chatId, 'character', id);
        setAssignedCharIds(new Set([...assignedCharIds].filter(x => x !== id)));
      } else {
        await addChatAssignment(chatId, 'character', id);
        setAssignedCharIds(new Set([...assignedCharIds, id]));
      }
    } else {
      if (assignedStoryIds.has(id)) {
        await removeChatAssignment(chatId, 'story', id);
        setAssignedStoryIds(new Set([...assignedStoryIds].filter(x => x !== id)));
      } else {
        await addChatAssignment(chatId, 'story', id);
        setAssignedStoryIds(new Set([...assignedStoryIds, id]));
      }
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal">
          <h2><i className="fas fa-link"></i> Asignaciones</h2>
          <div style={{ textAlign: 'center', padding: '30px' }}><i className="fas fa-spinner fa-spin"></i></div>
        </div>
      </div>
    );
  }

  const renderList = (items, assignedIds, type) => {
    if (!items.length) return <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '12px' }}>No hay elementos disponibles</div>;
    return items.map(item => {
      const isAssigned = assignedIds.has(item.id);
      return (
        <button key={item.id} onClick={() => toggleAssignment(type, item.id)} style={{
          width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
          border: isAssigned ? '1px solid var(--accent)' : '1px solid transparent',
          background: isAssigned ? 'var(--accent-glow)' : 'var(--glass-bg)',
          color: 'inherit', fontSize: '13px', transition: 'all 0.15s ease'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><i className={`fas ${type === 'character' ? 'fa-masks-theater' : 'fa-book-open'}`}></i> {item.name}</span>
            {isAssigned ? (
              <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}><i className="fas fa-check-circle"></i> Asignado</span>
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}><i className="fas fa-plus-circle"></i> Asignar</span>
            )}
          </div>
        </button>
      );
    });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2><i className="fas fa-link"></i> Asignar al chat</h2>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Selecciona los personajes e historias que quieres asignar a este chat. Los asignados se incluirán en cada mensaje enviado al LLM.
        </p>

        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
          <i className="fas fa-masks-theater"></i> Personajes ({assignedCharIds.size}/{characters.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px', maxHeight: '200px', overflowY: 'auto' }}>
          {renderList(characters, assignedCharIds, 'character')}
        </div>

        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
          <i className="fas fa-book-open"></i> Historias ({assignedStoryIds.size}/{stories.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
          {renderList(stories, assignedStoryIds, 'story')}
        </div>

        <div className="modal-actions" style={{ marginTop: '16px' }}>
          <button className="btn-cancel" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
