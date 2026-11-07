import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { TestContext } from 'node:test'

import {
  chromeExtensionConfigSchema,
  type ChromeExtensionConfiguration,
} from '../../chromeExtensionConfigSchemas'
import type {
  BuildProcessExit,
  BuildSpawner,
} from '../../utils/buildProcessTypes'

import { writeFixtureFiles } from './chromeExtensionFixture'

/** The text of the page stop's source. */
export const OPTIONS_APP_SOURCE = 'const token = 1\nexport const app = token\n'
/** The text of the worker stop's source. */
export const BACKGROUND_SOURCE =
  'const started = 1\nexport const worker = started\n'
/** A source the page loads that no stop test names. */
export const OTHER_SOURCE = 'export const other = 2\n'

const OPTIONS_APP_PATH = 'src/entrypoints/options/App.ts'
const BACKGROUND_PATH = 'src/entrypoints/background.ts'
const OTHER_PATH = 'src/lib/other.ts'

/** The manifest of the fixture's WXT build: a worker and an options page. */
const BUILD_MANIFEST = {
  manifest_version: 3,
  name: 'Wxt Fixture',
  version: '1.0',
  permissions: ['storage'],
  background: { service_worker: 'background.js', type: 'module' },
}

/**
 * Writes what a WXT development build leaves in a load root: the manifest, an options page, a worker, and chunks whose maps list the project's sources relative to the map's own folder, as Vite writes them.
 * @param loadRoot - The build folder, spelled the way the build was told (Vite writes sources relative to this spelling).
 * @param projectRoot - The project folder, spelled the way the build was told.
 */
export async function writeWxtBuild(
  loadRoot: string,
  projectRoot: string,
): Promise<void> {
  const mapOf = (mapFolder: string, sources: string[], texts: string[]) =>
    JSON.stringify({
      version: 3,
      sources: sources.map((source) =>
        relative(mapFolder, join(projectRoot, source)),
      ),
      sourcesContent: texts,
      mappings: '',
    })
  await writeFixtureFiles(loadRoot, {
    'manifest.json': JSON.stringify(BUILD_MANIFEST),
    'options.html':
      '<!doctype html><script type="module" src="chunks/options.js"></script>\n',
    'chunks/options.js':
      'console.log(1)\n//# sourceMappingURL=options.js.map\n',
    'chunks/options.js.map': mapOf(
      join(loadRoot, 'chunks'),
      [OPTIONS_APP_PATH, OTHER_PATH],
      [OPTIONS_APP_SOURCE, OTHER_SOURCE],
    ),
    'background.js': 'console.log(2)\n//# sourceMappingURL=background.js.map\n',
    'background.js.map': mapOf(
      loadRoot,
      [BACKGROUND_PATH],
      [BACKGROUND_SOURCE],
    ),
  })
}

/** A repository with a tracked WXT project `ext/`, WXT 0.21.4 installed untracked, and the build folder outside the repository. */
export type WxtFixture = {
  repositoryRoot: string
  projectRoot: string
  /** A real folder outside the repository the build is written to. */
  buildFolder: string
}

/**
 * Creates a Git repository holding a WXT project (config and sources tracked, `wxt` installed in untracked `node_modules`) and an empty folder outside it for the build; both are removed when the test ends.
 * @param context - The test context whose end removes the folders.
 * @returns The fixture's real paths.
 * @example const fixture = await createWxtFixture(context)
 */
export async function createWxtFixture(
  context: TestContext,
): Promise<WxtFixture> {
  const repositoryRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wxt-source-')),
  )
  const buildFolder = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wxt-build-out-')),
  )
  context.after(async () => {
    await rm(repositoryRoot, { recursive: true, force: true })
    await rm(buildFolder, { recursive: true, force: true })
  })
  await writeFixtureFiles(repositoryRoot, {
    'ext/wxt.config.ts': 'export default {}\n',
    [`ext/${OPTIONS_APP_PATH}`]: OPTIONS_APP_SOURCE,
    [`ext/${BACKGROUND_PATH}`]: BACKGROUND_SOURCE,
    [`ext/${OTHER_PATH}`]: OTHER_SOURCE,
    'ext/node_modules/wxt/package.json': JSON.stringify({
      name: 'wxt',
      version: '0.21.4',
    }),
  })
  execFileSync('git', ['init', '-q'], { cwd: repositoryRoot })
  execFileSync('git', ['add', 'ext/wxt.config.ts', 'ext/src'], {
    cwd: repositoryRoot,
  })
  return {
    repositoryRoot,
    projectRoot: join(repositoryRoot, 'ext'),
    buildFolder,
  }
}

/**
 * A parsed `wxt-build` configuration for the fixture: the options page as surface, a page stop in the options source and a worker stop in the background source.
 * @param overrides - Fields replacing the baseline's.
 */
export function wxtConfiguration(
  overrides: Record<string, unknown> = {},
): ChromeExtensionConfiguration {
  return chromeExtensionConfigSchema.parse({
    version: 1,
    adapter: 'wxt-build',
    book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    extensionRoot: 'ext',
    surface: { kind: 'page', path: 'options.html' },
    clicks: [{ title: 'Press', selector: '#go' }],
    stops: [
      { path: OPTIONS_APP_PATH, line: 2, context: 'page' },
      { path: BACKGROUND_PATH, line: 2, context: 'service-worker' },
    ],
    observe: { kind: 'popup' },
    ...overrides,
  })
}

/**
 * A spawner that behaves like a successful WXT build: it writes the fixture build into the output folder the script is told, spelled exactly as told, and its result file, then exits 0.
 * @param projectRootSpelling - The project folder as the build would see it.
 */
export function createSuccessfulBuildSpawner(
  projectRootSpelling: string,
): BuildSpawner {
  return (request) => {
    const [projectArgument, outDir, resultFile] = request.arguments.slice(3)
    const loadRoot = join(outDir ?? '', 'chrome-mv3-dev')
    let resolveExit = (_status: BuildProcessExit): void => undefined
    const exited = new Promise<BuildProcessExit>(
      (resolve) => (resolveExit = resolve),
    )
    void (async () => {
      await writeWxtBuild(loadRoot, projectArgument ?? projectRootSpelling)
      await mkdir(dirname(resultFile ?? ''), { recursive: true })
      await writeFile(
        resultFile ?? '',
        JSON.stringify({ ok: true, wxtVersion: '0.21.4', outDir }),
      )
      resolveExit({ code: 0, signal: null })
    })()
    return {
      exited,
      treeGone: exited.then(() => undefined),
      isTreeGone: () => true,
      signalTree: () => undefined,
    }
  }
}
