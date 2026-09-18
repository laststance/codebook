import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { studyArchiveSchema as legacyArchiveSchema, progressSchema as legacyProgressSchema } from '../legacyStudySchemas';
import { decodeStudyArchive } from '../utils/decodeStudyArchive';
import { decodeLearnerProgress } from '../utils/decodeLearnerProgress';

const fixtureDirectory = resolve(__dirname, '../../src/tests/fixtures/cycle-0006-legacy');
const workspaceKey = '67bf38abd3f309bf29b1eed73e4f3ea88863995c0f207b70a50eec48d36f8743';

test('a real Cycle 0006 archive gains paired item identities without changing its captured bytes or original file', async () => {
  // Arrange
  const path = resolve(fixtureDirectory, 'study.v1.json'), bytes = await readFile(path);
  const original = legacyArchiveSchema.parse(JSON.parse(bytes.toString())), before = JSON.stringify(original);
  // Act
  const study = decodeStudyArchive(original, workspaceKey);
  // Assert
  assert.equal(sha256(bytes), '46da21735d8e86a0b6a3cfd05ad9437142360b0530f2996502737621570c7c57');
  assert.equal(study.version, 2); assert.equal(study.profile, 'paired-cart-demo');
  assert.deepEqual(study.observations.map(observation => observation.itemId), ['paired-cart-demo/server', 'paired-cart-demo/browser']);
  assert.deepEqual(study.observations.map(observation => observation.capturePhase), ['paused-server', 'paused-browser']);
  assert.equal(study.observations[0]?.values.productId, 'tote-01'); assert.equal(study.observations[0]?.values.cartCount, 0);
  assert.equal(study.observations[1]?.values.cartCount, 1);
  assert.deepEqual(study.captures, original.captures); assert.deepEqual(study.observations.map(observation => observation.source), original.observations.map(observation => observation.source));
  assert.equal(JSON.stringify(original), before); assert.deepEqual(await readFile(path), bytes);
});

test('legacy understanding stays in the paired profile and preserves the exact decision identity and source revision', async () => {
  // Arrange
  const path = resolve(fixtureDirectory, 'progress.v1.json'), bytes = await readFile(path);
  const original = legacyProgressSchema.parse(JSON.parse(bytes.toString())), before = JSON.stringify(original);
  // Act
  const progress = decodeLearnerProgress(original, workspaceKey);
  // Assert
  assert.equal(sha256(bytes), '4cd64d619cb165a2e6d4b68a4f5be32c21ea50cb06df4d89f9633dde3a81038b');
  assert.equal(progress.version, 2);
  assert.deepEqual(progress.decisions, [{ id: '2873e41e-7878-422e-af27-da5f40334558', item: 'paired-cart-demo/server', sourceHash: 'd31e34bc5c3745317afabd5721819d959de090497e58cfd49df759134d59d8f2', understood: true, at: '2026-09-18T20:56:35.947Z' }]);
  assert.equal(progress.selection?.profile, 'paired-cart-demo'); assert.equal(progress.selection?.itemId, 'paired-cart-demo/server'); assert.equal(progress.selection?.follow, false);
  assert.equal(progress.decisions.some(decision => decision.item.startsWith('checkout-demo/')), false);
  assert.equal(JSON.stringify(original), before); assert.deepEqual(await readFile(path), bytes);
});

test('version 1 remains a strict historical format and cannot smuggle new profile identities or facts into migration', async () => {
  // Arrange
  const study = legacyArchiveSchema.parse(JSON.parse(await readFile(resolve(fixtureDirectory, 'study.v1.json'), 'utf8')));
  const progress = legacyProgressSchema.parse(JSON.parse(await readFile(resolve(fixtureDirectory, 'progress.v1.json'), 'utf8')));
  // Act / Assert
  assert.throws(() => decodeStudyArchive({ ...study, profile: 'checkout-demo' }, workspaceKey));
  assert.throws(() => decodeStudyArchive({ ...study, observations: study.observations.map(observation => ({ ...observation, itemId: 'checkout-demo/order-creation' })) }, workspaceKey));
  assert.throws(() => decodeStudyArchive({ ...study, observations: study.observations.map(observation => ({ ...observation, values: { ...observation.values, orderCount: 1 } })) }, workspaceKey));
  assert.throws(() => decodeLearnerProgress({ ...progress, decisions: progress.decisions.map(decision => ({ ...decision, item: 'checkout-demo/order-creation' })) }, workspaceKey));
  assert.throws(() => decodeLearnerProgress({ ...progress, version: 3 }, workspaceKey));
});

test('normalized history rejects duplicate items, cross-profile labels, altered source and unsupported interpretation facts', async () => {
  // Arrange
  const study = decodeStudyArchive(JSON.parse(await readFile(resolve(fixtureDirectory, 'study.v1.json'), 'utf8')), workspaceKey);
  const first = study.observations[0]!;
  // Act / Assert
  assert.throws(() => decodeStudyArchive({ ...study, observations: [first, first] }, workspaceKey), /duplicate observation/);
  assert.throws(() => decodeStudyArchive({ ...study, observations: [{ ...first, itemId: 'checkout-demo/cart-mutation' }] }, workspaceKey), /learning item/);
  assert.throws(() => decodeStudyArchive({ ...study, observations: [{ ...first, source: { ...first.source, text: 'changed' } }] }, workspaceKey), /source.*changed/);
  assert.throws(() => decodeStudyArchive({ ...study, observations: [{ ...first, interpretations: [{ id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-09-18T20:56:35.947Z', text: 'Invalid claim', facts: [{ path: 'orderCount', value: 1 }] }] }] }, workspaceKey), /facts differ/);
  assert.throws(() => decodeStudyArchive({ ...study, captures: [{ phase: 'paused-order-creation', status: 'absent', reason: 'Wrong item' }] }, workspaceKey), /foreign image/);
  assert.throws(() => decodeStudyArchive({ ...study, links: [{ id: 'checkout-server-mutation', status: 'observed' }] }, workspaceKey), /foreign causal link/);
});
