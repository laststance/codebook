import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '../constants';

/** Excludes other windows during library/recording metadata writes; stale locks remain explicit and never delete history. @example await withStorageLock(directory, () => save()) */
export async function withStorageLock<Value>(directory: string, operation: () => Promise<Value>): Promise<Value> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (!(await lstat(directory)).isDirectory()) throw new Error('Learning storage is not a regular directory.');
  const path = join(directory, 'writer.lock');
  const handle = await open(path, 'wx', PRIVATE_FILE_MODE).catch(error => { if (error.code === 'EEXIST') throw new Error('Learning storage is locked by another writer or an interrupted session. No data changed; retry after resolving the lock.'); throw error; });
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await operation(); }
  finally { await handle.close(); await unlink(path); }
}
