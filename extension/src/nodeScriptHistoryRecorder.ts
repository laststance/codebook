import {
  NodeRunHistoryRecorder,
  type NodeRunHistoryBeginInput,
} from './nodeRunHistoryRecorder'
import type { NodeScriptEndInput } from './nodeScriptHistorySchemas'
import {
  NodeScriptHistorySinkImpl,
  type NodeScriptHistorySinkInput,
} from './nodeScriptHistorySink'
import type { NodeScriptHistorySummary } from './nodeScriptHistoryTypes'
import type { NodeScriptHistoryWriter } from './nodeScriptHistoryWriter'

/** What {@link NodeScriptHistoryRecorder.begin} needs from the service. */
export type NodeScriptHistoryBeginInput = NodeRunHistoryBeginInput<
  NodeScriptHistoryWriter,
  Omit<NodeScriptHistorySinkInput, 'writer'>,
  NodeScriptHistorySummary
>

/** The outcome of a start: the recorder, or why this run has no history (the live run goes on either way). */
export type NodeScriptHistoryBegun =
  { recorder: NodeScriptHistoryRecorder } | { unavailable: string }

/**
 * Owns one live node-script run's history from its start to its seal (see {@link NodeRunHistoryRecorder}).
 * The run feeds `recorder.sink`; its stop path, Save and dispose call {@link NodeScriptHistoryRecorder.seal}, with the run's end or `undefined` to seal a `stopped` end derived from the stops recorded so far.
 * @example
 * const begun = await NodeScriptHistoryRecorder.begin(input)
 * if ('recorder' in begun) await begun.recorder.seal(undefined, 10_000)
 */
export class NodeScriptHistoryRecorder extends NodeRunHistoryRecorder<
  NodeScriptHistoryWriter,
  NodeScriptHistorySinkImpl,
  NodeScriptHistorySummary,
  NodeScriptEndInput | undefined,
  Omit<NodeScriptHistorySinkInput, 'writer'>
> {
  /**
   * Starts the history within its bound.
   * @param input - How to start, word and read the history.
   * @returns The recorder, or the cause for a run that goes on without a history.
   * @example const begun = await NodeScriptHistoryRecorder.begin(input) // => { recorder } | { unavailable: 'storage is full' }
   */
  static begin(
    input: NodeScriptHistoryBeginInput,
  ): Promise<NodeScriptHistoryBegun> {
    return NodeRunHistoryRecorder.beginWith(
      input,
      (writer) =>
        new NodeScriptHistoryRecorder(
          writer,
          new NodeScriptHistorySinkImpl({ ...input.sink, writer }),
          input,
        ),
      (late) => late.seal(),
    )
  }
}
