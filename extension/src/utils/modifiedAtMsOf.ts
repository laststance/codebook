import type { BigIntStats } from 'node:fs'

import { NANOSECONDS_PER_MILLISECOND } from '../runtimeSupport/constants'

/**
 * Gives the modification time of a file whose status was read with exact numbers as milliseconds with their fraction, the value `mtimeMs` has for a status read without `bigint`; called by {@link readWikiRegularFile} and {@link readWikiPublicationIdentity}, which read a status exactly for its inode number and still compare and stamp times in milliseconds.
 * @param stats - The file's status; only its modification time in nanoseconds is read.
 * @returns Epoch milliseconds, with the nanoseconds below a millisecond as the fraction.
 * @example
 * modifiedAtMsOf({ mtimeNs: 1_790_000_000_123_456_789n }) // => 1790000000123.4568
 */
export function modifiedAtMsOf(stats: Pick<BigIntStats, 'mtimeNs'>): number {
  const nanosecondsPerMillisecond = BigInt(NANOSECONDS_PER_MILLISECOND)
  // Whole milliseconds and the rest are converted apart: today's date in nanoseconds is more than a number holds exactly.
  return (
    Number(stats.mtimeNs / nanosecondsPerMillisecond) +
    Number(stats.mtimeNs % nanosecondsPerMillisecond) /
      NANOSECONDS_PER_MILLISECOND
  )
}
