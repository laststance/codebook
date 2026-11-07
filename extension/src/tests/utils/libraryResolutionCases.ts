import type { LibraryImportRoute } from '../../viteLibraryRedirect'

/** One import of the shared resolution case table and how the library route must resolve it. */
export type LibraryResolutionCase = {
  /** What the case checks, in words. */
  name: string
  /** The specifier; `{packedRoot}` stands for the packed folder's absolute path. */
  specifier: string
  /** Whether the importing file lies inside the packed folder (otherwise it is a file of the Example). */
  importerInsidePacked: boolean
  /** The world the import resolves from: the packed library, the Example's peer, the library's own dependency, or left alone. */
  expected: LibraryImportRoute
}

/** The package name every case table fixture uses. */
export const CASE_PACKAGE_NAME = '@acme/widgets'

/** The `peerDependencies` names of the fixture's packed `package.json`; `both` is also one of its dependencies and must count as a peer. */
export const CASE_PEERS: readonly string[] = ['react', 'both']

/** The `imports` field of the fixture's packed `package.json`. */
export const CASE_IMPORTS: Readonly<Record<string, unknown>> = {
  '#self': '@acme/widgets/sub',
  '#peer': 'react',
  '#dep': 'lodash-es',
  '#local': './local.mjs',
  '#conditional': { import: 'react', default: './local.mjs' },
}

/**
 * The resolution policy of the library route as cases (decision D14): the Vite plugin and the Node hook must agree on every row.
 * Run against both by `viteLibraryRedirect.test.ts` and `libraryHookResolutionCases.test.ts`.
 */
export const LIBRARY_RESOLUTION_CASES: readonly LibraryResolutionCase[] = [
  {
    name: 'package from the Example',
    specifier: '@acme/widgets',
    importerInsidePacked: false,
    expected: 'library',
  },
  {
    name: 'subpath from the Example',
    specifier: '@acme/widgets/sub',
    importerInsidePacked: false,
    expected: 'library',
  },
  {
    name: 'package from inside itself',
    specifier: '@acme/widgets',
    importerInsidePacked: true,
    expected: 'library',
  },
  {
    name: 'subpath from inside itself',
    specifier: '@acme/widgets/sub',
    importerInsidePacked: true,
    expected: 'library',
  },
  {
    name: 'peer',
    specifier: 'react',
    importerInsidePacked: true,
    expected: 'peer',
  },
  {
    name: 'peer subpath',
    specifier: 'react/jsx-runtime',
    importerInsidePacked: true,
    expected: 'peer',
  },
  {
    name: 'name that is both peer and dependency',
    specifier: 'both',
    importerInsidePacked: true,
    expected: 'peer',
  },
  {
    name: 'other dependency',
    specifier: 'lodash-es',
    importerInsidePacked: true,
    expected: 'dependency',
  },
  {
    name: '# import to the library',
    specifier: '#self',
    importerInsidePacked: true,
    expected: 'library',
  },
  {
    name: '# import to a peer',
    specifier: '#peer',
    importerInsidePacked: true,
    expected: 'peer',
  },
  {
    name: '# import to a dependency',
    specifier: '#dep',
    importerInsidePacked: true,
    expected: 'dependency',
  },
  {
    name: '# import to a relative file',
    specifier: '#local',
    importerInsidePacked: true,
    expected: 'untouched',
  },
  {
    name: '# import with a condition',
    specifier: '#conditional',
    importerInsidePacked: true,
    expected: 'peer',
  },
  {
    name: 'peer name imported from the Example',
    specifier: 'react',
    importerInsidePacked: false,
    expected: 'untouched',
  },
  {
    name: 'dependency name imported from the Example',
    specifier: 'lodash-es',
    importerInsidePacked: false,
    expected: 'untouched',
  },
  {
    name: 'package name with the same prefix',
    specifier: '@acme/widgets-other',
    importerInsidePacked: false,
    expected: 'untouched',
  },
  {
    name: 'relative from the Example',
    specifier: './rel.mjs',
    importerInsidePacked: false,
    expected: 'untouched',
  },
  {
    name: 'relative from inside',
    specifier: './local.mjs',
    importerInsidePacked: true,
    expected: 'untouched',
  },
  {
    name: 'absolute from inside',
    specifier: '{packedRoot}/local.mjs',
    importerInsidePacked: true,
    expected: 'untouched',
  },
  {
    name: 'absolute from the Example',
    specifier: '{packedRoot}/local.mjs',
    importerInsidePacked: false,
    expected: 'untouched',
  },
  {
    name: 'node: built-in from inside',
    specifier: 'node:path',
    importerInsidePacked: true,
    expected: 'untouched',
  },
  {
    name: 'bare built-in from inside',
    specifier: 'path',
    importerInsidePacked: true,
    expected: 'untouched',
  },
]
