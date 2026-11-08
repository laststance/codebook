import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { apiServerRunHarness } from './utils/apiServerRunHarness'
import { sendOperation } from './utils/routeHandlerRunHarness'

// Value: protects=AC 5 not-reached wording: an API stop that no request reached after its operation fails SERVER_STOP_NOT_REACHED as an "API server handler" with the API's own possibilities (never the Next route-handler ones); fails_when=the failure is a generic timeout, names a route handler or Next's apiResolver, or states a cause as established; why_new=no test reached the API branch of the not-reached wording (handlerKindWords, notReachedPossibilities); seam=none; no_claim=a real API's timing (the stand-in never pauses and the manual clock moves the 20 s bound)
test('an API stop no request reaches fails SERVER_STOP_NOT_REACHED in the API handler words', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  // Assert
  const failure = harness.run.view().failures[0]!
  assert.match(
    failure,
    /^SERVER_STOP_NOT_REACHED: Declared stop apps\/api\/src\/rpc\/switches\.ts:\d+ \(API server handler [^)]*\) was not reached within 20 s after operation 1\. For a stop in the app's own API these are possibilities, never the established cause: /,
  )
  assert.equal(failure.includes('apiResolver'), false)
})

// Value: protects=the API not-reached wording names the cause the native checks met most: the app's own request deadline ran out while an earlier stop held the request; fails_when=the possibilities leave that cause out, so the chat guesses a client-side or branch cause; no_claim=that the deadline was the cause of this harness run (the stand-in has no deadline; the sentence is a possibility)
test('an API stop no request reaches names the app deadline that ran out during an earlier stop as a possibility', async (context) => {
  // Arrange
  const harness = await apiServerRunHarness(context)
  await harness.run.prepare()
  await sendOperation(harness, 1)
  // Act
  harness.advance(ACTIVE_TIMEOUT_MS)
  await waitUntil(
    () => harness.run.view().failures.length > 0,
    'the not-reached failure',
  )
  // Assert
  assert.equal(
    harness.run
      .view()
      .failures[0]!.includes(
        "the app's own request deadline ran out while an earlier stop held the request (the API's output after the continue may say so)",
      ),
    true,
  )
})
