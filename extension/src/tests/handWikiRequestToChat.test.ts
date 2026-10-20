import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handWikiRequestToChat } from '../utils/handWikiRequestToChat'

import { createManualClock } from './utils/createManualClock'

/** A sleep on a clock the test moves: it ends at the clock's time or at the abort, and at once for a signal that has already aborted, as the product's sleep does. */
function manualSleep(): {
  clock: ReturnType<typeof createManualClock>
  sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
} {
  const clock = createManualClock()
  return {
    clock,
    sleep: (delayMs, signal): Promise<void> =>
      new Promise<void>((resolveSleep) => {
        if (signal.aborted) return resolveSleep()
        const timer = clock.setTimeout(resolveSleep, delayMs)
        signal.addEventListener(
          'abort',
          () => {
            clock.clearTimeout(timer)
            resolveSleep()
          },
          { once: true },
        )
      }),
  }
}

/** Lets the hand-over run until it waits for the clock or for a command. */
const untilItWaits = (): Promise<void> =>
  new Promise((resolveWait) => setImmediate(resolveWait))

// Value: protects=the learner's own chat when an update starts: the request is sent only into a session the editor's New Chat made for it; fails_when=the request is sent first or without New Chat, so it lands in the session the learner uses, or New Chat runs before the chat the request goes to was revealed (it then clears another chat, an inline chat for example); why_new=Cycle 0046 row 129; seam=none
test('the update request is handed over in three editor commands in this order: the chat is revealed without a query, New Chat runs without an argument, then the request is sent and its reply is the hand-over’s', async () => {
  // Arrange
  const ranCommands: unknown[][] = []
  const { sleep } = manualSleep()

  // Act
  const { session, handOver } = await handWikiRequestToChat({
    query: '/codebook Update LLM Wiki',
    runCommand: async (...command) => {
      ranCommands.push(command)
      return command.length > 1 ? { metadata: 'the reply' } : undefined
    },
    signal: new AbortController().signal,
    sessionStartTimeoutMs: 5_000,
    sleep,
  })
  const reply = await handOver

  // Assert
  assert.equal(session, 'own')
  assert.deepEqual(ranCommands, [
    ['workbench.action.chat.open'],
    ['workbench.action.chat.newChat'],
    [
      'workbench.action.chat.open',
      {
        query: '/codebook Update LLM Wiki',
        isPartialQuery: false,
        blockOnResponse: true,
      },
    ],
  ])
  assert.deepEqual(reply, { metadata: 'the reply' })
})

// Value: protects=the Codebook skill in the update's request: the editor resolves the request's /codebook command and attaches the skill only for a query it sends through the chat's input; fails_when=the request is sent with the option that keeps the input (`preserveInput`), with which the editor skips that step; why_new=Cycle 0046 row 197 (the option would keep a draft, at the price of the skill); seam=none
test('the request is sent through the chat’s input, with the three options it had and without the option that keeps the input, so the editor resolves its /codebook command', async () => {
  // Arrange
  const requestOptions: unknown[] = []
  const { sleep } = manualSleep()

  // Act
  const { handOver } = await handWikiRequestToChat({
    query: '/codebook Update LLM Wiki',
    runCommand: async (_command, ...options) => {
      requestOptions.push(...options)
      return {}
    },
    signal: new AbortController().signal,
    sessionStartTimeoutMs: 5_000,
    sleep,
  })
  await handOver

  // Assert
  assert.deepEqual(requestOptions, [
    {
      query: '/codebook Update LLM Wiki',
      isPartialQuery: false,
      blockOnResponse: true,
    },
  ])
})

// Value: protects=the update in an editor that has no New Chat command; fails_when=the missing command fails the hand-over, so no request is sent, or the session is taken for Codebook's own, so the sentence of an update without a sign does not say that the chat may be working on a request of the learner; why_new=Cycle 0046 row 129 (the fallback); seam=none
test('an editor without the New Chat command still gets the request, and the session is reported as shared with the learner', async () => {
  // Arrange
  const ranCommands: string[] = []
  const { sleep } = manualSleep()

  // Act
  const { session, handOver } = await handWikiRequestToChat({
    query: '/codebook Update LLM Wiki',
    runCommand: async (command) => {
      ranCommands.push(command)
      if (command === 'workbench.action.chat.newChat')
        throw new Error("command 'workbench.action.chat.newChat' not found")
      return {}
    },
    signal: new AbortController().signal,
    sessionStartTimeoutMs: 5_000,
    sleep,
  })
  await handOver

  // Assert
  assert.equal(session, 'shared')
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.open',
    'workbench.action.chat.newChat',
    'workbench.action.chat.open',
  ])
})

// Value: protects=a chat the request would not go to (an inline chat that had the focus last); fails_when=New Chat runs although the chat could not be revealed, so it clears whatever chat had the focus last; why_new=Cycle 0046 row 129; seam=none
test('when the chat cannot be revealed New Chat is not run, the session counts as shared, and the failure of the request is the hand-over’s', async () => {
  // Arrange: every chat command of this editor throws.
  const ranCommands: string[] = []
  const { sleep } = manualSleep()

  // Act
  const { session, handOver } = await handWikiRequestToChat({
    query: '/codebook Update LLM Wiki',
    runCommand: async (command) => {
      ranCommands.push(command)
      throw new Error('Chat is unavailable')
    },
    signal: new AbortController().signal,
    sessionStartTimeoutMs: 5_000,
    sleep,
  })
  const failure = await handOver.then(
    () => 'no failure',
    (error: Error) => error.message,
  )

  // Assert
  assert.equal(session, 'shared')
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.open',
    'workbench.action.chat.open',
  ])
  assert.equal(failure, 'Chat is unavailable')
})

// Value: protects=the start of an update when the editor's New Chat never returns (it waits for an answer of the learner, for example); fails_when=the hand-over waits for New Chat for good, so the update never starts and never ends; why_new=Cycle 0046 row 129; seam=the hand-over's sleep, on a manual clock
test('a New Chat that does not return within five seconds is not waited for: the request is sent, and the session counts as shared', async () => {
  // Arrange
  const ranCommands: string[] = []
  const { clock, sleep } = manualSleep()

  // Act
  const handingOver = handWikiRequestToChat({
    query: '/codebook Update LLM Wiki',
    runCommand: (command) => {
      ranCommands.push(command)
      return command === 'workbench.action.chat.newChat'
        ? new Promise(() => {})
        : Promise.resolve({})
    },
    signal: new AbortController().signal,
    sessionStartTimeoutMs: 5_000,
    sleep,
  })
  await untilItWaits()
  clock.advance(4_999)
  await untilItWaits()
  const ranBeforeTheBound = [...ranCommands]
  clock.advance(1)
  // The hand-over is raced against one second, so one that still waits for New Chat fails here instead of hanging.
  const session = await Promise.race([
    handingOver.then((handedOver) => handedOver.session),
    new Promise((resolveWait) =>
      setTimeout(() => resolveWait('still waiting for New Chat'), 1_000),
    ),
  ])

  // Assert
  assert.deepEqual(ranBeforeTheBound, [
    'workbench.action.chat.open',
    'workbench.action.chat.newChat',
  ])
  assert.equal(session, 'shared')
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.open',
    'workbench.action.chat.newChat',
    'workbench.action.chat.open',
  ])
})

// Value: protects=the chat of a window that closes while an update starts; fails_when=the request is still sent after the window began to close, so a chat nobody watches takes it; why_new=Cycle 0046 row 129 (the hand-over now takes two commands before the request); seam=the hand-over's sleep, on a manual clock
test('a window that closes while New Chat runs sends no request, and the hand-over ends without a reply', async () => {
  // Arrange: New Chat never returns; the window closes while it runs.
  const ranCommands: string[] = []
  const { sleep } = manualSleep()
  const closing = new AbortController()

  // Act
  const handingOver = handWikiRequestToChat({
    query: '/codebook Update LLM Wiki',
    runCommand: (command) => {
      ranCommands.push(command)
      return command === 'workbench.action.chat.newChat'
        ? new Promise(() => {})
        : Promise.resolve({})
    },
    signal: closing.signal,
    sessionStartTimeoutMs: 5_000,
    sleep,
  })
  await untilItWaits()
  closing.abort()
  const { handOver } = await handingOver
  const reply = await handOver

  // Assert
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.open',
    'workbench.action.chat.newChat',
  ])
  assert.equal(reply, undefined)
})
