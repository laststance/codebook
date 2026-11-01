import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { passIfMissing } from '../../utils/passIfMissing'

/** The name a saved-session folder has: the sha256 hex of its repository's real path. */
export const SESSION_FOLDER_NAME = /^[0-9a-f]{64}$/

/** What the path proof found. */
export type SessionFolderProof =
  { ok: true; folder: string; exists: boolean } | { ok: false; reason: string }

/**
 * Proves that a saved-session folder is exactly what removal may delete, and what a setup or a run may open: named by a sha256, a real directory (not a link) of this user, whose real path is directly inside the real `sign-in-profiles` folder. The name is proven before anything at the path is looked at. Called by the store for a status, an admission and a setup, and for a removal before it takes the lock, again under it and right before the first deletion; nothing is deleted on a failed proof.
 * Whether the folder's record names the repository of that hash is the record reader's question ({@link readSignInRecord}), not this proof's, so a removal can delete such a folder.
 * @param root - The `sign-in-profiles` folder.
 * @param hash - The folder name to prove.
 * @returns `ok` with the folder (and whether it exists; only an absent entry, `ENOENT`, has nothing to delete) or the refusal reason, which names no path; an entry that cannot be looked at (`EACCES`, `ENOTDIR`, `ELOOP`, `EIO`) is refused, never taken for an absent one.
 * @example
 * await proveSessionFolder('/storage/sign-in-profiles', 'ab12…') // => { ok: true, folder: '/storage/sign-in-profiles/ab12…', exists: true }
 */
export async function proveSessionFolder(
  root: string,
  hash: string,
): Promise<SessionFolderProof> {
  if (!SESSION_FOLDER_NAME.test(hash))
    return { ok: false, reason: 'The folder name is not a session hash.' }
  const folder = join(root, hash)
  // Only absence answers "no folder" (`undefined`); any other failure to look (`null`) proves nothing.
  const entry = await lstat(folder)
    .catch(passIfMissing)
    .catch(() => null)
  if (entry === null) return { ok: false, reason: 'The folder cannot be read.' }
  if (entry === undefined) return { ok: true, folder, exists: false }
  // A link or a file is never followed or deleted as a session.
  if (!entry.isDirectory())
    return { ok: false, reason: 'The entry is not a real folder.' }
  if (process.getuid !== undefined && entry.uid !== process.getuid())
    return { ok: false, reason: 'The folder belongs to another user.' }
  const [realFolder, realRoot] = await Promise.all([
    realpath(folder).catch(() => undefined),
    realpath(root).catch(() => undefined),
  ])
  if (
    realFolder === undefined ||
    realRoot === undefined ||
    dirname(realFolder) !== realRoot ||
    basename(realFolder) !== hash
  )
    return { ok: false, reason: 'The folder is outside the sessions folder.' }
  return { ok: true, folder, exists: true }
}
