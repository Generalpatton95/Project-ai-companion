const { ClaudeProvider } = require('../../../integrations/claude');
const { AgentOrchestrator } = require('../../../agent/orchestrator');
const { reportFormat, PLAYER_REPORT_SCHEMA, META_REPORT_SCHEMA } = require('../../../agent/report-schemas');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');

const TOOLS = [{ name: 'game_api', description: 'x', input_schema: { type: 'object', properties: {} } }];

const playerReport = {
  headline: 'Your laning is getting stronger.',
  data_note: null,
  strengths: [{ title: 'Consistent CS', detail: '7.2 CS per minute across 20 games.' }],
  growth_opportunities: [{ area: 'Vision', current: '18 vision score', goal: '25 vision score', next_step: 'Buy a control ward every back.' }],
  progress: [{ metric: 'Win rate', before: '48%', after: '54%' }],
  closing: 'Want to dig into any of these in chat?'
};

function orchestratorWith(client, toolResult = { success: true, data: {} }) {
  return new AgentOrchestrator({
    llm: new ClaudeProvider({ client }),
    toolRegistry: { getToolSchemas: () => TOOLS, getTool: () => ({ execute: async () => toolResult }) },
    stateManager: {
      createTask: async () => ({ iterations: 0 }),
      addIteration: async () => {},
      recordToolExecution: async () => {},
      completeTask: async () => {},
      failTask: async () => {},
      getTask: async () => ({ iterations: 0 })
    }
  });
}

function toolUse() {
  return {
    ...FakeAnthropic.reply(''),
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'game_api', input: {} }]
  };
}

describe('report schemas', () => {
  // Structured outputs reject objects without additionalProperties: false
  // and don't support numeric or length constraints
  function checkSchema(node, path = 'schema') {
    if (node.type === 'object') {
      expect({ path, additionalProperties: node.additionalProperties }).toEqual({ path, additionalProperties: false });
      expect({ path, required: [...node.required].sort() }).toEqual({ path, required: Object.keys(node.properties).sort() });
      Object.entries(node.properties).forEach(([key, child]) => checkSchema(child, `${path}.${key}`));
    }
    if (node.type === 'array') {
      checkSchema(node.items, `${path}[]`);
    }
    (node.anyOf || []).forEach((child, i) => checkSchema(child, `${path}.anyOf[${i}]`));
    ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'].forEach((key) => {
      expect({ path, [key]: node[key] }).toEqual({ path, [key]: undefined });
    });
  }

  test.each([['player', PLAYER_REPORT_SCHEMA], ['meta', META_REPORT_SCHEMA]])('%s schema fits structured-output rules', (name, schema) => {
    checkSchema(schema);
  });

  test('each task type maps to a schema', () => {
    expect(reportFormat('match_analysis')).toEqual({ type: 'json_schema', schema: PLAYER_REPORT_SCHEMA });
    expect(reportFormat('strategy_planning').schema).toBe(PLAYER_REPORT_SCHEMA);
    expect(reportFormat('meta_research').schema).toBe(META_REPORT_SCHEMA);
    expect(reportFormat('unknown')).toBeNull();
  });
});

describe('structured analysis reports', () => {
  test('ClaudeProvider sends the format inside output_config', async () => {
    const client = new FakeAnthropic();
    await new ClaudeProvider({ client, effort: 'high' }).complete(
      [{ role: 'user', content: 'hi' }], TOOLS, { outputFormat: reportFormat('meta_research') }
    );
    expect(client.requests[0].output_config).toEqual({ effort: 'high', format: reportFormat('meta_research') });
  });

  test('every call in the loop carries the schema, and the JSON answer becomes the report', async () => {
    const client = new FakeAnthropic();
    client.queue(toolUse(), FakeAnthropic.reply(JSON.stringify(playerReport)));

    const result = await orchestratorWith(client).executeTask({ type: 'match_analysis' });

    expect(client.requests).toHaveLength(2);
    client.requests.forEach((request) => {
      expect(request.output_config.format).toEqual(reportFormat('match_analysis'));
    });
    expect(result.result).toEqual({ summary: playerReport.headline, report: playerReport, kind: 'match_analysis' });
  });

  test('meta research uses the meta schema', async () => {
    const client = new FakeAnthropic();
    const metaReport = { headline: 'Bruisers are strong.', data_note: 'Based on patch 26.20.', insights: [], closing: 'Ask me more.' };
    client.queue(FakeAnthropic.reply(JSON.stringify(metaReport)));

    const result = await orchestratorWith(client).executeTask({ type: 'meta_research' });

    expect(client.requests[0].output_config.format.schema).toEqual(META_REPORT_SCHEMA);
    expect(result.result.report).toEqual(metaReport);
  });

  test('an answer that is not valid JSON falls back to text', async () => {
    const client = new FakeAnthropic();
    client.queue({ ...FakeAnthropic.reply('I can’t help with that.'), stop_reason: 'refusal' });

    const result = await orchestratorWith(client).executeTask({ type: 'match_analysis' });

    expect(result.result).toEqual({ summary: 'I can’t help with that.', report: null, kind: 'match_analysis' });
  });

  test('an empty answer gets a readable fallback', async () => {
    const client = new FakeAnthropic();
    client.queue({ ...FakeAnthropic.reply(''), content: [], stop_reason: 'refusal' });

    const result = await orchestratorWith(client).executeTask({ type: 'match_analysis' });
    expect(result.result.summary).toBe('The analysis could not be completed. Please try again.');
  });
});
