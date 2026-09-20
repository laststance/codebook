import type { TextEditor } from 'vscode';
import { waitUntil } from 'codebook-cycle-0001/dist/utils/waitUntil';
import { PRESENTATION_READY_TIMEOUT_MS } from '../constants';

/** Retains visible source context for {@link StudyWorkspace} before native relocation, then restores it after the final grid settles. @example const restore = retainEditorReadingPosition(editor); await restore(relocated, signal) */
export function retainEditorReadingPosition(editor: Pick<TextEditor, 'selections' | 'visibleRanges'> | undefined) {
  const selection = editor?.selections[0]?.active;
  const visible = editor?.visibleRanges.find(range => selection && range.contains(selection)) ?? editor?.visibleRanges[0];
  // A learner who scrolled away keeps that context instead of jumping back to the selected statement.
  const anchor = visible && (selection && visible.contains(selection) ? selection : visible.start.with(Math.floor((visible.start.line + visible.end.line) / 2), 0));
  const readingPoint = visible && anchor ? visible.with(anchor, anchor) : undefined;
  return async (restored: Pick<TextEditor, 'revealRange' | 'visibleRanges'>, signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted();
    if (!readingPoint) return;
    // Whole-viewport AtTop adds native surrounding-line padding on every transfer and progressively loses the reading position.
    restored.revealRange(readingPoint);
    await waitUntil(() => restored.visibleRanges.some(range => range.contains(readingPoint)), 'retained source reading position', PRESENTATION_READY_TIMEOUT_MS, signal);
  };
}
