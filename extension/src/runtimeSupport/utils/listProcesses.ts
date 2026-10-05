import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** One running process as `ps` names it: its id and its whole command line with every argument. */
export type ListedProcess = { pid: number; command: string }

/**
 * Lists every process of this machine with its whole command line, by one `ps -axww`; called by {@link profileProcesses} for one profile and once per sweep by {@link removeAbandonedProfiles}, which matches every candidate folder against the same listing.
 * @returns Every process line `ps` printed, in its order; a line that names no process id is left out.
 * @throws What running `ps` throws, for example on a machine without it.
 * @example
 * await listProcesses() // => [{ pid: 1, command: '/sbin/launchd' }, { pid: 4242, command: '/Applications/Google Chrome --user-data-dir=/tmp/codebook-browser-a1b2c3' }, …]
 */
export async function listProcesses(): Promise<ListedProcess[]> {
  const { stdout } = await promisify(execFile)('ps', [
    '-axww',
    '-o',
    'pid=,command=',
  ])
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!match?.[1] || !match[2]) return []
    return [{ pid: Number(match[1]), command: match[2] }]
  })
}
