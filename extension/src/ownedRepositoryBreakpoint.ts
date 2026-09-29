import * as vscode from 'vscode';
import { resolve } from 'node:path';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { z } from 'zod';
import { awaitResponse } from './runtimeSupport/utils/awaitResponse';
import { waitUntil } from './runtimeSupport/utils/waitUntil';
import { ACTIVE_TIMEOUT_MS } from './constants';

const requestSourceSchema = z.object({ source: z.object({ path: z.string() }) });
const requestSchema = requestSourceSchema.extend({ sourceModified: z.boolean().optional(),
  breakpoints: z.array(z.object({ line: z.number().int(), column: z.number().int().optional(), condition: z.string().optional(), hitCondition: z.string().optional(), logMessage: z.string().optional() })) });
const responseSchema = z.object({ breakpoints: z.array(z.object({ line: z.number().int().optional(), column: z.number().int().optional() })) });
const registrationResponseSchema = z.object({ breakpoints: z.array(z.object({
  id: z.number().int().optional(), verified: z.boolean(), line: z.number().int().optional(), column: z.number().int().optional(),
  source: z.object({ path: z.string().optional() }).optional(), reason: z.enum(['pending', 'failed']).optional(),
})) });
type RegistrationReceipt = { sessionId: string; requestSequence: number; breakpointId: number; status: 'pending' | 'bound' };

/** Removes only one installed breakpoint and requires its selected adapter's replacement ACK before continuation. @example await owned.retire(selected, signal) */
export class OwnedRepositoryBreakpoint {
  readonly breakpoint: vscode.SourceBreakpoint;
  private readonly registrations = new Map<string, { requestSequence: number; index: number; count: number; receipt?: RegistrationReceipt; failure?: string }>();
  private retirement?: { sessionId: string; requestSequence?: number; confirmed: boolean; failure?: string };
  retired = false;
  constructor(readonly path: string, readonly line: number, readonly column: number) {
    this.breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(path), new vscode.Position(line - 1, column - 1)));
    vscode.debug.addBreakpoints([this.breakpoint]);
  }

  /** Tracks exact-source registration or removal requests; the native tracker calls this before adapter dispatch. @example owned.onRequest(session, request) */
  onRequest(session: vscode.DebugSession, request: DebugProtocol.Request): void {
    const retirement = this.retirement;
    if (request.command !== 'setBreakpoints') return;
    const source = requestSourceSchema.safeParse(request.arguments);
    if (source.success && resolve(source.data.source.path) !== resolve(this.path)) return;
    const parsed = requestSchema.safeParse(request.arguments);
    if (!parsed.success) {
      // An unparseable replacement cannot leave the preceding registration authoritative.
      if (retirement?.sessionId === session.id) retirement.failure = 'Malformed breakpoint replacement during retirement';
      else this.registrations.set(session.id, { requestSequence: request.seq, index: -1, count: 0, failure: 'Malformed breakpoint registration replacement' });
      return;
    }
    if (!retirement) {
      const matches = parsed.data.breakpoints.flatMap((position, index) => position.line === this.line && position.column === this.column ? [index] : []);
      const position = parsed.data.breakpoints[matches[0] ?? -1];
      // A later replacement immediately revokes a prior ACK, including when it removes this position.
      this.registrations.set(session.id, { requestSequence: request.seq, index: matches[0] ?? -1, count: parsed.data.breakpoints.length,
        failure: matches.length !== 1 ? 'Selected breakpoint registration is absent or ambiguous'
          : parsed.data.sourceModified || position?.condition !== undefined || position?.hitCondition !== undefined || position?.logMessage !== undefined ? 'Selected breakpoint registration changed source or pause behavior' : undefined });
      return;
    }
    if (session.id !== retirement.sessionId) return;
    // A same-position learner breakpoint cannot be disabled to satisfy this run's one-stop contract.
    if (parsed.data.breakpoints.some(position => position.line === this.line && (position.column === undefined || position.column === this.column))) {
      retirement.failure = 'A breakpoint still targets the selected position; owned removal cannot retire learner breakpoints.'; return;
    }
    retirement.requestSequence = request.seq; retirement.confirmed = false;
  }

  /** Accepts only a successful matching setBreakpoints response whose resolved positions also exclude the owned stop. @example owned.onResponse(session, response) */
  onResponse(session: vscode.DebugSession, response: DebugProtocol.Response): void {
    if (response.command !== 'setBreakpoints') return;
    const registration = this.registrations.get(session.id);
    if (!this.retirement && registration?.requestSequence === response.request_seq && !registration.failure) {
      const parsed = registrationResponseSchema.safeParse(response.body);
      const binding = parsed.success ? parsed.data.breakpoints[registration.index] : undefined;
      // DAP preserves request order; never select an arbitrary matching line from a truncated/reordered response.
      if (!response.success || !parsed.success || parsed.data.breakpoints.length !== registration.count || !binding || binding.id === undefined || binding.reason === 'failed'
        || parsed.data.breakpoints.filter(candidate => candidate.id === binding.id).length !== 1
        || binding.source?.path && resolve(binding.source.path) !== resolve(this.path)
        || binding.line !== undefined && binding.line !== this.line || binding.column !== undefined && binding.column !== this.column
        || binding.verified && (binding.line !== this.line || binding.column !== this.column)) {
        registration.failure = `Selected adapter did not acknowledge the exact breakpoint registration: ${JSON.stringify({
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
          selectedSourceMatches: binding?.source?.path ? resolve(binding.source.path) === resolve(this.path) : null,
        })}`;
      } else registration.receipt = { sessionId: session.id, requestSequence: response.request_seq, breakpointId: binding.id, status: binding.verified ? 'bound' : 'pending' };
    }
    const retirement = this.retirement;
    if (!retirement || session.id !== retirement.sessionId || response.command !== 'setBreakpoints' || response.request_seq !== retirement.requestSequence) return;
    const parsed = responseSchema.safeParse(response.body);
    if (!response.success || !parsed.success || parsed.data.breakpoints.some(position => position.line === this.line && (position.column === undefined || position.column === this.column))) {
      retirement.failure = 'Selected adapter did not confirm retirement of the owned breakpoint.'; return;
    }
    retirement.confirmed = true;
  }

  /** Reads current ACK authority synchronously at the final input boundary; {@link registered} also polls it during setup. @example owned.registration(session)?.status // 'pending' */
  registration(session: vscode.DebugSession): RegistrationReceipt | undefined {
    if (this.retirement || this.retired || !vscode.debug.breakpoints.some(breakpoint => breakpoint.id === this.breakpoint.id)) throw new Error('Owned breakpoint was removed before registration');
    const registration = this.registrations.get(session.id);
    if (registration?.failure) throw new Error(registration.failure);
    return registration?.receipt && { ...registration.receipt };
  }

  /** Waits for the chosen adapter's ACK without claiming that a lazy module has loaded; runtime preparation calls this before input. @example (await owned.registered(session, signal)).status // 'pending' */
  async registered(session: vscode.DebugSession, signal: AbortSignal): Promise<RegistrationReceipt> {
    return waitUntil(() => this.registration(session), 'acknowledged native breakpoint registration', ACTIVE_TIMEOUT_MS, signal);
  }

  /** Waits for actual adapter retirement as well as editor identity removal; an editor-only disappearance is insufficient. @example await owned.retire(selected, signal) */
  async retire(session: vscode.DebugSession, signal: AbortSignal): Promise<void> {
    if (this.retired) return;
    if (this.retirement) throw new Error('Breakpoint retirement already pending');
    // The learner already removed it and the editor's latest replacement for this session excluded it; no further request will confirm removal.
    if (!vscode.debug.breakpoints.some(breakpoint => breakpoint.id === this.breakpoint.id) && this.registrations.get(session.id)?.index === -1) {
      await waitUntil(async () => await awaitResponse(session.getDebugProtocolBreakpoint(this.breakpoint), 'owned breakpoint retirement', signal) === undefined,
        'adapter release of the learner-removed owned breakpoint', ACTIVE_TIMEOUT_MS, signal);
      signal.throwIfAborted(); this.registrations.clear(); this.retired = true;
      return;
    }
    const retirement = this.retirement = { sessionId: session.id, confirmed: false };
    this.remove();
    await waitUntil(async () => {
      if (this.retirement?.failure) throw new Error(this.retirement.failure);
      if (!retirement.confirmed || vscode.debug.breakpoints.some(breakpoint => breakpoint.id === this.breakpoint.id)) return false;
      const remaining = await awaitResponse(session.getDebugProtocolBreakpoint(this.breakpoint), 'owned breakpoint retirement', signal);
      return remaining === undefined;
    }, 'confirmed owned breakpoint retirement', ACTIVE_TIMEOUT_MS, signal);
    signal.throwIfAborted(); this.retired = true;
  }

  /** Releases only the acquired editor breakpoint during cancellation; it never clears a whole source or another owner's breakpoints. @example owned.remove() */
  remove(): void { this.registrations.clear(); vscode.debug.removeBreakpoints([this.breakpoint]); }
}
