import assert from 'node:assert/strict'
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

import { readViteWorkspaceGaps } from '../utils/readViteWorkspaceGaps'
import { resolveViteInstallation } from '../utils/resolveViteInstallation'

import { removeTestFolder } from './utils/removeTestFolder'

/** Makes a temporary folder (real path) that is removed when the test ends. */
async function makeFolder(context: TestContext): Promise<string> {
  const folder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vite-d7-')),
  )
  context.after(() => removeTestFolder(folder))
  return folder
}

/** Writes a file, creating its folders. */
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** Installs a Vite package at `folder`, the way `node_modules/vite` holds it. */
async function installVite(folder: string, version = '8.3.5'): Promise<void> {
  await put(
    join(folder, 'package.json'),
    JSON.stringify({
      name: 'vite',
      version,
      type: 'module',
      exports: {
        '.': { import: './index.mjs' },
        './package.json': './package.json',
      },
    }),
  )
  await put(join(folder, 'index.mjs'), 'export const version = "x"\n')
}

/** Writes the app's manifest with an accepted dev script. */
async function writeApp(folder: string): Promise<void> {
  await put(
    join(folder, 'package.json'),
    JSON.stringify({
      name: 'app',
      devDependencies: { vite: '^8.3.5' },
      scripts: { dev: 'vite' },
    }),
  )
}

// protects=decision D7: a hoisted Vite inside the repository (npm or Yarn node_modules at the root) is found for a nested app; fails_when=a hoisted install inside the repository reads as not installed; no_claim=that the Vite starts
test('a Vite hoisted to the repository root is found for a nested app', async (context) => {
  // Arrange
  const root = await makeFolder(context)
  await installVite(join(root, 'node_modules/vite'))
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.equal(lookup.found, true)
  assert.equal(
    lookup.found && lookup.installation.directory,
    join(root, 'node_modules/vite'),
  )
})

// protects=decision D7: a pnpm link inside the repository (the app's node_modules/vite pointing into node_modules/.pnpm) is found, with the real folder as the Vite directory; fails_when=a link inside the repository is refused or the entry names the link path; no_claim=pnpm itself
test('a pnpm-style link inside the repository is found and resolves to its real folder', async (context) => {
  // Arrange
  const root = await makeFolder(context)
  const real = join(root, 'node_modules/.pnpm/vite@8.3.5/node_modules/vite')
  await installVite(real)
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  await mkdir(join(app, 'node_modules'), { recursive: true })
  await symlink(real, join(app, 'node_modules/vite'))
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.equal(lookup.found && lookup.installation.directory, real)
})

// protects=decision D7: a Vite that lies above the repository root, found by Node's own resolution, is not used for a nested app; fails_when=a Vite outside the checkout is started for a nested Example; no_claim=the root app, which keeps Node's resolution
test('a Vite above the repository root is not installed for a nested app', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await installVite(join(outer, 'node_modules/vite'))
  const root = join(outer, 'checkout')
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  // Act
  const nested = await resolveViteInstallation(app, root)
  const asRoot = await resolveViteInstallation(root)
  // Assert
  assert.deepEqual(nested, { found: false, reason: 'not-installed' })
  assert.equal(asRoot.found, true)
})

// protects=decision D7: a link inside the repository that points outside it counts as not installed, with no fallback to an ancestor's Vite; fails_when=a Vite outside the checkout is followed through a link, or an ancestor's install replaces the broken nearest one; no_claim=Windows junctions
test('a node_modules/vite link that leaves the repository is not installed and no ancestor is used', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await installVite(join(outer, 'vite-elsewhere'))
  const root = join(outer, 'checkout')
  await installVite(join(root, 'node_modules/vite'))
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  await mkdir(join(app, 'node_modules'), { recursive: true })
  await symlink(join(outer, 'vite-elsewhere'), join(app, 'node_modules/vite'))
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.deepEqual(lookup, { found: false, reason: 'outside-repository' })
})

// protects=decision D7: NODE_PATH is never consulted for a nested app; fails_when=a Vite reachable only through NODE_PATH starts the nested app; no_claim=the root app's resolution
test('a Vite reachable only through NODE_PATH is not installed for a nested app', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await installVite(join(outer, 'global/vite'))
  const root = join(outer, 'checkout')
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  const before = process.env.NODE_PATH
  process.env.NODE_PATH = join(outer, 'global')
  context.after(() => {
    if (before === undefined) delete process.env.NODE_PATH
    else process.env.NODE_PATH = before
  })
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.deepEqual(lookup, { found: false, reason: 'not-installed' })
})

// protects=decision D7: a Yarn Plug-n-Play repository (a .pnp.cjs at the root, no node_modules/vite) is told apart and refused for a nested app; fails_when=PnP reads as a plain missing install or as installed; no_claim=Yarn running
test('a Yarn Plug-n-Play repository is refused for a nested app as yarn-pnp', async (context) => {
  // Arrange
  const root = await makeFolder(context)
  await put(join(root, '.pnp.cjs'), '')
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.deepEqual(lookup, { found: false, reason: 'yarn-pnp' })
})

// protects=AC 3 and decision D7: the shared readiness reading of a nested app with no Vite inside the repository carries the PREREQUISITE_MISSING gap a start refuses with, and a hoisted Vite makes it ready; fails_when=status and start disagree on a nested app, or the gap code changes; no_claim=Node's engines range
test('the workspace reading of a nested app is blocked by PREREQUISITE_MISSING until a Vite is inside the repository', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await installVite(join(outer, 'node_modules/vite'))
  const root = join(outer, 'checkout')
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  const readNode = async (): Promise<string | undefined> => 'v24.22.1'
  // Act
  const blocked = await readViteWorkspaceGaps(app, readNode, true, root)
  await installVite(join(root, 'node_modules/vite'))
  const ready = await readViteWorkspaceGaps(app, readNode, true, root)
  // Assert
  assert.equal(blocked.ready, false)
  assert.equal(blocked.gaps[0]?.code, 'PREREQUISITE_MISSING')
  assert.equal(ready.ready, true)
})

// protects=decision D7: a nearest node_modules/vite that leaves the repository or is a broken link is told apart from a missing Vite, and the status and start message does not say to install Vite; fails_when=the outside or broken link reads as the plain not-installed sentence; no_claim=Windows junctions
test('an outside or broken node_modules/vite link gets its own recovery sentence in the workspace reading', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await installVite(join(outer, 'vite-elsewhere'))
  const root = join(outer, 'checkout')
  const outsideApp = join(root, 'examples/react/outside')
  const brokenApp = join(root, 'examples/react/broken')
  await writeApp(outsideApp)
  await writeApp(brokenApp)
  await mkdir(join(outsideApp, 'node_modules'), { recursive: true })
  await mkdir(join(brokenApp, 'node_modules'), { recursive: true })
  await symlink(
    join(outer, 'vite-elsewhere'),
    join(outsideApp, 'node_modules/vite'),
  )
  await symlink(join(outer, 'missing'), join(brokenApp, 'node_modules/vite'))
  const readNode = async (): Promise<string | undefined> => 'v24.22.1'
  // Act
  const outside = await readViteWorkspaceGaps(outsideApp, readNode, true, root)
  const broken = await readViteWorkspaceGaps(brokenApp, readNode, true, root)
  // Assert
  for (const reading of [outside, broken]) {
    assert.equal(reading.ready, false)
    assert.equal(reading.gaps[0]?.code, 'PREREQUISITE_MISSING')
    assert.match(
      reading.gaps[0]?.message ?? '',
      /resolves outside the repository or its link is broken; install the package's dependencies inside the repository/,
    )
    assert.doesNotMatch(reading.gaps[0]?.message ?? '', /Install the workspace/)
  }
})

// protects=decision D7: a nested app's nearest node_modules/vite whose manifest names another package is not used; fails_when=any package folder named vite is run as Vite; no_claim=the root app, which keeps Node's resolution
test('a nested node_modules/vite whose package.json names another package is not Vite', async (context) => {
  // Arrange
  const root = await makeFolder(context)
  await installVite(join(root, 'node_modules/vite'))
  await put(
    join(root, 'node_modules/vite/package.json'),
    JSON.stringify({
      name: 'not-vite',
      version: '8.3.5',
      exports: {
        '.': { import: './index.mjs' },
        './package.json': './package.json',
      },
    }),
  )
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  // Act
  const nested = await resolveViteInstallation(app, root)
  const asRoot = await resolveViteInstallation(root)
  // Assert
  assert.deepEqual(nested, { found: false, reason: 'not-vite' })
  assert.equal(asRoot.found, true)
})

// protects=decision D7: a nested Vite whose import entry is a link out of the repository is refused; fails_when=the launcher imports a file outside the checkout; no_claim=Windows junctions
test('a nested Vite whose import entry links outside the repository is refused', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await put(join(outer, 'elsewhere.mjs'), 'export const version = "x"\n')
  const root = join(outer, 'checkout')
  await installVite(join(root, 'node_modules/vite'))
  await rm(join(root, 'node_modules/vite/index.mjs'))
  await symlink(
    join(outer, 'elsewhere.mjs'),
    join(root, 'node_modules/vite/index.mjs'),
  )
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.deepEqual(lookup, { found: false, reason: 'outside-repository' })
})

// protects=decision D7: a nested Vite whose package.json is a link out of the repository is refused; fails_when=a manifest outside the checkout is trusted; no_claim=Windows junctions
test('a nested Vite whose package.json links outside the repository is refused', async (context) => {
  // Arrange
  const outer = await makeFolder(context)
  await installVite(join(outer, 'other'))
  const root = join(outer, 'checkout')
  await installVite(join(root, 'node_modules/vite'))
  await rm(join(root, 'node_modules/vite/package.json'))
  await symlink(
    join(outer, 'other/package.json'),
    join(root, 'node_modules/vite/package.json'),
  )
  const app = join(root, 'examples/react/basic')
  await writeApp(app)
  // Act
  const lookup = await resolveViteInstallation(app, root)
  // Assert
  assert.deepEqual(lookup, { found: false, reason: 'not-vite' })
})
