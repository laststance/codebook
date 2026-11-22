import { readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { runCursorMcpBridge } from './cursorMcpBridge'
import { connectionSchema } from './utils/connectionSchema'

/** Selected Codebook instance of one Devin Desktop window; carries no credential. */
export interface DevinDescriptorSelection {
  descriptorPath: string
  instanceId: string
  workspace: string
}

/** Polling defaults: Codebook may still be activating when Devin starts the bridge. */
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_INTERVAL_MS = 250

/** Resolves a path to its real path, or keeps it when it cannot be resolved (for example a closed folder). */
async function realOrSame(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/** Reads every connection descriptor of the agent folder without keeping its token. */
async function readCandidates(
  agentDir: string,
): Promise<Array<DevinDescriptorSelection & { pid: unknown }>> {
  let names: string[]
  try {
    names = (await readdir(agentDir)).filter((name) =>
      name.endsWith('.connection.json'),
    )
  } catch {
    return []
  }
  const candidates: Array<DevinDescriptorSelection & { pid: unknown }> = []
  for (const name of names) {
    const descriptorPath = join(agentDir, name)
    try {
      const raw: unknown = JSON.parse(await readFile(descriptorPath, 'utf8'))
      const parsed = connectionSchema.parse(raw)
      candidates.push({
        descriptorPath,
        instanceId: parsed.instanceId,
        workspace: parsed.workspace,
        pid: (raw as { pid?: unknown }).pid,
      })
    } catch {
      // A descriptor being written or from another version is skipped, never reported (it may hold a credential).
    }
  }
  return candidates
}

/** Keeps the descriptors whose workspace has the same real path as `realCwd` and, when known, the extension host's pid. */
async function matchDescriptors(
  agentDir: string,
  realCwd: string,
  extHostPid: number | undefined,
): Promise<DevinDescriptorSelection[]> {
  const matches: DevinDescriptorSelection[] = []
  for (const { pid, ...selection } of await readCandidates(agentDir)) {
    const isSameWorkspace = (await realOrSame(selection.workspace)) === realCwd
    if (isSameWorkspace && (extHostPid === undefined || pid === extHostPid))
      matches.push(selection)
  }
  return matches
}

/**
 * Picks this Devin Desktop window's Codebook instance among the agent folder's descriptors.
 *
 * Called by {@link runDevinMcpBridge} when Devin starts the stdio bridge. A descriptor matches when its
 * workspace has the same real path as `cwd` and its `pid` is the extension host's. Without a known
 * extension host pid, exactly one workspace match is required, so two windows of one folder never mix.
 *
 * @param agentDir - Folder holding `*.connection.json` descriptors.
 * @param cwd - Working folder Devin starts the bridge in.
 * @param extHostPid - Extension host process id, when Devin exports it.
 * @param options - Polling limits; defaults 15 000 ms in total, every 250 ms.
 * @returns The match without its token, or undefined when none appears in time.
 */
export async function selectDevinDescriptor(
  agentDir: string,
  cwd: string,
  extHostPid: number | undefined,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<DevinDescriptorSelection | undefined> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS,
    deadline = Date.now() + timeoutMs,
    realCwd = await realOrSame(cwd)
  for (;;) {
    const matches = await matchDescriptors(agentDir, realCwd, extHostPid)
    // Unknown extension host pid: only an unambiguous workspace match is safe.
    if (
      matches.length === 1 ||
      (extHostPid !== undefined && matches.length > 1)
    )
      return matches[0]
    if (Date.now() >= deadline) return undefined
    await sleep(intervalMs)
  }
}

/**
 * Bridges Devin Desktop's stdio MCP transport to this window's Codebook instance.
 *
 * Started by the bridge entry file from the `mcp_config.json` entry Set Up AI Chat writes.
 *
 * @param agentDir - Folder holding the window instances' connection descriptors.
 * @param cwd - Working folder of the bridge process; the window's workspace.
 * @param env - Environment; `WINDSURF_EXT_HOST_PID` names the extension host when set.
 * @param options - Polling limits of {@link selectDevinDescriptor}; tests shorten them.
 * @throws Errors of {@link runCursorMcpBridge}, such as an unreadable descriptor.
 */
export async function runDevinMcpBridge(
  agentDir: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const pid = Number(env.WINDSURF_EXT_HOST_PID)
  const selection = await selectDevinDescriptor(
    agentDir,
    cwd,
    env.WINDSURF_EXT_HOST_PID && Number.isFinite(pid) ? pid : undefined,
    options,
  )
  // No match: one fixed recovery line, no descriptor contents.
  if (!selection) {
    process.stderr.write(
      `Codebook is not running for ${cwd} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.\n`,
    )
    process.exitCode = 1
    return
  }
  process.stderr.write(
    `Codebook bridge: instance ${selection.instanceId}, workspace ${selection.workspace}\n`,
  )
  await runCursorMcpBridge(selection.descriptorPath)
}
