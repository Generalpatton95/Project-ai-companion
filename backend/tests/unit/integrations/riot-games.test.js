jest.mock('axios', () => ({ get: jest.fn() }));

const axios = require('axios');
const { RiotGamesClient } = require('../../../integrations/riot-games');
const { GameAPITool } = require('../../../tools/game-api.tool');
const logger = require('../../../utils/logger');

const SUMMONER = 'Hide on bush';
const PUUID = 'puuid-abc123-private';
const SUMMONER_ID = 'summoner-id-xyz789';
const MATCH_ID = 'NA1_4242424242';

function riotError() {
  const error = new Error(`Request failed for ${SUMMONER} ${PUUID}: {"status":{"message":"Data not found"}}`);
  error.name = 'AxiosError';
  error.code = 'ERR_BAD_REQUEST';
  error.status = 404;
  error.response = { status: 404, data: { status: { message: `summoner ${SUMMONER} not found` } } };
  return error;
}

const CALLS = [
  ['getSummoner', [SUMMONER, 'na1'], 'Failed to fetch summoner'],
  ['getMatchHistory', [PUUID, 'na1', 20], 'Failed to fetch match history'],
  ['getMatchDetails', [MATCH_ID, 'na1'], 'Failed to fetch match details'],
  ['getRankedStats', [SUMMONER_ID, 'na1'], 'Failed to fetch ranked stats']
];

function logged(...spies) {
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

function expectNoIdentifiers(text) {
  for (const value of [SUMMONER, PUUID, SUMMONER_ID, MATCH_ID, 'Data not found', 'not found']) {
    expect(text).not.toContain(value);
  }
}

describe('RiotGamesClient', () => {
  let client;
  let errorSpy;
  let debugSpy;

  beforeEach(() => {
    // The client's token refill is an interval; fake timers keep it from
    // holding Jest open
    jest.useFakeTimers();
    client = new RiotGamesClient();
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => logger);
    axios.get.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test.each(CALLS)('R4.1, R4.6: %s throws without the outside message and logs only region and error fields', async (method, args, message) => {
    axios.get.mockRejectedValue(riotError());

    const thrown = await client[method](...args).catch((error) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe(message);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({ region: 'na1', errorName: 'AxiosError', errorCode: 'ERR_BAD_REQUEST', status: 404 });
    expectNoIdentifiers(logged(errorSpy, debugSpy));
  });

  test.each(CALLS)('R4.1: %s success logs no player or match identifiers', async (method, args) => {
    axios.get.mockResolvedValue({ data: { ok: true } });

    await client[method](...args);

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expectNoIdentifiers(logged(errorSpy, debugSpy));
  });
});

describe('GameAPITool', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('R4.1: the tool debug log has no player_id', async () => {
    jest.useFakeTimers();
    const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => logger);
    const tool = new GameAPITool();
    tool.riotClient = { getSummoner: async () => ({ id: 'x' }) };

    await tool.execute({ game: 'lol', endpoint: 'summoner', player_id: SUMMONER });

    expect(debugSpy).toHaveBeenCalledWith('Executing game API tool', { game: 'lol', endpoint: 'summoner' });
    expect(logged(debugSpy)).not.toContain(SUMMONER);
    jest.clearAllTimers();
  });
});
