import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCursorWikiCliResult, requestCursorWikiText } from '../utils/requestCursorWikiText';
import { loadModule } from './utils/loadModule';

test('Cursor Wiki provider accepts only a successful bounded CLI response', () => {
  // Arrange
  const response = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"answer":"No","citations":[{"id":"S1","line":2}]}' });
  // Act
  const result = parseCursorWikiCliResult(response);
  // Assert
  assert.equal(result, '{"answer":"No","citations":[{"id":"S1","line":2}]}');
});

test('Cursor Wiki provider rejects errors and oversized model text before citation rendering', () => {
  // Arrange
  const failed = JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Authentication failed' });
  const oversized = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'x'.repeat(12_001) });
  // Act / Assert
  assert.throws(() => parseCursorWikiCliResult(failed), /could not answer/);
  assert.throws(() => parseCursorWikiCliResult(oversized), /oversized/);
  assert.throws(() => parseCursorWikiCliResult('null'), /could not answer/);
  assert.throws(() => parseCursorWikiCliResult('not json'), /unreadable/);
});

test('a cancelled or oversized Cursor Wiki question starts no model request', async () => {
  // Arrange
  const cancelled = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) };
  const oversizedPrompt = 'x'.repeat(131_073);
  // Act / Assert
  await assert.rejects(requestCursorWikiText('Question: test', cancelled), /cancelled/);
  await assert.rejects(requestCursorWikiText(oversizedPrompt), /too large/);
});

test('a failed Cursor Agent response leaves the browser without a fabricated Wiki answer', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-failed-agent-'));
  const binaryDirectory = join(fakeHome, '.local', 'bin');
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(join(binaryDirectory, 'cursor-agent'), `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => process.stdout.write(JSON.stringify({type:'result',subtype:'error',is_error:true,result:'Authentication failed'})));\n`, { mode: 0o755 });
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    // Act / Assert
    await assert.rejects(requestCursorWikiText('Question: test'), /could not answer/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test('excess Cursor Agent output terminates the isolated Wiki request', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-large-agent-'));
  const binaryDirectory = join(fakeHome, '.local', 'bin');
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(join(binaryDirectory, 'cursor-agent'), `#!${process.execPath}\nprocess.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('x'.repeat(65537)); setInterval(() => {}, 1000); });\n`, { mode: 0o755 });
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  const started = Date.now();
  try {
    // Act / Assert
    await assert.rejects(requestCursorWikiText('Question: test'), /response limit/);
    assert.ok(Date.now() - started < 5_000);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test('cancelling an active Cursor Agent request removes its temporary workspace', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-hanging-agent-'));
  const binaryDirectory = join(fakeHome, '.local', 'bin');
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(join(binaryDirectory, 'cursor-agent'), `#!${process.execPath}\nprocess.stdin.resume(); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  const questionWorkspaces = async () => (await readdir(tmpdir())).filter(name => name.startsWith('codebook-wiki-question-')).sort();
  const before = await questionWorkspaces();
  const listeners = new Set<(event: unknown) => unknown>();
  const token = { isCancellationRequested: false, onCancellationRequested(listener: (event: unknown) => unknown) { listeners.add(listener); return { dispose() { listeners.delete(listener); } }; } };
  const timer = setTimeout(() => { token.isCancellationRequested = true; for (const listener of listeners) listener(undefined); }, 50);
  try {
    // Act / Assert
    await assert.rejects(requestCursorWikiText('Question: test', token), /cancelled/);
    assert.deepEqual(await questionWorkspaces(), before);
  } finally {
    clearTimeout(timer);
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test('a missing Cursor Agent CLI reports the prerequisite without starting Wiki Q&A', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-missing-agent-'));
  const emptyPath = join(fakeHome, 'bin');
  await mkdir(emptyPath);
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  process.env.HOME = fakeHome;
  process.env.PATH = emptyPath;
  try {
    // Act / Assert
    await assert.rejects(requestCursorWikiText('Question: test'), /CLI is not installed/);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    await rm(fakeHome, { recursive: true, force: true });
  }
});

test('a stalled Cursor Agent request times out and leaves no Wiki workspace', async () => {
  // Arrange
  const fakeHome = await mkdtemp(join(tmpdir(), 'codebook-timeout-agent-'));
  const binaryDirectory = join(fakeHome, '.local', 'bin');
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(join(binaryDirectory, 'cursor-agent'), `#!${process.execPath}\nprocess.stdin.resume(); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  const questionWorkspaces = async () => (await readdir(tmpdir())).filter(name => name.startsWith('codebook-wiki-question-')).sort();
  const before = await questionWorkspaces();
  const boundary = await loadModule<typeof import('../utils/requestCursorWikiText')>(join(__dirname, '../utils/requestCursorWikiText.js'), {
    '../constants': {
      WIKI_CURSOR_PROCESS_OUTPUT_LIMIT_BYTES: 65_536,
      WIKI_CURSOR_PROMPT_LIMIT_BYTES: 131_072,
      WIKI_CURSOR_REQUEST_TIMEOUT_MS: 100,
      WIKI_CURSOR_TERMINATION_GRACE_MS: 100,
      WIKI_ANSWER_LIMIT_CHARS: 12_000,
    },
  });
  try {
    // Act / Assert
    await assert.rejects(boundary.requestCursorWikiText('Question: test'), /timed out/);
    assert.deepEqual(await questionWorkspaces(), before);
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(fakeHome, { recursive: true, force: true });
  }
});
