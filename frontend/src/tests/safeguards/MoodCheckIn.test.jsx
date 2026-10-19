import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MoodCheckIn from '../../components/safeguards/MoodCheckIn.jsx';
import { recordMood } from '../../services/safeguards.service.js';

vi.mock('../../services/safeguards.service.js', () => ({ recordMood: vi.fn() }));

const resources = [{ name: '988 Suicide & Crisis Lifeline (US)', contact: 'Call or text 988' }];

describe('MoodCheckIn', () => {
  beforeEach(() => {
    recordMood.mockReset();
  });

  it('asks a different question before and after a session', () => {
    const { rerender } = render(<MoodCheckIn phase="pre" onComplete={() => {}} />);
    expect(screen.getByRole('heading', { name: 'How are you feeling?' })).toBeInTheDocument();
    rerender(<MoodCheckIn phase="post" onComplete={() => {}} />);
    expect(screen.getByRole('heading', { name: 'How was that session for you?' })).toBeInTheDocument();
  });

  it('records the chosen mood and validates it', async () => {
    recordMood.mockResolvedValue({ tone: 'encouraging', consistentlyLow: false });
    const onComplete = vi.fn();
    render(<MoodCheckIn phase="pre" onComplete={onComplete} />);

    await userEvent.click(screen.getByRole('button', { name: /Not great/ }));

    expect(recordMood).toHaveBeenCalledWith('pre', 'low');
    expect(await screen.findByText(/It's okay to feel frustrated/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Support resources')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ tone: 'encouraging' }));
  });

  it('shows support resources when moods have been consistently low', async () => {
    recordMood.mockResolvedValue({
      consistentlyLow: true,
      support: { message: "I'm noticing you've been struggling lately.", resources }
    });
    render(<MoodCheckIn phase="post" onComplete={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /Not great/ }));

    const support = await screen.findByLabelText('Support resources');
    expect(support).toHaveTextContent("I'm noticing you've been struggling lately.");
    expect(support).toHaveTextContent('Call or text 988');
  });

  it('lets the user continue if saving fails', async () => {
    recordMood.mockRejectedValue(new Error('offline'));
    const onComplete = vi.fn();
    render(<MoodCheckIn phase="pre" onComplete={onComplete} />);

    await userEvent.click(screen.getByRole('button', { name: /Okay/ }));
    expect(await screen.findByText(/couldn't save this check-in/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onComplete).toHaveBeenCalledWith(null);
  });

  it('can be skipped', async () => {
    const onComplete = vi.fn();
    render(<MoodCheckIn phase="pre" onComplete={onComplete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onComplete).toHaveBeenCalledWith(null);
    expect(recordMood).not.toHaveBeenCalled();
  });
});
