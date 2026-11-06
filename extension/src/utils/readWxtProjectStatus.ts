import {
  discoverWxtProjects,
  type WxtProjectReport,
} from './discoverWxtProjects'

/** What `codebook_status` reports about WXT under the `chrome-extension` profile: the projects and, only when one is listed, the external Node the build needs. */
export interface WxtProjectStatus {
  wxtProjects: WxtProjectReport[]
  wxtNode?: { nodeVersion: string | null; nodeReady: boolean }
}

/**
 * Builds the WXT part of the `chrome-extension` profile's status: lists the repository's WXT projects and, only when at least one is listed, looks the external Node up.
 * Called by the environment when it reports prerequisites; no WXT config is executed.
 * @param workspace - The absolute repository root.
 * @param resolveNodeVersion - Resolves the external Node's version; rejects when no Node 24 or later is usable.
 * @returns The projects, and `wxtNode` with `nodeVersion` (null when none is usable) and `nodeReady` only when a project is listed.
 * @example await readWxtProjectStatus('/repo', async () => '24.22.1') // => { wxtProjects: [], } when '/repo' holds no WXT config
 */
export async function readWxtProjectStatus(
  workspace: string,
  resolveNodeVersion: () => Promise<string>,
): Promise<WxtProjectStatus> {
  const wxtProjects = await discoverWxtProjects(workspace).catch(() => [])
  // No project, no Node line: a repository without WXT sees nothing new.
  if (wxtProjects.length === 0) return { wxtProjects }
  const nodeVersion = await resolveNodeVersion().catch(() => null)
  return {
    wxtProjects,
    wxtNode: { nodeVersion, nodeReady: nodeVersion !== null },
  }
}
