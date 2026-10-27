import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { waitUntil } from '../../runtimeSupport/utils/waitUntil'
import { isProcessGroupGone } from '../../utils/isProcessGroupGone'

import { freeLoopbackPort } from './freeLoopbackPort'

/** The test-only HTTP server as compiled beside the tests; it never ships. */
const FIXTURE_SERVER = join(__dirname, '../fixtures/node-server/server.js')

/** A fixture server started for one test. */
export type StartedFixtureServer = {
  pid: number
  /** The group the fixture leads (it is started detached). */
  processGroup: number
  port: number
  /** The fixture's working folder (realpath). */
  workspace: string
}

/**
 * Says whether a loopback address accepts a connection on the port now.
 * @param host - The address.
 * @param port - The port.
 * @returns `true` when it accepts.
 * @example await accepts('127.0.0.1', 4100) // => true
 */
function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Starts the test-only fixture server in its own folder and process group, waits until it accepts, and ends its whole group (and checks it is gone) when the test ends.
 * @param context - The test.
 * @param settings - The fixture's settings: `host` (`127.0.0.1` by default) and `mode` (`listen` by default; `fork` makes a child listen).
 * @returns The started server's identity.
 * @example const server = await startFixtureServer(t, { mode: 'fork' })
 */
export async function startFixtureServer(
  context: TestContext,
  settings: { host?: string; mode?: string } = {},
): Promise<StartedFixtureServer> {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-fixture-server-')),
  )
  const port = await freeLoopbackPort()
  const host = settings.host ?? '127.0.0.1'
  await copyFile(FIXTURE_SERVER, join(workspace, 'server.cjs'))
  await writeFile(
    join(workspace, 'fixture-server.json'),
    JSON.stringify({ mode: 'listen', ...settings, host, port }),
  )
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: workspace,
    detached: true,
    stdio: 'ignore',
  })
  // A spawn failure fails the start instead of surfacing as an uncaught exception.
  const spawnFailure = new Promise<never>((_, reject) =>
    child.once('error', reject),
  )
  const pid = child.pid
  context.after(async () => {
    try {
      if (pid !== undefined) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // The group is already gone.
        }
        await waitUntil(
          () => isProcessGroupGone(pid),
          'the fixture group to end',
          10_000,
        )
      }
    } finally {
      // The folder goes even when the group did not end in time.
      await rm(workspace, { recursive: true, force: true })
    }
    // Every port the fixture took is free again.
    if (await accepts(host, port))
      throw new Error(`Port ${port} still accepts after the fixture ended.`)
  })
  await Promise.race([
    spawnFailure,
    waitUntil(() => accepts(host, port), 'the fixture to listen', 15_000),
  ])
  if (pid === undefined) throw new Error('The fixture server did not start.')
  return { pid, processGroup: pid, port, workspace }
}
