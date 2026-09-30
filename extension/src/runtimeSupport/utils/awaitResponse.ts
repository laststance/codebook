import { ACTIVE_TIMEOUT_MS } from '../constants'

/** Bounds non-cancellable DAP reads for inspectors; late responses never enter another request. @example await awaitResponse(session.customRequest('stackTrace', args), 'stack', signal) */
export function awaitResponse<Value>(
  response: PromiseLike<Value>,
  description: string,
  signal?: AbortSignal,
  timeoutMs = ACTIVE_TIMEOUT_MS,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
    }
    const aborted = () => {
      finish()
      reject(new Error(`Cancelled ${description}`))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error(`Timed out waiting for ${description}`))
    }, timeoutMs)
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    Promise.resolve(response).then(
      (value) => {
        finish()
        resolve(value)
      },
      (error) => {
        finish()
        reject(error)
      },
    )
  })
}
