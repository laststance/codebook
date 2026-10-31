import type { DebugProtocol } from '@vscode/debugprotocol'
import { z } from 'zod'

import {
  REPLAY_DEBUG_NATIVE_STACK_PAGE_FRAMES,
  REPLAY_RECORDED_INSPECTION_TYPE_ONLY_VALUE,
  REPLAY_RECORDED_INSPECTIONS_SCOPE_NAME,
  REPLAY_FRAME_TEXT_NOT_RECORDED_ORIGIN,
  REPLAY_FRAME_TEXT_NOT_RECORDED_TEXT,
  REPLAY_DEBUG_THREAD_ID,
  STUDY_SOURCE_SCHEME,
} from './constants'
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
/** One value the run declared to inspect at a stop, as the history recorded it: `mode: 'value'` keeps the displayed value, `mode: 'type'` only its type (the value was withheld). Shown by {@link ReplayDebugAdapter} in the "Recorded inspections" scope. */
export type ReplayRecordedInspection = {
  path: string
  mode: 'value' | 'type'
  display: string
  type?: string
}
/** What a closed adapter answers the view requests native Run and Debug still sends after its `disconnect`: a success without rows, so the editor has nothing to cancel. */
const CLOSED_SESSION_ANSWERS: ReadonlyMap<string, unknown> = new Map([
  ['threads', { threads: [] }],
  ['stackTrace', { stackFrames: [], totalFrames: 0 }],
  ['scopes', { scopes: [] }],
  ['variables', { variables: [] }],
])

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
  /** The text a placeholder source handle serves (a caller frame whose executed text was not recorded), by session handle; its frame's handle is in {@link frameSources}. */
  private placeholderTexts = new Map<number, string>()
  private frameScopes = new Map<number, DebugProtocol.Scope[]>()
  /** The frame that carries the "Recorded inspections" scope of the current selection, when the stop recorded any. */
  private inspectionsFrameId?: number
  private retiredFrameIds = new Set<number>()
  private configured = false
  private closed = false
  private selectionValid = false
  private inspectedStack = false
  /** How many frames from the top native Call Stack has received for the current selection. */
  private servedFrameCount = 0
  private inspectedScopes = false
  private inspectedVariables = false
  private reportedInspection = false
  private inspectionDue = false
  private selectedAtMs = Date.now()
  private stoppedAtMs?: number

  /**
   * Serves one owned historical session for {@link ReplayDebugger}.
   * @param send - Emits DAP responses/events to the editor's inline session.
   * @param disconnected - Runs when the editor disconnects or terminates this session.
   * @param inspected - Runs once per selection when the native client first retrieves its recorded values, so a moment committed without them can drop its hint.
   * @param failed - Receives an error thrown by `inspected`, which runs after the request's single response has been sent.
   * @example new ReplayDebugAdapter(message => events.fire(message), () => { this.detached = true; }, () => { this.valuesUnrequested = false; this.changed(); }, error => report(error))
   */
  constructor(
    private readonly send: (
      message: DebugProtocol.Response | DebugProtocol.Event,
    ) => void,
    private readonly disconnected: () => void = () => {},
    private readonly inspected: () => void = () => {},
    private readonly failed: (error: unknown) => void = () => {},
  ) {}

  /**
   * Tells {@link ReplayDebugger} whether native Run and Debug retrieved the current selection; its inspection wait re-reads this on every `inspected` callback, `stopped` event and ownership change instead of polling.
   * @returns Whether current stack, scopes and the first scope's initial values were retrieved; this is not a native paint acknowledgement.
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
    const inspectionFrameId = this.inspectionFrameId
    // Missing history needs only its current empty stack; frames without scopes need no invented variable request.
    return (
      inspectionFrameId === undefined ||
      (this.inspectedScopes &&
        (!this.frameScopes.get(inspectionFrameId)?.length ||
          this.inspectedVariables))
    )
  }

  /**
   * Tells {@link ReplayDebugger.awaitRetrieval} whether native Variables can hold the current selection's rows, which list commands act on.
   * @returns Whether the native client retrieved the scopes of the current selection's inspection frame; `false` for a gap, which has no frame.
   * @example adapter.select(snapshot, 'Recorded pause · 55.87 s'); adapter.scopesRetrieved // => false until native Variables asks for the frame's scopes
   */
  get scopesRetrieved(): boolean {
    return (
      !this.closed &&
      this.configured &&
      this.selectionValid &&
      this.inspectedScopes
    )
  }

  /** Gives {@link ReplayDebugger.awaitRetrieval} the current native stack receipt before historical model selection; native client requests trigger it. @returns Whether the current selection's inspection stack was served. @example adapter.stackRetrieved // => true after the current stackTrace request */
  get stackRetrieved(): boolean {
    return (
      !this.closed &&
      this.configured &&
      this.selectionValid &&
      this.inspectedStack
    )
  }

  /**
   * Lets {@link ReplayDebugger.present} commit gaps and scope-less stops at once: only a selection whose inspection frame has recorded scopes can load values in native Variables.
   *
   * The synthetic "Recording limitations" scope explains missing capture; it holds no recorded values, so it does not count.
   *
   * @returns Whether the current selection's inspection frame has at least one recorded scope for Variables to load.
   * @example adapter.select(undefined, 'Not recorded at this moment'); adapter.hasLoadableValues // => false
   */
  get hasLoadableValues(): boolean {
    const inspectionFrameId = this.inspectionFrameId
    return Boolean(
      !this.closed &&
      this.selectionValid &&
      inspectionFrameId !== undefined &&
      // The recorded inspections are recorded values, so a stop with only those still loads values.
      (this.frames.get(inspectionFrameId)?.scopes.length ||
        this.inspectionsFrameId === inspectionFrameId),
    )
  }

  /**
   * Lets {@link ReplayDebugger.present} fail closed when the editor disposed this adapter before reporting termination.
   * @returns Whether the editor ended this adapter; a disposed adapter ignores selections and serves no history.
   * @example adapter.dispose(); adapter.disposed // => true
   */
  get disposed(): boolean {
    return this.closed
  }

  /**
   * Tells {@link ReplayDebugger} when native Run and Debug was told about the current selection, so its grace for loading values starts there rather than at session launch.
   * @returns `Date.now()` of the current selection's `stopped` event, or `undefined` before the session is configured.
   * @example adapter.select(snapshot, 'Recorded pause'); adapter.stoppedAt // => 1_790_805_320_000 once configured
   */
  get stoppedAt(): number | undefined {
    return this.stoppedAtMs
  }

  /**
   * Bounds how long {@link ReplayDebugger.present} waits for a `stopped` event that never comes.
   * @returns `Date.now()` of the latest {@link select} call.
   * @example adapter.selectedAt // => 1_790_805_319_000
   */
  get selectedAt(): number {
    return this.selectedAtMs
  }

  /**
   * Identifies the frame whose retrieval {@link inspectionReady} requires: native Call Stack focuses the first frame with source, so a library frame on top cannot hold the stop.
   *
   * Native Call Stack only focuses among the frames it loaded: once its first page ({@link REPLAY_DEBUG_NATIVE_STACK_PAGE_FRAMES}) holds no frame with source, it focuses the top frame.
   *
   * @returns The first frame with recorded source, else the top frame (also when that source frame lies beyond the loaded first page), or `undefined` for missing history.
   * @example this.inspectionFrameId // => 1001
   */
  private get inspectionFrameId(): number | undefined {
    const topFrameId: number | undefined = this.frames.keys().next().value
    let index = 0
    for (const [frameId, frame] of this.frames) {
      // A source frame native Call Stack has not loaded yet cannot be focused once its first page is complete.
      if (this.isBeyondLoadedFirstPage(index)) return topFrameId
      if (this.isFocusableFrame(frame)) return frameId
      index++
    }
    return topFrameId
  }

  /**
   * The one rule for which frame native Call Stack focuses: VS Code takes the first frame whose source is available and not deemphasized. A frame with recorded text qualifies; a caller frame that only has a placeholder source is answered deemphasized and never qualifies. The `stackTrace` answer asks this same rule for its normal (not deemphasized) source, so the focus and the hint cannot drift apart.
   * @param frame - A recorded frame of the current selection.
   * @returns Whether the frame answers a normal (not deemphasized) source.
   * @example this.isFocusableFrame({ ...frame, source: undefined, recordedLocation: { name: 'a.ts' } }) // => false
   */
  private isFocusableFrame(
    frame: RecordedFrame,
  ): frame is RecordedFrame & { source: NonNullable<RecordedFrame['source']> } {
    return Boolean(frame.source)
  }

  /**
   * Registers what the frame's source request serves: the recorded text for a frame that has it, else a placeholder for a caller frame that kept only its recorded location.
   * The placeholder is a session handle whose text says the executed text was not recorded and names the recorded file and line, never a disk path. Called by {@link select} for every recorded frame.
   * @param frameId - The session-local handle of the frame.
   * @param frame - The recorded frame; without text and without a recorded location nothing is registered and the frame answers no source.
   * @example this.registerFrameSource(7, { ...frame, source: undefined, recordedLocation: { name: 'a.ts' } }) // serves 'Not recorded at this moment: ...\nRecorded location: a.ts:42'
   */
  private registerFrameSource(frameId: number, frame: RecordedFrame): void {
    if (frame.source) {
      const sourceId = ++this.nextHandle
      this.sources.set(sourceId, frame.source)
      this.frameSources.set(frameId, sourceId)
      return
    }
    if (!frame.recordedLocation) return
    const placeholderId = ++this.nextHandle
    this.frameSources.set(frameId, placeholderId)
    this.placeholderTexts.set(
      placeholderId,
      `${REPLAY_FRAME_TEXT_NOT_RECORDED_TEXT}\nRecorded location: ${frame.recordedLocation.path ?? frame.recordedLocation.name}:${frame.line}`,
    )
  }

  /**
   * Tells {@link inspectionFrameId} whether a frame lies outside what native Call Stack loaded, once its first page is complete.
   * @param index - Zero-based position of the frame in the recorded stack.
   * @returns `true` when the frame was not served yet and the first page ({@link REPLAY_DEBUG_NATIVE_STACK_PAGE_FRAMES}) was served in full; `false` for a served frame, and while the first page is still incomplete.
   * @example this.isBeyondLoadedFirstPage(20) // => true once the first 20 frames were served
   */
  private isBeyondLoadedFirstPage(index: number): boolean {
    return (
      index >= this.servedFrameCount &&
      this.servedFrameCount >= REPLAY_DEBUG_NATIVE_STACK_PAGE_FRAMES
    )
  }

  /**
   * Replaces every handle when {@link ReplayDebugger} presents another moment or retires the displayed one; an invalid snapshot first clears previous state.
   * @param value - The recorded stop to serve, or `undefined` for a moment without history to show.
   * @param label - What the thread and the stop description read: the recorded moment, or for `undefined` why no stack is shown ("Not recorded at this moment", or that the recorded application is covered).
   * @param sourceDocument - The captured source document the native editor opens for the stop's frames.
   * @param inspections - The values the run recorded at this stop; listed read-only in one extra "Recorded inspections" scope of the frame native Call Stack focuses (the first frame with source on the first Call Stack page, else the top frame), so values outside the bounded captured scopes stay inspectable. Nothing is added when empty or absent.
   * @throws When the snapshot is invalid or its source hash does not match; the session then shows "Not recorded at this moment".
   * @example adapter.select(undefined, 'Not recorded at this moment')
   */
  select(
    value: ReplayDebugSnapshot | undefined,
    label: string,
    sourceDocument?: ReplaySourceDocument,
    inspections: readonly ReplayRecordedInspection[] = [],
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
    this.servedFrameCount = 0
    this.inspectedScopes = false
    this.inspectedVariables = false
    this.reportedInspection = false
    this.inspectionDue = false
    this.selectedAtMs = Date.now()
    this.stoppedAtMs = undefined
    this.snapshot = undefined
    this.inspectionsFrameId = undefined
    this.clearRecordedHandles()
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
        // The recorded inspections go on the frame native Call Stack focuses, as {@link inspectionFrameId} picks it: the first focusable frame within the first Call Stack page, else the top frame.
        const firstFocusable = snapshot.frames.findIndex((frame) =>
          this.isFocusableFrame(frame),
        )
        const focusedIndex =
          firstFocusable >= 0 &&
          firstFocusable < REPLAY_DEBUG_NATIVE_STACK_PAGE_FRAMES
            ? firstFocusable
            : 0
        // Saved indices become session-local handles that are never reused across seeks.
        for (const [index, frame] of snapshot.frames.entries()) {
          const frameId = ++this.nextHandle
          this.frames.set(frameId, frame)
          this.registerFrameSource(frameId, frame)
          const scopes = this.buildFrameScopes(
            frameId,
            frame,
            snapshot,
            index === focusedIndex ? inspections : [],
          )
          this.frameScopes.set(frameId, scopes)
        }
      }
      // Without history to show, the label is the reason the caller gives for the empty stack.
      else this.label = label
      this.selectionValid = true
    } finally {
      if (this.configured) {
        this.event('thread', { reason: 'started', threadId: this.threadId })
        this.stopped()
      }
    }
  }

  /** Handles only history inspection and session teardown for the editor's inline session; execution/evaluation/mutation requests fail closed, and a closed adapter answers `threads`, `stackTrace`, `scopes` and `variables` with no rows and nothing else. @example adapter.handleMessage({seq:1,type:'request',command:'threads'}) */
  handleMessage(message: unknown): void {
    const parsed = requestSchema.safeParse(message)
    if (!parsed.success) return
    const request = parsed.data
    const respond = (body?: unknown): void =>
      this.send({
        seq: ++this.sequence,
        type: 'response',
        request_seq: request.seq,
        command: request.command,
        success: true,
        ...(body === undefined ? {} : { body }),
      })
    // A stop change retires the session, and the editor sends view requests within a millisecond of its disconnect: unanswered, it cancels them 500 ms later and Variables shows a red "Canceled".
    if (this.closed) {
      if (CLOSED_SESSION_ANSWERS.has(request.command))
        respond(CLOSED_SESSION_ANSWERS.get(request.command))
      return
    }
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
            ...(this.isFocusableFrame(frame)
              ? {
                  source: {
                    name: frame.source.name,
                    ...(this.sourceDocument?.hash === frame.source.hash
                      ? { path: this.sourceDocument.uri, sourceReference: 0 }
                      : { sourceReference: this.frameSources.get(id) }),
                  },
                }
              : frame.recordedLocation
                ? {
                    source: {
                      name: frame.recordedLocation.name,
                      sourceReference: this.frameSources.get(id),
                      presentationHint: 'deemphasize' as const,
                      origin: REPLAY_FRAME_TEXT_NOT_RECORDED_ORIGIN,
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
          // Only a page that continues the loaded frames extends what native Call Stack can focus.
          if (start <= this.servedFrameCount)
            this.servedFrameCount = Math.max(
              this.servedFrameCount,
              start + selectedFrames.length,
            )
          // Frames loaded without the inspection frame cannot confirm that the native client inspected the selected stop.
          const inspectionFrameIndex = frames.findIndex(
            (frame) => frame.id === this.inspectionFrameId,
          )
          if (
            !frames.length ||
            selectedFrames.some(
              (frame) => frame.id === this.inspectionFrameId,
            ) ||
            (inspectionFrameIndex >= 0 &&
              inspectionFrameIndex < this.servedFrameCount)
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
          // Only the inspection frame's scopes count; another or retired frame cannot confirm the selected moment.
          if (frameId === this.inspectionFrameId) this.inspectedScopes = true
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
          const inspectionFrameId = this.inspectionFrameId
          // Native Variables expands the first scope; other groups or later pages do not establish its initial rows.
          if (
            start === 0 &&
            inspectionFrameId !== undefined &&
            arguments_.variablesReference ===
              this.frameScopes.get(inspectionFrameId)?.[0]?.variablesReference
          )
            this.inspectedVariables = true
          this.reportInspection()
          return
        }
        case 'source': {
          const { sourceReference } = sourceArguments.parse(request.arguments),
            content =
              this.sources.get(sourceReference)?.text ??
              this.placeholderTexts.get(sourceReference)
          if (content === undefined)
            throw new Error('Recorded source is no longer selected.')
          respond({ content, mimeType: 'text/plain' })
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
    } finally {
      // Notify after this request's single response, so a failing listener can never add a second one.
      this.notifyInspection()
    }
  }

  /** Drops references when the editor ends this historical adapter, without touching a live target. @example adapter.dispose() */
  dispose(): void {
    this.closed = true
    this.selectionValid = false
    this.sourceDocument = undefined
    this.snapshot = undefined
    this.clearRecordedHandles()
    this.retiredFrameIds.clear()
  }

  /** Forgets every session handle of the recorded moment (frames, sources, placeholder texts, variable groups, scopes); called by {@link select} before another moment is served and by {@link dispose}. @example this.clearRecordedHandles() */
  private clearRecordedHandles(): void {
    this.frames.clear()
    this.sources.clear()
    this.placeholderTexts.clear()
    this.groups.clear()
    this.frameSources.clear()
    this.frameScopes.clear()
  }

  /** Marks the once-per-selection notification that the native client has now retrieved its recorded values; {@link notifyInspection} delivers it. @example this.reportInspection() */
  private reportInspection(): void {
    // An empty gap stack or a frame without scopes proves Call Stack is open, not that Variables loads values.
    if (
      this.reportedInspection ||
      !this.inspectionReady ||
      !this.hasLoadableValues
    )
      return
    this.reportedInspection = true
    this.inspectionDue = true
  }

  /** Delivers a due {@link reportInspection} after the request's response; a listener error goes to `failed`, never into the DAP stream. @example this.notifyInspection() */
  private notifyInspection(): void {
    if (!this.inspectionDue) return
    this.inspectionDue = false
    try {
      this.inspected()
    } catch (error) {
      try {
        this.failed(error)
      } catch {
        // The error channel failed as well; neither error may enter the DAP stream.
      }
    }
  }

  /**
   * Builds the native scopes of one recorded frame for {@link select}: its captured scopes, the stop's "Recorded inspections" when {@link select} hands them to this frame (the one native Call Stack focuses), then the "Recording limitations" scope when something was not captured.
   * @param frameId - The session-local handle of the frame.
   * @param frame - The recorded frame.
   * @param snapshot - The snapshot the frame belongs to; its limitations apply to every frame.
   * @param inspections - The stop's recorded inspections for this frame (empty for every other frame); they are history, never evaluated.
   * @returns The scopes in display order.
   * @example this.buildFrameScopes(7, snapshot.frames[0], snapshot, []) // => [{ name: 'Locals', … }]
   */
  private buildFrameScopes(
    frameId: number,
    frame: RecordedFrame,
    snapshot: ReplayDebugSnapshot,
    inspections: readonly ReplayRecordedInspection[],
  ): DebugProtocol.Scope[] {
    const scopes: DebugProtocol.Scope[] = frame.scopes.map((scope) => ({
      name: scope.name,
      expensive: false,
      variablesReference: this.group(scope.variables, scope.unavailable),
    }))
    // Only the frame the caller chose (the one native Call Stack focuses) receives the recorded inspections.
    if (inspections.length) {
      scopes.push({
        name: REPLAY_RECORDED_INSPECTIONS_SCOPE_NAME,
        expensive: false,
        variablesReference: this.inspectionsGroup(inspections),
      })
      this.inspectionsFrameId = frameId
    }
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
    return scopes
  }

  /**
   * Materializes the read-only rows of a stop's recorded inspections for {@link select}: `<path> = <display>` with its recorded type, in recorded order; a type-only inspection says its value was not recorded.
   * @param inspections - The stop's recorded inspections.
   * @returns The variables handle of the scope.
   * @example this.inspectionsGroup([{ path: 'type', mode: 'value', display: "'a'", type: 'string' }])
   */
  private inspectionsGroup(
    inspections: readonly ReplayRecordedInspection[],
  ): number {
    const handle = ++this.nextHandle
    this.groups.set(
      handle,
      inspections.map((inspection) =>
        // A type-only inspection holds its type in `display`; the value is never invented.
        inspection.mode === 'type'
          ? {
              name: inspection.path,
              value: REPLAY_RECORDED_INSPECTION_TYPE_ONLY_VALUE,
              type: inspection.display,
              variablesReference: 0,
            }
          : {
              name: inspection.path,
              value: inspection.display,
              type: inspection.type,
              variablesReference: 0,
            },
      ),
    )
    return handle
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

  /** Reports configured historical selections without borrowing replay-control keyboard focus; called by {@link ReplayDebugAdapter.select} and {@link ReplayDebugAdapter.handleMessage}. @example this.stopped() */
  private stopped(): void {
    this.stoppedAtMs = Date.now()
    this.event('stopped', {
      reason: 'pause',
      description: this.label,
      threadId: this.threadId,
      allThreadsStopped: true,
      // Historical inspection changes the moment, while the learner keeps the keyboard where it was.
      preserveFocusHint: true,
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
