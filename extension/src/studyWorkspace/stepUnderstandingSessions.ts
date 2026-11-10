import type {
  StepUnderstandingDecision,
  StepUnderstandingFile,
} from '../stepUnderstandingSchemas'
import {
  stepUnderstandingState,
  type CurrentStepHash,
  type StepUnderstandingState,
} from '../utils/stepUnderstanding'

/** The two operations a replay family's store offers the per-step understanding check; {@link LearningLibrary} and {@link NodeHistoryStore} both have them. */
export interface StepDecisionStore {
  readStepUnderstanding(
    studyId: string,
  ): Promise<StepUnderstandingFile | undefined>
  saveStepUnderstanding(
    studyId: string,
    change: StepUnderstandingDecision,
    currentSteps: readonly CurrentStepHash[],
  ): Promise<StepUnderstandingFile>
}

/** The replay the Study pane shows now, as the Study workspace's message sees it. */
export type ShownReplaySteps = {
  studyId: string
  /** The family's store; `undefined` when the window has none, which shows no check. */
  store: StepDecisionStore | undefined
  /** Every step of the saved material with its hash, in material order. */
  steps: readonly CurrentStepHash[]
  /** The ids of the steps that can be selected (all in a Node family, those with a recorded position in a browser replay). */
  selectable: readonly string[]
}

/** One step's entry in the Study message: the learner's decision on its current content, plus what is happening to its save. */
export type StepUnderstandingStepView = StepUnderstandingState & {
  stepId: string
  /** The hash of the step as this message shows it; the page sends it back with a press so the extension can refuse a press of a step that changed since. */
  stepHash: string
  saving: boolean
  failure?: string
}

/**
 * Tells whether the step a press names has a different hash now than the page showed, so an agent's material update that landed after the page drew the step is never marked understood unseen; called by `StudyWorkspace` before it saves a press.
 * A step the shown replay lacks is not "changed": the save refuses it in its own words.
 * @param press - The press, with the hash of the step the page showed.
 * @param shown - The replay shown now.
 * @returns `true` when the shown replay holds the step and its hash differs from the press's.
 * @example stepChangedSince({ studyId, stepId: 'a', stepHash: oldHash }, shown) // => true after step "a" was revised
 */
export function stepChangedSince(
  press: { studyId: string; stepId: string; stepHash: string },
  shown: ShownReplaySteps | undefined,
): boolean {
  if (shown?.studyId !== press.studyId) return false
  const step = shown.steps.find((value) => value.stepId === press.stepId)
  return step !== undefined && step.stepHash !== press.stepHash
}

/** What the Study message carries for the per-step checks of the shown replay. */
export type StepUnderstandingView = {
  studyId: string
  /** `unknown` until the decisions were read, `unreadable` when the file could not be read, else `ready`. */
  status: 'unknown' | 'ready' | 'unreadable'
  steps: StepUnderstandingStepView[]
  understoodCount: number
  selectableCount: number
}

type Session = {
  studyId: string
  store: StepDecisionStore
  status: 'unknown' | 'ready' | 'unreadable'
  file: StepUnderstandingFile | undefined
  /** Per step: `saving`, or the text of the last failed save. Dropped with the session. */
  entries: Map<string, { saving: true } | { failure: string }>
  /** Reads and writes of this replay's file run one after the other in this chain; it outlives the session, so a replacement session queues behind the dead one's operations. */
  chain: { tail: Promise<void> }
  readWaiting: boolean
  dead: boolean
}

/**
 * Keeps the learner's per-step understanding decisions of the one replay the Study pane shows: reads its file, projects every step's state into the Study message and saves a press, all in one queue so a read never returns older decisions than a write that completed before it.
 * The Study workspace owns one; {@link StudyWorkspace.message} asks for the view, the webview's `step-understanding` message asks for a save, and the pane's moves and visibility ask for a fresh read.
 * @example const sessions = new StepUnderstandingSessions(() => this.publish(), String)
 */
export class StepUnderstandingSessions {
  private session: Session | undefined
  /** One chain per replay file (store and study), shared by every session of that replay. */
  private readonly chains = new WeakMap<
    StepDecisionStore,
    Map<string, { tail: Promise<void> }>
  >()
  /** The saves that have been queued and not yet ended, whichever session started them. */
  private readonly pendingSaves = new Set<Promise<void>>()

  /**
   * @param changed - Called when a read or a save has ended and the Study message should be built again.
   * @param describeFailure - Words a failed save's error for the step's state line.
   */
  constructor(
    private readonly changed: () => void,
    private readonly describeFailure: (error: unknown) => string,
  ) {}

  /**
   * Projects the shown replay's per-step checks for the Study message, starting the replay's first read when it is not the replay of the last message.
   * @param shown - The shown replay with material, or `undefined` when none is shown.
   * @returns The view, or `undefined` when no replay with material and a store is shown.
   * @example sessions.view(shown)?.steps[0]?.understood // => false before any decision
   */
  view(shown: ShownReplaySteps | undefined): StepUnderstandingView | undefined {
    const session = this.attach(shown)
    if (!shown || !session) return undefined
    const states = stepUnderstandingState(session.file, shown.steps)
    const steps = shown.steps.map((step, index) => {
      const entry = session.entries.get(step.stepId)
      return {
        stepId: step.stepId,
        stepHash: step.stepHash,
        ...states[index]!,
        saving: entry !== undefined && 'saving' in entry,
        ...(entry && 'failure' in entry ? { failure: entry.failure } : {}),
      }
    })
    const selectable = new Set(shown.selectable)
    return {
      studyId: shown.studyId,
      status: session.status,
      steps,
      understoodCount: steps.filter(
        (step) => selectable.has(step.stepId) && step.understood,
      ).length,
      selectableCount: selectable.size,
    }
  }

  /**
   * Reads the file again after the learner's current step may have changed or the pane became visible again, so a repaired or externally changed file shows; reads that wait are not stacked.
   * @example sessions.refresh()
   */
  refresh(): void {
    const session = this.session
    if (!session || session.dead || session.readWaiting) return
    this.enqueueRead(session)
  }

  /**
   * Saves the learner's press of one step's check. The hash is computed here from the shown material, never from the webview; the step's save state shows `saving` until the write ends, then the new decision or the failure.
   * @param request.studyId - The study the webview named.
   * @param request.stepId - The step.
   * @param request.understood - The learner's choice.
   * @param shown - The replay shown now.
   * @param now - The decision's time.
   * @returns Once the write has ended (also when it failed: the failure is the step's state line); immediately when the step already saves.
   * @throws When the shown replay is another study, the step is not in its material or cannot be selected, or the decisions are not known yet or cannot be read; nothing is written.
   * @example await sessions.save({ studyId, stepId: 'a', understood: true }, shown, new Date())
   */
  async save(
    request: { studyId: string; stepId: string; understood: boolean },
    shown: ShownReplaySteps | undefined,
    now: Date,
  ): Promise<void> {
    const { session, step, currentSteps } = this.pressedStep(request, shown)
    // A second press while this step saves sends no second save.
    if (this.isSaving(session, step.stepId)) return
    const change: StepUnderstandingDecision = {
      stepId: step.stepId,
      stepHash: step.stepHash,
      understood: request.understood,
      at: now.toISOString(),
    }
    session.entries.set(step.stepId, { saving: true })
    this.changed()
    const saved = this.enqueue(session, async () => {
      try {
        const file = await session.store.saveStepUnderstanding(
          session.studyId,
          change,
          currentSteps,
        )
        if (session.dead) return
        session.file = file
        session.status = 'ready'
        session.entries.delete(step.stepId)
      } catch (error) {
        if (session.dead) return
        session.entries.set(step.stepId, {
          failure: this.describeFailure(error),
        })
      }
      this.changed()
    })
    this.pendingSaves.add(saved)
    try {
      await saved
    } finally {
      this.pendingSaves.delete(saved)
    }
  }

  /**
   * Checks that a press can be saved and names what it saves; called by {@link save} before anything is written.
   * @param request - The webview's press.
   * @param shown - The replay shown now.
   * @returns The attached session, the pressed step and a copy of the shown steps' hashes.
   * @throws When the shown replay is another study, the step is not in its material or cannot be selected, or the decisions are not known yet or cannot be read.
   * @example const { session, step } = this.pressedStep(request, shown)
   */
  private pressedStep(
    request: { studyId: string; stepId: string },
    shown: ShownReplaySteps | undefined,
  ): {
    session: Session
    step: CurrentStepHash
    currentSteps: CurrentStepHash[]
  } {
    const session = this.attach(shown)
    if (!shown || !session || shown.studyId !== request.studyId)
      throw new Error('This replay is not the one shown, so nothing was saved.')
    const step = shown.steps.find((value) => value.stepId === request.stepId)
    if (!step)
      throw new Error(
        'This step is not in the replay’s saved material, so nothing was saved.',
      )
    if (!shown.selectable.includes(step.stepId))
      throw new Error(
        'This step has no recorded position, so it has no understanding check.',
      )
    if (session.status === 'unknown')
      throw new Error(
        'Understanding for this replay is still being read; try again in a moment.',
      )
    if (session.status === 'unreadable')
      throw new Error('Understanding for this replay could not be read.')
    return {
      session,
      step,
      currentSteps: shown.steps.map((value) => ({ ...value })),
    }
  }

  /**
   * Tells whether a step's save is still out; called by {@link save}.
   * @param session - The attached session.
   * @param stepId - The step.
   * @returns `true` while the step's entry is `saving`.
   * @example this.isSaving(session, 'a') // => false
   */
  private isSaving(session: Session, stepId: string): boolean {
    const entry = session.entries.get(stepId)
    return entry !== undefined && 'saving' in entry
  }

  /**
   * Waits until every save that was queued has ended (also those of a dropped session), so a close does not lose a pressed decision.
   * @returns Once no queued save is left; never rejects.
   * @example await sessions.settle()
   */
  async settle(): Promise<void> {
    while (this.pendingSaves.size > 0)
      await Promise.allSettled([...this.pendingSaves])
  }

  /**
   * Records why a press was refused for the step that was pressed, so the step's own state line says it; called for a message of an older revision.
   * @param studyId - The study the webview named.
   * @param stepId - The step.
   * @param failure - The sentence to show.
   * @returns `true` when the shown replay's session has that step and holds the sentence now; `false` otherwise (nothing changed).
   * @example sessions.refuse(studyId, 'a', 'The displayed study changed.')
   */
  refuse(studyId: string, stepId: string, failure: string): boolean {
    const session = this.session
    if (!session || session.dead || session.studyId !== studyId) return false
    if (session.entries.get(stepId) && 'saving' in session.entries.get(stepId)!)
      return false
    session.entries.set(stepId, { failure })
    this.changed()
    return true
  }

  /**
   * Ends the session of the shown replay, whose reads and saves in flight then change nothing shown (a save still reaches the file; {@link settle} waits for it); called when the Study workspace closes.
   * @example sessions.dispose()
   */
  dispose(): void {
    this.drop()
  }

  private attach(shown: ShownReplaySteps | undefined): Session | undefined {
    if (!shown?.store) {
      this.drop()
      return undefined
    }
    if (
      this.session &&
      !this.session.dead &&
      this.session.studyId === shown.studyId &&
      this.session.store === shown.store
    )
      return this.session
    // Another replay is shown: the old session's late results are dropped, the decisions are in the file.
    this.drop()
    const session: Session = {
      studyId: shown.studyId,
      store: shown.store,
      status: 'unknown',
      file: undefined,
      entries: new Map(),
      chain: this.chainOf(shown.store, shown.studyId),
      readWaiting: false,
      dead: false,
    }
    this.session = session
    this.enqueueRead(session)
    return session
  }

  private drop(): void {
    if (this.session) this.session.dead = true
    this.session = undefined
  }

  private enqueue(
    session: Session,
    operation: () => Promise<void>,
  ): Promise<void> {
    const next = session.chain.tail.then(operation)
    session.chain.tail = next.catch(() => undefined)
    return next
  }

  private chainOf(
    store: StepDecisionStore,
    studyId: string,
  ): { tail: Promise<void> } {
    let byStudy = this.chains.get(store)
    if (!byStudy) {
      byStudy = new Map()
      this.chains.set(store, byStudy)
    }
    let chain = byStudy.get(studyId)
    if (!chain) {
      chain = { tail: Promise.resolve() }
      byStudy.set(studyId, chain)
    }
    return chain
  }

  private enqueueRead(session: Session): void {
    session.readWaiting = true
    void this.enqueue(session, async () => {
      session.readWaiting = false
      try {
        const file = await session.store.readStepUnderstanding(session.studyId)
        if (session.dead) return
        session.file = file
        session.status = 'ready'
      } catch {
        if (session.dead) return
        session.file = undefined
        session.status = 'unreadable'
      }
      this.changed()
    })
  }
}
