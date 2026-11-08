import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  apiSourceDriftRefusal,
  apiSourceUnverifiableRefusal,
} from '../apiSealRefusals'
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
import { expoWebHelp } from '../expoWebHelp'
import { expoWebApiPortConflictRefusal } from '../expoWebRefusals'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'
import {
  viteApiPortConflictRefusal,
  viteApiRunPortUnavailableRefusal,
} from '../viteApiServerRefusals'
import { viteHelp } from '../viteHelp'

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
  const drift = apiSourceDriftRefusal(
    'EXPO_WEB_SEAL_FAILED',
    'apps/api/src/handler.ts',
  )
  const unverifiable = apiSourceUnverifiableRefusal(
    'EXPO_WEB_SEAL_FAILED',
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

// Value: protects=D20: the VITE_SEAL_FAILED API refusal carries the whole contract (code, message, reason, participant, file, partial side effects) and an API-worded recovery that never says edit or build; fails_when=a detail is dropped, the Vite recovery for app stops is reused, or the anchor is not the Vite one; no_claim=when the seal raises it
test('a Vite API source drift refusal carries code, details and an API-worded recovery', () => {
  // Arrange / Act
  const error = apiSourceDriftRefusal(
    'VITE_SEAL_FAILED',
    'apps/api/src/handler.ts',
  )
  // Assert
  assert.deepEqual(error.describe(), {
    code: 'VITE_SEAL_FAILED',
    message:
      "The API ran a different version of apps/api/src/handler.ts than the stop declares (the source its map carries is not the declared file), so the stop was not shown. The API and the app were stopped; an operation already sent may have changed the application's data.",
    cause:
      "The API ran a different version of apps/api/src/handler.ts than the stop declares (the source its map carries is not the declared file), so the stop was not shown. The API and the app were stopped; an operation already sent may have changed the application's data.",
    recovery:
      "Tell the learner the API ran another version of details.file than the repository's current one (a stale build, or an edit after the study was declared); never edit the project. Declare the stop again from the current file, then one new start. The API and the app were stopped; an operation already sent may have changed the application's data. Recovery: fix it, then one new start. See codebook://help/repository-browser#VITE_SEAL_FAILED.",
    docs: 'codebook://help/errors',
    details: {
      reason: 'source-drift',
      participant: 'apiServer',
      file: 'apps/api/src/handler.ts',
      sideEffects: 'partial',
    },
  })
})

// Value: protects=D20: an unverifiable Vite API source tells the chat to declare the TypeScript source run through tsx and never to edit or build; fails_when=the recovery loses the tsx remedy or allows a build; no_claim=how the seal reads the map
test('a Vite API source unverifiable refusal tells the chat to declare the tsx source and never edit or build', () => {
  // Arrange / Act
  const error = apiSourceUnverifiableRefusal('VITE_SEAL_FAILED', 'api/a.ts')
  // Assert
  assert.equal(error.details?.reason, 'source-unverifiable')
  assert.match(
    recoveryOf(error),
    /through tsx, then one new start; never edit or build the project\./,
  )
})

// Value: protects=D21 D27: a port conflict from the dev script is refused with sideEffects none, one from the config or Vite default with partial side effects that say the API started and stopped; fails_when=the side effects, a port, the source or the started-and-stopped sentence is wrong; no_claim=where the ports are read
test('a Vite API port conflict names both ports, the source and whether the API was started', () => {
  // Arrange / Act
  const fromScript = viteApiPortConflictRefusal({
    apiPort: 5001,
    vitePort: 5001,
    portSource: 'dev-script',
  })
  const fromDefault = viteApiPortConflictRefusal({
    apiPort: 5173,
    vitePort: 5173,
    portSource: 'vite-default',
  })
  // Assert
  assert.equal(fromScript.code, 'VITE_UNSUPPORTED')
  assert.equal(
    fromScript.message,
    "apiServer.port 5001 is the port the Vite dev script's --port declares (5001); declare the port the API's own code listens on, or tell the learner the API and the app cannot share a port. Nothing started.",
  )
  assert.deepEqual(fromScript.details, {
    reason: 'api-port-conflict',
    apiPort: 5001,
    vitePort: 5001,
    portSource: 'dev-script',
    sideEffects: 'none',
  })
  assert.equal(
    fromDefault.message,
    "apiServer.port 5173 is Vite's default port, since neither the dev script nor the config declares one (5173); declare the port the API's own code listens on, or tell the learner the API and the app cannot share a port. The API was started and stopped and no input was sent.",
  )
  assert.deepEqual(fromDefault.details, {
    reason: 'api-port-conflict',
    apiPort: 5173,
    vitePort: 5173,
    portSource: 'vite-default',
    sideEffects: 'partial',
  })
  assert.match(
    recoveryOf(fromDefault),
    /The API was started and stopped and no input was sent\. Recovery: fix it, then one new start\. See codebook:\/\/help\/repository-browser#VITE_UNSUPPORTED\.$/,
  )
})

// Value: protects=D27c: a taken Vite port in an apiServer run says the API was started and stopped and carries partial side effects, not "nothing was started"; fails_when=the recovery still claims nothing started or the details lose the side effects; no_claim=the port probe
test('a taken Vite port in an apiServer run is VITE_PORT_UNAVAILABLE with partial side effects', () => {
  // Arrange / Act
  const error = viteApiRunPortUnavailableRefusal(
    { port: 5173, reason: 'in-use' },
    'the Vite config',
  )
  // Assert
  assert.equal(error.code, 'VITE_PORT_UNAVAILABLE')
  assert.match(
    error.message,
    /^Port 5173 \(the Vite config\) is in use on this machine.* The API was started and stopped and no input was sent\.$/,
  )
  assert.deepEqual(error.details, { port: 5173, sideEffects: 'partial' })
  assert.ok(!recoveryOf(error).includes('Nothing was started.'))
  assert.match(
    recoveryOf(error),
    /The API was started and stopped and no input was sent\./,
  )
})

// Value: protects=D30: both adapters' help words source-drift and source-unverifiable, the Vite rows under VITE_SEAL_FAILED with the shared reason anchors; fails_when=either adapter loses a row or the Vite row has another code or anchor; no_claim=the wording of the rows
test('the Vite and Expo help both carry source-drift and source-unverifiable rows', () => {
  // Arrange
  const viteRows: Record<
    string,
    { code: string; anchor: string; meaning: string } | undefined
  > = viteHelp().vitePackageRoot.refusals
  const expoRows: Record<string, string | undefined> =
    expoWebHelp().expoWebQuickStart.refusals.EXPO_WEB_SEAL_FAILED?.reasons ?? {}
  // Act
  const viteDrift = viteRows['source-drift']
  const viteUnverifiable = viteRows['source-unverifiable']
  // Assert
  assert.equal(viteDrift?.code, 'VITE_SEAL_FAILED')
  assert.equal(
    viteDrift?.anchor,
    'codebook://help/repository-browser#source-drift',
  )
  assert.equal(viteUnverifiable?.code, 'VITE_SEAL_FAILED')
  assert.equal(
    viteUnverifiable?.anchor,
    'codebook://help/repository-browser#source-unverifiable',
  )
  assert.ok(expoRows['source-drift']?.includes('details.sideEffects: partial'))
  assert.ok(
    expoRows['source-unverifiable']?.includes('details.sideEffects: partial'),
  )
  assert.ok(viteDrift?.meaning.includes('details.sideEffects: partial'))
  assert.ok(viteUnverifiable?.meaning.includes('details.sideEffects: partial'))
})
