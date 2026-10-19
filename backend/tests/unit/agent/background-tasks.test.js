const { AgentOrchestrator } = require('../../../agent/orchestrator');
const { StateManager } = require('../../../agent/state-manager');
const { AgentController } = require('../../../controllers/agent.controller');
const { ClaudeProvider } = require('../../../integrations/claude');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');
const { MemoryStore } = require('../../helpers/memory-store');

const TOOLS = [{ name: 'game_api', description: 'x', input_schema: { type: 'object', properties: {} } }];
const registry = { getToolSchemas: () => TOOLS, getTool: () => ({ execute: async () => ({ success: true, data: {} }) }) };
const user = { id: 'user-1' };

function setup({ timeout = 60000 } = {}) {
  const client = new FakeAnthropic();
  const stateManager = new StateManager({ store: new MemoryStore() });
  const orchestrator = new AgentOrchestrator({
    llm: new ClaudeProvider({ client }),
    toolRegistry: registry,
    stateManager,
    timeout
  });
  const controller = new AgentController({ orchestrator, stateManager, taskTimeout: timeout });
  return { client, stateManager, orchestrator, controller };
}

// A reply that arrives only when release() is called
function gate() {
  let release;
  const reply = () => new Promise((resolve) => { release = resolve; });
  return { reply, release: (value) => release(value) };
}

describe('background analysis', () => {
  test('returns a taskId before the analysis finishes, then reports the result', async () => {
    const { client, controller } = setup();
    const { reply, release } = gate();
    client.queue(reply);

    const started = await controller.handleAnalysis({ task_type: 'match_analysis' }, user);
    expect(started).toMatchObject({ status: 'running', statusUrl: `/api/agent/task/${started.taskId}` });
    expect((await controller.getTaskStatus(started.taskId, user)).status).toBe('running');

    release(FakeAnthropic.reply('Ward more.'));

    // Poll like a client would
    let finished;
    for (let i = 0; i < 100; i++) {
      finished = await controller.getTaskStatus(started.taskId, user);
      if (finished.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(finished).toMatchObject({ status: 'completed', result: { summary: 'Ward more.' } });
  });

  test('a failed analysis is reported as failed', async () => {
    const { client, orchestrator, controller } = setup();
    client.queue(new Error('Claude unavailable'));

    const { taskId, done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    await done;

    expect(await controller.getTaskStatus(taskId, user)).toMatchObject({ status: 'failed', error: 'Claude unavailable' });
  });

  test('a timed-out analysis is reported as failed', async () => {
    const { client, orchestrator, controller } = setup({ timeout: 30 });
    client.queue((options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const { taskId, done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    await done;

    expect(await controller.getTaskStatus(taskId, user)).toMatchObject({ status: 'failed', error: 'Task timeout' });
  });

  test('errors while recording a failure do not escape as unhandled rejections', async () => {
    const { client, stateManager, orchestrator } = setup();
    client.queue(new Error('Claude unavailable'));
    stateManager.failTask = async () => { throw new Error('redis down'); };
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const { done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    await done;
    await new Promise((resolve) => setImmediate(resolve));

    process.removeListener('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  test('task_type is required (400, not 500)', async () => {
    const { controller } = setup();
    await expect(controller.handleAnalysis({}, user)).rejects.toMatchObject({ name: 'ValidationError' });
  });

  test("another user's task and a missing task both look like 404", async () => {
    const { client, orchestrator, controller } = setup();
    const { reply, release } = gate();
    client.queue(reply);
    let done;
    const startTask = orchestrator.startTask.bind(orchestrator);
    orchestrator.startTask = async (task) => {
      const started = await startTask(task);
      done = started.done;
      return started;
    };
    const { taskId } = await controller.handleAnalysis({ task_type: 'match_analysis' }, user);

    await expect(controller.getTaskStatus(taskId, { id: 'someone-else' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(controller.getTaskStatus('task_missing', user)).rejects.toMatchObject({ statusCode: 404 });

    // Let the task finish so its timeout timer doesn't keep Jest running
    release(FakeAnthropic.reply('Done.'));
    await done;
  });

  test('a task left running past its time limit is reported as interrupted', async () => {
    const { stateManager, controller } = setup({ timeout: 1000 });
    const state = await stateManager.createTask('task_old', { type: 'match_analysis', context: { userId: user.id } });
    await stateManager.saveState('task_old', { ...state, createdAt: new Date(Date.now() - 5 * 60000).toISOString() });

    expect(await controller.getTaskStatus('task_old', user)).toMatchObject({
      status: 'failed',
      error: 'The analysis was interrupted. Please try again.'
    });
  });
});
