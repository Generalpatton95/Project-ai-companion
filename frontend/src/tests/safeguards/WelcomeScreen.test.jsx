import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WelcomeScreen, { hasAcknowledgedWelcome } from '../../components/safeguards/WelcomeScreen.jsx';

describe('WelcomeScreen', () => {
  it('states that the companion is an AI and shows a crisis line', () => {
    render(<WelcomeScreen onContinue={() => {}} />);
    expect(screen.getByText("I'm an AI assistant, not a human")).toBeInTheDocument();
    expect(screen.getByText("I can't replace real friendships")).toBeInTheDocument();
    expect(screen.getByText('988')).toBeInTheDocument();
  });

  it('remembers that the user continued', async () => {
    const onContinue = vi.fn();
    render(<WelcomeScreen onContinue={onContinue} />);

    expect(hasAcknowledgedWelcome()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: "Let's Get Started" }));

    expect(onContinue).toHaveBeenCalled();
    expect(hasAcknowledgedWelcome()).toBe(true);
  });
});
