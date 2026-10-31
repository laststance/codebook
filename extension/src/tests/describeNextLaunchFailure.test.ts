import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { assertDevelopmentPortFree } from '../utils/assertDevelopmentPortFree'
import { describeNextLaunchFailure } from '../utils/describeNextLaunchFailure'
import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'
import { maskNextServerOutput } from '../utils/maskNextServerOutput'
import { readDeclaredDevelopmentPort } from '../utils/readDeclaredDevelopmentPort'
import { readRepositoryAdapterReadiness } from '../utils/readRepositoryAdapterReadiness'

/**
 * Creates a temporary project whose `package.json` has this `dev` script.
 * @returns The workspace root.
 */
async function projectWithDevScript(
  context: TestContext,
  scripts: Record<string, string>,
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-next-launch-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'stand-in', scripts }),
  )
  return workspace
}

// Value: protects=a Pages launch or compile failure tells the learner the preparation Codebook skipped and that Codebook ran Next with webpack (version and command) when the dev script runs Turbopack; fails_when=either sentence is missing, or the command differs from the launcher's; why_new=Cycle 0065 Turbopack hint and skipped preparation at failure; seam=temporary package.json; no_claim=the readiness notes (repositoryAdapterReadiness tests)
test('a Pages launch failure of a Turbopack dev script with a preparation step names the skipped step and the webpack command', async (context) => {
  // Arrange
  const workspace = await projectWithDevScript(context, {
    dev: 'prisma generate && next dev',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    workspace,
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.deepEqual(notes, [
    'Codebook starts Next with --webpack and skips 1 statement(s) before `next dev` in package.json scripts.dev. Whether that preparation is done has not been checked.',
    'Codebook runs your Next app with webpack (`next dev --webpack`) even when your dev script uses Turbopack. The page is built from the same source; a Turbopack-only loader or setting has no effect during the run.',
    'Codebook ran Next 16.4.3 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.',
  ])
})

// Value: protects=a Pages launch or compile failure of a dev script that only sets an environment setting before next dev still names that setting, as the readiness notes do; fails_when=a none preparation drops its envSettings sentence at failure; why_new=Cycle 0066 task 45 (env-only dev script lost its unapplied-environment sentence); seam=temporary package.json; no_claim=the setting's value, which is never named
test('a Pages launch failure of a dev script that only sets NODE_OPTIONS names the environment setting Codebook does not apply', async (context) => {
  // Arrange
  const workspace = await projectWithDevScript(context, {
    dev: 'NODE_OPTIONS=--max-old-space-size=8192 next dev',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    workspace,
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.deepEqual(notes, [
    'Codebook does not apply these environment settings from scripts.dev: NODE_OPTIONS.',
    'Codebook runs your Next app with webpack (`next dev --webpack`) even when your dev script uses Turbopack. The page is built from the same source; a Turbopack-only loader or setting has no effect during the run.',
    'Codebook ran Next 16.4.3 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.',
  ])
})

// Value: protects=a dev script that already asks for webpack and prepares nothing adds no note; fails_when=the compatibility sentence or a preparation sentence appears; why_new=Cycle 0065 Turbopack hint only without --webpack; seam=temporary package.json; no_claim=none
test('a Pages launch failure of a plain webpack dev script adds no note', async (context) => {
  // Arrange
  const workspace = await projectWithDevScript(context, {
    dev: 'next dev --webpack -p 3000',
  })
  // Act
  const notes = await describeNextLaunchFailure({
    workspace,
    nextVersion: '16.4.3',
    port: 3000,
  })
  // Assert
  assert.deepEqual(notes, [])
})

/**
 * Creates a temporary Next project with a `pages` folder, this `dev` script, and a stand-in Next that prints the arguments it was started with and keeps running.
 * @returns The workspace root.
 */
async function nextProjectWithStandInNext(
  context: TestContext,
  dev: string,
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-next-flag-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  await mkdir(join(workspace, 'node_modules/next/dist/bin'), {
    recursive: true,
  })
  await mkdir(join(workspace, 'pages'))
  await writeFile(
    join(workspace, 'node_modules/next/dist/bin/next'),
    "process.stdout.write(`next ${process.argv.slice(2).join(' ')}\\n`); setInterval(() => {}, 1000)",
  )
  await writeFile(
    join(workspace, 'node_modules/next/package.json'),
    JSON.stringify({ name: 'next', version: '16.0.1' }),
  )
  await writeFile(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'stand-in', scripts: { dev } }),
  )
  return workspace
}

/**
 * Holds a loopback port with a listener for the rest of the test, so a port check refuses it.
 * @returns The busy port.
 */
async function busyLoopbackPort(context: TestContext): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  return (server.address() as AddressInfo).port
}

/** Waits until a launched server's published output holds a text. */
async function untilOutputHolds(
  outputTail: () => string,
  text: string,
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!outputTail().includes(text)) {
    // gstack-timing-ok: a poll with a deadline; the bound only ends a hung wait for the server's output, the assertion is on that output
    assert.ok(Date.now() < deadline, `timed out waiting for ${text}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// Value: protects=a secret the dev script passes in a flag (`--token=…`, `--secret …`) reaches no port refusal, readiness note, launch-failure text or journal entry, since Codebook never runs the dev script, quotes its flags by name only and starts Next with its own arguments; fails_when=SECRET-VALUE appears in any of them, or the launched Next receives the script's flags; why_new=Cycle 0066 task 31 (no test seeded a secret through a dev-script flag); seam=temporary workspace with a stand-in Next that prints its arguments, a loopback listener holding the refused port; no_claim=a real next dev process
test('a secret passed in a dev script flag reaches no port refusal, readiness note, launch-failure text or journal', async (context) => {
  // Arrange
  const workspace = await nextProjectWithStandInNext(
    context,
    'NEXT_TELEMETRY_DISABLED=1 next dev --token=SECRET-VALUE --secret SECRET-VALUE',
  )
  const busyPort = await busyLoopbackPort(context)
  const journal: { type: string; detail: unknown }[] = []
  // Act
  const declared = await readDeclaredDevelopmentPort(workspace)
  const refusal = await assertDevelopmentPortFree({
    ...declared,
    port: busyPort,
  }).catch((error: unknown) => error)
  const readiness = await readRepositoryAdapterReadiness(
    workspace,
    process.execPath,
    new AbortController().signal,
  )
  const launchFailure = await describeNextLaunchFailure({
    workspace,
    nextVersion: '16.0.1',
    port: declared.port,
  })
  const app = launchDevelopmentServer(
    workspace,
    process.execPath,
    (type, detail) => journal.push({ type, detail }),
    false,
    declared.port,
    undefined,
    maskNextServerOutput,
  )
  // The stand-in server is closed even when the wait fails, so no child process outlives the test.
  try {
    await untilOutputHolds(() => app.outputTail(), '--port 3000')
  } finally {
    await app.close()
  }
  // Assert
  assert.ok(refusal instanceof Error)
  assert.equal(
    refusal.message,
    `Port ${busyPort} is in use on this machine, and the project declares it (Next's default port, taken because the dev script has a form Codebook does not read: "NEXT_TELEMETRY_DISABLED=… next dev … … …"): the app's own origin, such as AUTH_URL, points there, so Codebook never starts it on another port. Ask the learner to stop the process that listens on port ${busyPort} (often their own dev server), then start again.`,
  )
  assert.deepEqual(readiness['next-dev-webpack'].notes, [
    'Codebook does not apply these environment settings from scripts.dev: NEXT_TELEMETRY_DISABLED.',
  ])
  assert.equal(JSON.stringify(readiness).includes('SECRET-VALUE'), false)
  assert.deepEqual(launchFailure, [
    'Codebook does not apply these environment settings from scripts.dev: NEXT_TELEMETRY_DISABLED.',
    'Codebook runs your Next app with webpack (`next dev --webpack`) even when your dev script uses Turbopack. The page is built from the same source; a Turbopack-only loader or setting has no effect during the run.',
    'Codebook ran Next 16.0.1 as `next dev --webpack --hostname 127.0.0.1 --port 3000`.',
  ])
  assert.deepEqual(
    journal.find((entry) => entry.type === 'application.acquired')?.detail,
    {
      pid: app.pid,
      node: process.execPath,
      arguments: [
        join(workspace, 'node_modules/next/dist/bin/next'),
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        '3000',
      ],
      cwd: workspace,
      secretEnvironmentInherited: false,
    },
  )
  assert.equal(
    (
      journal.find((entry) => entry.type === 'application.closed')?.detail as {
        log: string
      }
    ).log,
    'next dev --webpack --hostname 127.0.0.1 --port 3000\n',
  )
  assert.equal(JSON.stringify(journal).includes('SECRET-VALUE'), false)
})
