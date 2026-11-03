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
  '  return x * 2',
  '}',
  '',
].join('\n')
const STOP_PATH = 'packages/core/src/core.ts'

const roots: string[] = []
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

/**
 * Stages a library whose single build `build/modern/core.js` ends with the given comment URL.
 * @param commentUrl - The text after `sourceMappingURL=`.
 * @returns The request {@link freezeLibraryBuild} takes. A `build/other/core.js.map` copy exists when the URL mentions `other`, as the stale same-name map the wrong comment would point at.
 */
async function stage(
  commentUrl: string,
): Promise<Parameters<typeof freezeLibraryBuild>[0]> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-map-loc-')))
  roots.push(root)
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }
  await put('packages/core/package.json', '{"name":"core"}')
  await put(STOP_PATH, SOURCE)
  const output = ts.transpileModule(SOURCE, {
    fileName: 'core.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
  })
  const map = JSON.stringify({
    ...JSON.parse(output.sourceMapText!),
    sources: ['../../src/core.ts'],
  })
  const js = output.outputText.replace(
    /\/\/# sourceMappingURL=.*$/m,
    `//# sourceMappingURL=${commentUrl}`,
  )
  await put('packages/core/build/modern/core.js', js)
  await put('packages/core/build/modern/core.js.map', map)
  if (commentUrl.includes('other')) {
    // A second, correct build: its own built file announces its own map.
    await put('packages/core/build/other/core.js.map', map)
    await put(
      'packages/core/build/other/core.js',
      js.replace(/sourceMappingURL=.*$/m, 'sourceMappingURL=core.js.map'),
    )
  }
  const library: LibraryPackage = {
    name: 'core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  }
  return {
    repositoryRoot: root,
    packageRootRelative: 'examples/app',
    library,
    stop: {
      path: STOP_PATH,
      sha256: sha256(SOURCE),
      line: 2,
      citationEndLine: 2,
    },
    signal: new AbortController().signal,
    budget: { readBytes: 0, spentMs: 0 },
  }
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code: string; details: Record<string, unknown> }> {
  try {
    await promise
  } catch (error) {
    return error as { code: string; details: Record<string, unknown> }
  }
  return assert.fail('expected a refusal')
}

// protects=the built file announces this map by location; fails_when=a comment naming a same-name map in another folder is accepted; no_claim=the run's use of the freeze
test('refuses a built file whose sourceMappingURL names a same-name map in another folder as library-build-unmapped', async () => {
  // Arrange
  const request = await stage('../other/core.js.map')
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))
  // Assert
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.equal(refusal.details.reason, 'library-build-unmapped')
  assert.equal(refusal.details.cause, 'malformed')
})

for (const spelling of ['./core.js.map', 'core.js.map']) {
  // protects=ordinary spellings of the own map still freeze; fails_when=a relative own-map comment is refused; no_claim=other spellings
  test(`freezes a built file whose sourceMappingURL is ${spelling}`, async () => {
    // Arrange
    const request = await stage(spelling)
    // Act
    const frozen = await freezeLibraryBuild(request)
    // Assert
    assert.deepEqual(
      frozen.candidates.map((candidate) => candidate.builtPath),
      ['packages/core/build/modern/core.js'],
    )
  })
}

for (const url of [
  'core%ZZ.js.map',
  'data:application/json;base64,e30=',
  '/abs/core.js.map',
]) {
  // protects=unusable comment URLs are malformed, not other errors; fails_when=an invalid escape throws URIError or an inline/absolute URL passes; no_claim=nothing
  test(`refuses sourceMappingURL ${url} as library-build-unmapped malformed`, async () => {
    // Arrange
    const request = await stage(url)
    // Act
    const refusal = await refusalOf(freezeLibraryBuild(request))
    // Assert
    assert.equal(refusal.details.reason, 'library-build-unmapped')
    assert.equal(refusal.details.cause, 'malformed')
  })
}
