import { readlink, realpath } from 'node:fs/promises'

import {
  queryListenerTool,
  type ListenerToolQueryInputs,
} from './queryListenerTool'

/** What {@link readProcessCwd} reads with; each is the real one unless a test names its own. */
export type ProcessCwdInputs = ListenerToolQueryInputs & {
  /** The system; `process.platform` unless a test names another. */
  platform?: NodeJS.Platform
  /** Reads a symbolic link (Linux `/proc/<pid>/cwd`); `fs.readlink` unless a test names its own. */
  readLink?: (path: string) => Promise<string>
}

/**
 * Reads the working folder of a process, as its realpath, so that an orphan record is matched to the process it was written for and not to another process that got the id.
 * Linux reads `/proc/<pid>/cwd`; macOS asks `lsof -a -d cwd` at its system path. Called by the orphan sweep {@link reapNodeServerOrphans}.
 * @param pid - The process id a record names.
 * @param inputs - The system, the link reader and the listener-tool inputs ({@link ProcessCwdInputs}).
 * @returns The folder's realpath, or `undefined` when it cannot be read (no such process, no tool, another user's process, Windows).
 * @example
 * await readProcessCwd(48633) // => '/work/switch-time'
 */
export async function readProcessCwd(
  pid: number,
  inputs: ProcessCwdInputs = {},
): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  const platform = inputs.platform ?? process.platform
  let folder: string | undefined
  if (platform === 'linux') {
    folder = await (inputs.readLink ?? readlink)(`/proc/${pid}/cwd`).catch(
      () => undefined,
    )
  } else if (platform === 'darwin') {
    const answer = await queryListenerTool(
      (kind) =>
        kind === 'lsof'
          ? ['-nP', '-a', '-p', String(pid), '-d', 'cwd', '-Fn']
          : undefined,
      inputs,
    )
    folder = answer?.stdout
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1)
  }
  if (!folder) return undefined
  // A record holds a realpath; the read is normalized the same way.
  return realpath(folder).catch(() => folder)
}
