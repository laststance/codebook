import {
  manifestDeclaresPackage,
  viteManifestFieldsSchema,
} from './manifestDeclaresPackage'

/** The `package.json` fields that say whether a package declares react-scripts, and the scripts a react-scripts app runs: the same `dependencies`, `devDependencies` and `scripts` sections {@link isViteAppManifest} reads. */
export const reactScriptsManifestFieldsSchema = viteManifestFieldsSchema

/**
 * Says whether a parsed `package.json` declares `react-scripts` in `dependencies` or `devDependencies`.
 *
 * Why it exists: one definition of "this folder is a react-scripts app" serves the status discovery ({@link scanPackages}), the root's `rootIsApp` and {@link readReactScriptsPackageReadiness}, so status never lists a folder a start would refuse as not a react-scripts app.
 *
 * @param manifest - The parsed JSON value of a `package.json`.
 * @returns `true` when `react-scripts` is named in one of the two sections.
 * @example
 * manifestDeclaresReactScripts({ dependencies: { 'react-scripts': '5.0.1' } }) // => true
 * manifestDeclaresReactScripts({ dependencies: { react: '^18.0.0' } }) // => false
 */
export function manifestDeclaresReactScripts(manifest: unknown): boolean {
  return manifestDeclaresPackage(manifest, 'react-scripts')
}
