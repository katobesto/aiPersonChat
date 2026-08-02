import { useState, useEffect, useCallback } from 'react';
import ChatList from './components/ChatList';
import ChatView from './components/ChatView';
import SettingsModal from './components/SettingsModal';
import { fetchChats, createChat } from './api';

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(0);

  const loadChats = useCallback(async () => {
    try {
      const data = await fetchChats();
      setChats(data);
      // Auto-select the most recent chat on first load
      if (!activeChatId && data.length > 0) {
        setActiveChatId(Number(data[0].id));
      }
    } catch { /* ignore */ }
  }, []);

  // Load chats on mount
  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Reload chat list whenever needed
  const refreshChats = useCallback(() => {
    loadChats();
  }, [loadChats]);

  const handleNewChat = async () => {
    const result = await createChat('New Chat');
    setActiveChatId(Number(result.id));
    refreshChats();
  };

  return (
    <div className="app-layout">
      <ChatList
        chats={chats}
        activeChatId={activeChatId}
        onSelect={setActiveChatId}
        onNew={handleNewChat}
        onDelete={refreshChats}
        onOpenSettings={() => setShowSettings(true)}
      />
      <div className="chat-main">
        {activeChatId ? (
          <ChatView chatId={activeChatId} onRefresh={refreshChats} settingsDirty={settingsDirty} />
        ) : (
          <WelcomeScreen />
        )}
      </div>
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onSaved={() => setSettingsDirty((d) => d + 1)} />
      )}
    </div>
  );
}

function WelcomeScreen() {
  return (
    <div className="welcome-screen">
      <div className="welcome-icon"><i className="fas fa-bolt"></i></div>
      <h2>Bienvenido a AI Chat</h2>
      <p>Selecciona una conversación o crea una nueva para empezar.</p>
    </div>
  );
}
