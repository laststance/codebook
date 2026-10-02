import { atomicPrivateBytes } from './atomicPrivateBytes'

/** Publishes a complete private JSON replacement only after its temporary bytes are flushed. @example await atomicPrivateWrite(path, json, limit) */
export async function atomicPrivateWrite(
  path: string,
  value: unknown,
  limit: number,
): Promise<void> {
  const bytes = JSON.stringify(value)
  if (Buffer.byteLength(bytes) > limit)
    throw new Error(
      `Storage limit exceeded (${limit} bytes); existing data was retained.`,
    )
  await atomicPrivateBytes(path, bytes)
}
