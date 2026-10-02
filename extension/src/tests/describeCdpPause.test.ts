import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeCdpPause } from '../utils/describeCdpPause'

// Value: protects=the journal's place of a pause being the generated position a developer can look up; fails_when=the position stays 0-based, the URL is not resolved or the function is dropped; why_new=the utility is new; seam=none
test('a pause is described by its script URL, its 1-based generated position, its function and the breakpoints that were hit', () => {
  // Arrange
  const scriptUrls = new Map([
    ['9', 'webpack-internal:///(action-browser)/./auth.ts'],
  ])
  // Act
  const place = describeCdpPause(
    {
      reason: 'other',
      hitBreakpoints: ['1:22:4:auth.ts'],
      callFrames: [
        {
          callFrameId: 'frame',
          functionName: 'getUser',
          location: { scriptId: '9', lineNumber: 22, columnNumber: 4 },
          url: '',
          scopeChain: [],
          this: { type: 'undefined' },
        },
      ],
    },
    scriptUrls,
  )
  // Assert
  assert.deepEqual(place, {
    url: 'webpack-internal:///(action-browser)/./auth.ts',
    line: 23,
    column: 5,
    functionName: 'getUser',
    hitBreakpoints: ['1:22:4:auth.ts'],
  })
})

// Value: protects=a pause in a script that was never announced, or without a column or a stack, still being journaled instead of throwing inside the event handler; fails_when=an unknown script, a missing column or an empty stack is not answered with the documented fallback; why_new=the utility is new; seam=none
test('a pause in an unannounced script has an empty URL and column 1 without a reported column, and an empty stack has no position', () => {
  // Arrange
  const scriptUrls = new Map<string, string>()
  // Act
  const unannounced = describeCdpPause(
    {
      reason: 'other',
      callFrames: [
        {
          callFrameId: 'frame',
          functionName: '',
          location: { scriptId: '404', lineNumber: 0 },
          url: '',
          scopeChain: [],
          this: { type: 'undefined' },
        },
      ],
    },
    scriptUrls,
  )
  const withoutStack = describeCdpPause(
    { reason: 'other', hitBreakpoints: ['2:0:0:entry'], callFrames: [] },
    scriptUrls,
  )
  // Assert
  assert.deepEqual(unannounced, {
    url: '',
    line: 1,
    column: 1,
    functionName: '',
    hitBreakpoints: [],
  })
  assert.deepEqual(withoutStack, { url: '', hitBreakpoints: ['2:0:0:entry'] })
})

// Value: protects=the journal's size when the debugger reports many breakpoints or ids that embed a long URL pattern; fails_when=more than eight ids or more than 512 characters of one id are kept; why_new=the utility is new; seam=none
test('at most eight hit breakpoint ids are kept, each cut at 512 characters', () => {
  // Arrange
  const hitBreakpoints = [
    'a'.repeat(600),
    'b2',
    'b3',
    'b4',
    'b5',
    'b6',
    'b7',
    'b8',
    'b9',
  ]
  // Act
  const place = describeCdpPause(
    { reason: 'other', hitBreakpoints, callFrames: [] },
    new Map(),
  )
  // Assert
  assert.deepEqual(place.hitBreakpoints, [
    'a'.repeat(512),
    'b2',
    'b3',
    'b4',
    'b5',
    'b6',
    'b7',
    'b8',
  ])
})
