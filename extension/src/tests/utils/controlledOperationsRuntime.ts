import { randomUUID } from 'node:crypto'

import type { OperationConfirmationFact } from '../../operationsConfirmationTypes'
import type {
  OperationFailure,
  OperationRecord,
  RuntimeAction,
} from '../../runtime'

import { ControlledConfiguredRuntime } from './configuredServiceHarness'

/**
 * Models the operation receipts of a version 3 run for service tests: it lists the declared operations as the run resource does, takes one per action, and moves only when a test says so. It launches no application and produces no native evidence.
 * @example const runtime = new ControlledOperationsRuntime(directory, definition); runtime.finish(1)
 */
export class ControlledOperationsRuntime extends ControlledConfiguredRuntime {
  /** The progress of each declared operation, as the real run lists it. */
  readonly records: OperationRecord[]
  /** The secret each action was given, in order; `undefined` for an operation that carries its own text. */
  readonly learnerSecrets: (string | undefined)[] = []
  /** The first failure of an operation, which a test sets when it fails the run. */
  failure?: OperationFailure
  /** The profile the run reports; a test sets `'saved'` as the stand-in for the saved-session decision of lane B. */
  session?: 'saved' | 'fresh'
  /** What the page read returns for the saved-session confirmation. */
  confirmationFacts?: OperationConfirmationFact[]
  /** Makes the page read of the confirmation fail. */
  confirmationFactsFailure?: Error
  /** Whether the action commits the operation's stop at once, as a stop inside the input's handler does. */
  pausesOnAction = false

  constructor(
    directory: string,
    definition: ConstructorParameters<typeof ControlledConfiguredRuntime>[1],
  ) {
    super(directory, definition)
    const configuration = definition.configuration
    this.records =
      configuration.version === 3
        ? configuration.operations.map((operation, index) => ({
            index: index + 1,
            kind: operation.kind,
            title: operation.title,
            state: 'not-run',
            ack: 'pending',
            valueCheck: operation.kind === 'click' ? 'n/a' : 'pending',
            effect: 'pending',
          }))
        : []
  }

  /** Takes the next operation: it is `sending` (or `paused` when the stop is committed at once) and the run reads `acting` (or `paused-browser`). */
  override action(
    key: string,
    action: RuntimeAction,
    options?: { learnerSecret?: string },
  ) {
    const record = this.records.find((entry) => entry.state === 'not-run')
    if (action !== 'repository-operation' || !record || this.status !== 'ready')
      throw new Error('conflict: wrong, repeated or unavailable input')
    this.learnerSecrets.push(options?.learnerSecret)
    this.dispatches++
    if (this.pausesOnAction) {
      // The base class commits the synthetic stop of a click.
      const stopped = this.operation
        ? this.operation
        : super.action(key, 'repository-click')
      this.status = 'paused-browser'
      record.state = 'paused'
      return { ...stopped, operationIndex: record.index }
    }
    this.operation ??= {
      id: randomUUID(),
      key,
      inputDispatched: true,
      inputAcknowledged: false,
      afterVerified: false,
    }
    record.state = 'sending'
    this.status = 'acting'
    return { ...this.operation, operationIndex: record.index }
  }

  /** Answers the confirmation's page read from the facts a test set, or rejects with its failure. */
  readOperationConfirmationFacts(): Promise<
    readonly OperationConfirmationFact[]
  > {
    return this.confirmationFactsFailure
      ? Promise.reject(this.confirmationFactsFailure)
      : Promise.resolve(this.confirmationFacts ?? [])
  }

  /** Finishes an operation the way the run does once its input and stops are done: `done`, acknowledged, and the run `ready` for the next. */
  finish(index: number): void {
    const record = this.records[index - 1]!
    record.state = 'done'
    record.ack = 'yes'
    if (record.kind !== 'click') record.valueCheck = 'passed'
    record.effect = 'dispatched'
    this.status = 'ready'
  }

  override view(): ReturnType<ControlledConfiguredRuntime['view']> {
    return {
      ...super.view(),
      operations: this.records.map((record) => ({ ...record })),
      ...(this.session ? { session: this.session } : {}),
      ...(this.failure ? { operationFailure: this.failure } : {}),
      nextAction:
        this.status === 'ready' &&
        this.records.some((record) => record.state === 'not-run')
          ? 'repository-operation'
          : undefined,
    }
  }
}
