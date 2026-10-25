import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_TEST_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import type { NodeTestSourceStop } from '../ownedNodeTestRun'
import { readResource } from '../resources'
import type { NodeTestRuntime } from '../runtime'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { NodeTestExecutionPlan } from '../utils/planNodeTestExecution'

import { createHarness } from './helpers'
import { ROOT_MODE_EXECUTION_PLAN } from './utils/rootModeExecutionPlan'

/** The plan of a TanStack-query-shaped package test whose package config and hoisted Vitest the pre-history check found. */
const PACKAGE_MODE_EXECUTION_PLAN: NodeTestExecutionPlan = {
  vitestRoot: '/repo/packages/query-core',
  nearestConfigDirectory: '/repo/packages/query-core',
  vitest: {
    major: 5,
    version: '5.0.5',
    program: '/repo/node_modules/vitest/vitest.mjs',
    packageDirectory: '/repo/node_modules/vitest',
    directory: '/repo',
  },
  filter: 'src/__tests__/queryObserver.test.tsx',
  summary: {
    vitestRoot: 'packages/query-core',
    vitestRootReason: 'nearest-config',
    rootClaim: 'not-applicable',
    vitestConfigFiles: ['vite.config.ts'],
    skippedConfigFiles: [],
  },
}

/**
 * Prepares a service whose node-test environment returns the given plan from its pre-history check, and whose run is a fake with one stop and a passing result; the run records which plan it was given.
 * @param plan - What the environment's check returns.
 * @returns The harness, the service, a configuration citing the harness's source, and what the fake environment received.
 * @example const node = await nodeTestService(PACKAGE_MODE_EXECUTION_PLAN)
 */
async function nodeTestService(plan: NodeTestExecutionPlan) {
  const harness = await createHarness(),
    { service } = harness
  service.nodeHistoryStore = new NodeTestHistoryStore(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  // A test history records the build it ran with, which names a source hash.
  service.environment.build.sourceHash = 'f'.repeat(64)
  const configuration: NodeTestConfiguration = {
    version: 1,
    adapter: 'vitest-node',
    book: harness.configuration.book,
    testFile: 'src/theme.test.ts',
    testTitles: ['theme', 'selects the dark theme'],
    testHash: 'a'.repeat(64),
    source: harness.configuration.source,
    inspections: harness.configuration.inspections.slice(0, 1),
  }
  const received: { plans: unknown[]; starts: number } = {
    plans: [],
    starts: 0,
  }
  const stop = {
    index: 0,
    runId: 'node-run',
    sessionId: 'owned-session',
    threadId: 7,
    elapsedMs: 10,
    worker: {},
    source: configuration.source,
    frame: { id: 10, name: 'notifyManager', line: 1, column: 1 },
    variables: [{ name: 'listener', value: '() => undefined' }],
    facts: [
      { path: 'nextTheme', mode: 'value', display: 'dark', type: 'string' },
    ],
    debuggerSnapshot: {
      version: 1,
      frames: [
        {
          name: 'notifyManager',
          line: 1,
          column: 1,
          scopes: [{ name: 'Local', variables: [0] }],
        },
      ],
      variables: [{ name: 'listener', value: '() => undefined', children: [] }],
      limitations: [],
    },
  } as unknown as NodeTestSourceStop
  const runtime: NodeTestRuntime = {
    id: 'node-run',
    prepare: async () => stop,
    hasNextStop: () => false,
    advance: async () => assert.fail('one stop only'),
    complete: async () => ({
      exitCode: 0,
      signal: null,
      output: 'Tests 1 passed',
      elapsedMs: 20,
    }),
    stop: async () => undefined,
  }
  service.environment.checkNodeTestFiles = async () => plan
  service.environment.createNodeTestRun = async (
    _configuration,
    record,
    _citedSources,
    givenPlan,
  ) => {
    received.starts++
    received.plans.push(givenPlan)
    await record('node-test.output', {
      sequence: 1,
      elapsedMs: 3,
      channel: 'stdout',
      text: 'RUN src/theme.test.ts',
    })
    return runtime
  }
  const start = (key: string) =>
    service.start({
      instanceId: service.instanceId,
      profile: NODE_TEST_PROFILE,
      key,
      configuration,
    })
  return { harness, service, configuration, received, start }
}

/**
 * Reads the node-test run manifest as JSON.
 * @param service - The service that runs it.
 * @param runUri - The run's URI from its receipt.
 * @returns The manifest's fields.
 * @example await manifestOf(service, receipt.runUri) // => { profile: 'node-test', vitestRoot: '.', ... }
 */
async function manifestOf(
  service: Awaited<ReturnType<typeof nodeTestService>>['service'],
  runUri: string,
): Promise<Record<string, unknown>> {
  const resource = await readResource(service, `${runUri}/manifest`)
  assert.ok('text' in resource)
  return JSON.parse(JSON.parse(resource.text).content)
}

// Value: protects=a package-mode run going through preparation, its stop, its result and its history's seal exactly as a root run does, with the plan of the pre-history check handed to the run and named in the manifest, while the configuration hash stays the agent's; fails_when=the run gets another plan or none, the manifest lacks vitestRoot and its facts, the hash changes with the plan, or the history does not seal complete as a test replay; why_new=Cycle 0053 (H3, H6 package mode, AC 4, AC 11); seam=the environment's check and the owned run are fakes; no_claim=the real launch in the package (nodeTestVitestRootLaunch tests)
test('a package-mode test run names its Vitest root in the manifest and seals its history as a test replay', async () => {
  // Arrange
  const { harness, service, configuration, received, start } =
    await nodeTestService(PACKAGE_MODE_EXECUTION_PLAN)
  try {
    const receipt = start('package-mode-run'),
      record = service.record(receipt)
    await record.preparation

    // Act
    const manifest = await manifestOf(service, receipt.runUri)
    await service.continue(
      service.state(record).participants.server!.continueArguments!,
    )
    service.maintain()
    await waitUntil(() => record.stopped, 'node-test run cleanup', 1_000)

    // Assert
    const nodeTest = service.state(record).nodeTest!
    assert.deepEqual(received.plans, [PACKAGE_MODE_EXECUTION_PLAN])
    assert.deepEqual(
      {
        vitestRoot: manifest.vitestRoot,
        vitestRootReason: manifest.vitestRootReason,
        rootClaim: manifest.rootClaim,
        vitestConfigFiles: manifest.vitestConfigFiles,
        skippedConfigFiles: manifest.skippedConfigFiles,
      },
      {
        vitestRoot: 'packages/query-core',
        vitestRootReason: 'nearest-config',
        rootClaim: 'not-applicable',
        vitestConfigFiles: ['vite.config.ts'],
        skippedConfigFiles: [],
      },
    )
    // The hash covers the agent's configuration alone; the plan's facts sit beside it.
    assert.equal(
      manifest.configurationHash,
      createHash('sha256')
        .update(JSON.stringify(manifest.configuration))
        .digest('hex'),
    )
    assert.equal(
      (manifest.configuration as NodeTestConfiguration).testFile,
      configuration.testFile,
    )
    assert.equal('vitestRoot' in (manifest.configuration as object), false)
    assert.equal(nodeTest.historyStatus, 'complete')
    assert.equal(nodeTest.replayAvailable, true)
    assert.equal(nodeTest.testResult, 'passed')
  } finally {
    await harness.close()
  }
})

// Value: protects=a root-mode run's manifest naming its Vitest root as "." with its reason; fails_when=a root-mode manifest omits vitestRoot or names a package; why_new=Cycle 0053 (H6 root mode, AC 11); seam=the environment's check and the owned run are fakes; no_claim=the root-mode launch itself (H4)
test('a root-mode test run names "." as its Vitest root in the manifest', async () => {
  // Arrange
  const { harness, service, start } = await nodeTestService(
    ROOT_MODE_EXECUTION_PLAN,
  )
  try {
    const receipt = start('root-mode-run')
    await service.record(receipt).preparation

    // Act
    const manifest = await manifestOf(service, receipt.runUri)

    // Assert
    assert.equal(manifest.vitestRoot, '.')
    assert.equal(manifest.vitestRootReason, 'no-config')
    assert.equal(manifest.rootClaim, 'not-applicable')
  } finally {
    await harness.close()
  }
})

// Value: protects=a node-test start that does not wait on the repository-wide Vitest search: it starts while the search is unfinished, and only the start's own prerequisites refuse it; fails_when=a start waits for codebook_status's search or is refused by its result, or a missing Node no longer refuses a start; why_new=DX review (H7, AC 12): the start checks the cited test's own Vitest; seam=the environment's prerequisites are fakes; no_claim=the search itself (searchRepositoryVitest tests)
test('a node-test start proceeds while the Vitest search is unfinished, and a missing Node still refuses it', async () => {
  // Arrange
  const ready = await nodeTestService(PACKAGE_MODE_EXECUTION_PLAN)
  const missingNode = await nodeTestService(PACKAGE_MODE_EXECUTION_PLAN)
  for (const node of [ready, missingNode])
    node.service.environment.prerequisites = () => new Promise(() => undefined)
  ready.service.environment.nodeTestStartPrerequisites = async () => ({
    ready: true,
    missing: [],
  })
  missingNode.service.environment.nodeTestStartPrerequisites = async () => ({
    ready: false,
    missing: [
      'codebook.nodeExecutable: configure an executable external Node.js >=24.',
    ],
  })
  try {
    // Act
    const started = ready.service.record(ready.start('unfinished-search'))
    const refused = missingNode.service.record(
      missingNode.start('missing-node'),
    )
    await started.preparation
    await refused.preparation

    // Assert
    assert.equal(ready.received.starts, 1)
    assert.ok(
      ready.service.state(started).participants.server?.continueArguments,
    )
    assert.equal(missingNode.received.starts, 0)
    assert.deepEqual(
      {
        code: missingNode.service.state(refused).error?.code,
        message: missingNode.service.state(refused).error?.message,
      },
      {
        code: 'PREREQUISITE_MISSING',
        message:
          'codebook.nodeExecutable: configure an executable external Node.js >=24.',
      },
    )
  } finally {
    await ready.harness.close()
    await missingNode.harness.close()
  }
})

// Value: protects=codebook_status passing the readiness search's state to the agent beside its sentence; fails_when=profiles node-test lacks vitestSearch, so an agent cannot tell a search that found nothing from one it cut short; why_new=DX review (vitestSearch, R8); seam=the environment's prerequisites are fakes; no_claim=the search's sentences (searchRepositoryVitest tests)
test('codebook_status names what the Vitest search found for node-test', async () => {
  // Arrange
  const { harness, service } = await nodeTestService(ROOT_MODE_EXECUTION_PLAN)
  service.environment.prerequisites = async () => ({
    ready: true,
    missing: [],
    profiles: {
      'node-test': {
        ready: false,
        missing: ['node-test found no usable Vitest in the first 256 folders'],
        vitestSearch: 'incomplete',
      },
    },
  })
  try {
    // Act
    const status = await service.status()

    // Assert
    const profile = status.profiles.find(
      (candidate) => candidate.id === NODE_TEST_PROFILE,
    )
    assert.deepEqual(profile?.prerequisites, {
      ready: false,
      missing: ['node-test found no usable Vitest in the first 256 folders'],
      vitestSearch: 'incomplete',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=a refusal of the plan's Vitest rules reaching the agent through the run resource's error, before the history, never as a tool error or success; fails_when=codebook_start throws, the run resource lacks the code, the sentence or the recovery, or the refused run keeps a history; why_new=Eng review (H10, AC 14); seam=the environment's check throws the refusal; no_claim=the MCP transport (mcpServer tests)
test('a refused node-test start answers with its receipt and names the refusal in the run resource', async () => {
  // Arrange
  const { harness, service, received, start } = await nodeTestService(
    ROOT_MODE_EXECUTION_PLAN,
  )
  const sentence =
    'node-test needs Vitest 4 or later for packages/a/src/a.test.ts; packages/a/node_modules/vitest is 3.2.4. Ask the learner to upgrade it, then start the test again.'
  service.environment.checkNodeTestFiles = async () => {
    throw new StudyError('PREREQUISITE_MISSING', sentence)
  }
  try {
    // Act
    const receipt = start('refused-old-vitest')
    await service.record(receipt).preparation
    const resource = await readResource(service, receipt.runUri)

    // Assert
    assert.ok('text' in resource)
    const run = JSON.parse(resource.text)
    assert.deepEqual(
      {
        code: run.error.code,
        message: run.error.message,
        recovery: run.error.recovery,
      },
      {
        code: 'PREREQUISITE_MISSING',
        message: sentence,
        recovery:
          'Fix the named dependency or workspace prerequisite, then call codebook_status before a new start.',
      },
    )
    assert.equal(received.starts, 0)
    assert.equal(run.nodeTest?.historyUri, undefined)
  } finally {
    await harness.close()
  }
})

// Value: protects=a node-test start's root-claim listing being bound to the run's own cancellation and to a preparation deadline inside the 90-second setup window; fails_when=the pre-history check gets a signal that a stop does not abort, or a deadline past the setup limit, so a stopped start keeps listing Vitest from the root; why_new=the fakes of the other service tests ignore the check's control argument; seam=a fake environment check that captures its control and waits for the cancellation; no_claim=the listing process group's release (listVitestForRootClaim tests)
test('a stop during the pre-history check cancels the signal the root-claim listing runs with, and its deadline lies within the setup window', async () => {
  // Arrange
  const { harness, service, received, start } = await nodeTestService(
    ROOT_MODE_EXECUTION_PLAN,
  )
  let control: { signal: AbortSignal; deadlineAt: number } | undefined
  service.environment.checkNodeTestFiles = async (
    _configuration,
    _citedSources,
    given,
  ) => {
    control = given
    await new Promise<void>((resolve) =>
      given.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
    throw given.signal.reason
  }
  try {
    // Act
    const receipt = start('stopped-during-check')
    const started = service.record(receipt)
    await waitUntil(() => control !== undefined, 'the check was reached')
    const before = {
      aborted: control?.signal.aborted,
      deadlineWithinSetup:
        (control?.deadlineAt ?? Infinity) <= Date.now() + 90_000 &&
        (control?.deadlineAt ?? 0) > Date.now(),
    }
    await service.stop({
      instanceId: service.instanceId,
      runId: started.id,
    })

    // Assert
    assert.deepEqual(before, { aborted: false, deadlineWithinSetup: true })
    assert.equal(control?.signal.aborted, true)
    assert.equal(received.starts, 0)
  } finally {
    await harness.close()
  }
})

// Value: protects=the run's journaled node-test.started entry carrying the root-relative vitestRoot and rootClaim the agent reads, and never the launch's absolute working directory; fails_when=the service's mapping drops either field or copies the host path into the run's events; why_new=Step 7 coverage audit of Cycle 0053 (the mapping had no test); seam=the owned run is a fake that journals the start as launchNodeTest does; no_claim=the launch itself (nodeTestVitestRootLaunch tests)
test('a started test run journals its Vitest root and root claim without the host path', async () => {
  // Arrange
  const { harness, service, start } = await nodeTestService(
    PACKAGE_MODE_EXECUTION_PLAN,
  )
  const createRun = service.environment.createNodeTestRun!
  service.environment.createNodeTestRun = async (...input) => {
    await input[1]('node-test.started', {
      pid: 4242,
      cwd: '/private/workspace/packages/query-core',
      vitestRoot: 'packages/query-core',
      rootClaim: 'not-applicable',
      secretEnvironmentInherited: false,
    })
    return createRun(...input)
  }
  try {
    const receipt = start('journaled-start')
    const record = service.record(receipt)
    await record.preparation

    // Act
    const events = await readResource(service, service.state(record).eventsUri)

    // Assert
    assert.ok('text' in events)
    assert.match(
      events.text,
      /"started":true,"vitestRoot":"packages\/query-core","rootClaim":"not-applicable"/,
    )
    assert.doesNotMatch(events.text, /\/private\/workspace/)
  } finally {
    await harness.close()
  }
})

// Value: protects=a root listing that may still run being named in the run's events when a learner's stop ends the start before its history, while the run still reads stopped with no error; fails_when=the stop drops the failed release, so nothing tells the agent a listing member may still run, or the run reads refused or failed; why_new=state-machine review of Cycle 0053 (a stop racing a failed release lost it); seam=the environment's check is a fake that reports the failed release and fails once the stop is under way; no_claim=the real release (listVitestTestFiles tests)
test('a stop during a start whose root listing was not released reads stopped and names the listing in its events', async () => {
  // Arrange
  const { harness, service, received, start } = await nodeTestService(
    ROOT_MODE_EXECUTION_PLAN,
  )
  let checkIsHeld = false,
    letCheckFail!: () => void
  const checkMayFail = new Promise<void>((resolve) => {
    letCheckFail = resolve
  })
  service.environment.checkNodeTestFiles = async (
    _configuration,
    _sources,
    control,
  ) => {
    control.onListingNotReleased?.({
      processGroup: 4242,
      directory: '/tmp/codebook-vitest-list-x',
      reason: 'Error: kill EPERM',
    })
    checkIsHeld = true
    await checkMayFail
    throw new Error('The operation was aborted.')
  }
  try {
    const receipt = start('unreleased-listing-stopped')
    const record = service.record(receipt)
    await waitUntil(() => checkIsHeld, 'the check holds the preparation')

    // Act
    const stopping = service.stop({
      instanceId: service.instanceId,
      runId: record.id,
    })
    letCheckFail()
    const afterStop = await stopping
    const events = await readResource(service, service.state(record).eventsUri)

    // Assert
    assert.equal(afterStop.error, undefined)
    assert.equal(afterStop.state, 'stopped')
    assert.equal(record.historyExcluded, 'stopped-before-history')
    assert.equal(received.starts, 0)
    assert.ok('text' in events)
    assert.match(events.text, /node-test\.vitest-listing-not-released/)
    assert.doesNotMatch(events.text, /codebook-vitest-list-x/)
  } finally {
    letCheckFail()
    await harness.close()
  }
})
