import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES } from '../../constants'
import type { NextRouteManifests } from '../../utils/readNextRouteManifests'

import {
  browserChunk,
  PAGES_MANIFEST,
  pagesEvalModule,
  withMappings,
  writePagesServerBuild,
  type NextPagesServerCompile,
} from './nextPagesBuildHarness'

/** What the stand-in page reports of `window.next.router` and its location at one read. */
export type NextPagesPageState = {
  pathname: string
  routerSeen: boolean
  isReady: boolean
  route?: string
}

/** How {@link configuredRuntimeHarness} stages a Next run in a workspace with a Pages folder. */
export type NextPagesHarnessOptions = {
  /** The configured entry path; `/` when absent. */
  entryPath?: string
  /** What the stand-in server answers to the entry path; 200 without a `Location` when absent. */
  entry?: { status: number; location?: string }
  /** What the route manifests say: the reader is replaced by this answer. Without it the real reader reads the `.next/dev` manifests the harness wrote (route `/` → `pages/index.js`). */
  manifests?: NextRouteManifests
  /** Makes the replaced reader reject with this message, as a manifest that cannot be read does. */
  manifestFailure?: string
  /** Makes the replaced reader answer only when the run is cancelled, as a poll still waiting for a cold compile does. */
  manifestsHang?: boolean
  /** Fields merged into the written `routes-manifest.json` (Next 16's measured one by default), such as `basePath` or a redirect source. */
  routesManifest?: Record<string, unknown>
  /** The page's router states, one per read; the last repeats. A ready router on route `/` at the entry path when absent. */
  pageStates?: NextPagesPageState[]
  /** Whether the page and `_app` chunks are written; `true` by default. Without them any chunk read fails. */
  chunks?: boolean
  /** Whether the page chunk carries the cited source's module; `true` by default. Without it the module is in no chunk the page loads at start (a module loaded later). */
  citedInPageChunk?: boolean
  /** How many lines, from line 1, the browser module of the cited source maps, or the ascending lines it maps; 1 by default. */
  mappedLines?: number | readonly number[]
  /** Gives the browser module of the cited source a map whose scan stops at its size limit before it reaches any line (the generated-lines limit), so the client mapping of every line reads `unknown`. */
  browserMapScanStopsAtLimit?: boolean
  /**
   * Writes the page's server compile (`.next/dev/server/pages/index.js`), whose `(pages-dir-node)` module of the cited source maps every line. `true` is a compile that holds the cited module; an object stages where the module is and which server chunks the compile requires ({@link NextPagesServerCompile}).
   */
  serverCompile?: boolean | NextPagesServerCompile
  /** Further entries of the written `pages-manifest.json` (route to compiled page, such as `/other` to `pages/other.js`), so a hit can be read as another page's. */
  pagesManifest?: Record<string, string>
  /** Makes Codebook's readiness request for the entry end without an answer, as a data function that writes and then never answers does: the stand-in launcher sends it, then fails with this outcome. */
  readinessFailure?: 'timeout' | 'connection-lost'
  /** Makes Codebook's readiness request for the entry stay unanswered after it was sent, as a data function that hangs on a database call does: the stand-in launcher ends it only when the run is cancelled, and then closes the record as the real launcher does. */
  readinessUnanswered?: boolean
  /** Adds an App folder (`src/app/page.tsx`), so the workspace has both routers. */
  withAppFolder?: boolean
  /** The masked output tail the stand-in server reports. */
  outputTail?: string
}

/** The page `/` of the stand-in project. */
const ENTRY_PAGE_PATH = 'src/pages/index.tsx'

/** A stand-in page file (never application code), which makes `src/pages` the Pages folder Next reads. */
const STAND_IN_PAGE = 'export default function Home() {\n  return null\n}\n'

const MEASURED_FIXTURES = join(
  __dirname,
  '../../../src/tests/fixtures/next-pages/nextjs',
)

/**
 * Writes the files of a Next 16 Pages project around the harness's cited source: `src/pages/index.tsx`, an installed `next` 16.4.3, the `.next/dev` manifests, the page and `_app` chunks with the cited source's `(pages-dir-browser)` eval module, and optionally the page's server compile.
 * @param workspace - The harness repository.
 * @param cited - The cited source's workspace-relative path and text.
 * @param options - What the test stages.
 * @returns The eval module text the page executes for the cited source, and the build manifest text (for byte counts).
 * @example const { moduleJavascript } = await writeNextPagesWorkspace(directory, { path: 'src/theme.ts', text }, {})
 */
export async function writeNextPagesWorkspace(
  workspace: string,
  cited: { path: string; text: string },
  options: NextPagesHarnessOptions,
): Promise<{
  moduleJavascript: string
  buildManifest: string
  /** The text of the cited source's `(pages-dir-node)` module, when the server compile was written. */
  serverModuleJavascript?: string
}> {
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(workspace, path)), { recursive: true })
    await writeFile(join(workspace, path), text)
  }
  const root = await realpath(workspace)
  // A stop cited in the entry page itself keeps its own file: the cited text is the page.
  if (cited.path !== ENTRY_PAGE_PATH)
    await write(ENTRY_PAGE_PATH, STAND_IN_PAGE)
  if (options.withAppFolder) await write('src/app/page.tsx', STAND_IN_PAGE)
  await write(
    'node_modules/next/package.json',
    JSON.stringify({ name: 'next', version: '16.4.3' }),
  )
  await write('node_modules/next/dist/bin/next', '')
  const buildManifest = await readFile(
    join(MEASURED_FIXTURES, 'build-manifest.json'),
    'utf8',
  )
  await write('.next/dev/build-manifest.json', buildManifest)
  const routesManifest = JSON.parse(
    await readFile(join(MEASURED_FIXTURES, 'routes-manifest.json'), 'utf8'),
  )
  await write(
    '.next/dev/routes-manifest.json',
    JSON.stringify({ ...routesManifest, ...options.routesManifest }),
  )
  const pagesManifest = { ...PAGES_MANIFEST, ...options.pagesManifest }
  await write(
    '.next/dev/server/pages-manifest.json',
    JSON.stringify(pagesManifest),
  )
  const mappedModule = pagesEvalModule(
    root,
    cited.path,
    cited.text,
    'pages-dir-browser',
    options.mappedLines ?? 1,
  )
  const moduleJavascript = options.browserMapScanStopsAtLimit
    ? withMappings(
        mappedModule,
        ';'.repeat(REPOSITORY_MAPPED_POSITION_MAX_GENERATED_LINES + 1),
      )
    : mappedModule
  if (options.chunks ?? true) {
    await write(
      '.next/dev/static/chunks/pages/index.js',
      browserChunk(
        'pages/index',
        (options.citedInPageChunk ?? true)
          ? { [`./${cited.path}`]: moduleJavascript }
          : {},
      ),
    )
    await write(
      '.next/dev/static/chunks/pages/_app.js',
      browserChunk('pages/_app', {}),
    )
  }
  const serverModuleJavascript = options.serverCompile
    ? await writePagesServerBuild(
        write,
        root,
        cited,
        options.serverCompile === true ? {} : options.serverCompile,
        pagesManifest,
      )
    : undefined
  return { moduleJavascript, buildManifest, serverModuleJavascript }
}
