import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import type {
  ExtensionStopContext,
  ResolvedExtensionStop,
} from './chromeExtensionContracts'
import { EXTENSION_STOP_COLUMN } from './constants'
import { OwnedRepositoryBreakpoint } from './ownedRepositoryBreakpoint'

/** One declared stop and whether its single hit was already taken. */
export type LogicalExtensionStop = {
  stop: ResolvedExtensionStop
  physical: OwnedRepositoryBreakpoint
  retired: boolean
}

/** How one logical stop stands in the sessions of its context. */
export type ExtensionBindingState = 'bound' | 'pending' | 'refused'

/** What a hit of a physical breakpoint means for the session's context. */
export type ExtensionHitVerdict =
  | { kind: 'declared'; logical: LogicalExtensionStop }
  | { kind: 'repeat'; logical: LogicalExtensionStop }
  | { kind: 'mismatch'; logical: LogicalExtensionStop }

/**
 * Holds the declared stops of a run as logical stops over physical editor breakpoints: one {@link OwnedRepositoryBreakpoint} per (path, line, column) carries one logical stop per context (ER21).
 * Created by the debugger when the stops are armed; fed every DAP request, response and event of the run's sessions; asked whether a stop is verified in its context and what a hit of a breakpoint means.
 *
 * @example
 * const registry = new ExtensionStopRegistry(run.stops)
 * registry.arm()
 * registry.bindingOf(registry.logical[0]!, [pageSession]) // => 'pending' until the adapter verified it
 */
export class ExtensionStopRegistry {
  readonly logical: LogicalExtensionStop[] = []
  private readonly physicals = new Map<string, OwnedRepositoryBreakpoint>()
  /** The last id each session's adapter acknowledged per physical breakpoint; kept while a replacement `setBreakpoints` of its file is unanswered, so a live stop's hit is not taken for a foreign one. */
  private readonly lastIds = new Map<
    OwnedRepositoryBreakpoint,
    Map<string, number>
  >()

  constructor(private readonly stops: readonly ResolvedExtensionStop[]) {}

  /** Adds one editor breakpoint per distinct place and the logical stops that share it. */
  arm(): void {
    for (const stop of this.stops) {
      const key = `${stop.absolutePath}:${stop.line}:${EXTENSION_STOP_COLUMN}`
      let physical = this.physicals.get(key)
      if (!physical) {
        physical = new OwnedRepositoryBreakpoint(
          stop.absolutePath,
          stop.line,
          EXTENSION_STOP_COLUMN,
        )
        this.physicals.set(key, physical)
      }
      this.logical.push({ stop, physical, retired: false })
    }
  }

  /** Passes an editor request to every physical breakpoint. */
  onRequest(
    session: vscode.DebugSession,
    request: DebugProtocol.Request,
  ): void {
    for (const physical of this.physicals.values())
      physical.onRequest(session, request)
  }

  /** Passes an adapter response to every physical breakpoint. */
  onResponse(
    session: vscode.DebugSession,
    response: DebugProtocol.Response,
  ): void {
    for (const physical of this.physicals.values())
      physical.onResponse(session, response)
    this.rememberIds(session)
  }

  /** Passes an adapter `breakpoint` event to every physical breakpoint. */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    for (const physical of this.physicals.values())
      physical.onEvent(session, event)
    this.rememberIds(session)
  }

  /** Keeps the ids the session's adapter has acknowledged right now, called after each reply and event. */
  private rememberIds(session: vscode.DebugSession): void {
    for (const physical of this.physicals.values()) {
      const id = physical.acknowledgedId(session)
      if (id === undefined) continue
      let ids = this.lastIds.get(physical)
      if (!ids) this.lastIds.set(physical, (ids = new Map()))
      ids.set(session.id, id)
    }
  }

  /** The id of a physical breakpoint in a session: the current acknowledgement, else the last one while a replacement is unanswered. */
  private idOf(
    physical: OwnedRepositoryBreakpoint,
    session: vscode.DebugSession,
  ): number | undefined {
    return (
      physical.acknowledgedId(session) ??
      this.lastIds.get(physical)?.get(session.id)
    )
  }

  /**
   * Tells how a stop stands across the sessions of its context.
   * @param logical - The declared stop.
   * @param sessions - The run's sessions of the stop's context.
   * @returns `bound` when any is verified, `refused` when the adapter refused or moved it everywhere it answered, else `pending`.
   */
  bindingOf(
    logical: LogicalExtensionStop,
    sessions: readonly vscode.DebugSession[],
  ): ExtensionBindingState {
    let refused = false
    for (const session of sessions) {
      try {
        const status = logical.physical.registration(session)?.status
        if (status === 'bound') return 'bound'
      } catch {
        refused = true
      }
    }
    return refused ? 'refused' : 'pending'
  }

  /**
   * Reads the verdict of a stop of one session.
   * @param session - The session that stopped.
   * @param context - The context of that session.
   * @param hitBreakpointIds - The adapter's ids named by the `stopped` event.
   * @returns `undefined` when no owned breakpoint of this session was hit; else whether the hit is the declared stop of this context, a repeat of a retired one or a hit in the other context.
   */
  verdictOf(
    session: vscode.DebugSession,
    context: ExtensionStopContext,
    hitBreakpointIds: readonly number[],
  ): ExtensionHitVerdict | undefined {
    const hit = this.logical.find((entry) => {
      const id = this.idOf(entry.physical, session)
      return id !== undefined && hitBreakpointIds.includes(id)
    })
    if (!hit) return undefined
    // Every logical stop on the hit place; the one of this context decides.
    const sharing = this.logical.filter(
      (entry) => entry.physical === hit.physical,
    )
    const mine = sharing.find((entry) => entry.stop.context === context)
    if (!mine) return { kind: 'mismatch', logical: hit }
    return { kind: mine.retired ? 'repeat' : 'declared', logical: mine }
  }

  /**
   * Finds the declared stop an adapter breakpoint id belongs to in one session, for the adapter's own news about it.
   * @param session - The session that sent the `breakpoint` event.
   * @param breakpointId - The id the event names.
   * @param context - The context of the notifying session; a page stop and a worker stop on one line share a physical breakpoint, so only this context's logical stop is the one the news is about.
   * @returns The unretired logical stop of that context whose physical breakpoint has that id in the session; `undefined` otherwise.
   */
  stopOfBreakpointId(
    session: vscode.DebugSession,
    breakpointId: number,
    context: ExtensionStopContext,
  ): LogicalExtensionStop | undefined {
    return this.logical.find(
      (entry) =>
        !entry.retired &&
        entry.stop.context === context &&
        this.idOf(entry.physical, session) === breakpointId,
    )
  }

  /** Whether the ids name any breakpoint that is not an owned one of this session (a learner breakpoint on the same stop). */
  hasForeignId(
    session: vscode.DebugSession,
    hitBreakpointIds: readonly number[],
  ): boolean {
    const owned = new Set(
      this.logical.flatMap((entry) => {
        const id = this.idOf(entry.physical, session)
        return id === undefined ? [] : [id]
      }),
    )
    return hitBreakpointIds.some((id) => !owned.has(id))
  }

  /** Retires a logical stop; its physical breakpoint is removed once every logical stop on it is retired. */
  retire(logical: LogicalExtensionStop): void {
    logical.retired = true
    const stillNeeded = this.logical.some(
      (entry) => entry.physical === logical.physical && !entry.retired,
    )
    if (!stillNeeded) {
      logical.physical.remove()
      // A removed breakpoint has no live id any more.
      this.lastIds.delete(logical.physical)
    }
  }

  /** 1-based indexes of stops not yet retired. */
  unretiredIndexes(): number[] {
    return this.logical
      .filter((entry) => !entry.retired)
      .map((entry) => entry.stop.index)
  }

  /** Removes every owned breakpoint from the editor. */
  removeAll(): void {
    for (const physical of this.physicals.values()) physical.remove()
  }
}
