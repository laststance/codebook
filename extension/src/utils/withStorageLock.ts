import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '../constants'

import { isStaleStorageLock } from './isStaleStorageLock'
import { systemErrorCode } from './systemErrorCode'

const pendingWriters = new Map<string, Promise<void>>()

/** Queues this process's library/recorder writes and excludes other windows; existing foreign locks remain explicit, except one whose writer process is gone from this machine, which is taken over. @example await withStorageLock(directory, () => save()) */
export async function withStorageLock<Value>(
  directory: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  if (!(await lstat(directory)).isDirectory())
    throw new Error('Learning storage is not a regular directory.')
  const canonical = await realpath(directory),
    path = join(canonical, 'writer.lock')
  // Reserve shared process ownership before awaiting the prior writer; path aliases join the same queue.
  const pending = (pendingWriters.get(canonical) ?? Promise.resolve()).then(
    async () => {
      const acquire = () => open(path, 'wx', PRIVATE_FILE_MODE)
      const handle = await acquire()
        .catch(async (error) => {
          // A lock left by a killed editor on this machine is taken over once; a live or foreign one stays explicit.
          if (error.code === 'EEXIST' && (await isStaleStorageLock(path))) {
            await unlink(path).catch(() => undefined)
            return acquire()
          }
          throw error
        })
        .catch((error) => {
          if (error.code === 'EEXIST')
            throw new Error(
              'Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.',
              { cause: error },
            )
          throw error
        })
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, hostname: hostname() }),
        )
        return await operation()
      } finally {
        await handle.close()
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
