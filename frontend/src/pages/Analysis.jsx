// ============================================================================
// FILE: frontend/src/pages/Analysis.jsx
// Start a background analysis and follow it until it finishes
// ============================================================================

import { useState } from 'react';
import { useAnalysisTask } from '../hooks/useAgent.js';
import AnalysisReport from '../components/analysis/AnalysisReport.jsx';

const TASK_TYPES = [
  { value: 'match_analysis', label: 'Analyze my recent matches', needsPlayer: true },
  { value: 'strategy_planning', label: 'Build me an improvement plan', needsPlayer: true },
  { value: 'meta_research', label: 'What’s strong in the current meta?', needsPlayer: false }
];

const REGIONS = [
  ['na1', 'North America'],
  ['euw1', 'Europe West'],
  ['eun1', 'Europe Nordic & East'],
  ['kr', 'Korea'],
  ['br1', 'Brazil'],
  ['la1', 'Latin America North'],
  ['la2', 'Latin America South'],
  ['oc1', 'Oceania'],
  ['jp1', 'Japan']
];

const RANKS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
const ROLES = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

export default function Analysis({ pollMs }) {
  const { task, starting, startError, start, reset } = useAnalysisTask({ pollMs });
  const [taskType, setTaskType] = useState('match_analysis');
  const [riotId, setRiotId] = useState('');
  const [region, setRegion] = useState('na1');
  const [rank, setRank] = useState('');
  const [role, setRole] = useState('');

  const needsPlayer = TASK_TYPES.find((t) => t.value === taskType).needsPlayer;

  const submit = (override = false) => {
    start({
      task_type: taskType,
      parameters: needsPlayer ? { riot_id: riotId.trim(), region } : { region },
      context: {
        game: 'League of Legends',
        ...(rank && { rank }),
        ...(role && { mainRole: role })
      },
      ...(override && { override: true })
    });
  };

  if (task && task.status === 'completed') {
    const result = task.result || {};
    return <AnalysisReport summary={result.summary} report={result.report} onRunAgain={reset} />;
  }

  if (task && task.status === 'running') {
    return (
      <section className="card analysis-progress" aria-labelledby="progress-title">
        <h2 id="progress-title">Analyzing…</h2>
        <p role="status">
          {task.iterations ? `Working through step ${task.iterations + 1}.` : 'Gathering your data.'}{' '}
          This can take a few minutes. You can switch tabs, and it will keep going.
        </p>
        <div className="progress-bar" aria-hidden="true"><span /></div>
      </section>
    );
  }

  const usageLimit = startError && startError.data && startError.data.safeguard === 'usage_limit';

  return (
    <section className="card analysis" aria-labelledby="analysis-title">
      <h2 id="analysis-title">Get an analysis</h2>

      {task && task.status === 'failed' && (
        <p className="error" role="alert">
          {task.error || 'The analysis didn’t finish.'} You can try again below.
        </p>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="fieldset">
          <legend>What would you like?</legend>
          {TASK_TYPES.map((t) => (
            <label key={t.value} className="checkbox">
              <input
                type="radio"
                name="task-type"
                value={t.value}
                checked={taskType === t.value}
                onChange={() => setTaskType(t.value)}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </fieldset>

        {needsPlayer && (
          <label className="field">
            <span>Riot ID</span>
            <input
              type="text"
              required
              placeholder="Name#TAG"
              autoComplete="off"
              value={riotId}
              onChange={(e) => setRiotId(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Rank <span className="muted">(optional)</span></span>
            <select value={rank} onChange={(e) => setRank(e.target.value)}>
              <option value="">Not set</option>
              {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Main role <span className="muted">(optional)</span></span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Not set</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        </div>

        {startError && (
          <div className={usageLimit ? 'notice' : 'error'} role="alert">
            <p>{usageLimit ? startError.data.message : startError.status ? startError.message : "Couldn't reach the server. Please try again."}</p>
            {usageLimit && startError.data.overridable && (
              <button type="button" className="button ghost" onClick={() => submit(true)} disabled={starting}>
                Analyze anyway
              </button>
            )}
          </div>
        )}

        <button type="submit" className="button primary" disabled={starting}>
          {starting ? 'Starting…' : 'Start analysis'}
        </button>
      </form>
    </section>
  );
}
