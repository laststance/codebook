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

import { StudyError } from '../errors'
import { resolveNextPackage } from '../utils/resolveNextPackage'

/** Makes a temporary repository (real path) that is removed when the test ends. */
async function makeRepository(context: TestContext): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-nextpkg-')),
  )
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

/** Writes a file, creating its folders. */
async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

/** Installs a Next package (manifest and executable) at `folder`. */
async function installNext(folder: string): Promise<void> {
  await put(join(folder, 'package.json'), '{"name":"next","version":"16.4.3"}')
  await put(join(folder, 'dist/bin/next'), '#!/usr/bin/env node\n')
}

/** Writes a Next app manifest into `folder`. */
async function nextApp(
  folder: string,
  section = 'dependencies',
): Promise<void> {
  await put(
    join(folder, 'package.json'),
    JSON.stringify({ name: 'app', [section]: { next: '16.4.3' } }),
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

// protects=AC 3/E4: a nested app with its own Next resolves to that Next and the package folder as cwd, ignoring decoy root pages/app/.next/package.json/Next; fails_when=the resolver reads the root's node_modules or returns the repository root; no_claim=a started server
test('resolves a nested app with its own Next to the package folder and that Next', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await put(join(root, 'pages/index.tsx'), 'export default 1')
  await put(join(root, 'app/page.tsx'), 'export default 1')
  await put(join(root, '.next/dev/lock'), '')
  await put(join(root, 'package.json'), '{"name":"root"}')
  await installNext(join(root, 'node_modules/next'))
  await nextApp(join(root, 'examples/web'))
  await installNext(join(root, 'examples/web/node_modules/next'))
  // Act
  const resolved = await resolveNextPackage(root, 'examples/web')
  // Assert
  assert.equal(resolved.packageRoot, join(root, 'examples/web'))
  assert.equal(resolved.packageRootRelative, 'examples/web')
  assert.equal(resolved.isRoot, false)
  assert.equal(
    resolved.nextExecutable,
    join(root, 'examples/web/node_modules/next/dist/bin/next'),
  )
})

// protects=DX-22/E4: a hoisted Next in an ancestor folder inside the repository is used; fails_when=the resolver looks only at the package's own node_modules; no_claim=pnpm workspaces' layout beyond the hoist
test('resolves a Next hoisted to an ancestor folder inside the repository', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await nextApp(join(root, 'examples/web'))
  // Act
  const resolved = await resolveNextPackage(root, 'examples/web')
  // Assert
  assert.equal(resolved.nextFolder, join(root, 'node_modules/next'))
})

// protects=E4: a pnpm link inside the repository resolves to its target; fails_when=the link itself is returned or refused; no_claim=windows junctions
test('resolves a pnpm-style link to the Next package inside the repository', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const store = join(root, 'node_modules/.pnpm/next@16.4.3/node_modules/next')
  await installNext(store)
  await nextApp(join(root, 'examples/web'))
  await mkdir(join(root, 'examples/web/node_modules'), { recursive: true })
  await symlink(store, join(root, 'examples/web/node_modules/next'))
  // Act
  const resolved = await resolveNextPackage(root, 'examples/web')
  // Assert
  assert.equal(resolved.nextFolder, store)
  assert.equal(resolved.nextExecutable, join(store, 'dist/bin/next'))
})

// protects=E4: a nearest Next that leaves the repository is not installed, even when an ancestor holds a valid Next; fails_when=the resolver falls back to the decoy root Next; no_claim=the message wording beyond its sentence
test('refuses a Next that resolves outside the repository even with a valid decoy Next at the root', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const outside = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await installNext(join(outside, 'next'))
  await nextApp(join(root, 'examples/web'))
  await mkdir(join(root, 'examples/web/node_modules'), { recursive: true })
  await symlink(
    join(outside, 'next'),
    join(root, 'examples/web/node_modules/next'),
  )
  // Act
  const error = await refusalOf(() => resolveNextPackage(root, 'examples/web'))
  // Assert
  assert.equal(error.code, 'PREREQUISITE_MISSING')
  assert.equal(
    error.message,
    "Next for examples/web resolves outside the repository; install the package's dependencies inside it",
  )
})

// protects=E4: a contained Next folder whose executable is a link leaving the repository is refused; fails_when=only the folder's containment is checked; no_claim=executables that are copies
test('refuses a contained Next folder whose executable links outside the repository', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const outside = await makeRepository(context)
  await put(join(outside, 'next-bin'), '#!/usr/bin/env node\n')
  await nextApp(join(root, 'examples/web'))
  const folder = join(root, 'examples/web/node_modules/next')
  await put(join(folder, 'package.json'), '{"name":"next"}')
  await mkdir(join(folder, 'dist/bin'), { recursive: true })
  await symlink(join(outside, 'next-bin'), join(folder, 'dist/bin/next'))
  // Act
  const error = await refusalOf(() => resolveNextPackage(root, 'examples/web'))
  // Assert
  assert.equal(error.code, 'PREREQUISITE_MISSING')
  assert.match(error.message, /resolves outside the repository/)
})

// protects=E4: an alias resolves from its target's ancestors, not the alias's; fails_when=the search starts at the alias path and finds the alias folder's Next; no_claim=cycles of links
test('resolves a symlinked package root from its target, not from the alias', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'targets/node_modules/next'))
  await installNext(join(root, 'aliases/node_modules/next'))
  await nextApp(join(root, 'targets/web'))
  await symlink(join(root, 'targets/web'), join(root, 'aliases/web'))
  // Act
  const resolved = await resolveNextPackage(root, 'aliases/web')
  // Assert
  assert.equal(resolved.packageRootRelative, 'targets/web')
  assert.equal(resolved.nextFolder, join(root, 'targets/node_modules/next'))
})

// protects=E5: a folder whose manifest names no next is refused with its reason; fails_when=any folder is accepted; no_claim=the manifest's version
test('refuses a package whose manifest does not name next', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await put(join(root, 'examples/web/package.json'), '{"name":"web"}')
  // Act
  const error = await refusalOf(() => resolveNextPackage(root, 'examples/web'))
  // Assert
  assert.equal(error.code, 'INVALID_CONFIGURATION')
  assert.equal(error.details?.reason, 'not-a-next-app')
})

// protects=E5: devDependencies and peerDependencies name next too; fails_when=only dependencies counts; no_claim=version ranges
test('accepts next named in devDependencies or peerDependencies', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await nextApp(join(root, 'a'), 'devDependencies')
  await nextApp(join(root, 'b'), 'peerDependencies')
  // Act
  const first = await resolveNextPackage(root, 'a')
  const second = await resolveNextPackage(root, 'b')
  // Assert
  assert.equal(first.packageRootRelative, 'a')
  assert.equal(second.packageRootRelative, 'b')
})

// protects=E5: a resolved next/package.json must be named next; fails_when=any folder at node_modules/next counts; no_claim=the install command's correctness
test('treats a node_modules/next folder whose manifest is not next as not installed', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await nextApp(join(root, 'web'))
  await put(
    join(root, 'web/node_modules/next/package.json'),
    '{"name":"other"}',
  )
  await put(join(root, 'web/node_modules/next/dist/bin/next'), '')
  await put(join(root, 'pnpm-lock.yaml'), '')
  // Act
  const error = await refusalOf(() => resolveNextPackage(root, 'web'))
  // Assert
  assert.equal(error.code, 'PREREQUISITE_MISSING')
  assert.match(error.message, /`pnpm install` at the repository root/)
})

// protects=DX-2/DX-16: a missing Next names the lockfile's install command and every folder searched; fails_when=the sentence is generic or the folders are not listed; no_claim=that Codebook runs the command (it never does)
test('names the folders searched and the lockfile install command when Next is missing', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await nextApp(join(root, 'examples/react/nextjs'))
  await put(join(root, 'yarn.lock'), '')
  // Act
  const error = await refusalOf(() =>
    resolveNextPackage(root, 'examples/react/nextjs'),
  )
  // Assert
  assert.deepEqual(error.details?.searched, [
    'examples/react/nextjs/node_modules/next',
    'examples/react/node_modules/next',
    'examples/node_modules/next',
    'node_modules/next',
  ])
  assert.match(error.message, /`yarn install` at the repository root/)
  assert.equal(error.details?.sideEffects, 'none')
})

// protects=AC 3/DX-5: each unusable packageRoot is refused INVALID_CONFIGURATION with field, declared value, reason and suggestions; fails_when=a reason is mislabeled or details are missing; no_claim=discovery of suggestions
test('refuses an unusable packageRoot with its reason', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const outside = await makeRepository(context)
  await put(join(root, 'file.txt'), 'x')
  await symlink(outside, join(root, 'escape'))
  const declaredValues = ['missing/app', 'file.txt', 'escape', '../elsewhere']
  // Act
  const answers: Array<[string, unknown, unknown, unknown]> = []
  for (const declared of declaredValues) {
    const error = await refusalOf(() =>
      resolveNextPackage(root, declared, { suggest: () => ['apps/web'] }),
    )
    answers.push([
      declared,
      error.code,
      error.details?.reason,
      error.details?.suggestions,
    ])
  }
  // Assert
  assert.deepEqual(answers, [
    ['missing/app', 'INVALID_CONFIGURATION', 'missing', ['apps/web']],
    ['file.txt', 'INVALID_CONFIGURATION', 'not-a-folder', ['apps/web']],
    ['escape', 'INVALID_CONFIGURATION', 'link-leaves-repository', ['apps/web']],
    [
      '../elsewhere',
      'INVALID_CONFIGURATION',
      'outside-repository',
      ['apps/web'],
    ],
  ])
})

// protects=E5: a declared value echoed in a message is sanitized; fails_when=control characters or an unbounded value reach the message; no_claim=other fields
test('sanitizes the declared packageRoot echoed in a refusal', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const declared = `a\nb${'x'.repeat(300)}`
  // Act
  const error = await refusalOf(() => resolveNextPackage(root, declared))
  // Assert
  assert.equal(String(error.details?.packageRoot).includes('\n'), false)
  assert.ok(String(error.details?.packageRoot).length <= 121)
})

// protects=AC 6: an absent or "." packageRoot reproduces today's root check and sentence; fails_when=the root app is judged by the nested rules or the message changes; no_claim=a root run's launch
test("keeps the root app on today's check and message", async (context) => {
  // Arrange
  const root = await makeRepository(context)
  const missing = await refusalOf(() => resolveNextPackage(root, undefined))
  await installNext(join(root, 'node_modules/next'))
  // Act
  const absent = await resolveNextPackage(root, undefined)
  const dot = await resolveNextPackage(root, '.')
  // Assert
  assert.equal(missing.code, 'PREREQUISITE_MISSING')
  assert.equal(
    missing.message,
    'Install the selected workspace dependencies, including Next, before using next-dev-webpack.',
  )
  assert.equal(absent.packageRoot, root)
  assert.equal(
    dot.nextExecutable,
    join(root, 'node_modules/next/dist/bin/next'),
  )
  assert.equal(dot.isRoot, true)
})

// protects=E16: mapping between repository-relative and package-relative paths; fails_when=the prefix is dropped, or a sibling folder with a shared name prefix counts as inside; no_claim=symlinks (a later test)
test('maps repository-relative paths to package-relative ones and back', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await nextApp(join(root, 'examples/web'))
  const resolved = await resolveNextPackage(root, 'examples/web')
  // Act
  const inside = resolved.toPackageRelative('examples/web/src/pages/index.tsx')
  const sibling = resolved.toPackageRelative('examples/web-other/a.ts')
  const shared = resolved.toPackageRelative('packages/ui/a.ts')
  const back = resolved.toRepositoryRelative('app/page.tsx')
  // Assert
  assert.equal(inside, 'src/pages/index.tsx')
  assert.equal(sibling, undefined)
  assert.equal(shared, undefined)
  assert.equal(back, 'examples/web/app/page.tsx')
})

// protects=E16: a module id classifier for App and Pages ids, the ./src/ prefix, ../ ids and Windows separators; fails_when=a ../ id is normalized back inside the package; no_claim=absolute file URLs
test('classifies Next module ids and never normalizes a ../ id back inside', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await nextApp(join(root, 'examples/web'))
  const resolved = await resolveNextPackage(root, 'examples/web')
  // Act
  const pages = resolved.classifyModuleId(
    'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx',
  )
  const app = resolved.classifyModuleId('webpack://_N_E/./app/page.tsx')
  const plain = resolved.classifyModuleId('./src/a.ts')
  const outside = resolved.classifyModuleId('../shared/a.ts')
  const sneaky = resolved.classifyModuleId('../web/src/a.ts')
  const windows = resolved.classifyModuleId('.\\src\\pages\\index.tsx')
  // Assert
  assert.deepEqual(pages, {
    kind: 'inside',
    packageRelative: 'src/pages/index.tsx',
    repositoryRelative: 'examples/web/src/pages/index.tsx',
  })
  assert.deepEqual(app, {
    kind: 'inside',
    packageRelative: 'app/page.tsx',
    repositoryRelative: 'examples/web/app/page.tsx',
  })
  assert.deepEqual(plain, {
    kind: 'inside',
    packageRelative: 'src/a.ts',
    repositoryRelative: 'examples/web/src/a.ts',
  })
  assert.deepEqual(outside, { kind: 'outside', id: '../shared/a.ts' })
  assert.deepEqual(sneaky, { kind: 'outside', id: '../web/src/a.ts' })
  assert.deepEqual(windows, {
    kind: 'inside',
    packageRelative: 'src/pages/index.tsx',
    repositoryRelative: 'examples/web/src/pages/index.tsx',
  })
})

// protects=E16: a symlinked alias of a file inside the package maps to its target, and a file whose target leaves the package maps to nothing; fails_when=the mapper compares lexical paths only; no_claim=directory aliases
test('maps a symlinked alias by its real path', async (context) => {
  // Arrange
  const root = await makeRepository(context)
  await installNext(join(root, 'node_modules/next'))
  await nextApp(join(root, 'examples/web'))
  await put(join(root, 'examples/web/src/real.ts'), 'x')
  await put(join(root, 'packages/ui/shared.ts'), 'x')
  await symlink(join(root, 'examples/web/src/real.ts'), join(root, 'alias.ts'))
  await symlink(
    join(root, 'packages/ui/shared.ts'),
    join(root, 'examples/web/src/shared-alias.ts'),
  )
  const resolved = await resolveNextPackage(root, 'examples/web')
  // Act
  const insideAlias = await resolved.toPackageRelativeByRealPath('alias.ts')
  const outsideTarget = await resolved.toPackageRelativeByRealPath(
    'examples/web/src/shared-alias.ts',
  )
  // Assert
  assert.equal(insideAlias, 'src/real.ts')
  assert.equal(outsideTarget, undefined)
})
