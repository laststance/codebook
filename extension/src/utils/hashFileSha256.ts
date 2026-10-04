import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

/**
 * Hashes a regular file of any size without holding it in memory, and refuses anything that is not a regular file before it reads a byte.
 *
 * Why: a Wiki may index a lockfile or an image of several hundred kilobytes; its freshness is a comparison of hashes, so the size of a file must not decide whether it can be checked. The check runs before an update's timeout and cancel exist, so a named pipe or a link in place of the file must not hold it.
 * Trigger: {@link inspectDeepWikiFreshness} calls it for every indexed source on each freshness read, and {@link findWikiUpdateStartBlock} for every generated file of a published Wiki.
 *
 * @param filePath - Absolute path of a regular file; a caller that accepts links resolves them first.
 * @returns The lowercase SHA-256 digest of the file's bytes.
 * @throws The file system's error when the file is missing (`ENOENT`) or its last path component is a link (`ELOOP`); an error with the code `ENOTREG` when it is a pipe, a device or a folder.
 *
 * @example
 * ```ts
 * await hashFileSha256('/repo/pnpm-lock.yaml') // => '44512ae0…'
 * await hashFileSha256('/repo/a-named-pipe')   // rejects at once with code 'ENOTREG'
 * ```
 */
export async function hashFileSha256(filePath: string): Promise<string> {
  // Without O_NONBLOCK the open itself waits for the writer of a named pipe.
  const file = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    if (!(await file.stat()).isFile())
      throw Object.assign(new Error(`Not a regular file: ${filePath}`), {
        code: 'ENOTREG',
      })
    const hash = createHash('sha256')
    await pipeline(file.createReadStream({ autoClose: false }), hash)
    return hash.digest('hex')
  } finally {
    await file.close()
  }
}
