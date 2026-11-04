import assert from 'node:assert/strict'
import {
  chmod,
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

import { StudyError } from '../errors'
import { selectedVitePackageStartPrerequisites } from '../utils/repositoryBrowserStartPrerequisites'
import { resolveVitePackage } from '../utils/resolveVitePackage'
import { viteOutsidePackageRefusal } from '../viteRefusals'

/** Makes a temporary repository (real path) that is removed when the test ends. */
async function makeRepository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-vitepkg-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Writes a file, creating its folders. */
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** Writes a manifest that declares Vite, with the given scripts. */
async function viteManifest(
  folder: string,
  scripts: Record<string, string> = {},
): Promise<void> {
  await put(
    join(folder, 'package.json'),
    JSON.stringify({
      name: 'app',
      devDependencies: { vite: '^8.3.5' },
      scripts,
    }),
  )
}

/** Catches the refusal a resolution raises. */
async function refusalOf(action: () => Promise<unknown>): Promise<StudyError> {
  try {
    await action()
  } catch (error) {
    assert.ok(error instanceof StudyError)
    return error
  }
  throw new Error('The resolution was not refused.')
}

// protects=AC 2 (Cycle 0077): each folder reason refuses with INVALID_CONFIGURATION, its own details.reason, field, the sanitized packageRoot, suggestions and sideEffects none; fails_when=a reason answers another code or reason, loses a detail, or a Vite refusal differs from the Next one; no_claim=unreadable (needs an unreadable folder, covered with the Next twin) and that a start refuses before a process (the run's own test)
test('a Vite packageRoot that is missing, a file, a link out or outside the repository is refused with its reason and suggestions', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const outside = await makeRepository(context)
  await put(join(root, 'file.txt'), 'x')
  await symlink(outside, join(root, 'escape'))
  const declaredValues = ['missing/app', 'file.txt', 'escape', '../elsewhere']
  // Act
  const answers: unknown[] = []
  for (const declared of declaredValues) {
    const error = await refusalOf(() =>
      resolveVitePackage(root, declared, {
        suggest: () => ['examples/react/basic'],
      }),
    )
    answers.push([declared, error.code, error.details])
  }
  // Assert
  assert.deepEqual(answers, [
    [
      'missing/app',
      'INVALID_CONFIGURATION',
      {
        field: 'packageRoot',
        packageRoot: 'missing/app',
        reason: 'missing',
        suggestions: ['examples/react/basic'],
        sideEffects: 'none',
      },
    ],
    [
      'file.txt',
      'INVALID_CONFIGURATION',
      {
        field: 'packageRoot',
        packageRoot: 'file.txt',
        reason: 'not-a-folder',
        suggestions: ['examples/react/basic'],
        sideEffects: 'none',
      },
    ],
    [
      'escape',
      'INVALID_CONFIGURATION',
      {
        field: 'packageRoot',
        packageRoot: 'escape',
        reason: 'link-leaves-repository',
        suggestions: ['examples/react/basic'],
        sideEffects: 'none',
      },
    ],
    [
      '../elsewhere',
      'INVALID_CONFIGURATION',
      {
        field: 'packageRoot',
        packageRoot: '../elsewhere',
        reason: 'outside-repository',
        suggestions: ['examples/react/basic'],
        sideEffects: 'none',
      },
    ],
  ])
})

// protects=AC 2 and decision D5: a folder that is no Vite app (no package.json, no vite, a Vitest-only package) is refused with not-a-vite-app and the same top-level code as not-a-next-app; fails_when=a library package with a vite.config is accepted as an app, or the code differs from the Next twin; no_claim=the suggestions' contents
test('a Vite packageRoot that is a Vitest-only package, has no vite or has no manifest is refused as not-a-vite-app', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await put(join(root, 'packages/core/vite.config.ts'), 'export default {}')
  await viteManifest(join(root, 'packages/core'), { 'test:lib': 'vitest' })
  await put(
    join(root, 'apps/plain/package.json'),
    JSON.stringify({ name: 'plain', scripts: { dev: 'vite' } }),
  )
  await put(join(root, 'apps/empty/readme.md'), 'x')
  // Act
  const reasons: unknown[] = []
  for (const declared of ['packages/core', 'apps/plain', 'apps/empty']) {
    const error = await refusalOf(() => resolveVitePackage(root, declared))
    reasons.push([error.code, error.details?.reason])
  }
  // Assert
  assert.deepEqual(reasons, [
    ['INVALID_CONFIGURATION', 'not-a-vite-app'],
    ['INVALID_CONFIGURATION', 'not-a-vite-app'],
    ['INVALID_CONFIGURATION', 'not-a-vite-app'],
  ])
})

// protects=decision D5: an app with an accepted dev script, and an app with only an index.html, both resolve to their folder with repository-relative mappers; fails_when=either shape is refused or a mapper keeps the repository-relative path; no_claim=that Vite is installed
test('a Vite app with an accepted dev script or with an index.html resolves to its folder and maps paths', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await viteManifest(join(root, 'examples/react/basic'), { dev: 'vite' })
  await viteManifest(join(root, 'examples/react/static'))
  await put(join(root, 'examples/react/static/index.html'), '<html></html>')
  // Act
  const withScript = await resolveVitePackage(root, 'examples/react/basic')
  const withPage = await resolveVitePackage(root, 'examples/react/static')
  // Assert
  assert.equal(withScript.packageRoot, join(root, 'examples/react/basic'))
  assert.equal(withScript.packageRootRelative, 'examples/react/basic')
  assert.equal(withScript.isRoot, false)
  assert.equal(
    withScript.toPackageRelative('examples/react/basic/src/index.tsx'),
    'src/index.tsx',
  )
  assert.equal(
    withScript.toPackageRelative('examples/react/static/src/index.tsx'),
    undefined,
  )
  assert.equal(
    withScript.toRepositoryRelative('src/index.tsx'),
    'examples/react/basic/src/index.tsx',
  )
  assert.equal(withPage.packageRootRelative, 'examples/react/static')
})

// protects=AC 1 (root run unchanged): an absent or "." packageRoot is the root package without any disk check, and a packageRoot that links to the repository root is the root; fails_when=the root app is judged by the nested rules or loses isRoot; no_claim=a root run's launch
test('an absent or dot packageRoot is the root package and a link to the root is the root too', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await viteManifest(root, { dev: 'vite' })
  await symlink(root, join(root, 'self'))
  // Act
  const absent = await resolveVitePackage(root, undefined)
  const dot = await resolveVitePackage(root, '.')
  const linked = await resolveVitePackage(root, 'self')
  // Assert
  assert.equal(absent.isRoot, true)
  assert.equal(dot.packageRoot, root)
  assert.equal(linked.isRoot, true)
  assert.equal(linked.declaredPackageRoot, 'self')
})

// protects=AC 2 (stop outside the app): the refusal is VITE_SEAL_FAILED with reason outside-package, every file, the package root and sideEffects none, and a recovery that names fields and says nothing was started; fails_when=the code, reason or details differ from the Next twin, or the recovery claims a started server; no_claim=that the run finds the files (the run's own test)
test('a stop outside the Vite app is refused with VITE_SEAL_FAILED and reason outside-package', () => {
  // Arrange
  const files = ['packages/query-core/src/a.ts', 'packages/query-core/src/b.ts']
  // Act
  const refusal = viteOutsidePackageRefusal('examples/react/basic', files)
  const described = refusal.describe()
  // Assert
  assert.equal(refusal.code, 'VITE_SEAL_FAILED')
  assert.deepEqual(refusal.details, {
    reason: 'outside-package',
    files,
    packageRoot: 'examples/react/basic',
    sideEffects: 'none',
  })
  assert.match(described.recovery, /Nothing was started/)
  assert.match(described.recovery, /details\.files/)
})

// protects=AC 2: a folder that cannot be read is refused as unreadable with its errno code, not as missing; fails_when=EACCES reads as missing or as a thrown raw error; no_claim=Windows permission models and a root user (skipped there)
test('a Vite packageRoot below a folder that cannot be read is refused as unreadable with its errno', async (context) => {
  // Arrange
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    context.skip('permission bits do not block this user')
    return
  }
  const root = await makeRepository(context)
  await viteManifest(join(root, 'blocked/app'), { dev: 'vite' })
  await chmod(join(root, 'blocked'), 0o000)
  // Act
  // The folder is readable again before the repository is removed, whatever the outcome.
  const error = await refusalOf(() =>
    resolveVitePackage(root, 'blocked/app'),
  ).finally(() => chmod(join(root, 'blocked'), 0o755))
  // Assert
  assert.equal(error.code, 'INVALID_CONFIGURATION')
  assert.equal(error.details?.reason, 'unreadable')
  assert.equal(error.details?.errno, 'EACCES')
})

// protects=Task 2 start preflight: a nested vite-dev start is judged by its own folder, so a root without Vite never blocks it, a folder that is no Vite app is refused with its reason, and a root start keeps the caller's readiness; fails_when=the preflight returns undefined for a nested start (the root's readiness would refuse it), accepts a non-app, or judges a root start; no_claim=Vite's installation, version and dev script (the run's workspace check)
test('the start preflight of a nested vite-dev run is judged by its folder and not by the root', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await viteManifest(join(root, 'examples/react/basic'), { dev: 'vite' })
  await put(join(root, 'tools/cli/package.json'), '{"name":"cli"}')
  const shared = { ready: true, missing: [] as string[] }
  const configuration = (packageRoot?: string) => ({
    adapter: 'vite-dev',
    ...(packageRoot === undefined ? {} : { packageRoot }),
  })
  // Act
  const nested = await selectedVitePackageStartPrerequisites(
    shared,
    'repository-browser',
    configuration('examples/react/basic'),
    root,
  )
  const rootStart = await selectedVitePackageStartPrerequisites(
    shared,
    'repository-browser',
    configuration(),
    root,
  )
  const refusal = await refusalOf(() =>
    selectedVitePackageStartPrerequisites(
      shared,
      'repository-browser',
      configuration('tools/cli'),
      root,
    ),
  )
  // Assert
  assert.deepEqual(nested, { ready: true, missing: [] })
  assert.equal(rootStart, undefined)
  assert.equal(refusal.details?.reason, 'not-a-vite-app')
})
