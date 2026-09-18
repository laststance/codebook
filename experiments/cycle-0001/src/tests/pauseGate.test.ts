import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PauseGate } from '../pauseGate';

test('only one concurrent continuation claims the same stopped thread', async () => {
  // Arrange
  const gate = new PauseGate();
  const pause = gate.stop('owned-page', 7);
  // Act
  const claims = await Promise.all([Promise.resolve(gate.reserve(pause)), Promise.resolve(gate.reserve(pause))]);
  // Assert
  assert.deepEqual(claims, [true, false]);
});

test('manual resume and another stop invalidate old captures and continuation requests', () => {
  // Arrange
  const gate = new PauseGate();
  const stale = gate.stop('owned-page', 7);
  // Act
  gate.invalidate(true);
  const next = gate.stop('owned-page', 7);
  // Assert
  assert.equal(gate.matches(stale), false);
  assert.equal(gate.reserve(stale), false);
  assert.equal(next.generation, 2);
  assert.equal(gate.conflict, true);
});

test('a foreign session or thread cannot resume the selected pause', () => {
  // Arrange
  const gate = new PauseGate();
  const pause = gate.stop('owned-page', 7);
  // Act
  const foreignSession = gate.reserve({ ...pause, sessionId: 'decoy-page' });
  const foreignThread = gate.reserve({ ...pause, threadId: 8 });
  // Assert
  assert.equal(foreignSession, false);
  assert.equal(foreignThread, false);
  assert.equal(gate.matches(pause), true);
});
