// ============================================================================
// FILE: backend/agent/report-schemas.js
// JSON schemas for analysis reports (structured outputs, output_config.format)
//
// Structured outputs require additionalProperties: false on every object and
// don't support numeric or length constraints, so limits like "two or three
// growth opportunities" live in the prompt instead.
// ============================================================================

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const headline = {
  type: 'string',
  description: 'One encouraging sentence summarizing the report'
};

const dataNote = {
  ...nullableString,
  description: 'If player data could not be retrieved or is incomplete, say so here and note that the advice is general; otherwise null'
};

const closing = {
  type: 'string',
  description: 'One encouraging line that invites follow-up questions in chat'
};

const PLAYER_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    headline,
    data_note: dataNote,
    strengths: {
      type: 'array',
      description: 'What the player is doing well, backed by their data',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' }
        },
        required: ['title', 'detail'],
        additionalProperties: false
      }
    },
    growth_opportunities: {
      type: 'array',
      description: 'Two or three areas to work on, each with a concrete next step',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          current: { ...nullableString, description: "The player's current level from their data, or null if unknown" },
          goal: { ...nullableString, description: 'An achievable target relative to their current level, or null' },
          next_step: { type: 'string', description: 'Something concrete to do or practice next' }
        },
        required: ['area', 'current', 'goal', 'next_step'],
        additionalProperties: false
      }
    },
    progress: {
      type: 'array',
      description: 'Changes over time shown by the data; empty if there is no history to compare',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          before: { type: 'string' },
          after: { type: 'string' }
        },
        required: ['metric', 'before', 'after'],
        additionalProperties: false
      }
    },
    closing
  },
  required: ['headline', 'data_note', 'strengths', 'growth_opportunities', 'progress', 'closing'],
  additionalProperties: false
};

const META_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    headline,
    data_note: {
      ...nullableString,
      description: 'Which patch or time period this reflects, and any limits of the information; null if not needed'
    },
    insights: {
      type: 'array',
      description: 'Strategies and champion picks worth knowing, tailored to the player when role or rank are given',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' }
        },
        required: ['title', 'detail'],
        additionalProperties: false
      }
    },
    closing
  },
  required: ['headline', 'data_note', 'insights', 'closing'],
  additionalProperties: false
};

const REPORT_SCHEMAS = {
  match_analysis: PLAYER_REPORT_SCHEMA,
  strategy_planning: PLAYER_REPORT_SCHEMA,
  meta_research: META_REPORT_SCHEMA
};

// The analysis types the app offers; any other task_type is rejected (400)
const TASK_TYPES = Object.keys(REPORT_SCHEMAS);

/**
 * The output_config.format for a task type, or null for unknown types.
 */
function reportFormat(taskType) {
  const schema = REPORT_SCHEMAS[taskType];
  return schema ? { type: 'json_schema', schema } : null;
}

module.exports = { reportFormat, TASK_TYPES, PLAYER_REPORT_SCHEMA, META_REPORT_SCHEMA };
