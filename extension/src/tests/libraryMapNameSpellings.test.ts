import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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

const roots: string[] = []
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

/**
 * Freezes a one-flavour library build whose map spells the source's name in a chosen way.
 *
 * @param fileName - The real source file name under `packages/core/src`.
 * @param mapSource - The `sources` entry the map carries, relative to the map.
 * @param rawMapText - Rewrites the map's JSON text, to put escapes into the raw spelling.
 * @returns The freeze result.
 */
async function freezeWithSpelling(
  fileName: string,
  mapSource: string,
  rawMapText: (json: string) => string,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-name-')))
  roots.push(root)
  const stopPath = `packages/core/src/${fileName}`
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await writeFile(
    join(root, 'packages/core/package.json'),
    '{"name":"@scope/core"}',
  )
  await writeFile(join(root, stopPath), SOURCE)
  const output = ts.transpileModule(SOURCE, {
    fileName: 'core.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
  })
  const map = JSON.parse(output.sourceMapText!)
  map.sources = [mapSource]
  const folder = join(root, 'packages/core/build/modern')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'core.js'),
    output.outputText.replace(
      /\/\/# sourceMappingURL=.*$/m,
      '//# sourceMappingURL=core.js.map',
    ),
  )
  await writeFile(join(folder, 'core.js.map'), rawMapText(JSON.stringify(map)))
  const library: LibraryPackage = {
    name: '@scope/core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  }
  return freezeLibraryBuild({
    repositoryRoot: root,
    packageRootRelative: 'examples/app',
    library,
    stop: {
      path: stopPath,
      sha256: sha256(SOURCE),
      line: 2,
      citationEndLine: 5,
    },
    signal: new AbortController().signal,
    budget: { readBytes: 0, spentMs: 0 },
  })
}

// protects=AC 1 on a real library layout: a map whose sources entry writes a non-ASCII letter as a JSON unicode escape still names its file for the pre-filter; fails_when=the library is refused as no-map because `café.ts` is skipped as unrelated; no_claim=normalization differences between NFC and NFD names
test('freezes a build whose map writes a non-ASCII source name with a unicode escape', async () => {
  // Arrange
  const escapeAccent = (json: string) => json.replace('é', '\\u00e9')
  // Act
  const frozen = await freezeWithSpelling(
    'café.ts',
    '../../src/café.ts',
    escapeAccent,
  )
  // Assert
  assert.deepEqual(
    frozen.candidates.map((candidate) => candidate.builtPath),
    ['packages/core/build/modern/core.js'],
  )
  assert.equal(frozen.armedSourceLine, 2)
})
