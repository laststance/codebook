import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { DebugProtocol } from '@vscode/debugprotocol'

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
      laterScopes?: DebugProtocol.Scope[]
      beforeVariables?: (variablesReference: number) => Promise<void>
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

// Value: protects=a callback made inside an enclosing catch never saves that catch's private value, in the snapshot or in a declared inspection; fails_when=a block scope that follows a closure of the chain is copied by the default `locals` policy; seam=scripted chain [own closure, enclosing catch block, factory closure, module closure, Script, Global] through the real capture; no_claim=js-debug's real scope hints
test('a Bun handler made inside a catch block saves no value of that enclosing catch', async () => {
  // Arrange
  const scriptedScopes = {
    ...BUN_HANDLER_SCOPES,
    scopes: [
      bunScope('Closure', 'arguments', 11),
      bunScope('Catch Block', 'locals', 20),
      bunScope('Closure', 'arguments', 12),
      bunScope('Closure', 'arguments', 13),
      bunScope('Script', undefined, 14),
      bunScope('Global', undefined, 15),
    ],
    variables: {
      ...BUN_HANDLER_SCOPES.variables,
      20: [
        {
          name: 'caughtCredential',
          value: "'enclosing-catch-value'",
          variablesReference: 0,
        },
      ],
    },
  }
  // Act
  const capture = await captureHandlerStop('bun', {
    scriptedScopes,
    inspections: [
      { path: 'requestId', mode: 'value', required: true },
      { path: 'caughtCredential', mode: 'value', required: true },
    ],
  })
  // Assert
  assert.deepEqual(savedNamesOf(capture), ['request', 'requestId'])
  assert.deepEqual(JSON.parse(JSON.stringify(capture.unavailable)), [
    'value:caughtCredential',
  ])
  assert.equal(JSON.stringify(capture).includes('enclosing-catch-value'), false)
})

// Value: protects=a block scope that opens the handler's own chain is still saved and readable by a declared inspection; fails_when=the prefix rule drops the stopped function's own block values; seam=scripted chain [own block, own closure, factory closure, module closure, Script]; no_claim=js-debug's real scope hints
test('a Bun handler stop still saves its own block scope that precedes its closures', async () => {
  // Arrange
  const scriptedScopes = {
    ...BUN_HANDLER_SCOPES,
    scopes: [
      bunScope('Block', 'locals', 20),
      bunScope('Closure', 'arguments', 11),
      bunScope('Closure', 'arguments', 12),
      bunScope('Closure', 'arguments', 13),
      bunScope('Script', undefined, 14),
    ],
    variables: {
      ...BUN_HANDLER_SCOPES.variables,
      20: [{ name: 'item', value: "'book'", variablesReference: 0 }],
    },
  }
  // Act
  const capture = await captureHandlerStop('bun', {
    scriptedScopes,
    inspections: [{ path: 'item', mode: 'value', required: true }],
  })
  // Assert
  assert.deepEqual(savedNamesOf(capture), ['item', 'request', 'requestId'])
  assert.deepEqual(JSON.parse(JSON.stringify(capture.unavailable)), [])
})

// Value: protects=a second `scopes` answer that omits the own closure cannot move the factory's closure into an approved position; fails_when=the snapshot reads `scopes` again and applies positions decided on the first answer; seam=an adapter whose later `scopes` answers drop the first closure; no_claim=whether real adapters answer differently
test('a later scopes answer without the own closure does not save the factory value', async () => {
  // Arrange
  const scriptedScopes = {
    ...BUN_HANDLER_SCOPES,
    laterScopes: BUN_HANDLER_SCOPES.scopes.slice(1),
  }
  // Act
  const capture = await captureHandlerStop('bun', { scriptedScopes })
  // Assert
  assert.equal(JSON.stringify(capture.snapshot).includes('Acme Dental'), false)
  assert.deepEqual(savedNamesOf(capture), ['request', 'requestId'])
})

// Value: protects=a classification failure whose message holds a known secret saves no fragment of it even when the cut would have split it; fails_when=the raw adapter message reaches the limitation before masking and cutting; seam=a refused `variables` request whose message ends in the run's known secret at the cut; no_claim=what real adapters write
test('a classification failure naming a known secret saves no fragment of it', async () => {
  // Arrange
  const secret = 'hunter2-known-value'
  const scriptedScopes = {
    ...BUN_HANDLER_SCOPES,
    beforeVariables: async () => {
      throw new Error(`${'a'.repeat(3_982)}${secret}`)
    },
  }
  // Act
  const capture = await captureHandlerStop('bun', {
    scriptedScopes,
    maskKnownText: (text) => text.replaceAll(secret, '[masked]'),
  })
  // Assert
  assert.equal(
    JSON.stringify(capture.snapshot.limitations).includes('hunte'),
    false,
  )
  assert.equal(
    capture.snapshot.limitations.filter((limitation) =>
      limitation.includes('could not be classified'),
    ).length,
    1,
  )
})

// Value: protects=slow `variables` answers stop closure classification at one shared deadline, mark nothing as the function's own and record why; fails_when=each scope gets its own long timeout so a slow adapter holds the live handler and the closures are still classified; seam=every `variables` answer waits 1,000 ms; no_claim=real adapter latency
test('slow closure answers end classification at the shared deadline with nothing own', async () => {
  // Arrange
  const scriptedScopes = {
    ...BUN_HANDLER_SCOPES,
    beforeVariables: (): Promise<void> =>
      new Promise<void>((resolve) => setTimeout(() => resolve(), 1_000)),
  }
  // Act
  const capture = await captureHandlerStop('bun', { scriptedScopes })
  // Assert
  assert.deepEqual(JSON.parse(JSON.stringify(capture.unavailable)), [
    'value:requestId',
    'value:tenantName',
  ])
  assert.deepEqual(savedNamesOf(capture), [])
  assert.equal(
    capture.snapshot.limitations[0]?.includes('could not be classified'),
    true,
  )
})
