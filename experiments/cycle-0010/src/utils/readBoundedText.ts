import { createReadStream } from 'node:fs';

/** Bounds mutable source/build reads before hashing for {@link RepositoryRun} and {@link readDevelopmentBundle}; product {@link readBoundedFile} has a separate error contract. @example await readBoundedText(path, SOURCE_LIMIT_BYTES, signal) */
export async function readBoundedText(path: string, limit: number, signal?: AbortSignal): Promise<string> {
  const chunks: Buffer[] = []; let bytes = 0;
  // Reject growth while streaming, before retaining or hashing an oversized replacement.
  for await (const chunk of createReadStream(path, { signal })) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Text exceeds byte limit');
    chunks.push(chunk);
  }
  signal?.throwIfAborted();
  return Buffer.concat(chunks).toString('utf8');
}
