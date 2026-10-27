import { listenerToolPath, type ListenerToolInputs } from './listenerToolPath'
import { psProgramPath } from './psProgramPath'

/** What {@link nodeServerMachineGaps} looks with: the listener tool's inputs, and where `ps` may lie; each is the real one unless a test names its own. */
export type NodeServerMachineInputs = ListenerToolInputs & {
  psPrograms?: readonly string[]
}

/**
 * Lists what the machine lacks for a node-server run, apart from Node and the repository's own tsx: a supported system, a tool that reads which process listens on a port, and `ps`; each missing item is one sentence that names what to install or why the system cannot run it.
 * Called by the environment's prerequisite check, behind every `codebook_status` and every node-server start.
 * @param inputs - The system and where the programs may lie ({@link NodeServerMachineInputs}); the real ones when left out.
 * @returns The sentences, in this order: the system, the listener tool, `ps`. Empty when the machine can run the profile. Native Windows reads only its own sentence, since neither tool exists there.
 * @example
 * await nodeServerMachineGaps({ platform: 'win32' }) // => ['node-server needs macOS, Linux or WSL; native Windows is not supported yet.']
 * await nodeServerMachineGaps() // => [] on a Mac with /usr/sbin/lsof and /bin/ps
 */
export async function nodeServerMachineGaps(
  inputs: NodeServerMachineInputs = {},
): Promise<string[]> {
  const platform = inputs.platform ?? process.platform
  if (platform === 'win32')
    return [
      'node-server needs macOS, Linux or WSL; native Windows is not supported yet.',
    ]
  const gaps: string[] = []
  if (!(await listenerToolPath(inputs)))
    gaps.push(
      'node-server needs lsof (macOS or Linux, at /usr/sbin/lsof or /usr/bin/lsof) or ss (Linux, at /usr/bin/ss, /bin/ss, /usr/sbin/ss or /sbin/ss) to read which process listens on the declared port. Ask the learner to install one, then call codebook_status again.',
    )
  await psProgramPath('node-server', {
    psPrograms: inputs.psPrograms,
    isProgramFile: inputs.isProgramFile,
  }).catch(() =>
    gaps.push(
      'node-server needs ps at /bin/ps or /usr/bin/ps to check that the listener is the process it started.',
    ),
  )
  return gaps
}
