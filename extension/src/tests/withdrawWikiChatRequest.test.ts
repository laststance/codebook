import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withdrawWikiChatRequest } from '../utils/withdrawWikiChatRequest'

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

/** Lets the withdrawal run until it waits for the clock or for a command. */
const untilItWaits = (): Promise<void> =>
  new Promise((resolveWait) => setImmediate(resolveWait))

// Value: protects=the chat after a chat command that returned without a reply (the chat made no response, so it holds no request); fails_when=the withdrawal runs the chat's commands for a request that does not exist, so they act on a request of the learner, or reports a request as taken back that was never there; why_new=Cycle 0046 rows 82 and 150; seam=none
test('a hand-over command that has already returned without a reply is reported as a request the chat never held, and no chat command runs', async () => {
  // Arrange
  const ranCommands: string[] = []
  const { sleep } = manualSleep()

  // Act
  const withdrawal = await withdrawWikiChatRequest({
    handOver: Promise.resolve(undefined),
    runChatCommand: async (command) => {
      ranCommands.push(command)
    },
    session: 'shared',
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })

  // Assert
  assert.equal(withdrawal, 'not-sent')
  assert.deepEqual(ranCommands, [])
})

// Value: protects=the chat after a chat command that threw (no request was made); fails_when=only a hand-over command that resolved counts as returned, so the chat's commands run for a request that does not exist and act on a request of the learner; why_new=Cycle 0046 row 82; seam=none
test('a hand-over command that threw before the withdrawal is reported as a request the chat never held, and no chat command runs', async () => {
  // Arrange
  const ranCommands: string[] = []
  const { sleep } = manualSleep()

  // Act
  const withdrawal = await withdrawWikiChatRequest({
    handOver: Promise.reject(new Error('Chat is unavailable')),
    runChatCommand: async (command) => {
      ranCommands.push(command)
    },
    session: 'shared',
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })

  // Assert
  assert.equal(withdrawal, 'not-sent')
  assert.deepEqual(ranCommands, [])
})

// Value: protects=the learner's own requests in the chat focused last when Codebook's request ended with a complete reply in the moment between the bound of the first answer and the withdrawal, and the truth of the end's sentence; fails_when=the withdrawal runs "Remove All Queued" or the chat's Cancel although its request has ended, so they remove the learner's queued requests or stop the learner's request in progress, or the request that ended by itself is reported as one Codebook took back (`withdrawn`); why_new=Cycle 0046 second ship, OCR batch 8 finding 2, and state-machine review P2SM3 (its own outcome); seam=none
test('a hand-over command that has already returned a complete reply is reported as a request that ended by itself with a reply, and no chat command runs, in a shared session or in one of its own', async () => {
  // Arrange: the chat's response is complete ({} is a reply that waits for nothing).
  const ranCommands: string[] = []
  const { sleep } = manualSleep()
  const withdrawnIn = (session: 'own' | 'shared') =>
    withdrawWikiChatRequest({
      handOver: Promise.resolve({}),
      runChatCommand: async (command) => {
        ranCommands.push(command)
      },
      session,
      signal: new AbortController().signal,
      settleMs: 2_000,
      sleep,
    })

  // Act
  const withdrawals = {
    shared: await withdrawnIn('shared'),
    own: await withdrawnIn('own'),
  }

  // Assert
  assert.deepEqual(withdrawals, { shared: 'replied', own: 'replied' })
  assert.deepEqual(ranCommands, [])
})

// Value: protects=the chat that asks for its first approval in the moment between the bound of the first answer and the withdrawal, and the learner's own requests in the chat focused last; fails_when=a hand-over command that has already returned a reply that waits for a confirmation is taken for a request still pending, so the withdrawal runs the chat's Cancel (in a shared session after "Remove All Queued") on a request the chat works on, and reports it as left, although the same reply within the bound counts as the chat at work; why_new=Cycle 0047 row 24 (P3RT2); seam=none
test('a hand-over command that has already returned a reply that waits for a confirmation is reported as a request the chat answered, and no chat command runs, in a shared session or in one of its own', async () => {
  // Arrange: the chat asks to approve a tool call; its response is not complete.
  const ranCommands: string[] = []
  const { sleep } = manualSleep()
  const withdrawnIn = (session: 'own' | 'shared') =>
    withdrawWikiChatRequest({
      handOver: Promise.resolve({
        type: 'confirmation',
        kind: 'toolInvocation',
      }),
      runChatCommand: async (command) => {
        ranCommands.push(command)
      },
      session,
      signal: new AbortController().signal,
      settleMs: 2_000,
      sleep,
    })

  // Act
  const withdrawals = {
    shared: await withdrawnIn('shared'),
    own: await withdrawnIn('own'),
  }

  // Assert
  assert.deepEqual(withdrawals, { shared: 'replied', own: 'replied' })
  assert.deepEqual(ranCommands, [])
})

// Value: protects=what the learner typed into the chat while an update waited for its first answer; fails_when=in a session of Codebook's own the withdrawal runs the chat's "Remove All Queued", which removes the learner's queued requests, or waits two seconds before it stops its own request; why_new=Cycle 0046 row 129; seam=the withdrawal's sleep, on a manual clock
test('in a session of its own Codebook stops its request with the chat’s Cancel at once, and the queue’s command never runs', async () => {
  // Arrange: the request is the session's request in progress; the Cancel ends the hand-over command with an empty reply.
  const ranCommands: string[] = []
  const { clock, sleep } = manualSleep()
  let endRequest: (reply: unknown) => void = () => {}
  const handOver = new Promise((resolveReply) => {
    endRequest = resolveReply
  })

  // Act: what ran before the clock moved is noted; then the settle time a queue command would be given passes.
  const withdrawing = withdrawWikiChatRequest({
    handOver,
    session: 'own',
    runChatCommand: async (command) => {
      ranCommands.push(command)
      if (command === 'workbench.action.chat.cancel') endRequest({})
    },
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })
  await untilItWaits()
  const ranAtOnce = [...ranCommands]
  clock.advance(2_000)
  const withdrawal = await withdrawing

  // Assert
  assert.deepEqual(ranAtOnce, ['workbench.action.chat.cancel'])
  assert.deepEqual(ranCommands, ['workbench.action.chat.cancel'])
  assert.equal(withdrawal, 'withdrawn')
})

// Value: protects=the order of the withdrawal, which keeps the chat's Cancel away from a request of the learner; fails_when=the Cancel runs first, or before the queue's command had its settle time to end a queued request; why_new=Cycle 0046 row 82; seam=the withdrawal's sleep, on a manual clock
test('in a shared session the chat’s Cancel runs only after the queue’s command left the request pending for the whole settle time, and a request it ends is withdrawn', async () => {
  // Arrange: the request is the one in progress; the Cancel ends the hand-over command with an empty reply.
  const ranCommands: string[] = []
  const { clock, sleep } = manualSleep()
  let endRequest: (reply: unknown) => void = () => {}
  const handOver = new Promise((resolveReply) => {
    endRequest = resolveReply
  })

  // Act
  const withdrawing = withdrawWikiChatRequest({
    handOver,
    runChatCommand: async (command) => {
      ranCommands.push(command)
      if (command === 'workbench.action.chat.cancel') endRequest({})
    },
    session: 'shared',
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })
  await untilItWaits()
  clock.advance(1_999)
  await untilItWaits()
  const ranBeforeTheSettleTime = [...ranCommands]
  clock.advance(1)
  const withdrawal = await withdrawing

  // Assert
  assert.deepEqual(ranBeforeTheSettleTime, [
    'workbench.action.chat.removeAllPendingRequests',
  ])
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.removeAllPendingRequests',
    'workbench.action.chat.cancel',
  ])
  assert.equal(withdrawal, 'withdrawn')
})

// Value: protects=the end of an update whose editor does not answer the queue's command; fails_when=the withdrawal waits for that command for good, so the update never ends, or goes on to the Cancel without knowing whose request it would stop; why_new=Cycle 0046 row 82; seam=the withdrawal's sleep, on a manual clock
test('in a shared session a queue command that does not return within the settle time ends the withdrawal as left, and no Cancel runs', async () => {
  // Arrange: no command of the chat ever returns.
  const ranCommands: string[] = []
  const { clock, sleep } = manualSleep()

  // Act
  const withdrawing = withdrawWikiChatRequest({
    handOver: new Promise(() => {}),
    runChatCommand: (command) => {
      ranCommands.push(command)
      return new Promise(() => {})
    },
    session: 'shared',
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })
  await untilItWaits()
  clock.advance(2_000)
  // The time a Cancel would be given passes as well.
  await untilItWaits()
  clock.advance(2_000)
  const withdrawal = await withdrawing

  // Assert
  assert.equal(withdrawal, 'left')
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.removeAllPendingRequests',
  ])
})

// Value: protects=a request of the learner when the window closes during the withdrawal; fails_when=the abort cuts the settle time short and the withdrawal takes the request for the one in progress, so the Cancel runs although the queue's command may have removed Codebook's request; why_new=Cycle 0046 row 82; seam=the withdrawal's sleep, on a manual clock
test('a window that closes while Codebook waits for the queue’s command to end its request in a shared session runs no Cancel', async () => {
  // Arrange
  const ranCommands: string[] = []
  const { sleep } = manualSleep()
  const closing = new AbortController()

  // Act
  const withdrawing = withdrawWikiChatRequest({
    handOver: new Promise(() => {}),
    runChatCommand: async (command) => {
      ranCommands.push(command)
    },
    session: 'shared',
    signal: closing.signal,
    settleMs: 2_000,
    sleep,
  })
  await untilItWaits()
  closing.abort()
  const withdrawal = await withdrawing

  // Assert
  assert.equal(withdrawal, 'left')
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.removeAllPendingRequests',
  ])
})

// Value: protects=the sentence "the update was not started" for an editor whose chat command throws when its request is stopped; fails_when=only a hand-over command that resolves counts as ended, so a stopped request is reported as possibly still in the chat; why_new=Cycle 0046 row 82; seam=the withdrawal's sleep, on a manual clock
test('a hand-over command that throws once the chat’s Cancel stopped its request counts as a request that ended', async () => {
  // Arrange
  const { clock, sleep } = manualSleep()
  let failHandOver: (error: Error) => void = () => {}
  const handOver = new Promise((_, rejectReply) => {
    failHandOver = rejectReply
  })

  // Act
  const withdrawing = withdrawWikiChatRequest({
    handOver,
    runChatCommand: async (command) => {
      if (command === 'workbench.action.chat.cancel')
        failHandOver(new Error('Canceled'))
    },
    session: 'shared',
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })
  await untilItWaits()
  clock.advance(2_000)
  const withdrawal = await withdrawing

  // Assert
  assert.equal(withdrawal, 'withdrawn')
})

// Value: protects=the truth of "took its request back, so no update is running" when the chat reaches its first approval while Codebook takes the request back (the learner showed another session, so the Cancel acted there); fails_when=any return of the hand-over command counts as the end of the request, also one that says the chat waits for the learner, so a chat that waits for an approval and can publish is reported as withdrawn; why_new=Cycle 0046 row 257; seam=the withdrawal's sleep, on a manual clock that is not moved
test('a hand-over command that returns a reply that waits for a confirmation while the Cancel runs is not the end of the request: the withdrawal ends as left, without waiting out the settle time', async () => {
  // Arrange: the chat's Cancel stops nothing of this request, and the chat asks for its first approval while it runs.
  const { sleep } = manualSleep()
  let answer: (reply: unknown) => void = () => {}
  const handOver = new Promise((resolveReply) => {
    answer = resolveReply
  })

  // Act: the clock stands still.
  const withdrawal = await withdrawWikiChatRequest({
    handOver,
    session: 'own',
    runChatCommand: async (command) => {
      if (command === 'workbench.action.chat.cancel')
        answer({ type: 'confirmation', kind: 'toolInvocation' })
    },
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })

  // Assert
  assert.equal(withdrawal, 'left')
})

// Value: protects=the same truth in a session shared with the learner; fails_when=a reply that waits for a confirmation, returned while the queue's command runs, is taken for a queued request that was removed, so no Cancel runs and the result is withdrawn; why_new=Cycle 0046 row 257; seam=the withdrawal's sleep, on a manual clock that is not moved
test('in a shared session a reply that waits for a confirmation during the queue’s command is no removed request: the Cancel still runs, and the withdrawal ends as left', async () => {
  // Arrange: the chat asks for its first approval while the queue's command runs.
  const ranCommands: string[] = []
  const { sleep } = manualSleep()
  let answer: (reply: unknown) => void = () => {}
  const handOver = new Promise((resolveReply) => {
    answer = resolveReply
  })

  // Act
  const withdrawal = await withdrawWikiChatRequest({
    handOver,
    session: 'shared',
    runChatCommand: async (command) => {
      ranCommands.push(command)
      if (command === 'workbench.action.chat.removeAllPendingRequests')
        answer({ type: 'confirmation', kind: 'toolInvocation' })
    },
    signal: new AbortController().signal,
    settleMs: 2_000,
    sleep,
  })

  // Assert
  assert.deepEqual(ranCommands, [
    'workbench.action.chat.removeAllPendingRequests',
    'workbench.action.chat.cancel',
  ])
  assert.equal(withdrawal, 'left')
})
