import { runDevinMcpBridge } from './devinMcpBridge'

/**
 * Writes the one refusal line to stderr and ends the process with exit code 1 once the line is written; called for every refusal path of this entry.
 * A lookup that never answers (a pending `realpath`, descriptor `stat` or read) keeps the event loop alive and cannot be cancelled, so only an explicit exit gives Devin the end of the stdio stream.
 * @param line - The recovery sentence, without a line break and without descriptor contents.
 * @example
 * exitAfterRefusal('Codebook is not running for /repo in this Devin Desktop window. ...')
 */
function exitAfterRefusal(line: string): void {
  process.stderr.write(`${line}\n`, () => process.exit(1))
}

const agentDir = process.argv[2]
if (!agentDir)
  exitAfterRefusal(
    'Codebook Devin MCP bridge requires the agent folder of this Codebook installation.',
  )
else
  void runDevinMcpBridge(agentDir).then(
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
