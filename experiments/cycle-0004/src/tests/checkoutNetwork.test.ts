import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Protocol } from 'devtools-protocol';
import { NetworkEvidence } from '../networkEvidence';

const url = 'http://127.0.0.1:5000/runs/run/api/checkout';
const clientUrl = 'http://127.0.0.1:5000/runs/run/client.mjs';
const selected = { operationId: 'run-checkout', cartId: 'selected', productId: 'tote-01', price: 24, cartOperationId: 'run', cartCount: 1, admittedCount: 2, orderId: 'order-run', total: 24, orderCount: 1 };
const background = { operationId: 'run-checkout-background', cartId: 'background', productId: 'background-02', price: 99, cartOperationId: 'run-background', cartCount: 1, admittedCount: 2, orderId: 'order-run-background', total: 99, orderCount: 1 };

/** Supplies explicit fixture traffic to the real reducer, called by checkout correspondence tests. @example observe(network, 'selected', selected) */
function observe(network: NetworkEvidence, requestId: string, tuple: typeof selected): void {
  network.request({ requestId, loaderId: 'page', documentURL: url, timestamp: 1, wallTime: 1, redirectHasExtraInfo: false,
    initiator: { type: 'script', stack: { callFrames: [{ functionName: 'requestCheckout', scriptId: 'client', url: clientUrl, lineNumber: 40, columnNumber: 1 }] } },
    request: { url, method: 'POST', headers: { 'x-codebook-operation': tuple.operationId }, postData: JSON.stringify({ cartId: tuple.cartId, productId: tuple.productId, price: tuple.price, cartOperationId: tuple.cartOperationId }), initialPriority: 'High', referrerPolicy: 'no-referrer' } }, 1);
}

/** Completes actual response fields supplied by a test, without using the implementation's expectations. @example complete(network, 'selected', selected) */
function complete(network: NetworkEvidence, requestId: string, body: unknown): void {
  const response: Protocol.Network.Response = { url, status: 200, statusText: 'OK', headers: {}, mimeType: 'application/json', charset: 'utf-8', connectionReused: false, connectionId: 1, encodedDataLength: 100, securityState: 'neutral' };
  network.response({ requestId, loaderId: 'page', timestamp: 2, type: 'Fetch', hasExtraInfo: false, response });
  network.finished(requestId, 3); network.body(requestId, { body: JSON.stringify(body), base64Encoded: false });
}

test('checkout correspondence preserves selected and background orders in either arrival order', () => {
  // Arrange
  for (const reverseRequests of [false, true]) for (const reverseResponses of [false, true]) {
    const network = new NetworkEvidence('run', url, clientUrl, 'checkout');
    const requests = [['selected', selected], ['background', background]] satisfies [string, typeof selected][];
    // Act
    for (const [requestId, tuple] of reverseRequests ? [...requests].reverse() : requests) observe(network, requestId, tuple);
    for (const [requestId, tuple] of reverseResponses ? [...requests].reverse() : requests) complete(network, requestId, tuple);
    network.closeSet();
    // Assert
    assert.deepEqual(network.settled()?.selected.body, selected); assert.deepEqual(network.settled()?.background.body, background);
    assert.equal(network.closed, true); assert.deepEqual(network.errors, []);
  }
});

test('checkout with another cart operation cannot establish the cross-action link', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl, 'checkout');
  // Act
  observe(network, 'selected', { ...selected, cartOperationId: 'other-run' }); observe(network, 'background', background);
  complete(network, 'selected', selected); complete(network, 'background', background);
  // Assert
  assert.equal(network.settled(), undefined); assert.match(network.errors.join(' '), /Request tuple differs/);
});

test('mixed order facts and whole-run admission counts cannot certify purchase confirmation', () => {
  // Arrange
  for (const invalid of [{ ...selected, total: 99 }, { ...selected, orderId: 'order-run-background' }, { ...selected, cartOperationId: 'run-background' }, { ...selected, admittedCount: 4 }, { ...selected, orderCount: 2 }]) {
    const network = new NetworkEvidence('run', url, clientUrl, 'checkout');
    observe(network, 'selected', selected); observe(network, 'background', background);
    // Act
    complete(network, 'selected', invalid); complete(network, 'background', background);
    // Assert
    assert.equal(network.settled(), undefined); assert.match(network.errors.join(' '), /Response identity or values/);
  }
});

test('a late checkout request revokes an already closed order observation set', () => {
  // Arrange
  const network = new NetworkEvidence('run', url, clientUrl, 'checkout');
  observe(network, 'selected', selected); observe(network, 'background', background);
  complete(network, 'selected', selected); complete(network, 'background', background); network.closeSet();
  // Act
  observe(network, 'late', selected);
  // Assert
  assert.equal(network.settled(), undefined); assert.match(network.errors.join(' '), /after the expected observation set closed/);
});
