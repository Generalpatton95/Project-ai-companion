import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BreakReminder from '../../components/safeguards/BreakReminder.jsx';

const breakReminder = { level: 'break', title: "You've been playing for a while!", message: 'Stretch.' };
const wrapUpReminder = { level: 'wrap_up', title: "That's a solid session!", message: 'Wrap up.' };

describe('BreakReminder', () => {
  it('renders nothing without a reminder', () => {
    const { container } = render(<BreakReminder reminder={null} elapsedMinutes={10} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a break reminder with play time', async () => {
    const onSnooze = vi.fn();
    const onEndSession = vi.fn();
    render(
      <BreakReminder
        reminder={breakReminder}
        elapsedMinutes={125}
        onSnooze={onSnooze}
        onEndSession={onEndSession}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent("You've been playing for 2h 5m.");

    await userEvent.click(screen.getByRole('button', { name: 'Remind me in 30 min' }));
    expect(onSnooze).toHaveBeenCalledWith(30);

    await userEvent.click(screen.getByRole('button', { name: 'Take a break' }));
    expect(onEndSession).toHaveBeenCalled();
  });

  it('asks the user to wrap up after a long session', () => {
    render(<BreakReminder reminder={wrapUpReminder} elapsedMinutes={245} onSnooze={() => {}} onEndSession={() => {}} />);
    expect(screen.getByRole('button', { name: 'Wrap up for today' })).toBeInTheDocument();
  });
});
