import { DEVIN_BRIDGE_REFUSAL_EXIT_MS } from './constants'
import { runDevinMcpBridge } from './devinMcpBridge'

/**
 * Writes the one refusal line to stderr and ends the process with exit code 1 once the line is written, or after {@link DEVIN_BRIDGE_REFUSAL_EXIT_MS} when a full stderr pipe never calls the write back; called for every refusal path of this entry.
 * A lookup that never answers (a pending `realpath`, descriptor `stat` or read) keeps the event loop alive and cannot be cancelled, so only an explicit exit gives Devin the end of the stdio stream.
 * @param line - The recovery sentence, without a line break and without descriptor contents.
 * @example
 * exitAfterRefusal('Codebook is not running for /repo in this Devin Desktop window. ...')
 */
function exitAfterRefusal(line: string): void {
  process.stderr.write(`${line}\n`, () => process.exit(1))
  // A full stderr pipe never calls the write back; this referenced timer ends the process anyway.
  setTimeout(() => process.exit(1), DEVIN_BRIDGE_REFUSAL_EXIT_MS)
}

const agentDir = process.argv[2]
if (!agentDir)
  exitAfterRefusal(
    'Codebook Devin MCP bridge requires the agent folder of this Codebook installation.',
  )
else
  // Once the connected bridge's cleanup completed after stdin closed (or a removed setup ended it with exit code 1), end the process: a lookup that never settles must not keep it alive.
  void runDevinMcpBridge(agentDir, process.cwd(), process.env, {
    onClosed: () => process.exit(process.exitCode ?? 0),
  }).then(
    (refusal) => {
      // A refusal ends the process; the connected path (no line) keeps serving.
      if (refusal !== undefined) exitAfterRefusal(refusal)
    },
    // Descriptor parse errors may contain credentials, so keep the public recovery message fixed.
    () =>
      exitAfterRefusal(
        'Codebook Devin MCP bridge could not connect. Run Codebook: Set Up AI Chat in this Devin Desktop window.',
      ),
  )
