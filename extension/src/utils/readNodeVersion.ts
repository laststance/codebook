import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)

/** The longest `node --version` may take. */
const NODE_VERSION_TIMEOUT_MS = 10_000

/**
 * Reads the version of the Node executable a run uses, for the Node gate of {@link assessViteWorkspace}.
 * @param node - The Node executable path (`Codebook: Node Executable`).
 * @param signal - Ends the read when the run is cancelled.
 * @returns The version text such as `v24.22.1`.
 * @throws When the executable cannot be run.
 * @example
 * await readNodeVersion('/usr/local/bin/node', signal) // => 'v24.22.1'
 */
export async function readNodeVersion(
  node: string,
  signal: AbortSignal,
): Promise<string> {
  const { stdout } = await executeFile(node, ['--version'], {
    signal,
    timeout: NODE_VERSION_TIMEOUT_MS,
  })
  return stdout.trim()
}
