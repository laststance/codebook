import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { apiServerExitedRefusal } from '../apiServerRefusals'
import { StudyError } from '../errors'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { apiServerRefusalOf } from '../utils/apiServerRefusalOf'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import {
  API_STOP_FILE,
  apiScriptText,
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
} from './utils/apiServerRunHarness'
import { sendOperation } from './utils/routeHandlerRunHarness'

// Value: protects=F5: an API seal refusal that ends the run keeps details.reason, participant, file and sideEffects after the failure text is restored; fails_when=the seal passes through fail() as a bare string and the restored error has the code alone; no_claim=the wording of the seal sentence (expoWebRefusals tests)
test('a source-drift seal failure of a run restores reason, participant, file and side effects', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  // Act
  await apiServerHit(harness, {
    scriptText: apiScriptText(
      harness.server!.sealedUrl.replace('file://', ''),
      'var nextTheme = "edited";\n',
    ),
  })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the seal refusal',
  )
  const restored = refusalFailureOf(harness.run.view().failures[0]!)
  // Assert
  assert.equal(restored?.code, 'EXPO_WEB_SEAL_FAILED')
  assert.deepEqual(
    { ...restored?.libraryDetails },
    {
      reason: 'source-drift',
      participant: 'apiServer',
      file: API_STOP_FILE,
      sideEffects: 'partial',
    },
  )
})

// Value: protects=F5: a stop file name with parentheses survives the failure text's lead; fails_when=the variant is cut at the parenthesis and the file is lost; no_claim=the run raising the seal
test('an API seal failure text restores a file name that contains parentheses', () => {
  // Arrange
  const text =
    'EXPO_WEB_SEAL_FAILED(api-seal:source-unverifiable:apps%2Fapi%2F%28group%29%2Fa.ts): No map.'
  // Act
  const restored = refusalFailureOf(text)
  // Assert
  assert.deepEqual(
    { message: restored?.message, ...restored?.libraryDetails },
    {
      message: 'No map.',
      reason: 'source-unverifiable',
      participant: 'apiServer',
      file: 'apps/api/(group)/a.ts',
      sideEffects: 'partial',
    },
  )
})

// Value: protects=F6: the restored SERVER_EXITED(api-server) failure carries the masked output tail its recovery points at; fails_when=details.outputTail is absent after restoring; no_claim=the masking of the tail
test('a restored API exit failure carries details.outputTail from its message', () => {
  // Arrange
  const refusal = apiServerExitedRefusal(
    { exitCode: 1, signal: null },
    'connect ECONNREFUSED 127.0.0.1:5432',
  )
  const silent = apiServerExitedRefusal({ exitCode: 2, signal: null }, '')
  // Act
  const restored = refusalFailureOf(
    formatRefusalFailure('SERVER_EXITED', refusal.message, 'api-server'),
  )
  const restoredSilent = refusalFailureOf(
    formatRefusalFailure('SERVER_EXITED', silent.message, 'api-server'),
  )
  // Assert
  assert.deepEqual(
    {
      tail: restored?.libraryDetails,
      silentTail: restoredSilent?.libraryDetails,
    },
    {
      tail: {
        participant: 'apiServer',
        sideEffects: 'partial',
        outputTail: 'connect ECONNREFUSED 127.0.0.1:5432',
      },
      silentTail: {
        participant: 'apiServer',
        sideEffects: 'partial',
        outputTail: '',
      },
    },
  )
})

// Value: protects=F7: an API stop file deleted after the source check is refused before anything starts with NODE_SERVER_SOURCE_REFUSED naming the file; fails_when=the failure is uncoded or the API launches; no_claim=the schema's own source check
test('a deleted API stop file is refused as NODE_SERVER_SOURCE_REFUSED before anything starts', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await rm(join(harness.directory, API_STOP_FILE))
  // Act: the earlier source checks passed in a real run, so the stop collection is driven on its own
  const error = await harness.run['collectApiServerStops']().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.equal(error instanceof StudyError, true)
  const refusal = error as StudyError
  assert.deepEqual(
    {
      code: refusal.code,
      participant: refusal.details?.participant,
      sideEffects: refusal.details?.sideEffects,
      namesFile: refusal.message.includes(API_STOP_FILE),
      events: [...harness.fake.events],
    },
    {
      code: 'NODE_SERVER_SOURCE_REFUSED',
      participant: 'apiServer',
      sideEffects: 'none',
      namesFile: true,
      events: [],
    },
  )
})

// Value: protects=F8: an unexpected failure at api-server-check says nothing started, while the same failure at attach says the API was stopped; fails_when=the check step reports partial side effects; no_claim=which errors reach the check
test('an unexpected failure at api-server-check reports sideEffects none', async () => {
  // Arrange
  const context = {
    port: 4100,
    cause: 'boom',
    journalUri: 'events',
  }
  // Act
  const atCheck = await apiServerRefusalOf(new Error('boom'), {
    ...context,
    step: 'api-server-check',
  })
  const atAttach = await apiServerRefusalOf(new Error('boom'), {
    ...context,
    step: 'api-server-attach',
  })
  // Assert
  assert.deepEqual(
    {
      checkCode: (atCheck as StudyError).code,
      checkEffects: (atCheck as StudyError).details?.sideEffects,
      attachEffects: (atAttach as StudyError).details?.sideEffects,
    },
    {
      checkCode: 'RUNTIME_FAILED',
      checkEffects: 'none',
      attachEffects: 'partial',
    },
  )
})
