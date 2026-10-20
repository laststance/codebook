import { readdir, readFile } from 'node:fs/promises'

const CYCLE_RECORDS = new URL('../../../../docs/cycles/', import.meta.url)

/**
 * Finds the project's current state: the `## Current state` section of the active cycle record, the one record in `docs/cycles` that holds such a section. No state file exists (owner direction of 2026-10-19), so the status-document and change-history tests read the state here.
 * @returns {Promise<{ holders: string[], highestCycle: string | undefined, cycle: string | undefined, path: string | undefined, state: string, tableName: string | undefined }>} Every record that holds the section (the rule allows exactly one), the highest cycle number among the records, the holder's cycle and its path from the repository root, the section's text from its heading to the next heading of its level, and the file name of the active cycle's carried-defects table when the section links it; `cycle`, `path`, `state` and `tableName` are empty when no record or more than one holds the section. A table of an earlier cycle that the section links is not the active cycle's, and a feature cycle has none (Cycle 0047 row 277).
 * @example
 * const { cycle, path, tableName } = await readCurrentState() // => { cycle: '0047', path: 'docs/cycles/0047-carried-defects-of-cycle-0046.md', tableName: '0047-carried-defects.md', … }
 */
export async function readCurrentState() {
  const names = (await readdir(CYCLE_RECORDS))
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .toSorted()
  const holders = []
  let state = ''
  // Every record is read: a second holder breaks the rule, and the tests must see it.
  for (const name of names) {
    const text = await readFile(new URL(name, CYCLE_RECORDS), 'utf8')
    const start = text.search(/^## Current state$/m)
    if (start === -1) continue
    holders.push(`docs/cycles/${name}`)
    const section = text.slice(start)
    // The section ends at the next heading of its level; `###` headings stay inside it.
    const end = section.slice(1).search(/^## /m)
    state = end === -1 ? section : section.slice(0, end + 1)
  }
  const path = holders.length === 1 ? holders[0] : undefined
  const cycle = path && /\/(\d{4})-/.exec(path)?.[1]
  const section = path ? state : ''
  return {
    holders,
    highestCycle: names.at(-1)?.slice(0, 4),
    cycle,
    path,
    state: section,
    tableName: activeTableNameOf(cycle, section),
  }
}

/**
 * Names the carried-defects table of the active cycle when its current state links it: `<cycle>-carried-defects.md`, the only table whose rows that state counts and names. The state links the records of the two cycles before the active one and may link an earlier cycle's table before its own, and a feature cycle has no table of its own, so the first table the state links is not taken for the active cycle's (Cycle 0047 row 277). Called by {@link readCurrentState}.
 * @param {string | undefined} cycle - The active cycle's number, four digits; undefined when no record or more than one holds the state.
 * @param {string} state - The current state's text.
 * @returns {string | undefined} The table's file name when the state links it by a path relative to its record or from the repository root; undefined otherwise, also when the state links only another cycle's table.
 * @example
 * activeTableNameOf('0047', 'Cycle 0046 left [its tasks](0046-carried-defects.md); [all tasks](0047-carried-defects.md)') // => '0047-carried-defects.md'
 */
export function activeTableNameOf(cycle, state) {
  if (cycle === undefined) return undefined
  // A link names the file after its opening parenthesis, a folder, an angle bracket or a reference's colon, and ends at its closing parenthesis, an anchor, an angle bracket or a title.
  const link = new RegExp(
    `(?:[(/<]|\\]:[ \\t]*)${cycle}-carried-defects\\.md(?=[)#>\\s]|$)`,
    'm',
  )
  return link.test(state) ? `${cycle}-carried-defects.md` : undefined
}
