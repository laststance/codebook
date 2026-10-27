import {
  NODE_SERVER_PROCESS_QUERY_MAX_BYTES,
  NODE_SERVER_PROCESS_QUERY_TIMEOUT_MS,
} from '../constants'

import { psProgramPath } from './psProgramPath'
import { runBoundedQuery, type BoundedQueryRunner } from './runBoundedQuery'

/** What {@link readProcessPsField} reads with; each is the real one unless a test names its own. */
export type ProcessPsFieldInputs = {
  /** Names the `ps` program; {@link psProgramPath} unless a test names its own. */
  findPs?: () => Promise<string>
  /** Runs the bounded query; {@link runBoundedQuery} unless a test names its own. */
  run?: BoundedQueryRunner
}

/**
 * Asks `ps` (by its absolute path, bounded by {@link NODE_SERVER_PROCESS_QUERY_TIMEOUT_MS}) for one field of one process.
 * Called by {@link verifyListenerOwnership} for a listener's process group (`pgid`) and its command (`comm`).
 * @param pid - The process id.
 * @param field - `pgid` for the process group, `comm` for the command.
 * @param inputs - The `ps` lookup and the runner ({@link ProcessPsFieldInputs}).
 * @returns The field's text, trimmed; `undefined` when the process does not exist or `ps` cannot answer.
 * @example
 * await readProcessPsField(48633, 'pgid') // => '48633'
 */
export async function readProcessPsField(
  pid: number,
  field: 'pgid' | 'comm',
  inputs: ProcessPsFieldInputs = {},
): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  try {
    const ps = await (
      inputs.findPs ?? (() => psProgramPath('The process query'))
    )()
    const { stdout } = await (inputs.run ?? runBoundedQuery)(
      ps,
      ['-o', `${field}=`, '-p', String(pid)],
      {
        timeout: NODE_SERVER_PROCESS_QUERY_TIMEOUT_MS,
        maxBuffer: NODE_SERVER_PROCESS_QUERY_MAX_BYTES,
        killSignal: 'SIGKILL',
        windowsHide: true,
        env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
      },
    )
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}
