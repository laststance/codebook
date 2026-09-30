import { open } from 'node:fs/promises'
import { StudyError } from '../errors'

/** Limits trusted evidence reads before allocating full files; called by resource handlers. @example await readBoundedFile(path, IMAGE_LIMIT_BYTES) */
export async function readBoundedFile(
  path: string,
  limit: number,
): Promise<Buffer> {
  const handle = await open(path, 'r').catch((error) => {
    throw new StudyError(
      'EVIDENCE_UNAVAILABLE',
      'Captured file is unavailable.',
      String(error),
    )
  })
  try {
    const size = (await handle.stat()).size
    if (size > limit)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        `Captured file exceeds ${limit} bytes.`,
      )
    const bytes = Buffer.alloc(Math.min(size, limit) + 1)
    const result = await handle.read(bytes, 0, bytes.length, 0)
    if (result.bytesRead > limit || result.bytesRead !== size)
      throw new StudyError(
        'EVIDENCE_UNAVAILABLE',
        'Captured file changed while reading.',
      )
    return bytes.subarray(0, result.bytesRead)
  } finally {
    await handle.close()
  }
}
