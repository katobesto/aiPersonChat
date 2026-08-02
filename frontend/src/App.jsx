import { useState, useEffect, useCallback } from 'react';
import ChatList from './components/ChatList';
import ChatView from './components/ChatView';
import SettingsModal from './components/SettingsModal';
import LoginScreen from './components/LoginScreen';
import { fetchChats, createChat, fetchSettings, getToken, clearToken } from './api';
import { applyAccentColor } from './dynamicStyles';

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check token on mount
  useEffect(() => {
    if (getToken()) {
      setIsLoggedIn(true);
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const data = await fetchChats();
      if (!Array.isArray(data)) throw new Error('Invalid chats response');
      setChats(data);
      // Auto-select the most recent chat on first load
      setActiveChatId(prevId => {
        if (!prevId && data.length > 0) return Number(data[0].id);
        return prevId;
      });
    } catch (err) { console.error('loadChats error:', err); }
  }, []);

  // Load chats and accent color when logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    loadChats();
    (async () => {
      try {
        const s = await fetchSettings();
        setSettingsDirty((d) => d + 1);
        if (s?.accent_color) applyAccentColor(s.accent_color);
      } catch (err) { console.error('fetchSettings error:', err); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Reload chat list whenever needed
  const refreshChats = useCallback(() => {
    loadChats();
  }, [loadChats]);

  const handleNewChat = async () => {
    const result = await createChat('New Chat');
    setActiveChatId(Number(result.id));
    refreshChats();
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    clearToken();
    setIsLoggedIn(false);
    setChats([]);
    setActiveChatId(null);
  };

  // Not logged in → show login screen
  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app-layout">
      <ChatList
        chats={chats}
        activeChatId={activeChatId}
        onSelect={setActiveChatId}
        onNew={handleNewChat}
        onDelete={refreshChats}
        onOpenSettings={() => setShowSettings(true)}
        onLogout={handleLogout}
      />
      <div className="chat-main">
        {activeChatId ? (
          <ChatView
            chatId={activeChatId}
            title={chats.find(c => c.id === activeChatId)?.title || 'New Chat'}
            onRefresh={refreshChats}
            settingsDirty={settingsDirty}
          />
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
