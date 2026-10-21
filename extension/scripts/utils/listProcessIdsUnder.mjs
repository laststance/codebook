import { readProcessTable } from './readProcessTable.mjs'

/**
 * Answers the process ids under one or more processes: their children, the children's children, and so on, at the moment the table is read.
 *
 * Why: a test runner, the test files it started and what they started are one tree for the scripts that run tests, and the whole tree has to be ended with the call. Called by {@link trackProcessTree} for every look at a call's tree and by {@link collectTestRun} for the processes under this one.
 * @param rootPids - A process id, or a list of them; the roots themselves are not in the answer (unless one lies under another).
 * @param options.platform - A value of `process.platform`, for {@link readProcessTable}.
 * @param options.table - A table already read by {@link readProcessTable}; read now when it is not given.
 * @returns The process ids under the roots, in the order they were found. Empty when the table cannot be read or no process is under the roots.
 * @example
 * listProcessIdsUnder(child.pid) // => [4301, 4302] (a test file process and a process that one started)
 */
export function listProcessIdsUnder(
  rootPids,
  { platform = process.platform, table = readProcessTable({ platform }) } = {},
) {
  if (table === undefined) return []
  const childrenOf = new Map()
  for (const [pid, parentId] of table)
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), pid])
  const roots = [rootPids].flat()
  const found = []
  const seen = new Set(roots)
  // A breadth-first walk from the roots; `seen` also keeps a table that changed while it was read from looping.
  for (const queue = [...roots]; queue.length > 0;) {
    for (const pid of childrenOf.get(queue.shift()) ?? []) {
      if (seen.has(pid)) continue
      seen.add(pid)
      found.push(pid)
      queue.push(pid)
    }
  }
  return found
}
