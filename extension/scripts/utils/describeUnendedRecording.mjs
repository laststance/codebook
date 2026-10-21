/**
 * Says in one sentence what in a recording did not end, or `undefined` when everything ended: a test that did not end within the limit, a hook that did not end (the runner failed the hook's tests for its time), or a run that sent nothing for the silence bound the timer had (the limit plus the margin, capped at what a timer can wait), with the files that started and did not end.
 *
 * Called by `scripts/test-shard.mjs` after {@link collectTestRun}, which answers the bound in `stall.silentMs`; the caller prints the sentence as one line `✖ <sentence>`.
 * @param recording - What {@link collectTestRun} answered: `timedOutTests`, `hookTimedOutTests` and `stall` (`{ files, silentMs }`, or `undefined`).
 * @param silenceSeconds - The limit the caller gave, in seconds, as the sentence names it for a test or a hook.
 * @returns The sentence, or `undefined` when no test, hook or run was ended.
 * @example
 * describeUnendedRecording({ timedOutTests: [{ file: 'a.test.js', name: 'opens' }], hookTimedOutTests: [], stall: undefined }, 120)
 * // => 'a.test.js: "opens" did not end within 120 s and was ended; timings were not recorded.'
 * describeUnendedRecording({ timedOutTests: [], hookTimedOutTests: [], stall: { files: [], silentMs: 8_000 } }, 3)
 * // => 'The run sent nothing for 8 s and was ended; no file was running; timings were not recorded.'
 */
export function describeUnendedRecording(
  { timedOutTests, hookTimedOutTests, stall },
  silenceSeconds,
) {
  const [hung] = timedOutTests
  if (hung)
    return `${hung.file}: ${JSON.stringify(hung.name)} did not end within ${silenceSeconds} s and was ended; timings were not recorded.`
  const [hungHook] = hookTimedOutTests
  if (hungHook)
    return `${hungHook.file}: a hook of ${JSON.stringify(hungHook.name)} did not end within ${silenceSeconds} s and was ended; timings were not recorded.`
  if (stall)
    // Whole milliseconds divided by 1000 print the shortest decimal (5.007, not 5.007000000000001).
    return `The run sent nothing for ${Math.round(stall.silentMs) / 1000} s and was ended; ${stall.files.length > 0 ? `${stall.files.join(', ')} started and did not end` : 'no file was running'}; timings were not recorded.`
  return undefined
}
