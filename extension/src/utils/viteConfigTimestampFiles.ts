import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** The transient files Vite writes beside the config while it bundles it: `vite.config.ts.timestamp-<ms>-<hash>.mjs`. */
const TIMESTAMP_FILE = /^vite\.config\..+\.timestamp-.+\.mjs$/

/**
 * Lists the transient Vite config files in the package root, for the snapshot taken at launch.
 * @param workspace - The package root.
 * @returns The names present now.
 * @example
 * await listViteTimestampFiles('/repo') // => Set { 'vite.config.ts.timestamp-1-a.mjs' }
 */
export async function listViteTimestampFiles(
  workspace: string,
): Promise<Set<string>> {
  const names = await readdir(workspace).catch(() => [])
  return new Set(names.filter((name) => TIMESTAMP_FILE.test(name)))
}

/**
 * Removes transient Vite config files that were absent before the launch, after the launcher is gone: a forced kill leaves them behind, and Vite removes them itself on a clean exit.
 * Only names matching the pattern and absent from the snapshot are removed; nothing else.
 * @param workspace - The package root.
 * @param before - The snapshot from {@link listViteTimestampFiles}.
 * @example
 * await removeNewViteTimestampFiles('/repo', before)
 */
export async function removeNewViteTimestampFiles(
  workspace: string,
  before: ReadonlySet<string>,
): Promise<void> {
  for (const name of await listViteTimestampFiles(workspace))
    if (!before.has(name)) await rm(join(workspace, name), { force: true })
}
