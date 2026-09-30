import type { BigIntStats } from 'node:fs'

/** Compares descriptor identity and mutation stamps around repository source acquisition; changed reads never become citations. @example unchangedSource(before, after) // true for unchanged file identity/stamps */
export function unchangedSource(
  before: BigIntStats,
  after: BigIntStats,
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  )
}
