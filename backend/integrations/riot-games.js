// ============================================================================
// FILE: backend/integrations/riot-games.js
// Riot Games API Client
// ============================================================================

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { errorFields } = require('../utils/log-fields');

// Logs and thrown errors carry only the region and the error's name, code and
// status: summoner names, PUUIDs and other ids identify a player, and Riot's
// messages and response bodies can repeat them.
class RiotGamesClient {
  constructor() {
    this.apiKey = config.riotGames.apiKey;
    this.baseUrls = {
      na1: 'https://na1.api.riotgames.com',
      euw1: 'https://euw1.api.riotgames.com',
      kr: 'https://kr.api.riotgames.com',
      americas: 'https://americas.api.riotgames.com'
    };
    this.rateLimiter = this.createRateLimiter();
  }

  /**
   * Get summoner by name
   */
  async getSummoner(summonerName, region = 'na1') {
    await this.rateLimiter.acquire();
    
    try {
      const url = `${this.baseUrls[region]}/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`;
      
      const response = await axios.get(url, {
        headers: { 'X-Riot-Token': this.apiKey }
      });
      
      logger.debug('Fetched summoner', { region });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getSummoner', { region, ...errorFields(error) });
      throw new Error('Failed to fetch summoner');
    }
  }

  /**
   * Get match history
   */
  async getMatchHistory(puuid, region = 'na1', count = 20) {
    await this.rateLimiter.acquire();
    
    try {
      // Match history uses regional routing
      const regionalUrl = this.getRegionalUrl(region);
      const url = `${regionalUrl}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=${count}`;
      
      const response = await axios.get(url, {
        headers: { 'X-Riot-Token': this.apiKey }
      });
      
      logger.debug('Fetched match history', { region, count });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getMatchHistory', { region, ...errorFields(error) });
      throw new Error('Failed to fetch match history');
    }
  }

  /**
   * Get match details
   */
  async getMatchDetails(matchId, region = 'na1') {
    await this.rateLimiter.acquire();
    
    try {
      const regionalUrl = this.getRegionalUrl(region);
      const url = `${regionalUrl}/lol/match/v5/matches/${matchId}`;
      
      const response = await axios.get(url, {
        headers: { 'X-Riot-Token': this.apiKey }
      });
      
      logger.debug('Fetched match details', { region });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getMatchDetails', { region, ...errorFields(error) });
      throw new Error('Failed to fetch match details');
    }
  }

  /**
   * Get ranked stats
   */
  async getRankedStats(summonerId, region = 'na1') {
    await this.rateLimiter.acquire();
    
    try {
      const url = `${this.baseUrls[region]}/lol/league/v4/entries/by-summoner/${summonerId}`;
      
      const response = await axios.get(url, {
        headers: { 'X-Riot-Token': this.apiKey }
      });
      
      logger.debug('Fetched ranked stats', { region });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getRankedStats', { region, ...errorFields(error) });
      throw new Error('Failed to fetch ranked stats');
    }
  }

  /**
   * Get regional URL for match APIs
   */
  getRegionalUrl(region) {
    const regionalMapping = {
      na1: 'americas',
      br1: 'americas',
      la1: 'americas',
      la2: 'americas',
      euw1: 'europe',
      eun1: 'europe',
      tr1: 'europe',
      ru: 'europe',
      kr: 'asia',
      jp1: 'asia'
    };
    
    const regional = regionalMapping[region] || 'americas';
    return this.baseUrls[regional];
  }

  /**
   * Simple rate limiter
   */
  createRateLimiter() {
    let tokens = 20; // Start with 20 tokens
    const maxTokens = 20;
    const refillRate = 1; // 1 token per second
    
    setInterval(() => {
      tokens = Math.min(tokens + refillRate, maxTokens);
    }, 1000);
    
    return {
      acquire: async () => {
        while (tokens < 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        tokens -= 1;
      }
    };
  }
}

module.exports = { RiotGamesClient };