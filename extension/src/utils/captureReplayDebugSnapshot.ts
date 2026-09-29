import type { DebugProtocol } from '@vscode/debugprotocol';
import { z } from 'zod';
import { REPLAY_DEBUG_CAPTURE_TIMEOUT_MS, REPLAY_DEBUG_MAX_DEPTH, REPLAY_DEBUG_MAX_FRAMES, REPLAY_DEBUG_MAX_SCOPES, REPLAY_DEBUG_MAX_VARIABLES, REPLAY_DEBUG_TEXT_LIMIT_CHARS } from '../constants';
import { replayDebugSnapshotSchema, type ReplayDebugSnapshot } from '../replayDebugSchemas';
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse';
import { shouldCaptureReplayScope } from './shouldCaptureReplayScope';

const scopeResponse = z.object({ scopes: z.array(z.object({ name: z.string(), variablesReference: z.number().int().nonnegative() })) });
const variableResponse = z.object({ variables: z.array(z.object({ name: z.string(), value: z.string(), type: z.string().optional(), variablesReference: z.number().int().nonnegative() })) });
interface CaptureInput {
  stack: DebugProtocol.StackTraceResponse['body'];
  verifiedSource: NonNullable<ReplayDebugSnapshot['frames'][number]['source']>;
  request(command: 'scopes' | 'variables', arguments_: Record<string, number>): PromiseLike<unknown>;
  assertCurrent(): void;
  signal?: AbortSignal;
  limits?: { timeoutMs: number; maxFrames: number; maxVariables: number; maxDepth: number; includeScope?(frameIndex: number, scopeName: string): boolean };
}

/** Called at a verified live pause to persist bounded values, never live DAP handles; stale pauses abort the whole capture. Only the stopped frame's local scopes are copied ({@link shouldCaptureReplayScope}). @example await captureReplayDebugSnapshot({ stack, verifiedSource, request, assertCurrent }) */
export async function captureReplayDebugSnapshot(input: CaptureInput): Promise<ReplayDebugSnapshot> {
  const snapshot: ReplayDebugSnapshot = { version: 1, frames: [], variables: [], limitations: [] };
  const timeoutMs = Math.min(input.limits?.timeoutMs ?? REPLAY_DEBUG_CAPTURE_TIMEOUT_MS, REPLAY_DEBUG_CAPTURE_TIMEOUT_MS);
  const maxFrames = Math.min(input.limits?.maxFrames ?? REPLAY_DEBUG_MAX_FRAMES, REPLAY_DEBUG_MAX_FRAMES);
  const maxVariables = Math.min(input.limits?.maxVariables ?? REPLAY_DEBUG_MAX_VARIABLES, REPLAY_DEBUG_MAX_VARIABLES);
  const maxDepth = Math.min(input.limits?.maxDepth ?? REPLAY_DEBUG_MAX_DEPTH, REPLAY_DEBUG_MAX_DEPTH);
  // Every stop copies only its own local values unless a caller narrows the policy further.
  const includeScope = input.limits?.includeScope ?? shouldCaptureReplayScope;
  const deadline = performance.now() + timeoutMs;
  const shorten = (value: string) => value.length <= REPLAY_DEBUG_TEXT_LIMIT_CHARS ? value : `${value.slice(0, REPLAY_DEBUG_TEXT_LIMIT_CHARS - '… [truncated]'.length)}… [truncated]`;
  const read = async (command: 'scopes' | 'variables', arguments_: Record<string, number>) => {
    input.assertCurrent(); input.signal?.throwIfAborted();
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error('Historical debugger capture time limit reached.');
    const result = await awaitResponse(input.request(command, arguments_), `historical ${command}`, input.signal, remaining);
    input.assertCurrent(); input.signal?.throwIfAborted(); return result;
  };
  const unavailable = (error: unknown) => {
    // A target resume/cancellation is not a partial snapshot of the old pause.
    input.assertCurrent(); input.signal?.throwIfAborted();
    return shorten(error instanceof Error ? error.message : String(error));
  };
  const captureVariables = async (handle: number, depth: number, ancestors: Set<number>): Promise<{ variables: number[]; unavailable?: string }> => {
    if (handle === 0) return { variables: [] };
    if (ancestors.has(handle)) return { variables: [], unavailable: 'Cyclic debugger reference was not expanded.' };
    if (depth >= maxDepth) return { variables: [], unavailable: 'Historical variable depth limit reached.' };
    if (snapshot.variables.length >= maxVariables) return { variables: [], unavailable: 'Historical variable count limit reached.' };
    try {
      const response = variableResponse.parse(await read('variables', { variablesReference: handle, start: 0, count: maxVariables + 1 }));
      const variables: number[] = [], nextAncestors = new Set(ancestors).add(handle);
      for (const variable of response.variables) {
        if (snapshot.variables.length >= maxVariables) return { variables, unavailable: 'Historical variable count limit reached.' };
        const index = snapshot.variables.length;
        const saved: ReplayDebugSnapshot['variables'][number] = { name: shorten(variable.name), value: shorten(variable.value), type: variable.type && shorten(variable.type), children: [] };
        snapshot.variables.push(saved); variables.push(index);
        const nested = await captureVariables(variable.variablesReference, depth + 1, nextAncestors);
        saved.children = nested.variables; saved.unavailable = nested.unavailable;
      }
      return { variables };
    } catch (error) { return { variables: [], unavailable: unavailable(error) }; }
  };
  if ((input.stack.totalFrames ?? input.stack.stackFrames.length) > Math.min(input.stack.stackFrames.length, maxFrames)) snapshot.limitations.push('Call stack is truncated.');
  for (const [index, frame] of input.stack.stackFrames.slice(0, maxFrames).entries()) {
    const saved: ReplayDebugSnapshot['frames'][number] = { name: shorten(frame.name), line: Math.max(1, frame.line), column: Math.max(1, frame.column), scopes: [],
      ...(index === 0 ? { source: input.verifiedSource } : { sourceUnavailable: 'Executed source was not verified for this frame.' }) };
    snapshot.frames.push(saved);
    try {
      const response = scopeResponse.parse(await read('scopes', { frameId: frame.id }));
      if (response.scopes.length > REPLAY_DEBUG_MAX_SCOPES) saved.unavailable = 'Historical scope count limit reached.';
      for (const scope of response.scopes.slice(0, REPLAY_DEBUG_MAX_SCOPES)) {
        if (!includeScope(index, scope.name)) {
          saved.scopes.push({ name: shorten(scope.name), variables: [], unavailable: 'This scope was not captured; replay keeps only the stopped frame\'s local values.' });
          continue;
        }
        saved.scopes.push({ name: shorten(scope.name), ...await captureVariables(scope.variablesReference, 0, new Set()) });
      }
    } catch (error) { saved.unavailable = unavailable(error); }
  }
  input.assertCurrent(); input.signal?.throwIfAborted();
  return replayDebugSnapshotSchema.parse(snapshot);
}
