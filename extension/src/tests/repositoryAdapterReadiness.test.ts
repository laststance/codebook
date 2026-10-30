import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import { assessViteWorkspace } from '../utils/assessViteWorkspace'
import { readNextDevPreparation } from '../utils/readNextDevPreparation'
import { readNodeVersion } from '../utils/readNodeVersion'
import { readRepositoryAdapterReadiness } from '../utils/readRepositoryAdapterReadiness'

import { createViteRepository } from './utils/createViteRepository'
import { createEnvironmentWith } from './utils/nodeServerEnvironment'

const SIGNAL = new AbortController().signal

/** Creates a temporary workspace that holds an installed Next, as the Next adapter needs. */
async function createNextRepository(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codebook-next-ready-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'node_modules/next/dist/bin'), { recursive: true })
  await writeFile(join(root, 'node_modules/next/dist/bin/next'), '')
  await writeFile(
    join(root, 'node_modules/next/package.json'),
    JSON.stringify({ name: 'next', version: '16.0.1' }),
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'next dev' } }),
  )
  return root
}

// protects=codebook_status names vite-dev as the adapter to use on a Vite app and Next as missing; fails_when=the Vite fixture reads not ready, or the Next adapter reads ready without Next; no_claim=settings that need the launcher
test('a Vite workspace reports vite-dev ready and next-dev-webpack missing Next', async (context) => {
  // Arrange
  const repository = await createViteRepository(context, {
    dev: 'VITE_CJS_IGNORE_WARNING=true vite dev --port 3010',
  })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    repository.root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['vite-dev'].ready, true)
  assert.equal(readiness['vite-dev'].version, '8.3.5')
  assert.equal(readiness['vite-dev'].supported, true)
  assert.equal(readiness['vite-dev'].supportedMajor, 8)
  assert.equal(readiness['vite-dev'].enginesNode, '^20.19.0 || >=22.12.0')
  assert.equal(readiness['vite-dev'].nodeSatisfiesEngines, true)
  assert.deepEqual(readiness['vite-dev'].devScript, { form: 'accepted' })
  assert.equal(readiness['vite-dev'].yarnPnp, false)
  assert.deepEqual(readiness['next-dev-webpack'], {
    ready: false,
    missing: [
      'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
    ],
  })
})

// protects=the reverse: a Next app reports next-dev-webpack ready with its version and vite-dev missing the package; fails_when=Next reads missing or Vite reads installed; no_claim=the Next lock check, which stays in the profile's own ready
test('a Next workspace reports next-dev-webpack ready and vite-dev missing the vite package', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  // Cycle 0065: an installed Next also carries its router kind; this fixture has no route folder, which is a note, not a gap.
  assert.deepEqual(readiness['next-dev-webpack'], {
    ready: true,
    routerKind: 'none',
    missing: [],
    version: '16.0.1',
    notes: [
      'No Next route folder was found (looked for app, src/app, pages, src/pages).',
    ],
  })
  assert.equal(readiness['vite-dev'].ready, false)
  assert.equal(readiness['vite-dev'].installed, false)
  assert.deepEqual(readiness['vite-dev'].missing, [
    'This workspace has Next and no vite package, so vite-dev is not available here; use next-dev-webpack.',
  ])
})

// protects=an agent reads why vite-dev is not ready: the refused script tokens (redacted), an unsupported major and an engines gap, all at once; fails_when=a gap is dropped or an assignment value reaches the report; no_claim=the start's own refusal
test('a Vite workspace with an unsupported major and a refused script lists every gap without the script values', async (context) => {
  // Arrange
  const repository = await createViteRepository(context, {
    dev: 'SECRET_TOKEN=hunter2hunter2 vite --open && echo done',
    viteVersion: '7.1.0',
    engines: '>=99.0.0',
  })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    repository.root,
    process.execPath,
    SIGNAL,
  )
  const report = readiness['vite-dev']
  // Assert
  assert.equal(report.ready, false)
  assert.equal(report.supported, false)
  assert.equal(report.nodeSatisfiesEngines, false)
  assert.deepEqual(report.devScript, {
    form: 'refused',
    refused: ['the operator &&', 'a positional argument …'],
  })
  assert.equal(report.missing.length, 3)
  assert.equal(
    report.missing[0],
    'Vite 7.1.0 is installed; Codebook supports Vite 8 only.',
  )
  assert.ok(!JSON.stringify(report).includes('hunter2'))
})

// protects=a predev script and a missing dev script are named by status before any start; fails_when=either reads ready; no_claim=none
test('a Vite workspace with a predev script reads not ready and names the predev script', async (context) => {
  // Arrange
  const repository = await createViteRepository(context, {
    dev: 'vite',
    predev: 'echo hi',
  })
  // Act
  const report = (
    await readRepositoryAdapterReadiness(
      repository.root,
      process.execPath,
      SIGNAL,
    )
  )['vite-dev']
  // Assert
  assert.equal(report.ready, false)
  assert.deepEqual(report.missing, [
    "package.json has a predev script: Codebook starts Vite directly and would skip it, so its start would differ from the project's own.",
  ])
})

// protects=a Yarn Plug-n-Play project is told apart from an uninstalled one; fails_when=the report says only "install vite"; no_claim=none
test('a Yarn Plug-n-Play workspace reports yarnPnp and the PnP sentence', async (context) => {
  // Arrange
  const root = await mkdtemp(join(tmpdir(), 'codebook-pnp-ready-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, '.pnp.cjs'), '')
  await writeFile(join(root, 'package.json'), '{}')
  // Act
  const report = (
    await readRepositoryAdapterReadiness(root, process.execPath, SIGNAL)
  )['vite-dev']
  // Assert
  assert.equal(report.yarnPnp, true)
  assert.equal(report.installed, false)
  assert.match(
    report.missing[0] ?? '',
    /^Yarn Plug-n-Play without node_modules/,
  )
})

/** Replaces the workspace's `package.json` scripts with the ones a test reads. */
async function writeScripts(
  root: string,
  scripts: Record<string, string>,
): Promise<void> {
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts }))
}

// protects=the real environment carries the adapter report inside the repository-browser profile without changing its own ready/missing; fails_when=adapters is absent from the profile; no_claim=the Node version of the stub environment
test('the environment reports both adapters under the repository-browser profile', async (context) => {
  // Arrange
  const { environment } = await createEnvironmentWith(context, { gaps: [] })
  // Act
  const profile = (await environment.prerequisites()).profiles?.[
    'repository-browser'
  ]
  // Assert
  assert.deepEqual(Object.keys(profile?.adapters ?? {}), [
    'next-dev-webpack',
    'vite-dev',
  ])
  assert.equal(profile?.adapters?.['vite-dev'].installed, false)
})

// Value: protects=a broken package.json is reported as unreadable, not as a missing dev script, without its contents; fails_when=the sentence says no dev script or echoes the file; why_new=parse errors were swallowed; seam=none; no_claim=other fields
test('a malformed package.json reports the parse failure and not a missing dev script', async (context) => {
  // Arrange
  const repository = await createViteRepository(context, {})
  await writeFile(
    join(repository.root, 'package.json'),
    '{ "secret-token-xyz": ',
  )
  // Act
  const readiness = (
    await readRepositoryAdapterReadiness(
      repository.root,
      process.execPath,
      SIGNAL,
    )
  )['vite-dev']
  // Assert
  assert.equal(readiness.ready, false)
  assert.equal(readiness.missing.length, 2)
  assert.equal(
    readiness.missing[0],
    'package.json could not be read: it is not valid JSON. Fix it so Codebook can read the dev script.',
  )
  assert.equal(JSON.stringify(readiness).includes('secret-token-xyz'), false)
})

// Value: protects=a corrupt next/package.json fails only the Next report; fails_when=the whole status rejects or Vite loses its result; why_new=only readFile failures were contained; seam=none; no_claim=Next lock checks
test('a corrupt next/package.json makes only Next not ready and keeps the Vite result', async (context) => {
  // Arrange
  const repository = await createViteRepository(context, {})
  await mkdir(join(repository.root, 'node_modules/next/dist/bin'), {
    recursive: true,
  })
  await writeFile(join(repository.root, 'node_modules/next/dist/bin/next'), '')
  await writeFile(
    join(repository.root, 'node_modules/next/package.json'),
    '{ nope',
  )
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    repository.root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].ready, false)
  assert.equal(readiness['vite-dev'].ready, true)
})

// Value: protects=node --version runs once per executable for the host's life; fails_when=a second read starts the process again; why_new=status spawned it on every call; seam=none; no_claim=version changes of the same path
// Value: protects=a configured Node executable that cannot run is named as such by codebook_status and by a start alike, never as a Node that is not configured; fails_when=the status reader turns the failed read into "not configured", or the start throws the raw spawn error; why_new=Cycle 0064 local CodeRabbit CLI r2 (minor); seam=none (a path that does not exist); no_claim=a Node that runs but reports an unreadable version
test('a configured Node that cannot run is named as such by codebook_status and by a start alike', async (context) => {
  // Arrange
  const repository = await createViteRepository(context)
  const missingNode = join(repository.root, 'no-such-node')
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    repository.root,
    missingNode,
    SIGNAL,
  )
  const starting = assessViteWorkspace(repository.root, missingNode, SIGNAL)
  // Assert
  const [statusSentence] = readiness['vite-dev'].missing
  assert.equal(readiness['vite-dev'].ready, false)
  assert.ok(
    statusSentence?.startsWith(
      'The configured Node executable (codebook.nodeExecutable) could not be run for the Vite engines.node check: ',
    ),
    statusSentence,
  )
  await assert.rejects(starting, (error: unknown) => {
    assert.ok(error instanceof StudyError)
    assert.equal(error.code, 'PREREQUISITE_MISSING')
    assert.equal(error.message, statusSentence)
    return true
  })
})

test('reads the version of one Node executable once and answers the second read from memory', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-node-memo-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const executable = join(directory, 'node')
  await writeFile(executable, '#!/bin/sh\necho v1.2.3\n', { mode: 0o755 })
  // Act
  const first = await readNodeVersion(executable, SIGNAL)
  await rm(executable)
  const second = await readNodeVersion(executable, SIGNAL)
  // Assert
  assert.equal(first, 'v1.2.3')
  assert.equal(second, 'v1.2.3')
})

// Value: protects=codebook_status labels a workspace with a root app folder as App Router before a start, without a gap; fails_when=routerKind is absent or not app, or the label adds a missing sentence; why_new=Cycle 0065 adds the router kind label; seam=none; no_claim=which route the run resolves
test('a Next workspace with an app folder reports router kind app and stays ready', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'app'))
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].routerKind, 'app')
  assert.equal(readiness['next-dev-webpack'].ready, true)
  assert.deepEqual(readiness['next-dev-webpack'].missing, [])
  assert.equal(readiness['next-dev-webpack'].notes, undefined)
})

// Value: protects=an App Router under src/ is found as Next finds it; fails_when=only the root app folder counts; why_new=Cycle 0065 router kind; seam=none; no_claim=root-over-src precedence of a run
test('a Next workspace with a src/app folder reports router kind app', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'src/app'), { recursive: true })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].routerKind, 'app')
})

// Value: protects=a Pages Router app is labeled pages before a start, so an agent knows the Pages run applies; fails_when=a root pages folder reads none or app; why_new=Cycle 0065 Pages Router support; seam=none; no_claim=route resolution
test('a Next workspace with a pages folder reports router kind pages and stays ready', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'pages'))
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].routerKind, 'pages')
  assert.equal(readiness['next-dev-webpack'].ready, true)
  assert.deepEqual(readiness['next-dev-webpack'].missing, [])
})

// Value: protects=the P02 form (src/pages) is labeled pages; fails_when=only the root pages folder counts; why_new=Cycle 0065 Pages Router support; seam=none; no_claim=route resolution
test('a Next workspace with a src/pages folder reports router kind pages', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'src/pages'), { recursive: true })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].routerKind, 'pages')
})

// Value: protects=a workspace that holds both routers says so instead of naming one; fails_when=either router hides the other; why_new=Cycle 0065 router kind; seam=none; no_claim=which router a given entry path resolves to
test('a Next workspace with an app and a pages folder reports router kind both', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'app'))
  await mkdir(join(root, 'pages'))
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].routerKind, 'both')
})

// Value: protects=a workspace without route folders names the folders searched as a note and stays ready, since the label is no gap; fails_when=the sentence is missing, differs, or goes to missing (which the environment turns into not ready); why_new=Cycle 0065 router kind none; seam=none; no_claim=a custom pageExtensions or a run's own refusal
test('a Next workspace without a route folder reports router kind none with the searched folders and stays ready', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.equal(readiness['next-dev-webpack'].routerKind, 'none')
  assert.deepEqual(readiness['next-dev-webpack'].notes, [
    'No Next route folder was found (looked for app, src/app, pages, src/pages).',
  ])
  assert.equal(readiness['next-dev-webpack'].ready, true)
  assert.deepEqual(readiness['next-dev-webpack'].missing, [])
})

// Value: protects=a plain next dev reports no preparation, so status stays quiet when Codebook skips nothing; fails_when=a preparation entry or note appears for plain next dev; why_new=Cycle 0065 preparation states; seam=none; no_claim=next dev flags
test('a plain next dev script reports no skipped preparation', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'app'))
  await writeScripts(root, { dev: 'next dev --turbopack' })
  // Act
  const preparation = await readNextDevPreparation(root)
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.deepEqual(preparation, { status: 'none' })
  assert.equal(readiness['next-dev-webpack'].preparation, undefined)
  assert.equal(readiness['next-dev-webpack'].notes, undefined)
})

// Value: protects=a preparation step before next dev, which Codebook does not run, is counted and named before a start; fails_when=the step is missed, miscounted, or the sentence differs, or ready changes; why_new=Cycle 0065 preparation states (P01 runs a step before next dev); seam=none; no_claim=whether the step was done
test('a statement before next dev in scripts.dev is reported as one skipped preparation statement', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'src/pages'), { recursive: true })
  await writeScripts(root, { dev: 'prisma generate && next dev' })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.deepEqual(readiness['next-dev-webpack'].preparation, {
    status: 'skipped',
    statements: 1,
  })
  assert.deepEqual(readiness['next-dev-webpack'].notes, [
    'Codebook starts Next with --webpack and skips 1 statement(s) before `next dev` in package.json scripts.dev. Whether that preparation is done has not been checked.',
  ])
  assert.equal(readiness['next-dev-webpack'].ready, true)
  assert.deepEqual(readiness['next-dev-webpack'].missing, [])
})

// Value: protects=a predev script, which the package manager runs before dev, counts as skipped preparation; fails_when=predev is ignored; why_new=Cycle 0065 preparation states; seam=none; no_claim=package managers that skip pre scripts
test('a predev script is reported as one skipped preparation statement', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { predev: 'prisma generate', dev: 'next dev' })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'skipped', statements: 1 })
})

// Value: protects=next build before next dev is preparation even though it is the next program; fails_when=any next command is taken for next dev; why_new=Cycle 0065 preparation states; seam=none; no_claim=none
test('a next build statement before next dev is reported as skipped preparation', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { dev: 'next build && next dev' })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'skipped', statements: 1 })
})

// Value: protects=an env assignment before next dev is no preparation but an environment setting Codebook does not apply, named only; fails_when=it counts as a statement or its name is missing; why_new=Cycle 0065 preparation parsing; seam=none; no_claim=the port a PORT assignment gives
test('an env assignment before next dev is reported as an unapplied environment setting, not as preparation', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'app'))
  await writeScripts(root, { dev: 'A=1 next dev' })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.deepEqual(readiness['next-dev-webpack'].preparation, {
    status: 'none',
    envSettings: ['A'],
  })
  assert.deepEqual(readiness['next-dev-webpack'].notes, [
    'Codebook does not apply these environment settings from scripts.dev: A.',
  ])
})

// Value: protects=a cross-env prefix, NODE_OPTIONS included, is an unapplied environment setting, not preparation; fails_when=cross-env counts as a statement, or NODE_OPTIONS makes the script unknown as it does for the port; why_new=Cycle 0065 preparation parsing; seam=none; no_claim=the effect of NODE_OPTIONS
test('a cross-env prefix before next dev is reported as an unapplied environment setting, not as preparation', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { dev: 'cross-env NODE_OPTIONS=x next dev' })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, {
    status: 'none',
    envSettings: ['NODE_OPTIONS'],
  })
})

// Value: protects=concurrently cannot be read for preparation, so status says it was not checked instead of claiming none; fails_when=the reading is none or skipped, or the sentence differs; why_new=Cycle 0065 preparation states; seam=none; no_claim=the port reader's own concurrently grammar
test('a concurrently dev script reports preparation unknown with the could-not-read sentence', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'app'))
  await writeScripts(root, { dev: 'concurrently "a" "next dev"' })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.deepEqual(readiness['next-dev-webpack'].preparation, {
    status: 'unknown',
  })
  assert.deepEqual(readiness['next-dev-webpack'].notes, [
    'Codebook starts Next with --webpack and could not read package.json scripts.dev; whether it runs preparation before `next dev` has not been checked.',
  ])
  assert.equal(readiness['next-dev-webpack'].ready, true)
})

// Value: protects=a parallel runner before next dev makes the reading unknown, since whether next dev runs after it cannot be read; fails_when=run-p counts as one skipped statement; why_new=Cycle 0065 preparation states; seam=none; no_claim=none
test('a run-p statement before next dev reports preparation unknown', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { dev: 'run-p build:css && next dev' })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'unknown' })
})

// Value: protects=a script outside the shared tokenizer's grammar reads unknown, never none; fails_when=a pipe is read as plain next dev; why_new=Cycle 0065 preparation states; seam=none; no_claim=none
test('an unparsable dev script reports preparation unknown', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { dev: 'next dev | tee dev.log' })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'unknown' })
})

// Value: protects=a delegation the grammar resolves is followed to next dev and the statements before it there are counted; fails_when=the delegation is counted as preparation or read unknown; why_new=Cycle 0065 reuses the port reader's delegations; seam=none; no_claim=deeper nesting than the shared limit
test('a delegated script is followed to next dev and its statements before next dev are counted', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, {
    dev: 'pnpm run dev:next',
    'dev:next': 'prisma generate && next dev',
  })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'skipped', statements: 1 })
})

// Value: protects=the pre script of a delegated script, which npm runs before it, counts like predev; fails_when=the pre script is ignored; why_new=Cycle 0065 preparation states; seam=none; no_claim=package managers that skip pre scripts
test('the pre script of a delegated script that runs next dev counts as one skipped statement', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, {
    dev: 'npm run start:web',
    'prestart:web': 'node scripts/seed.js',
    'start:web': 'next dev',
  })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'skipped', statements: 1 })
})

// Value: protects=a delegation to a script the project does not have is not resolved, so the reading is unknown; fails_when=it counts as one skipped statement or none; why_new=Cycle 0065 preparation states; seam=none; no_claim=none
test('a delegation to a script the project does not have reports preparation unknown', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { dev: 'npm run seed && next dev' })
  // Act
  const preparation = await readNextDevPreparation(root)
  // Assert
  assert.deepEqual(preparation, { status: 'unknown' })
})

// Value: protects=the script is read with the meaning of the shell that runs it: under cmd an assignment prefix is a command, so the reading is unknown; fails_when=the Windows reading claims none with an env setting; why_new=Cycle 0065 reuses the port reader's shells; seam=platform argument; no_claim=a real cmd run
test('an env assignment prefix read for Windows reports preparation unknown', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await writeScripts(root, { dev: 'A=1 next dev' })
  // Act
  const preparation = await readNextDevPreparation(root, 'win32')
  // Assert
  assert.deepEqual(preparation, { status: 'unknown' })
})

// Value: protects=env values never reach codebook_status: only names are reported for exports, prefixes and cross-env; fails_when=a seeded value appears anywhere in the readiness or a name is lost; why_new=Cycle 0065 secrets rule for preparation; seam=none; no_claim=server output masking
test('the readiness names environment settings without any of their values', async (context) => {
  // Arrange
  const root = await createNextRepository(context)
  await mkdir(join(root, 'src/pages'), { recursive: true })
  await writeScripts(root, {
    dev: 'export SESSION_KEY=SECRET123 && prisma generate --schema=SECRET123 && API_TOKEN=SECRET123 cross-env NODE_OPTIONS=--title=SECRET123 next dev',
  })
  // Act
  const readiness = await readRepositoryAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  // Assert
  assert.deepEqual(readiness['next-dev-webpack'].preparation, {
    status: 'skipped',
    statements: 1,
    envSettings: ['SESSION_KEY', 'API_TOKEN', 'NODE_OPTIONS'],
  })
  assert.equal(JSON.stringify(readiness).includes('SECRET123'), false)
})
