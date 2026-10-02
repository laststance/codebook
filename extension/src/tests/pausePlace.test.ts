import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Protocol } from 'devtools-protocol'

import { pausePlace, type PausePlaceStop } from '../utils/pausePlace'

/** Builds a pause whose top frame is at a generated place. @example pauseAt('9', 27, 23) */
const pauseAt = (
  scriptId: string,
  lineNumber: number,
  columnNumber?: number,
): Protocol.Debugger.PausedEvent => ({
  reason: 'other',
  callFrames: [
    {
      callFrameId: 'frame',
      functionName: 'getUser',
      location: { scriptId, lineNumber, columnNumber },
      url: '',
      scopeChain: [],
      this: { type: 'undefined' },
    },
  ],
})

/** A stop declared in `auth.ts`, module `9`, whose sealed map puts generated line 27 on line 18 and reaches nothing before generated line 20. */
const authStop: PausePlaceStop = {
  script: { scriptId: '9' },
  source: { path: 'auth.ts', line: 23 },
  verifier: {
    originalLine: (location) => (location.lineNumber === 27 ? 18 : undefined),
  },
}
const scriptUrls = new Map([
  ['9', 'webpack-internal:///(action-browser)/./auth.ts'],
  ['70', 'eval-ca9ab6a4.cdp'],
  ['71', ''],
])

// Value: protects=the place an agent reads for a pause nobody announced being a repository line it can act on, or the generated position the journal also holds; fails_when=a pause in a declared stop's module is named by its generated position, another script loses its URL or its position stays 0-based; why_new=the utility is new (Cycle 0042 ER6); seam=none
test('a pause is named by repository path and line inside a declared stop’s module, and by script URL and 1-based generated position elsewhere', () => {
  // Arrange
  const inTheStopsModule = pauseAt('9', 27, 23),
    inTheAdaptersHook = pauseAt('70', 0, 219)
  // Act
  const places = [
    pausePlace(inTheStopsModule, [authStop], scriptUrls),
    pausePlace(inTheAdaptersHook, [authStop], scriptUrls),
  ]
  // Assert
  assert.deepEqual(places, ['auth.ts:18', 'eval-ca9ab6a4.cdp 1:220'])
})

// Value: protects=a pause the run cannot place still being named instead of throwing inside a deadline or the resume handler; fails_when=an unmapped place in the stop's module, a script with no known or an empty URL, a missing column or an empty stack is not answered with the documented fallback; why_new=the utility is new (Cycle 0042 ER6); seam=none
test('a pause the sealed map does not reach is named by its generated position, a script with no known URL is called unknown, and an empty stack has an unknown place', () => {
  // Arrange
  const beforeTheFirstMapping = pauseAt('9', 3, 0),
    inAScriptNeverAnnounced = pauseAt('404', 14, 2),
    inAScriptWithAnEmptyUrl = pauseAt('71', 0),
    withoutStack: Protocol.Debugger.PausedEvent = {
      reason: 'other',
      callFrames: [],
    }
  // Act
  const places = [
    pausePlace(beforeTheFirstMapping, [authStop], scriptUrls),
    pausePlace(inAScriptNeverAnnounced, [authStop], scriptUrls),
    pausePlace(inAScriptWithAnEmptyUrl, [authStop], scriptUrls),
    pausePlace(withoutStack, [authStop], scriptUrls),
  ]
  // Assert
  assert.deepEqual(places, [
    'webpack-internal:///(action-browser)/./auth.ts 4:1',
    'an unknown script 15:3',
    'an unknown script 1:1',
    'an unknown place',
  ])
})
