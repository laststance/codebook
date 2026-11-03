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

/** The Pages manifest of the stand-in project: Next's own entries and the page `/`. */
export const PAGES_MANIFEST = {
  '/_app': 'pages/_app.js',
  '/_error': 'pages/_error.js',
  '/_document': 'pages/_document.js',
  '/': 'pages/index.js',
}

/** Base64 VLQ digits; a small non-negative value v is the single digit at index 2v. */
const VLQ_DIGITS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Builds the text of one webpack eval module as Next 16's `eval-source-map` emits it: generated code, an inline map whose `sources` names the absolute original and whose `sourcesContent` is the whole file, and the module's `sourceURL`.
 * @param workspace - The workspace whose absolute path the map names.
 * @param path - The original's workspace-relative path.
 * @param source - The original's text.
 * @param layer - The webpack layer: `pages-dir-browser` (browser) or `pages-dir-node` (server compile).
 * @param mappedLines - How many original lines, from line 1, the map maps (one generated line each), or the ascending 1-based original lines it maps, so a line can be left unmapped between mapped ones; consecutive lines may differ by 1 to 15.
 * @throws When the listed lines are not ascending with steps of 1 to 15.
 * @returns The module text.
 * @example pagesEvalModule('/repo', 'src/pages/index.tsx', PAGE_SOURCE, 'pages-dir-browser', 4)
 */
export function pagesEvalModule(
  workspace: string,
  path: string,
  source: string,
  layer: 'pages-dir-browser' | 'pages-dir-node',
  mappedLines: number | readonly number[],
): string {
  const originalLines =
    typeof mappedLines === 'number'
      ? Array.from({ length: mappedLines }, (_, index) => index + 1)
      : mappedLines
  // The map writes each step as one VLQ digit, so only ascending steps below 16 are expressible; anything else would corrupt the map silently.
  for (const [index, line] of originalLines.entries()) {
    const step = line - (originalLines[index - 1] ?? 1)
    if (step < 0 || step > 15 || (index > 0 && step === 0))
      throw new Error(
        `pagesEvalModule maps ascending lines with steps of 1 to 15 only, not ${originalLines.join(', ')}`,
      )
  }
  const code = originalLines.map((line) => `work${line}();`).join('\n')
  const map = {
    version: 3,
    file: '',
    sources: [join(workspace, path)],
    sourcesContent: [source],
    names: [],
    // One segment per generated line; its third field is the step to the next original line (a single base64 VLQ digit for steps below 16).
    mappings: originalLines
      .map(
        (line, index) =>
          `AA${VLQ_DIGITS[(line - (originalLines[index - 1] ?? 1)) * 2]}A`,
      )
      .join(';'),
    ignoreList: [],
    sourceRoot: '',
  }
  return `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=webpack-internal:///(${layer})/./${path}\n`
}

/**
 * Replaces the `mappings` of the inline source map of an eval module, keeping everything else, so a test can give a module a map that no scan reads to its end.
 * @param moduleText - A module built by {@link pagesEvalModule}.
 * @param mappings - The new VLQ `mappings`.
 * @returns The module text with the rewritten inline map.
 * @example withMappings(pagesEvalModule(workspace, path, source, 'pages-dir-browser', 4), ';'.repeat(100_001))
 */
export function withMappings(moduleText: string, mappings: string): string {
  return moduleText.replace(
    /(sourceMappingURL=data:application\/json;charset=utf-8;base64,)([A-Za-z\d+/=]+)/,
    (_match, prefix: string, encoded: string) => {
      const map = JSON.parse(Buffer.from(encoded, 'base64').toString())
      return `${prefix}${Buffer.from(JSON.stringify({ ...map, mappings })).toString('base64')}`
    },
  )
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
 * Wraps eval modules in a server compile or server chunk of Next 16's form (plain `eval("…")`).
 * @param modules - Module texts by webpack module id.
 * @param requiredChunkIds - The server chunks the file requires before it runs, as webpack's startup call lists them (a page's compile requires its vendor and shared chunks); none for a chunk that starts nothing.
 * @returns The chunk text.
 * @example serverChunk({ './src/pages/index.tsx': moduleText }, ['vendor-chunks/next', 'chunks/shared'])
 */
export function serverChunk(
  modules: Readonly<Record<string, string>>,
  requiredChunkIds: readonly string[] = [],
): string {
  const entries = Object.entries(modules).map(
    ([id, text]) =>
      `${JSON.stringify(id)}:\n((module, __webpack_exports__, __webpack_require__) => {\neval(${JSON.stringify(text)});\n})`,
  )
  const startup = requiredChunkIds.length
    ? `// load runtime\nvar __webpack_require__ = require("../webpack-runtime.js");\n__webpack_require__.C(exports);\nvar __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))\nvar __webpack_exports__ = __webpack_require__.X(0, ${JSON.stringify(requiredChunkIds)}, () => (__webpack_exec__("./src/pages/index.tsx")));\nmodule.exports = __webpack_exports__;\n`
    : ''
  return `"use strict";\n(() => {\nvar exports = {};\nexports.modules = {\n${entries.join(',\n')}\n};\n${startup}})();\n`
}

/** Where a page's server build holds the cited source's `(pages-dir-node)` module, and which server chunks the compile requires. */
export type NextPagesServerCompile = {
  /** Whether the compile itself holds the cited module; `true` by default. */
  holdsCited?: boolean
  /** How many lines, from line 1, the server module of the cited source maps, or the ascending lines it maps (a comment or blank line has no code, so no server position); every line of the cited text by default. */
  mappedLines?: number | readonly number[]
  /**
   * The server chunks the compile's startup call requires, by chunk id (`chunks/shared`, `vendor-chunks/next`). A chunk holds the cited module when `holdsCited` is true, and its file `.next/dev/server/<id>.js` is written unless `written` is false.
   */
  chunks?: Record<string, { holdsCited?: boolean; written?: boolean }>
}

/**
 * Writes a Pages project's server build as Next 16 lays it out: `.next/dev/server/pages-manifest.json` (`/` is `pages/index.js`), the page's compile `.next/dev/server/pages/index.js` and the server chunks its startup call requires.
 * @param write - Writes a workspace-relative file.
 * @param workspace - The canonical workspace the maps name.
 * @param cited - The cited source's workspace-relative path and text; its `(pages-dir-node)` module maps every line, or the lines `compile.mappedLines` names.
 * @param compile - Where the cited module lives and which chunks the compile requires; the compile holds it and requires nothing by default.
 * @param pagesManifest - The Pages manifest to write; the stand-in project's (`/` is `pages/index.js`) by default.
 * @returns The text of the cited source's `(pages-dir-node)` module: what the Next server's debugger reports for the script, and what the sealed module holds.
 * @example await writePagesServerBuild(write, workspace, { path: 'src/pages/index.tsx', text }, { chunks: { 'chunks/shared': { holdsCited: true } } })
 */
export async function writePagesServerBuild(
  write: (path: string, text: string) => Promise<void>,
  workspace: string,
  cited: { path: string; text: string },
  compile: NextPagesServerCompile = {},
  pagesManifest: Readonly<Record<string, string>> = PAGES_MANIFEST,
): Promise<string> {
  const citedModuleText = pagesEvalModule(
    workspace,
    cited.path,
    cited.text,
    'pages-dir-node',
    compile.mappedLines ?? cited.text.trimEnd().split('\n').length,
  )
  const citedModule = { [`./${cited.path}`]: citedModuleText }
  const chunks = compile.chunks ?? {}
  await write(
    '.next/dev/server/pages-manifest.json',
    JSON.stringify(pagesManifest),
  )
  await write(
    '.next/dev/server/pages/index.js',
    serverChunk(
      (compile.holdsCited ?? true) ? citedModule : {},
      Object.keys(chunks),
    ),
  )
  for (const [id, chunk] of Object.entries(chunks))
    if (chunk.written !== false)
      await write(
        `.next/dev/server/${id}.js`,
        serverChunk(chunk.holdsCited ? citedModule : {}),
      )
  return citedModuleText
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
    /** Writes the page's server build around the stand-in page ({@link writePagesServerBuild}). */
    writeServerBuild: async (
      compile?: NextPagesServerCompile,
    ): Promise<void> => {
      await writePagesServerBuild(
        write,
        workspace,
        { path: 'src/pages/index.tsx', text: PAGE_SOURCE },
        compile,
      )
    },
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
