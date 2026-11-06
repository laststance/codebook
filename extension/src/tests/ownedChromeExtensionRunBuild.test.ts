import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { ExtensionSource } from '../extensionSource'
import { createExtensionBuildError } from '../utils/createExtensionBuildError'
import { describeChromeExtensionViewStatus } from '../utils/describeChromeExtensionStatus'

import {
  createRunHarness,
  manualClock,
  resolvedHarnessRun,
} from './utils/chromeExtensionRunHarness'
import { defer } from './utils/defer'

const WXT_CONFIGURATION = {
  adapter: 'wxt-build',
  extensionRoot: 'extension',
  surface: { kind: 'page', path: 'popup.html' },
  clicks: [{ title: 'Open dialog', selector: '#open' }],
  stops: [],
  seed: {},
  observe: { kind: 'text', selector: '#result' },
  acknowledgedPermissions: [],
} as never

const BUILD_FACTS = {
  tool: 'wxt',
  version: '0.21.4',
  durationMs: 95_000,
} as const

/** A source as the build step hands it back; the harness's resolver ignores its stop rules. */
const BUILT_SOURCE: ExtensionSource = {
  adapter: 'wxt-build',
  repositoryRoot: '/repo',
  projectRoot: '/repo/extension',
  loadRoot: '/tmp/run/wxt-build/chrome-mv3-dev',
  build: BUILD_FACTS,
  resolveStop: async () => {
    throw new Error('not used by the run')
  },
}

/**
 * A build step a test holds open and ends by hand, as the product's does after the real WXT build.
 * @returns The `prepareSource` dependency, the handle that ends the build with a source or an error, the signals it was given and a count of disposals.
 */
function controlledBuild() {
  const gate = defer<ExtensionSource>()
  const state = {
    signal: undefined as AbortSignal | undefined,
    disposed: 0,
    versionsTold: [] as (string | undefined)[],
  }
  return {
    gate,
    state,
    prepareSource: async (request: {
      signal: AbortSignal
      onBuilding(wxtVersion: string | undefined): void
    }) => {
      state.signal = request.signal
      request.onBuilding('0.21.4')
      state.versionsTold.push('0.21.4')
      const source = await gate.promise
      return {
        source,
        dispose: async (): Promise<void> => {
          state.disposed += 1
        },
      }
    },
  }
}

/** Runs microtasks and timers once so the run's steps advance. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++)
    await new Promise((resolve) => setImmediate(resolve))
}

// protects=a slow build never ends as a preparation failure: the 90 s setup bound is armed only after the build, the 10-minute run bound already covers the build; fails_when=the setup bound is armed before the build (a 95 s build would end the run) or never armed after it; no_claim=real 95 s (a manual clock fires the bounds)
test('the 90 s setup bound starts after a 95 s build and not before it', async () => {
  // Arrange
  const timers = manualClock()
  const build = controlledBuild()
  const launch = defer<void>()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    clock: timers.clock,
    prepareSource: build.prepareSource,
    launchGate: launch.promise,
    timings: { runMs: 600_000, setupMs: 90_000 },
    resolved: resolvedHarnessRun({ build: BUILD_FACTS }),
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()
  // Act
  const delaysWhileBuilding = timers.pendingDelays()
  timers.fire(90_000)
  await settle()
  const phaseAfterSetupFiredWhileBuilding = harness.run.view().phase
  build.gate.resolve(BUILT_SOURCE)
  await settle()
  const delaysAfterBuild = timers.pendingDelays()
  timers.fire(90_000)
  launch.resolve()
  const failure = await preparing
  // Assert
  assert.deepEqual(delaysWhileBuilding, [600_000])
  assert.equal(phaseAfterSetupFiredWhileBuilding, 'building')
  assert.deepEqual(
    delaysAfterBuild.sort((first, second) => first - second),
    [90_000, 600_000],
  )
  assert.ok(failure instanceof StudyError)
  assert.equal(
    failure.message,
    'The extension run was not ready within 90 s and was ended.',
  )
})

// protects=the run reads phase building with the WXT version while the build runs, journals it between starting and launching, and carries the build facts once built; fails_when=the phase is missing, the version is lost or the facts never reach the view; no_claim=the status bar item in an editor (the text function is checked here)
test('the run reads the building phase with the WXT version and then the build facts', async () => {
  // Arrange
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
    resolved: resolvedHarnessRun({ build: BUILD_FACTS }),
  })
  const preparing = harness.run.prepare()
  await settle()
  // Act
  const buildingView = harness.run.view()
  build.gate.resolve(BUILT_SOURCE)
  await preparing
  const readyView = harness.run.view()
  // Assert
  assert.equal(buildingView.phase, 'building')
  assert.equal(buildingView.build, undefined)
  assert.equal(
    describeChromeExtensionViewStatus(buildingView, []).statusItem,
    'Building the extension (WXT 0.21.4)…',
  )
  assert.deepEqual(readyView.build, BUILD_FACTS)
  assert.equal(readyView.phase, 'ready')
  const phases = harness.journal
    .filter((event) => event.type === 'chrome-extension.phase')
    .map((event) => Reflect.get(event.detail as object, 'name'))
  assert.deepEqual(phases.slice(0, 3), ['starting', 'building', 'launching'])
  await harness.run.stop()
})

// protects=the resolver is handed the prepared source, so it checks the build and not the project folder; fails_when=the source is dropped before the resolver; no_claim=what the resolver does with it
test('the resolver receives the source the build step prepared', async () => {
  // Arrange
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
    resolved: resolvedHarnessRun({ build: BUILD_FACTS }),
  })
  build.gate.resolve(BUILT_SOURCE)
  // Act
  await harness.run.prepare()
  // Assert
  assert.equal(
    Reflect.get(harness.resolveInputs[0] as object, 'source'),
    BUILT_SOURCE,
  )
  await harness.run.stop()
})

// protects=the history header learns the build facts of a wxt-build run and an unpacked run tells it none; fails_when=the facts are missing or an unpacked run names a build; no_claim=the header format (the writer's tests)
test('the history identity names the build of a wxt-build run and none for an unpacked run', async () => {
  // Arrange
  const identities: unknown[] = []
  const beginHistory = async (identity: unknown) => {
    identities.push(identity)
    return undefined
  }
  const build = controlledBuild()
  const wxt = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
    resolved: resolvedHarnessRun({ build: BUILD_FACTS }),
    beginHistory,
  })
  build.gate.resolve(BUILT_SOURCE)
  const unpacked = createRunHarness({ beginHistory })
  // Act
  await wxt.run.prepare()
  await unpacked.run.prepare()
  // Assert
  assert.deepEqual(Reflect.get(identities[0] as object, 'build'), {
    tool: 'wxt',
    version: '0.21.4',
  })
  assert.equal(Reflect.has(identities[1] as object, 'build'), false)
  await wxt.run.stop()
  await unpacked.run.stop()
})

// protects=a stop during the build whose tracked-file comparison found a change commits EXTENSION_BUILD_FAILED tracked-file-changed, not the generic stop error; fails_when=the stop hides a changed tracked file; no_claim=the comparison itself (the build step's tests)
test('a stop during the build after a tracked file changed commits the build failure', async () => {
  // Arrange
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()
  // Act
  const stopping = harness.run.stop()
  await settle()
  const signalAborted = build.state.signal?.aborted
  build.gate.reject(
    createExtensionBuildError(
      'EXTENSION_BUILD_FAILED',
      'tracked-file-changed',
      'The WXT build changed the tracked file ext/package.json; Codebook did not restore it.',
      { path: 'ext/package.json' },
    ),
  )
  await stopping
  const failure = await preparing
  // Assert
  assert.equal(signalAborted, true)
  assert.ok(failure instanceof StudyError)
  assert.equal(failure.code, 'EXTENSION_BUILD_FAILED')
  assert.deepEqual(failure.details, {
    reason: 'tracked-file-changed',
    path: 'ext/package.json',
  })
  assert.equal(harness.run.view().runFailure?.code, 'EXTENSION_BUILD_FAILED')
})

// protects=a stop during the build whose tree end could not be confirmed commits tracked-files-unverified; fails_when=an unconfirmed end reads as a plain stop; no_claim=the tree kill itself
test('a stop during the build with an unconfirmed end commits tracked-files-unverified', async () => {
  // Arrange
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()
  // Act
  const stopping = harness.run.stop()
  build.gate.reject(
    createExtensionBuildError(
      'EXTENSION_BUILD_FAILED',
      'tracked-files-unverified',
      "The build's processes could not be confirmed ended, so the tracked files could not be checked.",
    ),
  )
  await stopping
  await preparing
  // Assert
  assert.equal(
    Reflect.get(harness.run.view().runFailure?.details ?? {}, 'reason'),
    'tracked-files-unverified',
  )
})

// protects=a stop during a build that ended cleanly keeps today's stop error; fails_when=a clean cancel is reported as a build failure; no_claim=a build the stop did not reach
test('a stop during the build with unchanged files keeps the stop-before-ready error', async () => {
  // Arrange
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()
  // Act
  const stopping = harness.run.stop()
  build.gate.reject(
    new StudyError(
      'RUNTIME_FAILED',
      'The extension run was stopped before it was ready.',
    ),
  )
  await stopping
  await preparing
  // Assert
  const failure = harness.run.view().runFailure
  assert.equal(failure?.code, 'RUNTIME_FAILED')
  assert.equal(
    failure?.message,
    'The extension run was stopped before it was ready.',
  )
  assert.equal(harness.log.includes('launch'), false)
})

// protects=a build that never settles cannot hold the stop past its bound: the stop commits the generic stop error at the 10 s bound; fails_when=the stop waits for the build forever; no_claim=the real 10 s (a manual clock fires the bound)
test('a stop during a build that does not settle ends at the stop bound', async () => {
  // Arrange
  const timers = manualClock()
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    clock: timers.clock,
    prepareSource: build.prepareSource,
    timings: { runMs: 600_000, setupMs: 90_000 },
  })
  void harness.run.prepare().catch(() => undefined)
  await settle()
  // Act
  const stopping = harness.run.stop()
  await settle()
  timers.fire(10_000)
  await stopping
  // Assert
  assert.equal(harness.run.view().runFailure?.code, 'RUNTIME_FAILED')
  assert.equal(harness.run.view().phase, 'failed')
})

// protects=a second stop during the build returns the first stop's pending ending and arms no second bound, so the deadline does not restart; fails_when=the second stop arms another 10 s bound (two pending 10 s timers) or settles apart from the first; no_claim=the real 10 s (a manual clock fires the bound)
test('a second stop during the build shares the first stop and arms no second bound', async () => {
  // Arrange
  const timers = manualClock()
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    clock: timers.clock,
    prepareSource: build.prepareSource,
    timings: { runMs: 600_000, setupMs: 90_000 },
  })
  void harness.run.prepare().catch(() => undefined)
  await settle()
  // Act
  const firstStop = harness.run.stop()
  await settle()
  const secondStop = harness.run.stop()
  await settle()
  const stopBoundsArmed = timers
    .pendingDelays()
    .filter((delayMs) => delayMs === 10_000).length
  timers.fire(10_000)
  await Promise.all([firstStop, secondStop])
  // Assert
  assert.equal(stopBoundsArmed, 1)
  assert.equal(harness.run.view().runFailure?.code, 'RUNTIME_FAILED')
  assert.equal(harness.run.view().phase, 'failed')
})

// protects=the build folder is removed after the run ends, also for a run that stopped while building; fails_when=a build folder outlives its run; no_claim=the folder's real deletion (the product's dispose is checked with the dependencies)
test('the build folder is removed when the run ends', async () => {
  // Arrange
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    prepareSource: build.prepareSource,
    resolved: resolvedHarnessRun({ build: BUILD_FACTS }),
  })
  build.gate.resolve(BUILT_SOURCE)
  await harness.run.prepare()
  // Act
  await harness.run.stop()
  // Assert
  assert.equal(build.state.disposed, 1)
})

// protects=a build that finishes after the run already ended still has its folder removed; fails_when=a late build leaves a folder behind; no_claim=the stop error shown
test('a build that finishes after the run ended has its folder removed', async () => {
  // Arrange
  const timers = manualClock()
  const build = controlledBuild()
  const harness = createRunHarness({
    configuration: WXT_CONFIGURATION,
    clock: timers.clock,
    prepareSource: build.prepareSource,
    timings: { runMs: 600_000, setupMs: 90_000 },
  })
  const preparing = harness.run.prepare().catch((error: unknown) => error)
  await settle()
  const stopping = harness.run.stop()
  await settle()
  timers.fire(10_000)
  await stopping
  // Act
  build.gate.resolve(BUILT_SOURCE)
  await preparing
  await settle()
  // Assert
  assert.equal(build.state.disposed >= 1, true)
})
