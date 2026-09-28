// ============================================================================
// FILE: backend/integrations/riot-games.js
// Riot Games API Client
// ============================================================================

import axios from 'axios';
import { loadConfig } from '../config/index.js';
import logger from '../utils/logger.js';

// TODO(spec 007): config.riotGames was renamed to config.riot, so apiKey below is undefined.
const config = loadConfig();

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
      
      logger.debug('Fetched summoner', { summonerName, region });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getSummoner', { 
        summonerName, 
        region, 
        error: error.message 
      });
      throw new Error(`Failed to fetch summoner: ${error.message}`);
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
      
      logger.debug('Fetched match history', { puuid, count });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getMatchHistory', { 
        puuid, 
        error: error.message 
      });
      throw new Error(`Failed to fetch match history: ${error.message}`);
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
      
      logger.debug('Fetched match details', { matchId });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getMatchDetails', { 
        matchId, 
        error: error.message 
      });
      throw new Error(`Failed to fetch match details: ${error.message}`);
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
      
      logger.debug('Fetched ranked stats', { summonerId });
      return response.data;
      
    } catch (error) {
      logger.error('Riot API error - getRankedStats', { 
        summonerId, 
        error: error.message 
      });
      throw new Error(`Failed to fetch ranked stats: ${error.message}`);
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

export { RiotGamesClient };