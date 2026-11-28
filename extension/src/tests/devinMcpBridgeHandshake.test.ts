import assert from 'node:assert/strict'
import { realpath } from 'node:fs/promises'
import { type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { z } from 'zod'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { bridgeStopMarksPreload } from './utils/bridgeStopMarksPreload'
import {
  createFolders,
  writeDescriptor,
  runCapturingStderr,
  listen,
  CURSOR_BRIDGE_MODULE_PATH,
  launchDevinBridge,
  DEVIN_INITIALIZE_REQUEST,
  occurrencesOf,
} from './utils/devinMcpBridgeHarness'
import { handMovedInputClock } from './utils/handMovedInputClock'
import { within } from './utils/within'

/** Requests 0 to 3 as one text, Devin's initialize first and three pings after it, cut inside the second ping, so a test can send them in two writes with one message split across both. */
function initializeAndPingsInTwoParts(): [string, string] {
  const input = [
    DEVIN_INITIALIZE_REQUEST,
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]
    .map((message) => `${JSON.stringify(message)}\n`)
    .join('')
  const splitAt = input.indexOf('"id":2') + 3
  return [input.slice(0, splitAt), input.slice(splitAt)]
}

// Value: protects=every message Devin sent while the bridge's first attempt waited reaching the bridge's MCP server from its next attempt, once each and in order, after a busy (429) answer, a message split across two reads included (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=the input the first attempt read to see its end is not given back whole and in order for the next attempt, so Devin's initialize or a ping is lost, sent twice or reordered; no_claim=the hand-over without a retry (cursorMcpBridge tests), the order of the initialize answer among the pings (each handler answers when it finishes)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a Devin bridge answers once each, in order, the messages Devin sent while its first attempt waited, after that attempt was answered 429',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    let heldFirstInitialize: ServerResponse | undefined
    const { bridge } = await launchDevinBridge(context, {
      preloadSource: bridgeStopMarksPreload(),
      decide: async (method, initializesSoFar, _http, _session, _gone, out) => {
        // The first attempt's initialize waits until the test answers it 429.
        if (method !== 'initialize' || initializesSoFar !== 1) return undefined
        heldFirstInitialize = out
        return 'answered'
      },
    })
    const firstInitialize = await waitUntil(
      () => heldFirstInitialize,
      "the first attempt's initialize held",
      15_000,
      undefined,
      5,
    )
    const [firstPart, secondPart] = initializeAndPingsInTwoParts()
    bridge.write(firstPart)
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_DATA_READ 1\n'),
      'the bridge reading the first part of the input',
      10_000,
      undefined,
      5,
    )
    bridge.write(secondPart)
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_DATA_READ 2\n'),
      'the bridge reading the second part of the input',
      10_000,
      undefined,
      5,
    )
    // Act
    firstInitialize.writeHead(429)
    firstInitialize.end()
    await waitUntil(
      () => bridge.readMessages().length >= 4,
      'the answers to the four requests',
      15_000,
      undefined,
      5,
    )
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 10_000)
    // Assert
    const answers = bridge.readMessages()
    assert.equal(exitCode, 0)
    assert.deepEqual(answers.map((answer) => answer.id).sort(), [0, 1, 2, 3])
    assert.deepEqual(
      answers.filter((answer) => answer.id !== 0).map((answer) => answer.id),
      [1, 2, 3],
    )
    assert.deepEqual(
      answers.filter((answer) => answer.error !== undefined),
      [],
    )
    assert.equal(
      answers.every((answer) => answer.result !== undefined),
      true,
    )
    assert.equal(bridge.counts.initializes, 2)
  },
)

// Value: protects=a prompt end of the Devin bridge, with exit code 0, a DELETE for the session its first initialize opened and no further attempt, when Devin closes it during its first handshake (Cycle 0146 /ship pass 1, outside-voice 9); fails_when=the bridge sees the end of its input only once it serves, so it waits for that handshake to the end of its startup window, tries again and ends with a refusal line and exit code 1 after Devin already ended it; no_claim=that the server reclaims the session (the release is a best-effort DELETE for the id the bridge knows), a stop while the bridge serves (the tests above)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a Devin bridge that Devin closes during its first handshake releases that session and ends with exit code 0, without a refusal line or a second attempt',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    let isHeldNotificationGone: (() => boolean) | undefined,
      releases = 0
    const { bridge } = await launchDevinBridge(context, {
      preloadSource: bridgeStopMarksPreload(),
      decide: async (method, _initializes, httpMethod, _session, isGone) => {
        if (httpMethod === 'DELETE') releases += 1
        if (method !== 'notifications/initialized') return undefined
        // Held through the bridge's exit: never answered.
        isHeldNotificationGone = isGone
        return 'answered'
      },
    })
    bridge.write(`${JSON.stringify(DEVIN_INITIALIZE_REQUEST)}\n`)
    const isNotificationGone = await waitUntil(
      () => isHeldNotificationGone,
      'the first initialized notification held',
      15_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 5_000)
    // The child's exit does not wait for the proxy to see that connection close, so that is observed on its own, within a bound.
    const wasNotificationClosed = await waitUntil(
      () => isNotificationGone(),
      'the proxy seeing the held notification closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    const stderr = bridge.readStderr()
    assert.equal(exitCode, 0)
    assert.equal(wasNotificationClosed, true)
    assert.equal(releases, 1)
    assert.equal(bridge.counts.initializes, 1)
    assert.equal(stderr.includes('Codebook bridge: instance'), false)
    assert.equal(stderr.includes('Codebook is not running'), false)
    assert.equal(stderr.includes('not set up'), false)
    assert.equal(stderr.includes('could not connect'), false)
  },
)

// Value: protects=a prompt end of the Devin bridge with exit code 0 and no refusal line when Devin closes its stdin while the bridge pauses between two attempts after a busy answer, with nothing read from stdin yet (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=the end of input that comes between two attempts is lost, so the next attempt's first handshake runs to the end of the startup window and the bridge ends with a refusal line and exit code 1; no_claim=input read before the pause (the 429 order test above)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a Devin bridge whose stdin closes while it pauses after a busy answer ends with exit code 0 at its next attempt, without a refusal line',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    const { bridge } = await launchDevinBridge(context, {
      preloadSource: bridgeStopMarksPreload(),
      decide: async (method, initializesSoFar) => {
        // The first attempt is answered 429 at once; the next one's initialized notification is held through the bridge's exit.
        if (method === 'initialize' && initializesSoFar === 1) return 429
        return method === 'notifications/initialized' ? 'answered' : undefined
      },
    })
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge pausing its input after the busy answer',
      15_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 5_000)
    // Assert
    const stderr = bridge.readStderr()
    assert.equal(exitCode, 0)
    assert.equal(stderr.includes('Codebook bridge: instance'), false)
    assert.equal(stderr.includes('Codebook is not running'), false)
    assert.equal(stderr.includes('not set up'), false)
    assert.equal(stderr.includes('could not connect'), false)
  },
)

// Value: protects=the Devin bridge ending as a stop 5 s after its input first reached the startup input limit, counted across a retry, with its session released and its client still connected (Cycle 0147 task 8, Codex review F8.2); fails_when=each attempt restarts the wait, or the bridge waits for the end of its startup window and exits 1 with a refusal; no_claim=the real clock's timing (the child's input clock is moved by hand), the order where the attempt's own time limit comes first (the next test), signals
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a Devin bridge whose input reached its startup input limit 3 seconds before a busy answer ends 5 seconds after that limit, not 5 seconds after its next attempt, with exit code 0 and stdin still open',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    let heldFirstInitialize: ServerResponse | undefined,
      isHeldNotificationGone: (() => boolean) | undefined,
      releases = 0
    const inputClock = await handMovedInputClock(context)
    const { bridge } = await launchDevinBridge(context, {
      preloadSource: bridgeStopMarksPreload() + inputClock.preloadSource,
      decide: async (
        method,
        initializesSoFar,
        httpMethod,
        _session,
        isGone,
        out,
      ) => {
        if (httpMethod === 'DELETE') releases += 1
        // The first attempt's initialize waits until the test answers it 429.
        if (method === 'initialize' && initializesSoFar === 1) {
          heldFirstInitialize = out
          return 'answered'
        }
        if (method !== 'notifications/initialized') return undefined
        // Held through the bridge's exit: never answered.
        isHeldNotificationGone = isGone
        return 'answered'
      },
    })
    const firstInitialize = await waitUntil(
      () => heldFirstInitialize,
      "the first attempt's initialize held",
      15_000,
      undefined,
      5,
    )
    bridge.write('x'.repeat(1_048_576))
    // The first pause of stdin is the hold's at the startup input limit: nothing pauses it before.
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge stopping its read at the startup input limit',
      10_000,
      undefined,
      5,
    )
    await inputClock.advance(bridge, 3_000)
    // Act
    firstInitialize.writeHead(429)
    firstInitialize.end()
    const isNotificationGone = await waitUntil(
      () => isHeldNotificationGone,
      "the next attempt's initialized notification held",
      15_000,
      undefined,
      5,
    )
    await inputClock.advance(bridge, 2_000)
    const exitCode = await within(bridge.exited, 5_000)
    // The child's exit does not wait for the proxy to see that connection close, so that is observed on its own, within a bound.
    const wasNotificationClosed = await waitUntil(
      () => isNotificationGone(),
      'the proxy seeing the held notification closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    const stderr = bridge.readStderr()
    assert.equal(exitCode, 0)
    assert.equal(wasNotificationClosed, true)
    assert.equal(releases, 1)
    assert.equal(bridge.counts.initializes, 2)
    assert.equal(stderr.includes('Codebook bridge: instance'), false)
    assert.equal(stderr.includes('Codebook is not running'), false)
    assert.equal(stderr.includes('not set up'), false)
    assert.equal(stderr.includes('could not connect'), false)
  },
)

// Value: protects=the Devin bridge's own answer and exit code 1 when its attempt's time limit ends before the wait at the startup input limit, also when the input clock has passed both by the time that attempt's end is handled, as on a busy event loop (Cycle 0147 task 8, Codex review D14); fails_when=the wait that ended later wins because it is judged by the moment the attempt's end was handled, so the bridge ends as a silent stop with exit code 0; no_claim=a late attempt after the startup window (none starts here: the attempt's descriptor is dropped and no other matches), the real clock's timing
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  "a Devin bridge whose attempt's own time limit ends before the wait at its startup input limit still says Codebook is not running, with exit code 1, also when both have passed by the time that attempt ends",
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    let isInitializeHeld = false,
      releases = 0
    const inputClock = await handMovedInputClock(context)
    const { bridge } = await launchDevinBridge(context, {
      preloadSource: bridgeStopMarksPreload() + inputClock.preloadSource,
      decide: async (method, _initializes, httpMethod) => {
        if (httpMethod === 'DELETE') releases += 1
        if (method !== 'initialize') return undefined
        // Held through the bridge's exit: the attempt's own time limit, the rest of the 15 s startup window, ends it.
        isInitializeHeld = true
        return 'answered'
      },
    })
    await waitUntil(
      () => isInitializeHeld,
      "the first attempt's initialize held",
      15_000,
      undefined,
      5,
    )
    // The attempt's time limit ends at most 15 s of the input clock after its hold began at 0; the limit is reached at 12 s, so the wait ends at 17 s.
    await inputClock.advance(bridge, 12_000)
    bridge.write('x'.repeat(1_048_576))
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge stopping its read at the startup input limit',
      10_000,
      undefined,
      5,
    )
    // Both have passed when the attempt's time limit ends, and the wait has not run.
    await inputClock.advance(bridge, 12_000, { runsDueWaits: false })
    // Act
    const exitCode = await within(bridge.exited, 20_000)
    // Assert
    const stderr = bridge.readStderr()
    assert.equal(exitCode, 1)
    assert.equal(
      stderr.includes(
        `Codebook is not running for ${await realpath(bridge.directory)} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.\n`,
      ),
      true,
    )
    assert.equal(stderr.includes('Codebook bridge: instance'), false)
    assert.equal(bridge.counts.initializes, 1)
    assert.equal(releases, 0)
  },
)

/**
 * Source of a preload that arms the time limit of every handshake that has one (the Devin bridge's attempt: `connectWithin`'s wait, the one `node:timers/promises` wait that cursorMcpBridge.js starts) on the child's {@link BRIDGE_INPUT_CLOCK} instead of a real timer, and marks `HANDSHAKE_LIMIT_ARMED` on stderr each time, so only the test's `advance` can run that limit, whatever the runner's speed (CodeRabbit final-range pass of Cycle 0147, CR9). Appended after {@link handMovedInputClock}'s preload, whose `set` it arms with; every wait started from another module (the descriptor read's own time limit, the release bound, the pauses between attempts) keeps its real timer.
 */
const HANDSHAKE_LIMIT_ON_INPUT_CLOCK_PRELOAD = `{
  const timersPromises = require('node:timers/promises')
  const inputClock = require(${JSON.stringify(resolve(__dirname, '../utils/bridgeInputClock.js'))}).BRIDGE_INPUT_CLOCK
  const realWait = timersPromises.setTimeout
  timersPromises.setTimeout = (delayMs, value, options) => {
    // The caller's frame, below this function's own: only a wait cursorMcpBridge.js starts goes on the input clock.
    const callerFrame = new Error().stack.split('\\n')[2] ?? ''
    if (!callerFrame.includes(${CURSOR_BRIDGE_MODULE_PATH})) return realWait(delayMs, value, options)
    require('node:fs').writeSync(2, 'HANDSHAKE_LIMIT_ARMED\\n')
    const { signal } = options
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise((resolveWait, rejectWait) => {
      const onAbort = () => {
        cancel()
        rejectWait(signal.reason)
      }
      const cancel = inputClock.set(() => {
        signal.removeEventListener('abort', onAbort)
        resolveWait(value)
      }, delayMs)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
`

// Value: protects=the Devin bridge's own answer and exit code 1, with no connected line and its session released, when its first handshake completes only after its own time limit and then the wait at its startup input limit ended, before that time limit's timer ran, as on a busy event loop (Cycle 0147 review round, CodeRabbit holdBridgeInput.ts:169); the time limit's timer is armed on the hand-moved input clock and never runs, so only the check of the completed handshake against that limit can refuse it, also on a runner slower than the limit's real 15 s (Cycle 0147 final-range CodeRabbit pass, CR9); fails_when=a connection completed past its time limit is accepted (the settlement counts it as ended at that limit, before the wait's end), so the bridge serves a connection that finished within neither bound and writes its connected line; no_claim=a completion within its time limit after the wait ended (a stop: the Cursor bridge test), a time limit that ends the handshake through its own timer (the test above), the real clock's timing
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'a Devin bridge whose first handshake completes only after its own time limit and then the wait at its startup input limit ended serves nothing and still says Codebook is not running, with exit code 1',
  { skip: process.platform === 'win32', timeout: 40_000 },
  async (context) => {
    // Arrange
    let heldNotification: ServerResponse | undefined,
      releases = 0
    const inputClock = await handMovedInputClock(context)
    const { bridge } = await launchDevinBridge(context, {
      preloadSource:
        bridgeStopMarksPreload() +
        inputClock.preloadSource +
        HANDSHAKE_LIMIT_ON_INPUT_CLOCK_PRELOAD,
      decide: async (
        method,
        _initializes,
        httpMethod,
        _session,
        _isGone,
        out,
      ) => {
        if (httpMethod === 'DELETE') releases += 1
        if (method !== 'notifications/initialized') return undefined
        // Answered by the test once both bounds have passed.
        heldNotification = out
        return 'answered'
      },
    })
    const notification = await waitUntil(
      () => heldNotification,
      "the first attempt's initialized notification held",
      15_000,
      undefined,
      5,
    )
    // The attempt's time limit ends at most 15 s of the input clock after its hold began at 0; the limit is reached at 12 s, so the wait ends at 17 s. No advance runs a due wait, so the time limit's timer, armed on this clock, never runs.
    await inputClock.advance(bridge, 12_000, { runsDueWaits: false })
    bridge.write('x'.repeat(1_048_576))
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge stopping its read at the startup input limit',
      10_000,
      undefined,
      5,
    )
    // Both have passed, the time limit first, and neither the time limit's timer nor the wait has run.
    await inputClock.advance(bridge, 6_000, { runsDueWaits: false })
    // Act
    notification.writeHead(202)
    notification.end()
    const exitCode = await within(bridge.exited, 20_000)
    // Assert
    const stderr = bridge.readStderr()
    // The one attempt's time limit was armed on the input clock, which ran no wait: its timer did not end the handshake.
    assert.equal(occurrencesOf(stderr, 'HANDSHAKE_LIMIT_ARMED\n'), 1)
    assert.equal(exitCode, 1)
    assert.equal(
      stderr.includes(
        `Codebook is not running for ${await realpath(bridge.directory)} in this Devin Desktop window. Open Codebook here, run Codebook: Set Up AI Chat, then reload the window.\n`,
      ),
      true,
    )
    assert.equal(stderr.includes('Codebook bridge: instance'), false)
    assert.equal(bridge.counts.initializes, 1)
    assert.equal(releases, 1)
  },
)

// Value: protects=runDevinMcpBridge ending with no refusal, no connected line and no second attempt, after calling its onClosed once, when a signal stops the first handshake, also for a caller whose onClosed returns instead of ending the process (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=connectOnce treats the stopped connection as connected (writes the connected line) or as a failed one (tries again, then returns a refusal line), or onClosed runs twice or never; no_claim=the bridge entry's process exit (the child-process tests above)
// Not run on Windows: this test is built on POSIX file modes and signals, and the private-file mode check does not apply there.
test(
  'runDevinMcpBridge returns no refusal and calls onClosed once without a second attempt when a signal stops its first handshake',
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const { agentDir, workspace } = await createFolders(context)
    let initializes = 0,
      releases = 0,
      closings = 0,
      isNotificationHeld = false
    const { port } = await listen(context, (incoming, outgoing) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        if (incoming.method === 'DELETE') {
          releases += 1
          outgoing.writeHead(200)
          outgoing.end()
          return
        }
        const message = z
          .looseObject({
            id: z.number().optional(),
            method: z.string(),
            params: z
              .looseObject({ protocolVersion: z.string().optional() })
              .optional(),
          })
          .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        // The initialized notification is held: never answered.
        if (message.method !== 'initialize') {
          isNotificationHeld = true
          return
        }
        initializes += 1
        outgoing.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'session-1',
        })
        outgoing.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: 'held', version: '1' },
            },
          }),
        )
      })
    })
    await writeDescriptor(agentDir, 0, workspace, process.pid, {
      url: `http://127.0.0.1:${port}/mcp`,
    })
    const run = runCapturingStderr(
      agentDir,
      workspace,
      { WINDSURF_EXT_HOST_PID: String(process.pid) },
      {
        timeoutMs: 1_500,
        intervalMs: 20,
        onClosed: () => {
          closings += 1
        },
      },
    )
    await waitUntil(
      () => isNotificationHeld,
      'the first initialized notification held',
      5_000,
      undefined,
      5,
    )
    // Act
    // Reaches only the bridge's own listeners: the test runner's process has none, and an emitted signal has no default action.
    process.emit('SIGINT')
    const finished = await within(run, 5_000)
    // Assert
    if (finished === 'still waiting')
      assert.fail('the bridge was still running 5 seconds after the signal')
    assert.equal(finished.exitCode, undefined)
    assert.equal(
      finished.lines.some((line) => line.includes('Codebook bridge: instance')),
      false,
    )
    assert.equal(closings, 1)
    assert.equal(initializes, 1)
    assert.equal(releases, 1)
  },
)
