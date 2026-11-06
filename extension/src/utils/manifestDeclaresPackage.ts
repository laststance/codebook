import { z } from 'zod'

/** The `package.json` fields that say whether a package declares a given package, and the scripts an app runs: the `dependencies`, `devDependencies` and `scripts` sections the Vite, react-scripts and Expo app rules read. */
export const viteManifestFieldsSchema = z.looseObject({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  scripts: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Says whether a parsed `package.json` declares a package in `dependencies` or `devDependencies`.
 *
 * Why it exists: one definition of "declares package X" serves the react-scripts and Expo web app rules, so the status discovery, the root's `rootIsApp` and each readiness judgement never disagree about what an app is. Called by {@link manifestDeclaresReactScripts} and {@link manifestDeclaresExpo}.
 * @param manifest - The parsed JSON value of a `package.json`.
 * @param packageName - The package name to look for.
 * @returns `true` when the name is a key of one of the two sections.
 * @example
 * manifestDeclaresPackage({ dependencies: { expo: '~57.0.0' } }, 'expo') // => true
 * manifestDeclaresPackage({ dependencies: { react: '^18.0.0' } }, 'expo') // => false
 */
export function manifestDeclaresPackage(
  manifest: unknown,
  packageName: string,
): boolean {
  const parsed = viteManifestFieldsSchema.safeParse(manifest)
  if (!parsed.success) return false
  const { dependencies, devDependencies } = parsed.data
  return [dependencies, devDependencies].some(
    (section) => section !== undefined && packageName in section,
  )
}

/**
 * Says whether a parsed `package.json` declares `expo`.
 *
 * Why it exists: one definition of "this folder is an Expo app" serves the status discovery, the root's `rootIsApp` and {@link readExpoWebPackageReadiness}, so status never lists a folder a start would refuse as not an Expo app.
 * @param manifest - The parsed JSON value of a `package.json`.
 * @returns `true` when `expo` is named in `dependencies` or `devDependencies`.
 * @example manifestDeclaresExpo({ dependencies: { expo: '~57.0.0' } }) // => true
 */
export function manifestDeclaresExpo(manifest: unknown): boolean {
  return manifestDeclaresPackage(manifest, 'expo')
}
