import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DebugProtocol } from '@vscode/debugprotocol'
import { selectCheckedNodeFrame } from '../utils/selectCheckedNodeFrame'

test('a breakpoint at the declared source position remains eligible for Node history capture', () => {
  // Arrange
  const frame: DebugProtocol.StackFrame = {
    id: 1,
    name: 'fetchInvoiceById',
    source: { path: '/project/data.ts' },
    line: 224,
    column: 17,
  }

  // Act
  const result = selectCheckedNodeFrame(
    [frame],
    '/project/data.ts',
    224,
    17,
    'breakpoint',
  )

  // Assert
  assert.equal(result.status, 'matched')
  if (result.status === 'matched') assert.equal(result.frame, frame)
})

test('a moved Node breakpoint reports its real source position before the global deadline', () => {
  // Arrange
  const frame: DebugProtocol.StackFrame = {
    id: 1,
    name: 'fetchInvoiceById',
    source: { path: '/project/data.ts' },
    line: 225,
    column: 5,
  }

  // Act
  const result = selectCheckedNodeFrame(
    [frame],
    '/project/data.ts',
    224,
    17,
    'breakpoint',
  )

  // Assert
  assert.deepEqual(result, { status: 'wrong-position', observedFrame: frame })
})

test('an unrelated debugger pause does not claim the declared Node source stop', () => {
  // Arrange
  const frame: DebugProtocol.StackFrame = {
    id: 1,
    name: 'internal',
    source: { path: '/project/other.ts' },
    line: 225,
    column: 5,
  }

  // Act
  const result = selectCheckedNodeFrame(
    [frame],
    '/project/data.ts',
    224,
    17,
    'pause',
  )

  // Assert
  assert.deepEqual(result, { status: 'unrelated', observedFrame: undefined })
})

test('a pause inside a callee is not saved as the declared stop even when the declared call site is on the stack', () => {
  // Arrange: a learner breakpoint paused the callee while the declared line is only its caller.
  const callee: DebugProtocol.StackFrame = {
    id: 1,
    name: 'formatCurrency',
    source: { path: '/project/utils.ts' },
    line: 3,
    column: 9,
  }
  const declaredCaller: DebugProtocol.StackFrame = {
    id: 2,
    name: 'fetchInvoiceById',
    source: { path: '/project/data.ts' },
    line: 224,
    column: 17,
  }

  // Act
  const result = selectCheckedNodeFrame(
    [callee, declaredCaller],
    '/project/data.ts',
    224,
    17,
    'breakpoint',
  )

  // Assert
  assert.deepEqual(result, {
    status: 'unrelated',
    observedFrame: declaredCaller,
  })
})
