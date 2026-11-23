/**
 * Runs a continuation once after a read that its caller stopped waiting for settles, whatever it answered, so a window can still act on a mark read that outlived its start budget; called by the extension's late mark of a Devin Desktop window's descriptor.
 * A read that already settled before the call still runs the continuation, once.
 * @param lateRead - The read still in flight (or already settled) when its caller's budget passed; its answer and its rejection are ignored.
 * @param apply - The continuation, which reads afresh what it needs.
 * @returns What `apply` answered.
 * @throws What `apply` threw.
 * @example
 * await continueAfterLateRead(standingRead, () => syncDevinChatDescriptor(false, server)) // => { server, isMarked: true } once the late read settled
 */
export async function continueAfterLateRead<Result>(
  lateRead: PromiseLike<unknown>,
  apply: () => Result | PromiseLike<Result>,
): Promise<Result> {
  // Only the settling counts: the continuation never uses the old answer.
  await Promise.resolve(lateRead).then(
    () => undefined,
    () => undefined,
  )
  return apply()
}
