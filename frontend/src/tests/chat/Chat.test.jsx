import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Chat from '../../pages/Chat.jsx';
import * as chatService from '../../services/chat.service.js';
import { getMoodSummary } from '../../services/safeguards.service.js';

vi.mock('../../services/chat.service.js', () => ({
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  setPersonality: vi.fn(),
  sendMessageStream: vi.fn()
}));
vi.mock('../../services/safeguards.service.js', () => ({ getMoodSummary: vi.fn() }));

const conversation = { id: 'c1', title: 'Jinx builds', personality: 'friend', endedReason: null };
const resources = [{ name: '988 Suicide & Crisis Lifeline (US)', contact: 'Call or text 988' }];

function reply(userText, assistantText, extra = {}) {
  return {
    messages: [
      { id: `u-${userText}`, role: 'user', text: userText },
      { id: `a-${userText}`, role: 'assistant', text: assistantText, ...extra }
    ],
    conversation: { ...conversation, endedReason: null },
    safeguard: null
  };
}

describe('Chat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    chatService.listConversations.mockResolvedValue([]);
    chatService.createConversation.mockImplementation(async (personality) => ({ ...conversation, title: null, personality }));
    getMoodSummary.mockResolvedValue({ latest: { mood: 'good' } });
  });

  it('starts a conversation with the chosen mode on the first message', async () => {
    chatService.sendMessageStream.mockResolvedValue(reply('How do I play Jinx?', 'Stay behind your frontline.'));
    render(<Chat />);

    expect(await screen.findByText('Current mood: 😊 Feeling good')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Coach/ }));
    await userEvent.type(screen.getByLabelText('Message'), 'How do I play Jinx?{Enter}');

    expect(chatService.createConversation).toHaveBeenCalledWith('coach');
    expect(chatService.sendMessageStream).toHaveBeenCalledWith('c1', 'How do I play Jinx?', expect.any(Object));
    const log = screen.getByRole('log');
    expect(await within(log).findByText('Stay behind your frontline.')).toBeInTheDocument();
    expect(within(log).getByText('How do I play Jinx?')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('shows a typing indicator while waiting', async () => {
    let resolve;
    chatService.sendMessageStream.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'hi{Enter}');
    expect(await screen.findByText('Companion is typing…')).toBeInTheDocument();
    resolve(reply('hi', 'hello!'));
    expect(await screen.findByText('hello!')).toBeInTheDocument();
    expect(screen.queryByText('Companion is typing…')).not.toBeInTheDocument();
  });

  it('shows reply text as it streams, then the saved turn', async () => {
    let finish;
    chatService.sendMessageStream.mockImplementation((id, content, { onDelta }) => {
      onDelta('Stay behind ');
      onDelta('your frontline');
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'Jinx tips?{Enter}');

    const log = screen.getByRole('log');
    expect(await within(log).findByText('Stay behind your frontline')).toBeInTheDocument();
    expect(screen.queryByText('Companion is typing…')).not.toBeInTheDocument();
    expect(log).toHaveAttribute('aria-busy', 'true');

    finish(reply('Jinx tips?', 'Stay behind your frontline and farm.'));
    expect(await within(log).findByText('Stay behind your frontline and farm.')).toBeInTheDocument();
    expect(within(log).queryByText('Stay behind your frontline')).not.toBeInTheDocument();
    expect(log).toHaveAttribute('aria-busy', 'false');
  });

  it('replaces streamed text when the final reply differs (refused mid-reply)', async () => {
    chatService.sendMessageStream.mockImplementation(async (id, content, { onDelta }) => {
      onDelta('Partial answer that');
      return reply('question', "I can't help with that one, but I'm happy to keep talking about your games.", { safeguard: 'refusal' });
    });
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'question{Enter}');
    const log = screen.getByRole('log');
    expect(await within(log).findByText(/can't help with that one/)).toBeInTheDocument();
    expect(within(log).queryByText('Partial answer that')).not.toBeInTheDocument();
  });

  it('drops partial text and keeps the draft if the stream fails', async () => {
    chatService.sendMessageStream.mockImplementation(async (id, content, { onDelta }) => {
      onDelta('Half a rep');
      throw Object.assign(new Error('The reply was interrupted. Please try again.'), { status: 0 });
    });
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn\'t reach the server');
    expect(within(screen.getByRole('log')).queryByText('Half a rep')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('hello');
  });

  it('reopens the most recent conversation and switches mode on it', async () => {
    chatService.listConversations.mockResolvedValue([conversation]);
    chatService.getConversation.mockResolvedValue({
      conversation,
      messages: [{ id: '1', role: 'user', text: 'Best Jinx build?' }, { id: '2', role: 'assistant', text: 'Kraken first.' }]
    });
    chatService.setPersonality.mockResolvedValue({ ...conversation, personality: 'analyst' });
    render(<Chat />);

    expect(await screen.findByText('Kraken first.')).toBeInTheDocument();
    expect(screen.getByLabelText('Past chats')).toHaveValue('c1');
    expect(screen.getByRole('radio', { name: /Friend/ })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: /Analyst/ }));
    expect(chatService.setPersonality).toHaveBeenCalledWith('c1', 'analyst');
    expect(screen.getByRole('radio', { name: /Analyst/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the draft and shows an error when sending fails', async () => {
    chatService.sendMessageStream.mockRejectedValue(
      Object.assign(new Error('The companion is unavailable right now. Please try again in a moment.'), { status: 503 })
    );
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'are you there?{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable right now');
    expect(screen.getByLabelText('Message')).toHaveValue('are you there?');
    expect(within(screen.getByRole('log')).queryByText('are you there?')).not.toBeInTheDocument();
  });

  it('shows resources for a distress reply and keeps chat open', async () => {
    chatService.sendMessageStream.mockResolvedValue(reply('nobody cares about me', 'It sounds like a hard time.', { safeguard: 'distress', resources }));
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'nobody cares about me{Enter}');

    expect(await screen.findByLabelText('Support resources')).toHaveTextContent('Call or text 988');
    expect(screen.getByLabelText('Message')).toBeEnabled();
  });

  it('ends the conversation after a crisis reply', async () => {
    chatService.sendMessageStream.mockResolvedValue({
      ...reply('I want to die', "I hear that you're really struggling", { safeguard: 'crisis', resources }),
      conversation: { ...conversation, endedReason: 'crisis' }
    });
    render(<Chat />);

    await userEvent.type(await screen.findByLabelText('Message'), 'I want to die{Enter}');

    expect(await screen.findByText(/This conversation has ended/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Support resources')).toHaveTextContent('988');

    await userEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    expect(screen.getByLabelText('Message')).toBeEnabled();
  });

  it('does not send blank messages', async () => {
    render(<Chat />);
    await userEvent.type(await screen.findByLabelText('Message'), '   {Enter}');
    expect(chatService.sendMessageStream).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
