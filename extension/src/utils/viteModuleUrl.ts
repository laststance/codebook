import { realpath } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'

import { VITE_STOP_EXTENSIONS } from '../constants'

/** The served address and real path of one stop file. */
export type ViteModuleAddress = {
  /** The file's real path inside the package root. */
  realPath: string
  /** The address the owned Vite server serves the file at. */
  url: string
}

/**
 * Maps a declared stop file to the address the Vite dev server serves it at: the real path relative to the package root, POSIX separators, each segment URL-encoded, case preserved.
 *
 * Why it exists: the sealer fetches exactly the module the browser will run for that file. Called by {@link readViteServedModule} for each declared stop.
 *
 * @param packageRoot - The package root (the workspace root this version).
 * @param sourcePath - The stop's workspace-relative path; backslashes are read as separators so Windows-style input maps the same.
 * @param ownedOrigin - The owned origin, such as `http://127.0.0.1:3010`.
 * @returns The address and the real path.
 * @throws When the real path lies outside the package root, inside `node_modules`, or has an extension Vite does not serve as JavaScript with an inline map; the message names the path.
 * @example
 * await viteModuleUrl('/repo', 'src/my file#1.tsx', 'http://127.0.0.1:3010') // => { url: 'http://127.0.0.1:3010/src/my%20file%231.tsx', … }
 */
export async function viteModuleUrl(
  packageRoot: string,
  sourcePath: string,
  ownedOrigin: string,
): Promise<ViteModuleAddress> {
  const root = await realpath(packageRoot)
  const realPath = await realpath(join(root, ...sourcePath.split(/[\\/]/)))
  const relativePath = relative(root, realPath)
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  )
    throw new Error(
      `${sourcePath} resolves outside the package root, where Vite serves no module of the app (/@fs/ paths are not supported)`,
    )
  const segments = relativePath.split(sep)
  if (segments.includes('node_modules'))
    throw new Error(
      `${sourcePath} is inside node_modules, which Vite serves as an optimized dependency and not as app source`,
    )
  const extension = extname(realPath)
  if (!VITE_STOP_EXTENSIONS.includes(extension))
    throw new Error(
      `${sourcePath} has the extension ${extension || '(none)'}; only ${VITE_STOP_EXTENSIONS.join(', ')} files are sealed (a framework file such as .vue or .svelte is not supported)`,
    )
  return {
    realPath,
    url: `${ownedOrigin}/${segments.map(encodeURIComponent).join('/')}`,
  }
}
