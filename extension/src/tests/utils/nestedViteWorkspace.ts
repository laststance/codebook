import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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
