import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertFinalScenario } from '../utils/assertFinalScenario';

test('a normal candidate revoked during successful teardown makes the external case fail', () => {
  // Arrange
  const final = { status: 'failed', cleaned: true, activeSessionIds: [], finalOutcome: 'not-demonstrated', failures: ['Request appeared after the expected observation set closed'] };
  // Act / Assert
  assert.throws(() => assertFinalScenario('normal', final), /after the expected observation set closed/);
  assert.doesNotThrow(() => assertFinalScenario('late-request', final));
});

test('missing image evidence only passes the explicitly injected partial-capture case', () => {
  // Arrange
  const final = { status: 'completed', cleaned: true, activeSessionIds: [], finalOutcome: 'partial', failures: [] };
  // Act / Assert
  assert.throws(() => assertFinalScenario('normal', final), /partial/);
  assert.doesNotThrow(() => assertFinalScenario('capture-timeout', final));
  assert.throws(() => assertFinalScenario('capture-timeout', { ...final, finalOutcome: 'demonstrated' }), /partial/);
});
