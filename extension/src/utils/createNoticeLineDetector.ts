import { NOTICE_PARTIAL_LINE_LIMIT_CHARS } from '../constants'

/**
 * Makes a detector that finds a fixed notice as a complete line in text that arrives in arbitrary pieces.
 * Why: a chunk boundary (or the live secret mask's holdback) can split the runtime's one-line notice, so matching per chunk misses it; matching complete lines does not.
 * Called by {@link OwnedApiServer} on the raw stderr of its process.
 * @param notice - The notice a line must equal after trimming and removing trailing dots.
 * @param onNotice - Called once per matching complete line.
 * @returns `write(text)` takes the next piece of text of one channel.
 * @example
 * const detector = createNoticeLineDetector('Waiting for the debugger to disconnect', () => hits++)
 * detector.write('Waiting for the debugger to')
 * detector.write(' disconnect...\n') // hits === 1
 */
export function createNoticeLineDetector(
  notice: string,
  onNotice: () => void,
): { write(text: string): void } {
  let partial = ''
  // Set while the rest of an over-long line is being skipped.
  let isSkippingLine = false
  return {
    write(text: string): void {
      let rest = text
      // An over-long line is skipped up to its newline; what follows is a fresh line.
      if (isSkippingLine) {
        const newline = rest.indexOf('\n')
        if (newline === -1) return
        isSkippingLine = false
        rest = rest.slice(newline + 1)
      }
      const lines = (partial + rest).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines)
        if (line.trim().replace(/\.+$/, '') === notice) onNotice()
      // An unfinished line past the limit cannot be the notice, so it is not kept.
      if (partial.length > NOTICE_PARTIAL_LINE_LIMIT_CHARS) {
        partial = ''
        isSkippingLine = true
      }
    },
  }
}
