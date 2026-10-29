import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import { readResource } from '../resources'

import { createHarness } from './helpers'
import {
  FAKE_EXTENSION_MANIFEST,
  FakeChromeExtensionRuntime,
} from './utils/fakeChromeExtensionRuntime'
import {
  chromeExtensionConfigurationOf,
  startFakeChromeExtensionRun,
} from './utils/startFakeChromeExtensionRun'

const OBSERVED_PONG = {
  kind: 'text' as const,
  before: { value: 'idle' },
  after: { value: 'pong' },
  changed: true,
  observedAtMs: 900,
}

/** Reads a resource of a run as the chat does and parses its JSON text. */
async function readRunResource(
  harness: Awaited<ReturnType<typeof createHarness>>,
  runId: string,
  suffix?: string,
) {
  const resource = await readResource(
    harness.service,
    harness.service.uri(runId, suffix),
  )
  if (!('text' in resource)) throw new Error('The resource is text.')
  return JSON.parse(resource.text)
}

// protects=codebook_status lists the chrome-extension profile with its one action, help link, adapter and no recording, so a chat can discover it; fails_when=the profile is missing from status, lists another action or claims a recording; no_claim=real Chrome
test('codebook_status lists the chrome-extension profile with its extension-click action and no recording', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.environment.createChromeExtensionRun = async () =>
    new FakeChromeExtensionRuntime()
  // Act
  const status = await harness.service.status()
  // Assert
  const profile = status.profiles.find(
    (entry) => entry.id === 'chrome-extension',
  )
  assert.equal(profile?.helpUri, 'codebook://help/chrome-extension')
  assert.equal(profile?.adapter, 'chrome-mv3-unpacked')
  assert.deepEqual(profile?.configurationVersions, [1])
  assert.deepEqual(profile?.actions, [
    { id: 'extension-click', title: 'Perform the next declared click' },
  ])
  assert.equal(profile?.recording?.available, false)
  assert.equal(status.capabilities.includes('extension-click'), true)
  assert.equal(status.apiVersion, '1.10')
})

// protects=an editor without the Chrome extension adapter reads the profile as not ready with the adapter named; fails_when=status says ready without the run factory; no_claim=the Chrome version check, which the environment reports
test('codebook_status names the missing adapter when the environment cannot create an extension run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const status = await harness.service.status()
  // Assert
  const profile = status.profiles.find(
    (entry) => entry.id === 'chrome-extension',
  )
  assert.equal(profile?.prerequisites.ready, false)
  assert.deepEqual(profile?.prerequisites.missing, [
    'The owned Chrome extension adapter is unavailable.',
  ])
})

// protects=DXR16: the environment's own Chrome 148 fix line reaches codebook_status unchanged; fails_when=status drops or rewrites the profile's missing sentence; no_claim=how the environment reads the version
test('codebook_status passes the environment fix line for Chrome 148 through', async (context) => {
  // Arrange
  const sentence =
    'Chrome 149 or later is needed to load an unpacked extension; found 148.'
  const harness = await createHarness({
    prerequisites: async () => ({
      ready: true,
      missing: [],
      profiles: {
        'chrome-extension': { ready: false, missing: [sentence] },
      },
    }),
  })
  context.after(() => harness.close())
  harness.service.environment.createChromeExtensionRun = async () =>
    new FakeChromeExtensionRuntime()
  // Act
  const status = await harness.service.status()
  // Assert
  const profile = status.profiles.find(
    (entry) => entry.id === 'chrome-extension',
  )
  assert.deepEqual(profile?.prerequisites.missing, [sentence])
  assert.equal(profile?.prerequisites.ready, false)
})

// protects=a start naming an unknown profile lists the supported profiles in order with chrome-extension last; fails_when=the profile is not in the supported list; no_claim=the other profiles' refusals
test('codebook_start for an unknown profile lists chrome-extension among the available profiles', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act, Assert
  assert.throws(
    () =>
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'nope',
        key: 'k',
      }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'UNSUPPORTED_PROFILE' &&
      error.message ===
        'Available profiles: repository-browser, node-test, node-server, chrome-extension',
  )
})

// protects=CR5: the start answers the manifest's name, permissions and host permissions the run will use, so the chat can tell the learner; fails_when=the answer lacks any of the three or the phase; no_claim=the manifest reader
test('codebook_start answers the manifest name, permissions and host permissions of the loaded extension', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  harness.service.environment.createChromeExtensionRun = async () =>
    new FakeChromeExtensionRuntime()
  // Act
  const answer = await harness.service.startOnStoredBook({
    instanceId: harness.service.instanceId,
    profile: 'chrome-extension',
    key: 'extension-run',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  // Assert
  assert.equal(answer.phase, 'ready')
  assert.deepEqual(answer.extension?.manifest, {
    name: 'Ping demo',
    permissions: ['storage'],
    hostPermissions: ['https://example.com/*'],
  })
  assert.equal(answer.failure, undefined)
})

// protects=a start whose preparation fails answers the refusal with the run's state beside it; fails_when=the failure is lost or the state missing; no_claim=which pre-launch check refused
test('codebook_start answers a refused preparation with its error and the run state', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const run = new FakeChromeExtensionRuntime()
  run.prepareFailure = new StudyError(
    'MANIFEST_NOT_V3',
    'The extension root needs a Manifest V3 manifest.json.',
  )
  harness.service.environment.createChromeExtensionRun = async () => run
  // Act
  const answer = await harness.service.startOnStoredBook({
    instanceId: harness.service.instanceId,
    profile: 'chrome-extension',
    key: 'refused',
    configuration: chromeExtensionConfigurationOf(harness),
  })
  // Assert
  assert.equal(answer.failure?.code, 'MANIFEST_NOT_V3')
  assert.equal(
    answer.failure?.message,
    'The extension root needs a Manifest V3 manifest.json.',
  )
  assert.equal(answer.state?.profile, 'chrome-extension')
})

// protects=SR11: an inspections key in a chrome-extension declaration is refused as INVALID_CONFIGURATION naming the field and the help; fails_when=the key is accepted or the refusal names no field; no_claim=the other schema edges
test('codebook_start refuses an inspections key with INVALID_CONFIGURATION naming the help', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act, Assert
  assert.throws(
    () =>
      harness.service.start({
        instanceId: harness.service.instanceId,
        profile: 'chrome-extension',
        key: 'wrong',
        configuration: {
          ...chromeExtensionConfigurationOf(harness),
          inspections: [],
        },
      }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'INVALID_CONFIGURATION' &&
      /See codebook:\/\/help\/chrome-extension\.$/.test(error.message) &&
      error.message.includes('configuration'),
  )
})

// protects=ER5: the permissions the chat acknowledged reach the environment's run; fails_when=acknowledgedPermissions is dropped on the way; no_claim=the exact match against the manifest, which the run makes
test('a start hands acknowledgedPermissions to the environment run', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  // Act
  const { created } = await startFakeChromeExtensionRun(harness, {
    configuration: { acknowledgedPermissions: ['nativeMessaging'] },
  })
  // Assert
  assert.deepEqual(created[0]?.acknowledgedPermissions, ['nativeMessaging'])
})

// protects=SR32: the run's journal reaches the events resource limited to chrome-extension events and with a bearer token masked; fails_when=another profile's event is kept or the token survives; no_claim=the run's own whitelist of fields
test('the events resource keeps only chrome-extension events and masks a bearer token', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { created, record } = await startFakeChromeExtensionRun(harness)
  // Act
  created[0]?.record('chrome-extension.click', {
    clickIndex: 1,
    selector: '#ping',
  })
  created[0]?.record('chrome-extension.output', {
    context: 'service-worker',
    text: 'Authorization: Bearer abcdefghijklmnop1234567890',
  })
  created[0]?.record('node-server.output', { text: 'ignored' })
  const journal = await readRunResource(harness, record.id, 'events/0')
  // Assert
  assert.deepEqual(
    journal.events.map((event: { type: string }) => event.type),
    ['chrome-extension.click', 'chrome-extension.output'],
  )
  assert.equal(
    JSON.stringify(journal).includes('abcdefghijklmnop1234567890'),
    false,
  )
})

// protects=SR17: the run resource of a ready run shows the chromeExtension block, the next action and claimable false, and never lists a save action (DR9); fails_when=a field of the block is missing, a save action is offered or claimable is true early; no_claim=the real run's values
test('the run resource of a ready run shows the extension block, offers extension-click and no save action', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { record } = await startFakeChromeExtensionRun(harness)
  // Act
  const state = await readRunResource(harness, record.id)
  // Assert
  assert.equal(state.profile, 'chrome-extension')
  assert.equal(state.state, 'ready')
  assert.deepEqual(state.nextActions, ['extension-click', 'stop'])
  assert.equal(state.claimable, false)
  assert.equal(state.chromeExtension.phase, 'ready')
  assert.equal(
    state.chromeExtension.extensionId,
    'abcdefghijklmnopabcdefghijklmnop',
  )
  assert.deepEqual(state.chromeExtension.procedure, {
    clicksDeclared: 2,
    clicksPerformed: 0,
  })
  assert.deepEqual(state.chromeExtension.stops, { declared: 2, captured: [] })
  assert.deepEqual(state.chromeExtension.stopsNotReached, [1, 2])
  assert.deepEqual(state.chromeExtension.manifest, FAKE_EXTENSION_MANIFEST)
  assert.equal(state.nextActions.includes('save-learning-summary'), false)
})

// protects=DXR7: claimable is true only when the run completed and its observation was read, and false when the read failed; fails_when=claimable is true without an observation or false after one; no_claim=how the run reads the value
test('claimable is true after an observed result and false when the result could not be read', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const observed = await startFakeChromeExtensionRun(harness, {
    key: 'observed',
  })
  observed.run.pauseAt(1)
  observed.run.pauseAt(2, 'service-worker')
  observed.run.complete(OBSERVED_PONG)
  await new Promise((resolve) => setImmediate(resolve))
  // Act
  const claimableState = await readRunResource(harness, observed.record.id)
  const unreadable = await startFakeChromeExtensionRun(harness, {
    key: 'unreadable',
  })
  unreadable.run.complete(
    {
      kind: 'text',
      before: { value: 'idle' },
      after: { unavailable: true, cause: 'No execution context remains.' },
      observedAtMs: 900,
    },
    { claimable: false },
  )
  const unclaimableState = await readRunResource(harness, unreadable.record.id)
  // Assert
  assert.equal(claimableState.claimable, true)
  assert.equal(claimableState.chromeExtension.result, 'complete')
  assert.deepEqual(claimableState.chromeExtension.observed, OBSERVED_PONG)
  assert.equal(unclaimableState.claimable, false)
  assert.equal(unclaimableState.chromeExtension.result, 'partial')
})

// protects=SR30: a run that completed is released at once, so the next start is not BUSY and the old run stays readable; fails_when=a second start answers BUSY or the completed run's resource is gone; no_claim=real cleanup
test('a second run right after a completed one is not busy and the completed run stays readable', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const first = await startFakeChromeExtensionRun(harness, { key: 'first' })
  first.run.complete(OBSERVED_PONG)
  await new Promise((resolve) => setImmediate(resolve))
  // Act
  const second = await startFakeChromeExtensionRun(harness, { key: 'second' })
  const firstState = await readRunResource(harness, first.record.id)
  // Assert
  assert.equal(second.run.view().phase, 'ready')
  assert.equal(firstState.chromeExtension.phase, 'completed')
  assert.equal(firstState.state, 'stopped')
  assert.deepEqual(first.run.calls, ['prepare', 'stop'])
})

// protects=SR30: a failed run is released at once with its failure as the run's error; fails_when=the slot stays taken or the error is lost; no_claim=the failure's own wording
test('a failed run frees the slot and shows its failure as the run error', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const first = await startFakeChromeExtensionRun(harness, { key: 'first' })
  // Act
  first.run.fail(
    new StudyError(
      'BROWSER_LOST',
      "The extension's browser stopped unexpectedly.",
    ),
  )
  await new Promise((resolve) => setImmediate(resolve))
  const second = await startFakeChromeExtensionRun(harness, { key: 'second' })
  const state = await readRunResource(harness, first.record.id)
  // Assert
  assert.equal(second.run.view().phase, 'ready')
  assert.equal(state.error.code, 'BROWSER_LOST')
  assert.equal(
    state.error.message,
    "The extension's browser stopped unexpectedly.",
  )
})

// protects=SR13 and SR37: codebook_explain and codebook_explain_node_history answer the extension refusal sentence for an extension run and change no stored study; fails_when=either tool saves, answers another sentence or throws a different code; no_claim=the other profiles' saves
test('codebook_explain and codebook_explain_node_history refuse an extension run with the same sentence and keep the store unchanged', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { record } = await startFakeChromeExtensionRun(harness)
  const sentence =
    'Saving an extension run is not available in this version; the live explanation stays in the chat.'
  // Act, Assert
  await assert.rejects(
    async () =>
      harness.service.explain({
        instanceId: harness.service.instanceId,
        runId: record.id,
        key: 'explain',
        snapshotUri: harness.service.uri(record.id, 'snapshots/x'),
        sourceHash: 'a'.repeat(64),
        valuePaths: ['value:answer'],
        interpretation: 'The answer is pong.',
      }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'EVIDENCE_UNAVAILABLE' &&
      error.message === sentence,
  )
  await assert.rejects(
    async () =>
      harness.service.explainNodeHistory({
        studyId: `${harness.service.instanceId}_${record.id}`,
        expectedRevision: 0,
        content: {
          question: 'What answers?',
          title: 'Ping',
          summary: 'A ping.',
          participants: [],
          steps: [],
        },
      }),
    (error) =>
      error instanceof StudyError &&
      error.code === 'EVIDENCE_UNAVAILABLE' &&
      error.message === sentence,
  )
  assert.equal(record.explanations.size, 0)
  assert.equal(record.explanationKeys.size, 0)
})

// protects=an extension run has no stored images; fails_when=the images resource answers another error or an image; no_claim=the live Application view
test('reading an image of an extension run answers that extension runs have no stored images', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const { record } = await startFakeChromeExtensionRun(harness)
  // Act, Assert
  await assert.rejects(
    () => readRunResource(harness, record.id, 'images/after'),
    (error) =>
      error instanceof StudyError &&
      error.code === 'EVIDENCE_UNAVAILABLE' &&
      error.message ===
        'Extension runs have no stored images: the Application view shows the live surface; read the run resource for the stops, the observation and the failure.',
  )
})
