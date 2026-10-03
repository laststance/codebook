import type { StudyCatalogEntry } from '../studySchemas'

/**
 * Builds the four-part name of one saved study, so the Saved studies option in the Study pane and the removal dialog in the host cannot drift apart; called by {@link savedStudyIdentityLine} and, serialized into the webview, by the pane's list.
 * It reads nothing outside its arguments, because the pane runs its source text.
 * @param entry - The catalog entry.
 * @param kind - The entry's kind as the caller names it (the pane also knows Node test histories and scenario titles).
 * @returns `kind[ (legacy)] · saved date · outcome · last eight characters of the id`.
 * @example
 * savedStudyLabel({ id: 'a…_b…9f3c2d1e', format: 'v4', savedAt: '2026-10-02T01:00:00.000Z', outcome: 'not-demonstrated' }, 'Repository browser study')
 * // => 'Repository browser study · 10/2/2026, 10:00:00 AM · not-demonstrated · 9f3c2d1e'
 */
export function savedStudyLabel(
  entry: Pick<StudyCatalogEntry, 'id' | 'format' | 'savedAt' | 'outcome'>,
  kind: string,
): string {
  return `${kind}${entry.format === 'legacy-v1' ? ' (legacy)' : ''} · ${new Date(entry.savedAt).toLocaleString()} · ${entry.outcome} · ${entry.id.slice(-8)}`
}
