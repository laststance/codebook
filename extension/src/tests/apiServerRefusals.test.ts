import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  API_SERVER_EXITED_VARIANT,
  apiServerExitedRefusal,
  apiServerListenerNotOwnedRefusal,
  apiServerNotListeningRefusal,
  apiServerPortOwnerUnknownRefusal,
  apiServerPortUnavailableRefusal,
  apiServerRuntimeFailedRefusal,
  apiServerSourceRefusal,
} from '../apiServerRefusals'
import type { StudyError } from '../errors'
import {
  expoWebApiPortConflictRefusal,
  expoWebApiSourceDriftRefusal,
  expoWebApiSourceUnverifiableRefusal,
} from '../expoWebRefusals'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'

/** Reads the recovery an agent would see from a refusal. */
function recoveryOf(error: StudyError): string {
  return error.describe().recovery
}

// Value: protects=DX-9 a static port conflict names both ports, says nothing started and carries the ports as details; fails_when=the message drops a port, claims a started process or loses the unsupported reason; no_claim=that the ports were read from a real script
test('the API port conflict refusal names both ports and says nothing started', () => {
  // Arrange / Act
  const error = expoWebApiPortConflictRefusal(8081, 8081)
  // Assert
  assert.equal(error.code, 'EXPO_WEB_UNSUPPORTED')
  assert.equal(
    error.message,
    "apiServer.port 8081 is the port the app's web script declares (8081); declare the port the API's own code listens on, or tell the learner the API and the app cannot share a port. Nothing started.",
  )
  assert.deepEqual(error.details, {
    reason: 'api-port-conflict',
    port: 8081,
    appPort: 8081,
    sideEffects: 'none',
  })
})

// Value: protects=OV-4 a source drift and an unverifiable source are separate seal refusals for the API, each with the file, the apiServer participant and partial side effects; fails_when=either reason is missing, the participant is dropped, or the recovery says the file is the declared line; no_claim=how the seal reads the map
test('the API seal refusals name the file, the apiServer participant and partial side effects', () => {
  // Arrange / Act
  const drift = expoWebApiSourceDriftRefusal('apps/api/src/handler.ts')
  const unverifiable = expoWebApiSourceUnverifiableRefusal(
    'apps/api/src/handler.ts',
  )
  // Assert
  assert.deepEqual(drift.details, {
    reason: 'source-drift',
    participant: 'apiServer',
    file: 'apps/api/src/handler.ts',
    sideEffects: 'partial',
  })
  assert.deepEqual(unverifiable.details, {
    reason: 'source-unverifiable',
    participant: 'apiServer',
    file: 'apps/api/src/handler.ts',
    sideEffects: 'partial',
  })
  for (const error of [drift, unverifiable]) {
    assert.equal(error.code, 'EXPO_WEB_SEAL_FAILED')
    assert.match(
      recoveryOf(error),
      /See codebook:\/\/help\/repository-browser#EXPO_WEB_SEAL_FAILED\.$/,
    )
  }
  assert.match(recoveryOf(unverifiable), /TypeScript source/)
})

// Value: protects=DX-3 DX-11 a launch refusal worded by the node-server profile is reworded with apiServer field names, carries the participant and points at the API anchor; fails_when=a node-server's wording survives, or the anchor is the node-server help; no_claim=the wording of the original refusals
test('the API source refusal names apiServer fields instead of the node-server profile', () => {
  // Arrange
  const message =
    "node-server's entry src/server.ts is not a file inside packageRoot apps/api by its real path."
  // Act
  const error = apiServerSourceRefusal(message)
  const tsx = apiServerSourceRefusal(
    "node-server's tsx for apps/api (tsx) lies outside the opened repository by its real path.",
  )
  // Assert
  assert.equal(error.code, 'NODE_SERVER_SOURCE_REFUSED')
  assert.equal(
    error.message,
    'apiServer.entry src/server.ts is not a file inside packageRoot apps/api by its real path.',
  )
  assert.match(tsx.message, /^the API's tsx for apps\/api/)
  assert.deepEqual(error.details, {
    participant: 'apiServer',
    sideEffects: 'none',
  })
  assert.match(
    recoveryOf(error),
    /See codebook:\/\/help\/repository-browser#api-server-NODE_SERVER_SOURCE_REFUSED\.$/,
  )
  assert.ok(!recoveryOf(error).includes('codebook://help/node-server'))
})

// Value: protects=DX-7 a taken API port names the occupant when known, tells the chat to ask the learner or start without apiServer, never to end the process, and says nothing started; fails_when=the occupant is dropped or the recovery loses the way out; no_claim=the port check itself
test('the API port refusal names the occupant, the way out and that nothing started', () => {
  // Arrange / Act
  const known = apiServerPortUnavailableRefusal(4100, {
    pid: 99,
    command: 'node',
  })
  const unknown = apiServerPortUnavailableRefusal(4100)
  // Assert
  assert.equal(known.code, 'PORT_UNAVAILABLE')
  assert.equal(
    known.message,
    'Process 99 (node) listens on apiServer.port 4100, so Codebook did not start the API.',
  )
  assert.deepEqual(known.details, {
    participant: 'apiServer',
    port: 4100,
    occupant: { pid: 99, command: 'node' },
    sideEffects: 'none',
  })
  assert.equal('occupant' in (unknown.details ?? {}), false)
  assert.match(
    recoveryOf(known),
    /start again without apiServer to keep using their API with browser stops only; never end that process yourself\. Nothing started\./,
  )
})

// Value: protects=DX-6 an API that exited reports the exit, the masked output tail, partial side effects and a recovery that forbids starting services or editing .env; fails_when=the tail or the signal is dropped, or the recovery speaks of the node-server profile; no_claim=the masking of the tail (the caller masks)
test('the API exited refusal carries exit, output tail and a learner-first recovery', () => {
  // Arrange / Act
  const error = apiServerExitedRefusal(
    { exitCode: 1, signal: null },
    'connect ECONNREFUSED 127.0.0.1:5433',
  )
  const killed = apiServerExitedRefusal(
    { exitCode: null, signal: 'SIGKILL' },
    '',
  )
  // Assert
  assert.equal(error.code, 'SERVER_EXITED')
  assert.deepEqual(error.details, {
    participant: 'apiServer',
    exitCode: 1,
    signal: null,
    outputTail: 'connect ECONNREFUSED 127.0.0.1:5433',
    sideEffects: 'partial',
  })
  assert.match(error.message, /^The API exited with code 1\. Its last output/)
  assert.equal(
    killed.message,
    'The API exited with signal SIGKILL. It printed nothing.',
  )
  assert.match(
    recoveryOf(error),
    /never start services, edit \.env or run the API's scripts yourself/,
  )
  assert.match(
    recoveryOf(error),
    /See codebook:\/\/help\/repository-browser#api-server-SERVER_EXITED\.$/,
  )
})

// Value: protects=DX-4 DX-10 the remaining API codes (listener not owned, owner unknown, not listening, runtime failed) keep their reused code, the apiServer participant, the step or journal, the side effects and their own anchor; fails_when=a code, step, journal or anchor is wrong; no_claim=the checks that raise them
test('the other API refusals keep their code, participant, step, journal and anchor', () => {
  // Arrange / Act
  const foreign = apiServerListenerNotOwnedRefusal('Process 7 answers.', 4100)
  const unknown = apiServerPortOwnerUnknownRefusal('lsof is missing.', 4100)
  const silent = apiServerNotListeningRefusal(4100, 'api-server-listen', 4200)
  const failed = apiServerRuntimeFailedRefusal(
    'api-server-attach',
    'attach refused.',
    'codebook://runs/1/journal',
  )
  // Assert
  assert.deepEqual(
    [foreign, unknown, silent, failed].map((error) => error.code),
    [
      'LISTENER_NOT_OWNED',
      'PORT_OWNER_UNKNOWN',
      'SERVER_NOT_LISTENING',
      'RUNTIME_FAILED',
    ],
  )
  for (const error of [foreign, unknown, silent, failed]) {
    assert.equal(error.details?.participant, 'apiServer')
    assert.equal(error.details?.sideEffects, 'partial')
  }
  // Literal anchors, one per code, so the helper that builds them is not its own oracle.
  const anchors = [foreign, unknown, silent, failed].map(
    (error) => /See (\S+)\.$/.exec(recoveryOf(error))?.[1],
  )
  assert.deepEqual(anchors, [
    'codebook://help/repository-browser#api-server-LISTENER_NOT_OWNED',
    'codebook://help/repository-browser#api-server-PORT_OWNER_UNKNOWN',
    'codebook://help/repository-browser#api-server-SERVER_NOT_LISTENING',
    'codebook://help/repository-browser#api-server-RUNTIME_FAILED',
  ])
  assert.equal(silent.details?.step, 'api-server-listen')
  assert.equal(
    silent.message,
    'The API did not listen on apiServer.port 4100 in time. The started process listens on port 4200: declare apiServer.port 4200.',
  )
  assert.equal(failed.details?.step, 'api-server-attach')
  assert.equal(failed.details?.journal, 'codebook://runs/1/journal')
})

// Value: protects=E-6 a timer-raised API exit travels as text with the api-server variant and is restored with its code, the API recovery and the apiServer details, while a SERVER_EXITED text without the variant is not a coded failure; fails_when=the variant is not read, the node-server recovery returns, or an unvarianted text is coded; no_claim=the arbiter that decides between exit and transport loss
test('refusalFailureOf restores SERVER_EXITED only with the api-server variant', () => {
  // Arrange
  const text = formatRefusalFailure(
    'SERVER_EXITED',
    'The API exited with code 1.',
    API_SERVER_EXITED_VARIANT,
  )
  // Act
  const restored = refusalFailureOf(text)
  const plain = refusalFailureOf(
    'SERVER_EXITED: The server exited with code 3.',
  )
  // Assert
  assert.equal(text, 'SERVER_EXITED(api-server): The API exited with code 1.')
  assert.equal(restored?.code, 'SERVER_EXITED')
  assert.equal(restored?.message, 'The API exited with code 1.')
  assert.deepEqual(restored?.libraryDetails, {
    participant: 'apiServer',
    sideEffects: 'partial',
    outputTail: '',
  })
  assert.match(
    restored?.recoveryOverride ?? '',
    /never start services, edit \.env/,
  )
  assert.equal(plain, undefined)
})
