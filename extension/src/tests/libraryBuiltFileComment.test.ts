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
import { join } from 'node:path'
import { after, test } from 'node:test'

import ts from 'typescript'

import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  freezeLibraryBuild,
  type LibraryPackage,
} from '../utils/libraryBuildStop'

const SOURCE = [
  'export function a(x: number) {',
  '  const y = x + 1',
  '',
  '  return y * 2',
  '}',
  '',
].join('\n')
const STOP_PATH = 'packages/core/src/core.ts'
const APP_ROOT = 'examples/app'

const roots: string[] = []
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

/**
 * Builds a temp repository whose library has one build flavour with a valid map,
 * and whose built file ends with the given trailing text instead of a map comment.
 *
 * Called by each test below; `trailer` replaces the `sourceMappingURL` comment.
 *
 * @param trailer - Text appended to the built file (a newline alone = no comment).
 * @returns The request {@link freezeLibraryBuild} takes.
 */
async function createRequest(
  trailer: string,
): Promise<Parameters<typeof freezeLibraryBuild>[0]> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'library-built-comment-')),
  )
  roots.push(root)
  await mkdir(join(root, APP_ROOT, 'node_modules/@scope'), { recursive: true })
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await writeFile(
    join(root, 'packages/core/package.json'),
    '{"name":"@scope/core"}',
  )
  await writeFile(join(root, STOP_PATH), SOURCE)
  const output = ts.transpileModule(SOURCE, {
    fileName: 'core.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
  })
  const map = JSON.parse(output.sourceMapText!) as { sources: string[] }
  map.sources = ['../../src/core.ts']
  // Drop the generated comment; the test decides what the file ends with.
  const js = output.outputText.replace(/\/\/# sourceMappingURL=.*$/m, '')
  const folder = join(root, 'packages/core/build/modern')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'core.js'), js + trailer)
  await writeFile(join(folder, 'core.js.map'), JSON.stringify(map))
  await symlink(
    join(root, 'packages/core'),
    join(root, APP_ROOT, 'node_modules/@scope/core'),
  )
  const library: LibraryPackage = {
    name: '@scope/core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  }
  return {
    repositoryRoot: root,
    packageRootRelative: APP_ROOT,
    library,
    stop: {
      path: STOP_PATH,
      sha256: sha256(SOURCE),
      line: 2,
      citationEndLine: 5,
    },
    signal: new AbortController().signal,
    budget: { readBytes: 0, spentMs: 0 },
  }
}

/** Awaits a promise that must reject and returns the refusal. */
async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { code: string; details: Record<string, unknown> }
  }
  return assert.fail('expected a refusal')
}

// protects=a built file that never announces a map is not trusted via a sibling .map; fails_when=a missing sourceMappingURL comment still freezes; no_claim=maps read from inline data URLs
test('refuses a library whose built file has no sourceMappingURL comment as malformed', async () => {
  // Arrange
  const request = await createRequest('\n')

  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))

  // Assert
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusal.details.reason, 'library-build-unmapped')
  assert.equal(refusal.details.cause, 'malformed')
  assert.equal(refusal.details.sideEffects, 'none')
})

// protects=a built file naming another map is not accepted via the sibling core.js.map; fails_when=the comment's name is not compared with the map's name; no_claim=the other map's existence
test('refuses a library whose built file names a different map as malformed', async () => {
  // Arrange
  const request = await createRequest('\n//# sourceMappingURL=other.js.map\n')

  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))

  // Assert
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusal.details.reason, 'library-build-unmapped')
  assert.equal(refusal.details.cause, 'malformed')
  assert.equal(refusal.details.sideEffects, 'none')
})
