import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'
import type * as vscode from 'vscode'

import { inspectNodeTestVariables } from '../utils/inspectNodeTestVariables'

test('a Node pause keeps declared nested facts without retaining unrelated local values', async () => {
  // Arrange
  const references = new Map<number, DebugProtocol.Variable[]>([
    [
      1,
      [
        {
          name: 'listener',
          value: '() => undefined',
          type: 'Function',
          variablesReference: 0,
        },
        {
          name: 'secret',
          value: 'private-token',
          type: 'string',
          variablesReference: 0,
        },
        {
          name: 'state',
          value: 'Object',
          type: 'Object',
          variablesReference: 2,
        },
      ],
    ],
    [2, [{ name: 'count', value: '3', type: 'number', variablesReference: 0 }]],
  ])
  const session = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => ({ variables: references.get(arguments_.variablesReference) ?? [] }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [{ name: 'Local', variablesReference: 1, expensive: false }]
  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [
      { path: 'listener', mode: 'value', required: true },
      { path: 'state.count', mode: 'value', required: true },
    ],
    AbortSignal.timeout(1_000),
  )
  // Assert
  assert.deepEqual(result.facts, [
    {
      path: 'listener',
      mode: 'value',
      display: '() => undefined',
      type: 'Function',
    },
    { path: 'state.count', mode: 'value', display: '3', type: 'number' },
  ])
  assert.deepEqual(
    result.variables.map((variable) => variable.name),
    ['listener', 'count'],
  )
  assert.equal(JSON.stringify(result).includes('private-token'), false)
})

test('a Node pause does not inspect global variables when the declared local fact exists', async () => {
  // Arrange
  const references: number[] = []
  const session = {
    customRequest: async (
      _command: string,
      arguments_: { variablesReference: number },
    ) => {
      references.push(arguments_.variablesReference)
      return {
        variables:
          arguments_.variablesReference === 1
            ? [
                {
                  name: 'listener',
                  value: 'ready',
                  type: 'string',
                  variablesReference: 0,
                },
              ]
            : [
                {
                  name: 'secret',
                  value: 'private-token',
                  variablesReference: 0,
                },
              ],
      }
    },
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [
    { name: 'Local', variablesReference: 1, expensive: false },
    { name: 'Global', variablesReference: 2, expensive: true },
  ]
  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [{ path: 'listener', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )
  // Assert
  assert.deepEqual(references, [1])
  assert.deepEqual(result.facts, [
    { path: 'listener', mode: 'value', display: 'ready', type: 'string' },
  ])
})

test('a Node pause refuses a missing required value', async () => {
  // Arrange
  const session = {
    customRequest: async () => ({ variables: [] }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [{ name: 'Local', variablesReference: 1, expensive: false }]
  // Act / Assert
  await assert.rejects(
    inspectNodeTestVariables(
      session,
      scopes,
      [{ path: 'listener', mode: 'value', required: true }],
      AbortSignal.timeout(1_000),
    ),
    /Required Node debugger fact is unavailable/,
  )
})

test('a Node pause keeps a declared value whose debugger type name is too long to save, omitting only that type', async () => {
  // Arrange: a deeply generic TypeScript value can report a type name longer than the saved 256-character field.
  const longTypeName = `Map<string, ${'Array<Record<string, number>>, '.repeat(12)}number>`
  const session = {
    customRequest: async () => ({
      variables: [
        {
          name: 'totals',
          value: 'Map(3)',
          type: longTypeName,
          variablesReference: 0,
        },
      ],
    }),
  } as unknown as Pick<vscode.DebugSession, 'customRequest'>
  const scopes = [{ name: 'Local', variablesReference: 1, expensive: false }]

  // Act
  const result = await inspectNodeTestVariables(
    session,
    scopes,
    [{ path: 'totals', mode: 'value', required: true }],
    AbortSignal.timeout(1_000),
  )

  // Assert
  assert.ok(longTypeName.length > 256)
  assert.deepEqual(result.facts, [
    { path: 'totals', mode: 'value', display: 'Map(3)' },
  ])
})
