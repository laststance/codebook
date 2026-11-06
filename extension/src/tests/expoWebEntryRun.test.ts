import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type * as ConfiguredBrowserRunModule from '../configuredBrowserRun'
import { StudyError } from '../errors'
import { EXPO_WEB_DEV_ADAPTER } from '../expoWebDevAdapter'
import type * as OwnedRepositoryBreakpointModule from '../ownedRepositoryBreakpoint'

import {
  createExpoWebRepository,
  expoWebStartRequest,
} from './utils/expoWebFixture'
import { loadModule } from './utils/loadModule'

// Value: protects=the run's real readiness path: Metro answering 500 for the entry page ends the run with EXPO_WEB_LAUNCHER_FAILED bundle-failed quoting Metro's masked message, promptly, instead of the generic "Application root failed" text; fails_when=the shared readiness check throws before the Expo bundle check reads the page; why_new=Cycle 0089 ship review F7; seam=ConfiguredBrowserRun.proveServerReady on the real Expo adapter and launcher with the fake Metro (entry-error mode); no_claim=the preparation steps around it (native check)
test('a Metro 500 for the entry page ends the run as bundle-failed with the masked message, not as a readiness error', async (context) => {
  // Arrange
  const repository = await createExpoWebRepository(context, {
    mode: 'entry-error',
    files: { '.env': 'EXPO_PUBLIC_API_KEY=pk-live-abc123xyz\n' },
  })
  const controller = new AbortController()
  const prepared = await expoWebStartRequest(repository, controller.signal)
  context.after(async () => {
    await prepared.handle.app?.close()
  })
  const { app } = await EXPO_WEB_DEV_ADAPTER.start(prepared.request)
  // The run module needs only an editor stand-in at load time; no editor API is called on this path.
  const vscode = {}
  const breakpointModule = await loadModule<
    typeof OwnedRepositoryBreakpointModule
  >(resolve(__dirname, '../ownedRepositoryBreakpoint.js'), { vscode })
  const { ConfiguredBrowserRun } = await loadModule<
    typeof ConfiguredBrowserRunModule
  >(resolve(__dirname, '../configuredBrowserRun.js'), {
    vscode,
    './ownedRepositoryBreakpoint': breakpointModule,
    './runtimeSupport/hostBrowser': { HostBrowser: class {} },
  })
  const run = Object.create(ConfiguredBrowserRun.prototype) as Record<
    string,
    unknown
  >
  Object.assign(run, {
    app,
    abort: controller,
    definition: { configuration: {} },
    preparationDeadlineAt: Date.now() + 60_000,
    setupStep: 'waiting-for-server',
    session: 'fresh',
    readiness: { wasSent: false },
  })
  const startedAtMs = Date.now()
  // Act
  const error = await (
    run.proveServerReady as (...values: unknown[]) => Promise<string>
  )
    .call(run, EXPO_WEB_DEV_ADAPTER, false, repository.port)
    .then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'EXPO_WEB_LAUNCHER_FAILED')
  assert.equal(error.details?.reason, 'bundle-failed')
  const bundlerLine = String(error.details?.bundlerLine)
  assert.match(bundlerLine, /^Metro could not render the entry page/)
  assert.equal(bundlerLine.includes('pk-live-abc123xyz'), false)
  assert.ok(Date.now() - startedAtMs < 20_000)
})
