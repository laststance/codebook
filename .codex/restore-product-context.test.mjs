import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./restore-product-context.mjs', import.meta.url));

test('compaction restores current goal-reading and image-viewing instructions from a repository subdirectory', () => {
  // Arrange
  const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' });
  const config = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));
  // Act
  const result = spawnSync('/bin/sh', ['-c', config.hooks.SessionStart[0].hooks[0].command], { cwd: new URL('../extension', import.meta.url), input, encoding: 'utf8' });
  const output = JSON.parse(result.stdout);
  // Assert
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.ok(output.hookSpecificOutput.additionalContext.includes(root));
  assert.ok(output.hookSpecificOutput.additionalContext.includes(readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')));
  assert.match(output.hookSpecificOutput.additionalContext, /open the approved PNG with an image-viewing tool/);
  assert.match(output.hookSpecificOutput.additionalContext, /Preserve pending owner instructions and any explicit pause/);
  assert.equal(output.continue, undefined);
  assert.equal(output.decision, undefined);
});

test('startup, resume and other events do not add compaction instructions', () => {
  // Arrange
  const events = [{ hook_event_name: 'SessionStart', source: 'startup' }, { hook_event_name: 'SessionStart', source: 'resume' }, { hook_event_name: 'PostCompact', source: 'compact' }];
  for (const event of events) {
    // Act
    const result = spawnSync(process.execPath, [script], { input: JSON.stringify(event), encoding: 'utf8' });
    // Assert
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

test('malformed hook input reports failure without inventing restored context', () => {
  // Arrange / Act
  const result = spawnSync(process.execPath, [script], { input: '{', encoding: 'utf8' });
  // Assert
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Codebook context restoration failed/);
});

test('the repository registers only compaction restoration through a root-resolved command', () => {
  // Arrange / Act
  const config = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));
  // Assert
  assert.deepEqual(Object.keys(config.hooks), ['SessionStart']);
  assert.equal(config.hooks.SessionStart.length, 1);
  assert.equal(config.hooks.SessionStart[0].matcher, '^compact$');
  assert.equal(config.hooks.SessionStart[0].hooks[0].command, 'node "$(git rev-parse --show-toplevel)/.codex/restore-product-context.mjs"');
  assert.equal(config.hooks.SessionStart[0].hooks[0].timeout, 5);
});
