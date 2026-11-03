import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { PACKAGE_ROOT_FRESH_SESSION_RECOVERY } from '../errors'
import type { RepositoryOperation } from '../repositoryConfigSchemas'
import type { RuntimeControl } from '../runtime'
import { describeSignInRequiredDetails } from '../utils/describeSignInRequiredDetails'
import { refusalFailureOf } from '../utils/refusalFailureOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'

const click: RepositoryOperation = {
  kind: 'click',
  title: 'Pending',
  selector: '#pending',
}
/** A redirect of the entry page to the sign-in page, as the app's proxy answers a request without a session. */
const REDIRECT_TO_LOGIN = { status: 307, location: '/login' } as const

/** Builds the control the service gives a run. @example controlOf(context) */
function controlOf(context: TestContext): RuntimeControl {
  const abort = new AbortController()
  context.after(() => abort.abort())
  return {
    signal: abort.signal,
    deadlineAt: Date.now() + 300_000,
    preparationDeadlineAt: Date.now() + 300_000,
    runId: 'service-run-9',
  }
}

/** Opens a version 3 harness whose repository has a saved session; `packageRoot` makes it a run of a nested package. @example await harness(context, 'examples/app') */
async function harness(
  context: TestContext,
  packageRoot?: string,
  options: Parameters<typeof configuredRuntimeHarness>[3] = {},
) {
  return configuredRuntimeHarness(context, controlOf(context), [], {
    entryPath: '/dashboard',
    savedSession: { admission: 'saved' },
    ...options,
    ...(packageRoot === undefined ? {} : { packageRoot }),
    operations: {
      operations: [click],
      stopOperations: [1],
      signInPaths: ['/login'],
    },
  })
}

/** Copies a value out of the run module's realm. @example plain(run.view().session) */
function plain<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value))
}

// Value: protects=AC 14 / D11 / S15 (run side): a run of a package below the root starts fresh, never asks the store (no lock, no profile, no remembered paths) and names the skip; fails_when=the run loads or locks the repository's saved session, remembers its sign-in paths, or the view lacks session fresh / savedSessionSkipped package-root; no_claim=real cookies, a real page, the service's resource (a later test)
test('a run with a packageRoot below the root starts fresh and never touches the repository saved session', async (context) => {
  // Arrange
  const nested = await harness(context, 'examples/app')

  // Act
  await nested.run.prepare()

  // Assert
  const view = nested.run.view()
  assert.equal(view.session, 'fresh')
  assert.equal(view.savedSessionSkipped, 'package-root')
  assert.equal('appState' in view, false)
  assert.equal('savedSession' in view, false)
  assert.deepEqual(nested.savedProfileFolders, [])
  assert.equal(
    nested.savedSessionCalls.some(
      (call) => call === 'remember' || call.startsWith('acquire'),
    ),
    false,
  )
})

// Value: protects=AC 14 regression / AC 6: a root run (no packageRoot) of the same repository still loads its saved session and remembers its sign-in paths; fails_when=the skip leaks to root runs (session fresh, or savedSessionSkipped set); no_claim=packageRoot "." spelled out (the config schema drops it)
test('a root run in the same repository still loads its saved session', async (context) => {
  // Arrange
  const root = await harness(context)

  // Act
  await root.run.prepare()

  // Assert
  const view = root.run.view()
  assert.equal(view.session, 'saved')
  assert.equal(view.appState, 'kept')
  assert.equal('savedSessionSkipped' in view, false)
  assert.deepEqual(root.savedSessionCalls.slice(0, 2), [
    'remember',
    'acquire:service-run-9:saved-if-available',
  ])
})

// Value: protects=T8/DX-11 (run side): a nested run whose entry redirects to sign-in is refused with reason package-root-fresh-session, raises no Set Up Saved Session notice and opens no browser; fails_when=the reason reads no-saved-session, or the editor is told to offer the setup; no_claim=the service's recovery (unit test below)
test('a nested run that meets the sign-in page is refused as package-root-fresh-session and offers no setup notice', async (context) => {
  // Arrange
  const nested = await harness(context, 'examples/app', {
    entryAnswer: REDIRECT_TO_LOGIN,
  })

  // Act
  await assert.rejects(nested.run.prepare())

  // Assert
  assert.match(
    nested.run.view().failures[0]!,
    /^SIGN_IN_REQUIRED\(package-root-fresh-session\): The page landed on \/login; the run declared a packageRoot other than "\.", so it started with a fresh profile and did not use the saved session of /,
  )
  assert.deepEqual(plain(nested.signInNotices), [])
  assert.equal(nested.launchConfigurations.length, 0)
})

// Value: protects=DX-11: the restored refusal carries details.reason package-root-fresh-session with its own recovery (no setup), and its details name no setup command; fails_when=the general setup recovery or the codebook.setUpSavedSession command is offered for a package below the root; no_claim=the run's detection (run tests above)
test('the package-root sign-in refusal carries its own recovery and no setup command', () => {
  // Arrange
  const text =
    'SIGN_IN_REQUIRED(package-root-fresh-session): The page landed on /login; the run declared a packageRoot other than ".".'

  // Act
  const refusal = refusalFailureOf(text)
  const details = describeSignInRequiredDetails({
    reason: 'package-root-fresh-session',
    session: 'fresh',
    sent: 'not-sent',
    logId: 'r1#start',
  })

  // Assert
  assert.equal(refusal?.recoveryOverride, PACKAGE_ROOT_FRESH_SESSION_RECOVERY)
  assert.deepEqual(refusal?.details, { reason: 'package-root-fresh-session' })
  assert.match(
    PACKAGE_ROOT_FRESH_SESSION_RECOVERY,
    /this app cannot sign in below the root in this version/,
  )
  assert.deepEqual(details, {
    reason: 'package-root-fresh-session',
    session: 'fresh',
    sent: 'not-sent',
    sideEffects: 'none',
    retry:
      'Do not set up a saved session: this app cannot sign in below the root in this version. Change the flow to one that needs no sign-in, then start one new run.',
    logId: 'r1#start',
  })
})

// Value: protects=AC 14 resource: the run resource serves savedSessionSkipped package-root beside session fresh, and a run that skipped nothing has no such field; fails_when=the service drops the field; no_claim=the run's own view (run tests)
test('the run resource reads savedSessionSkipped package-root for a nested run and omits it otherwise', async (context) => {
  // Arrange
  const start = async (skipped: boolean) => {
    const service = await configuredServiceHarness(
      context,
      undefined,
      (directory, definition) => {
        const runtime = new ControlledOperationsRuntime(directory, definition)
        runtime.session = 'fresh'
        if (skipped) runtime.savedSessionSkipped = 'package-root'
        return runtime
      },
    )
    const { configuration } = service
    const receipt = service.service.start({
      instanceId: service.service.instanceId,
      profile: 'repository-browser',
      key: 'k',
      configuration: {
        version: 3,
        adapter: configuration.adapter,
        book: configuration.book,
        source: configuration.source,
        participant: 'browser',
        afterOperation: 1,
        before: configuration.action.before,
        after: configuration.action.after,
        operations: [click],
        inspections: configuration.inspections,
      },
    })
    const record = service.service.record(receipt)
    await record.preparation
    return service.service.state(record)
  }

  // Act
  const nestedState = await start(true)
  const rootState = await start(false)

  // Assert
  assert.equal(nestedState.session, 'fresh')
  assert.equal(nestedState.savedSessionSkipped, 'package-root')
  assert.equal('savedSessionSkipped' in rootState, false)
})
