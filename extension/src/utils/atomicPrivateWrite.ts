import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { PRIVATE_FILE_MODE } from '../constants';

/** Publishes a complete private JSON replacement only after its temporary bytes are flushed. @example await atomicPrivateWrite(path, json, limit) */
export async function atomicPrivateWrite(path: string, value: unknown, limit: number): Promise<void> {
  const bytes = JSON.stringify(value);
  if (Buffer.byteLength(bytes) > limit) throw new Error(`Storage limit exceeded (${limit} bytes); existing data was retained.`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
