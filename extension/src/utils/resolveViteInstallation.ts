import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

const vitePackageSchema = z.object({
  version: z.string(),
  engines: z.object({ node: z.string().optional() }).optional(),
  exports: z.unknown().optional(),
  module: z.string().optional(),
  main: z.string().optional(),
})

/** What the app's own `vite` package says about itself. */
export type ViteInstallation = {
  /** The package folder. */
  directory: string
  version: string
  major: number
  /** The `engines.node` range, when the package has one. */
  enginesNode: string | undefined
  /** The absolute path of the ESM entry the launcher imports. */
  entry: string
}

/** What looking for Vite found: it, or why there is none. */
export type ViteInstallationLookup =
  | { found: true; installation: ViteInstallation }
  | { found: false; reason: 'yarn-pnp' | 'not-installed' }

/** Picks the import entry of a package `exports["."]` value: `import`, `node` or `default`, depth-first. */
function importEntryOf(exported: unknown): string | undefined {
  if (typeof exported === 'string') return exported
  if (typeof exported !== 'object' || exported === null) return undefined
  const conditions = new Map(Object.entries(exported))
  for (const condition of ['import', 'node', 'default']) {
    const entry = importEntryOf(conditions.get(condition))
    if (entry) return entry
  }
  return undefined
}

/**
 * Finds the app's own `vite` package from the package root with Node's resolution, for {@link assessViteWorkspace} and {@link readCodebookStatus}'s Vite prerequisite.
 *
 * Why it exists: Codebook runs the project's Vite, never one of its own, so pnpm and npm workspaces work as the project does. A Yarn Plug-n-Play project with no `node_modules` has nothing to resolve and is told apart.
 *
 * @param workspace - The package root.
 * @returns The installation, or `yarn-pnp` / `not-installed` as the reason there is none.
 * @throws When `vite/package.json` lacks a version or names no importable entry (the message names it); a manifest Node's resolution cannot parse fails that resolution first and reads as `not-installed`.
 * @example
 * await resolveViteInstallation('/repo') // => { found: true, installation: { version: '8.3.5', major: 8, … } }
 */
export async function resolveViteInstallation(
  workspace: string,
): Promise<ViteInstallationLookup> {
  const requireFromRoot = createRequire(
    join(resolve(workspace), 'package.json'),
  )
  let packagePath: string
  try {
    packagePath = requireFromRoot.resolve('vite/package.json')
  } catch {
    const isPnp = await access(join(workspace, '.pnp.cjs')).then(
      () => true,
      () => false,
    )
    return { found: false, reason: isPnp ? 'yarn-pnp' : 'not-installed' }
  }
  const manifest = vitePackageSchema.parse(
    JSON.parse(await readFile(packagePath, 'utf8')),
  )
  const directory = dirname(packagePath)
  const exported =
    typeof manifest.exports === 'object' && manifest.exports !== null
      ? new Map(Object.entries(manifest.exports)).get('.')
      : manifest.exports
  const relativeEntry =
    importEntryOf(exported) ?? manifest.module ?? manifest.main
  if (!relativeEntry)
    throw new Error('vite/package.json names no importable entry')
  return {
    found: true,
    installation: {
      directory,
      version: manifest.version,
      major: Number.parseInt(manifest.version, 10),
      enginesNode: manifest.engines?.node,
      entry: resolve(directory, relativeEntry),
    },
  }
}
