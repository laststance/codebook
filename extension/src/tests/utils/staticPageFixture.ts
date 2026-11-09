import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import { sha256 } from '../../runtimeSupport/utils/sha256'
import { resolveStaticPagePackage } from '../../utils/resolveStaticPagePackage'

import { removeTestFolder } from './removeTestFolder'

/** The page the fixture serves: one inline module script (lines 6 to 10) that imports a package from unpkg, and one same-origin script. */
export const STATIC_PAGE_HTML = `<!doctype html>
<html>
<head><title>page</title></head>
<body>
<button id="go">Go</button>
<script type="module">
  import { double } from 'https://unpkg.com/lib@latest/dist/lib.mjs'
  const total = double(2)
  document.title = String(total)
</script>
<script src="main.js"></script>
</body>
</html>
`

/** The same-origin script of {@link STATIC_PAGE_HTML}. */
export const STATIC_PAGE_SCRIPT = `window.started = true
window.count = 1
`

/** A repository with one plain page below its root. */
export type StaticPageRepository = {
  /** The repository's real root. */
  root: string
  /** The page folder's repository-relative path. */
  pageRoot: string
  /** The page folder's real path. */
  pageFolder: string
  /** Resolves the page folder like a run does. */
  resolvePage: () => ReturnType<typeof resolveStaticPagePackage>
  /** The repository-relative path of the page. */
  htmlPath: string
  /** The repository-relative path of the same-origin script. */
  scriptPath: string
}

/**
 * Builds a throwaway repository whose `examples/page` folder holds {@link STATIC_PAGE_HTML} and {@link STATIC_PAGE_SCRIPT}.
 * @param context - The test, which removes the folder when it ends.
 * @param files - Files to write besides (or instead of) the defaults, by page-relative path.
 * @returns The repository facts.
 * @example const repository = await createStaticPageRepository(context)
 */
export async function createStaticPageRepository(
  context: TestContext,
  files: Readonly<Record<string, string>> = {},
): Promise<StaticPageRepository> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codebook-page-')))
  context.after(() => removeTestFolder(root))
  const pageFolder = join(root, 'examples', 'page')
  await mkdir(pageFolder, { recursive: true })
  const written = {
    'index.html': STATIC_PAGE_HTML,
    'main.js': STATIC_PAGE_SCRIPT,
    ...files,
  }
  for (const [name, text] of Object.entries(written)) {
    await mkdir(join(pageFolder, name, '..'), { recursive: true })
    await writeFile(join(pageFolder, name), text)
  }
  return {
    root,
    pageRoot: 'examples/page',
    pageFolder,
    resolvePage: () => resolveStaticPagePackage(root, 'examples/page'),
    htmlPath: 'examples/page/index.html',
    scriptPath: 'examples/page/main.js',
  }
}

/**
 * Builds the declared stop of a file.
 * @param path - The repository-relative path.
 * @param text - The file's text, whose hash the stop carries.
 * @param line - The one-based line of the stop.
 * @returns The stop `{ path, hash, line, column }`.
 * @example stopOf('examples/page/index.html', STATIC_PAGE_HTML, 8)
 */
export function stopOf(
  path: string,
  text: string,
  line: number,
): { path: string; hash: string; line: number; column: number } {
  return { path, hash: sha256(text), line, column: 1 }
}
