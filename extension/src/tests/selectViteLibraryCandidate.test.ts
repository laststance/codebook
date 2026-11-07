import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  selectViteLibraryCandidate,
  type ViteLibraryModuleSource,
  type ViteLibrarySelection,
} from '../utils/selectViteLibraryCandidate'
import type { ViteLibraryModules } from '../utils/viteLibraryModules'

import { removeTestFolder } from './utils/removeTestFolder'

const OWNED_ORIGIN = 'http://127.0.0.1:4321'
const APP_ROOT = '/repo/examples/app'
const FILE = '/repo/packages/core/src/a.ts'
const TEXT = 'export const a = 1\nexport const b = 2\n'
const MODERN = '/@fs/repo/packages/core/build/modern/a.js?v=abc'
const LEGACY = '/@fs/repo/packages/core/build/legacy/a.js?v=abc'

/** Builds a served module text with an inline map; `rawMap` replaces the encoded JSON text to make a map that cannot be read. */
function served(
  options: {
    sources?: string[]
    sourcesContent?: (string | null)[]
    mappings?: string
    rawMap?: string
  } = {},
): string {
  const map = JSON.stringify({
    version: 3,
    sources: options.sources ?? ['../../src/a.ts'],
    sourcesContent: options.sourcesContent ?? [TEXT],
    names: [],
    mappings: options.mappings ?? 'AAAA;AACA',
  })
  const encoded = Buffer.from(options.rawMap ?? map).toString('base64')
  return `export {}\n//# sourceMappingURL=data:application/json;base64,${encoded}`
}

/** Selects among scripted modules; the walk answer defaults to listing every module. */
function select(
  modules: Record<string, string>,
  options: {
    walk?: Partial<ViteLibraryModules>
    line?: number
    citationEndLine?: number
    file?: string
    appRoot?: string
  } = {},
): Promise<ViteLibrarySelection> {
  const source: ViteLibraryModuleSource = {
    list: async () => ({
      modules: Object.keys(modules),
      optimizedLibrary: false,
      ...options.walk,
    }),
    read: async (path) => modules[path]!,
  }
  return selectViteLibraryCandidate({
    source,
    stop: {
      realPath: options.file ?? FILE,
      text: TEXT,
      line: options.line ?? 1,
      citationEndLine: options.citationEndLine ?? 2,
    },
    ownedOrigin: OWNED_ORIGIN,
    appRoot: options.appRoot ?? APP_ROOT,
  })
}

// protects=Cycle 0078 row 1 of the seal: the one served module whose map names the stop file and maps its line is the candidate, found by its /@fs/ map entry; fails_when=the module is not selected or another address is returned; no_claim=a real Vite server (the modules are scripted texts)
test('selects the one served library module whose inline map names the stop file and maps its line', async () => {
  // Arrange
  const modules = { [MODERN]: served() }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'selected',
    modulePath: MODERN,
    javascript: modules[MODERN],
  })
})

// protects=decision table row 2 (bound): a walk that ended at the module or byte bound is refused as library-build-unmapped with cause bound, never guessed from a partial list; fails_when=a partial list seals a module; no_claim=the launcher's own bounds (Lane A)
test('refuses a walk that ended at the module bound as library-build-unmapped with cause bound', async () => {
  // Arrange
  const modules = { [MODERN]: served() }
  // Act
  const result = await select(modules, { walk: { bound: 'modules' } })
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'bound' },
  })
})

// protects=decision table row 2 (bound): the byte bound is the same cause as the module bound; fails_when=bytes is reported as another cause; no_claim=none beyond protects
test('refuses a walk that ended at the byte bound as library-build-unmapped with cause bound', async () => {
  // Arrange
  const modules = { [MODERN]: served() }
  // Act
  const result = await select(modules, { walk: { bound: 'bytes' } })
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'bound' },
  })
})

// protects=decision table row 2 (deadline): a walk that ended at the time bound is cause deadline; fails_when=deadline is reported as bound; no_claim=none beyond protects
test('refuses a walk that ended at the time bound as library-build-unmapped with cause deadline', async () => {
  // Arrange
  const modules = { [MODERN]: served() }
  // Act
  const result = await select(modules, { walk: { bound: 'deadline' } })
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'deadline' },
  })
})

// protects=decision table row 3: a library the page reaches only through an optimized dependency is refused as prebundled; fails_when=it is refused as not-in-build or sealed; no_claim=a real optimizer (the walk answer is scripted)
test('refuses a library reached only as an optimized dependency as library-build-unmapped with cause prebundled', async () => {
  // Arrange / Act
  const result = await select({}, { walk: { optimizedLibrary: true } })
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'prebundled' },
  })
})

// protects=decision D15: a walk that reaches no module under the library folder, with no optimized dependency, is library-not-in-build with no candidates; fails_when=it reaches the map rows or is refused as outside-package; no_claim=none beyond protects
test('refuses a walk that reaches no module of the library as library-not-in-build with an empty candidate list', async () => {
  // Arrange / Act
  const result = await select({})
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-not-in-build', candidates: [] },
  })
})

// protects=decision table row 4: when no listed module carries an inline map the refusal is no-map; fails_when=the refusal is stale, malformed or a seal of a map-less module; no_claim=none beyond protects
test('refuses modules without any inline map as library-build-unmapped with cause no-map', async () => {
  // Arrange
  const modules = { [MODERN]: 'export {}\n' }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'no-map' },
  })
})

// protects=decision table row 5: a map whose sources entry is not a parseable URL is refused as malformed instead of throwing; fails_when=the raw TypeError of new URL escapes the selection; no_claim=none beyond protects
test('refuses a served map with an unparseable source entry as library-build-unmapped with cause malformed', async () => {
  // Arrange
  const modules = { [MODERN]: served({ sources: ['http://'] }) }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'malformed' },
  })
})

// protects=decision table row 5: a map that is not a flat version 3 map is refused as malformed even when another module has no map; fails_when=a malformed map is read as no-map; no_claim=none beyond protects
test('refuses a malformed served map as library-build-unmapped with cause malformed', async () => {
  // Arrange
  const modules = {
    [MODERN]: served({ rawMap: 'this is not json' }),
    [LEGACY]: 'export {}\n',
  }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'malformed' },
  })
})

// protects=decision table row 6: no map naming the stop file is no-map, while an unrelated module elsewhere in the list never refuses; fails_when=the unrelated module's map is read as the stop's; no_claim=none beyond protects
test('refuses when no served map names the stop file as library-build-unmapped with cause no-map', async () => {
  // Arrange
  const modules = { [MODERN]: served({ sources: ['../../src/other.ts'] }) }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'no-map' },
  })
})

// protects=decision table row 7: a map that names the file without its text is no-content; fails_when=the module is sealed without proof the code came from the file; no_claim=none beyond protects
test('refuses a map that names the stop file without sourcesContent as library-build-unmapped with cause no-content', async () => {
  // Arrange
  const modules = { [MODERN]: served({ sourcesContent: [null] }) }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'no-content' },
  })
})

// protects=decision table row 8: a map whose sourcesContent differs from the file on disk is a stale build; fails_when=a stale build is sealed or reported as unmapped; no_claim=none beyond protects
test('refuses a map whose sourcesContent differs from the checked-out file as library-build-stale', async () => {
  // Arrange
  const modules = {
    [MODERN]: served({ sourcesContent: ['export const a = 0\n'] }),
  }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-stale' },
  })
})

// protects=decision table row 9: two served modules (modern and legacy) that map the line are library-not-in-build with both addresses; fails_when=one of them is guessed; no_claim=none beyond protects
test('refuses two modules that both map the stop line as library-not-in-build listing both module addresses', async () => {
  // Arrange
  const modules = { [MODERN]: served(), [LEGACY]: served() }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-not-in-build', candidates: [MODERN, LEGACY] },
  })
})

// protects=decision table row 9: one map that names the file twice is ambiguous; fails_when=the first entry is taken; no_claim=none beyond protects
test('refuses one map that names the stop file twice as library-not-in-build', async () => {
  // Arrange
  const modules = {
    [MODERN]: served({
      sources: ['../../src/a.ts', '../../src/a.ts'],
      sourcesContent: [TEXT, TEXT],
    }),
  }
  // Act
  const result = await select(modules)
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-not-in-build', candidates: [MODERN] },
  })
})

// protects=decision table row 10: a map that names the file but has no segment for the declared line or a later citation line is no-line; fails_when=the module is sealed and the stop can never bind; no_claim=none beyond protects
test('refuses a map with no segment for the declared line or a later citation line as library-build-unmapped with cause no-line', async () => {
  // Arrange
  const modules = { [MODERN]: served({ mappings: 'AAAA' }) }
  // Act
  const result = await select(modules, { line: 2, citationEndLine: 2 })
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'no-line' },
  })
})

// protects=candidate rule: a map that lacks the declared line but maps a later line of the citation still qualifies and a second module without any segment does not make it ambiguous; fails_when=the later citation line is ignored or the line-less module is counted; no_claim=none beyond protects
test('selects the module that maps a later citation line when another module names the file without a segment for it', async () => {
  // Arrange
  const modules = {
    [MODERN]: served({ mappings: 'AAAA;AACA' }),
    [LEGACY]: served({ mappings: 'AAAA' }),
  }
  // Act
  const result = await select(modules, { line: 2, citationEndLine: 3 })
  // Assert
  assert.equal(result.kind, 'selected')
  assert.equal(result.kind === 'selected' && result.modulePath, MODERN)
})

// protects=table order: a stale module wins over a second candidate (row 8 before row 9), and a malformed map wins over a missing one (row 5 before row 6); fails_when=a later row is reported first; no_claim=none beyond protects
test('reports the first decision-table row that holds when several rows hold', async () => {
  // Arrange
  const stale = {
    [MODERN]: served(),
    [LEGACY]: served({ sourcesContent: ['old\n'] }),
  }
  const broken = {
    [MODERN]: served({ rawMap: '{' }),
    [LEGACY]: served({ sources: ['x.ts'] }),
  }
  // Act
  const staleResult = await select(stale)
  const brokenResult = await select(broken)
  // Assert
  assert.deepEqual(staleResult, {
    kind: 'refused',
    facts: { reason: 'library-build-stale' },
  })
  assert.deepEqual(brokenResult, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'malformed' },
  })
})

/** Writes a real library file below a temp repository reached through a symlinked folder. */
async function linkedLibrary(context: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'vite-library-')))
  context.after(() => removeTestFolder(root))
  await mkdir(join(root, 'packages/core/src'), { recursive: true })
  await mkdir(join(root, 'packages/core/build/modern'), { recursive: true })
  await writeFile(join(root, 'packages/core/src/a.ts'), TEXT)
  await symlink(join(root, 'packages/core'), join(root, 'linked-core'))
  return root
}

// protects=Cycle 0078 /@fs/ resolution: a map entry that resolves to /@fs/<path through a link> is compared by real path with the stop file; fails_when=the link spelling makes the module a non-match; no_claim=Windows drive spellings
test('compares a /@fs/ map entry by real path with the stop file through a linked folder', async (context) => {
  // Arrange
  const root = await linkedLibrary(context)
  const modulePath = `/@fs${root}/linked-core/build/modern/a.js?v=1`
  const realFile = join(root, 'packages/core/src/a.ts')
  // Act
  const result = await select(
    { [modulePath]: served() },
    { file: realFile, appRoot: join(root, 'examples/app') },
  )
  // Assert
  assert.equal(result.kind, 'selected')
})

// protects=decision table row 2 (deadline) for reads: all module reads of one selection share one deadline, so a server that never answers refuses at the deadline instead of waiting per module; fails_when=the selection waits for each read (it never returns here) or reports another cause; no_claim=real fetch timeouts (the reads are scripted promises that never settle)
test('refuses with cause deadline when the module reads together pass the total deadline', async () => {
  // Arrange
  const source: ViteLibraryModuleSource = {
    list: async () => ({ modules: [MODERN, LEGACY], optimizedLibrary: false }),
    read: () => new Promise<string>(() => undefined),
  }
  // Act
  const result = await selectViteLibraryCandidate({
    source,
    stop: { realPath: FILE, text: TEXT, line: 1, citationEndLine: 2 },
    ownedOrigin: OWNED_ORIGIN,
    appRoot: APP_ROOT,
    deadlineMs: 50,
  })
  // Assert
  assert.deepEqual(result, {
    kind: 'refused',
    facts: { reason: 'library-build-unmapped', cause: 'deadline' },
  })
})

// protects=read parallelism: at most eight modules are read at once and the readings keep the listed order; fails_when=more than eight reads overlap or the selected module is the wrong one because order was lost; no_claim=real fetches
test('reads at most eight modules at the same time and still selects the right one', async () => {
  // Arrange
  const paths = Array.from(
    { length: 20 },
    (_, index) => `/@fs/repo/packages/core/build/modern/m${index}.js`,
  )
  const target = '/@fs/repo/packages/core/build/modern/m13.js'
  let active = 0
  let peak = 0
  const source: ViteLibraryModuleSource = {
    list: async () => ({ modules: paths, optimizedLibrary: false }),
    read: async (path) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return path === target ? served() : 'export {}\n'
    },
  }
  // Act
  const result = await selectViteLibraryCandidate({
    source,
    stop: { realPath: FILE, text: TEXT, line: 1, citationEndLine: 2 },
    ownedOrigin: OWNED_ORIGIN,
    appRoot: APP_ROOT,
  })
  // Assert
  assert.equal(peak, 8)
  assert.equal(result.kind, 'selected')
  assert.equal(result.kind === 'selected' && result.modulePath, target)
})

// protects=owned origin: a listed path that is not a single-slash path on the owned server is never read; fails_when=a scheme-relative or host-looking path reaches read(); no_claim=the launcher never lists such paths today
test('never reads a listed path that would leave the owned origin', async () => {
  // Arrange
  const reads: string[] = []
  const source: ViteLibraryModuleSource = {
    list: async () => ({
      modules: ['//evil.test/a.js', '@evil.test/a.js', MODERN],
      optimizedLibrary: false,
    }),
    read: async (path) => {
      reads.push(path)
      return served()
    },
  }
  // Act
  const result = await selectViteLibraryCandidate({
    source,
    stop: { realPath: FILE, text: TEXT, line: 1, citationEndLine: 2 },
    ownedOrigin: OWNED_ORIGIN,
    appRoot: APP_ROOT,
  })
  // Assert
  assert.deepEqual(reads, [MODERN])
  assert.equal(result.kind, 'selected')
})

// protects=a failed module read stops the other workers from starting more reads; fails_when=the remaining listed modules keep being fetched after the first failure; no_claim=real fetches and the byte cap (reads are scripted promises)
test('stops starting module reads after one read fails and still reports that failure', async () => {
  // Arrange
  const paths = Array.from(
    { length: 30 },
    (_, index) => `/@fs/repo/packages/core/build/modern/m${index}.js`,
  )
  let started = 0
  const source: ViteLibraryModuleSource = {
    list: async () => ({ modules: paths, optimizedLibrary: false }),
    read: async (path) => {
      started += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (path === paths[0]) throw new Error('library module fetch failed')
      return 'export {}\n'
    },
  }
  // Act
  const outcome = selectViteLibraryCandidate({
    source,
    stop: { realPath: FILE, text: TEXT, line: 1, citationEndLine: 2 },
    ownedOrigin: OWNED_ORIGIN,
    appRoot: APP_ROOT,
  })
  await assert.rejects(outcome, /library module fetch failed/)
  await new Promise((resolve) => setTimeout(resolve, 100))
  // Assert
  assert.equal(started, 8)
})
