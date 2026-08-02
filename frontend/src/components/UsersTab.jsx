import { useState, useEffect } from 'react';
import { fetchUsers, registerUser, updateUser, deleteUser, fetchUserAssignments, addUserAssignment, removeUserAssignment, fetchChats, fetchCharacters, fetchStories } from '../api';

export default function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editRole, setEditRole] = useState('user');
  const [editPass, setEditPass] = useState('');
  const [managingUserId, setManagingUserId] = useState(null); // user whose assignments we're managing
  const [assignChats, setAssignChats] = useState([]);
  const [assignChars, setAssignChars] = useState([]);
  const [assignStor, setAssignStor] = useState([]);
  const [userAssignedIds, setUserAssignedIds] = useState({ chats: new Set(), characters: new Set(), stories: new Set() });

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try { setUsers(await fetchUsers()); } catch {}
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    if (!newUsername.trim() || !newPassword) return;
    await registerUser(newUsername.trim(), newPassword, 'user');
    setNewUsername(''); setNewPassword('');
    loadUsers();
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setEditRole(user.role);
    setEditPass('');
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    const fields = { role: editRole };
    if (editPass.trim()) fields.password = editPass.trim();
    await updateUser(editingId, fields);
    setEditingId(null); setEditRole('user'); setEditPass('');
    loadUsers();
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este usuario?')) return;
    await deleteUser(id);
    loadUsers();
  };

  // Load assignable resources + current assignments for a user
  useEffect(() => {
    if (!managingUserId) return;
    (async () => {
      const [chats, chars, stor, assignments] = await Promise.all([
        fetchChats(),
        fetchCharacters(),
        fetchStories(),
        fetchUserAssignments(managingUserId),
      ]);
      setAssignChats(chats || []);
      setAssignChars(chars || []);
      setAssignStor(stor || []);
      setUserAssignedIds({
        chats: new Set((assignments?.chats || []).map(c => c.id)),
        characters: new Set((assignments?.characters || []).map(c => c.id)),
        stories: new Set((assignments?.stories || []).map(s => s.id)),
      });
    })();
  }, [managingUserId]);

  const toggleUserAssignment = async (assignType, entityId) => {
    const sets = userAssignedIds;
    let idSet;
    switch (assignType) {
      case 'chat': idSet = sets.chats; break;
      case 'character': idSet = sets.characters; break;
      case 'story': idSet = sets.stories; break;
    }

    const tableType = assignType === 'chat' ? 'chat' : assignType === 'character' ? 'character' : 'story';
    if (idSet.has(entityId)) {
      await removeUserAssignment(managingUserId, tableType, entityId);
      idSet.delete(entityId);
    } else {
      await addUserAssignment(managingUserId, tableType, entityId);
      idSet.add(entityId);
    }
    setUserAssignedIds({ ...sets });
  };

  const renderToggleList = (title, icon, items, assignedIds, type) => (
    <div style={{ background: 'var(--glass-bg)', borderRadius: '12px', padding: '14px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '10px' }}>
        <i className={`fas ${icon}`}></i> {title} ({assignedIds.size}/{items.length})
      </div>
      {!items.length ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '8px 0' }}>No hay disponibles</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto', paddingRight: '2px' }}>
          {items.map(item => {
            const isAssigned = assignedIds.has(item.id);
            return (
              <button key={item.id} onClick={() => toggleUserAssignment(type, item.id)} style={{
                width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer',
                border: isAssigned ? '1px solid var(--accent)' : '1px solid transparent',
                background: isAssigned ? 'var(--accent-glow)' : 'rgba(0,0,0,0.15)',
                color: 'inherit', fontSize: '13px', transition: 'all 0.15s ease'
              }}>
                <span>{item.title || item.name}</span>
                {isAssigned && <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent)' }}><i className="fas fa-check"></i></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Register new user ── */}
      <div style={{ background: 'var(--glass-bg)', borderRadius: '16px', padding: '20px 24px', border: '1px solid var(--border)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '14px' }}>
          <i className="fas fa-user-plus"></i> Crear usuario
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Username</label>
            <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="nombre_usuario" style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '12px', outline: 'none' }} />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••" style={{ display: 'block', width: '100%', padding: '10px 14px', fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '12px', outline: 'none' }} />
          </div>
          <button className="btn-preview-voice" onClick={handleRegister} disabled={!newUsername.trim() || !newPassword} style={{ marginBottom: 0, flexShrink: 0, padding: '10px 18px' }}>
            <i className="fas fa-plus"></i> Crear
          </button>
        </div>
      </div>

      {/* ── Users list ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          <i className="fas fa-spinner fa-spin" style={{ fontSize: '20px' }}></i>
        </div>
      ) : users.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px', fontSize: '14px', color: 'var(--text-muted)' }}>No hay usuarios aún.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {users.map(user => (
            <div key={user.id} style={{ background: 'var(--glass-bg)', borderRadius: '16px', padding: '18px 24px', border: '1px solid var(--border)' }}>
              {/* Header: name, role badge, action buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontWeight: 600, fontSize: '15px' }}>{user.username}</span>
                  <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '8px', background: user.role === 'admin' ? 'var(--accent-glow)' : 'rgba(255,255,255,0.05)', color: user.role === 'admin' ? 'var(--accent)' : 'var(--text-muted)' }}>
                    {user.role}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => startEdit(user)} title="Editar" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', fontSize: '13px' }}><i className="fas fa-pen"></i></button>
                  <button onClick={() => setManagingUserId(managingUserId === user.id ? null : user.id)} title="Gestionar acceso" style={{ background: 'none', border: '1px solid var(--border)', color: managingUserId === user.id ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', fontSize: '13px' }}><i className="fas fa-lock"></i></button>
                  <button onClick={() => handleDelete(user.id)} title="Eliminar" style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--danger)', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', fontSize: '13px' }}><i className="fas fa-trash-alt"></i></button>
                </div>
              </div>

              {/* Edit inline form */}
              {editingId === user.id && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <select value={editRole} onChange={(e) => setEditRole(e.target.value)} style={{ flex: 1, padding: '10px 14px', fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '12px', outline: 'none' }}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <input type="password" placeholder="Nueva contraseña (opcional)" value={editPass} onChange={(e) => setEditPass(e.target.value)} style={{ flex: 2, padding: '10px 14px', fontSize: '14px', color: 'var(--text-primary)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '12px', outline: 'none' }} />
                  <button className="btn-preview-voice" onClick={handleUpdate} style={{ flexShrink: 0, padding: '10px 14px' }}><i className="fas fa-check"></i></button>
                  <button className="btn-cancel" onClick={() => { setEditingId(null); setEditRole('user'); setEditPass(''); }}><i className="fas fa-times"></i></button>
                </div>
              )}

              {/* Assignment management for this user */}
              {managingUserId === user.id && (
                <div style={{ marginTop: '20px', padding: '18px 22px', background: 'rgba(0,0,0,0.25)', borderRadius: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--accent)', marginBottom: '16px' }}>
                    <i className="fas fa-lock-open"></i> Asignar recursos a "{user.username}"
                  </div>
                  {user.role === 'admin' && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '14px', padding: '8px 12px', background: 'rgba(0,0,0,0.15)', borderRadius: '8px' }}>
                      <i className="fas fa-info-circle"></i> Los admins tienen acceso completo. Estas asignaciones son innecesarias.
                    </div>
                  )}
                  {/* Three-column layout for assignments */}
                  <div style={{ display: 'flex', gap: '14px' }}>
                    <div style={{ flex: 1 }}>{renderToggleList('Chats', 'fa-comments', assignChats, userAssignedIds.chats, 'chat')}</div>
                    <div style={{ flex: 1 }}>{renderToggleList('Personajes', 'fa-masks-theater', assignChars, userAssignedIds.characters, 'character')}</div>
                    <div style={{ flex: 1 }}>{renderToggleList('Historias', 'fa-book-open', assignStor, userAssignedIds.stories, 'story')}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}