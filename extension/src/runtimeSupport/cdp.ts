import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping'

import { ACTIVE_TIMEOUT_MS, STREAM_TELEMETRY_INTERVAL_MS } from './constants'

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  delayMs: number
}
type WireResponse = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}
type Log = (type: string, detail?: unknown) => unknown
type Transport = Pick<WebSocket, 'addEventListener' | 'send' | 'close'>

/** Multiplexes a page proxy so a pending input never queues screenshot/control requests. @example await cdp.request('Page.captureScreenshot', { format: 'png' }) */
export class Cdp {
  private nextId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>()
  private readonly subscriptions = new Map<string, Promise<void>>()
  private readonly delayedTimers = new Set<ReturnType<typeof setTimeout>>()
  onClose?: () => void
  closed = false
  private streamTelemetry?: {
    clock(): number
    at: number
    sent: number
    responses: number
  }

  constructor(
    private readonly socket: Transport,
    private readonly log: Log,
  ) {
    socket.addEventListener('message', (event) => {
      // JSON is the protocol boundary; method-specific types are supplied by the CDP schema.
      let message: WireResponse
      try {
        message = JSON.parse(String(event.data))
      } catch {
        this.log('cdp.invalid-message')
        this.close()
        return
      }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (pending?.delayMs) {
          this.log('fault.response-delayed', {
            id: message.id,
            method: pending.method,
            delayMs: pending.delayMs,
          })
          const timer = setTimeout(() => {
            this.delayedTimers.delete(timer)
            this.receive(message)
          }, pending.delayMs)
          this.delayedTimers.add(timer)
        } else this.receive(message)
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? [])
          listener(message.params)
      }
    })
    socket.addEventListener('close', () => this.disconnected())
    socket.addEventListener('error', () => this.disconnected())
  }

  /** Opens only the explicitly selected js-debug page proxy. @example await Cdp.connect(proxyUrl, log) */
  static async connect(url: string, log: Log): Promise<Cdp> {
    const socket = new WebSocket(url)
    const connection = new Cdp(socket, log)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('CDP connection timed out'))
      }, ACTIVE_TIMEOUT_MS)
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          reject(new Error('CDP connection failed'))
        },
        { once: true },
      )
    })
    return connection
  }

  /** Sends a schema-typed request immediately; each ID owns its independent deadline. @example cdp.request('Runtime.evaluate', { expression: 'document.title' }) */
  request<Method extends keyof ProtocolMapping.Commands>(
    method: Method,
    params: ProtocolMapping.Commands[Method]['paramsType'][0],
    timeoutMs = ACTIVE_TIMEOUT_MS,
    delayMs = 0,
  ): Promise<ProtocolMapping.Commands[Method]['returnType']> {
    // The protocol mapping binds response type to method at this single wire boundary.
    return this.send(method, params, timeoutMs, delayMs) as Promise<
      ProtocolMapping.Commands[Method]['returnType']
    >
  }

  /** Enables event forwarding on js-debug's existing debugger owner. @example await cdp.subscribe(['Debugger.paused']) */
  async subscribe(events: string[]): Promise<void> {
    if (this.closed) throw new Error('CDP disconnected')
    const added = [...new Set(events)].filter(
      (event) => !this.subscriptions.has(event),
    )
    // The proxy adds a forwarder per name; reserve shared in-flight subscriptions before yielding.
    if (added.length) {
      const subscribed = this.send('JsDebug.subscribe', { events: added })
        .then(() => undefined)
        .catch((error) => {
          // An uncertain response cannot safely be retried on the same proxy without duplicate listeners.
          this.close()
          throw error
        })
      for (const event of added) this.subscriptions.set(event, subscribed)
    }
    await Promise.all(
      events.map((event) => this.subscriptions.get(event) ?? Promise.resolve()),
    )
  }

  /** Attaches schema-typed observers before input dispatch. @example cdp.on('Debugger.paused', event => inspect(event.callFrames)) */
  on<Method extends keyof ProtocolMapping.Events>(
    method: Method,
    listener: (params: ProtocolMapping.Events[Method][0]) => void,
  ): void {
    const listeners = this.listeners.get(method) ?? new Set()
    // Event dispatch is the second typed protocol boundary, paired with request decoding.
    listeners.add(listener as (params: unknown) => void)
    this.listeners.set(method, listeners)
  }

  /** Bounds successful per-frame ACK logs for optional product recording; failures and all other CDP commands remain exact. @example cdp.aggregateScreencastTelemetry(() => evidence.elapsedMs()) */
  aggregateScreencastTelemetry(clock: () => number): void {
    this.streamTelemetry ??= { clock, at: clock(), sent: 0, responses: 0 }
  }

  /** Releases just this proxy connection during owned-run teardown. @example cdp.close() */
  close(): void {
    this.disconnected()
    this.socket.close()
  }

  /** Gives each schema request or proxy subscription its own response/deadline slot. @example this.send('JsDebug.subscribe', { events: [] }) */
  private send(
    method: string,
    params: unknown,
    timeoutMs = ACTIVE_TIMEOUT_MS,
    delayMs = 0,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('CDP disconnected'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.log('cdp.timeout', { id, method, timeoutMs })
        reject(new Error(`CDP ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer, delayMs })
      if (method === 'Page.screencastFrameAck' && this.streamTelemetry) {
        this.streamTelemetry.sent++
        this.flushStreamTelemetry()
      } else this.log('cdp.sent', { id, method })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch {
        this.log('cdp.send-failed', { id, method })
        this.close()
      }
    })
  }

  /** Resolves only the matching pending ID when a wire or delayed response arrives. @example this.receive({ id: 1, result: {} }) */
  private receive(message: WireResponse): void {
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) {
      this.log('cdp.late-response-ignored', { id: message.id })
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (
      pending.method === 'Page.screencastFrameAck' &&
      this.streamTelemetry &&
      !message.error
    ) {
      this.streamTelemetry.responses++
      this.flushStreamTelemetry()
    } else
      this.log('cdp.response', {
        id: message.id,
        method: pending.method,
        failed: Boolean(message.error),
      })
    if (message.error)
      pending.reject(new Error(`${pending.method}: ${message.error.message}`))
    else pending.resolve(message.result)
  }

  /** Fails outstanding work on close/error or explicit teardown without retrying input. @example this.disconnected() */
  private disconnected(): void {
    if (this.closed) return
    this.closed = true
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('CDP disconnected'))
    }
    for (const timer of this.delayedTimers) clearTimeout(timer)
    this.pending.clear()
    this.flushStreamTelemetry(true)
    this.onClose?.()
  }

  /** Emits a bounded cumulative interval summary on frame traffic and teardown without suppressing failure events. @example this.flushStreamTelemetry(true) */
  private flushStreamTelemetry(final = false): void {
    const summary = this.streamTelemetry
    if (!summary || (!summary.sent && !summary.responses)) return
    const now = summary.clock()
    if (!final && now - summary.at < STREAM_TELEMETRY_INTERVAL_MS) return
    this.log('cdp.screencast-summary', {
      sinceMs: summary.at,
      untilMs: now,
      sent: summary.sent,
      responses: summary.responses,
    })
    summary.at = now
    summary.sent = 0
    summary.responses = 0
  }
}
