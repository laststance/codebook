import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeApiRequestSentence } from '../utils/describeApiRequestSentence'
import { isRepositoryPathInFolder } from '../utils/isRepositoryPathInFolder'

// Value: protects=apiServer folder containment by path segments: the repository root contains everything and a trailing slash or a shared name prefix changes nothing; fails_when=apps/api2 is read as inside apps/api, or "." contains nothing; why_new=apiServerConfig covers apps/api2 only through the whole schema, not the root and slash forms; seam=none; no_claim=the schema's refusal wording
test('a folder contains its own paths by segment, the root contains all and a name prefix is no containment', () => {
  // Arrange
  const cases: [string, string][] = [
    ['apps/api', 'apps/api/src/server.ts'],
    ['apps/api/', 'apps/api'],
    ['.', 'apps/app/App.tsx'],
    ['apps/api', 'apps/api2/src/server.ts'],
    ['apps/api', 'apps'],
  ]
  // Act
  const results = cases.map(([folder, path]) =>
    isRepositoryPathInFolder(folder, path),
  )
  // Assert
  assert.deepEqual(results, [true, true, true, false, false])
})

// Value: protects=the three sentences the chat relays for an API pause: attributed claims only a time match, none claims no cause, several claims no request; fails_when=the attributed sentence says the API read the request or the none sentence names a cause; why_new=run tests assert the fact fields, not the wording of the none and several rows; seam=none; no_claim=how the chat words it to the learner
test('the API pause sentence never claims a cause for none or several and only a time match for one', () => {
  // Arrange
  const input = {
    state: 'attributed',
    method: 'POST',
    path: '/api/rpc/x',
    operation: 2,
    title: 'Switch',
  } as const
  // Act
  const sentences = [
    describeApiRequestSentence(input),
    describeApiRequestSentence({
      state: 'unattributed',
      reason: 'none',
      count: 0,
    }),
    describeApiRequestSentence({
      state: 'unattributed',
      reason: 'several',
      count: 3,
    }),
  ]
  // Assert
  assert.deepEqual(sentences, [
    `While the API paused here, the page's POST /api/rpc/x, sent after operation 2 "Switch", was the only request waiting for it; Codebook matched it by time and did not read it inside the API.`,
    "Codebook observed no request from the page that started in this operation's window and was still open when the API paused, so it cannot say what made the API reach this line.",
    '3 requests from the page were waiting when the API paused here, so Codebook does not say which one reached this line.',
  ])
})
