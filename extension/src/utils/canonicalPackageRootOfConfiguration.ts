import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * Gives the configuration whose `packageRoot` is the canonical repository-relative real path, for the start's idempotency key (E10).
 *
 * Why it exists: a symlinked alias inside the repository and its target are one app, so a retry that declares the alias under the same key must not be an `IDEMPOTENCY_CONFLICT`, and the alias and the target are the same configuration. A folder that resolves to the repository root drops the field like `"."`. A value that cannot be resolved (missing, outside the repository) is left as declared: the run refuses it later with its own reason.
 * Called by {@link StudyService.start} on the parsed configuration of a `repository-browser` start; it is a signature input only, the run keeps the declared value (the evidence journal records it).
 *
 * @param configuration - The start's configuration, with `"."` already dropped.
 * @param workspace - The opened repository's root.
 * @returns The same configuration with `packageRoot` replaced by the canonical path, or without it when it names the root; the input itself when it has no `packageRoot` or it cannot be resolved inside the repository.
 * @example
 * canonicalPackageRootOfConfiguration({ version: 3, packageRoot: 'link-to-web' }, '/repo') // => { version: 3, packageRoot: 'apps/web' } when link-to-web is a link to apps/web
 */
export function canonicalPackageRootOfConfiguration(
  configuration: object,
  workspace: string,
): object {
  if (!('packageRoot' in configuration)) return configuration
  const { packageRoot, ...rest } = configuration
  if (typeof packageRoot !== 'string') return configuration
  try {
    const repository = realpathSync(workspace)
    const real = realpathSync(resolve(repository, packageRoot))
    const path = relative(repository, real)
    // Outside the repository: leave the value for the run's own refusal.
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
      return configuration
    return path === ''
      ? rest
      : { ...rest, packageRoot: path.split(sep).join('/') }
  } catch {
    return configuration
  }
}
