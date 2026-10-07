/**
 * Waits until something is written at a Wiki's output (the published site, or a folder prepared beside it), so that a chat whose steps the editor does not report is still seen to work on an update once its publisher prepared a folder; called by {@link startWikiChatUpdate} beside the editor's own signs.
 * @param options.readStamp - Reads the cheap stamp of the output ({@link readWikiWatchStamp}).
 * @param options.pollMs - Time between two reads.
 * @param options.signal - Ends the wait.
 * @param options.sleep - Delay function that ends early when its signal aborts.
 * @returns `true` at the first read whose stamp differs from the first one; `false` when the signal aborted first.
 * @throws What a read of the stamp throws.
 * @example
 * await waitForWikiOutputChange({ readStamp: () => readWikiWatchStamp(outputDirectory), pollMs: 2_000, signal, sleep: sleepUntilAborted })
 * // => true once the publisher created '<output>.stage-…'
 */
export async function waitForWikiOutputChange(options: {
  readStamp: () => Promise<string>
  pollMs: number
  signal: AbortSignal
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
}): Promise<boolean> {
  const stampAtStart = await options.readStamp()
  // Each turn waits, then reads; the wait ends at once when the signal aborts.
  while (!options.signal.aborted) {
    await options.sleep(options.pollMs, options.signal)
    if ((await options.readStamp()) !== stampAtStart)
      return !options.signal.aborted
  }
  return false
}
