import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { ACTIVE_TIMEOUT_MS, PROCESS_QUERY_LIMIT_BYTES } from '../constants';

/** Observes the exact run-specific Node program after acquisition settles, including cancellation before endpoint publication. @example await backendProcesses('/run/build/server.mjs') */
export async function backendProcesses(program: string): Promise<number[]> {
  const candidates = [program, await realpath(program)];
  const { stdout } = await promisify(execFile)('ps', ['-axww', '-o', 'pid=,command='], { timeout: ACTIVE_TIMEOUT_MS, maxBuffer: PROCESS_QUERY_LIMIT_BYTES });
  // Inspect only this fixture's unique script argument; prefix-sharing paths do not identify its process.
  return stdout.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) return [];
    const command = ` ${match[2]} `;
    return candidates.some(candidate => command.includes(` ${candidate} `)) ? [Number(match[1])] : [];
  });
}
