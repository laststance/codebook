import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** The `dev` script of a nested stand-in app: the one Codebook accepts (webpack) on the port its own package declares. */
export const NESTED_DEV_SCRIPT = 'next dev --webpack -p 4321'

/** The `dev` script of the decoy root app: another bundler and port, so a read of the root's `package.json` yields another answer. */
export const DECOY_DEV_SCRIPT = 'next dev --turbopack -p 3999'

/** What the decoy root app's page says; the nested app's pages never say it. */
export const DECOY_PAGE_TEXT = 'decoy-root-page'

/**
 * Writes a file below a folder, creating its parents.
 * @param directory - The folder.
 * @param path - The folder-relative path.
 * @param text - The file's text.
 * @example await put('/tmp/repo', 'pages/index.tsx', 'x')
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
 * Writes an installed `next` (its `package.json` and `dist/bin/next`) below a folder.
 * @param directory - The folder whose `node_modules/next` is written.
 * @param version - The `version` the manifest holds.
 * @example await writeInstalledNext('/tmp/repo', '15.0.0')
 */
async function writeInstalledNext(
  directory: string,
  version: string,
): Promise<void> {
  await put(
    directory,
    'node_modules/next/package.json',
    JSON.stringify({ name: 'next', version }),
  )
  await put(directory, 'node_modules/next/dist/bin/next', '')
}

/**
 * Writes a different Next app at the repository root, whose every file differs from the nested app's: Pages and App pages, a `package.json` with another dev script and port, an older installed `next` and a `.next/dev` build that routes `/` to another page. A reader that takes the repository root for the package root reads these and answers differently or refuses.
 *
 * Why it exists: Issue 192 requires a decoy root in every nested-run fixture; used by `configuredRuntimeHarness` for `packageApp.decoyRoot`.
 * @param repositoryDirectory - The repository root.
 * @param withNext - Whether the decoy installs its own `node_modules/next` (not when the nested app hoists its Next to the root).
 * @example await writeDecoyNextApp(directory, true)
 */
export async function writeDecoyNextApp(
  repositoryDirectory: string,
  withNext: boolean,
): Promise<void> {
  const text = `export default function Decoy() {\n  return '${DECOY_PAGE_TEXT}'\n}\n`
  await put(repositoryDirectory, 'pages/index.tsx', text)
  await put(repositoryDirectory, 'app/page.tsx', text)
  await put(
    repositoryDirectory,
    'package.json',
    JSON.stringify({
      name: 'decoy-root',
      scripts: { dev: DECOY_DEV_SCRIPT },
      dependencies: { next: '15.0.0' },
    }),
  )
  if (withNext) await writeInstalledNext(repositoryDirectory, '15.0.0')
  await put(
    repositoryDirectory,
    '.next/dev/server/pages-manifest.json',
    JSON.stringify({ '/': 'pages/decoy.js' }),
  )
  await put(
    repositoryDirectory,
    '.next/dev/server/app-paths-manifest.json',
    JSON.stringify({ '/page': 'app/decoy/page.js' }),
  )
}

/**
 * Completes the nested Next app the harness stages: its `package.json` (webpack `dev` script), and, for a run without a Pages build, its App folder and installed `next`; moves `next` to the repository root when the app hoists it.
 *
 * Why it exists: the Pages build writer installs `next` in the folder it is given; the App and hoisted shapes need these files instead. Called by `configuredRuntimeHarness` for `packageRoot`.
 * @param input - `repositoryDirectory` and `packageDirectory` absolute folders; `withNext` installs `next` (the Pages writer already did); `next` where it must end up.
 * @example await writeNestedPackage({ repositoryDirectory, packageDirectory, withNext: true, next: 'package' })
 */
export async function writeNestedPackage(input: {
  repositoryDirectory: string
  packageDirectory: string
  withNext: boolean
  next: 'package' | 'hoisted'
}): Promise<void> {
  const { repositoryDirectory, packageDirectory } = input
  await put(
    packageDirectory,
    'package.json',
    JSON.stringify({
      name: 'nested-app',
      scripts: { dev: NESTED_DEV_SCRIPT },
      dependencies: { next: '16.4.3' },
    }),
  )
  if (input.withNext) {
    await put(
      packageDirectory,
      'src/app/page.tsx',
      "export default function Page() {\n  return 'nested-app-page'\n}\n",
    )
    await writeInstalledNext(packageDirectory, '16.4.3')
  }
  if (input.next === 'hoisted') {
    await mkdir(join(repositoryDirectory, 'node_modules'), { recursive: true })
    await rename(
      join(packageDirectory, 'node_modules/next'),
      join(repositoryDirectory, 'node_modules/next'),
    )
  }
}
