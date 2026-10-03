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
/** A verified adapter breakpoint that names its whole position; anything less cannot say where the breakpoint is. {@link ConfiguredBrowserRun} reads a browser binding with it too. */
export const verifiedPlaceSchema = z.object({
  verified: z.literal(true),
  line: z.number().int(),
  column: z.number().int(),
})
/** Refusal of a registration whose owned breakpoint is gone from the editor (retired, or removed by the learner); it says nothing about the declared line. */
export const OWNED_BREAKPOINT_REMOVED =
  'Owned breakpoint was removed before registration'
/** Where an adapter verified a breakpoint: one-based line and column. */
type VerifiedPlace = { line: number; column: number }
/** The breakpoint of a DAP `breakpoint` event: the adapter's later news about a breakpoint it acknowledged, for example a pending one verified when its module loads. */
const breakpointEventSchema = z.object({
  breakpoint: z.object({
    id: z.number().int(),
    verified: z.boolean(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    source: z.object({ path: z.string().optional() }).optional(),
  }),
})
type RegistrationReceipt = {
  sessionId: string
  requestSequence: number
  breakpointId: number
  status: 'pending' | 'bound'
  /** Present only when the adapter verified the breakpoint on a later line that the owner's rule accepted, and named its column. */
  movedTo?: VerifiedPlace
}
/** Where the adapter verified the owned breakpoint, kept beside the receipt so the run can compare a pause with it; absent while pending or when the reply named no whole position. */
type VerifiedRegistration = { verifiedAt?: VerifiedPlace }

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
    } & VerifiedRegistration
  >()
  /** `ownedBreakpointId` is the adapter id acknowledged for this breakpoint; with it, a learner breakpoint left on the same line is told apart from the owned one. */
  private retirement?: {
    sessionId: string
    ownedBreakpointId?: number
    requestSequence?: number
    confirmed: boolean
    failure?: string
  } & VerifiedRegistration
  retired = false
  /**
   * Adds the owned breakpoint to the editor at the declared position.
   * @param path - Absolute path of the source file the stop belongs to.
   * @param line - One-based declared line.
   * @param column - One-based declared column.
   * @param acknowledgedAt - What the adapter's registration reply must name. `'declared-line'` (configured runs) accepts any column of the declared line, because that caller commits the stop at the position the debugger bound. `'declared-column'` (Node test runs) also refuses another column, because that caller captures its pause at the declared column; a pending reply that names no column yet is still accepted.
   * @param acceptsLaterLine - Tells whether a line other than the declared one may be this breakpoint's verified place. A configured run passes its binding rule ({@link createBindingLineRule}), because a debugger that cannot pause on the declared line binds the first place after it. Without it, and under `'declared-column'`, a verified reply on another line is refused.
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
      parsed.data.breakpoints.some((position) =>
        this.isOwnedPosition(position, retirement.verifiedAt),
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
   * Gives {@link onResponse} and {@link onEvent} the places an acknowledged binding names: where it is verified, and the receipt's `movedTo` entry, whose key is absent unless the breakpoint moved so every other receipt keeps its shape.
   * @param binding - The owned breakpoint's parsed entry of a setBreakpoints reply or `breakpoint` event that {@link acknowledgesPosition} accepted.
   * @returns `verifiedAt` for a verified binding that names its whole position, and `movedTo` when that is another line than declared.
   * @example
   * this.verifiedPlaces({ verified: true, line: 35, column: 5 }) // => { verifiedAt: { line: 35, column: 5 }, movedTo: { line: 35, column: 5 } } for an owner declared at 33:5
   * this.verifiedPlaces({ verified: false }) // => {}
   */
  private verifiedPlaces(binding: {
    verified: boolean
    line?: number
    column?: number
  }): VerifiedRegistration & { movedTo?: VerifiedPlace } {
    if (
      !binding.verified ||
      binding.line === undefined ||
      binding.column === undefined
    )
      return {}
    const verifiedAt = { line: binding.line, column: binding.column }
    return verifiedAt.line === this.line
      ? { verifiedAt }
      : { verifiedAt, movedTo: verifiedAt }
  }

  /** Tells whether a breakpoint position of a request or reply may be the owned one: the declared position, or the place the adapter verified it at; a position without a column matches any column of that line. @example this.isOwnedPosition({ line: 35 }, { line: 35, column: 5 }) // true */
  private isOwnedPosition(
    position: { line?: number; column?: number },
    verifiedAt: VerifiedPlace | undefined,
  ): boolean {
    return [{ line: this.line, column: this.column }, verifiedAt].some(
      (place) =>
        place !== undefined &&
        position.line === place.line &&
        (position.column === undefined || position.column === place.column),
    )
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
        // The readable positions come first; the JSON keeps every field of the reply for diagnosis.
        registration.failure = `Selected adapter did not acknowledge the declared breakpoint registration (declared ${this.line}:${this.column}, ${
          binding
            ? `answered ${binding.line ?? 'no line'}:${binding.column ?? 'no column'} ${binding.verified ? 'verified' : 'unverified'}`
            : 'no answer for this breakpoint'
        }): ${JSON.stringify({
          responseSuccess: response.success,
          responseCount: parsed.success ? parsed.data.breakpoints.length : null,
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
        })}`
      } else {
        const { verifiedAt, ...moved } = this.verifiedPlaces(binding)
        registration.verifiedAt = verifiedAt
        registration.receipt = {
          sessionId: session.id,
          requestSequence: response.request_seq,
          breakpointId: binding.id,
          status: binding.verified ? 'bound' : 'pending',
          ...moved,
        }
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
        : parsed.data.breakpoints.some((position) =>
            this.isOwnedPosition(position, retirement.verifiedAt),
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
   * Asks the adapter where it has this breakpoint now and refuses a verified binding away from the declared position, for an owner whose first reply was pending and named no position; {@link OwnedNodeTestRun} calls it before it resumes the test.
   * A binding the adapter does not report, or one that is still unverified, decides nothing: the pause check remains.
   * @param session - The debug session whose adapter holds the breakpoint.
   * @throws When the adapter reports the breakpoint verified at another line or column than declared; the text names both positions.
   * @example
   * await owned.assertBoundAsDeclared(session) // throws 'Declared breakpoint 20:5 is bound at 20:12; …'
   */
  async assertBoundAsDeclared(session: vscode.DebugSession): Promise<void> {
    const place = verifiedPlaceSchema.safeParse(
      await session.getDebugProtocolBreakpoint(this.breakpoint),
    )
    if (
      place.success &&
      (place.data.line !== this.line || place.data.column !== this.column)
    )
      throw new Error(
        `Declared breakpoint ${this.line}:${this.column} is bound at ${place.data.line}:${place.data.column}; this stop is captured at its declared position, so declare ${place.data.line}:${place.data.column} or another statement.`,
      )
  }

  /**
   * Reads where the adapter currently has this breakpoint verified, on the declared line or on a later line the owner's rule accepted, so a pause can be compared with that exact line before the run binds the stop; {@link ConfiguredBrowserRun} asks it for every pause it admits.
   * Like {@link movedTo} it never throws.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns The verified line and column, or `undefined` while pending, without a whole position, or when refused or gone.
   * @example
   * owned.verifiedPlace(session) // => { line: 33, column: 5 } for a breakpoint verified on its declared line 33
   */
  verifiedPlace(session: vscode.DebugSession): VerifiedPlace | undefined {
    const registration = this.registrations.get(session.id)
    return registration?.failure ? undefined : registration?.verifiedAt
  }

  /**
   * Reads the adapter's later news about the acknowledged breakpoint, a DAP `breakpoint` event; the run forwards every event of a selected session. A pending registration that the adapter verifies when its module loads gains its place here, so a deadline can name a moved place and a pause is compared with the bound line.
   * An event that names a place the owner refuses, or another source, is not taken: the pause check still refuses such a binding when it arrives.
   * @param session - The debug session that sent the event.
   * @param event - Any DAP event of that session.
   * @example
   * owned.onEvent(session, { seq: 9, type: 'event', event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 4, verified: true, line: 35, column: 5 } } })
   */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    if (event.event !== 'breakpoint' || this.retirement) return
    const registration = this.registrations.get(session.id),
      parsed = breakpointEventSchema.safeParse(event.body)
    const receipt = registration?.receipt
    if (
      !receipt ||
      registration.failure ||
      !parsed.success ||
      parsed.data.breakpoint.id !== receipt.breakpointId ||
      !parsed.data.breakpoint.verified ||
      (parsed.data.breakpoint.source?.path &&
        resolve(parsed.data.breakpoint.source.path) !== resolve(this.path)) ||
      !this.acknowledgesPosition(parsed.data.breakpoint)
    )
      return
    const { verifiedAt, ...moved } = this.verifiedPlaces(parsed.data.breakpoint)
    if (!verifiedAt) return
    registration.verifiedAt = verifiedAt
    // The receipt is rebuilt so a place of an earlier reply never outlives the adapter's news.
    registration.receipt = {
      sessionId: receipt.sessionId,
      requestSequence: receipt.requestSequence,
      breakpointId: receipt.breakpointId,
      status: 'bound',
      ...moved,
    }
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
      verifiedAt: this.registrations.get(session.id)?.verifiedAt,
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
