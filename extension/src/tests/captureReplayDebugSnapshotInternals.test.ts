import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'

const SOURCE_TEXT = 'const parsed = signInSchema.safeParse(input)'
const STACK: DebugProtocol.StackTraceResponse['body'] = {
  stackFrames: [{ id: 3, name: 'onSubmit', line: 41, column: 5 }],
  totalFrames: 1,
}

/** One adapter variable as a scripted debugger answers it. */
type ScriptedVariable = {
  name: string
  value: string
  type?: string
  variablesReference: number
}

/** The members js-debug lists under a function: its own properties, then its closure scopes, location and prototype. */
const FUNCTION_MEMBERS: ScriptedVariable[] = [
  { name: 'length', value: '1', type: 'number', variablesReference: 0 },
  {
    name: 'name',
    value: "'mutationFn'",
    type: 'string',
    variablesReference: 0,
  },
  { name: 'arguments', value: 'null', type: 'object', variablesReference: 0 },
  { name: 'caller', value: 'null', type: 'object', variablesReference: 0 },
  {
    name: 'prototype',
    value: '{constructor: ƒ}',
    type: 'Object',
    variablesReference: 90,
  },
  {
    name: '[[FunctionLocation]]',
    value: 'useSignIn.ts:12',
    type: 'internal#location',
    variablesReference: 0,
  },
  {
    name: '[[Scopes]]',
    value: 'Scopes[3]',
    type: 'internal#scopeList',
    variablesReference: 91,
  },
  {
    name: '[[Prototype]]',
    value: 'ƒ ()',
    type: 'function',
    variablesReference: 92,
  },
]

/** The members js-debug lists under a plain object's prototype. */
const OBJECT_PROTOTYPE_MEMBERS: ScriptedVariable[] = [
  {
    name: 'constructor',
    value: 'ƒ Object()',
    type: 'function',
    variablesReference: 93,
  },
  {
    name: 'hasOwnProperty',
    value: 'ƒ hasOwnProperty()',
    type: 'function',
    variablesReference: 94,
  },
  { name: '__proto__', value: 'null', type: 'object', variablesReference: 0 },
]

/**
 * The variables of a sign-in stop shaped like P08's (Cycle 0089 C89-1): a Local scope with the parsed form and the mutation observer `this`, whose members are callbacks and whose objects carry prototype chains.
 * Keys are DAP variables references; a reference without an entry answers no variables.
 */
const SIGN_IN_STOP_VARIABLES: Record<number, ScriptedVariable[]> = {
  1: [
    {
      name: 'parsed',
      value: '{success: true, data: {…}}',
      type: 'Object',
      variablesReference: 10,
    },
    {
      name: 'this',
      value: 'MutationObserver',
      type: 'MutationObserver',
      variablesReference: 20,
    },
  ],
  10: [
    { name: 'success', value: 'true', type: 'boolean', variablesReference: 0 },
    {
      name: 'data',
      value: '{email: …, password: …}',
      type: 'Object',
      variablesReference: 11,
    },
    {
      name: '[[Prototype]]',
      value: 'Object',
      type: 'Object',
      variablesReference: 12,
    },
  ],
  11: [
    {
      name: 'email',
      value: "'learner@example.test'",
      type: 'string',
      variablesReference: 0,
    },
    {
      name: 'password',
      value: "'correct-horse-battery'",
      type: 'string',
      variablesReference: 0,
    },
    {
      name: '[[Prototype]]',
      value: 'Object',
      type: 'Object',
      variablesReference: 13,
    },
  ],
  12: OBJECT_PROTOTYPE_MEMBERS,
  13: OBJECT_PROTOTYPE_MEMBERS,
  20: [
    {
      name: 'mutationFn',
      value: 'ƒ mutationFn(input)',
      type: 'function',
      variablesReference: 21,
    },
    {
      name: 'onError',
      value: 'ƒ onError(error)',
      type: 'function',
      variablesReference: 22,
    },
    {
      name: 'onSuccess',
      value: 'ƒ onSuccess(data)',
      type: 'function',
      variablesReference: 23,
    },
    {
      name: '[[Prototype]]',
      value: 'Subscribable',
      type: 'Object',
      variablesReference: 24,
    },
  ],
  21: FUNCTION_MEMBERS,
  22: FUNCTION_MEMBERS,
  23: FUNCTION_MEMBERS,
  24: [
    {
      name: 'constructor',
      value: 'class MutationObserver',
      type: 'function',
      variablesReference: 25,
    },
    {
      name: 'mutate',
      value: 'ƒ mutate(variables)',
      type: 'function',
      variablesReference: 26,
    },
    {
      name: '[[Prototype]]',
      value: 'Object',
      type: 'Object',
      variablesReference: 12,
    },
  ],
  91: [
    {
      name: '0',
      value: 'Closure (useSignIn)',
      type: 'Object',
      variablesReference: 95,
    },
    { name: '1', value: 'Module', type: 'Object', variablesReference: 96 },
    { name: '2', value: 'Global', type: 'Window', variablesReference: 97 },
  ],
}

/**
 * The variables of a stop whose locals are a Map, a Proxy and a boxed string: values a learner reads through `[[Entries]]`, `[[Target]]`, `[[Handler]]` and `[[PrimitiveValue]]`, beside prototype chains that hold none of the app's data.
 * Keys are DAP variables references; a reference without an entry answers no variables.
 */
const COLLECTION_STOP_VARIABLES: Record<number, ScriptedVariable[]> = {
  1: [
    {
      name: 'cart',
      value: 'Map(1) {sku-1 => 2}',
      type: 'Map',
      variablesReference: 30,
    },
    {
      name: 'guarded',
      value: 'Proxy(Object) {id: 7}',
      type: 'Object',
      variablesReference: 40,
    },
    {
      name: 'label',
      value: "String {'abc'}",
      type: 'String',
      variablesReference: 50,
    },
  ],
  30: [
    { name: 'size', value: '1', type: 'number', variablesReference: 0 },
    {
      name: '[[Entries]]',
      value: 'Array(1)',
      type: 'Array',
      variablesReference: 31,
    },
    {
      name: '[[Prototype]]',
      value: 'Map',
      type: 'Map',
      variablesReference: 32,
    },
  ],
  31: [
    {
      name: '0',
      value: '{"sku-1" => 2}',
      type: 'Object',
      variablesReference: 33,
    },
  ],
  32: [
    {
      name: 'clear',
      value: 'ƒ clear()',
      type: 'function',
      variablesReference: 34,
    },
  ],
  33: [
    { name: 'key', value: "'sku-1'", type: 'string', variablesReference: 0 },
    { name: 'value', value: '2', type: 'number', variablesReference: 0 },
  ],
  40: [
    {
      name: '[[Handler]]',
      value: 'Object',
      type: 'Object',
      variablesReference: 41,
    },
    {
      name: '[[Target]]',
      value: '{id: 7}',
      type: 'Object',
      variablesReference: 42,
    },
    {
      name: '[[IsRevoked]]',
      value: 'false',
      type: 'boolean',
      variablesReference: 0,
    },
  ],
  41: [
    {
      name: 'get',
      value: 'ƒ get(target, key)',
      type: 'function',
      variablesReference: 43,
    },
  ],
  42: [
    { name: 'id', value: '7', type: 'number', variablesReference: 0 },
    {
      name: '[[Prototype]]',
      value: 'Object',
      type: 'Object',
      variablesReference: 44,
    },
  ],
  44: OBJECT_PROTOTYPE_MEMBERS,
  50: [
    { name: 'length', value: '3', type: 'number', variablesReference: 0 },
    {
      name: '[[PrimitiveValue]]',
      value: "'abc'",
      type: 'string',
      variablesReference: 0,
    },
    {
      name: '[[Prototype]]',
      value: 'String',
      type: 'String',
      variablesReference: 51,
    },
  ],
  51: [
    {
      name: 'charAt',
      value: 'ƒ charAt()',
      type: 'function',
      variablesReference: 52,
    },
  ],
}

/**
 * Captures one browser stop with the real capture function over a scripted debugger, recording every `variables` request it sends.
 * @param variablesByReference - The scripted answers of the stop's Local scope (reference 1) and its members.
 * @returns The snapshot, and the references of the `variables` requests in the order they were sent.
 */
async function capturedBrowserStop(
  variablesByReference: Record<number, ScriptedVariable[]>,
): Promise<{ snapshot: ReplayDebugSnapshot; requestedReferences: number[] }> {
  const requestedReferences: number[] = []
  const snapshot = await captureReplayDebugSnapshot({
    stack: STACK,
    verifiedSource: {
      name: 'src/useSignIn.ts',
      text: SOURCE_TEXT,
      hash: sha256(SOURCE_TEXT),
      line: 41,
    },
    assertCurrent() {},
    request(command, arguments_) {
      if (command === 'scopes')
        return Promise.resolve({
          scopes: [
            {
              name: 'Local',
              presentationHint: 'locals',
              variablesReference: 1,
            },
          ],
        })
      const reference = arguments_.variablesReference!
      requestedReferences.push(reference)
      return Promise.resolve({
        variables: variablesByReference[reference] ?? [],
      })
    },
  })
  return { snapshot, requestedReferences }
}

/**
 * Walks a snapshot by variable names from the stopped frame's first scope.
 * @param snapshot - The captured snapshot.
 * @param names - The top-level name, then each child's name.
 * @returns The saved variable at that path; the test fails when a name is missing.
 * @example savedVariableAt(snapshot, ['parsed', 'data', 'email']).value // => "'learner@example.test'"
 */
function savedVariableAt(
  snapshot: ReplayDebugSnapshot,
  names: string[],
): ReplayDebugSnapshot['variables'][number] {
  let indexes = snapshot.frames[0]!.scopes[0]!.variables
  let found: ReplayDebugSnapshot['variables'][number] | undefined
  for (const name of names) {
    found = indexes
      .map((index) => snapshot.variables[index]!)
      .find((variable) => variable.name === name)
    assert.ok(found, `the snapshot holds ${names.join(' › ')}`)
    indexes = found.children
  }
  return found!
}

// protects=a browser pause publishes within its gate because the snapshot sends no request into a function's members or a prototype chain, and labels those entries; fails_when=the capture reads mutationFn's members, [[Scopes]] or any [[Prototype]] (the C89-D1 path that used the whole 5 s deadline), or saves them without the reason; no_claim=the scripted debugger stands in for js-debug: the native time to publish is measured by C90-1 and C90-2
test("a browser stop's snapshot reads no function members or prototype chains, and says they are not recorded", async () => {
  // Arrange / Act
  const { snapshot, requestedReferences } = await capturedBrowserStop(
    SIGN_IN_STOP_VARIABLES,
  )

  // Assert
  assert.deepEqual(requestedReferences, [1, 10, 11, 20])
  for (const callback of ['mutationFn', 'onError', 'onSuccess']) {
    const saved = savedVariableAt(snapshot, ['this', callback])
    assert.equal(saved.type, 'function')
    assert.deepEqual(saved.children, [])
    assert.equal(saved.unavailable, 'Engine internals are not recorded.')
  }
  assert.equal(
    savedVariableAt(snapshot, ['this', 'mutationFn']).value,
    'ƒ mutationFn(input)',
  )
  for (const path of [
    ['this', '[[Prototype]]'],
    ['parsed', '[[Prototype]]'],
    ['parsed', 'data', '[[Prototype]]'],
  ]) {
    const saved = savedVariableAt(snapshot, path)
    assert.deepEqual(saved.children, [])
    assert.equal(saved.unavailable, 'Engine internals are not recorded.')
  }
})

// protects=the learner's own values at the same stop are still recorded to their depth, and a secret among them still reads [masked]; fails_when=the skip rule drops plain object members (parsed.data.email, parsed.success) or lets the password through unmasked; no_claim=the masking rules themselves, which their own tests cover
test("a browser stop's snapshot still records the form's values and masks its password", async () => {
  // Arrange / Act
  const { snapshot } = await capturedBrowserStop(SIGN_IN_STOP_VARIABLES)

  // Assert
  assert.equal(savedVariableAt(snapshot, ['parsed', 'success']).value, 'true')
  assert.equal(
    savedVariableAt(snapshot, ['parsed', 'data', 'email']).value,
    "'learner@example.test'",
  )
  assert.equal(
    savedVariableAt(snapshot, ['parsed', 'data', 'password']).value,
    '[masked]',
  )
  assert.equal(
    savedVariableAt(snapshot, ['parsed', 'data', 'email']).unavailable,
    undefined,
  )
})

// protects=a Map's entries, a Proxy's handler and target and a boxed string's value stay recorded while their prototype chains are skipped; fails_when=the skip rule is widened to every [[…]] member (losing the learner's Map entries or Proxy target) or still reads the Map, target or String prototypes; no_claim=the exact names js-debug gives these members in every version
test("a browser stop's snapshot still records a Map's entries, a Proxy's target and a boxed string's value", async () => {
  // Arrange / Act
  const { snapshot, requestedReferences } = await capturedBrowserStop(
    COLLECTION_STOP_VARIABLES,
  )

  // Assert
  assert.deepEqual(requestedReferences, [1, 30, 31, 33, 40, 41, 42, 50])
  assert.equal(
    savedVariableAt(snapshot, ['cart', '[[Entries]]', '0', 'key']).value,
    "'sku-1'",
  )
  assert.equal(
    savedVariableAt(snapshot, ['cart', '[[Entries]]', '0', 'value']).value,
    '2',
  )
  assert.equal(
    savedVariableAt(snapshot, ['guarded', '[[Target]]', 'id']).value,
    '7',
  )
  assert.equal(
    savedVariableAt(snapshot, ['label', '[[PrimitiveValue]]']).value,
    "'abc'",
  )
  assert.equal(
    savedVariableAt(snapshot, ['cart', '[[Prototype]]']).unavailable,
    'Engine internals are not recorded.',
  )
})
