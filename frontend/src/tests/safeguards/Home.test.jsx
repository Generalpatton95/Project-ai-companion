import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from '../../pages/Home.jsx';
import * as service from '../../services/safeguards.service.js';

vi.mock('../../services/safeguards.service.js', () => ({
  recordMood: vi.fn(),
  startSession: vi.fn(),
  sendHeartbeat: vi.fn(),
  snoozeReminders: vi.fn(),
  endSession: vi.fn()
}));

const reminder = { level: 'break', title: "You've been playing for a while!", message: 'Stretch.' };
const status = (elapsedMinutes, extra = {}) => ({
  active: true,
  startedAt: '2026-10-18T12:00:00Z',
  elapsedMinutes,
  snoozedUntil: null,
  reminder: null,
  ...extra
});

describe('Home session flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    service.recordMood.mockResolvedValue({ consistentlyLow: false });
    service.startSession.mockResolvedValue(status(0));
    service.endSession.mockResolvedValue({ active: false, elapsedMinutes: 130 });
  });

  it('walks from welcome through a session with a break reminder', async () => {
    // Heartbeats report the reminder until snooze is called, then report snoozed
    let snoozed = false;
    const snoozedStatus = status(122, { snoozedUntil: '2026-10-18T14:31:00Z' });
    service.sendHeartbeat.mockImplementation(async () => (snoozed ? snoozedStatus : status(121, { reminder })));
    service.snoozeReminders.mockImplementation(async () => {
      snoozed = true;
      return snoozedStatus;
    });

    render(<Home heartbeatMs={20} />);

    await userEvent.click(screen.getByRole('button', { name: "Let's Get Started" }));
    await userEvent.click(screen.getByRole('button', { name: /Feeling good/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(service.startSession).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Session in progress' })).toBeInTheDocument();

    // Heartbeat brings back a reminder
    expect(await screen.findByRole('alert')).toHaveTextContent("You've been playing for a while!");

    // Snoozing hides it
    await userEvent.click(screen.getByRole('button', { name: 'Remind me in 30 min' }));
    expect(service.snoozeReminders).toHaveBeenCalledWith(30);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Ending the session leads to the post-session check-in
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(await screen.findByRole('heading', { name: 'How was that session for you?' })).toBeInTheDocument();
    expect(screen.getByText('You played for 2h 10m.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Okay/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Nice session' })).toBeInTheDocument();
  });

  it('skips the welcome screen once acknowledged', () => {
    localStorage.setItem('companion.welcomeAcknowledged', 'true');
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'How are you feeling?' })).toBeInTheDocument();
  });

  it('stays on the check-in with an error if the session cannot start', async () => {
    localStorage.setItem('companion.welcomeAcknowledged', 'true');
    service.startSession.mockRejectedValue(new Error('offline'));
    render(<Home />);

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByText(/Couldn't start your session/)).toBeInTheDocument();
  });
});
