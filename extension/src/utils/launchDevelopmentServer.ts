import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import {
  REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS,
  REPOSITORY_APPLICATION_LOG_LIMIT_BYTES,
  DEVELOPMENT_SERVER_MESSAGE_QUEUE_LIMIT,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from '../constants'
import { repositoryEntryPathSchema } from '../repositoryConfigSchemas'
import type { Cdp } from '../runtimeSupport/cdp'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { isEndpointClosed } from '../runtimeSupport/utils/isEndpointClosed'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createOutputRedactor } from './createOutputRedactor'
import { buildDevelopmentServerEnvironment } from './developmentServerEnvironment'
import { isProcessGroupGone } from './isProcessGroupGone'
import { keepUtf8Tail } from './keepUtf8Tail'
import {
  beginReleaseOfOwnedDevelopmentPort,
  claimOwnedDevelopmentPort,
  releaseOwnedDevelopmentPort,
} from './ownedDevelopmentPorts'
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint'
import { signalProcessGroup } from './signalProcessGroup'
import { verifyServerInspectorOwnership } from './verifyServerInspectorOwnership'

/** What differs between the development servers one launch serves: the process to run, and how its messages and output are handled. Next uses none of it; the Vite launcher uses all of it. */
export type DevelopmentLaunchSpec = {
  /** The Node arguments: the entry module path first. */
  arguments: string[]
  /** The complete environment of the process. */
  environment: NodeJS.ProcessEnv
  /** Opens a Node IPC channel beside stdout and stderr. */
  ipc?: boolean
  /** Masks values the process was given or loaded before the published text leaves this module. */
  mask?: (text: string) => string
  /** How many characters the longest masked value has (read at call time): output of that length stays unpublished until a value split over chunks can be matched whole. Required with `mask`. */
  maskHoldback?: () => number
  /** Tells a message of the process's own protocol from anything project code sends over the same channel; other messages are dropped. */
  acceptMessage?: (message: unknown) => boolean
  /** Names the server in timeout and exit sentences: `owned <name> listener`. */
  name?: string
  /** Runs once the owned process group is gone, for cleanup of files the server leaves behind. */
  afterClose?: () => Promise<void>
}

/** Acquires one owned process group synchronously for {@link ConfiguredBrowserRun}, exposing cancellable readiness and bounded shutdown. @param inspectServer - Whether to open the native server inspector. @param port - The project's own port ({@link readDeclaredDevelopmentPort}); required, so no caller can skip the lookup and the app is never started on another port. @example const app = launchDevelopmentServer(target, node, record, false, 3165); await app.ready(signal) */
export function launchDevelopmentServer(
  target: string,
  node: string,
  record: (type: string, detail?: unknown) => unknown,
  inspectServer: boolean,
  port: number,
  spec?: DevelopmentLaunchSpec,
) {
  const environment = spec?.environment ?? buildDevelopmentServerEnvironment()
  const arguments_ = spec?.arguments ?? [
    join(target, 'node_modules/next/dist/bin/next'),
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ]
  if (inspectServer && !spec) arguments_.push('--inspect', '127.0.0.1:0')
  const serverName = spec?.name ?? 'Next'
  const child = spawn(node, arguments_, {
    cwd: target,
    env: environment,
    detached: true,
    stdio: spec?.ipc
      ? ['ignore', 'pipe', 'pipe', 'ipc']
      : ['ignore', 'pipe', 'pipe'],
  })
  const { stdout, stderr } = child
  if (!stdout || !stderr)
    throw new Error('The owned server has no output pipes')
  // Messages the process sends over the IPC channel wait here until a caller asks for the next one.
  const messages: unknown[] = []
  // Project code may call `process.send` too: only protocol messages are kept, and no more than the queue limit.
  child.on('message', (message) => {
    if (spec?.acceptMessage && !spec.acceptMessage(message)) return
    if (messages.length < DEVELOPMENT_SERVER_MESSAGE_QUEUE_LIMIT)
      messages.push(message)
  })
  // The raw tail serves origin detection only and is never published; `publishedLog` is its redacted counterpart, the one the journal and failure messages carry.
  let log = Buffer.alloc(0),
    publishedLog = '',
    pendingLog = '',
    inspectorLog = Buffer.alloc(0),
    inspectorCandidate: string | undefined,
    inspectorError: Error | undefined
  let error: Error | undefined,
    origin: string | undefined,
    closing: Promise<void> | undefined
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.once('error', (cause) => {
      error = cause
      resolve()
    })
  })
  const receive = (chunk: Buffer): void => {
    log = Buffer.concat([log, chunk]).subarray(
      -REPOSITORY_APPLICATION_LOG_LIMIT_BYTES,
    )
  }
  // Output is masked by value before any cut: `publishedLog` holds only settled text that is already masked, `pendingLog` the newest output that is not yet, because a known value may still continue in the next chunk.
  // The settled text is cut back to its byte limit only once it has doubled, so a chatty server pays no copy of the whole tail per chunk.
  const publish = (text: string): void => {
    if (!text) return
    if (!spec?.mask) {
      publishedLog += text
    } else {
      // Masking the whole pending text matches every value inside it; its last characters stay pending so a value that crosses this chunk's end is matched with the next chunk.
      const masked = spec.mask(pendingLog + text)
      const holdback = Math.max(0, (spec.maskHoldback?.() ?? 0) - 1)
      const settledEnd = Math.max(0, masked.length - holdback)
      publishedLog += masked.slice(0, settledEnd)
      pendingLog = masked.slice(settledEnd)
    }
    if (publishedLog.length > 2 * REPOSITORY_APPLICATION_LOG_LIMIT_BYTES)
      publishedLog = keepUtf8Tail(
        publishedLog,
        REPOSITORY_APPLICATION_LOG_LIMIT_BYTES,
      )
  }
  const publishedTail = (): string =>
    keepUtf8Tail(
      publishedLog + (spec?.mask ? spec.mask(pendingLog) : pendingLog),
      REPOSITORY_APPLICATION_LOG_LIMIT_BYTES,
    )
  // Each channel is redacted statefully, so a credential the server prints across chunks is masked before it is kept for publication.
  // A channel's held text is flushed once: at its stream's end, or when the closed journal is written first (the process can exit before its streams end).
  const flushes: (() => void)[] = []
  for (const stream of [stdout, stderr]) {
    const decoder = new StringDecoder('utf8')
    const redactor = createOutputRedactor()
    let flushed = false
    const flush = (): void => {
      if (flushed) return
      flushed = true
      publish(redactor.write(decoder.end()) + redactor.end())
    }
    stream.on('data', (chunk: Buffer) => {
      receive(chunk)
      publish(redactor.write(decoder.write(chunk)))
    })
    stream.on('end', flush)
    flushes.push(flush)
  }
  stderr.on('data', (chunk: Buffer) => {
    if (!inspectServer || inspectorError) return
    inspectorLog = Buffer.concat([inspectorLog, chunk]).subarray(
      -REPOSITORY_APPLICATION_LOG_LIMIT_BYTES,
    )
    try {
      const candidate = readNodeInspectorEndpoint(inspectorLog.toString('utf8'))
      if (candidate && inspectorCandidate && candidate !== inspectorCandidate)
        throw new Error('Server inspector endpoint changed during acquisition')
      inspectorCandidate ??= candidate
    } catch (cause) {
      inspectorError = cause instanceof Error ? cause : new Error(String(cause))
    }
  })
  // A launcher with an IPC channel learns its port from the config it resolves, so it claims the port later ({@link declarePort}).
  let declaredPort: number | undefined = spec?.ipc ? undefined : port
  let claim = spec?.ipc ? undefined : claimOwnedDevelopmentPort(port)
  record('application.acquired', {
    pid: child.pid,
    node,
    arguments: arguments_,
    cwd: target,
    secretEnvironmentInherited: false,
  })
  return {
    pid: child.pid,
    isRunning: () =>
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null &&
      error === undefined &&
      closing === undefined,
    /**
     * Waits for the next message the process sent over its IPC channel, for the Vite launcher handshake.
     * @param timeoutMs - How long the message may take.
     * @param signal - Ends the wait when the run is cancelled.
     * @returns The message as the process sent it.
     * @throws When the process exits first (the message carries the redacted output tail) or the wait times out.
     */
    async nextMessage(
      timeoutMs: number,
      signal: AbortSignal,
    ): Promise<unknown> {
      return waitUntil(
        () => {
          if (messages.length) return { message: messages.shift() }
          if (error || child.exitCode !== null || child.signalCode !== null)
            throw (
              error ??
              new Error(
                `Application exited: ${child.exitCode ?? child.signalCode}: ${publishedTail()}`,
              )
            )
          return undefined
        },
        'a message of the owned launcher',
        timeoutMs,
        signal,
      ).then((received) => received.message)
    },
    /** Sends one message to the process over its IPC channel. @example app.send({ type: 'vite-listen' }) */
    send(message: unknown): void {
      if (!child.connected) throw new Error('The launcher is not connected')
      child.send(message as never)
    },
    /** The output tail a refusal may quote: redacted and masked. @example app.outputTail() */
    outputTail: publishedTail,
    /** Claims the port a launcher resolved, so no other run starts on it and the readiness check looks for it. @example app.declarePort(3010) */
    declarePort(resolved: number): void {
      declaredPort = resolved
      claim ??= claimOwnedDevelopmentPort(resolved)
    },
    /** Checks the selected native inspector against this launch before granting server control. @example await app.verifyInspector(cdp, signal) */
    async verifyInspector(
      inspector: Pick<Cdp, 'request'>,
      signal: AbortSignal,
    ) {
      const assertRunning = (): void => {
        if (
          !inspectServer ||
          !child.pid ||
          closing ||
          child.exitCode !== null ||
          child.signalCode !== null ||
          error
        )
          throw new Error(
            'Owned server is unavailable for inspector verification',
          )
      }
      assertRunning()
      return verifyServerInspectorOwnership(
        inspector,
        target,
        child.pid!,
        signal,
        assertRunning,
      )
    },
    /** Supplies only a candidate for native server attachment; process identity must be verified before runtime control. @example await app.inspectorEndpoint(signal) */
    async inspectorEndpoint(signal: AbortSignal): Promise<string> {
      if (!inspectServer)
        throw new Error(
          'Server inspection was not requested for this application',
        )
      return waitUntil(
        () => {
          if (
            closing ||
            child.exitCode !== null ||
            child.signalCode !== null ||
            error
          )
            throw (
              error ??
              new Error(
                'Application stopped before server inspector acquisition',
              )
            )
          if (inspectorError) throw inspectorError
          return inspectorCandidate
        },
        'owned application inspector announcement',
        REPOSITORY_SETUP_TIMEOUT_MS,
        signal,
      )
    },
    /** Waits for the listener on the declared port, then proves readiness through the configured entry page (the root page only when entryPath is "/"); called during preparation. @param entryPath - Configured first page; a non-root entry must answer 200 without a redirect. @example await app.ready(signal, '/login') */
    async ready(signal: AbortSignal, entryPath = '/') {
      repositoryEntryPathSchema.parse(entryPath)
      if (declaredPort === undefined)
        throw new Error('The launcher declared no port')
      origin = await waitUntil(
        () => {
          if (error || child.exitCode !== null)
            throw (
              error ??
              new Error(
                `Application exited: ${child.exitCode}: ${publishedTail()}`,
              )
            )
          // A launcher with an IPC channel reports its verified listening port before `ready` is called, so its origin never depends on printed URLs (a project's logLevel can silence them).
          if (spec?.ipc) return `http://127.0.0.1:${declaredPort}`
          // Process chunks may split a port; only a received delimiter proves its complete value. Only the declared port counts: another local URL in the log (an API, a proxy) is not the app's origin (F552).
          return new RegExp(
            `http://127\\.0\\.0\\.1:${declaredPort}(?=\\D)`,
          ).exec(log.toString('utf8'))?.[0]
        },
        `owned ${serverName} listener`,
        REPOSITORY_SETUP_TIMEOUT_MS,
        signal,
      )
      // A selected non-root entry proves readiness itself; an application without a root page is still usable through it.
      if (entryPath === '/') {
        const response = await fetch(origin, {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(REPOSITORY_SETUP_TIMEOUT_MS),
          ]),
        })
        await response.body?.cancel()
        if (!response.ok)
          throw new Error(
            `Application root failed: ${response.status}: ${publishedTail()}`,
          )
      } else {
        const entry = await fetch(`${origin}${entryPath}`, {
          redirect: 'manual',
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(REPOSITORY_SETUP_TIMEOUT_MS),
          ]),
        })
        await entry.body?.cancel()
        if (!entry.ok)
          throw new Error(
            `Selected application page failed or redirected: ${entry.status}. Select the actual entry path and prerequisites.`,
          )
      }
      record('application.ready', { pid: child.pid, origin })
      return origin
    },
    /** Stops only the acquired process group and verifies its listener; cleanup calls this even after failed readiness. @example await app.close() */
    async close(): Promise<void> {
      const stopAndRelease = async (): Promise<void> => {
        if (claim) beginReleaseOfOwnedDevelopmentPort(claim)
        if (child.pid) {
          const processGroup = child.pid
          // A group whose exited members macOS has not reaped yet answers EPERM; both utilities wait for it instead of failing the release.
          signalProcessGroup(processGroup, 'SIGTERM')
          const waitForExit = async (): Promise<void> => {
            await awaitResponse(
              exited,
              `owned ${serverName} exit`,
              undefined,
              REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS,
            )
            await waitUntil(
              () => isProcessGroupGone(processGroup),
              `owned ${serverName} process group exit`,
              REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS,
            )
          }
          // A leader may exit before its workers; escalation must cover the entire owned group.
          try {
            await waitForExit()
          } catch {
            signalProcessGroup(processGroup, 'SIGKILL')
            await waitForExit()
          }
        }
        if (origin)
          await waitUntil(
            () => isEndpointClosed(origin!),
            `owned ${serverName} listener exit`,
            REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS,
          )
        if (claim) releaseOwnedDevelopmentPort(claim)
      }
      const attempt = (closing ??= (async () => {
        let failure: { cause: unknown } | undefined
        try {
          await stopAndRelease()
        } catch (cause) {
          failure = { cause }
        }
        // Transient files are removed whether or not the stop succeeded; an earlier failure wins over a cleanup failure.
        try {
          await spec?.afterClose?.()
        } catch (cause) {
          failure ??= { cause }
        }
        if (failure) throw failure.cause
        for (const flush of flushes) flush()
        record('application.closed', {
          pid: child.pid,
          origin,
          exitCode: child.exitCode,
          signal: child.signalCode,
          log: publishedTail(),
        })
      })())
      // Preserve successful release, while allowing a later stop to retry a failed signal or exit check.
      try {
        await attempt
      } catch (cause) {
        if (closing === attempt) closing = undefined
        throw cause
      }
    },
  }
}
