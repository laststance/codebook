import * as path from 'node:path'

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

import { isInsideFolder } from './isInsideFolder'
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
  /** The opened workspace folder: a caller frame's recorded path inside it is kept relative to it; any other path is dropped and only the name is kept, so no home or storage path is saved. Absent means no path is kept. */
  workspaceRoot?: string
  /** Masks the values a Vite run learned from its env files in every saved string; absent for a run without such values. */
  maskKnownText?(text: string): string
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

/**
 * Says whether a frame's reported name is a place rather than a bare file name: an absolute path of either host, a URL or a drive path.
 *
 * Called by {@link recordedLocationOf}.
 *
 * @param name - The name the debugger reported.
 * @returns `true` for `/home/me/x.js`, `C:\\Users\\me\\x.js`, `file:///Users/me/x.js` and `http://localhost/x.js`; `false` for `x.js` and `src/x.js`.
 * @example namesALocationOutsideTheWorkspace('file:///Users/me/x.js') // => true
 */
function namesALocationOutsideTheWorkspace(name: string): boolean {
  return (
    path.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    // A scheme (`file:`, `http:`, `webpack:`) or a drive letter (`C:`).
    /^[a-z][a-z0-9+.-]*:/i.test(name)
  )
}

/**
 * Cuts a place down to its last segment, without a URL's query or fragment.
 *
 * Called by {@link recordedLocationOf}.
 *
 * @param name - A name {@link namesALocationOutsideTheWorkspace} accepted.
 * @returns The last non-empty segment, split at `/` and `\\`; only a URL loses its `?` query and `#` fragment first, since a file path may hold `?` or `#` in a folder name.
 * @example
 * lastSegmentOf('C:\\Users\\me\\x.js') // => 'x.js'
 * lastSegmentOf('/home/me/c#/x.js') // => 'x.js'
 * lastSegmentOf('http://localhost/x.js?v=2') // => 'x.js'
 */
function lastSegmentOf(name: string): string {
  // A URL scheme has two characters or more; a one-letter `C:` is a drive path.
  const isUrl = /^[a-z][a-z0-9+.-]+:/i.test(name)
  const withoutQuery = isUrl ? (name.split(/[?#]/, 1)[0] ?? name) : name
  const segments = withoutQuery.split(/[/\\]/).filter(Boolean)
  return segments.at(-1) ?? name
}

/**
 * Keeps the source name and path a live debugger reported for one stack frame, for the replay Call Stack of frames whose executed text was not verified.
 *
 * Called by {@link captureReplayDebugSnapshot} for every frame below the top one.
 *
 * @param source - The DAP source of the frame, absent when the debugger gave none.
 * @param shorten - The capture's masking and length cut applied to each text.
 * @param workspaceRoot - The opened workspace folder; a path outside it (or any path without it) is not kept.
 * @returns `{ recordedLocation }` with the name (and a workspace-relative path when the source lies inside the workspace), or an empty object when the frame had no named source.
 * @example
 * recordedLocationOf({ name: 'app.ts', path: '/repo/src/app.ts' }, (text) => text, '/repo') // => { recordedLocation: { name: 'app.ts', path: 'src/app.ts' } }
 * recordedLocationOf({ name: 'x.js', path: '/Users/me/x.js' }, (text) => text, '/repo') // => { recordedLocation: { name: 'x.js' } }
 * recordedLocationOf(undefined, (text) => text) // => {}
 */
function recordedLocationOf(
  source: DebugProtocol.Source | undefined,
  shorten: (value: string) => string,
  workspaceRoot?: string,
): Pick<ReplayDebugSnapshot['frames'][number], 'recordedLocation'> {
  // A name that is itself an absolute path, a URL or a drive path (any host's) would carry the home folder or an address, so only its last segment is kept.
  const reportedName = source?.name ?? source?.path
  const name =
    reportedName && namesALocationOutsideTheWorkspace(reportedName)
      ? lastSegmentOf(reportedName)
      : reportedName
  // A frame without any reported name or path has no location to keep
  if (!source || !name) return {}
  // Only a path inside the workspace is kept, relative to it; home, storage and URL paths are dropped.
  const keptPath =
    workspaceRoot !== undefined &&
    source.path !== undefined &&
    // A relative or URL-like path would resolve against the host's working folder, so only an absolute one is compared.
    path.isAbsolute(source.path) &&
    isInsideFolder(workspaceRoot, source.path)
      ? path.relative(workspaceRoot, source.path).split(path.sep).join('/')
      : undefined
  return {
    recordedLocation: {
      name: shorten(name),
      ...(keptPath !== undefined && { path: shorten(keptPath) }),
    },
  }
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
    const masked = redactSecretText(input.maskKnownText?.(value) ?? value)
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
    // As captureVariables: a scope without a handle is empty, and a spent budget sends no request.
    if (handle === 0) return { variables, pending }
    if (snapshot.variables.length >= maxVariables)
      return {
        variables,
        pending,
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
            // The location the debugger itself reported is kept so the replay Call Stack can name the file; nothing is invented when the debugger gave none.
            ...recordedLocationOf(frame.source, shorten, input.workspaceRoot),
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
