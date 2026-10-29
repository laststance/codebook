import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PendingResumeRequests } from '../utils/pendingResumeRequests'

// protects=a continue the adapter accepted lets only the threads it names run on; fails_when=a continue answered with allThreadsContinued false still ends every pause of the session; no_claim=how a debugger closes its pauses
test('a continue answered with allThreadsContinued false runs on its own thread only', () => {
  // Arrange
  const resumes = new PendingResumeRequests()
  resumes.noteRequest('session-1', {
    type: 'request',
    seq: 7,
    command: 'continue',
    arguments: { threadId: 2 },
  })

  // Act
  const ranOn = resumes.takeAnswered('session-1', {
    type: 'response',
    seq: 9,
    request_seq: 7,
    command: 'continue',
    success: true,
    body: { allThreadsContinued: false },
  })

  // Assert
  assert.deepEqual(ranOn, { threadId: 2 })
})

// protects=a continue without allThreadsContinued false resumes every thread of the session; fails_when=other paused threads of the session stay listed after the continue; no_claim=the adapter's own continued events
test('a continue the adapter accepted without allThreadsContinued runs on every thread', () => {
  // Arrange
  const resumes = new PendingResumeRequests()
  resumes.noteRequest('session-1', {
    type: 'request',
    seq: 3,
    command: 'continue',
    arguments: { threadId: 4 },
  })

  // Act
  const ranOn = resumes.takeAnswered('session-1', {
    type: 'response',
    seq: 5,
    request_seq: 3,
    command: 'continue',
    success: true,
  })

  // Assert
  assert.deepEqual(ranOn, { threadId: undefined })
})

// protects=a resume the adapter refused leaves the thread paused; fails_when=a refused continue ends the pause and stales its continue arguments; no_claim=why the adapter refused
test('a refused continue leaves its thread paused', () => {
  // Arrange
  const resumes = new PendingResumeRequests()
  resumes.noteRequest('session-1', {
    type: 'request',
    seq: 11,
    command: 'continue',
    arguments: { threadId: 1 },
  })

  // Act
  const ranOn = resumes.takeAnswered('session-1', {
    type: 'response',
    seq: 12,
    request_seq: 11,
    command: 'continue',
    success: false,
    message: 'not paused',
  })

  // Assert
  assert.equal(ranOn, undefined)
})

// protects=a single-thread step runs on its own thread, and a request that is no resume is never remembered; fails_when=a singleThread step ends every pause, or an evaluate answer ends a pause; no_claim=stepping behaviour of any adapter
test('a single-thread step runs on its own thread and an evaluate answer resumes nothing', () => {
  // Arrange
  const resumes = new PendingResumeRequests()
  resumes.noteRequest('session-1', {
    type: 'request',
    seq: 20,
    command: 'next',
    arguments: { threadId: 3, singleThread: true },
  })
  resumes.noteRequest('session-1', {
    type: 'request',
    seq: 21,
    command: 'evaluate',
    arguments: { expression: 'value' },
  })

  // Act
  const stepRanOn = resumes.takeAnswered('session-1', {
    type: 'response',
    seq: 22,
    request_seq: 20,
    command: 'next',
    success: true,
  })
  const evaluateRanOn = resumes.takeAnswered('session-1', {
    type: 'response',
    seq: 23,
    request_seq: 21,
    command: 'evaluate',
    success: true,
  })

  // Assert
  assert.deepEqual(stepRanOn, { threadId: 3 })
  assert.equal(evaluateRanOn, undefined)
})
