import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import ts from 'typescript'

import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  freezeLibraryBuild,
  type LibraryPackage,
} from '../utils/libraryBuildStop'

import { removeTestFolder } from './utils/removeTestFolder'

const SOURCE = [
  'export function a(x: number) {',
  '  const y = x + 1',
  '',
  '  return y * 2',
  '}',
  '',
].join('\n')
const STOP_PATH = 'packages/core/src/core.ts'
const BUILT_PATH = 'packages/core/build/modern/core.js'

const roots: string[] = []
after(async () => {
  await Promise.all(roots.map((root) => removeTestFolder(root)))
})

/** Freezes a one-flavour library build whose map holds exactly `mappings`. */
async function freezeWithMappings(mappings: string) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'library-unmapped-')),
  )
  roots.push(root)
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await mkdir(join(root, 'packages/core/build/modern'), { recursive: true })
  await writeFile(join(root, 'packages/core/package.json'), '{"name":"core"}')
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
  const map = JSON.parse(output.sourceMapText!)
  map.sources = ['../../src/core.ts']
  map.mappings = mappings
  await writeFile(
    join(root, BUILT_PATH),
    output.outputText.replace(
      /\/\/# sourceMappingURL=.*$/m,
      '//# sourceMappingURL=core.js.map',
    ),
  )
  await writeFile(join(root, `${BUILT_PATH}.map`), JSON.stringify(map))
  const library: LibraryPackage = {
    name: 'core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  }
  return freezeLibraryBuild({
    repositoryRoot: root,
    packageRootRelative: 'examples/app',
    library,
    stop: {
      path: STOP_PATH,
      sha256: sha256(SOURCE),
      line: 5,
      citationEndLine: 5,
    },
    signal: new AbortController().signal,
    budget: { readBytes: 0, spentMs: 0 },
  })
}

// protects=G8 a built line holding unmapped helper code beside the stop's code is not unique without a column; fails_when=the unmapped segment is dropped and the line reads as source line 5; no_claim=real bundler maps
test('gives no source for a built line without a column when it holds unmapped generated code', async () => {
  // Arrange
  // Column 0 maps to no source; column 5 maps to source line 5.
  const frozen = await freezeWithMappings('A,KAIA')
  // Act
  const withoutColumn = frozen.toSource(BUILT_PATH, 1, undefined)
  // Assert
  assert.equal(withoutColumn, undefined)
})

// protects=G8 the column-given path stays exact; fails_when=a given column no longer reaches the mapped segment; no_claim=columns between segment starts
test('translates the same mixed line to source line 5 when the column is the mapped segment', async () => {
  // Arrange
  const frozen = await freezeWithMappings('A,KAIA')
  // Act
  const withColumn = frozen.toSource(BUILT_PATH, 1, 6)
  const unmappedColumn = frozen.toSource(BUILT_PATH, 1, 1)
  // Assert
  assert.deepEqual(withColumn, { line: 5, column: 1 })
  assert.equal(unmappedColumn, undefined)
})
