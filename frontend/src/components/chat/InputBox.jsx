// ============================================================================
// FILE: frontend/src/components/chat/InputBox.jsx
// Enter sends, Shift+Enter adds a new line
// ============================================================================

const MAX_LENGTH = 4000;

export default function InputBox({ value, onChange, onSend, disabled }) {
  const canSend = !disabled && value.trim().length > 0;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (canSend) {
      onSend();
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      handleSubmit(event);
    }
  };

  return (
    <form className="input-box" onSubmit={handleSubmit}>
      <label htmlFor="chat-input" className="sr-only">Message</label>
      <textarea
        id="chat-input"
        rows={2}
        maxLength={MAX_LENGTH}
        placeholder="Type your message…"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button type="submit" className="button primary" disabled={!canSend}>
        Send
      </button>
    </form>
  );
}
