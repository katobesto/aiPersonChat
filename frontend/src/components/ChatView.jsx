import { useState, useEffect, useRef } from 'react';
import { fetchMessages, sendMessageStream, rewindMessages, renameChat, fetchSettings as apiFetchSettings, speakWithEdgeTts, fetchChatAssignments, exportChat } from '../api';
import AssignmentsPanel from './AssignmentsPanel';

export default function ChatView({ chatId, title: initialTitle, onRefresh, settingsDirty, toggleSidebar }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [promptModal, setPromptModal] = useState(null); // { prompt: [...messages], title }
  const [showAssignments, setShowAssignments] = useState(false);
  const [assignmentCount, setAssignmentCount] = useState(0);
  const [settings, setSettings] = useState({}); // local settings for voice
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  // track the last chatId we scrolled for, to avoid double-scrolls
  const lastScrolledChatRef = useRef(null);

  /**
   * Scroll so that the LAST message-bubble sits at the TOP of the visible area.
   * Uses double rAF to ensure React has painted before reading positions.
   */
  const scrollToLastMessageTop = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = document.querySelector('.messages-area');
        if (!container) return;
        // Find the last .message-bubble inside the container
        const bubbles = container.querySelectorAll('.message-bubble');
        if (bubbles.length === 0) return;
        const lastBubble = bubbles[bubbles.length - 1];
        // Calculate how much to scroll: position the bubble at the top of the visible area
        const offsetTop = lastBubble.offsetTop - container.offsetTop;
        // Small margin so it's not glued hard against the very top edge
        container.scrollTop = Math.max(0, offsetTop - 4);
      });
    });
  };

  // Load messages and settings when chat changes
  useEffect(() => {
    loadMessages();
    loadSettings();
    loadAssignments();
  }, [chatId]);

  const loadAssignments = async () => {
    try {
      const data = await fetchChatAssignments(chatId);
      setAssignmentCount((data?.characters?.length || 0) + (data?.stories?.length || 0));
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line no-unused-vars
  useEffect(() => {
    if (settingsDirty > 0) { loadMessages(); loadSettings(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsDirty]);

  const loadSettings = async () => {
    try {
      setSettings(await apiFetchSettings());
    } catch { /* use defaults */ }
  };

  const loadMessages = async () => {
    try {
      const data = await fetchMessages(chatId);
      setMessages(data);
      if (data.length > 0) {
        const firstUser = data.find(m => m.role === 'user');
        // title is now passed as prop from App.jsx; no local setTitle needed
      }
    } catch { /* ignore */ }
  };

  // Scroll to last message top when loading a new chat.
  // Runs once per chatId change, after messages are populated into the DOM.
  useEffect(() => {
    if (messages.length > 0 && lastScrolledChatRef.current !== chatId) {
      lastScrolledChatRef.current = chatId;
      scrollToLastMessageTop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, chatId]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    setError(null);

    const text = input.trim();
    setInput('');

    // Generate stable IDs before any state updates to avoid collisions
    const baseId = Date.now();
    const userId = baseId;
    const assistantId = baseId + 1;

    // Add user message immediately for responsiveness
    setMessages((prev) => [...prev, { id: userId, role: 'user', content: text }]);
    setLoading(true);

    // Seed an empty assistant message that will grow via streaming
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', thinking: '' }]);

    // Scroll so the new messages appear with their header at top of visible area
    scrollToLastMessageTop();

    sendMessageStream(
      chatId,
      text,
      // onToken — called for each streamed chunk with type classification
      ({ delta, type }) => {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantId) return msg;
            if (type === 'thinking') {
              return { ...msg, thinking: (msg.thinking || '') + delta };
            }
            return { ...msg, content: msg.content + delta };
          })
        );
      },
      // onDone — called when the stream finishes
      ({ prompt }) => {
        if (prompt) {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantId) return msg;
              return { ...msg, prompt };
            })
          );
        }
        setLoading(false);
      },
      // onError
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
  };

  // Function to speak text using Microsoft Edge TTS via backend
  const speak = (text, voiceName = settings.voice || '') => {
    if (!text) return;
    speakWithEdgeTts(text, voiceName);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const saveTitle = async () => {
    setEditingTitle(false);
    if (editTitle.trim()) {
      await renameChat(chatId, editTitle.trim());
      onRefresh();
    }
  };

  // Rewind — delete all messages after the given message ID
  const handleRewind = async (msgId) => {
    if (!confirm('¿Rebobinar? Se borrarán todos los mensajes posteriores a este.')) return;
    await rewindMessages(chatId, msgId);
    loadMessages(); // reload from backend
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header with editable title */}
      <div className="chat-header" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          className="hamburger-btn"
          onClick={toggleSidebar}
          aria-label="Menú"
          title="Mostrar/ocultar menú"
        >
          <i className="fas fa-bars"></i>
        </button>
        {editingTitle ? (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
            autoFocus
          />
        ) : (
          <span onDoubleClick={() => { setEditingTitle(true); setEditTitle(initialTitle); }} style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}>
            <i className="fas fa-comment-dots"></i> {initialTitle}
          </span>
        )}
        <button
          onClick={async () => { try { await exportChat(chatId); } catch(e) { console.error('Export error:', e); } }}
          title="Exportar chat"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', fontSize: '14px', flexShrink: 0 }}
        >
          <i className="fas fa-download"></i>
        </button>
        <button
          onClick={() => setShowAssignments(true)}
          title="Asignar personajes e historias"
          style={{
            background: assignmentCount > 0 ? 'var(--accent-glow)' : 'transparent',
            border: 'none', color: assignmentCount > 0 ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer', padding: '6px 10px', borderRadius: '8px', fontSize: '14px', position: 'relative', flexShrink: 0, marginLeft: '8px'
          }}
        >
          <i className="fas fa-link"></i>
          {assignmentCount > 0 && (
            <span style={{
              position: 'absolute', top: '-4px', right: '-6px',
              background: 'var(--accent)', color: '#fff', fontSize: '10px', fontWeight: 700,
              borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>{assignmentCount}</span>
          )}
        </button>
      </div>

      {/* Messages */}
      <div className="messages-area" style={{ flex: 1, minHeight: 0 }}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} allMessages={messages} streaming={loading && isLastAssistant(msg, messages)} settings={settings} speak={speak} onShowPrompt={(prompt) => setPromptModal({ prompt })} onRewind={handleRewind} />
        ))}
        {!loading && error && (
          <div style={{ color: 'var(--danger)', fontSize: '13px', alignSelf: 'center' }}>
            <i className="fas fa-triangle-exclamation"></i> {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="input-area" style={{ flexShrink: 0 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Enter to send)"
          rows={1}
        />
        <button className="btn-send" onClick={handleSend} disabled={!input.trim() || loading}>
          {loading ? <><i className="fas fa-spinner fa-spin"></i></> : <><i className="fas fa-paper-plane"></i></>}
        </button>
      </div>

      {/* Prompt Viewer Modal */}
      {promptModal && promptModal.prompt && (
        <PromptModal prompt={promptModal.prompt} onClose={() => setPromptModal(null)} />
      )}

      {/* Assignments Panel */}
      {showAssignments && (
        <AssignmentsPanel chatId={chatId} onClose={() => {
          setShowAssignments(false);
          loadAssignments(); // refresh count after changes
        }} />
      )}
    </div>
  );
}

function isLastAssistant(msg, messages) {
  return msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id;
}

// Reconstruct the full API prompt for a given assistant message.
// Note: The real system prompt (with assigned characters/stories) is sent by the backend
// and stored in msg.prompt. This function only reconstructs from local settings as fallback.
function buildPrompt(allMessages, msgIndex, settings) {
  if (settings.system_prompt?.trim()) {
    return [{ role: 'system', content: settings.system_prompt.trim() }, ...allMessages.slice(0, msgIndex)];
  }
  return allMessages.slice(0, msgIndex);
}

function MessageBubble({ msg, allMessages, streaming, settings, speak, onShowPrompt, onRewind }) {
  const isUser = msg.role === 'user';
  const hasThinking = !isUser && (msg.thinking || '').length > 0;
  const [showThinking, setShowThinking] = useState(false);

  // Build prompt: use the API-provided one if available, otherwise reconstruct from history + settings
  const idx = allMessages.findIndex(m => m.id === msg.id);
  const reconstructedPrompt = !isUser && idx >= 0 ? buildPrompt(allMessages, idx, settings) : null;
  const displayPrompt = msg.prompt || reconstructedPrompt;
  const hasPrompt = !!displayPrompt;

  return (
    <div className={`message-bubble ${msg.role}`}>
      {!isUser && (
        <div className="message-role-label">
          AI
          {streaming && <DotsLoader />}
        </div>
      )}
      {/* Collapsible thinking section */}
      {hasThinking && (
        <div style={{ marginBottom: '8px' }}>
          <button
            onClick={() => setShowThinking((s) => !s)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: '0.8em',
              padding: '3px 10px',
              borderRadius: '8px',
              cursor: 'pointer',
              marginBottom: showThinking ? '6px' : '0',
              transition: 'all 0.15s ease',
            }}
          >
            {showThinking
              ? <><i className="fas fa-brain"></i> Ocultar pensamiento</>
              : <><i className="fas fa-brain"></i> Ver pensamiento</>
            }
          </button>
          {showThinking && (
            <span
              style={{
                display: 'block',
                fontSize: '0.85em',
                fontStyle: 'italic',
                color: '#888',
                whiteSpace: 'pre-wrap',
                marginTop: showThinking ? '4px' : '0',
              }}
            >
              {msg.thinking}
            </span>
          )}
        </div>
      )}
      {/* Content */}
      {msg.content ? (
        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
      ) : (streaming ? (
        <DotsLoader />
      ) : null)}

      {/* Action bar — unified buttons at the bottom */}
      {!streaming && msg.content && idx >= 0 && !isUser && ((hasPrompt) || (idx < allMessages.length - 1)) && (
        <div className="message-actions">
          {/* AI message: speak, prompt viewer, rewind */}
          <button onClick={() => speak(msg.content, settings.voice || '')} title="Reproducir audio">
            <i className="fas fa-volume-high"></i> Reproducir
          </button>
          {hasPrompt && (
            <button onClick={() => onShowPrompt?.(displayPrompt)} title="Ver el prompt enviado a la API">
              <i className="fas fa-code"></i> Ver prompt
            </button>
          )}
          {idx < allMessages.length - 1 && (
            <button onClick={() => onRewind?.(msg.id)} title="Rebobinar — borrar mensajes posteriores">
              <i className="fas fa-backward-step"></i> Rebobinar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Prompt section parsing (turns the tagged system prompt into a tree) ──
const SECTION_LABELS = {
  ROLEPLAY_ENGINE: { label: 'Reglas del motor (invariables)', icon: 'fa-shield-halved' },
  PROJECT_RULES: { label: 'Reglas del proyecto', icon: 'fa-sliders' },
  STORY_CANON: { label: 'Canon de la historia', icon: 'fa-book-open' },
  CHARACTERS: { label: 'Personajes', icon: 'fa-users' },
  CHARACTER_PROFILE: { label: 'Personaje', icon: 'fa-user' },
  SCENE_STATE: { label: 'Estado de la escena', icon: 'fa-clapperboard' },
  RELATIONSHIP_STATE: { label: 'Estado de la relación', icon: 'fa-heart-pulse' },
  PRIVATE_CONTEXT: { label: 'Contexto privado / omnisciente', icon: 'fa-eye-slash' },
  RECENT_PATTERNS_TO_AVOID: { label: 'Patrones recientes a evitar', icon: 'fa-rotate' },
  REPEATED_USER_MESSAGE_NOTE: { label: 'Nota: mensaje repetido', icon: 'fa-arrows-rotate' },
  NARRATIVE_STYLE: { label: 'Estilo narrativo', icon: 'fa-pen-nib' },
};

// Extracts top-level <TAG attr="...">content</TAG> blocks from a string.
// Not a general XML parser — matches this app's known, non-nested tag set.
function parseTaggedBlocks(text) {
  const blocks = [];
  const re = /<([A-Za-z_]+)((?:\s+[a-zA-Z]+="[^"]*")*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, tag, attrString, content] = m;
    const attrs = {};
    const attrRe = /([a-zA-Z]+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(attrString)) !== null) attrs[am[1]] = am[2];
    blocks.push({ tag, attrs, content: content.trim() });
  }
  return blocks;
}

function parseSystemPromptSections(systemContent) {
  if (!systemContent?.trim()) return [];
  const topLevel = parseTaggedBlocks(systemContent);
  if (topLevel.length === 0) {
    // Not our tagged format (e.g. reconstructed fallback) — show as-is.
    return [{ tag: 'RAW', attrs: {}, content: systemContent, children: [] }];
  }
  return topLevel.map((block) => {
    if (block.tag === 'CHARACTERS') {
      return { ...block, children: parseTaggedBlocks(block.content) };
    }
    return { ...block, children: [] };
  });
}

function sectionMeta(tag, attrs) {
  const known = SECTION_LABELS[tag];
  if (known) {
    const suffix = tag === 'CHARACTER_PROFILE' && attrs.name ? `: ${attrs.name}` : '';
    return { label: known.label + suffix, icon: known.icon };
  }
  return { label: tag, icon: 'fa-tag' };
}

// ─── Accordion primitives ─────────────────────────────────────────────
function AccordionSection({ tag, attrs, content, childBlocks, depth = 0, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const { label, icon } = sectionMeta(tag, attrs);
  const hasChildren = childBlocks && childBlocks.length > 0;

  return (
    <div style={{ marginLeft: depth ? '16px' : 0, marginBottom: '8px' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
          background: 'var(--glass-bg)', border: '1px solid var(--border)', borderRadius: '10px',
          padding: '10px 14px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '13.5px', fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className={`fas ${icon}`} style={{ color: 'var(--accent)', width: '14px' }}></i>
          {label}
        </span>
        <i className={`fas ${open ? 'fa-chevron-up' : 'fa-chevron-down'}`} style={{ fontSize: '11px', color: 'var(--text-muted)' }}></i>
      </button>
      {open && (
        <div style={{ padding: hasChildren ? '8px 0 0 0' : '10px 14px', }}>
          {content?.trim() && (
            <pre
              style={{
                background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '10px',
                padding: '12px 14px', fontSize: '12.5px', lineHeight: '1.6', color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
              }}
            >
              {content}
            </pre>
          )}
          {hasChildren && childBlocks.map((child, i) => (
            <AccordionSection key={i} tag={child.tag} attrs={child.attrs} content={child.content} childBlocks={child.children} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversationEntry({ role, content }) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        background: isUser ? 'var(--accent-glow)' : 'var(--bg-primary)',
        border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 14px', marginBottom: '8px',
      }}
    >
      <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: isUser ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '4px' }}>
        {isUser ? 'Usuario' : 'Asistente'}
      </div>
      <div style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content}
      </div>
    </div>
  );
}

// ─── Prompt Viewer Modal ──────────────────────────────────────────────
function PromptModal({ prompt, onClose }) {
  const [showRaw, setShowRaw] = useState(false);

  const systemMsg = prompt.find((m) => m.role === 'system');
  const nonSystem = prompt.filter((m) => m.role !== 'system');
  const currentMessage = nonSystem[nonSystem.length - 1] || null;
  const history = nonSystem.slice(0, -1);
  const sections = parseSystemPromptSections(systemMsg?.content);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: '720px', maxWidth: '95vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}><i className="fas fa-code"></i> Prompt enviado a la API</h2>
          <button
            onClick={() => setShowRaw((s) => !s)}
            className="btn-preview-voice"
            style={{ width: 'auto', margin: 0, padding: '8px 14px', fontSize: '12px' }}
          >
            <i className="fas fa-file-code"></i> {showRaw ? 'Ver estructurado' : 'Ver JSON crudo'}
          </button>
        </div>

        <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: '4px' }}>
          {showRaw ? (
            <pre
              style={{
                background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '12px',
                padding: '16px', fontSize: '12.5px', lineHeight: '1.6', color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
              }}
            >
              {JSON.stringify(prompt, null, 2)}
            </pre>
          ) : (
            <>
              {sections.length > 0 && (
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                    Mensaje de sistema
                  </div>
                  {sections.map((s, i) => (
                    <AccordionSection key={i} tag={s.tag} attrs={s.attrs} content={s.content} childBlocks={s.children} />
                  ))}
                </div>
              )}

              {history.length > 0 && (
                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                    Historial enviado ({history.length} mensajes)
                  </div>
                  {history.map((m, i) => (
                    <ConversationEntry key={i} role={m.role} content={m.content} />
                  ))}
                </div>
              )}

              {currentMessage && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                    Mensaje actual
                  </div>
                  <ConversationEntry role={currentMessage.role} content={currentMessage.content} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Animated dots loading indicator (reuses .typing-indicator CSS) ──
function DotsLoader() {
  return (
    <span className="typing-indicator" style={{ padding: '0', gap: '5px', marginLeft: '6px' }}>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}
