import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
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
  detectLibraryPackage,
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

type MapJson = {
  sources: string[]
  sourcesContent?: string[]
  mappings: string
}

/** Compiles the source into one build flavour with a real map whose source names `src/core.ts` relative to the map. */
function compile(source: string): { js: string; map: MapJson } {
  const output = ts.transpileModule(source, {
    fileName: 'core.ts',
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
  })
  const map: MapJson = JSON.parse(output.sourceMapText!)
  map.sources = ['../../src/core.ts']
  return {
    js: output.outputText.replace(
      /\/\/# sourceMappingURL=.*$/m,
      '//# sourceMappingURL=core.js.map',
    ),
    map,
  }
}

type Fixture = {
  root: string
  app: LibraryAppFolder
  library: LibraryPackage
  request: Parameters<typeof freezeLibraryBuild>[0]
}

/** Builds a temp repository: a linked app, a library with `modern` and `legacy` builds of `core.ts`. */
async function createFixture(
  options: {
    editMap?: (map: MapJson, flavour: string) => void
    link?: 'app' | 'root' | 'none'
  } = {},
): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'library-build-')))
  roots.push(root)
  await mkdir(join(root, APP_ROOT, 'node_modules/@scope'), { recursive: true })
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await writeFile(
    join(root, 'packages/core/package.json'),
    '{"name":"@scope/core"}',
  )
  await writeFile(join(root, STOP_PATH), SOURCE)
  for (const flavour of ['modern', 'legacy']) {
    const { js, map } = compile(SOURCE)
    options.editMap?.(map, flavour)
    const folder = join(root, 'packages/core/build', flavour)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'core.js'), js)
    await writeFile(join(folder, 'core.js.map'), JSON.stringify(map))
  }
  const link = options.link ?? 'app'
  if (link === 'app')
    await symlink(
      join(root, 'packages/core'),
      join(root, APP_ROOT, 'node_modules/@scope/core'),
    )
  if (link === 'root') {
    await mkdir(join(root, 'node_modules/@scope'), { recursive: true })
    await symlink(
      join(root, 'packages/core'),
      join(root, 'node_modules/@scope/core'),
    )
  }
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
    root,
    app,
    library,
    request: {
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
    },
  }
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { code: string; details: Record<string, unknown> }
  }
  return assert.fail('expected a refusal')
}

// protects=AC 2 detection: a library the app links to is found; fails_when=a linked workspace library is refused as outside-package; no_claim=the run's use of the library
test('finds the workspace library an app links to through its own node_modules', async () => {
  // Arrange
  const { root, app } = await createFixture({ link: 'app' })
  // Act
  const library = await detectLibraryPackage(root, app, STOP_PATH)
  // Assert
  assert.deepEqual(library, {
    name: '@scope/core',
    folder: 'packages/core',
    realFolder: join(root, 'packages/core'),
  })
})

// protects=AC 2 detection: a hoisted root link counts; fails_when=a hoisted workspace library keeps the outside-package refusal; no_claim=other hoist levels
test('finds a workspace library linked from the repository root node_modules', async () => {
  // Arrange
  const { root, app } = await createFixture({ link: 'root' })
  // Act
  const library = await detectLibraryPackage(root, app, STOP_PATH)
  // Assert
  assert.equal(library?.name, '@scope/core')
})

// protects=AC 5 detection: an unrelated sibling package is no library of the app; fails_when=any package folder in the repository is sealed; no_claim=nothing
test('does not treat an unlinked sibling package as the app library', async () => {
  // Arrange
  const { root, app } = await createFixture({ link: 'none' })
  // Act
  const library = await detectLibraryPackage(root, app, STOP_PATH)
  // Assert
  assert.equal(library, undefined)
})

// protects=AC 5 detection: a link that leaves the repository is refused; fails_when=a library outside the checked-out repository is trusted; no_claim=nothing
test('does not treat a library folder that is a link leaving the repository as inside it', async () => {
  // Arrange
  const { root, app } = await createFixture({ link: 'none' })
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'library-outside-')),
  )
  roots.push(outside)
  await mkdir(join(outside, 'src'), { recursive: true })
  await writeFile(join(outside, 'package.json'), '{"name":"@scope/out"}')
  await writeFile(join(outside, 'src/out.ts'), SOURCE)
  await symlink(outside, join(root, 'packages/out'))
  await symlink(outside, join(root, APP_ROOT, 'node_modules/@scope/out'))
  // Act
  const library = await detectLibraryPackage(
    root,
    app,
    'packages/out/src/out.ts',
  )
  // Assert
  assert.equal(library, undefined)
})

// protects=today's behavior: a file inside the app is not a library file; fails_when=app files are routed to the library path; no_claim=nothing
test('does not treat a file inside the app folder as a library file', async () => {
  // Arrange
  const { root, app } = await createFixture()
  // Act
  const library = await detectLibraryPackage(
    root,
    app,
    `${APP_ROOT}/pages/index.tsx`,
  )
  // Assert
  assert.equal(library, undefined)
})

// protects=AC 2/D6: both build flavours freeze as candidates with hashes and the armed line; fails_when=a flavour is dropped or a hash is missing; no_claim=which flavour the server compile holds
test('freezes both build flavours of a stop file whose maps carry the checked-out source', async () => {
  // Arrange
  const { request, root } = await createFixture()
  // Act
  const frozen = await freezeLibraryBuild(request)
  // Assert
  assert.deepEqual(
    frozen.candidates.map((candidate) => candidate.builtPath),
    [
      'packages/core/build/legacy/core.js',
      'packages/core/build/modern/core.js',
    ],
  )
  assert.equal(frozen.armedSourceLine, 2)
  assert.equal(frozen.sourceSha256, sha256(SOURCE))
  assert.equal(
    frozen.candidates[0]!.builtSha256,
    sha256(
      await readFile(join(root, 'packages/core/build/legacy/core.js'), 'utf8'),
    ),
  )
  assert.match(frozen.candidates[0]!.mapSha256, /^[0-9a-f]{64}$/)
})

// protects=AC 1 on a real library layout (P02's query-core builds core.d.ts.map and core.d.cts.map beside core.js.map): a declaration map that names the source without sourcesContent is no build candidate; fails_when=a type declaration map turns a correct build into a no-content refusal; no_claim=CSS or other non-JavaScript maps, which the same rule skips
test('ignores the declaration maps beside the JavaScript build when it freezes a library build', async () => {
  // Arrange
  const { request, root } = await createFixture()
  for (const flavour of ['modern', 'legacy']) {
    const folder = join(root, 'packages/core/build', flavour)
    const declarationMap = JSON.stringify({
      version: 3,
      file: 'core.d.ts',
      sources: ['../../src/core.ts'],
      names: [],
      mappings: 'AAAA',
    })
    await writeFile(join(folder, 'core.d.ts'), 'export {}\n')
    await writeFile(join(folder, 'core.d.ts.map'), declarationMap)
    await writeFile(join(folder, 'core.d.cts.map'), declarationMap)
  }
  // Act
  const frozen = await freezeLibraryBuild(request)
  // Assert
  assert.deepEqual(
    frozen.candidates.map((candidate) => candidate.builtPath),
    [
      'packages/core/build/legacy/core.js',
      'packages/core/build/modern/core.js',
    ],
  )
})

// protects=AC 3: a build older than the checked-out source is refused before start; fails_when=a stale build is frozen; no_claim=the rebuild itself
test('refuses a build whose sourcesContent differs from the checked-out file as library-build-stale', async () => {
  // Arrange
  const { request } = await createFixture()
  const edited = {
    ...request,
    stop: { ...request.stop, sha256: sha256(`${SOURCE}// edited\n`) },
  }
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(edited))
  // Assert
  assert.equal(refusal.code, 'NEXT_STOP_NOT_SEALED')
  assert.deepEqual(refusal.details, {
    reason: 'library-build-stale',
    packageRoot: APP_ROOT,
    library: '@scope/core',
    file: STOP_PATH,
    sideEffects: 'none',
  })
  assert.match(
    (refusal as unknown as Error).message,
    /pnpm --filter @scope\/core build/,
  )
})

// protects=AC 4 no-map: a library with no map naming the file is refused; fails_when=an unmapped build is frozen; no_claim=nothing
test('refuses a library whose build maps do not name the stop file as library-build-unmapped no-map', async () => {
  // Arrange
  const { request } = await createFixture({
    editMap: (map) => {
      map.sources = ['../../src/other.ts']
    },
  })
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))
  // Assert
  assert.equal(refusal.details.reason, 'library-build-unmapped')
  assert.equal(refusal.details.cause, 'no-map')
  assert.equal(refusal.details.sideEffects, 'none')
})

// protects=AC 4 no-content: a map without sourcesContent cannot prove correspondence; fails_when=such a map is trusted; no_claim=nothing
test('refuses a map that names the file without sourcesContent as no-content', async () => {
  // Arrange
  const { request } = await createFixture({
    editMap: (map) => {
      delete map.sourcesContent
    },
  })
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))
  // Assert
  assert.equal(refusal.details.cause, 'no-content')
})

// protects=AC 4 no-line: a stop with no mapped line in its citation is refused; fails_when=an unmapped stop is armed; no_claim=nothing
test('refuses a citation with no mapped line as no-line', async () => {
  // Arrange
  const { request } = await createFixture()
  // Source line 3 is blank: no build mapping.
  const blank = {
    ...request,
    stop: { ...request.stop, line: 3, citationEndLine: 3 },
  }
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(blank))
  // Assert
  assert.equal(refusal.details.cause, 'no-line')
})

// protects=A3/resolveArmedPlace rule: a blank declared line arms the first later mapped line of the citation; fails_when=the declared blank line is armed; no_claim=nothing
test('arms the first later mapped line of the citation when the declared line has no mapping', async () => {
  // Arrange
  const { request } = await createFixture()
  const blank = {
    ...request,
    stop: { ...request.stop, line: 3, citationEndLine: 5 },
  }
  // Act
  const frozen = await freezeLibraryBuild(blank)
  // Assert
  assert.equal(frozen.armedSourceLine, 4)
})

// protects=AC 4 malformed: an unparsable map is refused; fails_when=it is skipped; no_claim=nothing
test('refuses a build map that cannot be parsed as malformed', async () => {
  // Arrange
  const { request, root } = await createFixture()
  await writeFile(
    join(root, 'packages/core/build/modern/core.js.map'),
    '{not json',
  )
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))
  // Assert
  assert.equal(refusal.details.cause, 'malformed')
})

// protects=A8 bound: more than 2,000 maps are refused; fails_when=an unbounded listing is read; no_claim=timing
test('refuses a library with more than 2000 build maps as bound', async () => {
  // Arrange
  const { request, root } = await createFixture()
  const folder = join(root, 'packages/core/dist')
  await mkdir(folder, { recursive: true })
  await Promise.all(
    Array.from({ length: 2001 }, (_, index) =>
      writeFile(join(folder, `m${index}.js.map`), '{}'),
    ),
  )
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(request))
  // Assert
  assert.equal(refusal.details.cause, 'bound')
})

// protects=A8 deadline: a read in flight is interrupted at the deadline; fails_when=the discovery waits past it; no_claim=the 5 s value
test('refuses as deadline when a map read is still in flight at the time limit', async () => {
  // Arrange
  const { request } = await createFixture()
  const hanging = {
    ...request,
    timeoutMs: 30,
    readText: (
      _root: string,
      _path: string,
      _limit: number,
      signal?: AbortSignal,
    ) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason))
      }),
  }
  // Act
  const refusal = await refusalOf(freezeLibraryBuild(hanging))
  // Assert
  assert.equal(refusal.details.cause, 'deadline')
  assert.equal(refusal.details.sideEffects, 'none')
})

// protects=A8 abort: the run's own abort is not turned into a refusal; fails_when=an aborted run reports a build refusal; no_claim=nothing
test('rethrows the abort of the run instead of refusing', async () => {
  // Arrange
  const { request } = await createFixture()
  const controller = new AbortController()
  controller.abort(new Error('run ended'))
  // Act
  const outcome = refusalOf(
    freezeLibraryBuild({ ...request, signal: controller.signal }),
  )
  // Assert
  assert.equal(((await outcome) as unknown as Error).message, 'run ended')
})

// protects=A8 budget: bytes read are charged to the run's budget; fails_when=the shared budget stays at zero; no_claim=exact byte counts
test('charges the bytes it reads to the shared run budget', async () => {
  // Arrange
  const { request } = await createFixture()
  // Act
  await freezeLibraryBuild(request)
  // Assert
  assert.ok(request.budget.readBytes > 0)
  assert.ok(request.budget.spentMs > 0)
})

// protects=D6 translation: source line to one built line per flavour and back; fails_when=a line is lost or misplaced; no_claim=Next's eval map
test('translates a source line to a built line per flavour and a built line back to the source', async () => {
  // Arrange
  const { request } = await createFixture()
  const frozen = await freezeLibraryBuild(request)
  // Act
  const built = frozen.toBuilt(4)
  const source = frozen.toSource(
    'packages/core/build/modern/core.js',
    3,
    undefined,
  )
  // Assert
  assert.deepEqual(built, [
    { builtPath: 'packages/core/build/legacy/core.js', builtLine: 3 },
    { builtPath: 'packages/core/build/modern/core.js', builtLine: 3 },
  ])
  assert.deepEqual(source, { line: 4, column: 3 })
  assert.deepEqual(frozen.toBuilt(3), [])
})

// protects=A3: a built line several source lines compile into has no unique source; fails_when=the first mapping is taken silently; no_claim=nothing
test('gives no source for a built line that several source lines compile into', async () => {
  // Arrange
  const { request } = await createFixture({
    editMap: (map) => {
      // Built line 1 maps source lines 1 and 2; built line 2 maps source line 3.
      map.mappings = 'AAAA,GACA;AACA'
    },
  })
  const frozen = await freezeLibraryBuild({
    ...request,
    stop: { ...request.stop, line: 1, citationEndLine: 3 },
  })
  const path = 'packages/core/build/modern/core.js'
  // Act
  const byLine = frozen.toSource(path, 1, undefined)
  const byFirstColumn = frozen.toSource(path, 1, 1)
  const bySecondColumn = frozen.toSource(path, 1, 4)
  const unambiguousLine = frozen.toSource(path, 2, undefined)
  // Assert
  assert.equal(byLine, undefined)
  assert.deepEqual(byFirstColumn, { line: 1, column: 1 })
  assert.deepEqual(bySecondColumn, { line: 2, column: 1 })
  assert.deepEqual(unambiguousLine, { line: 3, column: 1 })
})

// protects=A5: the module path as Next writes it for a nested app; fails_when=the depth or separator differs; no_claim=Next's layer prefix
test('writes the runtime module path relative to a nested app folder', async () => {
  // Arrange
  const { request } = await createFixture()
  const frozen = await freezeLibraryBuild(request)
  // Act
  const nested = frozen.runtimePath(
    'packages/core/build/modern/core.js',
    'examples/react/nextjs',
  )
  const shallow = frozen.runtimePath(
    'packages/core/build/modern/core.js',
    'packages/app',
  )
  // Assert
  assert.equal(nested, '../../../packages/core/build/modern/core.js')
  assert.equal(shallow, '../core/build/modern/core.js')
})

// protects=A4: the frozen built text decides whether an instance is the frozen one; fails_when=a changed build matches; no_claim=scriptId handling
test('recognizes only the frozen built text', async () => {
  // Arrange
  const { request, root } = await createFixture()
  const frozen = await freezeLibraryBuild(request)
  const path = 'packages/core/build/modern/core.js'
  const text = await readFile(join(root, path), 'utf8')
  // Act
  const same = frozen.matchesBuiltText(path, text)
  const changed = frozen.matchesBuiltText(path, `${text}\n`)
  const unknown = frozen.matchesBuiltText('packages/core/build/other.js', text)
  // Assert
  assert.equal(same, true)
  assert.equal(changed, false)
  assert.equal(unknown, false)
})
