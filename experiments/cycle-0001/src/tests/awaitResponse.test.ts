import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitResponse } from '../utils/awaitResponse';

test('deleting a run releases an inspector waiting for a missing DAP response', async () => {
  // Arrange
  const controller = new AbortController();
  const pending = awaitResponse(new Promise(() => undefined), 'stopped stack', controller.signal);
  // Act
  controller.abort();
  // Assert
  await assert.rejects(pending, /Cancelled stopped stack/);
});

test('a missing DAP response fails by its deadline and a later response cannot become success', async () => {
  // Arrange
  const response = new Promise<string>(resolve => setTimeout(() => resolve('late frame'), 15));
  const pending = awaitResponse(response, 'stopped stack', undefined, 5);
  // Act
  await assert.rejects(pending, /Timed out waiting for stopped stack/);
  await response;
  // Assert
  await assert.rejects(pending, /Timed out waiting for stopped stack/);
});
