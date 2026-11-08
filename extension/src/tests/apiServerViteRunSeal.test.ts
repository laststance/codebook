import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import {
  API_STOP_FILE,
  apiScriptText,
  apiServerHit,
  apiServerRunHarness,
  sendApiRequest,
  type ApiServerRunHarness,
} from './utils/apiServerRunHarness'
import { sendOperation } from './utils/routeHandlerRunHarness'

/**
 * Prepares a vite-dev run that declares `apiServer`, sends operation 1 and one proxied API request, then delivers the API pause with the given executed script and waits for the run to fail.
 * Why it exists: both seal refusals of a Vite run start the same way and differ only in the script the API executed.
 * Called by the tests of this file.
 * @param harness - The run's harness (a `vite-dev` run).
 * @param scriptText - The text `Debugger.getScriptSource` answers for the stop's module.
 * @returns The failure text the run recorded first.
 * @example const failure = await hitSealedScript(harness, 'const x = 1;')
 */
async function hitSealedScript(
  harness: ApiServerRunHarness,
  scriptText: string,
): Promise<string> {
  await harness.run.prepare()
  await sendOperation(harness, 1)
  sendApiRequest(harness, { id: '7', path: '/api/rpc/x' })
  await apiServerHit(harness, { scriptText })
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the seal refusal',
  )
  return harness.run.view().failures[0]!
}

/**
 * Reads a seal failure text the way the service restores it: code, details and whether the recovery names the Vite help anchor.
 * Called by the tests of this file.
 * @param failure - The failure text a failed run recorded.
 * @example restoredSealRefusal('VITE_SEAL_FAILED(api-seal:…): …').code // => 'VITE_SEAL_FAILED'
 */
function restoredSealRefusal(failure: string) {
  const restored = refusalFailureOf(failure)
  return {
    code: restored?.code,
    details: restored?.libraryDetails
      ? { ...restored.libraryDetails }
      : undefined,
    recoveryAnchor: restored?.recoveryOverride?.includes(
      'codebook://help/repository-browser#VITE_SEAL_FAILED.',
    ),
  }
}

// Value: protects=test 33 (D20, D30) source-drift: an API script whose map retains another version of the stop file ends the vite-dev run as VITE_SEAL_FAILED with reason, participant apiServer, file and sideEffects partial, and the API is killed before the handler resumes; fails_when=the Vite run keeps the Expo code, loses the reason, participant or file, resumes the handler, or does not kill the API; no_claim=a real tsx output or a real kill (ownedApiServer.test.ts)
test('an API script with another version of the stop file ends the vite-dev run with VITE_SEAL_FAILED source-drift and the API is killed before the handler resumes', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  // Act
  const failure = await hitSealedScript(
    harness,
    apiScriptText(
      harness.server!.sealedUrl.replace('file://', ''),
      'var nextTheme = "edited";\n',
    ),
  )
  // Assert
  const events = harness.fake.events
  assert.deepEqual(
    {
      refusal: restoredSealRefusal(failure),
      killedFirst: events.includes('kill-first'),
      killBeforeClose:
        events.indexOf('close') === -1 ||
        events.indexOf('kill-first') < events.indexOf('close'),
      continues: harness.server!.continues.length,
      snapshots: harness.run.view().snapshots.length,
    },
    {
      refusal: {
        code: 'VITE_SEAL_FAILED',
        details: {
          reason: 'source-drift',
          participant: 'apiServer',
          file: API_STOP_FILE,
          sideEffects: 'partial',
        },
        recoveryAnchor: true,
      },
      killedFirst: true,
      killBeforeClose: true,
      // Only the entry pause was released; the handler's pause never resumed.
      continues: 1,
      snapshots: 0,
    },
  )
})

// Value: protects=test 33 (D20, D30) source-unverifiable: an API script without an inline map ends the vite-dev run as VITE_SEAL_FAILED with reason source-unverifiable, participant apiServer, file and sideEffects partial, and the handler never resumes; fails_when=the disk file is taken as proof, the code stays Expo's, or the handler continues; no_claim=tsx's real output
test('an API script without an inline map ends the vite-dev run with VITE_SEAL_FAILED source-unverifiable and the handler never resumes', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context, { adapter: 'vite-dev' })
  // Act
  const failure = await hitSealedScript(harness, 'const nextTheme = "dark";')
  // Assert
  assert.deepEqual(
    {
      refusal: restoredSealRefusal(failure),
      killedFirst: harness.fake.events.includes('kill-first'),
      continues: harness.server!.continues.length,
      snapshots: harness.run.view().snapshots.length,
    },
    {
      refusal: {
        code: 'VITE_SEAL_FAILED',
        details: {
          reason: 'source-unverifiable',
          participant: 'apiServer',
          file: API_STOP_FILE,
          sideEffects: 'partial',
        },
        recoveryAnchor: true,
      },
      killedFirst: true,
      continues: 1,
      snapshots: 0,
    },
  )
})
