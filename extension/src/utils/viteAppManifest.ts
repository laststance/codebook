import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { parseViteDevScript } from './parseViteDevScript'

/** The `package.json` fields that say whether a package declares Vite, and the `dev` script a Vite app runs. */
export const viteManifestFieldsSchema = z.looseObject({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  scripts: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Says whether a parsed `package.json` declares `vite` in `dependencies` or `devDependencies`.
 *
 * Why it exists: one definition of "declares Vite" serves {@link isViteAppManifest} for an explicit `packageRoot` ({@link resolveVitePackage}), the status discovery ({@link scanPackages}) and the root's `rootIsApp`, so status never lists a folder a start would refuse as not a Vite app.
 *
 * @param manifest - The parsed JSON value of a `package.json`.
 * @returns `true` when `vite` is named in one of the two sections.
 * @example
 * manifestDeclaresVite({ devDependencies: { vite: '^8.3.5' } }) // => true
 * manifestDeclaresVite({ dependencies: { vitest: '^3.0.0' } }) // => false
 */
function manifestDeclaresVite(manifest: unknown): boolean {
  const parsed = viteManifestFieldsSchema.safeParse(manifest)
  if (!parsed.success) return false
  const { dependencies, devDependencies } = parsed.data
  return [dependencies, devDependencies].some(
    (section) => section !== undefined && 'vite' in section,
  )
}

/**
 * Says whether a folder is a Vite app by decision D5: its `package.json` declares `vite`, and the folder holds an `index.html` or its `dev` script is one {@link parseViteDevScript} accepts.
 *
 * Why it exists: a Vitest-only library package declares `vite` and holds a `vite.config.*` but no page and no `dev` script, so it is no app; a chat must never be offered it and a start must refuse it as `not-a-vite-app`. Called by {@link resolveVitePackage} for a declared `packageRoot` and by the discovery for each tracked manifest.
 *
 * @param manifest - The parsed JSON value of the folder's `package.json`.
 * @param folder - The folder's path, where `index.html` is looked for and the `dev` script's `--config` must stay.
 * @returns `true` for a Vite app; `false` when `vite` is not declared, or neither `index.html` nor an accepted `dev` script is there.
 * @example
 * await isViteAppManifest({ devDependencies: { vite: '^8.3.5' }, scripts: { dev: 'vite' } }, '/repo/examples/react/basic') // => true
 * await isViteAppManifest({ devDependencies: { vite: '^8.3.5' }, scripts: { 'test:lib': 'vitest' } }, '/repo/packages/query-core') // => false
 */
export async function isViteAppManifest(
  manifest: unknown,
  folder: string,
): Promise<boolean> {
  if (!manifestDeclaresVite(manifest)) return false
  const parsed = viteManifestFieldsSchema.safeParse(manifest)
  const dev = parsed.success ? parsed.data.scripts?.dev : undefined
  // An accepted dev script alone makes the folder an app; it needs no file read.
  if (typeof dev === 'string' && parseViteDevScript(dev, folder).accepted)
    return true
  return stat(join(folder, 'index.html')).then(
    (entry) => entry.isFile(),
    () => false,
  )
}
