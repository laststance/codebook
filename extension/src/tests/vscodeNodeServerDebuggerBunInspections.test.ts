import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

import { BUN_SCOPES_NOT_SAVED_LIMITATION } from '../constants'
import type { NodeServerDebugger } from '../nodeServerDebugger'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { editorHarness, OWNED_IDS } from './utils/nodeServerEditorHarness'
import { removeTestFolder } from './utils/removeTestFolder'

/** A handler made by a factory: `tenantName` lives only in the factory's closure. */
const FACTORY_SOURCE = [
  'export const makeRoutes = (tenantName) => {',
  '  return {',
  '    get: (request) => {',
  '      const requestId = request.id',
  '      return requestId',
  '    },',
  '  }',
  '}',
  '',
].join('\n')

/** The handler's own closure, then the factory's, then the module's, as js-debug shows a Bun stop. */
const BUN_HANDLER_SCOPES = {
  frameName: '<anonymous>',
  scopes: [
    {
      name: 'Closure',
      presentationHint: 'arguments',
      variablesReference: 11,
      expensive: false,
    },
    {
      name: 'Closure',
      presentationHint: 'arguments',
      variablesReference: 12,
      expensive: false,
    },
    {
      name: 'Closure',
      presentationHint: 'arguments',
      variablesReference: 13,
      expensive: false,
    },
    { name: 'Script', variablesReference: 14, expensive: false },
    { name: 'Global', variablesReference: 15, expensive: false },
  ],
  variables: {
    11: [
      { name: 'request', value: '{id: 7}', variablesReference: 0 },
      { name: 'requestId', value: '7', type: 'number', variablesReference: 0 },
    ],
    12: [
      {
        name: 'tenantName',
        value: "'Acme Dental'",
        type: 'string',
        variablesReference: 0,
      },
    ],
    13: [{ name: 'makeRoutes', value: 'ƒ makeRoutes', variablesReference: 0 }],
  },
}

/**
 * Attaches the debugger and arms the one declared stop with a handler name and a factory name declared.
 * @param debug - The debugger under test.
 * @param directory - The package root.
 * @param file - The stop's file.
 * @param hash - The file's SHA-256.
 * @param runtime - The run's runtime.
 * @example await attachAndArm(debug, directory, file, sha256(text), 'bun')
 */
async function attachAndArm(
  debug: NodeServerDebugger,
  directory: string,
  file: string,
  hash: string,
  runtime: 'bun' | 'node',
  inspections: Array<{ path: string; mode: 'value'; required: boolean }> = [
    { path: 'requestId', mode: 'value', required: true },
    { path: 'tenantName', mode: 'value', required: true },
  ],
): Promise<void> {
  await debug.attach({
    endpoint: 'ws://127.0.0.1:9229/abc',
    packageRoot: directory,
    pid: 4242,
    processGroup: 4242,
    runtime,
    signal: AbortSignal.timeout(5_000),
  })
  await debug.armStops(
    [
      {
        declaredStopIndex: 0,
        path: 'src/routes/users.ts',
        file,
        line: 4,
        column: 7,
        hash,
        inspections,
      },
    ],
    AbortSignal.timeout(5_000),
  )
}

/**
 * Runs one capture of the factory-made handler stop on the given runtime.
 * @param runtime - The run's runtime.
 * @param overrides - Another scope chain, masking or declared inspections for the same handler.
 * @returns What the debugger captured at the stop.
 * @example const capture = await captureHandlerStop('bun')
 */
async function captureHandlerStop(
  runtime: 'bun' | 'node',
  overrides: {
    scriptedScopes?: {
      frameName?: string
      scopes: DebugProtocol.Scope[]
      variables: Record<number, DebugProtocol.Variable[]>
    }
    maskKnownText?: (text: string) => string
    inspections?: Array<{ path: string; mode: 'value'; required: boolean }>
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-bun-inspect-'))
  const file = join(directory, 'src/routes/users.ts')
  await mkdir(join(directory, 'src/routes'), { recursive: true })
  await writeFile(file, FACTORY_SOURCE)
  const hash = sha256(FACTORY_SOURCE)
  const editor = await editorHarness({
    scriptedScopes: overrides.scriptedScopes ?? BUN_HANDLER_SCOPES,
  })
  const { debug } = editor.createDebugger(
    [{ line: 4, column: 7 }],
    { file, hash, workspace: directory },
    [],
    overrides.maskKnownText,
  )
  try {
    await attachAndArm(
      debug,
      directory,
      file,
      hash,
      runtime,
      overrides.inspections,
    )
    const paused = new Promise<Parameters<NodeServerDebugger['capture']>[0]>(
      (resolve) =>
        debug.subscribe({
          onPause: resolve,
          onResume: () => undefined,
          onEnd: () => undefined,
        }),
    )
    await debug.releaseEntry(AbortSignal.timeout(5_000))
    editor.adapter.stop('breakpoint', [OWNED_IDS[0]!], {
      file,
      line: 4,
      column: 7,
    })
    return await debug.capture(await paused, AbortSignal.timeout(5_000))
  } finally {
    await debug.release()
    await removeTestFolder(directory)
  }
}

// Value: protects=a Node run's declared inspections keep reading every non-global scope, so the Bun rule changes nothing for node-test and node-server Node runs; fails_when=the own-scope rule is applied to a Node run and an enclosing scope's value is no longer read; seam=the same scripted scopes on a node attach; no_claim=a real Node stop
test('a Node server stop still reads an enclosing scope value as before', async () => {
  // Arrange / Act
  const capture = await captureHandlerStop('node')
  // Assert
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.facts)).map(
      (fact: { path: string }) => fact.path,
    ),
    ['requestId', 'tenantName'],
  )
  assert.deepEqual(JSON.parse(JSON.stringify(capture.unavailable)), [])
})

/** A scope as js-debug lists it for a Bun handler stop. */
function bunScope(name: string, hint: string | undefined, reference: number) {
  return {
    name,
    ...(hint ? { presentationHint: hint } : {}),
    variablesReference: reference,
    expensive: false,
  }
}

/** The names of the saved top-level variables of the stopped frame. */
function savedNamesOf(
  capture: Awaited<ReturnType<typeof captureHandlerStop>>,
): string[] {
  return (capture.snapshot.frames[0]?.scopes ?? [])
    .flatMap((scope) => scope.variables)
    .map((index) => capture.snapshot.variables[index]!.name)
}

/** The stop of the factory-made handler: [closure(own), Block(locals), closure(factory), closure(module), Global]. */
const BUN_FULL_CHAIN = {
  ...BUN_HANDLER_SCOPES,
  scopes: [
    bunScope('Closure', 'arguments', 11),
    bunScope('Block', 'locals', 20),
    bunScope('Closure', 'arguments', 12),
    bunScope('Closure', 'arguments', 13),
    bunScope('Global', undefined, 15),
  ],
  variables: {
    ...BUN_HANDLER_SCOPES.variables,
    20: [{ name: 'item', value: "'book'", variablesReference: 0 }],
  },
}

// Value: protects=a saved Bun replay holds no value of any scope of the stop (own closure, block, factory, module), records the limitation once and keeps the call stack; fails_when=any scope value of a Bun stop reaches the saved history or the limitation is missing; seam=the editor harness with scripted Bun scopes and the real capture; no_claim=js-debug's real Bun scopes (the native check covers them)
test('a Bun handler stop saves no scope value, says so once and keeps the call stack', async () => {
  // Arrange / Act
  const capture = await captureHandlerStop('bun', {
    scriptedScopes: BUN_FULL_CHAIN,
    inspections: [],
  })
  // Assert
  assert.deepEqual(savedNamesOf(capture), [])
  assert.equal(capture.snapshot.variables.length, 0)
  assert.deepEqual(capture.snapshot.limitations, [
    BUN_SCOPES_NOT_SAVED_LIMITATION,
  ])
  assert.deepEqual(
    capture.snapshot.frames.map((frame) => frame.name),
    ['<anonymous>'],
  )
  assert.equal(JSON.stringify(capture.snapshot).includes('Acme Dental'), false)
})

// Value: protects=a Bun stop's declared inspections are read like a Node run's (the name as the stopped code sees it) and kept in the stop's facts, the only values the replay shows for a Bun stop; fails_when=an inspection of a closure name (own or an enclosing factory's) is not read on a Bun stop, or the scopes are copied into the snapshot instead; seam=the editor harness with scripted Bun scopes and the real inspection; no_claim=js-debug's real Bun scopes
test('a Bun handler stop reads its declared inspections and saves no scope copy', async () => {
  // Arrange / Act
  const capture = await captureHandlerStop('bun', {
    scriptedScopes: BUN_FULL_CHAIN,
  })
  // Assert
  assert.deepEqual(
    JSON.parse(JSON.stringify(capture.facts)).map(
      (fact: { path: string; display: string }) => [fact.path, fact.display],
    ),
    [
      ['requestId', '7'],
      ['tenantName', "'Acme Dental'"],
    ],
  )
  assert.deepEqual(JSON.parse(JSON.stringify(capture.unavailable)), [])
  assert.deepEqual(savedNamesOf(capture), [])
  assert.equal(JSON.stringify(capture.snapshot).includes('Acme Dental'), false)
})
