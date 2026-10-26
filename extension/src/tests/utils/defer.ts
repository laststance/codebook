/**
 * Makes a promise a test settles by hand, so a read can be held open and released at the moment the test chooses.
 * @returns The promise with its `resolve` and `reject`.
 * @example
 * const held = defer<string>()
 * held.resolve('done')
 * await held.promise // => 'done'
 */
export function defer<Value>() {
  let resolve: (value: Value) => void = () => {}
  let reject: (cause: unknown) => void = () => {}
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
