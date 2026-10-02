/**
 * Says whether the study library admits another study: a valid limit with fewer saved studies than it; called by {@link StudyWorkspace} after a removal to decide whether a refused run can be started again.
 * @param usage - The library's count and its limit; the limit is absent while the setting is invalid.
 * @returns Whether a new study would be admitted now.
 * @example
 * libraryHasRoom({ count: 63, limit: 64 }) // => true
 * libraryHasRoom({ count: 64, limit: 64 }) // => false
 * libraryHasRoom({ count: 3 })             // => false
 */
export function libraryHasRoom(usage: {
  count: number
  limit?: number
}): boolean {
  return usage.limit !== undefined && usage.count < usage.limit
}
