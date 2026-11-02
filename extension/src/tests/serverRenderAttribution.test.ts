import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { assertObservationFormatFields } from '../utils/assertObservationFormatFields'
import { captureStudy } from '../utils/captureStudy'
import { configuredStops } from '../utils/configuredStops'
import { describePauseName } from '../utils/describePauseName'
import { projectPageLoadStatus } from '../utils/projectPageLoadStatus'
import { projectPauseNames } from '../utils/projectPauseNames'
import { serverRenderAttributionOf } from '../utils/serverRenderAttributionOf'

import { createOperationsStudy } from './utils/createOperationsStudy'
import { serviceHostedEntryRun } from './utils/entryRenderService'

/** A workspace key in the shape a saved study carries. */
const WORKSPACE_KEY = 'a'.repeat(64)

/**
 * A format 8 study whose observation 1 (the stop after operation 4) is replaced by the fields given, with the stops it is checked against.
 * @param observation - The fields the server observation gets.
 * @param afterOperation - The `afterOperation` its stop is declared with.
 * @returns The study and stops for {@link assertObservationFormatFields}.
 * @example const { study, stops } = serverObservationStudy({ execution: 'server-render' }, 4)
 */
function serverObservationStudy(
  observation: Record<string, unknown>,
  afterOperation: number,
) {
  const complete = createOperationsStudy()
  const stops = configuredStops(complete.configuration).map((stop, position) =>
    position === 1 ? { ...stop, afterOperation } : stop,
  )
  const server = complete.observations[1]!
  const {
    attribution: _attribution,
    operationIndex: _operationIndex,
    ...plain
  } = server
  return {
    study: {
      ...complete,
      observations: [
        complete.observations[0]!,
        { ...plain, ...observation },
        complete.observations[2]!,
      ],
    },
    stops,
  }
}

// Value: protects=M1 an unconfirmed-route pause after operation k carries operationIndex k and one at the page load carries none; fails_when=the producer drops the operation of an unconfirmed pause; no_claim=how the route is read
test('the attribution of an unconfirmed pause keeps the operation of its stop', () => {
  // Arrange
  const cases = [
    [0, true],
    [2, true],
    [2, false],
    [0, false],
  ] as const
  // Act
  const results = cases.map(([group, isUnconfirmed]) =>
    serverRenderAttributionOf(group, isUnconfirmed),
  )
  // Assert
  assert.deepEqual(results, [
    { attribution: 'unconfirmed' },
    { attribution: 'unconfirmed', operationIndex: 2 },
    { attribution: 'after-operation', operationIndex: 2 },
    { attribution: 'entry-load' },
  ])
})

// Value: protects=M1 the name of an unconfirmed pause after operation 2 reads After operation 2 and not Page load; fails_when=the namer prints Page load for it; no_claim=the layout of the label
test('an unconfirmed-route pause after operation 2 is named After operation 2, route not confirmed', () => {
  // Arrange
  const input = {
    execution: 'server-render',
    attribution: 'unconfirmed',
    operationIndex: 2,
    path: 'a.ts',
    line: 3,
  } as const
  // Act
  const name = describePauseName(input)
  // Assert
  assert.equal(
    name?.text,
    'After operation 2 · Server render · a.ts:3 · route not confirmed',
  )
})

// Value: protects=M1 the status of a run held at an unconfirmed pause after an operation is not a Page load status; fails_when=projectPageLoadStatus counts the pause as page load; no_claim=the status words of other states
test('a run held at an unconfirmed-route pause after operation 1 does not read Page load', () => {
  // Arrange
  const complete = createOperationsStudy()
  const snapshot = {
    execution: 'server-render',
    attribution: 'unconfirmed',
    operationIndex: 1,
    declaredIndex: 1,
  }
  const view: Parameters<typeof projectPageLoadStatus>[0] = {
    status: 'paused-server',
    operations: [],
    participants: {
      browser: undefined,
      server: { phase: 'paused', snapshot },
    },
    snapshots: [snapshot],
    definition: { configuration: complete.configuration },
  } as never
  // Act
  const status = projectPageLoadStatus(view)
  // Assert
  assert.equal(status, undefined)
})

// Value: protects=M1 an unconfirmed pause after operation 1 is placed with the render after operation 1, not with the page load; fails_when=withDeclaredPositions puts it in group 0 and misses its declared position; no_claim=the pause names themselves
test('an unconfirmed pause after operation 1 is ordered within its own operation set', () => {
  // Arrange
  const stops = [
    { participant: 'server', source: { path: 'a.ts', line: 1 } },
    { participant: 'server', source: { path: 'b.ts', line: 2 } },
    { participant: 'server', source: { path: 'c.ts', line: 3 } },
  ]
  const observations = [
    {
      participant: 'server',
      execution: 'server-render',
      attribution: 'entry-load',
      declaredIndex: 0,
      executionIndex: 0,
      source: { line: 1 },
    },
    {
      participant: 'server',
      execution: 'server-render',
      attribution: 'unconfirmed',
      operationIndex: 1,
      declaredIndex: 2,
      executionIndex: 1,
      source: { line: 3 },
    },
    {
      participant: 'server',
      execution: 'server-render',
      attribution: 'after-operation',
      operationIndex: 1,
      declaredIndex: 1,
      executionIndex: 2,
      source: { line: 2 },
    },
  ]
  // Act
  const texts = projectPauseNames(observations, stops).map(
    (pause) => pause.name?.text,
  )
  // Assert
  assert.deepEqual(texts, [
    'Page load · Server render · a.ts:1',
    'After operation 1 · Server render · c.ts:3 · route not confirmed (declared 2)',
    'After operation 1 · Server render · b.ts:2 (declared 1)',
  ])
})

// Value: protects=M7 a format 8 render observation is tied to its stop: an attribution it must have, entry-load only for an afterOperation 0 stop, and an operationIndex equal to the stop's afterOperation; fails_when=any of these contradictions is accepted; no_claim=the writer
test('the format 8 validator refuses a render observation that contradicts the group of its stop', () => {
  // Arrange
  const render = { execution: 'server-render' }
  const attempts = [
    { ...render },
    { ...render, attribution: 'entry-load' },
    { ...render, attribution: 'after-operation', operationIndex: 3 },
    { ...render, attribution: 'after-operation' },
    { ...render, attribution: 'unconfirmed' },
  ]
  // Act
  const messages = attempts.map((observation) => {
    const { study, stops } = serverObservationStudy(observation, 4)
    try {
      assertObservationFormatFields(study, stops)
      return 'accepted'
    } catch (error) {
      return (error as Error).message
    }
  })
  // Assert
  assert.deepEqual(messages, [
    'A server render observation needs an attribution.',
    'Configured observation attribution differs from its stop.',
    'Configured observation operationIndex differs from its stop.',
    'Configured observation operationIndex differs from its stop.',
    'Configured observation operationIndex differs from its stop.',
  ])
})

// Value: protects=M1 and M7 an unconfirmed render after operation 4 with operationIndex 4 and a page-load render with entry-load are accepted; fails_when=the validator refuses the shapes the producer writes; no_claim=the writer
test('the format 8 validator accepts the attribution fields the producer writes for an unconfirmed render', () => {
  // Arrange
  const unconfirmed = {
    execution: 'server-render',
    attribution: 'unconfirmed',
    operationIndex: 4,
  }
  const entryLoad = { execution: 'server-render', attribution: 'entry-load' }
  const { study, stops } = serverObservationStudy(unconfirmed, 4)
  const entry = serverObservationStudy(entryLoad, 0)
  // Act
  const acceptUnconfirmed = (): void =>
    assertObservationFormatFields(study, stops)
  const acceptEntry = (): void =>
    assertObservationFormatFields(entry.study, entry.stops)
  // Assert
  assert.doesNotThrow(acceptUnconfirmed)
  assert.doesNotThrow(acceptEntry)
})

// Value: protects=M6 an entry-render stop (afterOperation 0) is a page-load render whichever layer it paused in: a server action there is refused; fails_when=a group-0 observation may read Server action; no_claim=which layer the script was in
test('the format 8 validator refuses a server action observation at an entry-render stop', () => {
  // Arrange
  const { study, stops } = serverObservationStudy(
    { execution: 'server-action' },
    0,
  )
  // Act
  const accept = (): void => assertObservationFormatFields(study, stops)
  // Assert
  assert.throws(accept, {
    message: 'Configured entry-render observation is not a render.',
  })
})

// Value: protects=Codex P2 a study without declaredIndex names each pause after the stop at its position, so two stops on one line of different files keep their files; fails_when=every pause takes the first stop's file; no_claim=format 8 naming
test('a format 7 study names two server pauses on the same line by their own files', () => {
  // Arrange
  const stops = [
    { participant: 'server', source: { path: 'app/actions.ts', line: 10 } },
    { participant: 'server', source: { path: 'app/db.ts', line: 10 } },
  ]
  const observations = [
    { participant: 'server', source: { line: 10 } },
    { participant: 'server', source: { line: 10 } },
  ]
  // Act
  const texts = projectPauseNames(observations, stops).map(
    (pause) => pause.name?.text,
  )
  // Assert
  assert.deepEqual(texts, [
    'Server action · app/actions.ts:10',
    'Server action · app/db.ts:10',
  ])
})

// Value: protects=Codex P2 a run with an entry-render stop and then an operation without its own stop saves and reopens; fails_when=the entry continue is lost, so the operation reads done without its declared pauses continued; no_claim=a real Next dev server
test('a run with an entry-render stop and an operation without a stop is saved and reopened', async (context) => {
  // Arrange
  const run = await serviceHostedEntryRun(context, {
    savedSession: { admission: 'saved' },
    entryAnswer: { status: 307, location: '/login' },
    navigationLandings: ['/dashboard', '/dashboard'],
    documentReadyState: 'complete',
    loadingFromNavigation: 2,
    operations: {
      operations: [
        {
          kind: 'click',
          title: 'Create Invoice',
          selector: 'button[type=submit]',
        },
      ],
      stopOperations: [0],
      stopParticipants: ['server'],
      signInPaths: ['/login'],
    },
  })
  const { harness, service, state, receipt } = run
  service.environment.confirmSavedSessionOperations = async () => true
  service.environment.noticeOperationsConfirmation = async () => undefined
  await waitUntil(
    () => harness.navigations.length >= 2,
    'the entry navigation started',
  )
  harness.server!.hit({ route: '/dashboard' })
  await waitUntil(() => state().state === 'paused-server', 'the entry pause')
  harness.setDocumentReadyState('complete')
  await service.continue(state().participants.server!.continueArguments!)
  await waitUntil(() => state().state === 'ready', 'ready for operation 1')
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: 'repository-operation',
  })
  await waitUntil(() => state().state === 'completed', 'the completed run')
  const directory = await mkdtemp(join(tmpdir(), 'codebook-entry-op-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  // Act
  const saved = await captureStudy(
    service,
    service.record(receipt),
    WORKSPACE_KEY,
  )
  const library = new LearningLibrary(directory, WORKSPACE_KEY)
  await library.saveStudy(saved!)
  const reopened = await library.readStudy(saved!.id)
  // Assert
  assert.equal(reopened.version, 8)
  assert.deepEqual(
    reopened.operations?.map((operation) => operation.state),
    ['done'],
  )
})
