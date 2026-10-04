import { lstat, mkdir, realpath, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { PRIVATE_DIRECTORY_MODE } from '../constants'

import { currentStorageOwner } from './currentStorageOwner'
import { isSameStorageMachine } from './isSameStorageMachine'
import { placeStorageLock } from './placeStorageLock'
import {
  readRecordedOwner,
  type StorageOwnerIdentity,
} from './readRecordedOwner'
import { removeStaleStorageClaims } from './removeStaleStorageClaims'
import { removeStaleStorageLock } from './removeStaleStorageLock'
import { systemErrorCode } from './systemErrorCode'

const pendingWriters = new Map<string, Promise<void>>()

/**
 * Queues this process's library/recorder writes and excludes other windows with the file `writer.lock` in the storage directory; called by every writer of private storage ({@link LearningLibrary}, {@link RecordingStore}, {@link RepositoryBookStore}, the Cursor skill and catalog).
 * The lock names its owner from the moment it exists ({@link placeStorageLock}). A lock that is present stays explicit, except one whose writer is gone from this machine, which is taken over by one window at a time ({@link removeStaleStorageLock}). The holder removes what killed windows left beside the lock ({@link removeStaleStorageClaims}). The release removes the lock only while it still names this process; whatever else is in its place by then belongs to another window and stays.
 * @param directory - The private storage directory; it is created when absent.
 * @param operation - The write to run while the lock is held.
 * @param identity - The machine and the boot this process records in the lock and judges a present lock by; {@link currentStorageOwner} unless a test names its own.
 * @returns What `operation` returned, after the lock is released.
 * @throws
 * - "Learning storage is locked …", naming the lock file, with the `EEXIST` system error as `cause`, while another writer holds the lock or a lock stays that cannot be judged; nothing was written
 * - What `operation` throws, and what removing this process's own lock throws for another reason than a lock that is already gone
 * @example
 * await withStorageLock('/storage/learning', () => save())
 */
export async function withStorageLock<Value>(
  directory: string,
  operation: () => Promise<Value>,
  identity?: StorageOwnerIdentity,
): Promise<Value> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  if (!(await lstat(directory)).isDirectory())
    throw new Error('Learning storage is not a regular directory.')
  const canonical = await realpath(directory),
    path = join(canonical, 'writer.lock')
  // Reserve shared process ownership before awaiting the prior writer; path aliases join the same queue.
  const pending = (pendingWriters.get(canonical) ?? Promise.resolve()).then(
    async () => {
      const holder = {
        pid: process.pid,
        ...(identity ?? (await currentStorageOwner())),
      }
      const acquire = (): Promise<void> => placeStorageLock(path, holder)
      await acquire()
        .catch(async (error) => {
          // A lock left by a killed editor on this machine is taken over once; a live or foreign one, one another window is taking over right now and one whose takeover fails stay explicit.
          if (
            error.code === 'EEXIST' &&
            (await removeStaleStorageLock(path, holder).catch(() => false))
          )
            return acquire()
          throw error
        })
        .catch((error) => {
          if (error.code === 'EEXIST')
            throw new Error(
              `Learning storage is locked by another writer or an interrupted session (lock file: ${path}). No data changed; retry after resolving the lock.`,
              { cause: error },
            )
          throw error
        })
      try {
        // The lock is held: what a window that was killed while it prepared a lock or a takeover left beside it is nobody's and goes.
        await removeStaleStorageClaims(path, holder).catch(() => undefined)
        return await operation()
      } finally {
        const owner = await readRecordedOwner(path)
        // Only a lock that names this process is this call's to remove; one that names another writer, or whose owner cannot be read, is another window's and is left to it.
        if (owner?.pid === holder.pid && isSameStorageMachine(owner, holder))
          // A lock that is already gone is released; only one that stays is a failure.
          await unlink(path).catch((error: unknown) => {
            if (systemErrorCode(error) !== 'ENOENT') throw error
          })
      }
    },
  )
  const settled = pending.then(
    () => undefined,
    () => undefined,
  )
  pendingWriters.set(canonical, settled)
  try {
    return await pending
  } finally {
    if (pendingWriters.get(canonical) === settled)
      pendingWriters.delete(canonical)
  }
}
