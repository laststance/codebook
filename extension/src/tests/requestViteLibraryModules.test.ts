import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requestViteLibraryModules } from '../utils/viteLibraryModules'

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
