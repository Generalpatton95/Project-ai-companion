// ============================================================================
// FILE: frontend/src/components/safeguards/SupportResources.jsx
// Shows the support message and crisis resources returned by the backend
// ============================================================================

export default function SupportResources({ message, resources = [] }) {
  return (
    <aside className="support" aria-label="Support resources">
      {message && <p>{message}</p>}
      <ul>
        {resources.map((resource) => (
          <li key={resource.name}>
            <strong>{resource.name}:</strong>{' '}
            {resource.contact.startsWith('http') ? (
              <a href={resource.contact} target="_blank" rel="noreferrer">
                {resource.contact}
              </a>
            ) : (
              resource.contact
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
