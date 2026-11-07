import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createLibraryRedirectPlugin,
  readLibraryBlockers,
  type LibraryRedirectOptions,
} from '../viteLibraryRedirect'

import {
  CASE_IMPORTS,
  CASE_PACKAGE_NAME,
  CASE_PEERS,
  LIBRARY_RESOLUTION_CASES,
} from './utils/libraryResolutionCases'

const PACKED = '/private/run/node_modules/@acme/widgets'
const ANCHOR = '/private/run/codebook-anchor.js'
const EXAMPLE = '/repo/examples/app'
const LIBRARY = '/repo/packages/widgets'
const MODULE = `${PACKED}/dist/redux-toolkit.modern.mjs`

/** A plugin over fictional paths whose file reads come from `files`. */
function pluginOver(
  files: Record<string, string> = {},
  overrides: Partial<LibraryRedirectOptions> = {},
) {
  return createLibraryRedirectPlugin({
    packageName: CASE_PACKAGE_NAME,
    packedRoot: PACKED,
    anchorFile: ANCHOR,
    exampleRoot: EXAMPLE,
    libraryRoot: LIBRARY,
    peers: CASE_PEERS,
    imports: CASE_IMPORTS,
    readText: (path) => files[path],
    ...overrides,
  })
}

/** Runs `resolveId` with a context that answers which importer the redirect resolved from; `null` means the plugin left the import alone. */
async function resolvedFrom(
  plugin: ReturnType<typeof pluginOver>,
  source: string,
  importer: string | undefined,
): Promise<{ target: string; via: string } | null> {
  const context = {
    resolve: async (target: string, via: string) => ({ target, via }),
  }
  const result: unknown = await plugin.resolveId.call(
    context,
    source,
    importer,
    {},
  )
  return result as { target: string; via: string } | null
}

// protects=the Vite plugin routes every row of the shared case table (package, subpath, peer, dependency, # import, outside import, relative, absolute) as the Node hook does; fails_when=a row resolves from the wrong world or an untouched import is redirected; no_claim=Vite's own resolution through the anchor (the real Vite run is the native check)
test('routes every case of the shared resolution table to the world the Node hook uses', async () => {
  // Arrange
  const plugin = pluginOver()
  const worldOfVia: Record<string, string> = {
    [ANCHOR]: 'library',
    [`${EXAMPLE}/package.json`]: 'peer',
    [`${LIBRARY}/package.json`]: 'dependency',
  }
  // Act
  const actual: string[] = []
  for (const testCase of LIBRARY_RESOLUTION_CASES) {
    const importer = testCase.importerInsidePacked
      ? `${PACKED}/dist/index.mjs`
      : `${EXAMPLE}/src/main.tsx`
    const result = await resolvedFrom(
      plugin,
      testCase.specifier.replace('{packedRoot}', PACKED),
      importer,
    )
    actual.push(
      `${testCase.name}: ${result ? worldOfVia[result.via] : 'untouched'}`,
    )
  }
  // Assert
  assert.deepEqual(
    actual,
    LIBRARY_RESOLUTION_CASES.map(
      (testCase) => `${testCase.name}: ${testCase.expected}`,
    ),
  )
})

// protects=a # import to another package is resolved as that package (the target text, not the # alias); fails_when=the # specifier itself is handed to Vite from the library world; no_claim=none beyond protects
test('resolves a # import of a peer as the peer package from the Example', async () => {
  // Arrange
  const plugin = pluginOver()
  // Act
  const result = await resolvedFrom(plugin, '#peer', `${PACKED}/dist/a.mjs`)
  // Assert
  assert.deepEqual(result, { target: 'react', via: `${EXAMPLE}/package.json` })
})

// protects=an import without an importer (an entry) is left alone and a packed importer is recognised through a query suffix; fails_when=an entry is redirected or a ?v= suffix hides a packed importer; no_claim=none beyond protects
test('leaves an entry without importer alone and sees a packed importer through its query', async () => {
  // Arrange
  const plugin = pluginOver()
  // Act
  const entry = await resolvedFrom(plugin, '@acme/widgets', undefined)
  const queried = await resolvedFrom(
    plugin,
    'lodash-es',
    `${PACKED}/dist/a.mjs?v=abc`,
  )
  // Assert
  assert.equal(entry, null)
  assert.deepEqual(queried, {
    target: 'lodash-es',
    via: `${LIBRARY}/package.json`,
  })
})

// protects=creating the plugin reads nothing, since the packed folder may still be empty when the server is created (E2(c)); fails_when=the factory reads a file at creation; no_claim=the real optimizer behavior
test('reads no file when the plugin is created', () => {
  // Arrange
  const reads: string[] = []
  // Act
  pluginOver(
    {},
    {
      readText: (path) => {
        reads.push(path)
        return undefined
      },
    },
  )
  // Assert
  assert.deepEqual(reads, [])
})

// protects=a packed module's map names the checked-out file when its sourcesContent equals that file, and the sourceMappingURL comment is gone; fails_when=sources keep the packed src path, or the comment stays so the browser fetches a second map; no_claim=native breakpoint binding (E2 proved it in the Space)
test('rewrites a byte-equal map source to the checked-out file and strips the map comment', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]:
      'export const a = 1\n//# sourceMappingURL=redux-toolkit.modern.mjs.map\n',
    [`${MODULE}.map`]: JSON.stringify({
      version: 3,
      sourceRoot: '.',
      sources: ['../src/createSlice.ts'],
      sourcesContent: ['const slice = 1\n'],
      mappings: 'AAAA',
    }),
    [`${LIBRARY}/src/createSlice.ts`]: 'const slice = 1\n',
  })
  // Act
  const loaded = plugin.load(`${MODULE}?t=1`)
  // Assert
  assert.equal(loaded?.code, 'export const a = 1\n')
  assert.deepEqual(loaded?.map.sources, [`${LIBRARY}/src/createSlice.ts`])
  assert.equal('sourceRoot' in (loaded?.map ?? {}), false)
  assert.equal(loaded?.map.mappings, 'AAAA')
})

// protects=a map entry whose embedded text differs from the checked-out file (or has none, or lies outside the packed folder) keeps its original path; fails_when=a differing source is shown from the checked-out file, so the editor shows text that did not run; no_claim=that the stop on such a file is refused (the seal tests cover that)
test('keeps the packed path of a map source whose text differs, is missing or lies outside the packed folder', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: 'x\n',
    [`${MODULE}.map`]: JSON.stringify({
      version: 3,
      sources: [
        '../src/a.ts',
        '../src/b.ts',
        '../src/c.ts',
        '../../outside.ts',
        'webpack://x/d.ts',
      ],
      sourcesContent: ['post-transform text', null, 'c\n', 'o', 'd'],
      mappings: '',
    }),
    [`${LIBRARY}/src/a.ts`]: 'checked-out text',
    [`${LIBRARY}/src/b.ts`]: 'b',
    [`${LIBRARY}/src/c.ts`]: 'c\n',
  })
  // Act
  const loaded = plugin.load(MODULE)
  // Assert
  assert.deepEqual(loaded?.map.sources, [
    '../src/a.ts',
    '../src/b.ts',
    `${LIBRARY}/src/c.ts`,
    '../../outside.ts',
    'webpack://x/d.ts',
  ])
})

// protects=load answers only for js/mjs/cjs files of the packed folder that have a readable sibling map; fails_when=a file outside the packed folder, a non-script file, a module without map or a corrupt map is taken over; no_claim=none beyond protects
test('returns nothing for files it does not own or maps it cannot read', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: 'x',
    [`${MODULE}.map`]: '{not json',
    [`${PACKED}/dist/nomap.mjs`]: 'x',
    [`${PACKED}/styles.css`]: 'x',
    [`${PACKED}/styles.css.map`]: '{}',
    [`${EXAMPLE}/src/main.js`]: 'x',
    [`${EXAMPLE}/src/main.js.map`]: '{}',
  })
  // Act
  const results = [
    MODULE,
    `${PACKED}/dist/nomap.mjs`,
    `${PACKED}/styles.css`,
    `${EXAMPLE}/src/main.js`,
    '\0virtual',
  ].map((id) => plugin.load(id))
  // Assert
  assert.deepEqual(results, [null, null, null, null, null])
})

// protects=Vite's non-JavaScript query loads (?raw, ?worker, ?url, ?inline) of a packed file stay with Vite while cache markers (?v, ?t, ?import) are still rewritten; fails_when=a ?raw or ?worker request gets JavaScript back, or a ?v= request loses the rewrite; no_claim=Vite's own handling of those queries
test('leaves ?raw and ?worker loads of a packed module to Vite and still rewrites ?v= and ?import', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: 'export const a = 1\n',
    [`${MODULE}.map`]: JSON.stringify({
      version: 3,
      sources: ['../src/createSlice.ts'],
      sourcesContent: ['const slice = 1\n'],
      mappings: 'AAAA',
    }),
    [`${LIBRARY}/src/createSlice.ts`]: 'const slice = 1\n',
  })
  // Act
  const results = [
    `${MODULE}?raw`,
    `${MODULE}?worker`,
    `${MODULE}?url`,
    `${MODULE}?inline`,
    `${MODULE}?v=abc`,
    `${MODULE}?import&t=1`,
  ].map((id) => plugin.load(id)?.code ?? null)
  // Assert
  assert.deepEqual(results, [
    null,
    null,
    null,
    null,
    'export const a = 1\n',
    'export const a = 1\n',
  ])
})

// protects=an alias (string or regular expression) that rewrites the package or a subpath is reported, and an unrelated alias is not; fails_when=a package alias slips through to the build, or an unrelated alias blocks the run; no_claim=a regular expression that matches only deeper subpaths than the samples
test('reports the aliases that match the package or a subpath of it', () => {
  // Arrange
  const config = {
    resolve: {
      alias: [
        { find: '@acme/widgets', replacement: '/x' },
        { find: '@acme/widgets/sub', replacement: '/y' },
        { find: /^@acme\/widgets(\/|$)/g, replacement: '/z' },
        { find: '@acme', replacement: '/scope' },
        { find: 'other', replacement: '/o' },
        { find: /^other/, replacement: '/o' },
        { find: '@acme/widgets-other', replacement: '/w' },
      ],
    },
  }
  // Act
  const blockers = readLibraryBlockers(config, '@acme/widgets')
  // Assert
  assert.deepEqual(blockers, {
    aliased: [
      '@acme/widgets',
      '@acme/widgets/sub',
      '/^@acme\\/widgets(\\/|$)/g',
      '@acme',
    ],
    optimizeInclude: [],
    deduped: [],
  })
})

// protects=the object form of alias is read too; fails_when=only the array form is inspected; no_claim=none beyond protects
test('reports an object-form alias of the package', () => {
  // Arrange
  const config = { resolve: { alias: { '@acme/widgets': '/x', other: '/o' } } }
  // Act
  const blockers = readLibraryBlockers(config, '@acme/widgets')
  // Assert
  assert.deepEqual(blockers.aliased, ['@acme/widgets'])
})

// protects=optimizeDeps.include entries naming the package, a subpath or a nested path ending in either are reported; fails_when=a pre-bundled copy of the package is not seen before the build; no_claim=entries of other packages that merely contain the name
test('reports optimizeDeps.include entries that are the package, a subpath or a nested path to them', () => {
  // Arrange
  const config = {
    optimizeDeps: {
      include: [
        '@acme/widgets',
        '@acme/widgets/sub',
        'host > @acme/widgets',
        'host > @acme/widgets/sub',
        '@acme/widgets-other',
        'react',
      ],
    },
    environments: {
      client: { optimizeDeps: { include: ['@acme/widgets/extra'] } },
    },
  }
  // Act
  const blockers = readLibraryBlockers(config, '@acme/widgets')
  // Assert
  assert.deepEqual(blockers, {
    aliased: [],
    optimizeInclude: [
      '@acme/widgets',
      '@acme/widgets/sub',
      'host > @acme/widgets',
      'host > @acme/widgets/sub',
      '@acme/widgets/extra',
    ],
    deduped: [],
  })
})

// protects=resolve.dedupe entries naming the package or a subpath, at the top level or for the client environment, are reported and other packages are not; fails_when=a dedupe of the package (which makes Vite resolve the installed copy from the project root) is missed, or a dedupe of react refuses the run; no_claim=Vite's own resolution
test('reports resolve.dedupe entries of the package and ignores other packages', () => {
  // Arrange
  const config = {
    resolve: { dedupe: ['react', '@acme/widgets', '@acme/widgets/sub'] },
    environments: { client: { resolve: { dedupe: ['@acme/widgets/extra'] } } },
  }
  const unrelated = { resolve: { dedupe: ['react', '@acme/widgets-other'] } }
  // Act
  const blockers = readLibraryBlockers(config, '@acme/widgets')
  const unrelatedBlockers = readLibraryBlockers(unrelated, '@acme/widgets')
  // Assert
  assert.deepEqual(blockers.deduped, [
    '@acme/widgets',
    '@acme/widgets/sub',
    '@acme/widgets/extra',
  ])
  assert.deepEqual(unrelatedBlockers.deduped, [])
})

// protects=a config with no alias and no include has no blockers; fails_when=an empty or odd config reports a blocker or throws; no_claim=none beyond protects
test('reports no blockers for a config without alias or include', () => {
  // Arrange
  const configs: unknown[] = [
    {},
    { resolve: {}, optimizeDeps: {} },
    { resolve: { alias: 7 } },
  ]
  // Act
  const results = configs.map((config) =>
    readLibraryBlockers(config, '@acme/widgets'),
  )
  // Assert
  assert.deepEqual(results, [
    { aliased: [], optimizeInclude: [], deduped: [] },
    { aliased: [], optimizeInclude: [], deduped: [] },
    { aliased: [], optimizeInclude: [], deduped: [] },
  ])
})

// protects=`#` imports of the packed copy follow Node's pattern rule: an exact key first, else the single-star key with the longest prefix and a matching suffix, a key with two stars never matches, and an import no key matches is left alone; fails_when=a shorter prefix wins, a suffix is ignored, a two-star key matches or an unmatched `#` import is redirected; no_claim=Vite's own resolution of the target (the context stands in for `this.resolve`)
test('a # import of the packed copy takes the exact key, else the longest single-star pattern with its suffix', async () => {
  // Arrange
  const plugin = pluginOver(
    {},
    {
      imports: {
        '#ui/*': 'lodash-es/*',
        '#ui/button/*': 'react/*',
        '#ui/exact': 'react',
        '#data/*.js': 'lodash-es/fp/*',
        '#two/*/stars/*': 'react',
      },
    },
  )
  const importer = `${PACKED}/dist/index.mjs`
  // Act
  const longest = await resolvedFrom(plugin, '#ui/button/primary', importer)
  const shorter = await resolvedFrom(plugin, '#ui/card', importer)
  const exact = await resolvedFrom(plugin, '#ui/exact', importer)
  const suffix = await resolvedFrom(plugin, '#data/map.js', importer)
  const wrongSuffix = await resolvedFrom(plugin, '#data/map.ts', importer)
  const twoStars = await resolvedFrom(plugin, '#two/a/stars/b', importer)
  // Assert
  assert.deepEqual(longest, {
    target: 'react/primary',
    via: `${EXAMPLE}/package.json`,
  })
  assert.deepEqual(shorter, {
    target: 'lodash-es/card',
    via: `${LIBRARY}/package.json`,
  })
  assert.deepEqual(exact, { target: 'react', via: `${EXAMPLE}/package.json` })
  assert.deepEqual(suffix, {
    target: 'lodash-es/fp/map',
    via: `${LIBRARY}/package.json`,
  })
  assert.equal(wrongSuffix, null)
  assert.equal(twoStars, null)
})

/** A resolved Vite config whose client environment carries `conditions`. */
function configWith(conditions: string[], isProduction: boolean) {
  return { isProduction, environments: { client: { resolve: { conditions } } } }
}

const CONDITIONAL_IMPORTS = {
  '#dep': {
    development: 'react',
    production: 'lodash-es',
    custom: 'both',
    default: 'default-pkg',
  },
}

// protects=a conditional # import is rewritten with the conditions of Vite's client environment, development by default; fails_when=the plugin keeps a fixed condition list and picks the default target Vite would not choose; no_claim=Vite's own condition handling (the config object stands in for the resolved config)
test('picks the development target of a conditional # import when Vite resolves a development client', async () => {
  // Arrange
  const plugin = pluginOver({}, { imports: CONDITIONAL_IMPORTS })
  plugin.configResolved(
    configWith(['module', 'browser', 'development|production'], false),
  )
  // Act
  const result = await resolvedFrom(plugin, '#dep', `${PACKED}/dist/a.mjs`)
  // Assert
  assert.deepEqual(result, {
    target: 'react',
    via: `${EXAMPLE}/package.json`,
  })
})

// protects=a production Vite config picks the production target of a conditional # import; fails_when=the development placeholder is not mapped by isProduction; no_claim=none beyond protects
test('picks the production target of a conditional # import when Vite resolves a production client', async () => {
  // Arrange
  const plugin = pluginOver({}, { imports: CONDITIONAL_IMPORTS })
  plugin.configResolved(
    configWith(['module', 'browser', 'development|production'], true),
  )
  // Act
  const result = await resolvedFrom(plugin, '#dep', `${PACKED}/dist/a.mjs`)
  // Assert
  assert.deepEqual(result, {
    target: 'lodash-es',
    via: `${LIBRARY}/package.json`,
  })
})

// protects=a condition the app adds to resolve.conditions selects its # import target; fails_when=app conditions are ignored; no_claim=none beyond protects
test('honors a custom condition the app configures for a conditional # import', async () => {
  // Arrange
  const plugin = pluginOver(
    {},
    { imports: { '#dep': { custom: 'react', default: 'lodash-es' } } },
  )
  plugin.configResolved(configWith(['module', 'browser', 'custom'], false))
  // Act
  const result = await resolvedFrom(plugin, '#dep', `${PACKED}/dist/a.mjs`)
  // Assert
  assert.deepEqual(result, {
    target: 'react',
    via: `${EXAMPLE}/package.json`,
  })
})

// protects=the pre-Vite-6 config shape (resolve.conditions at the top level) is read; fails_when=only environments.client is consulted; no_claim=none beyond protects
test('reads resolve.conditions of a config without environments', async () => {
  // Arrange
  const plugin = pluginOver(
    {},
    { imports: { '#dep': { custom: 'react', default: 'lodash-es' } } },
  )
  plugin.configResolved({
    isProduction: false,
    resolve: { conditions: ['custom'] },
  })
  // Act
  const result = await resolvedFrom(plugin, '#dep', `${PACKED}/dist/a.mjs`)
  // Assert
  assert.deepEqual(result, {
    target: 'react',
    via: `${EXAMPLE}/package.json`,
  })
})

// protects=before configResolved the plugin assumes a development client (Vite's default); fails_when=the fallback lacks development; no_claim=none beyond protects
test('assumes a development client until Vite hands over its config', async () => {
  // Arrange
  const plugin = pluginOver({}, { imports: CONDITIONAL_IMPORTS })
  // Act
  const result = await resolvedFrom(plugin, '#dep', `${PACKED}/dist/a.mjs`)
  // Assert
  assert.deepEqual(result, {
    target: 'react',
    via: `${EXAMPLE}/package.json`,
  })
})

// protects=among pattern keys with the same prefix the longer whole key wins whatever the JSON order, as in Node; fails_when=the first key in JSON order wins; no_claim=Vite's own resolution of the target
test('a # import takes the longer pattern key on a prefix tie in either key order', async () => {
  // Arrange
  const genericFirst = pluginOver(
    {},
    { imports: { '#a/*': 'lodash-es/*', '#a/*.js': 'react/*' } },
  )
  const specificFirst = pluginOver(
    {},
    { imports: { '#a/*.js': 'react/*', '#a/*': 'lodash-es/*' } },
  )
  const importer = `${PACKED}/dist/index.mjs`
  // Act
  const first = await resolvedFrom(genericFirst, '#a/x.js', importer)
  const second = await resolvedFrom(specificFirst, '#a/x.js', importer)
  // Assert
  const expected = { target: 'react/x', via: `${EXAMPLE}/package.json` }
  assert.deepEqual(first, expected)
  assert.deepEqual(second, expected)
})

/** A source map of one packed `src/a.ts` entry whose text equals the checked-out file. */
const MATCHING_MAP = JSON.stringify({
  version: 3,
  sources: ['../src/a.ts'],
  sourcesContent: ['const a = 1\n'],
  mappings: 'AAAA',
})

// protects=a built module with an inline base64 map still gets its sources rewritten to the checked-out file and loses the data comment; fails_when=the plugin reads only the sibling .map, so the inline map is ignored (null) or the data URL stays in the code; no_claim=Vite's own handling of the comment
test('rewrites the sources of an inline base64 source map', () => {
  // Arrange
  const encoded = Buffer.from(MATCHING_MAP).toString('base64')
  const plugin = pluginOver({
    [MODULE]: `export const a = 1\n//# sourceMappingURL=data:application/json;base64,${encoded}\n`,
    [`${LIBRARY}/src/a.ts`]: 'const a = 1\n',
  })
  // Act
  const loaded = plugin.load(MODULE)
  // Assert
  assert.equal(loaded?.code, 'export const a = 1\n')
  assert.deepEqual(loaded?.map.sources, [`${LIBRARY}/src/a.ts`])
})

// protects=a percent-encoded inline map (charset=utf-8, with the older //@ comment) is decoded and rewritten; fails_when=URI-encoded JSON is not decoded and the load returns null; no_claim=none beyond protects
test('rewrites the sources of an inline percent-encoded source map', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: `export const a = 1\n//@ sourceMappingURL=data:application/json;charset=utf-8,${encodeURIComponent(MATCHING_MAP)}`,
    [`${LIBRARY}/src/a.ts`]: 'const a = 1\n',
  })
  // Act
  const loaded = plugin.load(MODULE)
  // Assert
  assert.deepEqual(loaded?.map.sources, [`${LIBRARY}/src/a.ts`])
})

// protects=a comment naming another file inside the packed folder (../maps/a.map) is the map that is read, even when a sibling .map exists with other content; fails_when=the sibling .map is read instead of the named file; no_claim=none beyond protects
test('reads the map file a sourceMappingURL comment names inside the packed folder', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: 'export const a = 1\n//# sourceMappingURL=../maps/a.map\n',
    [`${PACKED}/maps/a.map`]: JSON.stringify({
      version: 3,
      sources: ['../src/a.ts'],
      sourcesContent: ['const a = 1\n'],
      mappings: 'AAAA',
    }),
    [`${MODULE}.map`]: '{"version":3,"sources":["wrong.ts"],"mappings":""}',
    [`${LIBRARY}/src/a.ts`]: 'const a = 1\n',
  })
  // Act
  const loaded = plugin.load(MODULE)
  // Assert
  assert.deepEqual(loaded?.map.sources, [`${LIBRARY}/src/a.ts`])
})

// protects=a comment that points outside the packed folder, or at an http(s) URL, is not read and the module is left to Vite; fails_when=the plugin reads a file outside the packed folder or takes over a remote map; no_claim=that Vite then fetches the remote map
test('leaves a module whose sourceMappingURL points outside the packed folder or at https to Vite', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: 'x\n//# sourceMappingURL=../../../outside.map\n',
    [`${PACKED}/dist/remote.mjs`]:
      'x\n//# sourceMappingURL=https://cdn.example/a.map\n',
    [`${PACKED}/dist/remote.mjs.map`]: MATCHING_MAP,
    '/private/run/node_modules/outside.map': MATCHING_MAP,
  })
  // Act
  const results = [MODULE, `${PACKED}/dist/remote.mjs`].map((id) =>
    plugin.load(id),
  )
  // Assert
  assert.deepEqual(results, [null, null])
})

// protects=with a map sourceRoot, an entry whose text differs keeps the place it resolved to (the absolute packed path) after sourceRoot is dropped, while a byte-equal entry becomes the checked-out file; fails_when=the unmatched entry stays relative and resolves next to the module; no_claim=the seal's lookup (read in sealViteLibraryStop.ts, not run here)
test('keeps an unmatched map source at its sourceRoot-resolved packed path', () => {
  // Arrange
  const plugin = pluginOver({
    [MODULE]: 'x\n',
    [`${MODULE}.map`]: JSON.stringify({
      version: 3,
      sourceRoot: '../src',
      sources: ['a.ts', 'b.ts', 'webpack://x/c.ts'],
      sourcesContent: ['const a = 1\n', 'packed b', 'c'],
      mappings: '',
    }),
    [`${LIBRARY}/src/a.ts`]: 'const a = 1\n',
    [`${LIBRARY}/src/b.ts`]: 'checked-out b',
  })
  // Act
  const loaded = plugin.load(MODULE)
  // Assert
  assert.deepEqual(loaded?.map.sources, [
    `${LIBRARY}/src/a.ts`,
    `${PACKED}/src/b.ts`,
    'webpack://x/c.ts',
  ])
  assert.equal('sourceRoot' in (loaded?.map ?? {}), false)
})
