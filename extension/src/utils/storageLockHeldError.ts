/**
 * The refusal of {@link withStorageLock} while another writer holds the storage lock, or a lock stays that cannot be judged; nothing was written then.
 * A caller that waits for another window's write ({@link verifyManagedCursorSkill}'s reconnect, the Cursor MCP catalog's retries) tells it from every other failure by this type, never by an `EEXIST` under the error: a refusal of the write itself can carry an `EEXIST` of its own (a file that took the skill's path before its link), and waiting does not help it. The `cause` stays the lock file's `EEXIST`, and the name stays `Error`, so `String(error)` reads as before.
 * @example
 * try {
 *   await withStorageLock('/storage/cursor-skill', update)
 * } catch (error) {
 *   error instanceof StorageLockHeldError // => true while another window writes
 * }
 */
export class StorageLockHeldError extends Error {}
