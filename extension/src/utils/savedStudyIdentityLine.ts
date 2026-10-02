import type { StudyCatalogEntry } from '../studySchemas'

/**
 * Names one saved study for the removal confirmation with the same four parts its Saved studies option shows, so the learner can match the dialog to the list; called by {@link StudyWorkspace} before it asks for confirmation.
 * The date is formatted by the extension host and can differ in format from the option's; the last eight characters of the id are the anchor.
 * @param entry - The catalog entry the learner chose.
 * @returns `label · saved date · outcome · last eight characters of the id`.
 * @example
 * savedStudyIdentityLine({ id: 'a…_b…9f3c2d1e', profile: 'repository-browser', format: 'v4', savedAt: '2026-10-02T01:00:00.000Z', outcome: 'not-demonstrated' })
 * // => 'Repository browser study · 10/2/2026, 10:00:00 AM · not-demonstrated · 9f3c2d1e'
 */
export function savedStudyIdentityLine(
  entry: Pick<
    StudyCatalogEntry,
    'id' | 'profile' | 'format' | 'savedAt' | 'outcome'
  >,
): string {
  const label =
    entry.profile === 'repository-browser'
      ? 'Repository browser study'
      : 'Unknown scenario'
  return `${label}${entry.format === 'legacy-v1' ? ' (legacy)' : ''} · ${new Date(entry.savedAt).toLocaleString()} · ${entry.outcome} · ${entry.id.slice(-8)}`
}
