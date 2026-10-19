import { isProgramFile } from './isProgramFile'

/** Where `ps` lies on macOS and Linux: `/bin/ps`, and `/usr/bin/ps` on a system whose `/bin` has none. It is started by one of these absolute paths, never looked up in the search path or the current folder. */
const PS_PROGRAMS = ['/bin/ps', '/usr/bin/ps']

/** What {@link psProgramPath} looks with; each is the real one unless a test names its own. */
type PsProgramInputs = {
  /** Where `ps` may lie, tried in this order; {@link PS_PROGRAMS} unless a test names a stand-in of its own. */
  psPrograms?: readonly string[]
  /** Says whether a path is a program file this user may run; {@link isProgramFile} unless a test names its own. */
  isProgramFile?: (path: string) => Promise<boolean>
}

/**
 * Names the `ps` a query of macOS or Linux starts, by an absolute path, so that no `ps` of the search path or of the current folder runs in its place: with an empty or relative entry in `PATH` and the learner's opened project as the editor's current folder, a cloned repository's own `ps` would answer a check Codebook bases an ownership decision on.
 * Called by {@link listProcesses} for the process listing, and by {@link verifyServerInspectorOwnership} and {@link verifyNodeTestInspectorOwnership} for the process group of an inspector's process.
 * @param queryName - The query that needs `ps`, as the refusal names it ("The process listing").
 * @param inputs - Where `ps` may lie and the check of its file ({@link PsProgramInputs}); the real ones when left out.
 * @returns The first path of {@link PS_PROGRAMS} that holds a program this user may run.
 * @throws When no path holds one: the query is refused then and no program is started, since a `ps` searched for in other folders could be another program of that name.
 * @example
 * await psProgramPath('The process listing') // => '/bin/ps'
 * await psProgramPath('The process listing', { isProgramFile: async () => false }) // throws: The process listing was not started: no ps lies at /bin/ps or /usr/bin/ps, and Codebook starts it only from there.
 */
export async function psProgramPath(
  queryName: string,
  inputs: PsProgramInputs = {},
): Promise<string> {
  const programs = inputs.psPrograms ?? PS_PROGRAMS
  const isProgram = inputs.isProgramFile ?? isProgramFile
  // The first absolute path that holds a program is the one started; no other folder is looked in.
  for (const candidate of programs)
    if (await isProgram(candidate)) return candidate
  throw new Error(
    `${queryName} was not started: no ps lies at ${programs.join(' or ')}, and Codebook starts it only from there.`,
  )
}
