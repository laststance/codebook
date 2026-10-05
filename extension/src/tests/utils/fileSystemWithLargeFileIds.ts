import type { BigIntStats, StatOptions, Stats } from 'node:fs'
import * as fileSystem from 'node:fs/promises'

/**
 * The file id the NTFS volume of the development host answered for one file of its temporary folder (`fsutil file queryfileid`: `0x02ED000000026075`, sequence number 749 above record number 155765). It is more than 2^53: a JavaScript number rounds it, and each of the 26 ids after it, to 210824757556437120.
 */
const FIRST_LARGE_FILE_ID = 210_824_757_556_437_109n

/**
 * Builds a `node:fs/promises` whose files have ids above 2^53, as files of an NTFS volume can: the first file a status is asked for gets {@link FIRST_LARGE_FILE_ID}, the second the id after it, and so on, and one file keeps its id for every later status (by path or by open file). A status read with `{ bigint: true }` holds the exact id; one read without holds the rounded number, as Node.js answers it.
 * A test hands the result to {@link loadModule} for `node:fs/promises`, and asks it for a file's id (`(await largeIds.lstat(path, { bigint: true })).ino`).
 * @returns The module; everything but `lstat`, `stat` and the `stat` of a file from `open` is the real file system.
 * @example
 * const largeIds = fileSystemWithLargeFileIds()
 * const deployment = await loadModule<typeof CursorSkillModule>(path, { 'node:fs/promises': largeIds })
 */
export function fileSystemWithLargeFileIds(): typeof fileSystem {
  const largeIdsByFile = new Map<string, bigint>()
  /** Replaces the inode number of a status by the large id of its file. */
  const renumber = (stats: Stats | BigIntStats): void => {
    const file = `${stats.dev}:${stats.ino}`
    const largeId =
      largeIdsByFile.get(file) ??
      FIRST_LARGE_FILE_ID + BigInt(largeIdsByFile.size)
    largeIdsByFile.set(file, largeId)
    // Only a status read with exact numbers has nanoseconds.
    if ('mtimeNs' in stats) stats.ino = largeId
    else stats.ino = Number(largeId)
  }
  return {
    ...fileSystem,
    lstat: (async (path: string, options?: StatOptions) => {
      const stats = await fileSystem.lstat(path, options)
      renumber(stats)
      return stats
    }) as typeof fileSystem.lstat,
    stat: (async (path: string, options?: StatOptions) => {
      const stats = await fileSystem.stat(path, options)
      renumber(stats)
      return stats
    }) as typeof fileSystem.stat,
    open: async (...openArguments: Parameters<typeof fileSystem.open>) => {
      const file = await fileSystem.open(...openArguments)
      const statOfOpenedFile = file.stat.bind(file)
      file.stat = (async (options?: StatOptions) => {
        const stats = await statOfOpenedFile(options)
        renumber(stats)
        return stats
      }) as typeof file.stat
      return file
    },
  }
}
