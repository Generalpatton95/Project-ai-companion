// ============================================================================
// FILE: frontend/src/components/chat/MessageList.jsx
// ============================================================================

import { useEffect, useRef } from 'react';
import SupportResources from '../safeguards/SupportResources.jsx';

export default function MessageList({ messages, typing, busy = false }) {
  const endRef = useRef(null);

  useEffect(() => {
    if (endRef.current && endRef.current.scrollIntoView) {
      endRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages, typing]);

  // aria-busy holds screen-reader announcements until a streamed reply is complete
  return (
    <div className="message-list" role="log" aria-live="polite" aria-busy={busy} aria-label="Conversation">
      {messages.length === 0 && !typing && (
        <p className="muted empty">Ask about a matchup, a build, or how your last game went.</p>
      )}
      {messages.map((message) => (
        <div key={message.id} className={`message message-${message.role}`}>
          <span className="sr-only">{message.role === 'user' ? 'You:' : 'Companion:'}</span>
          <p>{message.text}</p>
          {message.resources && <SupportResources resources={message.resources} />}
        </div>
      ))}
      {typing && (
        <p className="message message-assistant typing" role="status">
          Companion is typing…
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}
