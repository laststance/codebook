import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

/**
 * Hashes a file of any size without holding it in memory.
 *
 * Why: a Wiki may index a lockfile or an image of several hundred kilobytes; its freshness is a comparison of hashes, so the size of a file must not decide whether it can be checked.
 * Trigger: {@link inspectDeepWikiFreshness} calls it for every indexed source on each freshness read.
 *
 * @param filePath - Absolute path of a regular file.
 * @returns The lowercase SHA-256 digest of the file's bytes.
 * @throws The file system's error when the file is missing or is not a regular file.
 *
 * @example
 * ```ts
 * await hashFileSha256('/repo/pnpm-lock.yaml') // => '44512ae0…'
 * ```
 */
export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}
