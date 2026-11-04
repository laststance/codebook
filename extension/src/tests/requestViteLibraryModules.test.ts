import assert from 'node:assert/strict'
import { test } from 'node:test'

import { awaitViteOptimizerIdle } from '../utils/awaitViteOptimizerIdle'
import { requestViteLibraryModules } from '../utils/viteLibraryModules'

/**
 * A scripted launcher on one shared queue: the first command of a kind is answered after its delay, `nextMessage` shifts the oldest report off for good.
 */
function createSharedQueueApp(delaysMs: { walk: number; optimizer: number }) {
  const queue: unknown[] = []
  let walkDelayMs = delaysMs.walk
  return {
    send(message: unknown): void {
      if (typeof message !== 'object' || message === null) return
      if ('requestId' in message) {
        const answer = {
          type: 'vite-library-modules-result',
          requestId: message.requestId,
          modules: [`/@fs/lib/${String(message.requestId)}.js`],
          optimizedLibrary: false,
        }
        const delayMs = walkDelayMs
        walkDelayMs = 0
        setTimeout(() => queue.push(answer), delayMs)
        return
      }
      setTimeout(
        () => queue.push({ type: 'vite-optimizer-idle' }),
        delaysMs.optimizer,
      )
    },
    async nextMessage(timeoutMs: number): Promise<unknown> {
      const deadline = Date.now() + timeoutMs
      while (queue.length === 0) {
        if (Date.now() > deadline) throw new Error('timed out')
        await new Promise((resolve) => setTimeout(resolve, 2))
      }
      return queue.shift()
    },
  }
}

const walkRequest = { entries: ['/src/main.tsx'], libraryFolder: '/repo/lib' }

// protects=a walk and an optimizer wait started together on one launcher each get their own answer; fails_when=the optimizer wait shifts the walk's answer off the shared queue and the other waiter times out; no_claim=the real launcher (a scripted shared queue with delayed answers stands in)
test('a walk and an optimizer wait started together on one launcher both finish with their own answers', async () => {
  // Arrange
  const app = createSharedQueueApp({ walk: 40, optimizer: 0 })
  const signal = new AbortController().signal
  // Act
  const [walk, optimizer] = await Promise.all([
    requestViteLibraryModules(app, walkRequest, 300, signal),
    awaitViteOptimizerIdle(app, 300, signal),
  ])
  // Assert
  assert.equal(walk.modules.length, 1)
  assert.equal(optimizer, undefined)
})

// protects=two walks started together on one launcher each get the answer of their own request; fails_when=the second walk's early answer is consumed and dropped by the first walk, so the second times out; no_claim=the real launcher (a scripted shared queue with delayed answers stands in)
test('two walks started together on one launcher each return their own request answer', async () => {
  // Arrange
  const app = createSharedQueueApp({ walk: 40, optimizer: 0 })
  const signal = new AbortController().signal
  // Act
  const [first, second] = await Promise.all([
    requestViteLibraryModules(app, walkRequest, 300, signal),
    requestViteLibraryModules(app, walkRequest, 300, signal),
  ])
  // Assert
  assert.equal(first.modules.length, 1)
  assert.equal(second.modules.length, 1)
  assert.notDeepEqual(first.modules, second.modules)
})

// protects=the extension-side request skips reports that are not its own answer (a late optimizer report, another request's answer) and returns its own; fails_when=the first report is taken as the answer or the requestId is not compared; no_claim=the real launcher (a scripted app stands in; viteLauncher.test.ts covers the real process)
test('requestViteLibraryModules skips a late optimizer report and another request answer and returns its own answer', async () => {
  // Arrange
  let sentRequestId = -1
  let nextIndex = 0
  const app = {
    send(message: unknown): void {
      if (
        typeof message === 'object' &&
        message !== null &&
        'requestId' in message &&
        typeof message.requestId === 'number'
      )
        sentRequestId = message.requestId
    },
    async nextMessage(): Promise<unknown> {
      const queue = [
        { type: 'vite-optimizer-idle' },
        {
          type: 'vite-library-modules-result',
          requestId: sentRequestId + 100,
          modules: ['/@fs/other.js'],
          optimizedLibrary: true,
        },
        {
          type: 'vite-library-modules-result',
          requestId: sentRequestId,
          modules: ['/@fs/lib/a.js'],
          optimizedLibrary: false,
          bound: 'deadline',
        },
      ]
      return queue[nextIndex++]
    },
  }
  // Act
  const answer = await requestViteLibraryModules(
    app,
    { entries: ['/src/main.tsx'], libraryFolder: '/repo/lib' },
    1_000,
    new AbortController().signal,
  )
  // Assert
  assert.deepEqual(answer, {
    modules: ['/@fs/lib/a.js'],
    optimizedLibrary: false,
    bound: 'deadline',
  })
})
