import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import { discoverPackages } from '../utils/discoverNextPackages'
import { parseReactScriptsStartScript } from '../utils/parseReactScriptsStartScript'
import { readReactScriptsPackageReadiness } from '../utils/readReactScriptsPackageReadiness'
import { readStatusAdapterReadiness } from '../utils/readStatusAdapterReadiness'

const executeFile = promisify(execFile)
const SIGNAL = new AbortController().signal

/** Makes a temporary Git repository (real path) that is removed when the test ends. */
async function makeRepository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-react-scripts-discovery-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  await executeFile('git', ['init', '--quiet', root])
  return root
}

/** Writes a file below the root, creating its folders. */
async function put(root: string, path: string, text = ''): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), text)
}

/** Writes and tracks a manifest that declares react-scripts, with the given scripts. */
async function trackedReactScriptsApp(
  root: string,
  folder: string,
  scripts: Record<string, string> = { start: 'react-scripts start' },
): Promise<void> {
  await put(
    root,
    `${folder}/package.json`,
    JSON.stringify({
      name: 'app',
      dependencies: { 'react-scripts': '^5.0.1' },
      scripts,
    }),
  )
  await executeFile('git', ['add', '--', `${folder}/package.json`], {
    cwd: root,
  })
}

/** Installs react-scripts at the given version in `folder`'s own node_modules. */
async function installReactScripts(
  root: string,
  folder: string,
  version: string,
): Promise<void> {
  await put(
    root,
    `${folder}/node_modules/react-scripts/package.json`,
    JSON.stringify({ name: 'react-scripts', version }),
  )
}

// Value: protects=status lists an installed react-scripts 5 app with installed, ready, version and an accepted start script; fails_when=the app is missed, reads not ready, or loses its version; why_new=Cycle 0083 adds the third kind to the one discovery pass; seam=temporary Git repository, real files; no_claim=the shared Chrome and Node prerequisites (environment test)
test('discovery lists an installed react-scripts 5 app as ready with its version and accepted start script', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'examples/counter')
  await installReactScripts(root, 'examples/counter', '5.0.1')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(discovery.reactScripts.packages, [
    {
      packageRoot: 'examples/counter',
      installed: true,
      ready: true,
      version: '5.0.1',
      missing: [],
      startScript: { form: 'accepted' },
    },
  ])
  assert.equal(discovery.reactScripts.packagesTruncated, false)
})

// Value: protects=a react-scripts 4 app is listed and refused with react-scripts-5, not hidden and not ready; fails_when=a 4.x app reads ready or is dropped from the list; why_new=decision D3 supports major 5 only; seam=temporary Git repository; no_claim=that react-scripts 4 would run
test('discovery lists an installed react-scripts 4 app as not ready with react-scripts-5', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'examples/todos')
  await installReactScripts(root, 'examples/todos', '4.0.3')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(discovery.reactScripts.packages, [
    {
      packageRoot: 'examples/todos',
      installed: true,
      ready: false,
      version: '4.0.3',
      missing: ['react-scripts-5'],
      startScript: { form: 'accepted' },
    },
  ])
})

// Value: protects=an app that is not installed is listed with react-scripts-installed; fails_when=it reads installed or ready, or is dropped; why_new=readiness must equal what a start decides; seam=temporary Git repository; no_claim=the install command to run
test('discovery lists a react-scripts app without an install as not installed', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'examples/counter')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(discovery.reactScripts.packages, [
    {
      packageRoot: 'examples/counter',
      installed: false,
      ready: false,
      missing: ['react-scripts-installed'],
      startScript: { form: 'accepted' },
    },
  ])
})

// Value: protects=DX-2: a start script that is not exactly react-scripts start is listed refused with the script, not hidden, and an assignment prefix stays accepted; fails_when=cross-env or extra arguments read accepted, the app is dropped, or a NAME=value prefix is refused; why_new=a refused form must read as unsupported, not undiscovered; seam=temporary Git repository; no_claim=the assignments reaching the launcher (parser test)
test('discovery reports a refused start script form and keeps an assignment prefix accepted', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'apps/cross-env', {
    start: 'cross-env PORT=4000 react-scripts start',
  })
  await trackedReactScriptsApp(root, 'apps/extra-argument', {
    start: 'react-scripts start --open',
  })
  await trackedReactScriptsApp(root, 'apps/no-start', {
    build: 'react-scripts build',
  })
  await trackedReactScriptsApp(root, 'apps/assignment', {
    start: 'PORT=4000 BROWSER=none react-scripts start',
  })
  for (const folder of [
    'cross-env',
    'extra-argument',
    'no-start',
    'assignment',
  ])
    await installReactScripts(root, `apps/${folder}`, '5.0.1')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(
    discovery.reactScripts.packages.map((entry) => [
      entry.packageRoot,
      entry.ready,
      entry.missing,
      entry.startScript,
    ]),
    [
      ['apps/assignment', true, [], { form: 'accepted' }],
      [
        'apps/cross-env',
        false,
        ['start-script'],
        {
          form: 'refused',
          refused: ['the command word cross-env'],
        },
      ],
      [
        'apps/extra-argument',
        false,
        ['start-script'],
        {
          form: 'refused',
          refused: ['extra words after react-scripts start'],
        },
      ],
      ['apps/no-start', false, ['start-script'], { form: 'absent' }],
    ],
  )
})

// Value: protects=DX-8: an app with a prestart script is listed with prestart-script because starting start.js directly would skip it; fails_when=such an app reads ready; why_new=the start would silently drop prestart; seam=temporary Git repository; no_claim=other lifecycle scripts
test('discovery lists an app with a prestart script as not ready with prestart-script', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'apps/prestart', {
    start: 'react-scripts start',
    prestart: 'node generate.js',
  })
  await installReactScripts(root, 'apps/prestart', '5.0.1')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(
    discovery.reactScripts.packages.map((entry) => [
      entry.ready,
      entry.missing,
    ]),
    [[false, ['prestart-script']]],
  )
})

// Value: protects=a react-scripts that resolves outside the repository (a link to a folder beside it) counts as not installed; fails_when=the app reads installed with the outside version; why_new=Codebook runs the Example's own react-scripts inside the checkout only; seam=temporary Git repository and a sibling folder; no_claim=a hoisted install inside the repository (next test)
test('discovery treats a react-scripts linked from outside the repository as not installed', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-react-scripts-outside-')),
  )
  context.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(
    join(outside, 'package.json'),
    JSON.stringify({ name: 'react-scripts', version: '5.0.1' }),
  )
  await trackedReactScriptsApp(root, 'apps/linked')
  await mkdir(join(root, 'apps/linked/node_modules'), { recursive: true })
  await symlink(outside, join(root, 'apps/linked/node_modules/react-scripts'))
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(
    discovery.reactScripts.packages.map((entry) => [
      entry.installed,
      entry.ready,
      entry.version,
      entry.missing,
    ]),
    [[false, false, undefined, ['react-scripts-installed']]],
  )
})

// Value: protects=react-scripts hoisted to the repository root node_modules still resolves for a nested app; fails_when=a hoisted install reads not installed; why_new=npm workspaces hoist; seam=temporary Git repository; no_claim=pnpm link layouts
test('discovery resolves a react-scripts hoisted to the repository root', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'examples/counter')
  await installReactScripts(root, '.', '5.0.1')
  // Act
  const discovery = await discoverPackages(root, { node: process.execPath })
  // Assert
  assert.deepEqual(
    discovery.reactScripts.packages.map((entry) => [
      entry.installed,
      entry.version,
      entry.ready,
    ]),
    [[true, '5.0.1', true]],
  )
})

// Value: protects=E1: one pass classifies Next, Vite and react-scripts apps together, and status reports rootIsApp for a react-scripts root without listing it as a nested package; fails_when=the react-scripts list gains a Next or Vite app, or the root app is missed; why_new=Cycle 0083 joins the one discovery pass; seam=temporary Git repository; no_claim=truncation (scan tests)
test('status reports a react-scripts root app and lists only react-scripts apps under react-scripts-dev', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, '.')
  await installReactScripts(root, '.', '5.0.1')
  await put(
    root,
    'web/package.json',
    JSON.stringify({ name: 'web', dependencies: { next: '16.4.3' } }),
  )
  await put(
    root,
    'vite-app/package.json',
    JSON.stringify({
      name: 'v',
      devDependencies: { vite: '^8.3.5' },
      scripts: { dev: 'vite' },
    }),
  )
  await executeFile(
    'git',
    ['add', '--', 'web/package.json', 'vite-app/package.json'],
    {
      cwd: root,
    },
  )
  // Act
  const report = await readStatusAdapterReadiness(
    root,
    process.execPath,
    SIGNAL,
  )
  const reactScripts = report['react-scripts-dev']
  // Assert
  assert.equal(reactScripts.rootIsApp, true)
  assert.equal(reactScripts.ready, true)
  assert.equal(reactScripts.version, '5.0.1')
  assert.deepEqual(reactScripts.packages, [])
  assert.equal(reactScripts.packagesTruncated, false)
})

// Value: protects=the shared judgement a start reuses returns a typed gap list and the start script assignments, and never throws for a not-ready app; fails_when=a not-installed app throws, or the assignments are lost; why_new=DX-9 one judgement for status and start; seam=temporary Git repository; no_claim=the launcher
test('the shared judgement reports gaps and the start script assignments without throwing', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await trackedReactScriptsApp(root, 'apps/ready', {
    start: 'PORT=4100 react-scripts start',
  })
  await installReactScripts(root, 'apps/ready', '5.0.1')
  await trackedReactScriptsApp(root, 'apps/bare')
  // Act
  const ready = await readReactScriptsPackageReadiness(root, 'apps/ready')
  const bare = await readReactScriptsPackageReadiness(root, 'apps/bare')
  // Assert
  assert.equal(ready.readiness.ready, true)
  assert.deepEqual({ ...ready.assignments }, { PORT: '4100' })
  assert.equal(
    ready.installationDirectory,
    join(root, 'apps/ready/node_modules/react-scripts'),
  )
  assert.deepEqual(bare.readiness.missing, ['react-scripts-installed'])
  assert.equal(bare.installationDirectory, undefined)
})

// Value: protects=the start script grammar: exactly react-scripts start after optional NAME=value words; fails_when=a shell-syntax assignment, a wrapper or an extra word is accepted; why_new=an accepted form is run without a shell; seam=pure parser; no_claim=what react-scripts does with the assignments
test('the start script parser accepts only react-scripts start behind plain assignments', () => {
  // Arrange
  const scripts = [
    'react-scripts start',
    'GENERATE_SOURCEMAP=true react-scripts start',
    'PORT=$PORT react-scripts start',
    'react-scripts start && echo done',
    'npm run other',
  ]
  // Act
  const forms = scripts.map(
    (script) => parseReactScriptsStartScript(script).readiness.form,
  )
  // Assert
  assert.deepEqual(forms, [
    'accepted',
    'accepted',
    'refused',
    'refused',
    'refused',
  ])
})
