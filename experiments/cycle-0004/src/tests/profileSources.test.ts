import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealFixture } from '../utils/sealFixture';
import { STUDY_PROFILES } from '../profiles';

/** Supplies two stops in each source to test sealing identity without claiming debugger execution. @example const fixture = await sourceFixture() */
async function sourceFixture(server = 'cart(); // CODEBOOK_SERVER_STOP\norder(); // CODEBOOK_ORDER_STOP\n') {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-profile-sources-'));
  const template = join(directory, 'template'), output = join(directory, 'run');
  await mkdir(join(template, 'fixture'), { recursive: true }); await mkdir(join(template, 'build'), { recursive: true });
  const files = { server, client: 'cart(); // CODEBOOK_BROWSER_STOP\nconfirm(); // CODEBOOK_CONFIRMATION_STOP\n', constants: 'export const price = 24;' };
  for (const [name, source] of Object.entries(files)) {
    await writeFile(join(template, `fixture/${name}.mts`), source);
    await writeFile(join(template, `build/${name}.mjs`), `// compiled ${name}`);
    await writeFile(join(template, `build/${name}.mjs.map`), '{}');
  }
  await writeFile(join(template, 'fixture/index.html'), 'RUN_ID SCENARIO PROFILE_ID');
  return { template, output, close: () => rm(directory, { recursive: true }) };
}

test('checkout retains distinct cart and order source lines in the same server file', async () => {
  // Arrange
  const fixture = await sourceFixture();
  try {
    // Act
    const seals = await sealFixture(fixture.template, fixture.output, 'run-1', 'normal', 'checkout-demo');
    // Assert
    assert.equal(seals.size, 4);
    assert.equal(seals.get('checkout-demo/cart-mutation')?.breakpointLine, 1);
    assert.equal(seals.get('checkout-demo/order-creation')?.breakpointLine, 2);
    assert.equal(seals.get('checkout-demo/cart-update')?.breakpointLine, 1);
    assert.equal(seals.get('checkout-demo/purchase-confirmation')?.breakpointLine, 2);
    assert.equal(seals.get('checkout-demo/cart-mutation')?.sourcePath, seals.get('checkout-demo/order-creation')?.sourcePath);
    assert.equal(await readFile(join(fixture.output, 'index.html'), 'utf8'), 'run-1 normal checkout-demo');
  } finally { await fixture.close(); }
});

test('paired source seals preserve their original two identities and ignore later checkout markers', async () => {
  // Arrange
  const fixture = await sourceFixture();
  try {
    // Act
    const seals = await sealFixture(fixture.template, fixture.output, 'run-1', 'normal');
    // Assert
    assert.deepEqual([...seals.keys()], ['paired-cart-demo/server', 'paired-cart-demo/browser']);
    assert.equal(seals.get('paired-cart-demo/server')?.breakpointLine, 1);
    assert.equal(seals.get('paired-cart-demo/browser')?.breakpointLine, 1);
  } finally { await fixture.close(); }
});

test('missing or duplicate order markers prevent a guessed source stop from being sealed', async () => {
  // Arrange
  for (const source of ['cart(); // CODEBOOK_SERVER_STOP\n', 'cart(); // CODEBOOK_SERVER_STOP\norder(); // CODEBOOK_ORDER_STOP\nagain(); // CODEBOOK_ORDER_STOP']) {
    const fixture = await sourceFixture(source);
    try {
      // Act / Assert
      await assert.rejects(sealFixture(fixture.template, fixture.output, 'run-1', 'normal', 'checkout-demo'), /exactly once: CODEBOOK_ORDER_STOP/);
    } finally { await fixture.close(); }
  }
});

test('checkout discovery fixes two actions, four distinct items and all eleven required causal links', () => {
  // Arrange
  const profile = STUDY_PROFILES['checkout-demo'];
  // Act / Assert
  assert.deepEqual(profile.actions.map(action => action.id), ['add-to-cart', 'checkout']);
  assert.deepEqual(profile.items.map(item => [item.id, item.participant]), [['checkout-demo/cart-mutation', 'server'], ['checkout-demo/cart-update', 'browser'], ['checkout-demo/order-creation', 'server'], ['checkout-demo/purchase-confirmation', 'browser']]);
  assert.equal(profile.requiredLinks.length, 11); assert.ok(profile.requiredLinks.includes('cart-result-checkout-input'));
  assert.equal(profile.capturePhases.length, 7); assert.equal(profile.limits.runTimeoutMs, 300_000);
  assert.equal(STUDY_PROFILES['paired-cart-demo'].limits.runTimeoutMs, 120_000);
});
