import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { launchDevelopmentServer } from '../utils/launchDevelopmentServer'

import { endProcessesAfter } from './utils/endProcessesAfter'
import { removeTestFolder } from './utils/removeTestFolder'

/** The identity secret the stand-in launches carry (hex, as a run draws it). */
const PROOF_SECRET = '00ff00ff00ff00ff00ff00ff00ff00ff'

/** The text of a stand-in Next executable: it records how Node started it and then stays alive like a dev server. */
const FAKE_NEXT = `
require('node:fs').writeFileSync(
  require('node:path').join(__dirname, 'started.json'),
  JSON.stringify({
    execArgv: process.execArgv,
    argv: process.argv.slice(2),
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    proofSecret: process.env.CODEBOOK_PROOF_SECRET ?? null,
  }),
)
setInterval(() => {}, 1000)
`

/** Launches the stand-in Next executable the way a run does and returns what Node recorded about its own start, plus the journal. */
async function launchAndReadStart(
  context: TestContext,
  options: { withPreload: boolean; withIdentity?: boolean },
) {
  const folder = await mkdtemp(join(tmpdir(), 'codebook-next-launch-'))
  context.after(() => removeTestFolder(folder))
  const executable = join(folder, 'bin', 'next.js')
  await mkdir(join(folder, 'bin'), { recursive: true })
  await writeFile(executable, FAKE_NEXT)
  const preloadPath = join(folder, 'preload.cjs')
  await writeFile(preloadPath, '\n')
  const identityPath = join(folder, 'identity.cjs')
  await writeFile(identityPath, '\n')
  const journal: { type: string; detail?: unknown }[] = []
  const app = launchDevelopmentServer(
    folder,
    process.execPath,
    (type, detail) => journal.push({ type, detail }),
    true,
    3011,
    undefined,
    undefined,
    executable,
    {
      ...(options.withPreload ? { preloadPath } : {}),
      ...(options.withIdentity
        ? { identity: { preloadPath: identityPath, secret: PROOF_SECRET } }
        : {}),
    },
  )
  // The stand-in server leads a process group of its own: it is ended with the test, also when an assertion fails.
  const heldPids = (): number[] => (app.pid === undefined ? [] : [app.pid])
  endProcessesAfter(context, heldPids, { group: true, held: heldPids })
  const recordPath = join(folder, 'bin', 'started.json')
  await waitUntil(
    () =>
      readFile(recordPath, 'utf8').then(
        (text) => text !== '',
        () => false,
      ),
    'the recorded start of the stand-in Next executable',
  )
  const started: unknown = JSON.parse(await readFile(recordPath, 'utf8'))
  await app.close()
  return { folder, executable, preloadPath, identityPath, started, journal }
}

// Value: protects=a Next library run starts node --require <preload> next dev ... --inspect with the preload before the executable and no NODE_OPTIONS, so the forked server child inherits it; fails_when=the preload lands after the executable (Next would receive it as its own argument) or travels in NODE_OPTIONS; why_new=the Next launch had no preload seam; seam=none; no_claim=that a real Next forks its child with the parent's execArgv (E1 and the native check)
test('a Next library launch requires the preload before the Next executable and sets no NODE_OPTIONS', async (context) => {
  // Arrange and Act
  const { executable, preloadPath, started, journal } =
    await launchAndReadStart(context, { withPreload: true })
  // Assert
  const acquired = journal.find(
    (entry) => entry.type === 'application.acquired',
  )
  assert.deepEqual(Reflect.get(Object(acquired?.detail), 'arguments'), [
    '--require',
    preloadPath,
    executable,
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3011',
    '--inspect',
    '127.0.0.1:0',
  ])
  assert.deepEqual(Reflect.get(Object(started), 'execArgv'), [
    '--require',
    preloadPath,
  ])
  assert.equal(Reflect.get(Object(started), 'nodeOptions'), null)
})

// Value: protects=a Next run without library starts exactly as before, with no preload in the Node arguments; fails_when=--require is passed without a library declaration; why_new=regression guard for the options object; seam=none; no_claim=a real Next start
test('a Next launch without a library preload passes no --require', async (context) => {
  // Arrange and Act
  const { started } = await launchAndReadStart(context, { withPreload: false })
  // Assert
  assert.deepEqual(Reflect.get(Object(started), 'execArgv'), [])
})

// Value: protects=a reverseProxy run starts node --require <identity preload> before the Next executable and before the library preload, so the forked child inherits both in a fixed order; fails_when=the identity preload lands after the executable or after the library preload; why_new=the launch had no identity seam; seam=none; no_claim=that a real Next forks its child with the parent's execArgv (E1 and the native check)
test('a reverse proxy launch requires the identity preload first, before the executable', async (context) => {
  // Arrange and Act
  const { executable, identityPath, preloadPath, started, journal } =
    await launchAndReadStart(context, { withPreload: true, withIdentity: true })
  // Assert
  const acquired = journal.find(
    (entry) => entry.type === 'application.acquired',
  )
  assert.deepEqual(Reflect.get(Object(acquired?.detail), 'arguments'), [
    '--require',
    identityPath,
    '--require',
    preloadPath,
    executable,
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3011',
    '--inspect',
    '127.0.0.1:0',
  ])
  assert.deepEqual(Reflect.get(Object(started), 'execArgv'), [
    '--require',
    identityPath,
    '--require',
    preloadPath,
  ])
})

// Value: protects=the identity secret reaches the server only through its environment and never appears in the journaled arguments; fails_when=the secret is passed as an argument, in NODE_OPTIONS or in the application.acquired record; why_new=the launch had no secret path; seam=none; no_claim=the secret staying out of the app's own printed output (the masking test of reverseProxyIdentityPreload.test.ts)
test('a reverse proxy launch hands the secret over in the environment only', async (context) => {
  // Arrange and Act
  const { started, journal } = await launchAndReadStart(context, {
    withPreload: false,
    withIdentity: true,
  })
  // Assert
  assert.equal(Reflect.get(Object(started), 'proofSecret'), PROOF_SECRET)
  assert.equal(Reflect.get(Object(started), 'nodeOptions'), null)
  assert.equal(JSON.stringify(journal).includes(PROOF_SECRET), false)
})
