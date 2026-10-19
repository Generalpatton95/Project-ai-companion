// Format a minute count as "45m" or "2h 5m"
export function formatDuration(minutes) {
  const total = Math.max(0, Math.floor(minutes || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return hours ? `${hours}h ${mins}m` : `${mins}m`;
}
