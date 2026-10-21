const { AgentOrchestrator } = require('../../../agent/orchestrator');
const { StateManager } = require('../../../agent/state-manager');
const { AgentController } = require('../../../controllers/agent.controller');
const { ClaudeProvider } = require('../../../integrations/claude');
const { FakeAnthropic } = require('../../helpers/fake-anthropic');
const { MemoryStore } = require('../../helpers/memory-store');
const { ServiceUnavailableError } = require('../../../utils/errors');
const { TASK_TYPES } = require('../../../agent/report-schemas');
const { UsageService } = require('../../../services/safeguards');
const logger = require('../../../utils/logger');

const TASK_FAILED_MESSAGE = "The analysis couldn't be completed. Please try again.";

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

  test('R4.6: a failed analysis is reported as failed with the generic message', async () => {
    const { client, orchestrator, controller } = setup();
    client.queue(new Error('Claude unavailable'));

    const { taskId, done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    await done;

    expect(await controller.getTaskStatus(taskId, user)).toMatchObject({ status: 'failed', error: TASK_FAILED_MESSAGE });
  });

  test('R4.6: a plain Error never reaches the stored state, the run result or getTaskStatus', async () => {
    const { client, stateManager, orchestrator, controller } = setup();
    client.queue(new Error('secret detail: relation users for player@example.com'));

    const { taskId, done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    const run = await done;

    expect(run.error).toBe(TASK_FAILED_MESSAGE);
    expect((await stateManager.getTask(taskId)).error).toBe(TASK_FAILED_MESSAGE);
    const status = await controller.getTaskStatus(taskId, user);
    expect(status.error).toBe(TASK_FAILED_MESSAGE);
    expect(JSON.stringify([run, status, await stateManager.getTask(taskId)])).not.toContain('secret detail');
  });

  test('R4.6: an app error keeps its own message', async () => {
    const { client, stateManager, orchestrator, controller } = setup();
    client.queue(new ServiceUnavailableError('The companion is unavailable right now.'));

    const { taskId, done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    const run = await done;

    expect(run.error).toBe('The companion is unavailable right now.');
    expect((await stateManager.getTask(taskId)).error).toBe('The companion is unavailable right now.');
    expect((await controller.getTaskStatus(taskId, user)).error).toBe('The companion is unavailable right now.');
  });

  test('R4.6: a timed-out analysis is reported as failed', async () => {
    const { client, orchestrator, controller } = setup({ timeout: 30 });
    client.queue((options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const { taskId, done } = await orchestrator.startTask({ type: 'match_analysis', context: { userId: user.id } });
    await done;

    expect(await controller.getTaskStatus(taskId, user)).toMatchObject({ status: 'failed', error: TASK_FAILED_MESSAGE });
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

  test('R5.1, R4.1: an unknown task_type is a ValidationError, and is never logged or started', async () => {
    const { controller, orchestrator } = setup();
    const startTask = jest.spyOn(orchestrator, 'startTask');
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

    try {
      for (const taskType of ['player@example.com', 'MATCH_ANALYSIS', 'toString', 42, ['match_analysis']]) {
        const error = await controller.handleAnalysis({ task_type: taskType }, user).catch((e) => e);
        expect(error).toMatchObject({ name: 'ValidationError', message: 'task_type must be one of: match_analysis, strategy_planning, meta_research' });
      }
      expect(startTask).not.toHaveBeenCalled();
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('player@example.com');
    } finally {
      infoSpy.mockRestore();
      startTask.mockRestore();
    }
  });

  test('R5.1: the known task types are the report types the frontend offers', () => {
    expect(TASK_TYPES).toEqual(['match_analysis', 'strategy_planning', 'meta_research']);
  });

  test.each(['match_analysis', 'strategy_planning', 'meta_research'])('R4.1: a known task_type (%s) is logged as the fixed value', async (taskType) => {
    const { client, controller } = setup();
    const { reply, release } = gate();
    client.queue(reply);
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => logger);

    try {
      const started = await controller.handleAnalysis({ task_type: taskType }, user);
      expect(started.status).toBe('running');
      expect(infoSpy).toHaveBeenCalledWith('Handling analysis', { userId: user.id, taskType });
    } finally {
      infoSpy.mockRestore();
      release(FakeAnthropic.reply('Done.'));
    }
  });

  test("another user's task and a missing task both look like 404", async () => {
    const { client, orchestrator, controller } = setup();
    const { reply, release } = gate();
    client.queue(reply);
    const startTask = jest.spyOn(orchestrator, 'startTask');
    const { taskId } = await controller.handleAnalysis({ task_type: 'match_analysis' }, user);

    try {
      await expect(controller.getTaskStatus(taskId, { id: 'someone-else' })).rejects.toMatchObject({ statusCode: 404 });
      await expect(controller.getTaskStatus('task_missing', user)).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      // Let the task finish, even if an assertion failed, so it isn't left running
      release(FakeAnthropic.reply('Done.'));
      await (await startTask.mock.results[0].value).done;
    }
  });

  describe('R1.8: giving the usage slot back when an accepted analysis fails', () => {
    // An orchestrator whose background run ends with `outcome`
    function controllerWith(outcome) {
      const orchestrator = { startTask: async () => ({ taskId: 'task_1', done: Promise.resolve(outcome) }) };
      return new AgentController({ orchestrator, stateManager: new StateManager({ store: new MemoryStore() }) });
    }

    const settle = () => new Promise((resolve) => setImmediate(resolve));

    test.each([
      ['failed', { taskId: 'task_1', status: 'failed', error: TASK_FAILED_MESSAGE }],
      ['undefined (the run crashed)', undefined],
      ['a timeout result', { taskId: 'task_1', status: 'failed', error: TASK_FAILED_MESSAGE, partialResult: null, duration: 30 }]
    ])('R1.8: a run that ends %s calls onFailed once', async (label, outcome) => {
      const onFailed = jest.fn();

      const started = await controllerWith(outcome).handleAnalysis({ task_type: 'match_analysis' }, user, { onFailed });
      await settle();

      expect(started.status).toBe('running');
      expect(onFailed).toHaveBeenCalledTimes(1);
    });

    test('R1.8: a completed run does not call onFailed', async () => {
      const onFailed = jest.fn();

      await controllerWith({ taskId: 'task_1', status: 'completed', result: {} })
        .handleAnalysis({ task_type: 'match_analysis' }, user, { onFailed });
      await settle();

      expect(onFailed).not.toHaveBeenCalled();
    });

    test('R1.8: onFailed is optional', async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      await controllerWith(undefined).handleAnalysis({ task_type: 'match_analysis' }, user);
      await settle();

      process.removeListener('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });

    test('R1.8: a real timed-out analysis gives its slot back once', async () => {
      const { client, controller } = setup({ timeout: 30 });
      client.queue((options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const store = new MemoryStore();
      const usage = new UsageService({ store });
      const { slot } = await usage.reserveAnalysis(user);
      const release = jest.spyOn(slot, 'release');
      let finished;
      const ended = new Promise((resolve) => { finished = resolve; });

      await controller.handleAnalysis({ task_type: 'match_analysis' }, user, {
        onFailed: () => { slot.release(); finished(); }
      });
      await ended;
      await settle();

      expect(release).toHaveBeenCalledTimes(1);
      expect(await usage.getTodayCount(user.id)).toBe(0);
    });
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
