import { lstat, readdir, unlink } from 'node:fs/promises'

/**
 * Lists the takeover claims in the claim folder `<lock>.takeover` only when a real directory stands at its path, and removes whatever else stands there by its own name; called by {@link removeStaleStorageClaims} and by the age sweep of {@link claimWikiUpdateMarker} before either judges a claim.
 *
 * Why: the claim folder of a Wiki update's marker lies in the learner's project folder, where a cloned repository decides what stands at that path. A listing follows a link, so a link there (a junction on Windows) would hand the entries of its target to the sweeps as claims, and the sweeps remove what is nobody's claim: the learner's own files. The path is therefore looked at without following it. A link, a file or any other entry that is no directory is no claim folder and would keep every claim from being placed, so it is unlinked, which removes a link and leaves its target as it is.
 * Limit: the look and the listing are two steps. A path that a running program replaces by a link between them is listed through the link; a repository cannot do that.
 *
 * @param claimDirectory - `<lock>.takeover`, the folder that holds one owner file per placed claim.
 * @returns
 * - A real directory: the names of its entries
 * - Nothing at the path, or a directory that cannot be listed: an empty list
 * - A link, a file or another entry that is no directory: an empty list, after the entry itself was removed (one that cannot be removed stays)
 * @example
 * await listPlacedClaims('/repo/.codebook/wiki.update-run.json.takeover') // => ['4f2c8a1e-…']
 * await listPlacedClaims('/repo/.codebook/a-link-to-the-project')         // => [], and the link is gone
 */
export async function listPlacedClaims(
  claimDirectory: string,
): Promise<string[]> {
  const entry = await lstat(claimDirectory).catch(() => undefined)
  if (!entry) return []
  // Only a directory of its own is listed: its entries are claims, never the files of a link's target.
  if (entry.isDirectory()) return readdir(claimDirectory).catch(() => [])
  await unlink(claimDirectory).catch(() => undefined)
  return []
}
