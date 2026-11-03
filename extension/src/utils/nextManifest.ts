import { z } from 'zod'

/** The `package.json` fields that say whether a package is a Next app. */
const nextDependencyFieldsSchema = z.looseObject({
  dependencies: z.record(z.string(), z.unknown()).optional(),
  devDependencies: z.record(z.string(), z.unknown()).optional(),
  peerDependencies: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Says whether a parsed `package.json` names `next` in `dependencies`, `devDependencies` or `peerDependencies`.
 *
 * Why it exists: one definition of "this folder is a Next app" serves {@link resolveNextPackage} (E5, the explicit `packageRoot` check), the status discovery ({@link scanNextPackages}) and the root's `rootIsApp`, so status never lists a folder a start would refuse as not a Next app.
 *
 * @param manifest - The parsed JSON value of a `package.json`.
 * @returns `true` when the manifest names `next` in one of the three sections.
 * @example
 * manifestNamesNext({ dependencies: { next: '16.0.1' } }) // => true
 * manifestNamesNext({ scripts: { dev: 'next dev' } }) // => false
 */
export function manifestNamesNext(manifest: unknown): boolean {
  const parsed = nextDependencyFieldsSchema.safeParse(manifest)
  if (!parsed.success) return false
  const { dependencies, devDependencies, peerDependencies } = parsed.data
  return [dependencies, devDependencies, peerDependencies].some(
    (section) => section !== undefined && 'next' in section,
  )
}
