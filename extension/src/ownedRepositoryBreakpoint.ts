import { resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'
import { z } from 'zod'

import { ACTIVE_TIMEOUT_MS } from './constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { waitUntil } from './runtimeSupport/utils/waitUntil'

const requestSourceSchema = z.object({ source: z.object({ path: z.string() }) })
const requestSchema = requestSourceSchema.extend({
  sourceModified: z.boolean().optional(),
  breakpoints: z.array(
    z.object({
      line: z.number().int(),
      column: z.number().int().optional(),
      condition: z.string().optional(),
      hitCondition: z.string().optional(),
      logMessage: z.string().optional(),
    }),
  ),
})
const responseSchema = z.object({
  breakpoints: z.array(
    z.object({
      id: z.number().int().optional(),
      line: z.number().int().optional(),
      column: z.number().int().optional(),
    }),
  ),
})
const registrationResponseSchema = z.object({
  breakpoints: z.array(
    z.object({
      id: z.number().int().optional(),
      verified: z.boolean(),
      line: z.number().int().optional(),
      column: z.number().int().optional(),
      source: z.object({ path: z.string().optional() }).optional(),
      reason: z.enum(['pending', 'failed']).optional(),
    }),
  ),
})
/** Where an adapter verified a breakpoint: one-based line and column. */
type VerifiedPlace = { line: number; column: number }
/** A verified reply that names its whole position; anything less cannot say where the breakpoint moved. */
const verifiedPlaceSchema = z.object({
  verified: z.literal(true),
  line: z.number().int(),
  column: z.number().int(),
})
/** Refusal of a registration whose owned breakpoint is gone from the editor (retired, or removed by the learner); it says nothing about the declared line. */
export const OWNED_BREAKPOINT_REMOVED =
  'Owned breakpoint was removed before registration'
type RegistrationReceipt = {
  sessionId: string
  requestSequence: number
  breakpointId: number
  status: 'pending' | 'bound'
  /** Present only when the adapter verified the breakpoint on a later line that the owner's rule accepted, and named its column. */
  movedTo?: VerifiedPlace
}

/** Removes only one installed breakpoint and requires its selected adapter's replacement ACK before continuation. @example await owned.retire(selected, signal) */
export class OwnedRepositoryBreakpoint {
  readonly breakpoint: vscode.SourceBreakpoint
  private readonly registrations = new Map<
    string,
    {
      requestSequence: number
      index: number
      count: number
      receipt?: RegistrationReceipt
      failure?: string
    }
  >()
  /** `ownedBreakpointId` is the adapter id acknowledged for this breakpoint; with it, a learner breakpoint left on the same line is told apart from the owned one. */
  private retirement?: {
    sessionId: string
    ownedBreakpointId?: number
    requestSequence?: number
    confirmed: boolean
    failure?: string
  }
  retired = false
  /**
   * Adds the owned breakpoint to the editor at the declared position.
   * @param path - Absolute path of the source file the stop belongs to.
   * @param line - One-based declared line.
   * @param column - One-based declared column.
   * @param acknowledgedAt - What the adapter's registration reply must name. `'declared-line'` (configured runs) accepts any column of the declared line, because that caller commits the stop at the position the debugger bound. `'declared-column'` (Node test runs) also refuses another column, because that caller captures its pause at the declared column; a pending reply that names no column yet is still accepted.
   * @param acceptsLaterLine - Tells whether a line other than the declared one may be this breakpoint's verified place. A configured run passes its binding rule ({@link isBindingLineAccepted}), because a debugger that cannot pause on the declared line binds the first place after it. Without it, and under `'declared-column'`, a verified reply on another line is refused.
   * @example
   * new OwnedRepositoryBreakpoint('/repo/actions.ts', 20, 5)
   * new OwnedRepositoryBreakpoint('/repo/theme.ts', 1, 14, 'declared-column')
   * new OwnedRepositoryBreakpoint('/repo/actions.ts', 33, 5, 'declared-line', (line) => line === 35)
   */
  constructor(
    readonly path: string,
    readonly line: number,
    readonly column: number,
    private readonly acknowledgedAt:
      'declared-line' | 'declared-column' = 'declared-line',
    private readonly acceptsLaterLine?: (line: number) => boolean,
  ) {
    this.breakpoint = new vscode.SourceBreakpoint(
      new vscode.Location(
        vscode.Uri.file(path),
        new vscode.Position(line - 1, column - 1),
      ),
    )
    vscode.debug.addBreakpoints([this.breakpoint])
  }

  /** Tracks exact-source registration or removal requests; the native tracker calls this before adapter dispatch. @example owned.onRequest(session, request) */
  onRequest(
    session: vscode.DebugSession,
    request: DebugProtocol.Request,
  ): void {
    const retirement = this.retirement
    if (request.command !== 'setBreakpoints') return
    const source = requestSourceSchema.safeParse(request.arguments)
    if (
      source.success &&
      resolve(source.data.source.path) !== resolve(this.path)
    )
      return
    const parsed = requestSchema.safeParse(request.arguments)
    if (!parsed.success) {
      // An unparseable replacement cannot leave the preceding registration authoritative.
      if (retirement?.sessionId === session.id)
        retirement.failure =
          'Malformed breakpoint replacement during retirement'
      else
        this.registrations.set(session.id, {
          requestSequence: request.seq,
          index: -1,
          count: 0,
          failure: 'Malformed breakpoint registration replacement',
        })
      return
    }
    if (!retirement) {
      const matches = parsed.data.breakpoints.flatMap((position, index) =>
        position.line === this.line && position.column === this.column
          ? [index]
          : [],
      )
      const position = parsed.data.breakpoints[matches[0] ?? -1]
      // A later replacement immediately revokes a prior ACK, including when it removes this position.
      this.registrations.set(session.id, {
        requestSequence: request.seq,
        index: matches[0] ?? -1,
        count: parsed.data.breakpoints.length,
        failure:
          matches.length !== 1
            ? 'Selected breakpoint registration is absent or ambiguous'
            : parsed.data.sourceModified ||
                position?.condition !== undefined ||
                position?.hitCondition !== undefined ||
                position?.logMessage !== undefined
              ? 'Selected breakpoint registration changed source or pause behavior'
              : undefined,
      })
      return
    }
    if (session.id !== retirement.sessionId) return
    // Without the owned id, a same-position learner breakpoint is indistinguishable from the owned one, and it cannot be disabled for this run.
    if (
      retirement.ownedBreakpointId === undefined &&
      parsed.data.breakpoints.some(
        (position) =>
          position.line === this.line &&
          (position.column === undefined || position.column === this.column),
      )
    ) {
      retirement.failure =
        'A breakpoint still targets the selected position; owned removal cannot retire learner breakpoints.'
      return
    }
    retirement.requestSequence = request.seq
    retirement.confirmed = false
  }

  /**
   * Tells whether an adapter reply names a position this owner accepts; called by {@link onResponse} for the owned breakpoint's entry.
   * A reply may leave a position out while it is pending; a verified one must name the declared line, and for an owner that captures at the declared column also that column. An owner that commits at the bound position also takes a verified reply on a line its rule accepts.
   * @param binding - The owned breakpoint's entry of the setBreakpoints reply.
   * @returns `false` when the reply names another line that the owner's rule does not accept, or, under `'declared-column'`, another line or column.
   * @example
   * this.acknowledgesPosition({ verified: true, line: 20, column: 12 }) // => true for 'declared-line', false for 'declared-column' declared at 20:5
   */
  private acknowledgesPosition(binding: {
    verified: boolean
    line?: number
    column?: number
  }): boolean {
    const names = (declared: number, replied?: number): boolean =>
      binding.verified
        ? replied === declared
        : (replied ?? declared) === declared
    // An owner that captures at the declared column takes that exact position and nothing else.
    if (this.acknowledgedAt === 'declared-column')
      return (
        names(this.line, binding.line) && names(this.column, binding.column)
      )
    // Otherwise the adapter chooses the column, and may have moved the breakpoint to a line the owner's rule accepts.
    return names(this.line, binding.line) || this.isOnAcceptedLaterLine(binding)
  }

  /** Tells {@link acknowledgesPosition} whether a verified reply names another line that the owner's rule accepts; a pending reply never does. @example this.isOnAcceptedLaterLine({ verified: true, line: 35 }) // true for an owner whose rule accepts line 35 */
  private isOnAcceptedLaterLine(binding: {
    verified: boolean
    line?: number
  }): boolean {
    return (
      binding.verified &&
      binding.line !== undefined &&
      Boolean(this.acceptsLaterLine?.(binding.line))
    )
  }

  /**
   * Reads where an acknowledged reply put the owned breakpoint when that is another line than declared, so that {@link onResponse} can keep the place in its receipt.
   * @param binding - The owned breakpoint's entry of a setBreakpoints reply that {@link acknowledgesPosition} accepted.
   * @returns The verified line and column, or `undefined` for a reply on the declared line, a pending one, or one that does not name its whole position.
   * @example
   * this.movedPlace({ verified: true, line: 35, column: 5 }) // => { line: 35, column: 5 } for an owner declared at 33:5
   */
  private movedPlace(binding: unknown): VerifiedPlace | undefined {
    const place = verifiedPlaceSchema.safeParse(binding)
    return place.success && place.data.line !== this.line
      ? { line: place.data.line, column: place.data.column }
      : undefined
  }

  /** Gives {@link onResponse} the receipt's `movedTo` entry for an acknowledged reply; the key is absent unless the breakpoint moved, so every other receipt keeps its shape. @example this.movedPlaceOf({ verified: true, line: 20, column: 5 }) // {} for an owner declared on line 20 */
  private movedPlaceOf(binding: unknown): { movedTo?: VerifiedPlace } {
    const movedTo = this.movedPlace(binding)
    return movedTo ? { movedTo } : {}
  }

  /** Accepts only a successful matching setBreakpoints response on the declared line, or on a later line the owner's rule accepts, at whichever column the adapter bound unless the owner asked for the declared column; a retirement response must exclude the owned stop. @example owned.onResponse(session, response) */
  onResponse(
    session: vscode.DebugSession,
    response: DebugProtocol.Response,
  ): void {
    if (response.command !== 'setBreakpoints') return
    const registration = this.registrations.get(session.id)
    if (
      !this.retirement &&
      registration?.requestSequence === response.request_seq &&
      !registration.failure
    ) {
      const parsed = registrationResponseSchema.safeParse(response.body)
      const binding = parsed.success
        ? parsed.data.breakpoints[registration.index]
        : undefined
      // DAP preserves request order; never select an arbitrary matching line from a truncated/reordered response.
      if (
        !response.success ||
        !parsed.success ||
        parsed.data.breakpoints.length !== registration.count ||
        !binding ||
        binding.id === undefined ||
        binding.reason === 'failed' ||
        parsed.data.breakpoints.filter(
          (candidate) => candidate.id === binding.id,
        ).length !== 1 ||
        (binding.source?.path &&
          resolve(binding.source.path) !== resolve(this.path)) ||
        !this.acknowledgesPosition(binding)
      ) {
        registration.failure = `Selected adapter did not acknowledge the declared breakpoint registration: ${JSON.stringify(
          {
            responseSuccess: response.success,
            responseCount: parsed.success
              ? parsed.data.breakpoints.length
              : null,
            expectedCount: registration.count,
            expectedLine: this.line,
            expectedColumn: this.column,
            selectedId: binding?.id ?? null,
            selectedVerified: binding?.verified ?? null,
            selectedReason: binding?.reason ?? null,
            selectedLine: binding?.line ?? null,
            selectedColumn: binding?.column ?? null,
            selectedSourceMatches: binding?.source?.path
              ? resolve(binding.source.path) === resolve(this.path)
              : null,
          },
        )}`
      } else
        registration.receipt = {
          sessionId: session.id,
          requestSequence: response.request_seq,
          breakpointId: binding.id,
          status: binding.verified ? 'bound' : 'pending',
          ...this.movedPlaceOf(binding),
        }
    }
    const retirement = this.retirement
    if (
      !retirement ||
      session.id !== retirement.sessionId ||
      response.command !== 'setBreakpoints' ||
      response.request_seq !== retirement.requestSequence
    )
      return
    const parsed = responseSchema.safeParse(response.body)
    const ownedBreakpointId = retirement.ownedBreakpointId
    // With every remaining breakpoint identified, only the owned id counts; otherwise any breakpoint left on the owned position might be it.
    const identified =
      parsed.success &&
      ownedBreakpointId !== undefined &&
      parsed.data.breakpoints.every((position) => position.id !== undefined)
    const ownedRemains =
      !parsed.success ||
      (identified
        ? parsed.data.breakpoints.some(
            (position) => position.id === ownedBreakpointId,
          )
        : parsed.data.breakpoints.some(
            (position) =>
              position.line === this.line &&
              (position.column === undefined ||
                position.column === this.column),
          ))
    if (!response.success || ownedRemains) {
      retirement.failure =
        'Selected adapter did not confirm retirement of the owned breakpoint.'
      return
    }
    retirement.confirmed = true
  }

  /** Reads current ACK authority synchronously at the final input boundary; {@link registered} also polls it during setup. @example owned.registration(session)?.status // 'pending' */
  registration(session: vscode.DebugSession): RegistrationReceipt | undefined {
    if (
      this.retirement ||
      this.retired ||
      !vscode.debug.breakpoints.some(
        (breakpoint) => breakpoint.id === this.breakpoint.id,
      )
    )
      throw new Error(OWNED_BREAKPOINT_REMOVED)
    const registration = this.registrations.get(session.id)
    if (registration?.failure) throw new Error(registration.failure)
    return registration?.receipt && { ...registration.receipt }
  }

  /**
   * Reads where the adapter currently has this breakpoint when it moved it to a later line, for a deadline text that must name that place while it fails a run; {@link ConfiguredBrowserRun} calls it when such a deadline expires.
   * Unlike {@link registration} it never throws: a refused, revoked or retired registration has no moved place.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns The verified line and column of the current acknowledgement, or `undefined` when it is on the declared line, pending, refused or gone.
   * @example
   * owned.movedTo(session) // => { line: 35, column: 5 }
   */
  movedTo(session: vscode.DebugSession): VerifiedPlace | undefined {
    const registration = this.registrations.get(session.id)
    return registration?.failure ? undefined : registration?.receipt?.movedTo
  }

  /**
   * Reads what the adapter last said about this breakpoint, for a deadline text that must not claim more than is known; {@link ConfiguredBrowserRun} calls it when a later stop's deadline expires.
   * Unlike {@link registration} it never throws.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns
   * - `'pending'`: acknowledged but not verified in a loaded module
   * - `'bound'`: verified
   * - `'unacknowledged'`: refused, revoked or never acknowledged
   * @example
   * owned.acknowledgement(session) // => 'pending'
   */
  acknowledgement(
    session: vscode.DebugSession,
  ): RegistrationReceipt['status'] | 'unacknowledged' {
    const registration = this.registrations.get(session.id)
    return registration?.failure || !registration?.receipt
      ? 'unacknowledged'
      : registration.receipt.status
  }

  /** Waits for the chosen adapter's ACK without claiming that a lazy module has loaded; runtime preparation calls this before input. @example (await owned.registered(session, signal)).status // 'pending' */
  async registered(
    session: vscode.DebugSession,
    signal: AbortSignal,
  ): Promise<RegistrationReceipt> {
    return waitUntil(
      () => this.registration(session),
      'acknowledged native breakpoint registration',
      ACTIVE_TIMEOUT_MS,
      signal,
    )
  }

  /** Waits for actual adapter retirement as well as editor identity removal; an editor-only disappearance is insufficient. @example await owned.retire(selected, signal) */
  async retire(
    session: vscode.DebugSession,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.retired) return
    if (this.retirement)
      throw new Error('Breakpoint retirement already pending')
    // The learner already removed it and the editor's latest replacement for this session excluded it; no further request will confirm removal.
    if (
      !vscode.debug.breakpoints.some(
        (breakpoint) => breakpoint.id === this.breakpoint.id,
      ) &&
      this.registrations.get(session.id)?.index === -1
    ) {
      await waitUntil(
        async () =>
          (await awaitResponse(
            session.getDebugProtocolBreakpoint(this.breakpoint),
            'owned breakpoint retirement',
            signal,
          )) === undefined,
        'adapter release of the learner-removed owned breakpoint',
        ACTIVE_TIMEOUT_MS,
        signal,
      )
      signal.throwIfAborted()
      this.registrations.clear()
      this.retired = true
      return
    }
    // Read the acknowledged id before removal clears the registrations.
    const retirement = (this.retirement = {
      sessionId: session.id,
      ownedBreakpointId: this.registrations.get(session.id)?.receipt
        ?.breakpointId,
      confirmed: false,
    })
    this.remove()
    await waitUntil(
      async () => {
        if (this.retirement?.failure) throw new Error(this.retirement.failure)
        if (
          !retirement.confirmed ||
          vscode.debug.breakpoints.some(
            (breakpoint) => breakpoint.id === this.breakpoint.id,
          )
        )
          return false
        const remaining = await awaitResponse(
          session.getDebugProtocolBreakpoint(this.breakpoint),
          'owned breakpoint retirement',
          signal,
        )
        return remaining === undefined
      },
      'confirmed owned breakpoint retirement',
      ACTIVE_TIMEOUT_MS,
      signal,
    )
    signal.throwIfAborted()
    this.retired = true
  }

  /** Releases only the acquired editor breakpoint during cancellation; it never clears a whole source or another owner's breakpoints. @example owned.remove() */
  remove(): void {
    this.registrations.clear()
    vscode.debug.removeBreakpoints([this.breakpoint])
  }
}
