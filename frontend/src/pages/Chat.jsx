// ============================================================================
// FILE: frontend/src/pages/Chat.jsx
// Chat with the companion: mode selector, mood indicator, history
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import * as chatService from '../services/chat.service.js';
import { getMoodSummary } from '../services/safeguards.service.js';
import PersonalitySelector from '../components/chat/PersonalitySelector.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import InputBox from '../components/chat/InputBox.jsx';

const MOOD_LABELS = {
  good: '😊 Feeling good',
  okay: '😐 Okay',
  low: '😔 Not great'
};

const DEFAULT_PERSONALITY = 'friend';

export default function Chat() {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [personality, setPersonality] = useState(DEFAULT_PERSONALITY);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [mood, setMood] = useState(null);

  const openConversation = useCallback(async (id) => {
    setError(null);
    try {
      const data = await chatService.getConversation(id);
      setConversation(data.conversation);
      setPersonality(data.conversation.personality);
      setMessages(data.messages);
    } catch {
      setError("Couldn't load that conversation.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await chatService.listConversations();
        if (cancelled) return;
        setConversations(list);
        const latest = list.find((c) => !c.endedReason);
        if (latest) {
          await openConversation(latest.id);
        }
      } catch {
        if (!cancelled) setError("Couldn't load your conversations.");
      }
    })();
    getMoodSummary()
      .then((summary) => !cancelled && setMood(summary.latest ? summary.latest.mood : null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openConversation]);

  const startNewChat = () => {
    setConversation(null);
    setMessages([]);
    setError(null);
  };

  const changePersonality = async (next) => {
    setPersonality(next);
    if (!conversation) return;
    try {
      setConversation(await chatService.setPersonality(conversation.id, next));
    } catch {
      setPersonality(conversation.personality);
      setError("Couldn't switch modes. Please try again.");
    }
  };

  const send = async () => {
    const content = draft.trim();
    const pendingId = `pending-${Date.now()}`;
    setSending(true);
    setError(null);
    setMessages((current) => [...current, { id: pendingId, role: 'user', text: content }]);
    setDraft('');

    try {
      let active = conversation;
      if (!active) {
        active = await chatService.createConversation(personality);
        setConversation(active);
        setConversations((list) => [active, ...list]);
      }
      const result = await chatService.sendMessage(active.id, content);
      setMessages((current) => [...current.filter((m) => m.id !== pendingId), ...result.messages]);
      if (result.conversation.endedReason) {
        setConversation((c) => ({ ...c, endedReason: result.conversation.endedReason }));
      }
      setConversations((list) => list.map((c) =>
        c.id === active.id ? { ...c, title: c.title || content.slice(0, 60) } : c
      ));
    } catch (err) {
      setMessages((current) => current.filter((m) => m.id !== pendingId));
      setDraft(content);
      setError(err.status ? err.message : "Couldn't reach the server. Your message wasn't sent.");
    } finally {
      setSending(false);
    }
  };

  const ended = Boolean(conversation && conversation.endedReason);

  return (
    <section className="card chat" aria-labelledby="chat-title">
      <div className="chat-header">
        <div>
          <h2 id="chat-title">Chat with your companion</h2>
          <p className="muted mood-indicator">
            Current mood: {mood ? MOOD_LABELS[mood] : 'No check-in yet'}
          </p>
        </div>
        <button type="button" className="button ghost" onClick={startNewChat} disabled={sending}>
          New chat
        </button>
      </div>

      {conversations.length > 0 && (
        <label className="field past-chats">
          <span>Past chats</span>
          <select
            value={conversation ? conversation.id : ''}
            onChange={(e) => (e.target.value ? openConversation(e.target.value) : startNewChat())}
            disabled={sending}
          >
            <option value="">New conversation</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || 'Untitled chat'}
              </option>
            ))}
          </select>
        </label>
      )}

      <PersonalitySelector value={personality} onChange={changePersonality} disabled={sending || ended} />

      <MessageList messages={messages} typing={sending} />

      {error && <p className="error" role="alert">{error}</p>}

      {ended ? (
        <div className="chat-ended" role="note">
          <p>
            This conversation has ended. Please reach out to someone you trust, or
            call or text <strong>988</strong> if you're in the US.
          </p>
          <button type="button" className="button ghost" onClick={startNewChat}>
            Start a new chat
          </button>
        </div>
      ) : (
        <InputBox value={draft} onChange={setDraft} onSend={send} disabled={sending} />
      )}

      <p className="fine-print">I'm an AI companion, not a person or a therapist.</p>
    </section>
  );
}
