import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { assertDevelopmentWorkspace } from '../utils/assertDevelopmentWorkspace'

import { createHarness } from './helpers'

/** Writes a file, creating its folders. */
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/**
 * Builds the harness whose environment reports the root's Next readiness as the real window does: shared prerequisites ready, the repository-browser profile judged at the repository root.
 * @example const harness = await rootJudgedHarness()
 */
async function rootJudgedHarness() {
  const holder: { directory?: string } = {}
  const harness = await createHarness({
    prerequisites: async () => {
      const gaps = await assertDevelopmentWorkspace(
        holder.directory!,
        new AbortController().signal,
      ).then(
        () => [],
        (error: unknown) => [String(error)],
      )
      return {
        ready: true,
        missing: [],
        profiles: {
          'repository-browser': { ready: gaps.length === 0, missing: gaps },
        },
      }
    },
  })
  holder.directory = harness.directory
  return harness
}

/** Starts a version 3 run, optionally with a packageRoot, and waits for its preparation. */
async function startRun(
  harness: Awaited<ReturnType<typeof rootJudgedHarness>>,
  key: string,
  packageRoot?: string,
) {
  const reference = harness.configuration
  const { service } = harness
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key,
    configuration: {
      version: 3,
      adapter: 'next-dev-webpack',
      book: reference.book,
      source: reference.source,
      participant: 'browser',
      afterOperation: 1,
      before: reference.action.before,
      after: reference.action.after,
      operations: [{ kind: 'click', title: 'Toggle', selector: '#toggle' }],
      inspections: reference.inspections,
      ...(packageRoot === undefined ? {} : { packageRoot }),
    },
  })
  const record = service.record(receipt)
  await record.preparation
  return { receipt, record, state: service.state(record) }
}

/** Installs a ready nested Next app below the repository. */
async function installNestedApp(directory: string): Promise<void> {
  const app = join(directory, 'examples/web')
  await put(
    join(app, 'package.json'),
    '{"name":"web","dependencies":{"next":"16.4.3"}}',
  )
  await put(
    join(app, 'node_modules/next/package.json'),
    '{"name":"next","version":"16.4.3"}',
  )
  await put(join(app, 'node_modules/next/dist/bin/next'), '')
}

// protects=E1: a ready nested package starts although the root has no Next; fails_when=the start is judged by the root's readiness; no_claim=the real launch
test('a start for a ready nested Next package is admitted when the root has no Next', async (context) => {
  // Arrange
  const harness = await rootJudgedHarness()
  context.after(() => harness.close())
  await installNestedApp(harness.directory)
  // Act
  const { state } = await startRun(harness, 'nested', 'examples/web')
  // Assert
  assert.equal(state.error, undefined)
  assert.equal(harness.runtimes.length, 1)
})

// protects=E1: an unrelated lock at the root does not block a nested start; fails_when=the root's .next/dev/lock refuses the nested package; no_claim=a lock inside the package (a run never reuses one)
test('an unrelated root .next/dev/lock does not block a nested start', async (context) => {
  // Arrange
  const harness = await rootJudgedHarness()
  context.after(() => harness.close())
  await installNestedApp(harness.directory)
  await put(join(harness.directory, 'node_modules/next/dist/bin/next'), '')
  await put(join(harness.directory, '.next/dev/lock'), '')
  // Act
  const { state } = await startRun(harness, 'nested-lock', 'examples/web')
  // Assert
  assert.equal(state.error, undefined)
  assert.equal(harness.runtimes.length, 1)
})

// protects=E1/AC 3: an invalid packageRoot is refused INVALID_CONFIGURATION before the root's missing Next is read; fails_when=the root's install sentence wins; no_claim=other refusal rows (resolver tests)
test('an invalid packageRoot is refused INVALID_CONFIGURATION first when the root has no Next', async (context) => {
  // Arrange
  const harness = await rootJudgedHarness()
  context.after(() => harness.close())
  // Act
  const { state } = await startRun(harness, 'invalid', 'does/not/exist')
  // Assert
  assert.equal(state.error?.code, 'INVALID_CONFIGURATION')
  assert.equal(harness.runtimes.length, 0)
})

// protects=AC 6: a start without packageRoot is still judged by the root; fails_when=the nested preflight swallows root runs; no_claim=the root run's launch
test('a start without packageRoot is still refused by the root without Next', async (context) => {
  // Arrange
  const harness = await rootJudgedHarness()
  context.after(() => harness.close())
  await installNestedApp(harness.directory)
  // Act
  const { state } = await startRun(harness, 'root')
  // Assert
  assert.equal(state.error?.code, 'PREREQUISITE_MISSING')
  assert.equal(harness.runtimes.length, 0)
})

// protects=E10: absent and "." packageRoot are one start for the idempotency key; fails_when=a "." start with the same key conflicts with the absent one; no_claim=nested values
test('a repeated start with packageRoot "." answers the receipt of the start without it', async (context) => {
  // Arrange
  const harness = await rootJudgedHarness()
  context.after(() => harness.close())
  await put(join(harness.directory, 'node_modules/next/dist/bin/next'), '')
  const first = await startRun(harness, 'same-key')
  // Act
  const second = await startRun(harness, 'same-key', '.')
  // Assert
  assert.equal(second.receipt.runId, first.receipt.runId)
})
