import { mkdtemp } from 'node:fs/promises';

/** Keeps editor IPC sockets within macOS pathname limits; native runners copy required evidence before releasing profiles. @example await createNativeProfile() // '/tmp/codebook-mcp-unique' */
export async function createNativeProfile(): Promise<string> { return mkdtemp('/tmp/codebook-mcp-'); }
