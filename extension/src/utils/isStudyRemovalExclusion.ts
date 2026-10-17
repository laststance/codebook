import type { HistoryExclusion, StudyRemovalExclusion } from '../service'

/**
 * Says whether a run's history is excluded because its saved study was removed, by this window's delete or outside it; asked by {@link StudyService} wherever a removed study's evidence, recording or failure must not be served.
 * A predicate, because the caller hands the narrowed kind to {@link historyExclusionReason}, which answers a sentence for every removal.
 * @param exclusion - The record's `historyExcluded` field.
 * @returns
 * - `removed-by-learner` or `archive-removed`: `true`
 * - Any other exclusion, or none: `false`
 * @example
 * isStudyRemovalExclusion('archive-removed') // => true
 * isStudyRemovalExclusion('refused-at-admission') // => false
 */
export function isStudyRemovalExclusion(
  exclusion: HistoryExclusion | undefined,
): exclusion is StudyRemovalExclusion {
  return exclusion === 'removed-by-learner' || exclusion === 'archive-removed'
}
