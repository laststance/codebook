import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

import { sha256 } from '../../runtimeSupport/utils/sha256'

/** A tiny stand-in page (never application code): lines 1–4 are browser code, line 5 is a data function only the server runs. */
export const PAGE_SOURCE =
  'export default function Home() {\n' +
  "  const label = 'Show more'\n" +
  '  return label\n' +
  '}\n' +
  'export const getStaticProps = () => ({ props: {} })\n'
/** A tiny stand-in `_app`. */
export const APP_SOURCE =
  'export default function App({ Component }) {\n' +
  '  return Component\n' +
  '}\n'
/** A tiny stand-in component that only a lazily loaded chunk carries. */
export const LAZY_SOURCE = 'export const LazyPanel = () => null\n'

const MEASURED_BUILD_MANIFEST = join(
  __dirname,
  '../../../src/tests/fixtures/next-pages/nextjs/build-manifest.json',
)

/**
 * Builds the text of one webpack eval module as Next 16's `eval-source-map` emits it: generated code, an inline map whose `sources` names the absolute original and whose `sourcesContent` is the whole file, and the module's `sourceURL`.
 * @param workspace - The workspace whose absolute path the map names.
 * @param path - The original's workspace-relative path.
 * @param source - The original's text.
 * @param layer - The webpack layer: `pages-dir-browser` (browser) or `pages-dir-node` (server compile).
 * @param mappedLines - How many original lines, from line 1, the map maps (one generated line each).
 * @returns The module text.
 * @example pagesEvalModule('/repo', 'src/pages/index.tsx', PAGE_SOURCE, 'pages-dir-browser', 4)
 */
export function pagesEvalModule(
  workspace: string,
  path: string,
  source: string,
  layer: 'pages-dir-browser' | 'pages-dir-node',
  mappedLines: number,
): string {
  const code = Array.from(
    { length: mappedLines },
    (_, index) => `work${index + 1}();`,
  ).join('\n')
  const map = {
    version: 3,
    file: '',
    sources: [join(workspace, path)],
    sourcesContent: [source],
    names: [],
    // One segment per generated line, each one original line further.
    mappings: ['AAAA', ...Array(mappedLines - 1).fill('AACA')].join(';'),
    ignoreList: [],
    sourceRoot: '',
  }
  return `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=webpack-internal:///(${layer})/./${path}\n`
}

/**
 * Wraps eval modules in a browser chunk of Next 16's form (`eval(__webpack_require__.ts("…"))`).
 * @param name - The chunk's name, e.g. `pages/index`.
 * @param modules - Module texts by webpack module id.
 * @returns The chunk text.
 * @example browserChunk('pages/index', { './src/pages/index.tsx': moduleText })
 */
export function browserChunk(
  name: string,
  modules: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(modules).map(
    ([id, text]) =>
      `/***/ ${JSON.stringify(id)}:\n/***/ ((module, __webpack_exports__, __webpack_require__) => {\n"use strict";\neval(__webpack_require__.ts(${JSON.stringify(text)}));\n/***/ })`,
  )
  return `/* eval-source-map stand-in */\n(self["webpackChunk_N_E"] = self["webpackChunk_N_E"] || []).push([[${JSON.stringify(name)}],{\n${entries.join(',\n')}\n}]);\n`
}

/**
 * Wraps eval modules in a server compile of Next 16's form (plain `eval("…")`).
 * @param modules - Module texts by webpack module id.
 * @returns The chunk text.
 * @example serverChunk({ './src/pages/index.tsx': moduleText })
 */
export function serverChunk(modules: Readonly<Record<string, string>>): string {
  const entries = Object.entries(modules).map(
    ([id, text]) =>
      `${JSON.stringify(id)}:\n((module, __webpack_exports__, __webpack_require__) => {\neval(${JSON.stringify(text)});\n})`,
  )
  return `"use strict";\n(() => {\nvar exports = {};\nexports.modules = {\n${entries.join(',\n')}\n};\n})();\n`
}

/**
 * Creates a temporary Pages project with a `.next/dev` build in Next 16's measured layout: the P02 build manifest (`/` loads `webpack.js`, `main.js`, `pages/index.js`; `/_app` loads `pages/_app.js`), the page module in `static/chunks/pages/index.js` and `_app` in `static/chunks/pages/_app.js`. `webpack.js` and `main.js` are folders, so any read of them fails.
 * @param context - The test, which removes the project afterwards.
 * @returns The workspace, helpers to write build files and the selected stops of the stand-in sources.
 * @example const build = await nextPagesBuild(context)
 */
export async function nextPagesBuild(context: TestContext) {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-pages-build-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), text)
  }
  await write('src/pages/index.tsx', PAGE_SOURCE)
  await write('src/pages/_app.tsx', APP_SOURCE)
  await write('src/components/LazyPanel.tsx', LAZY_SOURCE)
  await mkdir(join(workspace, '.next/dev/static/chunks/webpack.js'), {
    recursive: true,
  })
  await mkdir(join(workspace, '.next/dev/static/chunks/main.js'))
  await copyFile(
    MEASURED_BUILD_MANIFEST,
    join(workspace, '.next/dev/build-manifest.json'),
  )
  const pageModule = pagesEvalModule(
    workspace,
    'src/pages/index.tsx',
    PAGE_SOURCE,
    'pages-dir-browser',
    4,
  )
  const appModule = pagesEvalModule(
    workspace,
    'src/pages/_app.tsx',
    APP_SOURCE,
    'pages-dir-browser',
    3,
  )
  const pageChunk = browserChunk('pages/index', {
    './src/pages/index.tsx': pageModule,
  })
  await write('.next/dev/static/chunks/pages/index.js', pageChunk)
  await write(
    '.next/dev/static/chunks/pages/_app.js',
    browserChunk('pages/_app', { './src/pages/_app.tsx': appModule }),
  )
  return {
    workspace,
    write,
    pageModule,
    pageChunk,
    page: {
      path: 'src/pages/index.tsx',
      hash: sha256(PAGE_SOURCE),
      line: 2,
      column: 3,
    },
    app: {
      path: 'src/pages/_app.tsx',
      hash: sha256(APP_SOURCE),
      line: 2,
      column: 3,
    },
    lazy: {
      path: 'src/components/LazyPanel.tsx',
      hash: sha256(LAZY_SOURCE),
      line: 1,
      column: 1,
    },
  }
}
