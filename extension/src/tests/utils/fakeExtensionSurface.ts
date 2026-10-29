import type { FlatCdpConnection } from '../../chromeExtensionContracts'

/** One CDP request the executor sent. */
export type SentRequest = {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

/** How a fake surface answers; a function may return a held promise or throw to model a lost answer. */
export type SurfaceAnswers = Partial<
  Record<
    string,
    (
      params: Record<string, unknown>,
      sentBefore: readonly SentRequest[],
    ) => Promise<Record<string, unknown>> | Record<string, unknown>
  >
>

/**
 * A fake browser-level CDP connection with one surface session: it records every request, answers a click flow by default and lets a test hold, fail or replace any answer and emit events.
 * @param answers - Answers by method that replace the default answer.
 * @returns The connection, the log of sent requests and `emit` for events.
 * @example
 * const surface = fakeExtensionSurface({ 'Input.insertText': () => { throw new Error('lost') } })
 */
export function fakeExtensionSurface(answers: SurfaceAnswers = {}) {
  const sent: SentRequest[] = []
  const listeners = new Map<
    string,
    Set<(params: Record<string, unknown>, sessionId?: string) => void>
  >()
  const defaults: SurfaceAnswers = {
    'Runtime.evaluate': () => ({
      result: { subtype: 'node', objectId: 'node-1' },
    }),
    'Runtime.callFunctionOn': (params) => {
      const declaration = String(params.functionDeclaration)
      if (declaration.includes('element-has-no-size'))
        return { result: { value: { ready: true, x: 120, y: 48 } } }
      return { result: { value: { ready: true } } }
    },
  }
  const connection: FlatCdpConnection = {
    async request(method, params, sessionId) {
      sent.push({ method, params, sessionId })
      const answer = answers[method] ?? defaults[method]
      return answer ? answer(params, sent) : {}
    },
    on(method, listener) {
      const set = listeners.get(method) ?? new Set()
      set.add(listener)
      listeners.set(method, set)
      return () => set.delete(listener)
    },
    onClose: () => () => undefined,
    close(): void {},
  }
  return {
    connection,
    sent,
    methods: () => sent.map((request) => request.method),
    emit(
      method: string,
      params: Record<string, unknown>,
      sessionId?: string,
    ): void {
      for (const listener of listeners.get(method) ?? [])
        listener(params, sessionId)
    },
  }
}
