import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { isEndpointClosed } from '../runtimeSupport/utils/isEndpointClosed';

test('an unresponsive live application listener cannot be recorded as closed', async () => {
  // Arrange
  const server = createServer(() => { /* Deliberately never respond. */ });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    // Act
    const closed = await isEndpointClosed(`http://127.0.0.1:${address.port}`, 20);

    // Assert
    assert.equal(closed, false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a refused connection verifies that the owned application listener has closed', async () => {
  // Arrange
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));

  // Act
  const closed = await isEndpointClosed(`http://127.0.0.1:${address.port}`);

  // Assert
  assert.equal(closed, true);
});

test('a listener outside loopback is never checked for closure', () => {
  // Arrange
  const origin = 'http://localhost:1';

  // Act
  const checking = () => isEndpointClosed(origin);

  // Assert
  assert.throws(checking, /loopback ownership/);
});
