import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeTestConfigSchema } from '../nodeTestConfigSchemas';
import { prepareNodeTestLaunch } from '../utils/prepareNodeTestLaunch';

test('a local Vitest test launches with the checked source and no shell interpreter', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-node-test-'));
  const source = 'export function subscribe() { return true }\n';
  const testText = 'import { subscribe } from "./subscribable"\n';
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true });
  await writeFile(join(root, 'src', 'subscribable.ts'), source);
  await writeFile(join(root, 'src', 'subscribable.test.ts'), testText);
  await writeFile(join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'export {}\n');
  const configuration = nodeTestConfigSchema.parse({ version: 1, adapter: 'vitest-node',
    book: { bookId: 'subscription', revision: 1, nodeId: 'subscribe', anchorIndex: 0 },
    testFile: 'src/subscribable.test.ts', testName: 'subscribes once',
    testHash: createHash('sha256').update(testText).digest('hex'),
    source: { path: 'src/subscribable.ts', hash: createHash('sha256').update(source).digest('hex'), line: 1, column: 1 },
    inspections: [{ path: 'listener', mode: 'value', required: true }] });
  try {
    // Act
    const launch = await prepareNodeTestLaunch(root, configuration);
    // Assert
    const canonicalRoot = await realpath(root);
    assert.equal(launch.program, join(canonicalRoot, 'node_modules', 'vitest', 'vitest.mjs'));
    assert.deepEqual(launch.args, ['run', 'src/subscribable.test.ts', '--inspect-brk', '--no-file-parallelism', '--testTimeout=600000', '--testNamePattern', 'subscribes once']);
    assert.equal(launch.sourceFile, join(canonicalRoot, 'src', 'subscribable.ts'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a changed source or a symlink escaping the repository cannot start a Node test', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-node-test-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'codebook-node-test-outside-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true });
  await writeFile(join(root, 'src', 'subscribable.ts'), 'changed source\n');
  await writeFile(join(outside, 'subscribable.test.ts'), 'outside test\n');
  await symlink(join(outside, 'subscribable.test.ts'), join(root, 'src', 'subscribable.test.ts'));
  await writeFile(join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'export {}\n');
  const configuration = nodeTestConfigSchema.parse({ version: 1, adapter: 'vitest-node',
    book: { bookId: 'subscription', revision: 1, nodeId: 'subscribe', anchorIndex: 0 },
    testFile: 'src/subscribable.test.ts', testHash: '0'.repeat(64),
    source: { path: 'src/subscribable.ts', hash: '0'.repeat(64), line: 1, column: 1 },
    inspections: [{ path: 'listener', mode: 'value', required: true }] });
  try {
    // Act / Assert
    await assert.rejects(prepareNodeTestLaunch(root, configuration), /not a file in the opened repository/);
    await rm(join(root, 'src', 'subscribable.test.ts'));
    await writeFile(join(root, 'src', 'subscribable.test.ts'), 'local test\n');
    await assert.rejects(prepareNodeTestLaunch(root, configuration), /source changed/);
    await assert.rejects(prepareNodeTestLaunch(root, { ...configuration, source: { ...configuration.source,
      hash: createHash('sha256').update('changed source\n').digest('hex') } }), /test file changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('a Node test seals every declared source stop before acquiring a process', async () => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-node-multiple-stops-'));
  const source = 'export const first = 1\nexport const second = 2\n';
  const testText = 'test("two stops", () => undefined)\n';
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true });
  await writeFile(join(root, 'src', 'target.ts'), source);
  await writeFile(join(root, 'src', 'target.test.ts'), testText);
  await writeFile(join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'export {}\n');
  const hash = createHash('sha256').update(source).digest('hex');
  const configuration = nodeTestConfigSchema.parse({ version: 1, adapter: 'vitest-node',
    book: { bookId: 'subscription', revision: 1, nodeId: 'subscribe', anchorIndex: 0 },
    testFile: 'src/target.test.ts', testHash: createHash('sha256').update(testText).digest('hex'),
    source: { path: 'src/target.ts', hash, line: 1, column: 1 },
    inspections: [{ path: 'listener', mode: 'value', required: true }],
    additionalStops: [{ path: 'src/target.ts', hash, line: 2, column: 1,
      anchorIndex: 0, inspections: [{ path: 'listener', mode: 'value', required: true }] }] });
  try {
    // Act
    const launch = await prepareNodeTestLaunch(root, configuration);
    // Assert
    assert.deepEqual(launch.stops.map(stop => [stop.source.line, stop.source.column]), [[1, 1], [2, 1]]);
    await assert.rejects(prepareNodeTestLaunch(root, { ...configuration, additionalStops: [{ ...configuration.additionalStops![0]!, hash: '0'.repeat(64) }] }), /source changed; declared stop 2/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
