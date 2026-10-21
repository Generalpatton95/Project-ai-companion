const { withTimeout, sendUnavailable, UNAVAILABLE_MESSAGE } = require('../../../utils/unavailable');
const { ServiceUnavailableError } = require('../../../utils/errors');
const { CRISIS_RESOURCES } = require('../../../services/safeguards/messages');

function fakeResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    }
  };
  return res;
}

describe('withTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('016 R1.2: a value that resolves in time passes through', async () => {
    jest.useFakeTimers();
    await expect(withTimeout(Promise.resolve(7))).resolves.toBe(7);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('016 R1.2: a rejection passes through unchanged and clears the timer', async () => {
    jest.useFakeTimers();
    const error = new Error('boom');
    await expect(withTimeout(Promise.reject(error))).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('016 R1.2: a promise that never settles rejects with ServiceUnavailableError at 1500ms', async () => {
    jest.useFakeTimers();
    let settled = false;
    const pending = withTimeout(new Promise(() => {})).catch((error) => {
      settled = true;
      return error;
    });

    await jest.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(settled).toBe(true);
    expect(error).toBeInstanceOf(ServiceUnavailableError);
  });

  test('016 R1.2: the timeout can be set per call', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 200);
    const assertion = expect(pending).rejects.toBeInstanceOf(ServiceUnavailableError);
    await jest.advanceTimersByTimeAsync(200);
    await assertion;
  });

  test('R6.3: the timer does not keep the process alive', async () => {
    const realSetTimeout = global.setTimeout;
    let handle;
    jest.spyOn(global, 'setTimeout').mockImplementation((...args) => {
      handle = realSetTimeout(...args);
      return handle;
    });

    const pending = withTimeout(new Promise(() => {}), 10);
    expect(handle.hasRef()).toBe(false);
    await expect(pending).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});

describe('sendUnavailable', () => {
  test('016 R1.1: responds 503 with Retry-After: 30 and the standard message', () => {
    const res = fakeResponse();
    sendUnavailable(res);

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body).toEqual({ error: 'Service temporarily unavailable. Please try again shortly.' });
  });

  test('016 R2.2: includes CRISIS_RESOURCES only when asked for', () => {
    const plain = fakeResponse();
    sendUnavailable(plain, { crisisResources: false });
    expect(plain.body).not.toHaveProperty('resources');

    const chat = fakeResponse();
    sendUnavailable(chat, { crisisResources: true });
    expect(chat.statusCode).toBe(503);
    expect(chat.body).toEqual({
      error: 'Service temporarily unavailable. Please try again shortly.',
      resources: CRISIS_RESOURCES
    });
  });

  test('R2.4: UNAVAILABLE_MESSAGE is the message sendUnavailable sends, unchanged', () => {
    const res = fakeResponse();
    sendUnavailable(res);

    expect(UNAVAILABLE_MESSAGE).toBe('Service temporarily unavailable. Please try again shortly.');
    expect(res.body.error).toBe(UNAVAILABLE_MESSAGE);
  });

  test('R2.7: an optional message replaces the standard one; status, Retry-After and resources are unchanged', () => {
    const res = fakeResponse();
    sendUnavailable(res, { crisisResources: true, message: 'The companion is unavailable right now. Please try again in a moment.' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body).toEqual({
      error: 'The companion is unavailable right now. Please try again in a moment.',
      resources: CRISIS_RESOURCES
    });
  });
});
