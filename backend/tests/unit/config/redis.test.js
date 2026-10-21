const { EventEmitter } = require('events');
const redis = require('../../../config/redis');
const logger = require('../../../utils/logger');

const { connectRedis, attachLogging } = redis;

describe('config/redis', () => {
  let infoSpy;
  let errorSpy;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('R6.3: requiring the module does not open a connection, and queued commands fail fast', () => {
    expect(redis.status).toBe('wait');
    expect(redis.options.lazyConnect).toBe(true);
    expect(redis.options.maxRetriesPerRequest).toBe(1);
  });

  test('016 R1.2: commands and connects time out on their own (withTimeout stays the backstop)', () => {
    expect(redis.options.commandTimeout).toBe(1500);
    expect(redis.options.connectTimeout).toBe(2000);
  });

  test('R6.1: success is logged once, by connectRedis, not again on every connect event', () => {
    expect(redis.listenerCount('connect')).toBe(0);
  });

  test('R6.1, R6.2: connectRedis logs the failure with an error code only and resolves', async () => {
    const error = new Error('connect ECONNREFUSED 10.0.0.5:6379');
    error.code = 'ECONNREFUSED';
    const client = { connect: jest.fn(async () => { throw error; }) };

    await expect(connectRedis(client)).resolves.toBeUndefined();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('redis_connect_failed', { errorName: 'Error', errorCode: 'ECONNREFUSED' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('10.0.0.5');
  });

  test('R6.1: connectRedis logs success', async () => {
    const client = { connect: jest.fn(async () => {}) };

    await connectRedis(client);

    expect(infoSpy).toHaveBeenCalledWith('redis_connected');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  describe('outage logging (spec 017)', () => {
    let clock;
    const now = () => clock;

    beforeEach(() => {
      clock = Date.parse('2026-10-21T12:00:00Z');
    });

    function socketError(code = 'ECONNREFUSED') {
      const error = new Error(`connect ${code} 10.0.0.5:6379`);
      error.code = code;
      return error;
    }

    // A stand-in for the ioredis client: an EventEmitter with connect()
    function fakeClient(connect = async () => {}) {
      const client = new EventEmitter();
      client.connect = jest.fn(() => connect(client));
      attachLogging(client, { now });
      return client;
    }

    const calls = (spy, event) => spy.mock.calls.filter(([name]) => name === event);

    test('R3.1: five connection errors log one redis_unavailable with name and code only', () => {
      const client = fakeClient();

      for (let i = 0; i < 5; i++) {
        client.emit('error', socketError());
        clock += 2000;
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith('redis_unavailable', { errorName: 'Error', errorCode: 'ECONNREFUSED' });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('10.0.0.5');
    });

    test('R3.2: ready after the outage logs redis_recovered once, with seconds and failed attempts', () => {
      const client = fakeClient();
      for (let i = 0; i < 5; i++) {
        client.emit('error', socketError(i % 2 ? 'ECONNRESET' : 'ECONNREFUSED'));
        clock += 2000;
      }
      clock += 2500; // recovered 12.5s after the first failure

      client.emit('ready');
      client.emit('ready');

      expect(calls(infoSpy, 'redis_recovered')).toEqual([['redis_recovered', { outageSeconds: 13, failedAttempts: 5 }]]);
    });

    test('R3.1, R3.2: a second outage is logged again, and counted from its own start', () => {
      const client = fakeClient();
      client.emit('error', socketError());
      client.emit('ready');

      clock += 60000;
      client.emit('error', socketError('ETIMEDOUT'));
      clock += 3000;
      client.emit('error', socketError('ETIMEDOUT'));
      client.emit('ready');

      expect(calls(errorSpy, 'redis_unavailable')).toHaveLength(2);
      expect(calls(errorSpy, 'redis_unavailable')[1]).toEqual(['redis_unavailable', { errorName: 'Error', errorCode: 'ETIMEDOUT' }]);
      expect(calls(infoSpy, 'redis_recovered')[1]).toEqual(['redis_recovered', { outageSeconds: 3, failedAttempts: 2 }]);
    });

    test.each([
      'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'EPIPE',
      'ENETUNREACH', 'ENETDOWN', 'EHOSTDOWN', 'ECONNABORTED'
    ])(
      'R3.1: %s counts as a connection failure',
      (code) => {
        const client = fakeClient();
        client.emit('error', socketError(code));
        client.emit('error', socketError(code));

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith('redis_unavailable', { errorName: 'Error', errorCode: code });
      }
    );

    test('R3.1: an ioredis connect timeout (code ETIMEDOUT) counts as a connection failure', () => {
      const client = fakeClient();
      // As built in ioredis 5.8.2, built/Redis.js:171-175
      const timeout = Object.assign(new Error('connect ETIMEDOUT'), { errorno: 'ETIMEDOUT', code: 'ETIMEDOUT', syscall: 'connect' });

      client.emit('error', timeout);

      expect(errorSpy).toHaveBeenCalledWith('redis_unavailable', { errorName: 'Error', errorCode: 'ETIMEDOUT' });
    });

    test('R3.3: an error that is not a connection failure is logged as redis_error (name and code only)', () => {
      const client = fakeClient();
      const error = Object.assign(new Error('WRONGPASS invalid password for user "player@example.com"'), { name: 'ReplyError' });

      client.emit('error', error);
      client.emit('error', error);

      expect(calls(errorSpy, 'redis_error')).toEqual([
        ['redis_error', { errorName: 'ReplyError' }],
        ['redis_error', { errorName: 'ReplyError' }]
      ]);
      expect(calls(errorSpy, 'redis_unavailable')).toHaveLength(0);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('player@example.com');
    });

    test('R3.3: a non-connection error during an outage is still logged, and does not end it', () => {
      const client = fakeClient();
      client.emit('error', socketError());
      client.emit('error', Object.assign(new Error('LOADING'), { name: 'ReplyError' }));
      client.emit('error', socketError());
      client.emit('ready');

      expect(calls(errorSpy, 'redis_error')).toHaveLength(1);
      expect(calls(infoSpy, 'redis_recovered')).toEqual([['redis_recovered', { outageSeconds: 0, failedAttempts: 2 }]]);
    });

    test('R3.4: a healthy startup logs only redis_connected', async () => {
      const client = fakeClient(async (c) => { c.emit('ready'); });

      await connectRedis(client);

      expect(infoSpy.mock.calls).toEqual([['redis_connected']]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    test('R3.4: a failed startup logs only redis_connect_failed, then redis_recovered when Redis is back', async () => {
      const client = fakeClient(async (c) => {
        const error = socketError();
        c.emit('error', error);
        throw error;
      });

      await connectRedis(client);
      for (let i = 0; i < 3; i++) {
        clock += 2000;
        client.emit('error', socketError());
      }
      clock += 1000;
      client.emit('ready');

      expect(errorSpy.mock.calls).toEqual([['redis_connect_failed', { errorName: 'Error', errorCode: 'ECONNREFUSED' }]]);
      expect(infoSpy.mock.calls).toEqual([['redis_recovered', { outageSeconds: 7, failedAttempts: 4 }]]);
    });

    test('R3.4: a failed startup with no error event still opens the outage', async () => {
      const client = fakeClient(async () => { throw new Error('Connection is closed.'); });

      await connectRedis(client);
      clock += 4000;
      client.emit('error', socketError());
      client.emit('ready');

      expect(calls(errorSpy, 'redis_unavailable')).toHaveLength(0);
      expect(calls(errorSpy, 'redis_connect_failed')).toEqual([['redis_connect_failed', { errorName: 'Error' }]]);
      expect(infoSpy.mock.calls).toEqual([['redis_recovered', { outageSeconds: 4, failedAttempts: 2 }]]);
    });

    test('R3.1: errors after startup has finished are logged as usual', async () => {
      const client = fakeClient();
      await connectRedis(client);

      client.emit('error', socketError());

      expect(errorSpy).toHaveBeenCalledWith('redis_unavailable', { errorName: 'Error', errorCode: 'ECONNREFUSED' });
    });

    test('R3.1-R3.3: the app client has the outage logging attached, and no free-text "Redis error" log', () => {
      expect(redis.listenerCount('error')).toBe(1);
      expect(redis.listenerCount('ready')).toBe(1);

      const error = socketError();
      redis.listeners('error')[0](error);
      redis.listeners('ready')[0]();

      expect(errorSpy).not.toHaveBeenCalledWith('Redis error', expect.anything());
      expect(calls(errorSpy, 'redis_unavailable')).toHaveLength(1);
      expect(calls(infoSpy, 'redis_recovered')).toHaveLength(1);
    });
  });
});
