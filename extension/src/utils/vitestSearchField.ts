import type { NodeTestVitestSearch } from './searchRepositoryVitest'

/**
 * Carries the readiness search's state into `codebook_status`'s node-test prerequisites, only when the environment searched.
 * Called by {@link StudyService.status} beside the node-test profile's `ready` and `missing`.
 * @param prerequisites - The node-test profile's prerequisites as the environment reported them.
 * @returns `{ vitestSearch }` when the environment named one; an empty object otherwise.
 * @example
 * vitestSearchField({ ready: false, missing: ['…'], vitestSearch: 'none' }) // => { vitestSearch: 'none' }
 * vitestSearchField({ ready: true, missing: [] })                          // => {}
 */
export function vitestSearchField(prerequisites: {
  ready: boolean
  missing: string[]
  vitestSearch?: NodeTestVitestSearch
}): { vitestSearch?: NodeTestVitestSearch } {
  return prerequisites.vitestSearch
    ? { vitestSearch: prerequisites.vitestSearch }
    : {}
}
