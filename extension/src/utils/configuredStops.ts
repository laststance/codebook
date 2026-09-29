import type { RetainedRepositoryConfiguration } from '../repositoryConfigSchemas';

/** Expands frozen stop intent for runtime and history validators without changing old configuration hashes. @example configuredStops(configuration)[0]?.source.line // original selected line */
export function configuredStops(configuration: RetainedRepositoryConfiguration) {
  if (configuration.version === 2) return [{ participant: configuration.participant, anchorIndex: configuration.book.anchorIndex, source: configuration.source, inspections: configuration.inspections }, ...(configuration.additionalStops ?? [])];
  return [{ participant: 'browser' as const, anchorIndex: configuration.book.anchorIndex, source: configuration.source, inspections: configuration.inspections }, ...(configuration.additionalStops ?? []).map(stop => ({
    participant: 'browser' as const, anchorIndex: configuration.book.anchorIndex, source: { ...configuration.source, line: stop.line, column: stop.column }, inspections: stop.inspections,
  }))];
}
