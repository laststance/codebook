import { FIRST_SETUP_HASH_PREFIX } from '../constants'

/**
 * Gives the entry hash a Devin Desktop pending record holds without the {@link FIRST_SETUP_HASH_PREFIX} a first setup puts before it, so the record can be compared with the entry that stands and its receipt gets the plain hash; called where the Devin config module ({@link writeManagedDevinMcpEntry}, {@link refreshManagedDevinMcpEntry}) compares a record's hash with an entry.
 * @param entrySha256 - The record's `entrySha256`, plain or prefixed; undefined for a record without one (a removal's).
 * @returns
 * - A prefixed hash: the hash after the prefix
 * - A plain hash: the same hash
 * - Undefined: undefined
 * @example
 * plainEntryHashOf('first-setup:9f86d081') // => '9f86d081'
 * plainEntryHashOf('9f86d081')             // => '9f86d081'
 */
export function plainEntryHashOf(entrySha256: string): string
export function plainEntryHashOf(
  entrySha256: string | undefined,
): string | undefined
export function plainEntryHashOf(
  entrySha256: string | undefined,
): string | undefined {
  // Only a first setup's record carries the prefix; every other hash is already plain.
  return entrySha256?.startsWith(FIRST_SETUP_HASH_PREFIX)
    ? entrySha256.slice(FIRST_SETUP_HASH_PREFIX.length)
    : entrySha256
}
