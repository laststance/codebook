import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface BackendEndpoint { runId: string; pid: number; origin: string; executable: string; version: string }

/** Recovers the owned backend identity for setup or cancelled-launch cleanup, without converting malformed records into absence. @example await readBackendEndpoint(runDirectory, runId) */
export async function readBackendEndpoint(directory: string, runId: string): Promise<BackendEndpoint | undefined> {
  try {
    const endpoint: BackendEndpoint = JSON.parse(await readFile(join(directory, 'backend-endpoint.json'), 'utf8'));
    if (endpoint.runId !== runId || !Number.isInteger(endpoint.pid) || endpoint.pid <= 0 || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.origin) || typeof endpoint.executable !== 'string' || typeof endpoint.version !== 'string') throw new Error('Invalid owned backend endpoint');
    return endpoint;
  } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined; throw error; }
}
