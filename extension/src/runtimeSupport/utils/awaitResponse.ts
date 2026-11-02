import { ACTIVE_TIMEOUT_MS } from '../constants'

import { WaitTimeoutError } from './waitTimeoutError'

/** Bounds non-cancellable DAP reads for inspectors; late responses never enter another request. The deadline rejects with a {@link WaitTimeoutError}, which a caller tells from the response's own failure by type. The response is not cancelled: it may still complete after the deadline. @example await awaitResponse(session.customRequest('stackTrace', args), 'stack', signal) */
export function awaitResponse<Value>(
  response: PromiseLike<Value>,
  description: string,
  signal?: AbortSignal,
  timeoutMs = ACTIVE_TIMEOUT_MS,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
    }
    const aborted = (): void => {
      finish()
      reject(new Error(`Cancelled ${description}`))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new WaitTimeoutError(`Timed out waiting for ${description}`))
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
