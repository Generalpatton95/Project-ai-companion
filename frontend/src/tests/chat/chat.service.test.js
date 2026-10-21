import { sendMessageStream } from '../../services/chat.service.js';

function sseResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
  return { ok: status < 400, status, body, json: async () => ({}) };
}

describe('sendMessageStream', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses deltas split across chunks and returns the done payload', async () => {
    const done = { messages: [{ id: '1', role: 'assistant', text: 'Hello there' }], safeguard: null, conversation: { id: 'c1' } };
    const full = `event: delta\ndata: ${JSON.stringify({ text: 'Hello ' })}\n\n` +
      `event: delta\ndata: ${JSON.stringify({ text: 'there' })}\n\n` +
      `event: done\ndata: ${JSON.stringify(done)}\n\n`;
    // Split at awkward points to exercise buffering
    const fetchMock = vi.fn(async () => sseResponse([full.slice(0, 7), full.slice(7, 40), full.slice(40)]));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('companion.authToken', 'tok');

    const deltas = [];
    const result = await sendMessageStream('c1', 'hi', { onDelta: (t) => deltas.push(t) });

    expect(deltas).toEqual(['Hello ', 'there']);
    expect(result).toEqual(done);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/chat/conversations/c1/messages');
    expect(init.headers.Accept).toBe('text/event-stream');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('throws the server error from an error event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `event: delta\ndata: {"text":"Hi"}\n\nevent: error\ndata: {"error":"Something went wrong. Please try again.","status":500}\n\n`
    ])));
    await expect(sendMessageStream('c1', 'hi')).rejects.toMatchObject({ status: 500, message: 'Something went wrong. Please try again.' });
  });

  it('R2.4: an error event keeps its data, so outage resources reach the page', async () => {
    const data = {
      error: 'Service temporarily unavailable. Please try again shortly.',
      status: 503,
      resources: [{ name: '988 Suicide & Crisis Lifeline (US)', contact: 'Call or text 988' }]
    };
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `event: delta\ndata: {"text":"Hi"}\n\nevent: error\ndata: ${JSON.stringify(data)}\n\n`
    ])));

    const error = await sendMessageStream('c1', 'hi').catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(data.error);
    expect(error.status).toBe(503);
    expect(error.data).toEqual(data);
  });

  it('throws when the stream ends without a done event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([`event: delta\ndata: {"text":"Hi"}\n\n`])));
    await expect(sendMessageStream('c1', 'hi')).rejects.toThrow('interrupted');
  });

  it('surfaces JSON errors returned before streaming', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'This conversation has ended.' }) })));
    await expect(sendMessageStream('c1', 'hi')).rejects.toMatchObject({ status: 409, message: 'This conversation has ended.' });
  });
});
