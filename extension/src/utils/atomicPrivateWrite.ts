import { atomicPrivateBytes } from './atomicPrivateBytes'

/** Publishes a complete private JSON replacement only after its temporary bytes are flushed; `beforePublish` may throw to cancel the publication ({@link atomicPrivateBytes}). @example await atomicPrivateWrite(path, json, limit) */
export async function atomicPrivateWrite(
  path: string,
  value: unknown,
  limit: number,
  beforePublish?: () => void,
): Promise<void> {
  const bytes = JSON.stringify(value)
  if (Buffer.byteLength(bytes) > limit)
    throw new Error(
      `Storage limit exceeded (${limit} bytes); existing data was retained.`,
    )
  await atomicPrivateBytes(path, bytes, beforePublish)
}
