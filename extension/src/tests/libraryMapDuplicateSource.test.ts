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
  type LibraryAppFolder,
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
 * Builds a temp repository whose library build map lists the stop file under several names.
 *
 * @param spellings - The map's `sources` entries, each relative to the map's folder.
 * @returns A request for {@link freezeLibraryBuild}.
 */
async function createRequest(spellings: string[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-dup-')))
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
  const map = JSON.parse(output.sourceMapText!) as {
    sources: string[]
    sourcesContent: string[]
  }
  map.sources = spellings
  map.sourcesContent = spellings.map(() => SOURCE)
  const folder = join(root, 'packages/core/build/modern')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'core.js'),
    output.outputText.replace(
      /\/\/# sourceMappingURL=.*$/m,
      '//# sourceMappingURL=core.js.map',
    ),
  )
  await writeFile(join(folder, 'core.js.map'), JSON.stringify(map))
  await symlink(
    join(root, 'packages/core'),
    join(root, APP_ROOT, 'node_modules/@scope/core'),
  )
  const app: LibraryAppFolder = {
    packageRoot: join(root, APP_ROOT) as LibraryAppFolder['packageRoot'],
    toPackageRelative: (path) =>
      path.startsWith(`${APP_ROOT}/`)
        ? (path.slice(APP_ROOT.length + 1) as ReturnType<
            LibraryAppFolder['toPackageRelative']
          >)
        : undefined,
    toPackageRelativeByRealPath: async (path) => app.toPackageRelative(path),
  }
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
    app,
  } satisfies Parameters<typeof freezeLibraryBuild>[0] & { app: unknown }
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { code: string; details: Record<string, unknown> }
  }
  return assert.fail('expected a refusal')
}

// protects=AC 4 duplicate source: a map naming the stop file under two spellings is never first-wins; fails_when=the found.length > 1 guard is dropped and the first entry is trusted; no_claim=maps that name the file once
test('refuses a build map that names the stop file twice instead of trusting the first entry', async () => {
  // Arrange
  const request = await createRequest([
    '../../src/core.ts',
    '../../src/./core.ts',
  ])
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))
  // Assert
  assert.equal(refusal.details.reason, 'library-build-unmapped')
  assert.equal(refusal.details.cause, 'malformed')
  assert.equal(refusal.details.sideEffects, 'none')
})

// protects=AC 4 duplicate source control: the same map naming the file once freezes; fails_when=the duplicate test above passes for an unrelated reason; no_claim=nothing else
test('freezes the same build map when it names the stop file once', async () => {
  // Arrange
  const request = await createRequest(['../../src/core.ts'])
  // Act
  const frozen = await freezeLibraryBuild(request)
  // Assert
  assert.equal(frozen.armedSourceLine, 2)
})
