import { isProgramFile } from './isProgramFile'

/** Where `lsof` lies on macOS and Linux. It is started by one of these absolute paths, never looked up in the search path or the current folder. */
const LSOF_PROGRAMS = ['/usr/sbin/lsof', '/usr/bin/lsof']
/** Where iproute2's `ss` lies on Linux. On macOS no `ss` is used: Homebrew's `ss` there is iproute2mac, a script with other output. */
const SS_PROGRAMS = ['/usr/bin/ss', '/bin/ss', '/usr/sbin/ss', '/sbin/ss']

/** The program that lists a port's listening sockets, and which of the two it is (their output differs). */
export type ListenerTool = { kind: 'lsof' | 'ss'; path: string }

/** What {@link listenerToolPath} looks with; each is the real one unless a test names its own. */
export type ListenerToolInputs = {
  /** The system the editor runs on; `process.platform` unless a test names another. */
  platform?: NodeJS.Platform
  /** Where `lsof` may lie, tried in this order; {@link LSOF_PROGRAMS} unless a test names its own. */
  lsofPrograms?: readonly string[]
  /** Where `ss` may lie on Linux, tried in this order; {@link SS_PROGRAMS} unless a test names its own. */
  ssPrograms?: readonly string[]
  /** Says whether a path is a program file this user may run; {@link isProgramFile} unless a test names its own. */
  isProgramFile?: (path: string) => Promise<boolean>
}

/**
 * Names the program a node-server run asks which processes listen on a port, by an absolute path, so that no `lsof` or `ss` of the search path or of the opened repository answers an ownership decision in its place.
 * `lsof` is preferred on every system for its one output form; on Linux without it, iproute2's `ss`. Native Windows has neither.
 * Called by {@link readPortListeners} before each query, and by the node-server status to say whether a listener tool is available.
 * @param inputs - The system and where the programs may lie ({@link ListenerToolInputs}); the real ones when left out.
 * @returns
 * - `{ kind: 'lsof', path }` for the first of `/usr/sbin/lsof`, `/usr/bin/lsof` that holds a program this user may run
 * - `{ kind: 'ss', path }` on Linux without `lsof`, for the first of `/usr/bin/ss`, `/bin/ss`, `/usr/sbin/ss`, `/sbin/ss`
 * - `undefined` when neither lies there (the port's owner cannot be read)
 * @example
 * await listenerToolPath()                                                       // => { kind: 'lsof', path: '/usr/sbin/lsof' } on macOS
 * await listenerToolPath({ platform: 'linux', lsofPrograms: [] })                // => { kind: 'ss', path: '/usr/bin/ss' }
 * await listenerToolPath({ platform: 'darwin', isProgramFile: async () => false }) // => undefined
 */
export async function listenerToolPath(
  inputs: ListenerToolInputs = {},
): Promise<ListenerTool | undefined> {
  const platform = inputs.platform ?? process.platform
  const isProgram = inputs.isProgramFile ?? isProgramFile
  if (platform === 'win32') return undefined
  // The first absolute path that holds a program is the one started; no other folder is looked in.
  for (const candidate of inputs.lsofPrograms ?? LSOF_PROGRAMS)
    if (await isProgram(candidate)) return { kind: 'lsof', path: candidate }
  if (platform !== 'linux') return undefined
  for (const candidate of inputs.ssPrograms ?? SS_PROGRAMS)
    if (await isProgram(candidate)) return { kind: 'ss', path: candidate }
  return undefined
}
