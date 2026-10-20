const { GameAPITool, clampCount } = require('../../../tools/game-api.tool');

describe('clampCount', () => {
  test.each([
    [undefined, 20],
    [0, 1],
    [-5, 1],
    ['7', 7],
    [500, 20],
    ['abc', 20]
  ])('R7.1: clampCount(%p) is %p', (value, expected) => {
    expect(clampCount(value)).toBe(expected);
  });

  test('R7.1: the match_history call uses the clamped count', async () => {
    const getMatchHistory = jest.fn(async () => []);
    // Called on a stand-in `this` so no real Riot client (and its timer) is created
    const tool = { riotClient: { getMatchHistory } };

    await GameAPITool.prototype.handleRiotAPI.call(tool, 'lol', 'match_history', 'puuid-1', 'na1', { count: 500 });
    await GameAPITool.prototype.handleRiotAPI.call(tool, 'lol', 'match_history', 'puuid-1', 'na1', {});

    expect(getMatchHistory).toHaveBeenNthCalledWith(1, 'puuid-1', 'na1', 20);
    expect(getMatchHistory).toHaveBeenNthCalledWith(2, 'puuid-1', 'na1', 20);
  });
});
