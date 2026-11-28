import type * as DevinMcpBridgeModule from '../../devinMcpBridge'
import { runDevinMcpBridge } from '../../devinMcpBridge'

/**
 * Runs the bridge in this process and returns the stderr lines the bridge entry would show and the exit code it would end with.
 * The bridge returns its refusal line instead of writing it, so the line is added to what the bridge itself wrote (the connected line), and the exit code is 1 exactly when the bridge refused.
 */
export async function runCapturingStderr(
  agentDir: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  options: Pick<
    DevinMcpBridgeModule.DevinSelectOptions,
    'timeoutMs' | 'intervalMs' | 'onClosed'
  >,
) {
  const lines: string[] = [],
    originalWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk: string) => {
    lines.push(chunk)
    return true
  }
  let refusal: string | undefined
  try {
    refusal = await runDevinMcpBridge(agentDir, workspace, env, options)
  } finally {
    process.stderr.write = originalWrite
  }
  if (refusal !== undefined) lines.push(`${refusal}\n`)
  const exitCode: number | undefined = refusal === undefined ? undefined : 1
  return { lines, exitCode }
}
