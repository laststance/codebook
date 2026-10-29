import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

import {
  chromeExtensionConfigSchema,
  type ChromeExtensionConfiguration,
} from '../../chromeExtensionConfigSchemas'

/** A Manifest V3 manifest declaring a popup and a classic service worker, the baseline of every chrome-extension test. */
export const BASELINE_MANIFEST = {
  manifest_version: 3,
  name: 'Fixture Extension',
  version: '1.0',
  permissions: ['storage'],
  host_permissions: ['https://example.com/*'],
  action: { default_popup: 'popup/popup.html' },
  background: { service_worker: 'background/worker.js' },
}

/**
 * The files of the baseline extension under `ext/`, keyed by repository-relative path.
 * @example baselineExtensionFiles()['ext/popup/popup.js'] // => "import './helper.js'\n…"
 */
export function baselineExtensionFiles(): Record<string, string> {
  return {
    'ext/manifest.json': JSON.stringify(BASELINE_MANIFEST),
    'ext/popup/popup.html': '<!doctype html><script src="popup.js"></script>\n',
    'ext/popup/popup.js':
      "import './helper.js'\nconst first = 1\nconsole.log(first)\n",
    'ext/popup/helper.js': 'export const helper = 1\nexport const other = 2\n',
    'ext/background/worker.js':
      "importScripts('lib.js')\nconst second = 2\nself.second = second\n",
    'ext/background/lib.js': 'self.library = 1\nself.library += 1\n',
  }
}

/**
 * A valid raw configuration for the baseline extension: popup surface, one click, one page stop, one worker stop.
 * @param overrides - Fields replacing the baseline's.
 * @example baselineConfiguration({ observe: { kind: 'popup' } })
 */
export function baselineConfiguration(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    adapter: 'chrome-mv3-unpacked',
    book: { bookId: 'interface', revision: 1, nodeId: 'theme', anchorIndex: 0 },
    extensionRoot: 'ext',
    surface: { kind: 'popup' },
    clicks: [{ title: 'Press the button', selector: '#go' }],
    stops: [
      { path: 'popup/popup.js', line: 2, context: 'page' },
      { path: 'background/lib.js', line: 2, context: 'service-worker' },
    ],
    observe: { kind: 'popup' },
    ...overrides,
  }
}

/** A parsed baseline configuration, typed for the resolver. @example resolveChromeExtensionRun({ repositoryRoot, configuration: parsedBaseline() }) */
export function parsedBaseline(
  overrides: Record<string, unknown> = {},
): ChromeExtensionConfiguration {
  return chromeExtensionConfigSchema.parse(baselineConfiguration(overrides))
}

/** Writes files (relative path to content) into a folder, creating parents. @example await writeFixtureFiles(root, { 'a/b.js': '1' }) */
export async function writeFixtureFiles(
  folder: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(folder, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

/**
 * Creates a temporary repository folder holding the given files and removes it when the test ends.
 * @param context - The test context whose end removes the folder.
 * @param files - Repository-relative path to content.
 * @returns The folder's canonical (realpath) path, as the product receives it.
 * @example const repositoryRoot = await createRepositoryFixture(context, baselineExtensionFiles())
 */
export async function createRepositoryFixture(
  context: TestContext,
  files: Record<string, string>,
): Promise<string> {
  const repositoryRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-ext-fixture-')),
  )
  context.after(() => rm(repositoryRoot, { recursive: true, force: true }))
  await writeFixtureFiles(repositoryRoot, files)
  return repositoryRoot
}
