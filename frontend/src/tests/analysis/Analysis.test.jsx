import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Analysis from '../../pages/Analysis.jsx';
import * as agentService from '../../services/agent.service.js';

vi.mock('../../services/agent.service.js', () => ({ startAnalysis: vi.fn(), getTask: vi.fn() }));

const running = (iterations = 0) => ({ taskId: 't1', status: 'running', iterations });
const completed = { taskId: 't1', status: 'completed', iterations: 2, result: { summary: 'Your CS is up 15% this month.' } };

describe('Analysis', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    agentService.startAnalysis.mockResolvedValue({ taskId: 't1', status: 'running', statusUrl: '/api/agent/task/t1' });
  });

  it('starts an analysis, shows progress while polling, then the report', async () => {
    agentService.getTask
      .mockResolvedValueOnce(running(0))
      .mockResolvedValueOnce(running(1))
      .mockResolvedValue(completed);
    render(<Analysis pollMs={20} />);

    await userEvent.type(screen.getByLabelText('Riot ID'), 'Faker#KR1');
    await userEvent.selectOptions(screen.getByLabelText('Region'), 'kr');
    await userEvent.selectOptions(screen.getByLabelText(/Rank/), 'Gold');
    await userEvent.selectOptions(screen.getByLabelText(/Main role/), 'Mid');
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(agentService.startAnalysis).toHaveBeenCalledWith({
      task_type: 'match_analysis',
      parameters: { riot_id: 'Faker#KR1', region: 'kr' },
      context: { game: 'League of Legends', rank: 'Gold', mainRole: 'Mid' }
    });
    expect(await screen.findByRole('heading', { name: 'Analyzing…' })).toBeInTheDocument();
    expect(localStorage.getItem('companion.analysisTaskId')).toBe('t1');
    expect(await screen.findByText(/Working through step 2/)).toBeInTheDocument();

    expect(await screen.findByText('Your CS is up 15% this month.')).toBeInTheDocument();
    expect(localStorage.getItem('companion.analysisTaskId')).toBeNull();
    const polls = agentService.getTask.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(agentService.getTask.mock.calls.length).toBe(polls);

    await userEvent.click(screen.getByRole('button', { name: 'Run another analysis' }));
    expect(screen.getByRole('heading', { name: 'Get an analysis' })).toBeInTheDocument();
  });

  it('meta research does not ask for a Riot ID', async () => {
    agentService.getTask.mockResolvedValue(running());
    render(<Analysis pollMs={20} />);

    await userEvent.click(screen.getByLabelText(/current meta/));
    expect(screen.queryByLabelText('Riot ID')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(agentService.startAnalysis).toHaveBeenCalledWith({
      task_type: 'meta_research',
      parameters: { region: 'na1' },
      context: { game: 'League of Legends' }
    });
  });

  it('shows a failed analysis and lets the user try again', async () => {
    agentService.getTask.mockResolvedValue({ taskId: 't1', status: 'failed', error: 'Task timeout' });
    render(<Analysis pollMs={20} />);

    await userEvent.type(screen.getByLabelText('Riot ID'), 'Faker#KR1');
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Task timeout');
    expect(screen.getByRole('button', { name: 'Start analysis' })).toBeEnabled();
  });

  it('offers to go past a soft daily limit', async () => {
    agentService.startAnalysis.mockRejectedValueOnce(Object.assign(new Error('Daily analysis limit reached'), {
      status: 429,
      data: { safeguard: 'usage_limit', message: "Whoa, that's a lot of analyzing!", overridable: true }
    }));
    agentService.getTask.mockResolvedValue(running());
    render(<Analysis pollMs={20} />);

    await userEvent.type(screen.getByLabelText('Riot ID'), 'Faker#KR1');
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("that's a lot of analyzing");
    await userEvent.click(screen.getByRole('button', { name: 'Analyze anyway' }));
    expect(agentService.startAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({ override: true }));
  });

  it('does not offer an override for the free daily limit', async () => {
    agentService.startAnalysis.mockRejectedValueOnce(Object.assign(new Error('Daily analysis limit reached'), {
      status: 429,
      data: { safeguard: 'usage_limit', message: "You've used all of today's analyses.", overridable: false }
    }));
    render(<Analysis pollMs={20} />);

    await userEvent.type(screen.getByLabelText('Riot ID'), 'Faker#KR1');
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("today's analyses");
    expect(screen.queryByRole('button', { name: 'Analyze anyway' })).not.toBeInTheDocument();
  });

  it('resumes an analysis that was running before a reload', async () => {
    localStorage.setItem('companion.analysisTaskId', 't1');
    agentService.getTask.mockResolvedValueOnce(running(1)).mockResolvedValue(completed);
    render(<Analysis pollMs={20} />);

    expect(screen.getByRole('heading', { name: 'Analyzing…' })).toBeInTheDocument();
    expect(await screen.findByText('Your CS is up 15% this month.')).toBeInTheDocument();
    expect(agentService.getTask).toHaveBeenCalledWith('t1');
  });

  it('forgets a saved analysis the server no longer has', async () => {
    localStorage.setItem('companion.analysisTaskId', 'gone');
    agentService.getTask.mockRejectedValue(Object.assign(new Error('Task not found'), { status: 404 }));
    render(<Analysis pollMs={20} />);

    expect(await screen.findByRole('heading', { name: 'Get an analysis' })).toBeInTheDocument();
    expect(localStorage.getItem('companion.analysisTaskId')).toBeNull();
  });

  it('stops after repeated polling failures', async () => {
    agentService.getTask.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
    render(<Analysis pollMs={10} />);

    await userEvent.type(screen.getByLabelText('Riot ID'), 'Faker#KR1');
    await userEvent.click(screen.getByRole('button', { name: 'Start analysis' }));

    expect(await screen.findByText(/Lost touch with the server/)).toBeInTheDocument();
    expect(agentService.getTask).toHaveBeenCalledTimes(5);
  });
});
