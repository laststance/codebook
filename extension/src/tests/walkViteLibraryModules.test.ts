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
import { test } from 'node:test'

import {
  walkViteLibraryModules,
  type ViteWalkEnvironment,
} from '../utils/walkViteLibraryModules'

/** One module of a scripted graph. */
type ScriptedModule = {
  file: string
  code?: string
  imports?: string[]
  throws?: boolean
}

/** Builds a fake Vite client environment over a scripted graph and records every transformed URL. */
function fakeEnvironment(
  graph: Record<string, ScriptedModule>,
  extra: Partial<ViteWalkEnvironment> = {},
): { environment: ViteWalkEnvironment; transformed: string[] } {
  const transformed: string[] = []
  const environment: ViteWalkEnvironment = {
    async transformRequest(url) {
      const module = graph[url]
      if (!module || module.throws) throw new Error(`cannot transform ${url}`)
      transformed.push(url)
      return { code: module.code ?? '' }
    },
    moduleGraph: {
      async getModuleByUrl(url) {
        const module = graph[url]
        if (!module || !transformed.includes(url)) return undefined
        return {
          file: module.file,
          staticImportedUrls: new Set(module.imports ?? []),
        }
      },
    },
    ...extra,
  }
  return { environment, transformed }
}

// protects=a re-export chain and a dynamic-import target inside the library are all listed, in walk order; fails_when=the walk stops at the entry's direct imports or ignores staticImportedUrls of library modules; no_claim=real Vite (a fake environment stands in for it; E1 measured the real graph)
test('lists the library modules an app reaches through a re-export chain and an import() target, in walk order', async () => {
  // Arrange
  const { environment } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/src/main.tsx',
      imports: ['/@fs/repo/lib/index.js'],
    },
    '/@fs/repo/lib/index.js': {
      file: '/repo/lib/index.js',
      imports: ['/@fs/repo/lib/query.js'],
    },
    '/@fs/repo/lib/query.js': {
      file: '/repo/lib/query.js',
      imports: ['/@fs/repo/lib/lazy.js?t=5'],
    },
    '/@fs/repo/lib/lazy.js?t=5': { file: '/repo/lib/lazy.js' },
  })
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  })
  // Assert
  assert.deepEqual(result, {
    modules: [
      '/@fs/repo/lib/index.js',
      '/@fs/repo/lib/query.js',
      '/@fs/repo/lib/lazy.js?t=5',
    ],
    optimizedLibrary: false,
  })
})

// protects=an import cycle ends and each module is listed once; fails_when=the walk loops forever or lists a module twice; no_claim=real Vite
test('ends on an import cycle and lists each library module once', async () => {
  // Arrange
  const { environment, transformed } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/src/main.tsx',
      imports: ['/@fs/repo/lib/a.js', '/@fs/repo/lib/b.js'],
    },
    '/@fs/repo/lib/a.js': {
      file: '/repo/lib/a.js',
      imports: ['/@fs/repo/lib/b.js'],
    },
    '/@fs/repo/lib/b.js': {
      file: '/repo/lib/b.js',
      imports: ['/@fs/repo/lib/a.js', '/src/main.tsx'],
    },
  })
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  })
  // Assert
  assert.deepEqual(result.modules, ['/@fs/repo/lib/a.js', '/@fs/repo/lib/b.js'])
  assert.deepEqual(transformed, [
    '/src/main.tsx',
    '/@fs/repo/lib/a.js',
    '/@fs/repo/lib/b.js',
  ])
})

// protects=a pre-bundled dependency and Vite's virtual modules are never transformed; fails_when=the walk transforms /node_modules/.vite/ or /@vite/client URLs; no_claim=that real Vite lists them in the graph (the fake lists them on purpose)
test('never transforms an optimized dependency or a Vite virtual module', async () => {
  // Arrange
  const { environment, transformed } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/src/main.tsx',
      imports: [
        '/node_modules/.vite/deps/react.js?v=abc',
        '/@vite/client',
        '/@react-refresh',
        '/@id/__x00__virtual:thing',
        '\0plugin',
        '/@fs/repo/lib/index.js',
      ],
    },
    '/node_modules/.vite/deps/react.js?v=abc': {
      file: '/repo/app/node_modules/.vite/deps/react.js',
    },
    '/@vite/client': { file: '/repo/vite/client.mjs' },
    '/@react-refresh': { file: '/repo/vite/refresh.js' },
    '/@id/__x00__virtual:thing': { file: '/repo/lib/virtual.js' },
    '\0plugin': { file: '/repo/lib/plugin.js' },
    '/@fs/repo/lib/index.js': { file: '/repo/lib/index.js' },
  })
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  })
  // Assert
  assert.deepEqual(transformed, ['/src/main.tsx', '/@fs/repo/lib/index.js'])
  assert.deepEqual(result.modules, ['/@fs/repo/lib/index.js'])
})

// protects=a module whose file sits in the optimizer's cache folder is not listed or followed even when its URL looks ordinary; fails_when=the cacheDir check is dropped; no_claim=real Vite
test('does not follow a module whose file lies in the optimizer cache folder', async () => {
  // Arrange
  const { environment } = fakeEnvironment(
    {
      '/src/main.tsx': {
        file: '/repo/app/src/main.tsx',
        imports: ['/deps/chunk.js'],
      },
      '/deps/chunk.js': {
        file: '/repo/app/cache/deps/chunk.js',
        imports: ['/@fs/repo/lib/index.js'],
      },
      '/@fs/repo/lib/index.js': { file: '/repo/lib/index.js' },
    },
    { config: { cacheDir: '/repo/app/cache' } },
  )
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  })
  // Assert
  assert.deepEqual(result.modules, [])
})

// protects=optimizedLibrary is true only when an optimized dependency's source lies inside the library; fails_when=the flag is always false, always true, or ignores src; no_claim=real Vite's metadata object (the fake carries the same {src,file} entries)
test('reports optimizedLibrary true only when an optimized dependency has its source inside the library', async () => {
  // Arrange
  const react = {
    src: '/repo/node_modules/react/index.js',
    file: '/c/react.js',
  }
  const { environment: withLibrary } = fakeEnvironment(
    {},
    {
      depsOptimizer: {
        metadata: {
          optimized: {
            react,
            lib: { src: '/repo/lib/build/index.js', file: '/c/lib.js' },
          },
        },
      },
    },
  )
  const { environment: withoutLibrary } = fakeEnvironment(
    {},
    { depsOptimizer: { metadata: { optimized: { react } } } },
  )
  const { environment: withoutOptimizer } = fakeEnvironment({})
  const command = { entries: [], libraryFolder: '/repo/lib' }
  // Act
  const results = [
    (await walkViteLibraryModules(withLibrary, command)).optimizedLibrary,
    (await walkViteLibraryModules(withoutLibrary, command)).optimizedLibrary,
    (await walkViteLibraryModules(withoutOptimizer, command)).optimizedLibrary,
  ]
  // Assert
  assert.deepEqual(results, [true, false, false])
})

// protects=a walk that reaches the module limit stops with the modules found so far and names the bound; fails_when=the limit is ignored or the bound is not named; no_claim=the production limit of 500 (a limit of 2 is injected)
test('stops at the module limit and answers what it found with the modules bound', async () => {
  // Arrange
  const { environment, transformed } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/main.tsx',
      imports: ['/@fs/repo/lib/a.js', '/@fs/repo/lib/b.js'],
    },
    '/@fs/repo/lib/a.js': { file: '/repo/lib/a.js' },
    '/@fs/repo/lib/b.js': { file: '/repo/lib/b.js' },
  })
  // Act
  const result = await walkViteLibraryModules(
    environment,
    { entries: ['/src/main.tsx'], libraryFolder: '/repo/lib' },
    { moduleLimitCount: 2 },
  )
  // Assert
  assert.deepEqual(result, {
    modules: ['/@fs/repo/lib/a.js'],
    optimizedLibrary: false,
    bound: 'modules',
  })
  assert.deepEqual(transformed, ['/src/main.tsx', '/@fs/repo/lib/a.js'])
})

// protects=a walk that has read the byte limit stops and names the bytes bound; fails_when=transformed code is not counted in UTF-8 bytes; no_claim=the production limit of 20 MB (a limit of 10 bytes is injected)
test('stops once the transformed code reaches the byte limit and names the bytes bound', async () => {
  // Arrange
  const { environment } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/main.tsx',
      // 4 characters, 12 bytes in UTF-8
      code: '日本語。',
      imports: ['/@fs/repo/lib/a.js'],
    },
    '/@fs/repo/lib/a.js': { file: '/repo/lib/a.js' },
  })
  // Act
  const result = await walkViteLibraryModules(
    environment,
    { entries: ['/src/main.tsx'], libraryFolder: '/repo/lib' },
    { codeLimitBytes: 10 },
  )
  // Assert
  assert.deepEqual(result, {
    modules: [],
    optimizedLibrary: false,
    bound: 'bytes',
  })
})

// protects=a walk that outlasts its deadline stops and names the deadline bound; fails_when=the clock is not read before each transform; no_claim=real elapsed time (a scripted clock stands in, so no test waits 15 s)
test('stops at the deadline of an injected clock and names the deadline bound', async () => {
  // Arrange
  const { environment } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/main.tsx',
      imports: ['/@fs/repo/lib/a.js'],
    },
    '/@fs/repo/lib/a.js': { file: '/repo/lib/a.js' },
  })
  // The clock reads 0 at the start and before the entry, then 20 s before the second module.
  const clockReadings = [0, 0, 20_000]
  let readCount = 0
  // Act
  const result = await walkViteLibraryModules(
    environment,
    { entries: ['/src/main.tsx'], libraryFolder: '/repo/lib' },
    {
      deadlineMs: 15_000,
      now: () => clockReadings[Math.min(readCount++, 2)]!,
    },
  )
  // Assert
  assert.deepEqual(result, {
    modules: [],
    optimizedLibrary: false,
    bound: 'deadline',
  })
})

// protects=a sibling folder that shares the library's name prefix is not part of the library; fails_when=the folder test is a string prefix; no_claim=real Vite
test('does not list a module of a sibling folder that shares the library folder name prefix', async () => {
  // Arrange
  const { environment } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/main.tsx',
      imports: ['/@fs/repo/lib-other/x.js', '/@fs/repo/lib/y.js'],
    },
    '/@fs/repo/lib-other/x.js': { file: '/repo/lib-other/x.js' },
    '/@fs/repo/lib/y.js': { file: '/repo/lib/y.js' },
  })
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  })
  // Assert
  assert.deepEqual(result.modules, ['/@fs/repo/lib/y.js'])
})

// protects=a module reached through a symlink into the library is matched by its real path; fails_when=the file is compared without realpath; no_claim=Windows junctions (a POSIX symlink is used)
test('lists a module whose file is a symlink into the library folder', async (context) => {
  // Arrange
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-walk-')))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'lib'), { recursive: true })
  await mkdir(join(root, 'app/node_modules'), { recursive: true })
  await writeFile(join(root, 'lib/index.js'), 'export {}')
  await symlink(join(root, 'lib'), join(root, 'app/node_modules/lib'))
  const { environment } = fakeEnvironment({
    '/src/main.tsx': {
      file: join(root, 'app/main.tsx'),
      imports: ['/node_modules/lib/index.js'],
    },
    '/node_modules/lib/index.js': {
      file: join(root, 'app/node_modules/lib/index.js'),
    },
  })
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: join(root, 'lib'),
  })
  // Assert
  assert.deepEqual(result.modules, ['/node_modules/lib/index.js'])
})

// protects=a module whose transform throws is skipped with its imports and the walk continues; fails_when=one failing transform ends or fails the whole walk; no_claim=real Vite errors
test('skips a module whose transform throws and keeps walking the others', async () => {
  // Arrange
  const { environment } = fakeEnvironment({
    '/src/main.tsx': {
      file: '/repo/app/main.tsx',
      imports: ['/@fs/repo/lib/broken.js', '/@fs/repo/lib/ok.js'],
    },
    '/@fs/repo/lib/broken.js': {
      file: '/repo/lib/broken.js',
      throws: true,
      imports: ['/@fs/repo/lib/hidden.js'],
    },
    '/@fs/repo/lib/hidden.js': { file: '/repo/lib/hidden.js' },
    '/@fs/repo/lib/ok.js': { file: '/repo/lib/ok.js' },
  })
  // Act
  const result = await walkViteLibraryModules(environment, {
    entries: ['/src/main.tsx'],
    libraryFolder: '/repo/lib',
  })
  // Assert
  assert.deepEqual(result.modules, ['/@fs/repo/lib/ok.js'])
})
