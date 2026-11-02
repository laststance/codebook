import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import {
  armedEntry,
  entryRenderHarness,
  type EntryRenderHarness,
} from './utils/entryRenderHarness'

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'breakpoint.other-route') */
function journaled(
  harness: Pick<EntryRenderHarness, 'run'>,
  type: string,
): unknown[] {
  return harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))
}

/** Waits until the run published a server pause. @example const pause = await publishedPause(harness) */
function publishedPause(harness: Pick<EntryRenderHarness, 'run'>) {
  return waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'the published server pause')
}

/** Waits until the server participant received this many resumes. @example await resumesReceived(harness, 1) */
function resumesReceived(harness: EntryRenderHarness, count: number) {
  return waitUntil(
    () => harness.server!.continues.length >= count,
    `${count} resume(s) of the server`,
  )
}

// Value: protects=M2 (entry load, unreadable route before the main frame committed): the hit pauses unconfirmed instead of being resumed away; fails_when=the stop is resumed as breakpoint.unattributed-resumed while the navigation is still unanswered; no_claim=a real Chrome's commit timing
test('an unreadable route before the entry document commits pauses unconfirmed', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context, {
    holdNavigation: true,
    serverRuntime: { route: null },
  })
  harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // Act
  harness.server!.hit({ route: null })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'unconfirmed')
  assert.deepEqual(journaled(harness, 'breakpoint.unattributed-resumed'), [])
})

// Value: protects=D18 harness: a hit whose own route is unreadable takes the unreadable-route path although the default route is /dashboard; fails_when=the hit reads as /dashboard and is published entry-load; no_claim=a real work store
test('a hit with an unreadable route takes the unreadable-route path while the default route is the entry route', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // Act
  harness.server!.hit({ route: null })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'unconfirmed')
})

// Value: protects=M3: the route read leaves no abort listener behind on the run's signal; fails_when=the listener count grows with every classified hit; no_claim=the warning text Node prints
test('classifying many hits leaves the abort listeners of the run flat', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  const { signal } = (harness.run as unknown as { abort: AbortController })
    .abort
  harness.server!.hit({ route: '/dashboard/invoices' })
  await resumesReceived(harness, 1)
  const before = getEventListeners(signal, 'abort').length
  // Act
  for (let hit = 2; hit <= 12; hit++) {
    harness.server!.hit({ route: '/dashboard/invoices' })
    await resumesReceived(harness, hit)
  }
  // Assert
  assert.equal(getEventListeners(signal, 'abort').length, before)
})

// Value: protects=M8: a manifest that cannot be read on one hit is read again on a later hit; fails_when=the entry route's hit is resumed as unattributed for the rest of the run; no_claim=how Next writes the manifest
test('an app paths manifest missing at the first hit is read again at a later hit', async (context) => {
  // Arrange
  const harness = await entryRenderHarness(context)
  harness.run.prepare().catch(() => undefined)
  await armedEntry(harness)
  // The run's workspace holds the compiled manifest the harness wrote.
  const { workspace } = (
    harness.run as unknown as { options: { workspace: string } }
  ).options
  const manifest = join(workspace, '.next/dev/server/app-paths-manifest.json')
  const content = await readFile(manifest, 'utf8')
  await rm(manifest)
  harness.server!.hit({ route: '/dashboard/invoices' })
  await resumesReceived(harness, 1)
  // Act
  await writeFile(manifest, content)
  harness.server!.hit({ route: '/dashboard' })
  const pause = await publishedPause(harness)
  // Assert
  assert.equal(pause.attribution, 'entry-load')
})

/** Opens a run with entry-render stops A and B of one component file. @example await twoStopRun(context) */
async function twoStopRun(context: TestContext) {
  const abort = new AbortController()
  context.after(() => abort.abort())
  const harness = await configuredRuntimeHarness(
    context,
    {
      signal: abort.signal,
      deadlineAt: Date.now() + 300_000,
      preparationDeadlineAt: Date.now() + 300_000,
      runId: 'service-run-71',
    },
    [
      {
        line: 3,
        column: 1,
        inspections: [{ path: 'enabled', mode: 'value', required: true }],
      },
    ],
    {
      participant: 'server',
      serverSeal: 'rsc',
      serverRuntime: { route: '/dashboard/invoices' },
      entryPath: '/dashboard/invoices',
      documentReadyState: 'loading',
      mappings: 'AAAA;AACA;AACA',
      fixture: {
        source:
          'var nextTheme = "dark";\nvar between = 1;\nvar enabled = false;\n',
        citationEndLine: 3,
      },
      operations: {
        operations: [],
        stopOperations: [0, 0],
        stopParticipants: ['server', 'server'],
      },
    },
  )
  harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.navigations.length === 1,
    'the entry navigation started',
  )
  return harness
}

// Value: protects=Codex P2 (copy ownership): a copy hit on the owned line but another column is no react-copy and is not auto-resumed; fails_when=the pause at column 10 is resumed and journaled breakpoint.react-copy; no_claim=what the run does with the pause afterwards
test('a copy hit on the same line at another column is not resumed as a react copy', async (context) => {
  // Arrange
  const harness = await twoStopRun(context)
  harness.server!.hit({})
  const stopA = await publishedPause(harness)
  await harness.run.continue('server', stopA.pause)
  await waitUntil(() => harness.server!.continues.length >= 1, 'A resumed')
  // Act
  harness.server!.announceReactCopy('3672', 109)
  harness.server!.hit({
    scriptId: '3672',
    generated: { line: 2, column: 0 },
    source: { line: 3, column: 10 },
  })
  await sleep(300)
  // Assert
  assert.deepEqual(journaled(harness, 'breakpoint.react-copy'), [])
  assert.equal(harness.server!.continues.length, 1)
})
