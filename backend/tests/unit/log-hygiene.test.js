// Source scan: no log call in backend/ (outside tests) may pass an error, its
// message, stack, detail or response, the request body or IP, or request text
// as a value. Fixes go through utils/log-fields.js (errorFields).
//
// Log calls are logger.<level>(...), logger[...](...), calls chained on a
// logger (logger.child(...).error(...)), console.*(...), and the same on any
// alias (const log = logger, or a variable that requires utils/logger).

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const SKIP_DIRS = new Set(['node_modules', 'tests', 'logs']);

// Properties that carry an error's text or an outside service's response
const PROPERTY_RULES = [
  { name: '.message', pattern: /\.\s*message\b/g },
  { name: '.stack', pattern: /\.\s*stack\b/g },
  { name: '.detail', pattern: /\.\s*detail\b/g },
  { name: '.response', pattern: /\.\s*response\b/g },
  { name: 'req.body', pattern: /\breq\s*\.\s*body\b/g },
  { name: 'req.ip', pattern: /\breq\s*\.\s*ip\b/g },
  // Other request input: query string, route params, headers, full URL
  { name: 'req.query', pattern: /\breq\s*\.\s*query\b/g },
  { name: 'req.params', pattern: /\breq\s*\.\s*params\b/g },
  { name: 'req.headers', pattern: /\breq\s*\.\s*headers\b/g },
  { name: 'req.url', pattern: /\breq\s*\.\s*url\b/g },
  { name: 'req.originalUrl', pattern: /\breq\s*\.\s*originalUrl\b/g }
];

// Names that must not be passed as a value (shorthand `{ query }`,
// `x: query`, `flag ? query : null`, `${query}`, `String(query)`); using
// them as an object key (`query: 'x'`) is fine
const VALUE_RULES = [
  // Request text, player and match identifiers (typed by the user or returned
  // by Riot) and the raw task_type. Only a length is allowed, and only for
  // query and content
  {
    name: 'request text',
    pattern: /\b(?:query|content|email|password|summonerName|puuid|player_id|playerId|summonerId|matchId|task_type)\b/g,
    allowLength: ['query', 'content'],
    // req.query is reported once, by its property rule
    skipAfterReq: true
  },
  // A whole error (winston's errors() format would log its message and
  // stack). Reading a field (`error.code`) or `errorFields(error)` is fine
  { name: 'whole error', pattern: /\b(?:error|err|e|ex|reason)\b/g, allowFieldAccess: true, allowErrorFields: true },
  // An error's text taken out first (`const { message } = error`)
  { name: 'error text', pattern: /\b(?:message|stack|detail)\b/g, skipAfterDot: true }
];

// What comes before a `/` that starts a regex literal rather than division
const REGEX_AFTER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof)\s*$/;

/**
 * Blank out comments, string contents, regex literals and template text with
 * spaces (newlines kept), so positions and line numbers stay the same and
 * only code is left. Template `${...}` expressions are kept as code.
 */
function codeOnly(src) {
  const out = src.split('');
  const blank = (j) => {
    if (out[j] !== '\n' && out[j] !== '\r') out[j] = ' ';
  };
  const exprDepths = []; // brace depth at each open `${`
  let inTemplate = false;
  let depth = 0;
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (inTemplate) {
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (c === '`') { inTemplate = false; i += 1; continue; }
      if (c === '$' && d === '{') { exprDepths.push(depth); inTemplate = false; i += 2; continue; }
      blank(i); i += 1; continue;
    }

    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { blank(i); i += 1; }
      continue;
    }
    if (c === '/' && d === '*') {
      blank(i); blank(i + 1); i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i += 1; }
      blank(i); blank(i + 1); i += 2;
      continue;
    }
    if (c === '/' && REGEX_AFTER.test(out.slice(Math.max(0, i - 40), i).join(''))) {
      i += 1;
      let inClass = false;
      while (i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') { blank(i); i += 1; } else if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
        blank(i); i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      i += 1;
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { blank(i); i += 1; }
        blank(i); i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '`') { inTemplate = true; i += 1; continue; }
    if (c === '{') depth += 1;
    if (c === '}') {
      if (exprDepths.length && exprDepths[exprDepths.length - 1] === depth) {
        exprDepths.pop();
        inTemplate = true;
        i += 1;
        continue;
      }
      depth -= 1;
    }
    i += 1;
  }

  return out.join('');
}

const prevChar = (text, index) => {
  const match = /(\S)\s*$/.exec(text.slice(0, index));
  return match ? match[1] : '';
};
const nextText = (text, index) => text.slice(index).replace(/^\s+/, '');

// `name:` right after `{` or `,` is an object key, not a value
function isObjectKey(args, start, end) {
  return nextText(args, end).startsWith(':') && ['{', ','].includes(prevChar(args, start));
}

function isValueOffence(rule, args, start, end, word) {
  const next = nextText(args, end);
  if (isObjectKey(args, start, end)) return false;
  if (rule.skipAfterDot && prevChar(args, start) === '.') return false;
  if (rule.skipAfterReq && /\breq\s*\.\s*$/.test(args.slice(0, start))) return false;
  if (rule.allowLength && rule.allowLength.includes(word) && /^\.\s*length\b/.test(next)) return false;
  if (rule.allowFieldAccess && /^(?:\?\.|\.|\[)/.test(next)) return false;
  if (rule.allowErrorFields && /\berrorFields\s*\(\s*$/.test(args.slice(0, start)) && next.startsWith(')')) return false;
  return true;
}

function offencesIn(args, offset) {
  const found = [];
  for (const rule of PROPERTY_RULES) {
    rule.pattern.lastIndex = 0;
    let hit;
    while ((hit = rule.pattern.exec(args))) {
      found.push({ index: offset + hit.index, rule: rule.name });
    }
  }
  for (const rule of VALUE_RULES) {
    rule.pattern.lastIndex = 0;
    let hit;
    while ((hit = rule.pattern.exec(args))) {
      if (isValueOffence(rule, args, hit.index, hit.index + hit[0].length, hit[0])) {
        found.push({ index: offset + hit.index, rule: rule.name });
      }
    }
  }
  return found;
}

// Names a file uses for the logger or console
function logNames(src, code) {
  const names = new Set(['logger', 'console']);
  const required = /\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"][^'"]*\/logger(?:\.js)?['"]\s*\)/g;
  let match;
  while ((match = required.exec(src))) names.add(match[1]);

  // Aliases of aliases, until nothing new turns up
  let size;
  do {
    size = names.size;
    const alias = new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:${[...names].join('|')})\\b`, 'g');
    while ((match = alias.exec(code))) names.add(match[1]);
  } while (names.size !== size);

  return [...names];
}

// Index of the paren that closes the one at `open`
function closeParen(code, open) {
  let parens = 0;
  for (let j = open; j < code.length; j += 1) {
    if (code[j] === '(') parens += 1;
    if (code[j] === ')') parens -= 1;
    if (parens === 0) return j;
  }
  return code.length;
}

/**
 * Every offence in `src`, as { line, rule, text }. Each log call is read from
 * its open paren to the matching close paren, so multi-line calls are covered,
 * and calls chained on it (`.child(...).error(...)`) are read too. The line
 * reported is the one holding the offending value.
 */
function findOffences(src) {
  const code = codeOnly(src);
  const lines = src.split('\n');
  const lineOf = (index) => code.slice(0, index).split('\n').length;
  const call = new RegExp(`\\b(?:${logNames(src, code).join('|')})\\s*(?:\\.\\s*\\w+|\\[[^\\]]*\\])\\s*\\(`, 'g');
  const chained = /^\s*(?:\.\s*\w+|\[[^\]]*\])\s*\(/;
  const found = [];
  let match;

  while ((match = call.exec(code))) {
    let open = match.index + match[0].length - 1;
    for (;;) {
      const close = closeParen(code, open);
      found.push(...offencesIn(code.slice(open + 1, close), open + 1));
      const next = chained.exec(code.slice(close + 1));
      if (!next) {
        call.lastIndex = Math.max(call.lastIndex, close + 1);
        break;
      }
      open = close + next[0].length;
    }
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ index, rule }) => {
      const line = lineOf(index);
      return { line, rule, text: lines[line - 1].trim() };
    });
}

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const flagged = (src) => findOffences(src).map((o) => `${o.line}:${o.rule}`);

describe('log hygiene scanner', () => {
  test('R4.3: reads multi-line logger calls to the matching close paren', () => {
    const src = [
      "logger.error('Riot API error', {",
      '  region,',
      '  status: (error.response || {}).status,',
      '  error: error.message',
      '});'
    ].join('\n');

    expect(findOffences(src)).toEqual([
      { line: 3, rule: '.response', text: 'status: (error.response || {}).status,' },
      { line: 4, rule: '.message', text: 'error: error.message' }
    ]);
  });

  test('R4.3: flags request text as a value, but not as a key, in a string or in a comment', () => {
    const src = [
      "logger.info('Handling query', { userId: user.id, query });",
      "logger.info('Handling query', { query: 'redacted', queryLength: query.length });",
      '// logger.info(error.message)',
      "logger.warn(`Got ${req.body.email}`, { note: 'error.message', re: /\"'/ });",
      "logger.debug('x', { ip: req.ip, stack: err.stack, body: req.body, pw: password });"
    ].join('\n');

    expect(flagged(src)).toEqual([
      '1:request text',
      '4:req.body',
      '4:request text',
      '5:req.ip',
      '5:.stack',
      '5:req.body',
      '5:request text'
    ]);
  });

  test('R4.3: ignores code outside log calls and parens inside strings', () => {
    const src = [
      'throw new Error(`Failed: ${error.message}`);',
      "logger.error('a) b', errorFields(error)); const x = error.message;"
    ].join('\n');

    expect(findOffences(src)).toEqual([]);
  });

  test('R4.3: flags a whole error passed as a value, but not errorFields(error) or one field', () => {
    const src = [
      "logger.error('x', error);",
      "logger.error('x', { error });",
      "logger.error('x', { err });",
      'logger.error(`failed: ${error}`);',
      "logger.error('x', { reason: String(err) });",
      "logger.error('x', errorFields(error));",
      "logger.error('x', { taskId, ...errorFields(err) });",
      "logger.error('x', { code: error.code, status: err?.status, error: 'fixed text' });"
    ].join('\n');

    expect(flagged(src)).toEqual(['1:whole error', '2:whole error', '3:whole error', '4:whole error', '5:whole error']);
  });

  test('R4.3: the whole-error rule also covers e, ex and reason', () => {
    const src = [
      "logger.error('x', e);",
      "logger.error('x', { ex });",
      "logger.warn('x', { why: reason });",
      "logger.error('x', { code: e.code, status: ex?.status, ...errorFields(reason) });",
      "logger.info('x', { size: 1e5 });"
    ].join('\n');

    expect(flagged(src)).toEqual(['1:whole error', '2:whole error', '3:whole error']);
  });

  test('R4.3: request text includes player and match identifiers and task_type', () => {
    const src = [
      "logger.debug('x', { summonerName, puuid });",
      "logger.debug('x', { id: player_id, other: playerId });",
      "logger.debug('x', { s: summonerId, m: matchId, t: task_type });",
      "logger.debug('x', { n: summonerName.length, region });",
      "logger.debug('x', { summonerName: 'redacted', taskType });"
    ].join('\n');

    expect(flagged(src)).toEqual([
      '1:request text', '1:request text',
      '2:request text', '2:request text',
      '3:request text', '3:request text', '3:request text',
      '4:request text'
    ]);
  });

  test('R4.3: flags req.query, req.params, req.headers, req.url and req.originalUrl', () => {
    const src = [
      "logger.info('x', { q: req.query, p: req.params });",
      "logger.info('x', { h: req.headers['user-agent'] });",
      "logger.info('x', { u: req.url, o: req.originalUrl, path: req.path, method: req.method });"
    ].join('\n');

    expect(flagged(src)).toEqual(['1:req.query', '1:req.params', '2:req.headers', '3:req.url', '3:req.originalUrl']);
  });

  test('R4.3: flags .detail and .response', () => {
    const src = [
      "logger.error('x', { detail: error.detail });",
      "logger.error('x', { body: error.response.data });"
    ].join('\n');

    expect(flagged(src)).toEqual(['1:.detail', '2:.response']);
  });

  test("R4.3: reads logger['level'](...) and logger[level](...)", () => {
    const src = [
      "logger['error']('x', error.message);",
      "logger[level]('x', { query });"
    ].join('\n');

    expect(flagged(src)).toEqual(['1:.message', '2:request text']);
  });

  test('R4.3: reads calls on aliases of the logger', () => {
    const src = [
      "const log = require('../utils/logger');",
      'const audit = log;',
      "log.info('x', { email });",
      "audit.warn('x', error.stack);"
    ].join('\n');

    expect(flagged(src)).toEqual(['3:request text', '4:.stack']);
  });

  test('R4.3: reads calls chained on logger.child(...)', () => {
    const src = "logger.child({ taskId }).error('x', { reason: error.message });";

    expect(flagged(src)).toEqual(['1:.message']);
  });

  test('R4.3: reads console calls', () => {
    const src = [
      'console.error(error.message);',
      "console.log('x', { password });",
      "console.log('Database is up to date');"
    ].join('\n');

    expect(flagged(src)).toEqual(['1:.message', '2:request text']);
  });

  test('R4.3: flags error text taken out first (const { message } = error)', () => {
    const src = [
      'const { message, stack } = error;',
      "logger.warn('x', { message });",
      "logger.warn('x', stack);",
      "logger.warn('x', { message: 'fixed text' });"
    ].join('\n');

    expect(flagged(src)).toEqual(['2:error text', '3:error text']);
  });

  test('R4.3: request text in a ternary is a value, not a key', () => {
    const src = "logger.info('x', { q: flag ? query : null, c: flag ? null : content });";

    expect(flagged(src)).toEqual(['1:request text', '1:request text']);
  });

  test('R4.3: a length is allowed for query and content only', () => {
    const src = [
      "logger.info('x', { queryLength: query.length, contentLength: content.length });",
      "logger.info('x', { emailLength: email.length, passwordLength: password.length });"
    ].join('\n');

    expect(flagged(src)).toEqual(['2:request text', '2:request text']);
  });
});

describe('log hygiene', () => {
  test('R4.1, R4.2, R4.3, R4.4: no log call passes an error, its text, req.body, req.ip or request text', () => {
    const offences = sourceFiles(BACKEND).flatMap((file) =>
      findOffences(fs.readFileSync(file, 'utf8')).map((o) =>
        `${path.relative(BACKEND, file).split(path.sep).join('/')}:${o.line} [${o.rule}] ${o.text}`
      )
    );

    expect(offences).toEqual([]);
  });
});
