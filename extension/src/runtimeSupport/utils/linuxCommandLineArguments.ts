import { readFile } from 'node:fs/promises'

/**
 * Reads the exact arguments of a Linux process from `/proc/<pid>/cmdline`, where the kernel keeps them separated by NUL bytes; called by {@link profileProcesses} on Linux for a listed process whose command line names a profile switch, so that the profile is matched argument by argument instead of by the text `ps` printed, which cannot tell a `--` argument from two dashes inside one.
 * @param pid - The process id the listing gave.
 * @param read - Reads a file's bytes; `fs.readFile` unless a test names its own.
 * @returns The arguments, the program first; `undefined` when the file cannot be read (the process ended, or this user may not read it).
 * @example
 * await linuxCommandLineArguments(4242) // => ['/opt/google/chrome/chrome', '--user-data-dir=/tmp/codebook-browser-a1b2c3', '--', 'https://example.test']
 */
export async function linuxCommandLineArguments(
  pid: number,
  read: (path: string) => Promise<Uint8Array> = readFile,
): Promise<string[] | undefined> {
  const bytes = await read(`/proc/${pid}/cmdline`).catch(() => undefined)
  if (!bytes) return undefined
  const commandArguments = Buffer.from(bytes).toString('utf8').split('\0')
  // The kernel ends the last argument with a NUL too; that gives no argument.
  if (commandArguments.at(-1) === '') commandArguments.pop()
  return commandArguments
}
