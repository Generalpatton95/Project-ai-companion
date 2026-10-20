const redis = require('../../../config/redis');
const logger = require('../../../utils/logger');

const { connectRedis } = redis;

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

  test('R1.2: commands and connects time out on their own (withTimeout stays the backstop)', () => {
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
});
