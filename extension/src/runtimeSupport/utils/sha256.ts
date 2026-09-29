import { createHash } from 'node:crypto';

/** Fingerprints captured bytes when the runner or extension seals evidence. @example sha256('a').length // 64 */
export function sha256(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}
