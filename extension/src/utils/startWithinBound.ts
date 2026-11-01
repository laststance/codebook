/**
 * Waits for a history's start but only until its bound, and disposes a start that completes late.
 * Why: a history that starts slowly must never hold the live run, and a reservation that completes after the run went on unrecorded must not keep a place of the library; shared by the server and the chrome-extension recorder.
 * @param starting - The start already in flight.
 * @param boundMs - How long the run may wait for it.
 * @param disposeLate - Called with a writer that arrives after the bound; it should seal it empty, which removes its folder. Its failure is ignored.
 * @returns The writer when the start finished in time, or `{ timedOut: true }`.
 * @throws What the start throws when it fails within the bound.
 * @example const started = await startWithinBound(store.start(header), 2_000, (late) => late.seal())
 */
export async function startWithinBound<Writer>(
  starting: Promise<Writer>,
  boundMs: number,
  disposeLate: (late: Writer) => Promise<unknown>,
): Promise<{ writer: Writer } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = Symbol('expired')
  try {
    const writer = await Promise.race([
      starting,
      new Promise<typeof expired>((resolve) => {
        timer = setTimeout(() => resolve(expired), boundMs)
        timer.unref()
      }),
    ])
    if (writer !== expired) return { writer }
    // A start that finishes later is disposed of; its own failure is nobody's.
    void starting.then(disposeLate, () => undefined).catch(() => undefined)
    return { timedOut: true }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
