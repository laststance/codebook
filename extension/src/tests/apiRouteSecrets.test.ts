import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  REPLAY_DEBUG_MAX_DEPTH,
  REPLAY_DEBUG_MAX_VARIABLES,
} from '../constants'
import type { ReplayDebugSnapshot } from '../replayDebugSchemas'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { maskSavedDebugSnapshot } from '../utils/maskSavedDebugSnapshot'

// The values are made-up opaque strings assembled at run time so the repository's secret scanner does not read them as credentials.
const COOKIE_VALUE = ['SESSION', 'COOKIE', 'VALUE', 'api', '5d21b7'].join('-')
const BEARER_VALUE = ['api', 'bearer', 'token', '90ac'].join('-')

type DapVariable = {
  name: string
  value: string
  type?: string
  variablesReference: number
}

/** A string member as the adapter lists it. */
function stringVariable(name: string, text: string): DapVariable {
  return { name, value: `'${text}'`, type: 'string', variablesReference: 0 }
}

/**
 * The scope of an API-route handler frame as the adapter answers it: locals `req` (an `IncomingMessage` with its own `url`, `method`, `headers` and Node's flat `rawHeaders`) and `res`.
 * The credentials sit in both `headers` and `rawHeaders`, the two places the request object keeps them.
 */
const TREE: Record<number, DapVariable[]> = {
  1: [
    {
      name: 'req',
      value: 'IncomingMessage {url: …}',
      type: 'IncomingMessage',
      variablesReference: 2,
    },
  ],
  2: [
    stringVariable('url', '/api/data?clear=1'),
    stringVariable('method', 'GET'),
    {
      name: 'headers',
      value: `{host: 'localhost:3000', cookie: 'sid=${COOKIE_VALUE}', authorization: 'Bearer ${BEARER_VALUE}'}`,
      type: 'Object',
      variablesReference: 3,
    },
    {
      name: 'rawHeaders',
      value: `Array(6) ['Host', 'localhost:3000', 'Cookie', 'sid=${COOKIE_VALUE}', 'Authorization', 'Bearer ${BEARER_VALUE}']`,
      type: 'Array',
      variablesReference: 4,
    },
  ],
  3: [
    stringVariable('host', 'localhost:3000'),
    stringVariable('cookie', `sid=${COOKIE_VALUE}`),
    stringVariable('authorization', `Bearer ${BEARER_VALUE}`),
  ],
  4: [
    stringVariable('0', 'Host'),
    stringVariable('1', 'localhost:3000'),
    stringVariable('2', 'Cookie'),
    stringVariable('3', `sid=${COOKIE_VALUE}`),
    stringVariable('4', 'Authorization'),
    stringVariable('5', `Bearer ${BEARER_VALUE}`),
  ],
}

/** Finds a saved variable by its name chain from a top-level local. */
function savedVariable(snapshot: ReplayDebugSnapshot, ...names: string[]) {
  let indices = snapshot.frames[0]!.scopes[0]!.variables
  let found: ReplayDebugSnapshot['variables'][number] | undefined
  for (const name of names) {
    const index = indices.find(
      (value) => snapshot.variables[value]!.name === name,
    )
    found = index === undefined ? undefined : snapshot.variables[index]
    indices = found?.children ?? []
  }
  assert.ok(found, `no saved variable ${names.join(' > ')}`)
  return found
}

// Value: protects=E-8 the saved replay of an API-route pause keeps the request's Cookie and Authorization values out of the snapshot, in headers and in the flat rawHeaders, with the limits the run saves with; fails_when=either value is saved anywhere in the snapshot (also after the masking a study applies again at reopen) or a harmless header such as Host is masked; no_claim=headers whose names are not secret-named and carry no credential shape
test('a saved API-route pause masks the Cookie and Authorization values of the request in headers and rawHeaders', async () => {
  // Arrange
  const request = (
    command: 'scopes' | 'variables',
    arguments_: Record<string, number>,
  ) =>
    command === 'scopes'
      ? Promise.resolve({
          scopes: [
            {
              name: 'Local: __WEBPACK_DEFAULT_EXPORT__',
              presentationHint: 'locals',
              variablesReference: 1,
            },
          ],
        })
      : Promise.resolve({ variables: TREE[arguments_.variablesReference ?? 0] })
  // Act
  const captured = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [
        { id: 0, name: '__WEBPACK_DEFAULT_EXPORT__', line: 17, column: 1 },
      ],
      totalFrames: 1,
    },
    verifiedSource: {
      name: 'src/pages/api/data.ts',
      text: 'x',
      hash: 'a'.repeat(64),
      line: 17,
    },
    assertCurrent() {},
    request,
    limits: {
      timeoutMs: 1_500,
      maxFrames: 8,
      maxVariables: REPLAY_DEBUG_MAX_VARIABLES,
      maxDepth: REPLAY_DEBUG_MAX_DEPTH,
    },
  })
  const reopened = maskSavedDebugSnapshot(captured)
  // Assert
  for (const snapshot of [captured, reopened]) {
    const saved = JSON.stringify(snapshot)
    assert.equal(saved.includes(COOKIE_VALUE), false, 'the cookie is saved')
    assert.equal(saved.includes(BEARER_VALUE), false, 'the bearer is saved')
    assert.equal(
      savedVariable(snapshot, 'req', 'headers', 'host').value,
      "'localhost:3000'",
    )
    assert.equal(
      savedVariable(snapshot, 'req', 'rawHeaders', '3').value,
      '[masked]',
    )
    assert.equal(
      savedVariable(snapshot, 'req', 'rawHeaders', '5').value,
      '[masked]',
    )
    assert.equal(
      savedVariable(snapshot, 'req', 'headers', 'cookie').value,
      '[masked]',
    )
    assert.equal(
      savedVariable(snapshot, 'req', 'headers', 'authorization').value,
      '[masked]',
    )
  }
})
