import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeTestResult } from '../utils/describeNodeTestResult'
import { nodeTestResultKind } from '../utils/nodeTestResultKind'

// Value: protects=the learner's verdict of a test run on the status item, the partial-save notice and Saved studies; fails_when=a passing, failing or signalled run is worded otherwise than the String catalog, or a run without a result claims one; why_new=a test run had no learner-facing verdict (DS2); seam=none; no_claim=where each surface shows the verdict
test('a test run’s result reads as passed, failed with its exit code, ended by its signal, or not recorded', () => {
  // Arrange / Act / Assert
  assert.equal(
    describeNodeTestResult({ exitCode: 0, signal: null }),
    'Test passed · exit code 0',
  )
  assert.equal(
    describeNodeTestResult({ exitCode: 1, signal: null }),
    'Test failed · exit code 1',
  )
  assert.equal(
    describeNodeTestResult({ exitCode: null, signal: 'SIGKILL' }),
    'Ended by signal SIGKILL',
  )
  assert.equal(describeNodeTestResult(undefined), 'No result recorded')
})

// Value: protects=nodeTest.testResult, the one word the agent reads for a test run's result; fails_when=a signal reads as failed, a pass as anything but passed, or a missing result as failed; why_new=the run resource reported only exit facts (AC1); seam=none; no_claim=the history resource's projection (store tests)
test('the agent reads a test run’s result as passed, failed, signal or none', () => {
  // Arrange / Act / Assert
  assert.equal(nodeTestResultKind({ exitCode: 0, signal: null }), 'passed')
  assert.equal(nodeTestResultKind({ exitCode: 2, signal: null }), 'failed')
  assert.equal(
    nodeTestResultKind({ exitCode: null, signal: 'SIGTERM' }),
    'signal',
  )
  assert.equal(nodeTestResultKind(undefined), 'none')
})

// Value: protects=that an exit naming neither a code nor a signal claims no result; fails_when=such an exit reads as a failed test with exit code null; why_new=the verdict and the agent's word must agree on the one unusual exit; seam=none; no_claim=how often Node reports such an exit
test('an exit that names neither a code nor a signal reads as no result', () => {
  // Arrange
  const result = { exitCode: null, signal: null }

  // Act / Assert
  assert.equal(nodeTestResultKind(result), 'none')
  assert.equal(describeNodeTestResult(result), 'No result recorded')
})
