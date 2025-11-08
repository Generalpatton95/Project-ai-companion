class BaseTool {
  constructor() {
    // Don't check here - let child classes set properties first
  }

  /**
   * Get tool schema for LLM function calling
   */
  getSchema() {
    if (!this.name) {
      throw new Error('Tool must have a name property');
    }
    if (!this.description) {
      throw new Error('Tool must have a description property');
    }

    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: this.parameters || {},
        required: this.required || []
      }
    };
  }

  /**
   * Execute the tool - must be implemented by subclass
   */
  async execute(params) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Validate parameters
   */
  validateParams(params) {
    if (!this.required) return true;
    
    for (const requiredParam of this.required) {
      if (!(requiredParam in params)) {
        throw new Error(`Missing required parameter: ${requiredParam}`);
      }
    }
    
    return true;
  }

  /**
   * Return successful result
   */
  success(data, metadata = {}) {
    return {
      success: true,
      data,
      metadata,
      error: null
    };
  }

  /**
   * Return error result
   */
  error(message, metadata = {}) {
    return {
      success: false,
      data: null,
      metadata,
      error: message
    };
  }
}

module.exports = { BaseTool };