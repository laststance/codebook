import { readdir, readFile } from 'node:fs/promises'

const CYCLE_RECORDS = new URL('../../../../docs/cycles/', import.meta.url)

/**
 * Finds the project's current state: the `## Current state` section of the active cycle record, the one record in `docs/cycles` that holds such a section. No state file exists (owner direction of 2026-10-19), so the status-document and change-history tests read the state here.
 * @returns {Promise<{ holders: string[], highestCycle: string | undefined, cycle: string | undefined, path: string | undefined, state: string }>} Every record that holds the section (the rule allows exactly one), the highest cycle number among the records, the holder's cycle and its path from the repository root, and the section's text from its heading to the next heading of its level; `cycle`, `path` and `state` are empty when no record or more than one holds the section.
 * @example
 * const { cycle, path } = await readCurrentState() // => { cycle: '0047', path: 'docs/cycles/0047-carried-defects-of-cycle-0046.md', … }
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
  return {
    holders,
    highestCycle: names.at(-1)?.slice(0, 4),
    cycle: path && /\/(\d{4})-/.exec(path)?.[1],
    path,
    state: path ? state : '',
  }
}
