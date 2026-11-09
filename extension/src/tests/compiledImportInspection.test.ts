import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { Protocol } from 'devtools-protocol'

import { inspectConfiguredValues } from '../utils/inspectConfiguredValues'

/** The rewrite {@link webpackImportPathOf} gives `useSelector…` in P04's compiled page. */
const useSelectorRewrite = (path: string) =>
  path.startsWith('useSelector')
    ? {
        name: 'useSelector',
        compiledPath: `react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector${path.slice('useSelector'.length)}`,
      }
    : undefined

/**
 * Evaluates on a scripted paused frame as V8 answers `Debugger.evaluateOnCallFrame`: a name the frame does not hold throws V8's ReferenceError with its own description.
 * @param frame - The bindings the paused frame holds.
 * @param requests - Collects every evaluated expression.
 * @returns The evaluator the inspection calls.
 */
function pausedFrame(
  frame: Record<string, unknown>,
  requests: string[],
): (
  parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
) => Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> {
  return async (parameters) => {
    requests.push(parameters.expression)
    try {
      const value: unknown = runInNewContext(parameters.expression, {
        ...frame,
      })
      return { result: { type: 'string', value } }
    } catch (error) {
      // The error comes from another context, so its shape is read, not its class.
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String(error.message)
          : ''
      return {
        result: { type: 'undefined' },
        exceptionDetails: {
          exceptionId: 1,
          text: 'Uncaught',
          lineNumber: 0,
          columnNumber: 0,
          exception: {
            type: 'object',
            subtype: 'error',
            className: 'ReferenceError',
            description: `ReferenceError: ${message}`,
          },
        },
      }
    }
  }
}

// Value: protects=C86-2 (AC 7): at the module evaluation of P04's page, a required `useSelector.name` the chat declares by its source name is read from the module object webpack bound the import to, and the fact keeps the declared path; fails_when=the source name is evaluated as written, throws ReferenceError and the required inspection fails the run (native C86-2 run 9006e94a); no_claim=V8's side-effect check of webpack's export getter
test('a required import declared by its source name is read from the compiled module object when the pause lacks that name', async () => {
  // Arrange
  const requests: string[] = []
  const frame = {
    react_redux__WEBPACK_IMPORTED_MODULE_4__: {
      useSelector: function throwNotSupportedError(): void {},
    },
  }

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame(frame, requests),
    'module-frame',
    [{ path: 'useSelector.name', mode: 'value', required: true }],
    () => {},
    (text) => text,
    useSelectorRewrite,
  )

  // Assert
  assert.deepEqual(facts, {
    values: { 'value:useSelector.name': 'throwNotSupportedError' },
    unavailableValues: [],
  })
})

// Value: protects=a `type:` inspection of an import declared by its source name answers the import's type, never `undefined`: `typeof` of a name not in scope does not throw, so the rewrite must be chosen before the inspection runs; fails_when=`type:useSelector` is saved as "undefined" for a function the page imports; no_claim=types other than the captured ones
test('a type inspection of an import declared by its source name answers the type of the compiled binding', async () => {
  // Arrange
  const requests: string[] = []
  const frame = {
    react_redux__WEBPACK_IMPORTED_MODULE_4__: {
      useSelector: function throwNotSupportedError(): void {},
    },
  }

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame(frame, requests),
    'module-frame',
    [{ path: 'useSelector', mode: 'type', required: true }],
    () => {},
    (text) => text,
    useSelectorRewrite,
  )

  // Assert
  assert.deepEqual(facts, {
    values: { 'type:useSelector': 'function' },
    unavailableValues: [],
  })
})

// Value: protects=a binding the pause holds under the declared name always wins over an import of that name (a parameter or local that shadows it in a function body); fails_when=the import's module member is read in place of the local the learner's code reads there; no_claim=a binding before its initialization, whose different ReferenceError keeps the declared path
test('a name the paused frame holds is read as declared even when the module imports the same name', async () => {
  // Arrange
  const requests: string[] = []
  const frame = {
    useSelector: function localSelector(): void {},
    react_redux__WEBPACK_IMPORTED_MODULE_4__: {
      useSelector: function throwNotSupportedError(): void {},
    },
  }

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame(frame, requests),
    'function-frame',
    [{ path: 'useSelector.name', mode: 'value', required: true }],
    () => {},
    (text) => text,
    useSelectorRewrite,
  )

  // Assert
  assert.deepEqual(facts, {
    values: { 'value:useSelector.name': 'localSelector' },
    unavailableValues: [],
  })
})

// Value: protects=a declared name that is no import keeps today's behavior: one evaluation, unavailable when the frame lacks it, with no probe; fails_when=every inspection pays a probe or an unrelated name is rewritten; no_claim=the wording of the required-inspection failure
test('a missing name that is no import stays unavailable without a probe', async () => {
  // Arrange
  const requests: string[] = []

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame({}, requests),
    'module-frame',
    [{ path: 'client', mode: 'value', required: false }],
    () => {},
    (text) => text,
    useSelectorRewrite,
  )

  // Assert
  assert.deepEqual(facts, {
    values: {},
    unavailableValues: [
      {
        path: 'value:client',
        reason: 'Evaluation unavailable or rejected for possible side effects.',
      },
    ],
  })
  assert.equal(requests.length, 1)
})

// Value: protects=a `type:` inspection of a name the paused frame does not define is unavailable like the `value:` one; fails_when=`typeof missingName` answers "undefined" and the run saves it as an observed type; why_new=Cycle 0105 hosted review (typeof of an undeclared name); seam=inspectConfiguredValues with no compiled rewrite; no_claim=a declared binding that holds undefined, which is still the type "undefined"
test('a type inspection of a name the paused frame lacks is unavailable, not the type undefined', async () => {
  // Arrange
  const requests: string[] = []
  const frame = { other: 1 }

  // Act
  const facts = await inspectConfiguredValues(
    pausedFrame(frame, requests),
    'module-frame',
    [{ path: 'missingName', mode: 'type', required: false }],
    () => {},
  )

  // Assert
  assert.deepEqual(facts, {
    values: {},
    unavailableValues: [
      {
        path: 'type:missingName',
        reason: 'Evaluation unavailable or rejected for possible side effects.',
      },
    ],
  })
})
