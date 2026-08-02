import { deleteChat } from '../api';

export default function ChatList({ chats, activeChatId, onSelect, onNew, onDelete, onOpenSettings }) {
  const handleDelete = async (e, id) => {
    e.stopPropagation();
    await deleteChat(id);
    if (activeChatId === id) onSelect(null);
    onDelete();
  };

  return (
    <aside className="sidebar">
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
          >
            <span className="chat-item-title">{chat.title}</span>
            <button
              className="btn-delete-chat"
              onClick={(e) => handleDelete(e, chat.id)}
              title="Delete chat"
            >
              <i className="fas fa-xmark"></i>
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="btn-settings" onClick={onOpenSettings}>
          <i className="fas fa-gear"></i> Settings
        </button>
      </div>
    </aside>
  );
}
