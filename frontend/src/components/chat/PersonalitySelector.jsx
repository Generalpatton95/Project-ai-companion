// ============================================================================
// FILE: frontend/src/components/chat/PersonalitySelector.jsx
// Coach / Friend / Analyst mode picker
// ============================================================================

export const PERSONALITIES = [
  { value: 'coach', label: 'Coach', description: 'Direct, with clear goals' },
  { value: 'friend', label: 'Friend', description: 'Warm and encouraging' },
  { value: 'analyst', label: 'Analyst', description: 'Calm and data-focused' }
];

export default function PersonalitySelector({ value, onChange, disabled }) {
  return (
    <div className="personality" role="radiogroup" aria-label="Companion mode">
      {PERSONALITIES.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="personality-option"
          disabled={disabled}
          onClick={() => value !== option.value && onChange(option.value)}
        >
          <strong>{option.label}</strong>
          <span className="muted">{option.description}</span>
        </button>
      ))}
    </div>
  );
}
