import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Protocol } from 'devtools-protocol';
import { NetworkEvidence } from '../networkEvidence';

const url = 'http://127.0.0.1:5000/runs/run/api/cart';
const clientUrl = 'http://127.0.0.1:5000/runs/run/client.mjs';

/** Makes an explicit protocol event for correlation tests without mocking the decision code. @example request('foreground', 'run', 'selected') */
function request(requestId: string, operationId: string, cartId: string): Protocol.Network.RequestWillBeSentEvent {
  return { requestId, loaderId: 'page', documentURL: url, timestamp: 1, wallTime: 1, initiator: { type: 'script', stack: { callFrames: [{ functionName: 'requestCart', scriptId: 'client', url: clientUrl, lineNumber: 10, columnNumber: 1 }] } }, redirectHasExtraInfo: false,
    request: { url, method: 'POST', headers: { 'x-codebook-operation': operationId }, postData: JSON.stringify({ cartId, productId: cartId === 'selected' ? 'tote-01' : 'background-02', price: cartId === 'selected' ? 24 : 99 }), initialPriority: 'High', referrerPolicy: 'no-referrer' } };
}

/** Completes one retained fixture response for tests, leaving candidate-set closure to the actual reducer. @example finish(network, 'foreground', 'run', 'selected') */
function finish(network: NetworkEvidence, requestId: string, operationId: string, cartId: string, overrides: Partial<Protocol.Network.Response> = {}): void {
  network.response({ requestId, loaderId: 'page', timestamp: 2, type: 'Fetch', hasExtraInfo: false, response: { url, status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json', charset: 'utf-8', connectionReused: false, connectionId: 1, encodedDataLength: 100, securityState: 'neutral', ...overrides } });
  network.finished(requestId, 4);
  network.body(requestId, { base64Encoded: false, body: JSON.stringify({ operationId, cartId, productId: cartId === 'selected' ? 'tote-01' : 'background-02', price: cartId === 'selected' ? 24 : 99, cartCount: 1, admittedCount: 2 }) });
}

test('a complete selected response cannot certify success before the late background request is observed', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl); network.request(request('selected', 'run', 'selected'), 1);
  // Act
  finish(network, 'selected', 'run', 'selected'); const early = network.settled();
  network.request(request('background', 'run-background', 'background'), 5); finish(network, 'background', 'run-background', 'background'); network.closeSet();
  // Assert
  assert.equal(early, undefined); assert.equal(network.closed, true); assert.equal(network.settled()?.selected.body?.cartCount, 1); assert.deepEqual(network.errors, []);
});

test('both legal request and response arrival orders produce the same selected chain', () => {
  // Arrange
  for (const requestOrder of [false, true]) for (const responseOrder of [false, true]) {
    const network = new NetworkEvidence('run', url, clientUrl);
    const participants = [{ id: 'selected', operation: 'run', cart: 'selected' }, { id: 'background', operation: 'run-background', cart: 'background' }];
    // Act
    for (const participant of requestOrder ? [...participants].reverse() : participants) network.request(request(participant.id, participant.operation, participant.cart), 1);
    for (const participant of responseOrder ? [...participants].reverse() : participants) finish(network, participant.id, participant.operation, participant.cart);
    // Assert
    assert.equal(network.settled()?.selected.requestId, 'selected'); assert.equal(network.settled()?.background.requestId, 'background'); assert.deepEqual(network.errors, []);
  }
});

test('two requests sharing an operation identity remain ambiguous even when their carts differ', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl);
  // Act
  network.request(request('one', 'run', 'selected'), 1); network.request(request('two', 'run', 'background'), 2);
  // Assert
  assert.match(network.errors.join(' '), /Ambiguous duplicate/); assert.equal(network.settled(), undefined);
});

test('a redirected HTTP hop cannot reuse an earlier request identity as successful evidence', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl); const event = request('one', 'run', 'selected'); network.request(event, 1);
  // Act
  network.request({ ...event, request: { ...event.request, url: `${url}/redirected` } }, 2);
  // Assert
  assert.match(network.errors.join(' '), /reused HTTP request ID/); assert.equal(network.settled(), undefined);
});

test('cached and service-worker responses never certify the direct fixture request boundary', () => {
  // Arrange
  for (const override of [{ fromDiskCache: true }, { fromServiceWorker: true }, { fromPrefetchCache: true }]) {
    const network = new NetworkEvidence('run', url, clientUrl); network.request(request('selected', 'run', 'selected'), 1);
    // Act
    finish(network, 'selected', 'run', 'selected', override);
    // Assert
    assert.match(network.errors.join(' '), /Unsupported cached, worker/); assert.equal(network.settled(), undefined);
  }
});

test('missing identity, absent initiator and oversized request data stay explicit failures', () => {
  // Arrange
  const cases = [request('one', '', 'selected'), { ...request('one', 'run', 'selected'), initiator: { type: 'other' } satisfies Protocol.Network.Initiator }, { ...request('one', 'run', 'selected'), request: { ...request('one', 'run', 'selected').request, postData: 'x'.repeat(65_537) } }];
  // Act / Assert
  for (const event of cases) { const network = new NetworkEvidence('run', url, clientUrl); network.request(event, 1); assert.equal(network.errors.length, 1); assert.equal(network.settled(), undefined); }
});

test('missing transport completion, malformed base64 and oversized responses cannot supply snapshot values', () => {
  // Arrange
  for (const [finished, body, base64Encoded] of [[false, '{}', false], [true, '!!!', true], [true, 'x'.repeat(65_537), false]] satisfies [boolean, string, boolean][]) {
    const network = new NetworkEvidence('run', url, clientUrl); network.request(request('one', 'run', 'selected'), 1);
    // Act
    if (finished) network.finished('one', 2); network.body('one', { body, base64Encoded });
    // Assert
    assert.equal(network.errors.length, 1); assert.equal(network.requests.get('one')?.body, undefined); assert.equal(network.settled(), undefined);
  }
});

test('a late third request invalidates a previously closed candidate instead of being ignored', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl);
  network.request(request('selected', 'run', 'selected'), 1); network.request(request('background', 'run-background', 'background'), 2);
  finish(network, 'selected', 'run', 'selected'); finish(network, 'background', 'run-background', 'background'); network.closeSet();
  // Act
  network.request(request('late', 'run', 'selected'), 8);
  // Assert
  assert.match(network.errors.join(' '), /after the expected observation set closed/); assert.equal(network.settled(), undefined);
});

test('a response with a different operation identity cannot masquerade as the selected result', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl); network.request(request('selected', 'run', 'selected'), 1); network.request(request('background', 'run-background', 'background'), 2);
  // Act
  finish(network, 'selected', 'other', 'selected'); finish(network, 'background', 'run-background', 'background');
  // Assert
  assert.equal(network.settled(), undefined); assert.match(network.errors.join(' '), /Response identity or values/);
});
