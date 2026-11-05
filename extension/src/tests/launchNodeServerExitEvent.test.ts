import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE } from '../constants'
import { Cdp } from '../runtimeSupport/cdp'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'
import { launchNodeServer } from '../utils/launchNodeServer'
import { resolveNodeServerLaunch } from '../utils/resolveNodeServerLaunch'
import { signalProcessGroup } from '../utils/signalProcessGroup'

/** A script that starts a descendant sharing its output pipes, then exits at once: its own exit is known long before its pipes close. */
const SCRIPT_WITH_PIPE_HOLDING_CHILD = `
const { spawn } = require('node:child_process')
spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: ['ignore', 'inherit', 'inherit'],
})
process.exit(0)
`

// protects=the launcher reports a leader's exit event while a descendant still holds the output pipes, so a script's natural end is known; fails_when=exitedEvent or whenExitEvent wait for the pipes to close like exited does; no_claim=the debugger's own view of the end or any cleanup of the descendant beyond this test's own
test('a script that exits while its child holds the output pipes reports its exit event before the pipes close', async (t) => {
  // Arrange
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-exit-event-')),
  )
  t.after(() => rm(workspace, { recursive: true, force: true }))
  await writeFile(join(workspace, 'script.cjs'), SCRIPT_WITH_PIPE_HOLDING_CHILD)
  const launch = await resolveNodeServerLaunch(workspace, {
    packageRoot: '.',
    entry: 'script.cjs',
    loader: 'node',
  })
  let stderrText = ''
  const server = await launchNodeServer(
    {
      ...launch,
      workspace,
      node: { executable: process.execPath, version: process.versions.node },
    },
    () => undefined,
    (event) => {
      stderrText += event.channel === 'stderr' ? event.text : ''
    },
  )
  const processGroup = server.processGroup!
  t.after(() => {
    // The child that holds the pipes belongs to the leader's group; the test ends it.
    if (!isProcessGroupGone(processGroup))
      signalProcessGroup(processGroup, 'SIGKILL')
  })
  const endpoint = await server.inspectorEndpoint(AbortSignal.timeout(10_000))
  const inspector = await Cdp.connect(endpoint, () => undefined)

  // Act
  // The script exits at once, so the release is never answered.
  inspector
    .request('Runtime.runIfWaitingForDebugger', undefined)
    .catch(() => undefined)
  // Node keeps a finished program alive while a debugger is attached; it says so, and the debugger lets go.
  await waitUntil(
    () =>
      stderrText.includes(NODE_SERVER_DEBUGGER_DISCONNECT_NOTICE)
        ? true
        : undefined,
    'the notice that only the debugger keeps the script alive',
    10_000,
  )
  inspector.close()
  const exitEvent = await server.whenExitEvent()
  const closeFactAtExitEvent = server.exited()
  const eventFactAtExitEvent = server.exitedEvent()
  signalProcessGroup(processGroup, 'SIGKILL')
  await waitUntil(
    () => (server.exited() ? true : undefined),
    'the pipes to close once the child ended',
    10_000,
  )

  // Assert
  assert.deepEqual(exitEvent, { exitCode: 0, signal: null })
  assert.deepEqual(eventFactAtExitEvent, { exitCode: 0, signal: null })
  assert.equal(closeFactAtExitEvent, undefined)
  assert.deepEqual(server.exited(), { exitCode: 0, signal: null })
})
