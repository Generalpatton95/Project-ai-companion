const { ClaudeProvider } = require('../../../integrations/claude');
const { AgentOrchestrator } = require('../../../agent/orchestrator');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');

const TOOLS = [{
  name: 'game_api',
  description: 'Fetch player data',
  input_schema: { type: 'object', properties: { player_id: { type: 'string' } }, required: ['player_id'] }
}];

function toolUseReply(id, input) {
  return {
    ...FakeAnthropic.reply(''),
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: '', signature: `sig-${id}` },
      { type: 'tool_use', id, name: 'game_api', input }
    ]
  };
}

describe('ClaudeProvider', () => {
  test('sends a request current models accept', async () => {
    const client = new FakeAnthropic();
    const provider = new ClaudeProvider({ client, model: 'claude-opus-5-5', maxTokens: 16000, effort: 'high' });

    await provider.complete([
      { role: 'system', content: 'You are a coach.' },
      { role: 'user', content: 'Analyze my games' }
    ], TOOLS, { temperature: 0.2 });

    const [request] = client.requests;
    expect(request).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: 'You are a coach.',
      tools: TOOLS,
      messages: [{ role: 'user', content: 'Analyze my games' }]
    });
    expect(request).not.toHaveProperty('temperature');
  });

  test('passes content blocks through unchanged', async () => {
    const client = new FakeAnthropic();
    const provider = new ClaudeProvider({ client });
    const assistant = toolUseReply('toolu_1', { player_id: 'x' }).content;
    const results = [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }];

    await provider.complete([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: assistant },
      { role: 'user', content: results }
    ], TOOLS);

    expect(client.requests[0].messages[1].content).toEqual(assistant);
    expect(client.requests[0].messages[2].content).toEqual(results);
    expect(client.requests[0]).not.toHaveProperty('system');
  });
});

describe('AgentOrchestrator tool loop', () => {
  function build(client, toolExecute) {
    const tool = { name: 'game_api', execute: toolExecute };
    return new AgentOrchestrator({
      llm: new ClaudeProvider({ client, model: 'claude-opus-5-5', effort: 'high' }),
      toolRegistry: { getToolSchemas: () => TOOLS, getTool: () => tool },
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

  test('returns tool results as tool_result blocks and keeps the history append-only', async () => {
    const client = new FakeAnthropic();
    client.queue(toolUseReply('toolu_1', { player_id: 'p1' }), FakeAnthropic.reply('You farm well; ward more.'));
    const orchestrator = build(client, async () => ({ success: true, data: { cs: 7.2 } }));

    const result = await orchestrator.executeTask({ type: 'match_analysis', parameters: { player: 'p1' } });

    expect(result.status).toBe('completed');
    expect(result.result.summary).toBe('You farm well; ward more.');

    const [first, second] = client.requests;
    expect(first.system).toMatch(/expert gaming companion/);
    expect(second.system).toBe(first.system);
    expect(second.tools).toEqual(first.tools);
    // Second request = first request's messages + assistant turn + tool results
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(second.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-toolu_1' });
    expect(second.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: JSON.stringify({ cs: 7.2 }, null, 2) }]
    });
  });

  test('a failed tool is reported with is_error and the follow-up keeps the same tools', async () => {
    const client = new FakeAnthropic();
    client.queue(toolUseReply('toolu_9', { player_id: 'p1' }), FakeAnthropic.reply('Could not fetch data.'));
    const orchestrator = build(client, async () => ({ success: false, error: 'Riot API down' }));

    const result = await orchestrator.executeTask({ type: 'match_analysis' });

    expect(result.result.summary).toBe('Could not fetch data.');
    const followUp = client.requests[1];
    expect(followUp.tools).toEqual(TOOLS);
    expect(followUp.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_9', content: 'Error: Riot API down', is_error: true }
    ]);
  });

  test('a tool that succeeds with no data still sends content', async () => {
    const client = new FakeAnthropic();
    client.queue(toolUseReply('toolu_2', {}), FakeAnthropic.reply('done'));
    const orchestrator = build(client, async () => ({ success: true }));

    await orchestrator.executeTask({ type: 'match_analysis' });
    expect(client.requests[1].messages[2].content[0].content).toBe('null');
  });
});
