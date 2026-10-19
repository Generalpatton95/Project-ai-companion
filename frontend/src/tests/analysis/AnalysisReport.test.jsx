import { render, screen, within } from '@testing-library/react';
import AnalysisReport from '../../components/analysis/AnalysisReport.jsx';

const playerReport = {
  headline: 'Your laning is getting stronger.',
  data_note: null,
  strengths: [{ title: 'Consistent CS', detail: '7.2 CS per minute.' }],
  growth_opportunities: [
    { area: 'Vision', current: '18 vision score', goal: '25', next_step: 'Buy a control ward every back.' },
    { area: 'Roaming', current: null, goal: null, next_step: 'Look for a roam after your first back.' }
  ],
  progress: [{ metric: 'Win rate', before: '48%', after: '54%' }],
  closing: 'Want to dig into any of these in chat?'
};

describe('AnalysisReport', () => {
  it('renders strengths before growth opportunities', () => {
    render(<AnalysisReport report={playerReport} onRunAgain={() => {}} />);

    const sections = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(sections).toEqual(['✨ Your strengths', '🎯 Growth opportunities', '📈 Progress']);

    const growth = screen.getByRole('region', { name: '🎯 Growth opportunities' });
    expect(within(growth).getByText('18 vision score → goal: 25')).toBeInTheDocument();
    expect(within(growth).getByText('Next step: Look for a roam after your first back.')).toBeInTheDocument();
    expect(screen.getByText('48% → 54%')).toBeInTheDocument();
    expect(screen.getByText(/dig into any of these in chat/)).toBeInTheDocument();
  });

  it('shows the data note and skips empty sections', () => {
    render(
      <AnalysisReport
        report={{ ...playerReport, data_note: "I couldn't reach your match history, so this advice is general.", progress: [] }}
        onRunAgain={() => {}}
      />
    );
    expect(screen.getByText(/couldn't reach your match history/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '📈 Progress' })).not.toBeInTheDocument();
  });

  it('renders meta insights', () => {
    render(
      <AnalysisReport
        report={{ headline: 'Bruisers are strong.', data_note: 'Based on patch 26.20.', insights: [{ title: 'Top lane', detail: 'Darius is popular.' }], closing: 'Ask me more.' }}
        onRunAgain={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: '💡 What to know' })).toBeInTheDocument();
    expect(screen.getByText('Darius is popular.')).toBeInTheDocument();
  });

  it('falls back to the plain summary without a structured report', () => {
    render(<AnalysisReport summary="Plain text report." report={null} onRunAgain={() => {}} />);
    expect(screen.getByText('Plain text report.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });
});
