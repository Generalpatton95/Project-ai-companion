const fs = require('fs');
const path = require('path');
const { requestLogMiddleware } = require('../../../middleware/request-log.middleware');
const logger = require('../../../utils/logger');

describe('requestLogMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('R4.4: logs method and path only (no IP, body or query string)', () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    const next = jest.fn();
    const req = {
      method: 'POST',
      path: '/api/auth/login',
      originalUrl: '/api/auth/login?email=player%40example.com',
      url: '/api/auth/login?email=player%40example.com',
      query: { email: 'player@example.com' },
      ip: '203.0.113.7',
      ips: ['203.0.113.7'],
      headers: { 'x-forwarded-for': '203.0.113.7' },
      body: { email: 'player@example.com', password: 'correct horse' }
    };

    requestLogMiddleware(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('Request', { method: 'POST', path: '/api/auth/login' });
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).not.toContain('203.0.113.7');
    expect(logged).not.toContain('player');
    expect(logged).not.toContain('correct horse');
  });

  test('R4.4: server.js uses it instead of an inline request log', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../../server.js'), 'utf8');

    expect(server).toMatch(/app\.use\(requestLogMiddleware\)/);
    expect(server).not.toMatch(/logger\.info\(\s*'Request'/);
  });
});
