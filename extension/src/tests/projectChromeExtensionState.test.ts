import assert from 'node:assert/strict'
import { test } from 'node:test'

import { StudyError } from '../errors'
import type { ChromeExtensionView } from '../runtime'
import {
  type ChromeExtensionProjectionInput,
  projectChromeExtensionState,
} from '../utils/projectChromeExtensionState'

/**
 * Builds a minimal run view in the given phase for the projection tests.
 * @param overrides - Fields of the view to replace.
 * @returns A view with one declared click, none performed, no pause.
 */
function viewOf(overrides: Partial<ChromeExtensionView>): ChromeExtensionView {
  return {
    phase: 'ready',
    procedure: { clicksDeclared: 1, clicksPerformed: 0 },
    pauses: [],
    captures: [],
    stopsDeclared: 0,
    stopsNotReached: [],
    claimable: false,
    interventions: [],
    outputs: [],
    outputsDropped: 0,
    ...overrides,
  }
}

/**
 * Builds the service's record of a controllable run around a view.
 * @param view - The run's view.
 * @param overrides - Fields of the record to replace.
 * @returns The projection input.
 */
function inputOf(
  view: ChromeExtensionView | undefined,
  overrides: Partial<ChromeExtensionProjectionInput> = {},
): ChromeExtensionProjectionInput {
  return {
    instanceId: 'instance-1',
    runId: 'run-1',
    view,
    controllable: true,
    stopped: false,
    ending: false,
    sanitize: (text) => text,
    ...overrides,
  }
}

// protects=DR9, ER16: the run resource's state word and next actions follow the run's phase and release, and never offer a save action; fails_when=a stopped run still offers stop, a release in flight reads ready, or a finished click plan offers extension-click; why_new=the service tests reach only the ready and paused cases; seam=none; no_claim=the service wiring (the projection alone, no service)
test('the run resource names stopped, stopping, failed, preparing and waiting states with their next actions', () => {
  // Arrange
  const cases: [string, ChromeExtensionProjectionInput, string, string[]][] = [
    [
      'ready with a click left',
      inputOf(viewOf({})),
      'ready',
      ['extension-click', 'stop'],
    ],
    [
      'ready with every click performed',
      inputOf(viewOf({ procedure: { clicksDeclared: 1, clicksPerformed: 1 } })),
      'ready',
      ['read-run', 'stop'],
    ],
    [
      'ready with a click in flight',
      inputOf(
        viewOf({
          procedure: {
            clicksDeclared: 2,
            clicksPerformed: 0,
            clickInFlight: 1,
          },
        }),
      ),
      'ready',
      ['read-run', 'stop'],
    ],
    [
      'observing',
      inputOf(viewOf({ phase: 'observing' })),
      'observing',
      ['read-run', 'stop'],
    ],
    [
      'an arming phase',
      inputOf(viewOf({ phase: 'arming' })),
      'preparing',
      ['stop'],
    ],
    ['no view yet', inputOf(undefined), 'preparing', ['stop']],
    [
      'a release in flight',
      inputOf(viewOf({}), { ending: true }),
      'stopping',
      ['stop'],
    ],
    [
      'a failed run being released',
      inputOf(viewOf({ phase: 'failed' }), { ending: true }),
      'failed',
      ['stop'],
    ],
    [
      'a released run',
      inputOf(viewOf({}), { stopped: true, ending: true }),
      'stopped',
      [],
    ],
    [
      'a run past its deadline',
      inputOf(viewOf({}), { controllable: false }),
      'ready',
      ['stop'],
    ],
  ]

  // Act
  const projected = cases.map(([name, input]) => {
    const { state, nextActions } = projectChromeExtensionState(input)
    return [name, state, nextActions]
  })

  // Assert
  assert.deepEqual(
    projected,
    cases.map(([name, , state, actions]) => [name, state, actions]),
  )
})

// protects=ER16: a declared pause carries its own complete continue arguments with answer next while the run is controllable, and none once it is not; a learner pause never has any; fails_when=a dead run still offers continue arguments or the answer is missing; why_new=the service tests read a single live pause; seam=none; no_claim=the debugger's pause bookkeeping
test('a declared pause lists its continue arguments only while the run is controllable', () => {
  // Arrange
  const declared = {
    generation: 3,
    sessionId: 's1',
    threadId: 7,
    context: 'page' as const,
    reason: 'breakpoint',
    kind: 'declared' as const,
    stopIndex: 1,
    status: 'captured' as const,
    pausedAtMs: 10,
    continueArguments: {
      participant: 'extension' as const,
      sessionId: 's1',
      threadId: 7,
      generation: 3,
    },
  }
  const learner = {
    ...declared,
    generation: 4,
    kind: 'learner' as const,
    stopIndex: undefined,
    continueArguments: undefined,
  }
  const view = viewOf({ phase: 'paused', pauses: [declared, learner] })

  // Act
  const live = projectChromeExtensionState(inputOf(view))
  const dead = projectChromeExtensionState(
    inputOf(view, { controllable: false }),
  )

  // Assert
  assert.deepEqual(
    live.chromeExtension?.pauses.map((p) => p.continueArguments),
    [
      {
        instanceId: 'instance-1',
        runId: 'run-1',
        participant: 'extension',
        sessionId: 's1',
        threadId: 7,
        generation: 3,
        answer: 'next',
      },
      undefined,
    ],
  )
  assert.deepEqual(live.nextActions, ['continue-extension', 'stop'])
  assert.equal(live.participant.resumable, true)
  assert.deepEqual(
    dead.chromeExtension?.pauses.map((p) => p.continueArguments),
    [undefined, undefined],
  )
  assert.equal(dead.participant.resumable, false)
  assert.deepEqual(dead.nextActions, ['stop'])
})

// protects=SR32: output lines and the failure message and cause pass through the sanitizer before the resource shows them; fails_when=a private path in a Chrome output line or a failure cause reaches the chat; why_new=the sanitizer is injected here and no other test passes a hiding one; seam=none; no_claim=the real root list of the sanitizer
test('the run resource hides private roots in output lines and in the failure message and cause', () => {
  // Arrange
  const sanitize = (text: string): string =>
    text.replaceAll('/Users/ada', '<home>')
  const view = viewOf({
    phase: 'failed',
    outputs: [{ context: 'page', text: 'at /Users/ada/popup.js:3', atMs: 5 }],
    runFailure: new StudyError(
      'CLICK_OUTCOME_UNKNOWN',
      'failed in /Users/ada/ext',
      'cause /Users/ada/ext/sw.js',
    ),
  })

  // Act
  const { chromeExtension } = projectChromeExtensionState(
    inputOf(view, { sanitize }),
  )

  // Assert
  assert.deepEqual(chromeExtension?.outputs, [
    { context: 'page', text: 'at <home>/popup.js:3', atMs: 5 },
  ])
  assert.deepEqual(chromeExtension?.failure, {
    code: 'CLICK_OUTCOME_UNKNOWN',
    message: 'failed in <home>/ext',
    cause: 'cause <home>/ext/sw.js',
  })
})
