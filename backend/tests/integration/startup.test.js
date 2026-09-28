import { describe, test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../../server.js', import.meta.url));

/** Runs server.js with the given env; resolves when it exits or prints `until`. */
function runServer(env, { until, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [serverPath], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timed out\n${stdout}\n${stderr}`)); }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (until && stdout.includes(until)) {
        clearTimeout(timer);
        const elapsedMs = Date.now() - started;
        child.kill();
        resolve({ stdout, stderr, elapsedMs });
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

describe('server startup', () => {
  test('R1.3: invalid config exits non-zero and names the key, not the value', async () => {
    const { code, stdout, stderr } = await runServer({ NODE_ENV: 'production', PORT: 'abc-value' });
    expect(code).not.toBe(0);
    expect(stderr).toContain('PORT');
    expect(stderr + stdout).not.toContain('abc-value');
  });

  test('NFR1: starts listening in under 2 seconds with no external services', async () => {
    const { stdout, elapsedMs } = await runServer(
      { NODE_ENV: 'production', LOG_LEVEL: 'info', PORT: '38123' },
      { until: 'Server listening' },
    );
    expect(stdout).toContain('38123');
    expect(elapsedMs).toBeLessThan(2000);
  });
});
