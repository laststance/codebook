import type * as vscode from 'vscode'

import type { StopKeyboardHandOver } from '../stopKeyboardHandOver'

import { isStackFrameItem } from './isStackFrameItem'

/**
 * Names the session of the frame the editor shows when that session holds a stop in the reader's hand-over record (armed or handed over); asked by {@link StudyWorkspace} when the editor reports a stop's frame, before it decides whether the chat is owed a return.
 * The record keeps every session's stop (Cycle 0046 finding 605), so the stop that counts is the shown frame's own and not the one read last: a Codebook run's stop read while the learner's handed-over stop is shown leaves that stop the shown one.
 * @param activeStackItem - Run and Debug's active stack item.
 * @param handOver - The reader's hand-over record.
 * @returns
 * - The frame's session id while that session holds a stop
 * - `undefined` for a thread, for no item, and for a frame whose session holds no stop
 * @example
 * heldStopSessionOf(learnerFrame, handOver) // => 'learner-node' after learner-node's stop was armed
 * heldStopSessionOf({ session, threadId: 1 }, handOver) // => undefined, the session runs again
 */
export function heldStopSessionOf(
  activeStackItem: vscode.DebugThread | vscode.DebugStackFrame | undefined,
  handOver: Pick<StopKeyboardHandOver, 'isHeldFor'>,
): string | undefined {
  return isStackFrameItem(activeStackItem) &&
    handOver.isHeldFor(activeStackItem.session.id)
    ? activeStackItem.session.id
    : undefined
}
