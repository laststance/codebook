import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sealFixture } from '../utils/sealFixture';
import { readBackendEndpoint } from '../utils/readBackendEndpoint';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';

test('one real fixture process creates each order from its previously admitted cart', async () => {
  // Arrange: actual Node HTTP fixture, without a debugger or native UI claim.
  const directory = await mkdtemp(join(tmpdir(), 'codebook-checkout-fixture-'));
  await sealFixture(resolve(__dirname, '../..'), directory, 'fixture-run', 'normal', 'checkout-demo');
  const server = spawn(process.execPath, [join(directory, 'build/server.mjs')], { stdio: 'ignore' });
  const exited = once(server, 'exit');
  try {
    const endpoint = await waitUntil(() => readBackendEndpoint(directory, 'fixture-run'), 'fixture listener');
    const post = (action: string, operationId: string, body: object) => fetch(`${endpoint.origin}/runs/fixture-run/api/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-codebook-operation': operationId }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
    const selectedCart = { cartId: 'selected', productId: 'tote-01', price: 24 };
    const backgroundCart = { cartId: 'background', productId: 'background-02', price: 99 };
    // Act: reverse the second action's order; admissions are per action and state is retained.
    const cartResponses = await Promise.all([post('cart', 'fixture-run', selectedCart), post('cart', 'fixture-run-background', backgroundCart)]);
    const cartBodies = await Promise.all(cartResponses.map(response => response.json()));
    const orderResponses = await Promise.all([post('checkout', 'fixture-run-checkout-background', { ...backgroundCart, cartOperationId: 'fixture-run-background' }), post('checkout', 'fixture-run-checkout', { ...selectedCart, cartOperationId: 'fixture-run' })]);
    const orderBodies = await Promise.all(orderResponses.map(response => response.json()));
    const duplicate = await post('checkout', 'duplicate', { ...selectedCart, cartOperationId: 'fixture-run' });
    // Assert
    assert.deepEqual(cartBodies, [
      { operationId: 'fixture-run', cartId: 'selected', productId: 'tote-01', price: 24, cartCount: 1, admittedCount: 2 },
      { operationId: 'fixture-run-background', cartId: 'background', productId: 'background-02', price: 99, cartCount: 1, admittedCount: 2 },
    ]);
    assert.deepEqual(orderResponses.map(response => response.status), [200, 200]);
    assert.deepEqual(orderBodies, [
      { operationId: 'fixture-run-checkout-background', cartId: 'background', productId: 'background-02', price: 99, cartOperationId: 'fixture-run-background', cartCount: 1, admittedCount: 2, orderId: 'order-fixture-run-background', total: 99, orderCount: 1 },
      { operationId: 'fixture-run-checkout', cartId: 'selected', productId: 'tote-01', price: 24, cartOperationId: 'fixture-run', cartCount: 1, admittedCount: 2, orderId: 'order-fixture-run', total: 24, orderCount: 1 },
    ]);
    assert.equal(duplicate.status, 500); assert.match(await duplicate.text(), /one unpurchased cart/);
  } finally { server.kill(); await exited; await rm(directory, { recursive: true }); }
});
