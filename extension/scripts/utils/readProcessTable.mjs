import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

/** How long `ps` may take to print the process table, and how much it may print: a table is a few hundred kilobytes at most. */
const PS_TIMEOUT_MS = 5_000
const PS_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/**
 * Reads the parent id out of the text of a Linux `/proc/<pid>/stat` file.
 *
 * The second field is the program's name in parentheses and may hold spaces and parentheses itself, so the fields are counted from the last `)`: the state comes first after it, the parent id second.
 * @param statText - The contents of `/proc/<pid>/stat`.
 * @returns The parent's process id, or `undefined` when the text has no such field.
 * @example
 * parentIdOfStat('4242 (node (a)) S 4100 4242 4100 0 -1') // => 4100
 */
function parentIdOfStat(statText) {
  const afterName = statText.slice(statText.lastIndexOf(')') + 1).trim()
  const parentId = Number(afterName.split(' ')[1])
  return Number.isInteger(parentId) ? parentId : undefined
}

/** Reads the table from `/proc`; a process that ends while the table is read is left out. @example readLinuxTable() // => Map { 1 => 0, 4242 => 1 } */
function readLinuxTable() {
  const table = new Map()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const parentId = parentIdOfStat(
        readFileSync(`/proc/${name}/stat`, 'utf8'),
      )
      if (parentId !== undefined) table.set(Number(name), parentId)
    } catch {
      // The process ended between the listing and the read.
    }
  }
  return table
}

/** Reads the table from `ps -A -o pid=,ppid=` (macOS, other POSIX systems); the `ps` that reads it is a child of this process and is left out of the table, so a process with no child of its own has none in the table. @example readPsTable() // => Map { 1 => 0, 4242 => 1 } */
function readPsTable() {
  const answer = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], {
    encoding: 'utf8',
    timeout: PS_TIMEOUT_MS,
    maxBuffer: PS_MAX_BUFFER_BYTES,
  })
  if (answer.status !== 0 || typeof answer.stdout !== 'string') return undefined
  const table = new Map()
  for (const line of answer.stdout.split('\n')) {
    const [pid, parentId] = line.trim().split(/\s+/).map(Number)
    if (Number.isInteger(pid) && Number.isInteger(parentId))
      table.set(pid, parentId)
  }
  // The `ps` that printed the table was running while it read it: it is no process of the caller's tree, and the caller would wait for it or end its pid.
  table.delete(answer.pid)
  return table
}

/**
 * Reads the system's process table as a map from each process id to its parent's id.
 *
 * Why: the scripts that run tests end a call's whole process tree on POSIX, and a tree can only be read from the table; a process loses its parent link when the parent exits, so the tree has to be read before the first signal. Linux reads `/proc/<pid>/stat`; other POSIX systems (macOS) read `ps -A -o pid=,ppid=`; Windows has `taskkill /T /F` for its trees and answers `undefined`.
 * The table never lists the helper that read it: the `ps` of the `ps` path is a child of this process while it runs, and is left out; the `/proc` reader runs in this process and starts no helper.
 * Called by {@link listProcessIdsUnder} and {@link killProcessIds}.
 * @param options.platform - A value of `process.platform`; a test passes `darwin` to take the `ps` path on Linux.
 * @returns The table, or `undefined` when it cannot be read (Windows, no `/proc`, no `ps`, `ps` failing or stopped at its time).
 * @example
 * readProcessTable({ platform: 'linux' })?.get(process.pid) // => process.ppid
 */
export function readProcessTable({ platform = process.platform } = {}) {
  if (platform === 'win32') return undefined
  try {
    return platform === 'linux' ? readLinuxTable() : readPsTable()
  } catch {
    // An unreadable table is no table: the caller ends the child alone, as it did before the table existed.
    return undefined
  }
}
