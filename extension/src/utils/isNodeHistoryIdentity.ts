/** The name of a history's folder: its study id, two UUIDs joined by an underscore. Any other entry of a history directory (a `.DS_Store`, a stray folder) is nobody's history. */
const NODE_HISTORY_IDENTITY = /^[0-9a-f-]{36}_[0-9a-f-]{36}$/

/**
 * Tells whether a string is shaped like a node history's study id; the one validator behind every history folder path, for test and server histories alike.
 * Called by the stores before they build a path, and by the history repository before it resolves an id.
 * @param studyId - Any string an agent or a listing produced.
 * @returns `true` for `<instance uuid>_<run uuid>` in lowercase hexadecimal form.
 * @example isNodeHistoryIdentity('../x') // => false
 */
export function isNodeHistoryIdentity(studyId: string): boolean {
  return NODE_HISTORY_IDENTITY.test(studyId)
}
