import { z } from 'zod'

import {
  LISTENER_QUERY_MAX_BYTES,
  LISTENER_QUERY_TIMEOUT_MS,
} from '../constants'

import { listenerToolPath, type ListenerTool } from './listenerToolPath'
import { runBoundedQuery, type BoundedQueryRunner } from './runBoundedQuery'

/** What {@link queryListenerTool} reads with; each is the real one unless a test names its own. */
export type ListenerToolQueryInputs = {
  /** Names the listener tool; {@link listenerToolPath} unless a test names its own. */
  findTool?: () => Promise<ListenerTool | undefined>
  /** Runs the bounded query; {@link runBoundedQuery} unless a test names its own. */
  run?: BoundedQueryRunner
}

/**
 * Runs one query of `lsof` or `ss`, started by its absolute path and bounded by {@link LISTENER_QUERY_TIMEOUT_MS} and {@link LISTENER_QUERY_MAX_BYTES}, and answers what it printed.
 * Why: the node-server run asks the listener tool several different questions (a pid's ports, a connection's server end, a pid's folder); this is the one place that applies the tool rules of {@link readPortListeners}.
 * Called by {@link readListeningPortsOfProcess}, {@link readConnectionServerPid} and {@link readProcessCwd}.
 * @param buildArguments - Builds the arguments for the tool that was found, or `undefined` when that kind of tool cannot answer the question.
 * @param inputs - The tool lookup and the runner ({@link ListenerToolQueryInputs}); the real ones when left out.
 * @returns
 * - `{ kind, stdout }` with what the tool printed (empty for `lsof`'s silent exit 1, its answer "nothing matches")
 * - `undefined` when no tool lies at a system path, the tool cannot answer, or the query failed, ran past its bound or printed too much
 * @example
 * await queryListenerTool((kind) => (kind === 'lsof' ? ['-nP', '-a', '-p', '12', '-d', 'cwd', '-Fn'] : undefined)) // => { kind: 'lsof', stdout: 'p12\nfcwd\nn/work\n' }
 */
export async function queryListenerTool(
  buildArguments: (kind: ListenerTool['kind']) => string[] | undefined,
  inputs: ListenerToolQueryInputs = {},
): Promise<{ kind: ListenerTool['kind']; stdout: string } | undefined> {
  const tool = await (inputs.findTool ?? listenerToolPath)()
  const queryArguments = tool ? buildArguments(tool.kind) : undefined
  if (!tool || !queryArguments) return undefined
  try {
    const { stdout } = await (inputs.run ?? runBoundedQuery)(
      tool.path,
      queryArguments,
      {
        timeout: LISTENER_QUERY_TIMEOUT_MS,
        maxBuffer: LISTENER_QUERY_MAX_BYTES,
        killSignal: 'SIGKILL',
        windowsHide: true,
        env: { LC_ALL: 'C', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      },
    )
    return { kind: tool.kind, stdout }
  } catch (failure) {
    // lsof exits 1 without a word when nothing matches: that is its answer, not a failure.
    if (tool.kind === 'lsof' && isSilentLsofMiss(failure))
      return { kind: tool.kind, stdout: '' }
    return undefined
  }
}

/** The parts of a failed `execFile` that tell `lsof`'s silent miss apart. */
const queryFailureSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).nullish(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
})

/**
 * Recognizes `lsof`'s silent exit 1.
 * @param failure - The rejection of the query.
 * @returns `true` for exit code 1 with nothing printed.
 * @example isSilentLsofMiss(Object.assign(new Error('x'), { code: 1, stdout: '' })) // => true
 */
function isSilentLsofMiss(failure: unknown): boolean {
  const parsed = queryFailureSchema.safeParse(failure)
  return (
    parsed.success &&
    parsed.data.code === 1 &&
    !parsed.data.stdout &&
    !parsed.data.stderr
  )
}
