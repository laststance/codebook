import type { DebugProtocol } from '@vscode/debugprotocol'
import { z } from 'zod'

import {
  REDACTION_MASK,
  REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  REPLAY_DEBUG_MAX_DEPTH,
  REPLAY_DEBUG_MAX_FRAMES,
  REPLAY_DEBUG_MAX_SCOPES,
  REPLAY_DEBUG_MAX_VARIABLES,
  REPLAY_DEBUG_TEXT_LIMIT_CHARS,
  REPLAY_DEBUG_TRUNCATION_MARKER,
  REPLAY_SCOPE_NOT_CAPTURED_TEXT,
} from '../constants'
import {
  replayDebugSnapshotSchema,
  type ReplayDebugSnapshot,
} from '../replayDebugSchemas'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'

import { isSecretName } from './isSecretName'
import { redactSecretText } from './redactSecretText'
import { redactValuePreview } from './redactValuePreview'
import { shouldCaptureReplayScope } from './shouldCaptureReplayScope'

const scopeResponse = z.object({
  scopes: z.array(
    z.object({
      name: z.string(),
      presentationHint: z.string().optional(),
      variablesReference: z.number().int().nonnegative(),
    }),
  ),
})
const variableResponse = z.object({
  variables: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      type: z.string().optional(),
      variablesReference: z.number().int().nonnegative(),
    }),
  ),
})
interface CaptureInput {
  stack: DebugProtocol.StackTraceResponse['body']
  verifiedSource: NonNullable<ReplayDebugSnapshot['frames'][number]['source']>
  request(
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ): PromiseLike<unknown>
  assertCurrent(): void
  signal?: AbortSignal
  limits?: {
    timeoutMs: number
    maxFrames: number
    maxVariables: number
    maxDepth: number
    includeScope?(frameIndex: number, scopeName: string): boolean
    /** Saves every top-level variable of the stopped frame's captured scopes before expanding any of them, so one large object (a page's `this`) cannot use the whole budget before the locals; the chrome-extension debugger asks for it. Accepted limit: top-level values are guaranteed, but the second pass still expands children in adapter order, so a huge first value can use the child budget before later locals' children (children are best effort within the budget). */
    topLevelFirst?: boolean
  }
}

/** A top-level variable saved without its children, waiting for the second pass of a top-level-first capture. */
type PendingExpansion = {
  index: number
  variable: z.infer<typeof variableResponse>['variables'][number]
  scopeHandle: number
}

/** Called at a verified live pause to persist bounded values, never live DAP handles; stale pauses abort the whole capture. Only the stopped frame's local scopes are copied ({@link shouldCaptureReplayScope}). @example await captureReplayDebugSnapshot({ stack, verifiedSource, request, assertCurrent }) */
export async function captureReplayDebugSnapshot(
  input: CaptureInput,
): Promise<ReplayDebugSnapshot> {
  const snapshot: ReplayDebugSnapshot = {
    version: 1,
    frames: [],
    variables: [],
    limitations: [],
  }
  const timeoutMs = Math.min(
    input.limits?.timeoutMs ?? REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
    REPLAY_DEBUG_CAPTURE_TIMEOUT_MS,
  )
  const maxFrames = Math.min(
    input.limits?.maxFrames ?? REPLAY_DEBUG_MAX_FRAMES,
    REPLAY_DEBUG_MAX_FRAMES,
  )
  const maxVariables = Math.min(
    input.limits?.maxVariables ?? REPLAY_DEBUG_MAX_VARIABLES,
    REPLAY_DEBUG_MAX_VARIABLES,
  )
  const maxDepth = Math.min(
    input.limits?.maxDepth ?? REPLAY_DEBUG_MAX_DEPTH,
    REPLAY_DEBUG_MAX_DEPTH,
  )
  // Every stop copies only its own local values; a caller filter can only narrow that policy, never widen it.
  const includeScope = (
    frameIndex: number,
    scopeName: string,
    presentationHint?: string,
  ) =>
    shouldCaptureReplayScope(frameIndex, scopeName, presentationHint) &&
    (input.limits?.includeScope?.(frameIndex, scopeName) ?? true)
  const deadline = performance.now() + timeoutMs
  // Masks secrets before the cut, for every field: a secret straddling the cut would otherwise leave a fragment shorter than any pattern's minimum.
  const shorten = (value: string) => {
    const masked = redactSecretText(value)
    return masked.length <= REPLAY_DEBUG_TEXT_LIMIT_CHARS
      ? masked
      : `${masked.slice(0, REPLAY_DEBUG_TEXT_LIMIT_CHARS - REPLAY_DEBUG_TRUNCATION_MARKER.length)}${REPLAY_DEBUG_TRUNCATION_MARKER}`
  }
  const read = async (
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ) => {
    input.assertCurrent()
    input.signal?.throwIfAborted()
    const remaining = deadline - performance.now()
    if (remaining <= 0)
      throw new Error('Historical debugger capture time limit reached.')
    const result = await awaitResponse(
      input.request(command, arguments_),
      `historical ${command}`,
      input.signal,
      remaining,
    )
    input.assertCurrent()
    input.signal?.throwIfAborted()
    return result
  }
  const unavailable = (error: unknown) => {
    // A target resume/cancellation is not a partial snapshot of the old pause.
    input.assertCurrent()
    input.signal?.throwIfAborted()
    return shorten(error instanceof Error ? error.message : String(error))
  }
  const captureVariables = async (
    handle: number,
    depth: number,
    ancestors: Set<number>,
  ): Promise<{ variables: number[]; unavailable?: string }> => {
    if (handle === 0) return { variables: [] }
    if (ancestors.has(handle))
      return {
        variables: [],
        unavailable: 'Cyclic debugger reference was not expanded.',
      }
    if (depth >= maxDepth)
      return {
        variables: [],
        unavailable: 'Historical variable depth limit reached.',
      }
    if (snapshot.variables.length >= maxVariables)
      return {
        variables: [],
        unavailable: 'Historical variable count limit reached.',
      }
    try {
      const response = variableResponse.parse(
        await read('variables', {
          variablesReference: handle,
          start: 0,
          count: maxVariables + 1,
        }),
      )
      const variables: number[] = [],
        nextAncestors = new Set(ancestors).add(handle)
      for (const variable of response.variables) {
        if (snapshot.variables.length >= maxVariables)
          return {
            variables,
            unavailable: 'Historical variable count limit reached.',
          }
        const index = saveVariable(variable)
        variables.push(index)
        await expandVariable(index, variable, depth + 1, nextAncestors)
      }
      return { variables }
    } catch (error) {
      return { variables: [], unavailable: unavailable(error) }
    }
  }
  /** Saves one adapter variable without its children and returns its index. */
  const saveVariable = (variable: PendingExpansion['variable']): number => {
    // Redaction contract: a secret-named variable keeps its name and type but reads [masked], and its subtree is neither read nor saved; any other value is masked where a secret-named member shows in its preview or where it looks like a credential. Masking comes before shortening.
    snapshot.variables.push({
      name: shorten(variable.name),
      value: isSecretName(variable.name)
        ? REDACTION_MASK
        : shorten(redactValuePreview(variable.value)),
      type: variable.type && shorten(variable.type),
      children: [],
    })
    return snapshot.variables.length - 1
  }
  /** Reads a saved variable's children into it; a secret-named variable's subtree is never read. */
  const expandVariable = async (
    index: number,
    variable: PendingExpansion['variable'],
    depth: number,
    ancestors: Set<number>,
  ): Promise<void> => {
    if (isSecretName(variable.name)) return
    const nested = await captureVariables(
      variable.variablesReference,
      depth,
      ancestors,
    )
    const saved = snapshot.variables[index]!
    saved.children = nested.variables
    saved.unavailable = nested.unavailable
  }
  /** Saves one scope's own variables without their children, for the first pass of a top-level-first capture. */
  const captureScopeShallow = async (
    handle: number,
  ): Promise<{
    variables: number[]
    pending: PendingExpansion[]
    unavailable?: string
  }> => {
    const variables: number[] = [],
      pending: PendingExpansion[] = []
    try {
      const response = variableResponse.parse(
        await read('variables', {
          variablesReference: handle,
          start: 0,
          count: maxVariables + 1,
        }),
      )
      for (const variable of response.variables) {
        if (snapshot.variables.length >= maxVariables)
          return {
            variables,
            pending,
            unavailable: 'Historical variable count limit reached.',
          }
        const index = saveVariable(variable)
        variables.push(index)
        pending.push({ index, variable, scopeHandle: handle })
      }
      return { variables, pending }
    } catch (error) {
      return { variables, pending, unavailable: unavailable(error) }
    }
  }
  if (
    (input.stack.totalFrames ?? input.stack.stackFrames.length) >
    Math.min(input.stack.stackFrames.length, maxFrames)
  )
    snapshot.limitations.push('Call stack is truncated.')
  for (const [index, frame] of input.stack.stackFrames
    .slice(0, maxFrames)
    .entries()) {
    const saved: ReplayDebugSnapshot['frames'][number] = {
      name: shorten(frame.name),
      line: Math.max(1, frame.line),
      column: Math.max(1, frame.column),
      scopes: [],
      ...(index === 0
        ? { source: input.verifiedSource }
        : {
            sourceUnavailable:
              'Executed source was not verified for this frame.',
          }),
    }
    snapshot.frames.push(saved)
    try {
      const response = scopeResponse.parse(
        await read('scopes', { frameId: frame.id }),
      )
      if (response.scopes.length > REPLAY_DEBUG_MAX_SCOPES)
        saved.unavailable = 'Historical scope count limit reached.'
      const pending: PendingExpansion[] = []
      for (const scope of response.scopes.slice(0, REPLAY_DEBUG_MAX_SCOPES)) {
        if (!includeScope(index, scope.name, scope.presentationHint)) {
          saved.scopes.push({
            name: shorten(scope.name),
            variables: [],
            unavailable: REPLAY_SCOPE_NOT_CAPTURED_TEXT,
          })
          continue
        }
        if (input.limits?.topLevelFirst) {
          const shallow = await captureScopeShallow(scope.variablesReference)
          pending.push(...shallow.pending)
          saved.scopes.push({
            name: shorten(scope.name),
            variables: shallow.variables,
            ...(shallow.unavailable !== undefined && {
              unavailable: shallow.unavailable,
            }),
          })
          continue
        }
        saved.scopes.push({
          name: shorten(scope.name),
          ...(await captureVariables(scope.variablesReference, 0, new Set())),
        })
      }
      // Every top-level value is kept before any is expanded; the expansions share what the budget leaves.
      for (const entry of pending)
        await expandVariable(
          entry.index,
          entry.variable,
          1,
          new Set([entry.scopeHandle]),
        )
    } catch (error) {
      saved.unavailable = unavailable(error)
    }
  }
  input.assertCurrent()
  input.signal?.throwIfAborted()
  return replayDebugSnapshotSchema.parse(snapshot)
}
