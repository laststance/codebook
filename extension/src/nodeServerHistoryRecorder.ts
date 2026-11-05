import {
  NodeRunHistoryRecorder,
  type NodeRunHistoryBeginInput,
} from './nodeRunHistoryRecorder'
import {
  NodeServerHistorySinkImpl,
  type NodeServerHistorySinkInput,
} from './nodeServerHistorySink'
import type { NodeServerHistorySummary } from './nodeServerHistoryTypes'
import type {
  NodeServerEndInput,
  NodeServerHistoryWriter,
} from './nodeServerHistoryWriter'

/** What {@link NodeServerHistoryRecorder.begin} needs from the service. */
export type NodeServerHistoryBeginInput = NodeRunHistoryBeginInput<
  NodeServerHistoryWriter,
  Omit<NodeServerHistorySinkInput, 'writer'>,
  NodeServerHistorySummary
>

/** The outcome of a start: the recorder, or why this run has no history (the live run goes on either way). */
export type NodeServerHistoryBegun =
  { recorder: NodeServerHistoryRecorder } | { unavailable: string }

/**
 * Owns one live node-server run's history from its start to its seal (see {@link NodeRunHistoryRecorder}).
 * Created by {@link StudyService} before it launches a node-server run; {@link NodeServerHistoryRecorder.seal} is called by its stop path.
 * @example
 * const begun = await NodeServerHistoryRecorder.begin(input)
 * if ('recorder' in begun) await begun.recorder.seal({ elapsedMs: 900, reason: 'stopped' }, 10_000)
 */
export class NodeServerHistoryRecorder extends NodeRunHistoryRecorder<
  NodeServerHistoryWriter,
  NodeServerHistorySinkImpl,
  NodeServerHistorySummary,
  NodeServerEndInput,
  Omit<NodeServerHistorySinkInput, 'writer'>
> {
  /**
   * Starts the history within its bound.
   * @param input - How to start, word and read the history.
   * @returns The recorder, or the cause for a run that goes on without a history.
   * @example const begun = await NodeServerHistoryRecorder.begin(input) // => { recorder } | { unavailable: 'storage is full' }
   */
  static begin(
    input: NodeServerHistoryBeginInput,
  ): Promise<NodeServerHistoryBegun> {
    return NodeRunHistoryRecorder.beginWith(
      input,
      (writer) =>
        new NodeServerHistoryRecorder(
          writer,
          new NodeServerHistorySinkImpl({ ...input.sink, writer }),
          input,
        ),
      (late) => late.seal({ elapsedMs: 0, reason: 'stopped' }),
    )
  }
}
