import type { Stats } from 'node:fs'

/**
 * Words the refusal for what stands where a folder of Codebook's private storage should be; called by {@link withStorageLock} for a storage directory and by {@link RecordingStore} for a root of its recordings. Codebook writes through no link and replaces nothing that stands at such a path, and no retry of its own can change what stands there: so the sentence names the path, which lies in the editor's storage and is shown nowhere else, and what to do there. The caller's command is not known, so each step ends with trying again.
 * @param subject - What the folder is, as the sentence begins: "Learning storage" or "Recording root".
 * @param path - The folder's path.
 * @param standing - What stands at the path, looked at without following a link; the caller found that it is no real folder.
 * @returns The sentence for a link, and the one for anything else that is no folder.
 * @example
 * describeNoStorageFolder('Recording root', '/storage/learning/recordings.v3', await lstat('/storage/learning/recordings.v3'))
 * // => "Recording root is not a regular directory: /storage/learning/recordings.v3. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again."
 */
export function describeNoStorageFolder(
  subject: string,
  path: string,
  standing: Pick<Stats, 'isSymbolicLink'>,
): string {
  // A link is told first: looked at without following, it is never a folder.
  return standing.isSymbolicLink()
    ? `${subject} is not a regular directory: ${path}. That path is a link, and Codebook writes through no link. Put the folder it points to in the link's place, or remove the link (Codebook then makes an empty folder there), then try again.`
    : `${subject} is not a regular directory: ${path}. What stands at that path is not a folder. Rename it or move it elsewhere, then try again.`
}
