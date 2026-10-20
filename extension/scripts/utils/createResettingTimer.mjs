/** Calls `onElapsed` once when `ms` pass without a `reset()`; the call stays alive until `stop()`. A timer that has fired stays stopped: `reset()` does nothing then, because Node's `refresh()` would start a fired timer again and run `onElapsed` a second time. Used by {@link watchCallSilence}. @example const timer = createResettingTimer(1000, () => {}); timer.reset(); timer.stop() */
export function createResettingTimer(ms, onElapsed) {
  let isStopped = false
  const handle = setTimeout(() => {
    isStopped = true
    onElapsed()
  }, ms)
  return {
    reset() {
      if (!isStopped) handle.refresh()
    },
    stop() {
      isStopped = true
      clearTimeout(handle)
    },
  }
}
