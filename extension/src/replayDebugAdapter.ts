import type { DebugProtocol } from '@vscode/debugprotocol'
import { z } from 'zod'
import { REPLAY_DEBUG_THREAD_ID, STUDY_SOURCE_SCHEME } from './constants'
import {
  replayDebugSnapshotSchema,
  type ReplayDebugSnapshot,
} from './replayDebugSchemas'
import { sha256 } from './runtimeSupport/utils/sha256'

const requestSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.literal('request'),
  command: z.string(),
  arguments: z.unknown().optional(),
})
const frameArguments = z.object({ frameId: z.number().int().positive() })
const variablesArguments = z.object({
  variablesReference: z.number().int().positive(),
  start: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
})
const sourceArguments = z.object({
  sourceReference: z.number().int().positive(),
})
const stackArguments = z.object({
  threadId: z.number().int().positive(),
  startFrame: z.number().int().nonnegative().optional(),
  levels: z.number().int().nonnegative().optional(),
})
type RecordedFrame = ReplayDebugSnapshot['frames'][number]
export type ReplaySourceDocument = { uri: string; hash: string }

/** Serves immutable recorded history to the native debugger; has no live session or execution transport. @example adapter.select(snapshot, 'Recorded at 00:42'); adapter.handleMessage(request) */
export class ReplayDebugAdapter {
  private sequence = 0
  private nextHandle = 0
  private threadId: number = REPLAY_DEBUG_THREAD_ID
  private sourceDocument?: ReplaySourceDocument
  private snapshot?: ReplayDebugSnapshot
  private label = 'Not recorded at this moment'
  private frames = new Map<number, RecordedFrame>()
  private sources = new Map<number, NonNullable<RecordedFrame['source']>>()
  private groups = new Map<number, DebugProtocol.Variable[]>()
  private frameSources = new Map<number, number>()
  private frameScopes = new Map<number, DebugProtocol.Scope[]>()
  private retiredFrameIds = new Set<number>()
  private configured = false
  private closed = false
  private selectionValid = false
  private inspectedStack = false
  private inspectedScopes = false
  private inspectedVariables = false
  private reportedInspection = false

  /**
   * Serves one owned historical session for {@link ReplayDebugger}.
   * @param send - Emits DAP responses/events to the editor's inline session.
   * @param disconnected - Runs when the editor disconnects or terminates this session.
   * @param inspected - Runs once per selection when the native client first retrieves its recorded values, so a moment committed without them can drop its hint.
   * @example new ReplayDebugAdapter(message => events.fire(message), () => { this.detached = true; }, () => { this.valuesUnrequested = false; this.changed(); })
   */
  constructor(
    private readonly send: (
      message: DebugProtocol.Response | DebugProtocol.Event,
    ) => void,
    private readonly disconnected: () => void = () => {},
    private readonly inspected: () => void = () => {},
  ) {}

  /**
   * Lets {@link ReplayDebugger.present} await the current native-client retrieval after a selected moment changes.
   * @returns Whether current stack, scopes and initial values were retrieved; this is not a native paint acknowledgement.
   * @example adapter.select(undefined, 'Not recorded at this moment'); adapter.inspectionReady // false until the native client retrieves the empty stack
   */
  get inspectionReady(): boolean {
    if (
      this.closed ||
      !this.configured ||
      !this.selectionValid ||
      !this.inspectedStack
    )
      return false
    const executingFrameId = this.executingFrameId
    // Missing history needs only its current empty stack; frames without scopes need no invented variable request.
    return (
      executingFrameId === undefined ||
      (this.inspectedScopes &&
        (!this.frameScopes.get(executingFrameId)?.length ||
          this.inspectedVariables))
    )
  }

  /**
   * Identifies the selected recorded execution frame (top of the stack) whose retrieval {@link inspectionReady} requires.
   * @returns The current top frame handle, or `undefined` for missing history.
   * @example this.executingFrameId // => 1001
   */
  private get executingFrameId(): number | undefined {
    return this.frames.keys().next().value
  }

  /** Replaces every handle on committed moment changes; an invalid snapshot first clears previous state. @example adapter.select(undefined, 'Not recorded at this moment') */
  select(
    value: ReplayDebugSnapshot | undefined,
    label: string,
    sourceDocument?: ReplaySourceDocument,
  ): void {
    if (this.closed) return
    // Retire the editor's focused frame and cached Variables tree before replacing historical handles.
    if (this.configured) {
      // Empty the still-focused frame first: VS Code refetches its scopes at once, whereas a focus change waits for its deferred refresh.
      if (this.frames.size) {
        this.retiredFrameIds = new Set(this.frames.keys())
        this.event('invalidated', { areas: ['variables'] })
      }
      this.event('continued', {
        threadId: this.threadId,
        allThreadsContinued: false,
      })
      // An exited event cancels VS Code's queued continued cleanup; threads discovery retires the old identity.
      this.threadId++
    }
    this.sourceDocument = undefined
    this.selectionValid = false
    this.inspectedStack = false
    this.inspectedScopes = false
    this.inspectedVariables = false
    this.reportedInspection = false
    this.snapshot = undefined
    this.frames.clear()
    this.sources.clear()
    this.groups.clear()
    this.frameSources.clear()
    this.frameScopes.clear()
    this.label = 'Not recorded at this moment'
    try {
      if (value) {
        if (
          sourceDocument &&
          new URL(sourceDocument.uri).protocol !== `${STUDY_SOURCE_SCHEME}:`
        )
          throw new Error(
            'Historical source must use the owned read-only document provider.',
          )
        const snapshot = replayDebugSnapshotSchema.parse(value)
        for (const frame of snapshot.frames)
          if (frame.source && sha256(frame.source.text) !== frame.source.hash)
            throw new Error('Recorded debugger source hash mismatch.')
        this.snapshot = snapshot
        this.label = label
        this.sourceDocument = sourceDocument
        // Saved indices become session-local handles that are never reused across seeks.
        for (const frame of snapshot.frames) {
          const frameId = ++this.nextHandle
          this.frames.set(frameId, frame)
          if (frame.source) {
            const sourceId = ++this.nextHandle
            this.sources.set(sourceId, frame.source)
            this.frameSources.set(frameId, sourceId)
          }
          const scopes = frame.scopes.map((scope) => ({
            name: scope.name,
            expensive: false,
            variablesReference: this.group(scope.variables, scope.unavailable),
          }))
          const limitations = [
            frame.unavailable,
            frame.sourceUnavailable,
            ...snapshot.limitations,
          ].filter((reason): reason is string => Boolean(reason))
          if (limitations.length)
            scopes.push({
              name: 'Recording limitations',
              expensive: false,
              variablesReference: this.group([], limitations.join('\n')),
            })
          this.frameScopes.set(frameId, scopes)
        }
      }
      this.selectionValid = true
    } finally {
      if (this.configured) {
        this.event('thread', { reason: 'started', threadId: this.threadId })
        this.stopped()
      }
    }
  }

  /** Handles only history inspection and session teardown; execution/evaluation/mutation requests fail closed. @example adapter.handleMessage({seq:1,type:'request',command:'threads'}) */
  handleMessage(message: unknown): void {
    if (this.closed) return
    const parsed = requestSchema.safeParse(message)
    if (!parsed.success) return
    const request = parsed.data
    const respond = (body?: unknown) =>
      this.send({
        seq: ++this.sequence,
        type: 'response',
        request_seq: request.seq,
        command: request.command,
        success: true,
        ...(body === undefined ? {} : { body }),
      })
    try {
      switch (request.command) {
        case 'initialize':
          respond({
            supportsConfigurationDoneRequest: true,
            supportsVariablePaging: true,
            supportsLoadedSourcesRequest: true,
            supportsEvaluateForHovers: false,
            supportsSetVariable: false,
            supportsSetExpression: false,
            supportsRestartRequest: false,
          })
          return
        case 'launch':
          respond()
          this.event('initialized')
          return
        case 'configurationDone':
          respond()
          this.configured = true
          this.stopped()
          return
        case 'threads':
          respond({ threads: [{ id: this.threadId, name: this.label }] })
          return
        case 'stackTrace': {
          const arguments_ = stackArguments.parse(request.arguments)
          if (arguments_.threadId !== this.threadId)
            throw new Error('Recorded thread is no longer selected.')
          const frames = [...this.frames].map(([id, frame]) => ({
            id,
            name: frame.name,
            line: frame.line,
            column: frame.column,
            ...(frame.source
              ? {
                  source: {
                    name: frame.source.name,
                    ...(this.sourceDocument?.hash === frame.source.hash
                      ? { path: this.sourceDocument.uri, sourceReference: 0 }
                      : { sourceReference: this.frameSources.get(id) }),
                  },
                }
              : {}),
          }))
          const start = arguments_.startFrame ?? 0
          const selectedFrames = frames.slice(
            start,
            arguments_.levels ? start + arguments_.levels : undefined,
          )
          respond({ stackFrames: selectedFrames, totalFrames: frames.length })
          // A caller-only page cannot confirm that the native client inspected the selected execution frame.
          if (
            !frames.length ||
            selectedFrames.some((frame) => frame.id === this.executingFrameId)
          )
            this.inspectedStack = true
          this.reportInspection()
          return
        }
        case 'scopes': {
          // A just-retired frame answers empty so the invalidated Variables tree shows no rows instead of an error.
          const { frameId } = frameArguments.parse(request.arguments),
            scopes =
              this.frameScopes.get(frameId) ??
              (this.retiredFrameIds.has(frameId) ? [] : undefined)
          if (!scopes) throw new Error('Recorded frame is no longer selected.')
          respond({ scopes })
          // Only the executing frame's scopes count; a caller or retired frame cannot confirm the selected moment.
          if (frameId === this.executingFrameId) this.inspectedScopes = true
          this.reportInspection()
          return
        }
        case 'variables': {
          const arguments_ = variablesArguments.parse(request.arguments),
            variables = this.groups.get(arguments_.variablesReference)
          if (!variables)
            throw new Error('Recorded variables are no longer selected.')
          const start = arguments_.start ?? 0
          respond({
            variables: variables.slice(
              start,
              arguments_.count ? start + arguments_.count : undefined,
            ),
          })
          const executingFrameId = this.executingFrameId
          // Native Variables expands the first scope; other groups or later pages do not establish its initial rows.
          if (
            start === 0 &&
            executingFrameId !== undefined &&
            arguments_.variablesReference ===
              this.frameScopes.get(executingFrameId)?.[0]?.variablesReference
          )
            this.inspectedVariables = true
          this.reportInspection()
          return
        }
        case 'source': {
          const { sourceReference } = sourceArguments.parse(request.arguments),
            source = this.sources.get(sourceReference)
          if (!source) throw new Error('Recorded source is no longer selected.')
          respond({ content: source.text, mimeType: 'text/plain' })
          return
        }
        case 'loadedSources':
          respond({
            sources: [...this.sources].map(([sourceReference, source]) => ({
              name: source.name,
              sourceReference,
            })),
          })
          return
        case 'setBreakpoints':
          respond({ breakpoints: [] })
          return
        case 'setExceptionBreakpoints':
          respond({ breakpoints: [] })
          return
        case 'disconnect':
        case 'terminate':
          respond()
          this.event('terminated')
          this.dispose()
          this.disconnected()
          return
        default:
          throw new Error(
            'Read-only learning replay. Use its playback controls to select recorded moments.',
          )
      }
    } catch (error) {
      this.send({
        seq: ++this.sequence,
        type: 'response',
        request_seq: request.seq,
        command: request.command,
        success: false,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Drops references when the editor ends this historical adapter, without touching a live target. @example adapter.dispose() */
  dispose(): void {
    this.closed = true
    this.selectionValid = false
    this.sourceDocument = undefined
    this.snapshot = undefined
    this.frames.clear()
    this.sources.clear()
    this.groups.clear()
    this.frameSources.clear()
    this.frameScopes.clear()
    this.retiredFrameIds.clear()
  }

  /** Tells {@link ReplayDebugger} once per selection that the native client has now retrieved its recorded values. @example this.reportInspection() */
  private reportInspection(): void {
    const executingFrameId = this.executingFrameId
    // An empty gap stack or a frame without scopes proves Call Stack is open, not that Variables loads values.
    if (
      this.reportedInspection ||
      !this.inspectionReady ||
      executingFrameId === undefined ||
      !this.frameScopes.get(executingFrameId)?.length
    )
      return
    this.reportedInspection = true
    this.inspected()
  }

  /** Materializes native variable groups from validated forward-only archive indices. @example this.group([0], undefined) */
  private group(indices: number[], unavailable?: string): number {
    const handle = ++this.nextHandle
    const variables: DebugProtocol.Variable[] = indices.map((index) => {
      const variable = this.snapshot!.variables[index]!
      return {
        name: variable.name,
        value: variable.value,
        type: variable.type,
        variablesReference:
          variable.children.length || variable.unavailable
            ? this.group(variable.children, variable.unavailable)
            : 0,
      }
    })
    if (unavailable)
      variables.push({
        name: 'Not recorded',
        value: unavailable,
        variablesReference: 0,
      })
    this.groups.set(handle, variables)
    return handle
  }

  /** Notifies native views of a new moment or missing history only after DAP configuration. @example this.stopped() */
  private stopped(): void {
    this.event('stopped', {
      reason: 'pause',
      description: this.label,
      threadId: this.threadId,
      allThreadsStopped: true,
    })
  }

  /** Serializes adapter events on the same outgoing sequence as responses. @example this.event('initialized') */
  private event(event: string, body?: unknown): void {
    this.send({
      seq: ++this.sequence,
      type: 'event',
      event,
      ...(body === undefined ? {} : { body }),
    })
  }
}
