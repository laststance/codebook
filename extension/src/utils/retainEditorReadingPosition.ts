import type { TextEditor } from 'vscode'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { PRESENTATION_READY_TIMEOUT_MS } from '../constants'

/** Retains visible source context for {@link StudyWorkspace} before native relocation, then restores it after the final grid settles. @example const restore = retainEditorReadingPosition(editor); await restore(relocated, signal) */
export function retainEditorReadingPosition(
  editor:
    Pick<TextEditor, 'document' | 'selections' | 'visibleRanges'> | undefined,
) {
  const document = editor?.document,
    documentVersion = document?.version
  const selection = editor?.selections[0]?.active
  const visible =
    editor?.visibleRanges.find(
      (range) => selection && range.contains(selection),
    ) ?? editor?.visibleRanges[0]
  // A learner who scrolled away keeps that context instead of jumping back to the selected statement.
  const anchor =
    visible &&
    (selection && visible.contains(selection)
      ? selection
      : visible.start.with(
          Math.floor((visible.start.line + visible.end.line) / 2),
          0,
        ))
  const readingPoint =
    visible && anchor ? visible.with(anchor, anchor) : undefined
  return async (
    restored: Pick<TextEditor, 'document' | 'revealRange' | 'visibleRanges'>,
    signal?: AbortSignal,
  ): Promise<void> => {
    signal?.throwIfAborted()
    if (!readingPoint) return
    // Native range clamping cannot preserve a pose captured before a document edit; reject before reveal and during its wait.
    const assertDocument = () => {
      if (
        document?.version !== documentVersion ||
        restored.document.version !== documentVersion ||
        restored.document.uri.toString() !== document?.uri.toString()
      )
        throw new Error(
          'The source document changed during presentation; its previous reading position is no longer transferable.',
        )
    }
    assertDocument()
    // Whole-viewport AtTop adds native surrounding-line padding on every transfer and progressively loses the reading position.
    restored.revealRange(readingPoint)
    await waitUntil(
      () => {
        assertDocument()
        return restored.visibleRanges.some((range) =>
          range.contains(readingPoint),
        )
      },
      'retained source reading position',
      PRESENTATION_READY_TIMEOUT_MS,
      signal,
    )
  }
}
