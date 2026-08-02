import { useState, useRef, useEffect } from 'react';
import { deleteChat, renameChat } from '../api';

export default function ChatList({ chats, activeChatId, onSelect, onNew, onDelete, onOpenSettings, onLogout, isOpen = true }) {
  const [contextMenu, setContextMenu] = useState(null); // { x, y, chat }
  const [editingChat, setEditingChat] = useState(null); // chat being renamed
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    document.addEventListener('click', () => {
      setContextMenu(null);
      if (editingChat) setEditingChat(null); // close editor on outside click
    });
    return () => document.removeEventListener('click', () => {});
  }, []);

  const handleContextMenu = (e, chat) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, chat });
    setEditingChat(null);
  };

  const handleDelete = async (id) => {
    await deleteChat(id);
    if (activeChatId === id) onSelect(null);
    onDelete();
    setContextMenu(null);
  };

  const startRename = (chat) => {
    setEditingChat(chat);
    setEditTitle(chat.title);
    setContextMenu(null);
  };

  const confirmRename = async () => {
    if (!editingChat || !editTitle.trim()) return;
    await renameChat(editingChat.id, editTitle.trim());
    onDelete(); // refresh the list
    setEditingChat(null);
  };

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <h2>AI Chat</h2>
      </div>

      <div style={{ padding: '12px' }}>
        <button className="btn-new-chat" onClick={onNew}>
          <i className="fas fa-plus"></i> New Chat
        </button>
      </div>

      <div className="chat-list">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-item ${activeChatId === chat.id ? 'active' : ''}`}
            onClick={() => onSelect(chat.id)}
            onContextMenu={(e) => handleContextMenu(e, chat)}
          >
            {editingChat && editingChat.id === chat.id ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                onBlur={confirmRename}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                style={{
                  flex: 1, background: 'var(--bg-input)', border: '1px solid var(--accent)',
                  borderRadius: '6px', color: 'var(--text-primary)', padding: '2px 6px', fontSize: 'inherit'
                }}
              />
            ) : (
              <span className="chat-item-title">{chat.title}</span>
            )}
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && !editingChat && (
        <div
          className="chat-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => startRename(contextMenu.chat)}>
            <i className="fas fa-pen"></i> Renombrar
          </button>
          <button onClick={() => handleDelete(contextMenu.chat.id)} className="context-menu-danger">
            <i className="fas fa-trash-alt"></i> Eliminar
          </button>
        </div>
      )}

      <div className="sidebar-footer" style={{ display: 'flex', gap: '8px' }}>
        <button className="btn-settings" onClick={onOpenSettings} style={{ flex: 1 }}>
          <i className="fas fa-gear"></i> Settings
        </button>
        {onLogout && (
          <button className="btn-logout" onClick={onLogout} title="Cerrar sesión">
            <i className="fas fa-right-from-bracket"></i>
          </button>
        )}
      </div>
    </aside>
  );
}
