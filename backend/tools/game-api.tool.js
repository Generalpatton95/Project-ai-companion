const { BaseTool } = require('./base-tool');
const { RiotGamesClient } = require('../integrations/riot-games');
const logger = require('../utils/logger');

class GameAPITool extends BaseTool {
  // Set properties as class fields (before constructor)
  name = 'game_api';
  description = 'Fetch player data, match history, and statistics from game APIs (Riot Games, Steam, etc.)';
  parameters = {
    game: {
      type: 'string',
      description: 'Game identifier (e.g., "lol", "valorant", "dota2")',
      enum: ['lol', 'valorant', 'tft']
    },
    endpoint: {
      type: 'string',
      description: 'API endpoint to call',
      enum: ['summoner', 'match_history', 'match_details', 'ranked_stats']
    },
    player_id: {
      type: 'string',
      description: 'Player identifier (summoner name, PUUID, etc.)'
    },
    region: {
      type: 'string',
      description: 'Game region (e.g., "na1", "euw1", "kr")',
      default: 'na1'
    },
    params: {
      type: 'object',
      description: 'Additional parameters for the API call'
    }
  };
  required = ['game', 'endpoint', 'player_id'];

  constructor() {
    super();
    this.riotClient = new RiotGamesClient();
  }

  async execute(params) {
    try {
      this.validateParams(params);
      
      const { game, endpoint, player_id, region = 'na1', params: extraParams = {} } = params;
      
      logger.debug('Executing game API tool', { game, endpoint, player_id });
      
      let result;
      
      switch (game) {
        case 'lol':
        case 'valorant':
        case 'tft':
          result = await this.handleRiotAPI(game, endpoint, player_id, region, extraParams);
          break;
        default:
          return this.error(`Unsupported game: ${game}`);
      }
      
      return this.success(result, {
        game,
        endpoint,
        player_id,
        region
      });
      
    } catch (error) {
      logger.error('Game API tool error', { error: error.message });
      return this.error(error.message);
    }
  }

  async handleRiotAPI(game, endpoint, playerId, region, extraParams) {
    switch (endpoint) {
      case 'summoner':
        return await this.riotClient.getSummoner(playerId, region);
        
      case 'match_history':
        const count = extraParams.count || 20;
        return await this.riotClient.getMatchHistory(playerId, region, count);
        
      case 'match_details':
        const matchId = extraParams.match_id;
        if (!matchId) throw new Error('match_id required for match_details');
        return await this.riotClient.getMatchDetails(matchId, region);
        
      case 'ranked_stats':
        return await this.riotClient.getRankedStats(playerId, region);
        
      default:
        throw new Error(`Unknown endpoint: ${endpoint}`);
    }
  }
}

module.exports = { GameAPITool };