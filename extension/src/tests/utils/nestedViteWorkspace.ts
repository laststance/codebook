import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** The repository-relative folder of the stand-in workspace library of {@link writeNestedViteLibrary}. */
export const NESTED_VITE_LIBRARY_FOLDER = 'packages/core'

/** The `name` of the stand-in workspace library. */
export const NESTED_VITE_LIBRARY_NAME = '@scope/core'

/** The repository-relative path of the library's source file the stop is declared in. */
export const NESTED_VITE_LIBRARY_SOURCE_PATH = 'packages/core/src/a.ts'

/** The repository-relative path of the library's built module, whose inline map names `src/a.ts`. */
export const NESTED_VITE_LIBRARY_BUILT_PATH = 'packages/core/build/modern/a.js'

/**
 * Builds the text Vite serves for a library's built module: the executed statement and an inline map that names the library's source file with its text, as Vite serves a workspace library whose build carries `sourcesContent`.
 * @param sourceText - The text the map retains for `../../src/a.ts`.
 * @param executedStatement - The module's JavaScript before the map comment.
 * @param mappings - The map's VLQ `mappings` (generated 0:0 to source 1:1 by default).
 * @returns The served module text.
 * @example
 * servedViteLibraryModule('export const a = 1\n', 'const nextTheme = "dark";') // => 'const nextTheme = "dark";\n//# sourceMappingURL=data:application/json;base64,…'
 */
export function servedViteLibraryModule(
  sourceText: string,
  executedStatement: string,
  mappings = 'AAAA',
): string {
  const map = JSON.stringify({
    version: 3,
    sources: ['../../src/a.ts'],
    sourcesContent: [sourceText],
    names: [],
    mappings,
  })
  return `${executedStatement}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}`
}

/** The `dev` script of a nested stand-in Vite app: one Codebook accepts, on the port its own package declares. */
export const NESTED_VITE_DEV_SCRIPT = 'vite --port 4321'

/** The `dev` script of the decoy root app: another port, so a read of the root's `package.json` yields another answer. */
export const DECOY_VITE_DEV_SCRIPT = 'vite --port 3999'

/**
 * Writes a file below a folder, creating its parents.
 * @param directory - The folder.
 * @param path - The folder-relative path.
 * @param text - The file's text.
 * @example await put('/tmp/repo', 'index.html', '<html></html>')
 */
async function put(
  directory: string,
  path: string,
  text: string,
): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true })
  await writeFile(join(directory, path), text)
}

/**
 * Writes the manifest, page and `.env` of a stand-in Vite app into a folder.
 * @param directory - The app folder.
 * @param devScript - The `dev` script its `package.json` holds.
 * @param envText - The text of the app's `.env`, when it has one.
 * @example await writeViteApp('/tmp/repo/examples/react/basic', NESTED_VITE_DEV_SCRIPT)
 */
async function writeViteApp(
  directory: string,
  devScript: string,
  envText?: string,
): Promise<void> {
  await put(
    directory,
    'package.json',
    JSON.stringify({
      name: 'nested-vite-app',
      scripts: { dev: devScript },
      devDependencies: { vite: '^8.3.5' },
    }),
  )
  await put(
    directory,
    'index.html',
    '<html><body>nested-vite-page</body></html>',
  )
  if (envText !== undefined) await put(directory, '.env', envText)
}

/**
 * Writes the nested Vite app the harness stages (`packageRoot` with `adapter: "vite-dev"`) and, when asked, a different Vite app at the repository root whose files all differ: another `dev` script and port, so a reader that takes the repository root for the package root answers differently.
 *
 * Why it exists: Cycle 0077 requires a decoy root in every nested-run fixture, as Issue 192 did for Next; used by `configuredRuntimeHarness` for a Vite `packageRoot`.
 * @param input - `repositoryDirectory` and `packageDirectory` absolute folders; `decoyRoot` writes the decoy; `envText` the nested app's `.env`.
 * @example await writeNestedVitePackage({ repositoryDirectory, packageDirectory, decoyRoot: true })
 */
export async function writeNestedVitePackage(input: {
  repositoryDirectory: string
  packageDirectory: string
  decoyRoot?: boolean
  envText?: string
}): Promise<void> {
  if (input.decoyRoot)
    await writeViteApp(input.repositoryDirectory, DECOY_VITE_DEV_SCRIPT)
  await writeViteApp(
    input.packageDirectory,
    NESTED_VITE_DEV_SCRIPT,
    input.envText,
  )
}

/**
 * Writes a workspace library next to a nested Vite app: `package.json`, `src/a.ts`, a `build/modern/a.js` whose inline map names the source, and (unless `linked` is false) the app's `node_modules` link to the library.
 *
 * Why it exists: Cycle 0078 integration tests need a library the app reaches through a link inside the repository, with a build mapped to its `src/`. Used by `configuredRuntimeHarness` for a Vite library stop.
 * @param input - `repositoryDirectory` and `packageDirectory` absolute folders, the library source text, the served module text and whether the app links to the library.
 * @example await writeNestedViteLibrary({ repositoryDirectory, packageDirectory, sourceText, servedModule, linked: true })
 */
export async function writeNestedViteLibrary(input: {
  repositoryDirectory: string
  packageDirectory: string
  sourceText: string
  servedModule: string
  linked?: boolean
}): Promise<void> {
  const library = join(input.repositoryDirectory, NESTED_VITE_LIBRARY_FOLDER)
  await put(
    library,
    'package.json',
    JSON.stringify({ name: NESTED_VITE_LIBRARY_NAME }),
  )
  await put(library, 'src/a.ts', input.sourceText)
  await put(library, 'build/modern/a.js', input.servedModule)
  if (input.linked === false) return
  const link = join(
    input.packageDirectory,
    'node_modules',
    NESTED_VITE_LIBRARY_NAME,
  )
  await mkdir(dirname(link), { recursive: true })
  // A junction on Windows, which needs no symlink privilege; ignored elsewhere.
  await symlink(library, link, 'junction')
}
