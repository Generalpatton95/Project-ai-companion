// ============================================================================
// FILE: backend/tools/index.js
// Tool Registry - Manages all available tools
// ============================================================================

const { GameAPITool } = require('./game-api.tool');
// Import other tools as you create them
// const { WebSearchTool } = require('./web-search.tool');
// const { DatabaseTool } = require('./database.tool');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.registerDefaultTools();
  }

  /**
   * Register a tool
   */
  register(tool) {
    if (!tool.name) {
      throw new Error('Tool must have a name');
    }
    
    this.tools.set(tool.name, tool);
    logger.info('Registered tool', { name: tool.name });
  }

  /**
   * Get tool by name
   */
  getTool(name) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }

  /**
   * Get all tool schemas for LLM
   */
  getToolSchemas() {
    return Array.from(this.tools.values()).map(tool => tool.getSchema());
  }

  /**
   * List all available tools
   */
  listTools() {
    return Array.from(this.tools.keys());
  }

  /**
   * Register default tools
   */
  registerDefaultTools() {
    this.register(new GameAPITool());
    // Add more default tools here
    // this.register(new WebSearchTool());
    // this.register(new DatabaseTool());
  }
}

module.exports = { ToolRegistry };