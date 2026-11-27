import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

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
        inspections: [
          { path: 'requestId', mode: 'value', required: true },
          { path: 'tenantName', mode: 'value', required: true },
        ],
      },
    ],
    AbortSignal.timeout(5_000),
  )
}

/**
 * Runs one capture of the factory-made handler stop on the given runtime.
 * @param runtime - The run's runtime.
 * @returns What the debugger captured at the stop.
 * @example const capture = await captureHandlerStop('bun')
 */
async function captureHandlerStop(runtime: 'bun' | 'node') {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-bun-inspect-'))
  const file = join(directory, 'src/routes/users.ts')
  await mkdir(join(directory, 'src/routes'), { recursive: true })
  await writeFile(file, FACTORY_SOURCE)
  const hash = sha256(FACTORY_SOURCE)
  const editor = await editorHarness({ scriptedScopes: BUN_HANDLER_SCOPES })
  const { debug } = editor.createDebugger([{ line: 4, column: 7 }], {
    file,
    hash,
    workspace: directory,
  })
  try {
    await attachAndArm(debug, directory, file, hash, runtime)
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

// Value: protects=a Bun stop's declared inspection reads only the stopped function's own scopes, so a factory's value (`tenantName`) never enters the stop's saved facts when the replay snapshot leaves that closure out; fails_when=an inspection reads every non-global scope of a Bun stop, so the factory's closure value is saved in facts; seam=the editor harness with scripted Bun closures and the real capture and inspection; no_claim=js-debug's real Bun scopes (the native check covers them)
test('a Bun handler stop does not read a factory value that its replay snapshot leaves out', async () => {
  // Arrange / Act
  const capture = await captureHandlerStop('bun')
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(capture.facts)), [
    { path: 'requestId', mode: 'value', display: '7', type: 'number' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(capture.unavailable)), [
    'value:tenantName',
  ])
  assert.equal(JSON.stringify(capture.snapshot).includes('Acme Dental'), false)
})

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
