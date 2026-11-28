import type { ConnectedBridge } from './ConnectedBridge'

/** What {@link launchDevinBridge} starts the bridge with. */
export interface DevinBridgeLaunch {
  /** Source of a preload script run in the bridge process; none when left out. */
  preloadSource?: string
  /** The proxy's `decide` from the bridge's first request on, its startup included (see {@link ConnectedBridge}'s `proxy`). */
  decide?: ConnectedBridge['proxy']['decide']
}
