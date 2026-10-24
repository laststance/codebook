import { resolve } from 'node:path'

import type { DebugProtocol } from '@vscode/debugprotocol'
import * as vscode from 'vscode'
import { z } from 'zod'

import { ACTIVE_TIMEOUT_MS } from './constants'
import { awaitResponse } from './runtimeSupport/utils/awaitResponse'
import { waitUntil } from './runtimeSupport/utils/waitUntil'
import { boundElsewhereRefusalText } from './utils/boundElsewhereRefusalText'
import { completeBindingPlace } from './utils/completeBindingPlace'

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
/** One breakpoint of a setBreakpoints reply, as the adapter answers the registration of {@link OwnedRepositoryBreakpoint}. */
type RegistrationBinding = z.infer<
  typeof registrationResponseSchema
>['breakpoints'][number]
/** A verified adapter breakpoint that names its whole position; anything less cannot say where the breakpoint is. An editor's answer may lack the column and is read with {@link verifiedLineSchema}; {@link ConfiguredBrowserRun} names a browser binding it completed by this schema's type. */
export const verifiedPlaceSchema = z.object({
  verified: z.literal(true),
  line: z.number().int(),
  column: z.number().int(),
})
/**
 * A verified adapter breakpoint as an editor answers it for {@link vscode.DebugSession.getDebugProtocolBreakpoint}: always its line, its column only when the editor kept it.
 * VS Code and Cursor remove the column from the adapter's `changed` news about a breakpoint that has no column of its own, and a breakpoint the extension API adds at character 0 has none: every stop requested at column 1 is answered without a column once the adapter sent news about it. {@link ConfiguredBrowserRun} reads a binding with this schema and takes the missing column from the adapter's own report ({@link OwnedRepositoryBreakpoint.reportedPlace}).
 * @example
 * verifiedLineSchema.safeParse({ id: 0, verified: true, line: 32 }).success // => true
 */
export const verifiedLineSchema = verifiedPlaceSchema.extend({
  column: z.number().int().optional(),
})
/**
 * The failure of a registration read whose owned breakpoint is gone from the editor (retired, or removed by the learner); it says nothing about the requested line.
 * {@link OwnedRepositoryBreakpoint.registration} throws it, so a caller tells it from an adapter's refusal by its type and not by its text: {@link ConfiguredBrowserRun} leaves the next step and the mapping hints out for it, because another line would not help.
 * @example
 * try {
 *   owned.registration(session)
 * } catch (error) {
 *   if (error instanceof OwnedBreakpointRemovedError) return 'removed' // String(error) === 'Error: Owned breakpoint was removed before registration'
 * }
 */
export class OwnedBreakpointRemovedError extends Error {
  constructor() {
    super('Owned breakpoint was removed before registration')
  }
}
/** Where an adapter verified a breakpoint: one-based line and column. */
type VerifiedPlace = { line: number; column: number }
/**
 * The failure of a registration read after the adapter reported the acknowledged breakpoint verified at a place its owner refuses, in a DAP `breakpoint` event that followed the registration reply. The first reply refuses the same place, so the adapter's later news must not leave the earlier receipt standing.
 * {@link OwnedRepositoryBreakpoint.registration} throws it until a later event names an accepted place. It carries the place, so the caller words the refusal with its own rule: {@link ConfiguredBrowserRun} names the declared stop, the place and why the stop's rule refuses it.
 * @example
 * try {
 *   owned.registration(session)
 * } catch (error) {
 *   if (error instanceof OwnedBreakpointMovedError) error.place // => { line: 30, column: 1 }
 * }
 */
export class OwnedBreakpointMovedError extends Error {
  /**
   * @param requested - The position the owner requested the breakpoint at.
   * @param place - Where the adapter reported it verified.
   */
  constructor(
    requested: VerifiedPlace,
    readonly place: VerifiedPlace,
  ) {
    super(
      `Selected adapter moved the acknowledged breakpoint to ${place.line}:${place.column} (requested ${requested.line}:${requested.column}), a place its owner does not accept`,
    )
  }
}
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
  /** Present only when the adapter verified the breakpoint on another line than requested, which the owner's rule accepted, and named its column. */
  movedTo?: VerifiedPlace
}
/** Where the adapter verified the owned breakpoint, kept beside the receipt so the run can compare a pause with it; absent while pending or when the reply named no whole position. */
type VerifiedRegistration = { verifiedAt?: VerifiedPlace }

/**
 * Reads the place a binding is verified at; called by {@link OwnedRepositoryBreakpoint.verifiedPlaces} before it compares that place with the requested line.
 * @param binding - The owned breakpoint's parsed entry of a setBreakpoints reply or `breakpoint` event.
 * @returns The line and column of a verified binding that names both; `undefined` for a pending binding and for one without a whole position.
 * @example
 * wholeVerifiedPosition({ verified: true, line: 35, column: 5 }) // => { line: 35, column: 5 }
 * wholeVerifiedPosition({ verified: true, line: 35 })            // => undefined
 */
function wholeVerifiedPosition(binding: {
  verified: boolean
  line?: number
  column?: number
}): VerifiedPlace | undefined {
  if (
    !binding.verified ||
    binding.line === undefined ||
    binding.column === undefined
  )
    return undefined
  return { line: binding.line, column: binding.column }
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
      /** Where the adapter's latest `breakpoint` event put the acknowledged breakpoint when the owner refuses that place; while it is set the receipt does not stand. Also where a refused registration reply verified the breakpoint, beside `failure`. */
      refusedAt?: VerifiedPlace
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
   * Adds the owned breakpoint to the editor at the requested position: the place its owner asks the debugger for. A Node test run requests the position its stop was declared at; a configured run requests the declared position, or the first mapped position after a declared line without one ({@link resolveArmedPlace}).
   * @param path - Absolute path of the source file the stop belongs to.
   * @param line - One-based requested line.
   * @param column - One-based requested column.
   * @param acceptsOtherLine - Tells whether a line other than the requested one may be this breakpoint's verified place. A configured run passes its binding rule ({@link createBindingLineRule}), which accepts the lines from the declared to the requested one and a later line no mapped line separates from the requested one. Without it, a verified reply on another line is refused. Every caller commits its stop at the position the debugger bound, so any column of the requested line is accepted.
   * @example
   * new OwnedRepositoryBreakpoint('/repo/actions.ts', 20, 5)
   * new OwnedRepositoryBreakpoint('/repo/theme.ts', 1, 14)
   * new OwnedRepositoryBreakpoint('/repo/actions.ts', 33, 5, (line) => line === 35)
   */
  constructor(
    readonly path: string,
    readonly line: number,
    readonly column: number,
    private readonly acceptsOtherLine?: (line: number) => boolean,
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
      // An editor sends a breakpoint at character 0 without a column, so a position that names none is column 1.
      const matches = parsed.data.breakpoints.flatMap((position, index) =>
        position.line === this.line && (position.column ?? 1) === this.column
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
    // Without the owned id, a same-position learner breakpoint is indistinguishable from the owned one, and it cannot be disabled for this run. A breakpoint the adapter never acknowledged has no verified place either, so only the requested position is compared.
    if (
      retirement.ownedBreakpointId === undefined &&
      parsed.data.breakpoints.some((position) => this.isOwnedPosition(position))
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
   * A reply may leave a position out while it is pending; a verified one must name the requested line, at any column, because the stop is committed at the position the debugger bound. A verified reply on a line the owner's rule accepts is taken too.
   * @param binding - The owned breakpoint's entry of the setBreakpoints reply.
   * @returns `false` when the reply names another line that the owner's rule does not accept.
   * @example
   * this.acknowledgesPosition({ verified: true, line: 20, column: 12 }) // => true for an owner requested at 20:5
   */
  private acknowledgesPosition(binding: {
    verified: boolean
    line?: number
    column?: number
  }): boolean {
    const names = (requested: number, replied?: number): boolean =>
      binding.verified
        ? replied === requested
        : (replied ?? requested) === requested
    // The adapter chooses the column, and may have moved the breakpoint to a line the owner's rule accepts.
    return names(this.line, binding.line) || this.isOnAcceptedOtherLine(binding)
  }

  /** Tells {@link acknowledgesPosition} whether a verified reply names another line that the owner's rule accepts; a pending reply never does. @example this.isOnAcceptedOtherLine({ verified: true, line: 35 }) // true for an owner whose rule accepts line 35 */
  private isOnAcceptedOtherLine(binding: {
    verified: boolean
    line?: number
  }): boolean {
    return (
      binding.verified &&
      binding.line !== undefined &&
      Boolean(this.acceptsOtherLine?.(binding.line))
    )
  }

  /**
   * Gives {@link onResponse} and {@link onEvent} the places an acknowledged binding names: where it is verified, and the receipt's `movedTo` entry, whose key is absent unless the breakpoint moved so every other receipt keeps its shape.
   * @param binding - The owned breakpoint's parsed entry of a setBreakpoints reply or `breakpoint` event that {@link acknowledgesPosition} accepted.
   * @returns `verifiedAt` for a verified binding that names its whole position, and `movedTo` when that is another line than requested.
   * @example
   * this.verifiedPlaces({ verified: true, line: 35, column: 5 }) // => { verifiedAt: { line: 35, column: 5 }, movedTo: { line: 35, column: 5 } } for an owner requested at 33:5
   * this.verifiedPlaces({ verified: false }) // => {}
   */
  private verifiedPlaces(binding: {
    verified: boolean
    line?: number
    column?: number
  }): VerifiedRegistration & { movedTo?: VerifiedPlace } {
    const verifiedAt = wholeVerifiedPosition(binding)
    if (!verifiedAt) return {}
    return verifiedAt.line === this.line
      ? { verifiedAt }
      : { verifiedAt, movedTo: verifiedAt }
  }

  /**
   * Tells whether a breakpoint position of a request or reply may be the owned one, for the two retirement checks: {@link onRequest}, when the adapter never acknowledged the owned breakpoint, and {@link onResponse}, when its reply does not identify every breakpoint.
   * @param position - One breakpoint of the editor's replacement request or of the adapter's reply; a position without a column matches any column of its line.
   * @param verifiedAt - Where the adapter verified the owned breakpoint, which also counts as its place; left out by {@link onRequest}, whose owner was never acknowledged and so was verified nowhere.
   * @returns `true` for the requested position and for the verified place.
   * @example
   * this.isOwnedPosition({ line: 20, column: 5 }) // true for an owner requested at 20:5
   * this.isOwnedPosition({ line: 35 }, { line: 35, column: 5 }) // true
   */
  private isOwnedPosition(
    position: { line?: number; column?: number },
    verifiedAt?: VerifiedPlace,
  ): boolean {
    return [{ line: this.line, column: this.column }, verifiedAt].some(
      (place) =>
        place !== undefined &&
        position.line === place.line &&
        (position.column === undefined || position.column === place.column),
    )
  }

  /** Accepts only a successful matching setBreakpoints response on the requested line, or on another line the owner's rule accepts, at whichever column the adapter bound; a retirement response must exclude the owned stop. @example owned.onResponse(session, response) */
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
      const isOwnAnswer =
        response.success &&
        parsed.success &&
        parsed.data.breakpoints.length === registration.count &&
        this.isIdentifiedBinding(binding, parsed.data.breakpoints) &&
        this.isInOwnedSource(binding)
      if (!isOwnAnswer || !this.acknowledgesPosition(binding)) {
        // The readable positions come first; the JSON keeps every field of the reply for diagnosis.
        registration.failure = `Selected adapter did not acknowledge the breakpoint registration (requested ${this.line}:${this.column}, ${
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
        registration.refusedAt = this.refusedReplyPlace(binding, isOwnAnswer)
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

  /**
   * Tells {@link onResponse} whether the reply's entry for the owned breakpoint identifies one breakpoint the adapter did not fail: the part of an acknowledgement that does not depend on where the breakpoint was bound.
   * @param binding - The entry at the owned breakpoint's index of the reply; `undefined` when the reply holds none there.
   * @param breakpoints - Every entry of the reply.
   * @returns `true` for an entry with an id that no other entry of the reply carries and whose reason is not `failed`; `false` otherwise.
   * @example
   * this.isIdentifiedBinding({ id: 8, verified: true, line: 20, column: 5 }, breakpoints) // => true when no other entry has id 8
   */
  private isIdentifiedBinding(
    binding: RegistrationBinding | undefined,
    breakpoints: RegistrationBinding[],
  ): binding is RegistrationBinding & { id: number } {
    if (binding?.id === undefined || binding.reason === 'failed') return false
    return (
      breakpoints.filter((candidate) => candidate.id === binding.id).length ===
      1
    )
  }

  /** Tells {@link onResponse} whether the reply's entry lies in the owned source; an entry that names no source is taken as the owned one's. @example this.isInOwnedSource({ verified: true, source: { path: '/other/file.ts' } }) // => false */
  private isInOwnedSource(binding: RegistrationBinding): boolean {
    return !(
      binding.source?.path &&
      resolve(binding.source.path) !== resolve(this.path)
    )
  }

  /**
   * Gives {@link onResponse} the place a refused registration reply verified the owned breakpoint at, so the owner can read it with {@link refusedPlace} instead of taking it from the refusal's text.
   * A place is kept only for a reply that was refused for its place alone: a reply that failed, is incomplete, does not identify the breakpoint or names another source says nothing its owner could request again from.
   * @param binding - The owned breakpoint's entry of the refused reply; `undefined` when the reply held none.
   * @param isOwnAnswer - Whether the reply acknowledged the breakpoint in every respect but its place.
   * @returns The verified line and column of a reply refused only because this owner does not accept that place ({@link acknowledgesPosition}); `undefined` for a reply refused for another reason, and for an entry that is unverified or names no whole position.
   * @example
   * this.refusedReplyPlace({ id: 8, verified: true, line: 26, column: 5 }, true) // => { line: 26, column: 5 } for an owner requested at 22:40 whose rule refuses line 26
   */
  private refusedReplyPlace(
    binding: RegistrationBinding | undefined,
    isOwnAnswer: boolean,
  ): VerifiedPlace | undefined {
    if (!isOwnAnswer || !binding) return undefined
    return wholeVerifiedPosition(binding)
  }

  /**
   * Reads where the adapter verified this breakpoint when its owner refuses that place, in the registration reply or in a later `breakpoint` event, so the owner can answer the refusal by requesting the breakpoint elsewhere; {@link ConfiguredBrowserRun} asks it when the registration of a stop it is arming was refused.
   * Like {@link movedTo} it never throws.
   * @param session - The debug session whose adapter answered the registration.
   * @returns The refused line and column, or `undefined` when the session has no registration, the registration stands, or it was refused for another reason than its place (a failed or incomplete reply, an unidentified breakpoint, another source).
   * @example
   * owned.refusedPlace(session) // => { line: 26, column: 5 }
   */
  refusedPlace(session: vscode.DebugSession): VerifiedPlace | undefined {
    return this.registrations.get(session.id)?.refusedAt
  }

  /**
   * Reads the id a session's adapter gave the owned breakpoint, also where its owner refuses the place, so a `stopped` event that names that id is told to belong to this breakpoint; {@link ConfiguredBrowserRun} asks it for the browser session, to which the editor sends a server stop's breakpoint too.
   * Like {@link movedTo} it never throws.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns The adapter's id of the owned breakpoint, or `undefined` while that session's latest registration is unanswered or was refused.
   * @example
   * owned.acknowledgedId(browserSession) // => 12
   */
  acknowledgedId(session: vscode.DebugSession): number | undefined {
    return this.registrations.get(session.id)?.receipt?.breakpointId
  }

  /**
   * Reads current ACK authority synchronously at the final input boundary; {@link registered} also polls it during setup.
   * @param session - The debug session whose adapter acknowledges the breakpoint.
   * @returns A copy of the adapter's current receipt, or `undefined` while the latest registration request is unanswered.
   * @throws An {@link OwnedBreakpointRemovedError} when the owned breakpoint is retired or gone from the editor, a plain error with the adapter's refusal when the registration failed, and an {@link OwnedBreakpointMovedError} while the adapter's latest news has the breakpoint at a place the owner refuses.
   * @example
   * owned.registration(session)?.status // 'pending'
   */
  registration(session: vscode.DebugSession): RegistrationReceipt | undefined {
    if (this.isRetiredOrRemoved()) throw new OwnedBreakpointRemovedError()
    const registration = this.registrations.get(session.id)
    if (!registration) return undefined
    this.assertNotRefused(registration)
    return registration.receipt && { ...registration.receipt }
  }

  /**
   * Says whether the owned breakpoint can no longer be acknowledged at all, so {@link registration} fails with that reason before it reads any receipt.
   * @returns `true` while a retirement is under way, after it, and when the breakpoint is gone from the editor's list (the learner removed it); `false` while the editor still holds it.
   * @example
   * if (this.isRetiredOrRemoved()) throw new OwnedBreakpointRemovedError()
   */
  private isRetiredOrRemoved(): boolean {
    return (
      Boolean(this.retirement) ||
      this.retired ||
      !vscode.debug.breakpoints.some(
        (breakpoint) => breakpoint.id === this.breakpoint.id,
      )
    )
  }

  /**
   * Fails a registration read whose adapter refused the request or moved the breakpoint to a place the owner refuses; called by {@link registration} for the session's current registration, after the removal check and before the receipt is copied.
   * @param registration - The session's current registration: the adapter's refusal text, and the refused place of its latest news.
   * @throws A plain error with the adapter's refusal when the registration failed, otherwise an {@link OwnedBreakpointMovedError} while a refused place stands.
   * @example
   * this.assertNotRefused({ failure: 'Malformed breakpoint registration replacement' }) // throws that text
   */
  private assertNotRefused(registration: {
    failure?: string
    refusedAt?: VerifiedPlace
  }): void {
    if (registration.failure) throw new Error(registration.failure)
    // The adapter's latest news put the acknowledged breakpoint where its owner cannot use it.
    if (registration.refusedAt)
      throw new OwnedBreakpointMovedError(
        { line: this.line, column: this.column },
        registration.refusedAt,
      )
  }

  /**
   * Gives the session's registration only while its acknowledgement stands, for the two reads that never throw, {@link movedTo} and {@link verifiedPlace}.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns The registration, or `undefined` when the session has none, the adapter refused it, or its latest news names a place the owner refuses.
   * @example
   * this.standingRegistration(session)?.verifiedAt // => { line: 33, column: 5 }
   */
  private standingRegistration(session: vscode.DebugSession) {
    const registration = this.registrations.get(session.id)
    if (!registration) return undefined
    return registration.failure || registration.refusedAt
      ? undefined
      : registration
  }

  /**
   * Reads where the adapter currently has this breakpoint when it moved it to another line than requested, for a deadline text that must name that place while it fails a run; {@link ConfiguredBrowserRun} calls it when such a deadline expires.
   * Unlike {@link registration} it never throws: a refused, revoked or retired registration has no moved place, and neither has one the adapter moved to a place the owner refuses.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns The verified line and column of the current acknowledgement, or `undefined` when it is on the requested line, pending, refused or gone.
   * @example
   * owned.movedTo(session) // => { line: 35, column: 5 }
   */
  movedTo(session: vscode.DebugSession): VerifiedPlace | undefined {
    return this.standingRegistration(session)?.receipt?.movedTo
  }

  /**
   * Asks the adapter where it has this breakpoint now and refuses a verified binding on another line than the declared one, for an owner whose first reply was pending and named no position; {@link OwnedNodeTestRun} calls it before it resumes the test.
   * A binding the adapter does not report, or one that is still unverified, decides nothing: the pause check remains.
   * Both editors answer a breakpoint requested at column 1 without a column once the adapter sent news about it, so the binding is read as {@link ConfiguredBrowserRun} reads it: a missing column is taken from the adapter's own report ({@link reportedPlace}, {@link completeBindingPlace}), and without one the line decides. A verified binding on the declared line refuses nothing here, at any column or with none, and the owner's check of its pause at the declared column remains.
   * @param session - The debug session whose adapter holds the breakpoint.
   * @param signal - The caller's cancellation: an adapter that never answers this read must not hold a run that is being stopped.
   * @throws When the adapter reports the breakpoint verified on another line than declared ({@link boundElsewhereRefusalText}); the text names both positions, or the bound line when no column is known. Any column of the declared line is accepted. When the run is cancelled, or the adapter does not answer within the active bound, the wait ends with that reason.
   * @example
   * await owned.assertBoundAsDeclared(session, signal) // throws 'Declared breakpoint 20:5 is bound at 21:12; …'
   */
  async assertBoundAsDeclared(
    session: vscode.DebugSession,
    signal: AbortSignal,
  ): Promise<void> {
    const answered = verifiedLineSchema.safeParse(
      await awaitResponse(
        session.getDebugProtocolBreakpoint(this.breakpoint),
        'owned breakpoint binding',
        signal,
      ),
    ).data
    if (!answered) return
    // The editor may have dropped the column the adapter reported; without any column only the line is known.
    const bound = completeBindingPlace(
      answered,
      this.reportedPlace(session),
    ) ?? { line: answered.line }
    if (this.isAwayFromDeclared(bound))
      throw new Error(
        boundElsewhereRefusalText(
          { line: this.line, column: this.column },
          bound,
        ),
      )
  }

  /**
   * Tells {@link assertBoundAsDeclared} whether a verified binding names another place than the requested position.
   * @param bound - The binding's line and, when one is known, its column.
   * @returns `true` for another line; `false` for any column of the requested line, including a binding without a column.
   * @example
   * this.isAwayFromDeclared({ line: 20 }) // => false for an owner requested at 20:1
   */
  private isAwayFromDeclared(bound: {
    line: number
    column?: number
  }): boolean {
    // The owner takes any column of the declared line, so another column of it is no move.
    return bound.line !== this.line
  }

  /**
   * Reads where the adapter currently has this breakpoint verified, on the requested line or on another line the owner's rule accepted, so a pause can be compared with that exact line before the run binds the stop; {@link ConfiguredBrowserRun} asks it for every pause it admits.
   * Like {@link movedTo} it never throws.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns The verified line and column, or `undefined` while pending, without a whole position, or when refused or gone.
   * @example
   * owned.verifiedPlace(session) // => { line: 33, column: 5 } for a breakpoint verified on its requested line 33
   */
  verifiedPlace(session: vscode.DebugSession): VerifiedPlace | undefined {
    return this.standingRegistration(session)?.verifiedAt
  }

  /**
   * Reads where the adapter itself last reported this breakpoint verified, in its registration reply or in a later `breakpoint` event, whether the owner accepts that place or refuses it; {@link ConfiguredBrowserRun} asks it for the column of a binding the editor answered without one.
   * The tracker reads the adapter's messages before the editor does, so this place keeps the column the editor drops for a breakpoint requested at column 1. Like {@link movedTo} it never throws.
   * @param session - The debug session whose adapter acknowledged the breakpoint.
   * @returns
   * - The refused line and column while the adapter's latest report is refused for its place
   * - Otherwise the verified line and column of the standing acknowledgement
   * - `undefined` while pending, when no report named a whole position, and when the registration was refused for another reason or is gone
   * @example
   * owned.reportedPlace(session) // => { line: 32, column: 11 } for a breakpoint requested at 27:1 that the adapter verified at 32:11
   */
  reportedPlace(session: vscode.DebugSession): VerifiedPlace | undefined {
    return this.refusedPlace(session) ?? this.verifiedPlace(session)
  }

  /**
   * Reads the adapter's later news about the acknowledged breakpoint, a DAP `breakpoint` event; the run forwards every event of a selected session. A pending registration that the adapter verifies when its module loads gains its place here, so a deadline can name a moved place and a pause is compared with the bound line.
   * An event that names a place the owner refuses is the adapter's news that the breakpoint is no longer where its owner can use it: {@link registration} then fails with an {@link OwnedBreakpointMovedError}, as the first reply is refused for the same place, so no input is sent for a stop that cannot be captured; a later event that names an accepted place restores the receipt. An event for another source, or one that names no whole position, is not taken.
   * @param session - The debug session that sent the event.
   * @param event - Any DAP event of that session.
   * @example
   * owned.onEvent(session, { seq: 9, type: 'event', event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 4, verified: true, line: 35, column: 5 } } })
   */
  onEvent(session: vscode.DebugSession, event: DebugProtocol.Event): void {
    if (event.event !== 'breakpoint' || this.retirement) return
    const acknowledged = this.acknowledgedRegistration(session)
    if (acknowledged)
      this.takeBreakpointNews(
        acknowledged.registration,
        acknowledged.receipt,
        event,
      )
  }

  /**
   * Gives {@link onEvent} the session's registration only when the adapter acknowledged the owned breakpoint, since only an acknowledged breakpoint has news.
   * @param session - The debug session that sent the event.
   * @returns The registration with its receipt, or `undefined` when the session has none, the adapter has not answered yet, or it refused the request. A registration whose latest news names a refused place is given, so later news can restore it.
   * @example
   * this.acknowledgedRegistration(session)?.receipt.breakpointId // => 4
   */
  private acknowledgedRegistration(session: vscode.DebugSession) {
    const registration = this.registrations.get(session.id)
    if (!registration?.receipt || registration.failure) return undefined
    return { registration, receipt: registration.receipt }
  }

  /**
   * Tells {@link ownedBreakpointOfEvent} whether a breakpoint the adapter reports is verified and lies in the owned source; news that names no source is taken as the owned one's.
   * @param breakpoint - The breakpoint of a `breakpoint` event.
   * @returns `false` for an unverified breakpoint and for one that names another file.
   * @example
   * this.isVerifiedInOwnedSource({ id: 4, verified: true, source: { path: '/other/file.ts' } }) // => false
   */
  private isVerifiedInOwnedSource(
    breakpoint: z.infer<typeof breakpointEventSchema>['breakpoint'],
  ): boolean {
    if (!breakpoint.verified) return false
    return !(
      breakpoint.source?.path &&
      resolve(breakpoint.source.path) !== resolve(this.path)
    )
  }

  /**
   * Reads the breakpoint a `breakpoint` event reports when it is news about the acknowledged owned one; called by {@link takeBreakpointNews}.
   * @param event - A DAP `breakpoint` event of the session.
   * @param receipt - The receipt of the adapter's acknowledgement, whose breakpoint id tells the owned breakpoint from every other.
   * @returns The reported breakpoint, or `undefined` for a body that does not parse, another breakpoint's id, an unverified breakpoint and another source.
   * @example
   * this.ownedBreakpointOfEvent(event, receipt) // => { id: 4, verified: true, line: 35, column: 5 }
   */
  private ownedBreakpointOfEvent(
    event: DebugProtocol.Event,
    receipt: RegistrationReceipt,
  ) {
    const parsed = breakpointEventSchema.safeParse(event.body)
    if (!parsed.success) return undefined
    const { breakpoint } = parsed.data
    if (breakpoint.id !== receipt.breakpointId) return undefined
    return this.isVerifiedInOwnedSource(breakpoint) ? breakpoint : undefined
  }

  /**
   * Records where the adapter's news puts the acknowledged breakpoint; called by {@link onEvent} for a `breakpoint` event of a session whose registration is acknowledged.
   * @param registration - The session's registration, which gains the verified place and a rebuilt receipt, or the refused place.
   * @param receipt - The registration's receipt as it stood when the event arrived.
   * @param event - The DAP `breakpoint` event.
   * @example
   * this.takeBreakpointNews(registration, receipt, { seq: 9, type: 'event', event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 4, verified: true, line: 35, column: 5 } } })
   */
  private takeBreakpointNews(
    registration: {
      receipt?: RegistrationReceipt
      refusedAt?: VerifiedPlace
    } & VerifiedRegistration,
    receipt: RegistrationReceipt,
    event: DebugProtocol.Event,
  ): void {
    const breakpoint = this.ownedBreakpointOfEvent(event, receipt)
    if (!breakpoint) return
    const { verifiedAt, ...moved } = this.verifiedPlaces(breakpoint)
    if (!verifiedAt) return
    // The adapter moved the acknowledged breakpoint to a place the owner refuses: the earlier receipt no longer stands.
    if (!this.acknowledgesPosition(breakpoint)) {
      registration.refusedAt = verifiedAt
      return
    }
    this.standAt(registration, receipt, verifiedAt, moved)
  }

  /**
   * Makes the acknowledged breakpoint stand at a verified place: the refused place is cleared and the receipt rebuilt, so a place of an earlier reply never outlives the adapter's news; called by {@link takeBreakpointNews} and {@link retakeRefusedPlace}.
   * @param registration - The session's registration.
   * @param receipt - The receipt as it stood; its ids are kept.
   * @param verifiedAt - Where the adapter verified the breakpoint.
   * @param moved - `{ movedTo }` when that place is on another line than requested, `{}` otherwise ({@link verifiedPlaces}).
   * @example
   * this.standAt(registration, receipt, { line: 35, column: 5 }, { movedTo: { line: 35, column: 5 } })
   */
  private standAt(
    registration: {
      receipt?: RegistrationReceipt
      refusedAt?: VerifiedPlace
    } & VerifiedRegistration,
    receipt: RegistrationReceipt,
    verifiedAt: VerifiedPlace,
    moved: { movedTo?: VerifiedPlace },
  ): void {
    registration.refusedAt = undefined
    registration.verifiedAt = verifiedAt
    registration.receipt = {
      sessionId: receipt.sessionId,
      requestSequence: receipt.requestSequence,
      breakpointId: receipt.breakpointId,
      status: 'bound',
      ...moved,
    }
  }

  /**
   * Gives {@link retakeRefusedPlace} the place news was refused at when the owner's rule accepts it now.
   * @param refusedAt - Where the adapter's news put the acknowledged breakpoint when the owner refused it; `undefined` when no news was refused.
   * @returns The place, or `undefined` when nothing was refused or the owner's rule still refuses the place.
   * @example
   * this.refusedPlaceNowAccepted({ line: 32, column: 11 }) // => { line: 32, column: 11 } once the rebuilt rule accepts line 32
   */
  private refusedPlaceNowAccepted(
    refusedAt: VerifiedPlace | undefined,
  ): VerifiedPlace | undefined {
    return refusedAt &&
      this.acknowledgesPosition({ verified: true, ...refusedAt })
      ? refusedAt
      : undefined
  }

  /**
   * Judges the place the adapter's latest news put the acknowledged breakpoint at once more, after its owner's rule changed; {@link ConfiguredBrowserRun} calls it when the debugger's own break locations accept a place the source map alone refused ({@link ConfiguredBrowserRun.registeredStop}).
   * Only news can be judged again: a registration reply that was refused keeps its failure, because the reply's breakpoint was never taken as the owned one, and its owner requests the breakpoint again instead.
   * @param session - The debug session whose adapter sent the news.
   * @returns `true` when the session's acknowledged breakpoint had a refused place that the owner's rule now accepts, and the receipt stands there; `false` otherwise, and nothing changes.
   * @example
   * owned.retakeRefusedPlace(session) // => true for news at 32:11 that the rebuilt rule accepts
   */
  retakeRefusedPlace(session: vscode.DebugSession): boolean {
    const acknowledged = this.acknowledgedRegistration(session),
      refusedAt = this.refusedPlaceNowAccepted(
        acknowledged?.registration.refusedAt,
      )
    // Nothing was refused by news, or the owner's rule still refuses the place.
    if (!acknowledged || !refusedAt) return false
    const { verifiedAt, ...moved } = this.verifiedPlaces({
      verified: true,
      ...refusedAt,
    })
    this.standAt(
      acknowledged.registration,
      acknowledged.receipt,
      verifiedAt ?? refusedAt,
      moved,
    )
    return true
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
