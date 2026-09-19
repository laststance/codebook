import * as vscode from 'vscode';
import { resolve } from 'node:path';
import type { DebugProtocol } from '@vscode/debugprotocol';
import { z } from 'zod';
import { awaitResponse } from 'codebook-cycle-0001/dist/utils/awaitResponse';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { ACTIVE_TIMEOUT_MS } from './constants';

const requestSchema = z.object({ source: z.object({ path: z.string() }), breakpoints: z.array(z.object({ line: z.number().int(), column: z.number().int().optional() })) });
const responseSchema = z.object({ breakpoints: z.array(z.object({ line: z.number().int().optional(), column: z.number().int().optional() })) });

/** Removes only one installed breakpoint and requires its selected adapter's replacement ACK before continuation. @example await owned.retire(selected, signal) */
export class OwnedRepositoryBreakpoint {
  readonly breakpoint: vscode.SourceBreakpoint;
  private retirement?: { sessionId: string; requestSequence?: number; confirmed: boolean; failure?: string };
  retired = false;
  constructor(readonly path: string, readonly line: number, readonly column: number) {
    this.breakpoint = new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(path), new vscode.Position(line - 1, column - 1)));
    vscode.debug.addBreakpoints([this.breakpoint]);
  }

  /** Records only post-removal replacements for the selected target and exact source; tracker calls it before dispatch. @example owned.onRequest(session, request) */
  onRequest(session: vscode.DebugSession, request: DebugProtocol.Request): void {
    const retirement = this.retirement;
    if (!retirement || session.id !== retirement.sessionId || request.command !== 'setBreakpoints') return;
    const parsed = requestSchema.safeParse(request.arguments);
    if (!parsed.success || resolve(parsed.data.source.path) !== resolve(this.path)) return;
    // A same-position learner breakpoint cannot be disabled to satisfy this run's one-stop contract.
    if (parsed.data.breakpoints.some(position => position.line === this.line && (position.column === undefined || position.column === this.column))) {
      retirement.failure = 'A breakpoint still targets the selected position; owned removal cannot retire learner breakpoints.'; return;
    }
    retirement.requestSequence = request.seq; retirement.confirmed = false;
  }

  /** Accepts only a successful matching setBreakpoints response whose resolved positions also exclude the owned stop. @example owned.onResponse(session, response) */
  onResponse(session: vscode.DebugSession, response: DebugProtocol.Response): void {
    const retirement = this.retirement;
    if (!retirement || session.id !== retirement.sessionId || response.command !== 'setBreakpoints' || response.request_seq !== retirement.requestSequence) return;
    const parsed = responseSchema.safeParse(response.body);
    if (!response.success || !parsed.success || parsed.data.breakpoints.some(position => position.line === this.line && (position.column === undefined || position.column === this.column))) {
      retirement.failure = 'Selected adapter did not confirm retirement of the owned breakpoint.'; return;
    }
    retirement.confirmed = true;
  }

  /** Waits for actual adapter retirement as well as editor identity removal; an editor-only disappearance is insufficient. @example await owned.retire(selected, signal) */
  async retire(session: vscode.DebugSession, signal: AbortSignal): Promise<void> {
    if (this.retired) return;
    if (this.retirement) throw new Error('Breakpoint retirement already pending');
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
  remove(): void { vscode.debug.removeBreakpoints([this.breakpoint]); }
}
