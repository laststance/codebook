/**
 * What the name of a prepared lock adds to the lock's own name, before its unique part: `<lock>.pending-<uuid>`.
 * The writers name what they prepare with it ({@link placeStorageLock}, and the file through which a Wiki update's marker is replaced in {@link claimWikiUpdateMarker}), and the sweeps find what a killed window left by it ({@link removeStaleStorageClaims}, and the sweep by age of {@link claimWikiUpdateMarker}), so both sides name the same files. Windows of earlier versions sweep the same names, so it stays `.pending-`.
 * @example
 * `/storage/learning/writer.lock${PREPARED_LOCK_SUFFIX}${randomUUID()}` // => '/storage/learning/writer.lock.pending-4f2c…'
 */
export const PREPARED_LOCK_SUFFIX = '.pending-'
