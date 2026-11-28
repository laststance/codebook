import { IDS } from './IDS'

/** The instance id of descriptor `index`: one of {@link IDS}, or a numbered id for the tests that need many. */
export function instanceIdOf(index: number): string {
  return (
    IDS[index] ??
    `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, 'a')}`
  )
}
