import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { Protocol } from 'devtools-protocol'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { readDevelopmentBundle } from '../utils/readDevelopmentBundle'
import { readRepositoryBuildText } from '../utils/readRepositoryBuildText'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { sameScriptUrl } from '../utils/sameScriptUrl'
import { inspectConfiguredValues } from '../utils/inspectConfiguredValues'
import { configuredDomExpression } from '../utils/configuredDomExpression'
import { assertDevelopmentWorkspace } from '../utils/assertDevelopmentWorkspace'
import { repositoryHarness } from './utils/repositoryHarness'
import { assertConfiguredSourceDocuments } from '../utils/assertConfiguredSourceDocuments'
import { configuredDefinitionSchema } from '../configuredStudySchemas'
import { createConfiguredStudy } from './utils/createConfiguredStudy'
import {
  REPOSITORY_CHUNK_LIMIT_BYTES,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'

test('unchanged native BOM and mixed-EOL source buffers pass identity guards while actual edits still reject', () => {
  // Arrange
  const study = createConfiguredStudy(
    '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
  )
  const definition = configuredDefinitionSchema.parse({
      configuration: study.configuration,
      configurationHash: study.configurationHash,
      descriptor: study.descriptor,
    }),
    document = {
      uri: { scheme: 'file', fsPath: '/repository/src/theme.ts' },
      getText: () => 'const nextTheme = "dark";\n// Retained second line.\n',
    }
  // Act / Assert
  assert.doesNotThrow(() =>
    assertConfiguredSourceDocuments('/repository', definition, [document]),
  )
  assert.throws(
    () =>
      assertConfiguredSourceDocuments('/repository', definition, [
        {
          ...document,
          getText: () =>
            'const nextTheme = "light";\n// Retained second line.\n',
        },
      ]),
    { code: 'SOURCE_CHANGED' },
  )
  assert.equal(
    definition.descriptor.sources[0]!.text,
    '\uFEFFconst nextTheme = "dark";\r\n// Retained second line.\r',
  )
})

for (const path of ['src/ordinary.tsx', 'components/deep/another.ts'])
  test(`configured discovery finds ${path} in a root client chunk without any fixed parent module name`, async (context) => {
    // Arrange
    const { directory, track } = await repositoryHarness(context),
      source = 'const answer = 42;\n'
    await track(path, source)
    const build = join(directory, '.next/dev'),
      manifestPath = join(
        build,
        'server/app/page_client-reference-manifest.js',
      ),
      sourcePath = join(await realpath(directory), path)
    await mkdir(dirname(manifestPath), { recursive: true })
    const map = JSON.stringify({
      version: 3,
      sources: [sourcePath],
      sourcesContent: [source],
      names: [],
      mappings: 'AAAA',
    })
    const script = `${source}//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///(app-pages-browser)/./${path}\n`
    await writeFile(
      join(build, 'unrelated.js'),
      'throw new Error("This chunk must only be read, never executed");',
    )
    await writeFile(
      join(build, 'selected.js'),
      `eval(__webpack_require__.ts(${JSON.stringify(script)}));`,
    )
    const manifest = {
      clientModules: {
        [join(directory, 'a-completely-different-entry.tsx')]: {
          chunks: ['unrelated.js', 'selected.js'],
        },
        [join(directory, 'second-entry.tsx')]: { chunks: ['selected.js'] },
      },
    }
    await writeFile(
      manifestPath,
      `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify(manifest)};`,
    )
    // Act
    const acquired = await readDevelopmentBundle(directory, {
        path,
        hash: sha256(source),
        line: 1,
        column: 1,
      }),
      verifier = createBundleVerifier(acquired.bundle)
    const receipt = verifier.verify(
      script,
      source,
      { scriptId: 'bound', lineNumber: 0, columnNumber: 0 },
      'bound',
      1,
      1,
    )
    // Assert
    assert.equal(acquired.bundle.source, 'const answer = 42;\n')
    assert.equal(acquired.bundle.sourceMap, map)
    assert.deepEqual(acquired.discovery.candidates, [
      'unrelated.js',
      'selected.js',
    ])
    assert.equal(receipt.mapping.originalSource, sourcePath)
    assert.equal(
      sameScriptUrl(
        acquired.bundle.scriptUrl,
        `webpack-internal:///(app-pages-browser)/${path}`,
      ),
      true,
    )
    await writeFile(
      join(build, 'unrelated.js'),
      `eval(${JSON.stringify(script)});`,
    )
    await assert.rejects(
      readDevelopmentBundle(directory, {
        path,
        hash: sha256(source),
        line: 1,
        column: 1,
      }),
      /Ambiguous application source chunk/,
    )
  })

test('a source from another route reports the root-page mismatch before browser input', async (context) => {
  // Arrange
  const { directory, track } = await repositoryHarness(context)
  const selectedPath = 'src/dashboard/Header.tsx',
    selectedSource = 'export const dashboard = true;\n'
  const rootPath = 'src/home/HeaderNav.tsx',
    rootSource = 'export const home = true;\n'
  await track(selectedPath, selectedSource)
  await track(rootPath, rootSource)
  const build = join(directory, '.next/dev'),
    manifestPath = join(build, 'server/app/page_client-reference-manifest.js')
  await mkdir(dirname(manifestPath), { recursive: true })
  const map = JSON.stringify({
    version: 3,
    sources: [join(await realpath(directory), rootPath)],
    sourcesContent: [rootSource],
    names: [],
    mappings: 'AAAA',
  })
  const script = `${rootSource}//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///(app-pages-browser)/./${rootPath}\n`
  await writeFile(join(build, 'root.js'), `eval(${JSON.stringify(script)});`)
  await writeFile(
    manifestPath,
    `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify({ clientModules: { [rootPath]: { chunks: ['root.js'] } } })};`,
  )
  // Act / Assert
  await assert.rejects(
    readDevelopmentBundle(directory, {
      path: selectedPath,
      hash: sha256(selectedSource),
      line: 1,
      column: 1,
    }),
    /Selected source is absent from the selected application route chunks; verify that it belongs to the launched page/,
  )
})

test('a large root chunk yields its bounded selected module without executing unrelated bytes', async (context) => {
  // Arrange
  const { directory, track } = await repositoryHarness(context),
    path = 'src/selected.tsx',
    source = 'const answer = 42;\n'
  await track(path, source)
  const build = join(directory, '.next/dev'),
    manifestPath = join(build, 'server/app/page_client-reference-manifest.js')
  await mkdir(dirname(manifestPath), { recursive: true })
  const map = JSON.stringify({
    version: 3,
    sources: [join(await realpath(directory), path)],
    sourcesContent: [source],
    names: [],
    mappings: 'AAAA',
  })
  const script = `${source}//# sourceMappingURL=data:application/json;base64,${Buffer.from(map).toString('base64')}\n//# sourceURL=webpack-internal:///(app-pages-browser)/./${path}\n`
  const chunk = `/*${'x'.repeat(REPOSITORY_JAVASCRIPT_LIMIT_BYTES)}*/\neval(${JSON.stringify(script)});`
  await writeFile(join(build, 'large.js'), chunk)
  await writeFile(
    manifestPath,
    `globalThis.__RSC_MANIFEST["/page"]=${JSON.stringify({ clientModules: { [path]: { chunks: ['large.js'] } } })};`,
  )
  // Act
  const acquired = await readDevelopmentBundle(directory, {
    path,
    hash: sha256(source),
    line: 1,
    column: 1,
  })
  // Assert
  assert.equal(
    Buffer.byteLength(chunk) > REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
    true,
  )
  assert.equal(Buffer.byteLength(chunk) < REPOSITORY_CHUNK_LIMIT_BYTES, true)
  assert.equal(acquired.bundle.javascript, script)
  assert.equal(acquired.bundle.chunkHash, sha256(chunk))
})

test('configured build reads reject linked files linked ancestors directory targets oversized bytes and invalid UTF-8 without following outside data', async (context) => {
  // Arrange
  const { directory, track } = await repositoryHarness(context),
    external = await mkdtemp(join(tmpdir(), 'codebook-outside-build-'))
  context.after(() => rm(external, { recursive: true, force: true }))
  await track('source.ts', 'abc')
  await writeFile(join(external, 'outside.js'), 'outside')
  await symlink(join(external, 'outside.js'), join(directory, 'linked.js'))
  await symlink(external, join(directory, 'linked-directory'))
  await writeFile(join(directory, 'invalid.js'), Buffer.from([0xff]))
  // Act / Assert
  assert.equal(await readRepositoryBuildText(directory, 'source.ts', 3), 'abc')
  await assert.rejects(
    readRepositoryBuildText(directory, 'source.ts', 2),
    /byte limit/,
  )
  await assert.rejects(
    readRepositoryBuildText(directory, 'linked.js', 100),
    /Linked build paths/,
  )
  await assert.rejects(
    readRepositoryBuildText(directory, 'linked-directory/outside.js', 100),
    /Linked build paths/,
  )
  await assert.rejects(
    readRepositoryBuildText(directory, join(external, 'outside.js'), 100),
    /escapes/,
  )
  await assert.rejects(
    readRepositoryBuildText(directory, '.git', 100),
    /regular file/,
  )
  await assert.rejects(readRepositoryBuildText(directory, 'invalid.js', 100), {
    name: 'TypeError',
    code: 'ERR_ENCODING_INVALID_ENCODED_DATA',
  })
  await assert.rejects(
    readRepositoryBuildText(directory, 'source.ts', 100, AbortSignal.abort()),
    /abort/i,
  )
})

test('a foreign Next lock is preserved and prevents readiness before any application is launched', async (context) => {
  // Arrange
  const { directory } = await repositoryHarness(context),
    executable = join(directory, 'node_modules/next/dist/bin/next'),
    lock = join(directory, '.next/dev/lock')
  await mkdir(dirname(executable), { recursive: true })
  await writeFile(executable, 'not executed')
  await mkdir(dirname(lock), { recursive: true })
  await writeFile(lock, 'another running app owns this')
  // Act / Assert
  await assert.rejects(
    assertDevelopmentWorkspace(directory, new AbortController().signal),
    { code: 'PREREQUISITE_MISSING' },
  )
  assert.equal(await readFile(lock, 'utf8'), 'another running app owns this')
})

test('configured inspection reads actual finite zero false null string and type values with side-effect checks on the exact frame', async () => {
  // Arrange
  const requests: Protocol.Debugger.EvaluateOnCallFrameRequest[] = []
  const environment = {
    count: 0,
    enabled: false,
    selection: null,
    title: 'observed',
    handler() {},
  }
  const inspections = [
    { path: 'count', mode: 'value' as const, required: true },
    { path: 'enabled', mode: 'value' as const, required: false },
    { path: 'selection', mode: 'value' as const, required: false },
    { path: 'title', mode: 'value' as const, required: false },
    { path: 'handler', mode: 'type' as const, required: true },
  ]
  // Act
  const result = await inspectConfiguredValues(
    async (parameters) => {
      requests.push(parameters)
      const value = runInNewContext(parameters.expression, environment)
      return { result: { type: typeof value, value } }
    },
    'exact-frame',
    inspections,
    () => {},
  )
  // Assert
  assert.deepEqual(result, {
    values: {
      'value:count': 0,
      'value:enabled': false,
      'value:selection': null,
      'value:title': 'observed',
      'type:handler': 'function',
    },
    unavailableValues: [],
  })
  assert.equal(requests.length, 5)
  assert.equal(
    requests.every(
      (request) =>
        request.callFrameId === 'exact-frame' &&
        request.throwOnSideEffect === true &&
        request.returnByValue === true &&
        request.timeout === 1000,
    ),
    true,
  )
})

test('unavailable optional inspections stay labeled and required objects getters nonfinite missing responses or oversized values cannot certify a pause', async () => {
  // Arrange
  const results: Protocol.Debugger.EvaluateOnCallFrameResponse[] = [
    { result: { type: 'undefined' } },
    { result: { type: 'object', value: { data: 1 } } },
    { result: { type: 'object', objectId: 'remote-object' } },
    { result: { type: 'number', unserializableValue: 'NaN' } },
    { result: { type: 'string', value: 'x'.repeat(1025) } },
    {
      result: { type: 'undefined' },
      exceptionDetails: {
        exceptionId: 1,
        text: 'Possible side effect',
        lineNumber: 0,
        columnNumber: 0,
      },
    },
  ]
  // Act / Assert
  for (const response of results) {
    const optional = await inspectConfiguredValues(
      async () => response,
      'frame',
      [{ path: 'local', mode: 'value', required: false }],
      () => {},
    )
    assert.deepEqual(optional.values, {})
    assert.equal(optional.unavailableValues[0]?.path, 'value:local')
    assert.equal(optional.unavailableValues.length, 1)
    const required = await inspectConfiguredValues(
      async () => response,
      'frame',
      [{ path: 'local', mode: 'value', required: true }],
      () => {},
    )
    assert.deepEqual(required.values, {})
    assert.equal(required.unavailableValues[0]?.path, 'value:local')
  }
})

test('large optional application objects and strings become unavailable before any payload is serialized for the debugger transport', async () => {
  // Arrange: evaluate the actual generated expression, then model the protocol serialization boundary.
  const payloadSizes: number[] = []
  const environment = {
    huge: Array(10_000).fill('private application data'),
    long: 'x'.repeat(20_000),
    useful: 0,
  }
  const evaluate = async (
    parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> => {
    const value = runInNewContext(parameters.expression, environment)
    const result = { type: typeof value, value }
    payloadSizes.push(Buffer.byteLength(JSON.stringify(result)))
    return { result }
  }
  // Act
  const facts = await inspectConfiguredValues(
    evaluate,
    'exact-frame',
    [
      { path: 'huge', mode: 'value', required: false },
      { path: 'long', mode: 'value', required: false },
      { path: 'useful', mode: 'value', required: true },
    ],
    () => {},
  )
  // Assert
  assert.deepEqual(facts.values, { 'value:useful': 0 })
  assert.deepEqual(
    facts.unavailableValues.map((value) => value.path),
    ['value:huge', 'value:long'],
  )
  assert.deepEqual(payloadSizes, [20, 20, 27])
})

test('a pause invalidated while an evaluation response is delayed cannot publish that response as captured facts', async () => {
  // Arrange
  let current = true
  // Act / Assert
  await assert.rejects(
    inspectConfiguredValues(
      async () => {
        current = false
        return { result: { type: 'number', value: 42 } }
      },
      'frame',
      [{ path: 'value', mode: 'value', required: true }],
      () => {
        if (!current) throw new Error('Pause changed')
      },
    ),
    /Pause changed/,
  )
})

test('DOM configuration compares literal text and attributes and refuses duplicate disabled hidden or obscured click targets', () => {
  // Arrange: a pure DOM-boundary model, not browser layout or native UI evidence.
  let visible = true,
    disabled = false,
    duplicates = false,
    obscured = false,
    attributeValue = 'idle'
  const element = {
    isConnected: true,
    textContent: 'Ready',
    getAttribute: (name: string) =>
      name === 'data-state' ? attributeValue : null,
    matches: () => disabled,
    contains: () => false,
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 40, height: 30 }),
  }
  const selector = 'button[title="literal; globalThis.injected = true"]'
  const environment = {
    document: {
      querySelectorAll: (input: string) =>
        input === selector ? (duplicates ? [element, element] : [element]) : [],
      elementFromPoint: () => (obscured ? {} : element),
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: visible ? 'visible' : 'hidden',
      opacity: '1',
    }),
  }
  const expression = configuredDomExpression(
    [
      { kind: 'visible', selector },
      { kind: 'text', selector, equals: 'Ready' },
      { kind: 'attribute', selector, attribute: 'data-state', equals: 'idle' },
    ],
    selector,
  )
  const read = () =>
    JSON.parse(JSON.stringify(runInNewContext(expression, environment)))
  // Act / Assert
  assert.deepEqual(read(), { ready: true, x: 30, y: 35 })
  assert.equal('injected' in environment, false)
  duplicates = true
  assert.deepEqual(read(), {
    ready: false,
    failure: { conditionIndex: 0, reason: 'selector-not-unique' },
  })
  duplicates = false
  disabled = true
  assert.deepEqual(read(), {
    ready: false,
    failure: { reason: 'click-target-disabled' },
  })
  disabled = false
  visible = false
  assert.deepEqual(read(), {
    ready: false,
    failure: { conditionIndex: 0, reason: 'not-visible' },
  })
  visible = true
  obscured = true
  assert.deepEqual(read(), {
    ready: false,
    failure: { reason: 'click-target-obscured' },
  })
  obscured = false
  element.textContent = 'Different'
  assert.deepEqual(read(), {
    ready: false,
    failure: { conditionIndex: 1, reason: 'text-mismatch' },
  })
  element.textContent = 'Ready'
  attributeValue = 'other'
  assert.deepEqual(read(), {
    ready: false,
    failure: { conditionIndex: 2, reason: 'attribute-mismatch' },
  })
})

test('configured browser checks identify absent condition and click elements separately from duplicates', () => {
  // Arrange
  const environment = {
    document: { querySelectorAll: () => [], elementFromPoint: () => null },
  }
  const condition = configuredDomExpression(
    [{ kind: 'visible', selector: '#missing-condition' }],
    '#button',
  )
  const click = configuredDomExpression([], '#missing-button')
  // Act
  const conditionResult = JSON.parse(
    JSON.stringify(runInNewContext(condition, environment)),
  )
  const clickResult = JSON.parse(
    JSON.stringify(runInNewContext(click, environment)),
  )
  // Assert
  assert.deepEqual(conditionResult, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'selector-missing' },
  })
  assert.deepEqual(clickResult, {
    ready: false,
    failure: { reason: 'click-target-missing' },
  })
})

test('invalid browser-native CSS fails a declared condition or click target before application input', () => {
  // Arrange
  const environment = {
    document: {
      querySelectorAll: () => {
        throw new SyntaxError('unsupported pseudo selector')
      },
      elementFromPoint: () => null,
    },
  }
  const condition = configuredDomExpression(
    [{ kind: 'visible', selector: 'button:has-text("Log in")' }],
    'button',
  )
  const click = configuredDomExpression([], 'button:has-text("Log in")')
  // Act
  const conditionResult = JSON.parse(
    JSON.stringify(runInNewContext(condition, environment)),
  )
  const clickResult = JSON.parse(
    JSON.stringify(runInNewContext(click, environment)),
  )
  // Assert
  assert.deepEqual(conditionResult, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'invalid-selector' },
  })
  assert.deepEqual(clickResult, {
    ready: false,
    failure: { reason: 'invalid-selector' },
  })
})

test('required undefined remains an observed value distinct from null strings and rejected application objects', async () => {
  // Arrange
  const environment = {
    missing: undefined,
    text: 'undefined',
    empty: null,
    fake: { type: 'undefined' },
    huge: 'x'.repeat(1025),
    invalid: NaN,
    handler() {},
  }
  const paths = [
    'missing',
    'text',
    'empty',
    'fake',
    'huge',
    'invalid',
    'handler',
  ]
  // Act: execute the actual expression and cross the JSON transport boundary.
  const result = await inspectConfiguredValues(
    async (parameters) => {
      const value = runInNewContext(parameters.expression, environment)
      return JSON.parse(
        JSON.stringify({ result: { type: typeof value, value } }),
      )
    },
    'exact-frame',
    paths.map((path) => ({ path, mode: 'value', required: true })),
    () => {},
  )
  // Assert
  assert.deepEqual(result.values, {
    'value:missing': { type: 'undefined' },
    'value:text': 'undefined',
    'value:empty': null,
  })
  assert.deepEqual(
    result.unavailableValues.map((value) => value.path),
    ['value:fake', 'value:huge', 'value:invalid', 'value:handler'],
  )
})
