import type { ExtensionHistorySummary } from './chromeExtensionHistoryTypes'
import type { NodeServerHistorySummary } from './nodeServerHistoryTypes'
import type { NodeTestHistorySummary } from './nodeTestHistoryTypes'

/**
 * One saved history as Saved studies, the history resources and Save read it, whatever its profile: a test history or a server history, told apart by `profile`.
 * Produced by {@link NodeHistoryRepository.list}; the Study workspace words each row through the profile's UI adapter.
 */
export type NodeHistorySummary =
  NodeTestHistorySummary | NodeServerHistorySummary | ExtensionHistorySummary
