import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

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
  assert.deepEqual(readiness['next-dev-webpack'], {
    ready: true,
    missing: [],
    version: '16.0.1',
  })
  assert.equal(readiness['vite-dev'].ready, false)
  assert.equal(readiness['vite-dev'].installed, false)
  assert.deepEqual(readiness['vite-dev'].missing, [
    'Install the workspace dependencies, including vite, before using vite-dev (the vite package does not resolve from the package root).',
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
