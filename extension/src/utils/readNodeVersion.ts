import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { NODE_VERSION_TIMEOUT_MS } from '../constants'

const executeFile = promisify(execFile)

/** The versions read so far, per Node executable path, for the extension host's life. */
const versionsByExecutable = new Map<string, string>()

/**
 * Reads the version of the Node executable a run uses, for the Node gate of {@link assessViteWorkspace} and the readiness of {@link readRepositoryAdapterReadiness}.
 *
 * A successful read is remembered per executable path for the extension host's life, so `codebook_status` does not start a process on every call; a failure is not remembered.
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
  const known = versionsByExecutable.get(node)
  if (known !== undefined) return known
  const { stdout } = await executeFile(node, ['--version'], {
    signal,
    timeout: NODE_VERSION_TIMEOUT_MS,
  })
  const version = stdout.trim()
  versionsByExecutable.set(node, version)
  return version
}
