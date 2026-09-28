import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

const files = jsFiles(root);
const rel = (f) => relative(root, f).replaceAll('\\', '/');

describe('module system', () => {
  test.each(files.map(rel))('R5.1: %s uses ES module syntax', (file) => {
    const source = readFileSync(join(root, file), 'utf8');
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bmodule\.exports\b/);
    expect(source).not.toMatch(/^\s*exports\./m);
  });

  test.each(files.map(rel))('R5.1: %s passes node --check', (file) => {
    expect(() => execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'pipe' })).not.toThrow();
  });

  test('R5.2: no empty files remain', () => {
    const empty = files.filter((f) => readFileSync(f, 'utf8').trim() === '').map(rel);
    expect(empty).toEqual([]);
  });

  test('R5.3: app.js does not import modules owned by later specs', () => {
    const source = readFileSync(join(root, 'app.js'), 'utf8');
    for (const dir of ['agent/', 'tools/', 'integrations/', 'controllers/', 'auth.middleware', 'rate-limit', 'redis', 'agent.routes']) {
      expect(source).not.toContain(dir);
    }
  });

  test.each(['express-basics.js', 'setup-files.js', 'agent/orhestrator.js', 'middleware/error.middleware.js'])(
    'R5.2, R5.4: %s has been removed',
    (file) => { expect(existsSync(join(root, file))).toBe(false); },
  );
});
