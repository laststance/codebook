import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { runInNewContext } from 'node:vm'

import type { Protocol } from 'devtools-protocol'

import { configuredDefinitionSchema } from '../configuredStudySchemas'
import {
  REPOSITORY_CHUNK_LIMIT_BYTES,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { assertConfiguredSourceDocuments } from '../utils/assertConfiguredSourceDocuments'
import { assertDevelopmentWorkspace } from '../utils/assertDevelopmentWorkspace'
import type * as AssertDevelopmentWorkspaceModule from '../utils/assertDevelopmentWorkspace'
import { configuredDomExpression } from '../utils/configuredDomExpression'
import { createBundleVerifier } from '../utils/createBundleVerifier'
import { inspectConfiguredValues } from '../utils/inspectConfiguredValues'
import { readDevelopmentBundle } from '../utils/readDevelopmentBundle'
import { readRepositoryBuildText } from '../utils/readRepositoryBuildText'
import { sameScriptUrl } from '../utils/sameScriptUrl'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { fileSystemWithLargeFileIds } from './utils/fileSystemWithLargeFileIds'
import { loadModule } from './utils/loadModule'
import { repositoryHarness } from './utils/repositoryHarness'

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
    assertConfiguredSourceDocuments(
      '/repository',
      definition.descriptor.sources,
      [document],
    ),
  )
  assert.throws(
    () =>
      assertConfiguredSourceDocuments(
        '/repository',
        definition.descriptor.sources,
        [
          {
            ...document,
            getText: () =>
              'const nextTheme = "light";\n// Retained second line.\n',
          },
        ],
      ),
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

// Value: protects=a stop in another page's component is refused before browser input with a sentence that names the stop's file, the launched page and where a stop can go (the launched page's own code, or a run started at the stop's page), so the agent does not retry blind; fails_when=the refusal names neither the file nor the page and only says to verify the page, as N51's Cursor run retried three times (Cycle 0052 task 7b); why_new=the boundary stays (a browser stop is armed before input in the code the launched page loads) and its sentence now says so; seam=a development build whose root page loads another component; no_claim=a stop armed after a client-side navigation, which the profile does not support
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
    {
      message:
        'Selected source src/dashboard/Header.tsx is not in the client code that the launched page (entryPath "/") loads, and a browser stop can only be armed in that code before input; start the run at the page whose component holds the stop (set entryPath to it) or choose a stop in the launched page\'s own components',
    },
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

/** The refusal of a Next development lock that is not the run's own, as {@link assertDevelopmentWorkspace} words it. */
const FOREIGN_LOCK_REFUSAL =
  'The selected Next development build lock is missing or belongs to another process. Stop its owner explicitly; Codebook does not reuse or remove another lock.'

/**
 * Prepares a workspace with an installed Next and a development lock on a file system whose file ids lie above 2^53, as on an NTFS volume, for the two tests of the lock's identity.
 * @returns The workspace, the lock's path, the file system with large ids and {@link assertDevelopmentWorkspace} loaded on it.
 * @example
 * const { directory, lock, largeIds, assertOnLargeIds } = await workspaceWithLargeFileIds(context)
 */
async function workspaceWithLargeFileIds(context: TestContext) {
  const { directory } = await repositoryHarness(context),
    executable = join(directory, 'node_modules/next/dist/bin/next'),
    lock = join(directory, '.next/dev/lock')
  await mkdir(dirname(executable), { recursive: true })
  await writeFile(executable, 'not executed')
  await mkdir(dirname(lock), { recursive: true })
  await writeFile(lock, 'the lock of the run')
  const largeIds = fileSystemWithLargeFileIds()
  const { assertDevelopmentWorkspace: assertOnLargeIds } = await loadModule<
    typeof AssertDevelopmentWorkspaceModule
  >(resolve(__dirname, '../utils/assertDevelopmentWorkspace.js'), {
    'node:fs/promises': largeIds,
  })
  return { directory, lock, largeIds, assertOnLargeIds }
}

// Cycle 0046 (row 141): red while the lock a run owns was named by its device and inode as JavaScript numbers: on NTFS a file id passes 2^53, two ids that differ only below the rounding are one number, and a lock another `next dev` created anew was taken for Codebook's own.
test('a Next development lock created anew under a file id that differs from the owned one only below a number’s precision is refused as another process’s', async (context) => {
  // Arrange: the run's lock has the id 210824757556437109. Another `next dev` then replaces it by a new file, whose id 210824757556437110 is the same JavaScript number.
  const { directory, lock, largeIds, assertOnLargeIds } =
    await workspaceWithLargeFileIds(context)
  const owned = await largeIds.lstat(lock, { bigint: true })
  await writeFile(`${lock}.new`, 'the lock of another next dev')
  await rename(`${lock}.new`, lock)
  const createdAnew = await largeIds.lstat(lock, { bigint: true })
  // Act
  const answer = await assertOnLargeIds(
    directory,
    new AbortController().signal,
    { dev: owned.dev, ino: owned.ino },
  ).then(
    () => 'taken for the owned lock',
    (error: unknown) => (error instanceof Error ? error.message : error),
  )
  // Assert
  assert.deepEqual(
    [owned.ino, createdAnew.ino, Number(owned.ino) === Number(createdAnew.ino)],
    [210_824_757_556_437_109n, 210_824_757_556_437_110n, true],
  )
  assert.equal(answer, FOREIGN_LOCK_REFUSAL)
  assert.equal(await readFile(lock, 'utf8'), 'the lock of another next dev')
})

// Cycle 0046 (row 141): the exact identity still names the run's own lock; red if only one side of the comparison were read exactly, so that the owned lock itself were refused.
test('the Next development lock a run owns is still taken for its own when its file id lies above a number’s precision', async (context) => {
  // Arrange: the run's lock has the id 210824757556437109 and nothing replaces it.
  const { directory, lock, largeIds, assertOnLargeIds } =
    await workspaceWithLargeFileIds(context)
  const owned = await largeIds.lstat(lock, { bigint: true })
  // Act
  const answer = await assertOnLargeIds(
    directory,
    new AbortController().signal,
    { dev: owned.dev, ino: owned.ino },
  ).then(
    () => 'taken for the owned lock',
    (error: unknown) => (error instanceof Error ? error.message : error),
  )
  // Assert
  assert.equal(owned.ino, 210_824_757_556_437_109n)
  assert.equal(answer, 'taken for the owned lock')
})

test('configured inspection reads actual finite zero false null string and type values with side-effect checks on the exact frame', async () => {
  // Arrange
  const requests: Protocol.Debugger.EvaluateOnCallFrameRequest[] = []
  const environment = {
    count: 0,
    enabled: false,
    selection: null,
    title: 'observed',
    handler(): void {},
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
  // Assert: the array crosses the transport only as its object marker.
  assert.deepEqual(facts.values, {
    'value:huge': { type: 'object' },
    'value:useful': 0,
  })
  assert.deepEqual(
    facts.unavailableValues.map((value) => value.path),
    ['value:long'],
  )
  assert.deepEqual(payloadSizes, [43, 20, 27])
})

test('a required value inspection of an object or a function is captured as its type marker instead of ending the stop as unavailable', async () => {
  // Arrange: evaluate the actual generated expression, as the debugger would at the pause.
  const environment = {
    credentials: { email: 'learner@example.com', password: 'secret' },
    authorize(): void {},
    lookalike: { type: 'undefined' },
  }
  const evaluate = async (
    parameters: Protocol.Debugger.EvaluateOnCallFrameRequest,
  ): Promise<Protocol.Debugger.EvaluateOnCallFrameResponse> => {
    const value = runInNewContext(parameters.expression, environment)
    return { result: { type: typeof value, value } }
  }
  // Act
  const facts = await inspectConfiguredValues(
    evaluate,
    'exact-frame',
    [
      { path: 'credentials', mode: 'value', required: true },
      { path: 'authorize', mode: 'value', required: true },
      { path: 'lookalike', mode: 'value', required: false },
    ],
    () => {},
  )
  // Assert
  assert.deepEqual(facts.values, {
    'value:credentials': { type: 'object' },
    'value:authorize': { type: 'function' },
    'value:lookalike': { type: 'object' },
  })
  assert.deepEqual(facts.unavailableValues, [])
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

// Value: protects=a text condition an agent derives from JSX holding on the first run although the element's text carries the whitespace JSX keeps beside a child element; fails_when=the comparison goes back to exact textContent, or collapses only one side; why_new=the exact comparison ended a natural run on the dashboard's "Log in " button (Cycle 0039, N8-a); seam=none
// Extended by the Cycle 0041 /ship coverage audit with the non-breaking space and tab row.
// Value: protects=a label written with a non-breaking space or a tab holding against the literal an agent types with plain spaces; fails_when=the collapse is narrowed to spaces and line breaks; why_new=the other rows hold only spaces and one line break; seam=none
test('a text condition holds when the element’s text and the declared text differ only in whitespace', () => {
  // Arrange: a button whose JSX text is followed by an icon, a result paragraph with line breaks, a literal declared with a doubled space, and a label written with a non-breaking space and a tab.
  const textBySelector: Record<string, string> = {
    '#login': 'Log in ',
    '#result': '  Invalid\n credentials. ',
    '#plain': 'Log in',
    '#nonBreaking': 'Log\u00a0in\tnow',
  }
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector in textBySelector
          ? [{ textContent: textBySelector[selector] }]
          : [],
    },
  }
  const read = (selector: string, equals: string) =>
    JSON.parse(
      JSON.stringify(
        runInNewContext(
          configuredDomExpression([{ kind: 'text', selector, equals }]),
          environment,
        ),
      ),
    )
  // Act
  const trailingSpace = read('#login', 'Log in')
  const lineBreaks = read('#result', 'Invalid credentials.')
  const doubledSpaceInLiteral = read('#plain', 'Log  in')
  const nonBreakingSpaceAndTab = read('#nonBreaking', 'Log in now')
  // Assert
  assert.deepEqual(trailingSpace, { ready: true })
  assert.deepEqual(lineBreaks, { ready: true })
  assert.deepEqual(doubledSpaceInLiteral, { ready: true })
  assert.deepEqual(nonBreakingSpaceAndTab, { ready: true })
})

// Value: protects=the agent learning that its text is there beside other text, which it can fix with another selector, without the page's text reaching it; fails_when=the relation is not reported, is reported for unrelated text, or the result carries page text; why_new=a text mismatch was reported with no relation; seam=none
// Extended by the Cycle 0041 /ship coverage audit with the row whose text spans several lines.
// Value: protects=the beside-other-text fix reaching an agent whose element spreads its text over several JSX lines; fails_when=the relation is judged on the raw text while equality uses the collapsed text; why_new=the first row has single spaces, where raw and collapsed text agree; seam=none
test('a text condition whose element holds the declared text beside other text reports that relation and no page text', () => {
  // Arrange
  const textBySelector: Record<string, string> = {
    '#beside': 'Log in to Acme',
    '#besideAcrossLines': 'Welcome.\n  Log   in\n to Acme',
    '#unrelated': 'Sign up',
  }
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector in textBySelector
          ? [{ textContent: textBySelector[selector] }]
          : [],
    },
  }
  const readSerialized = (selector: string) =>
    JSON.stringify(
      runInNewContext(
        configuredDomExpression([{ kind: 'text', selector, equals: 'Log in' }]),
        environment,
      ),
    )
  // Act
  const besideOtherText = readSerialized('#beside')
  const besideOtherTextAcrossLines = readSerialized('#besideAcrossLines')
  const unrelatedText = readSerialized('#unrelated')
  // Assert
  assert.deepEqual(JSON.parse(besideOtherText), {
    ready: false,
    failure: {
      conditionIndex: 0,
      reason: 'text-mismatch',
      textDifference: 'surrounding-text',
    },
  })
  assert.equal(besideOtherText.includes('Acme'), false)
  assert.deepEqual(JSON.parse(besideOtherTextAcrossLines), {
    ready: false,
    failure: {
      conditionIndex: 0,
      reason: 'text-mismatch',
      textDifference: 'surrounding-text',
    },
  })
  assert.equal(besideOtherTextAcrossLines.includes('Welcome'), false)
  assert.deepEqual(JSON.parse(unrelatedText), {
    ready: false,
    failure: { conditionIndex: 0, reason: 'text-mismatch' },
  })
})

// Added by the Cycle 0041 /ship coverage audit.
// Value: protects=a declaration without text meaning "the element is empty" and never earning the beside-other-text fix; fails_when=the relation loses its non-empty guard, since every text contains the empty text; why_new=no test declared an empty or whitespace-only literal; seam=none
test('a text condition that declares no text holds for an element without text and is never reported as text beside other text', () => {
  // Arrange: an error paragraph rendered empty except for its JSX line break, and a button that has a label.
  const textBySelector: Record<string, string> = {
    '#error': '\n  ',
    '#login': 'Log in',
  }
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector in textBySelector
          ? [{ textContent: textBySelector[selector] }]
          : [],
    },
  }
  const read = (selector: string, equals: string) =>
    JSON.parse(
      JSON.stringify(
        runInNewContext(
          configuredDomExpression([{ kind: 'text', selector, equals }]),
          environment,
        ),
      ),
    )
  // Act
  const emptyLiteralOnEmptyElement = read('#error', '')
  const emptyLiteralOnLabel = read('#login', '')
  const whitespaceLiteralOnLabel = read('#login', '  ')
  // Assert
  assert.deepEqual(emptyLiteralOnEmptyElement, { ready: true })
  assert.deepEqual(emptyLiteralOnLabel, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'text-mismatch' },
  })
  assert.deepEqual(whitespaceLiteralOnLabel, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'text-mismatch' },
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
    failure: {
      reason: 'click-target-missing',
      candidates: { button: 0, link: 0, field: 0 },
    },
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

test('required undefined remains an observed value distinct from null strings and from application objects, which keep only their object marker', async () => {
  // Arrange
  const environment = {
    missing: undefined,
    text: 'undefined',
    empty: null,
    fake: { type: 'undefined' },
    huge: 'x'.repeat(1025),
    invalid: NaN,
    handler(): void {},
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
    'value:fake': { type: 'object' },
    'value:handler': { type: 'function' },
  })
  assert.deepEqual(
    result.unavailableValues.map((value) => value.path),
    ['value:huge', 'value:invalid'],
  )
})

/**
 * Reads what the owned page answers for one declared text condition against an element holding the given text.
 * @param elementText - The element's textContent.
 * @param equals - The declared literal.
 * @returns The page's serialized answer.
 * @example
 * readTextCondition('Log in', 'Log in') // => { ready: true }
 */
function readTextCondition(elementText: string, equals: string): unknown {
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector === '#target' ? [{ textContent: elementText }] : [],
    },
  }
  return JSON.parse(
    JSON.stringify(
      runInNewContext(
        configuredDomExpression([
          { kind: 'text', selector: '#target', equals },
        ]),
        environment,
      ),
    ),
  )
}

// Cycle 0044 (0041-F5 / 0041-CR2 / 0041-OCR2): red while the relation was a plain substring test, so a hint sent the agent to another selector although only the word differed.
test('a declared text that is only part of a word of the element’s text is a plain text mismatch, not text beside other text', () => {
  // Arrange
  const cases = [
    { elementText: 'Login failed', equals: 'Log' },
    { elementText: 'Log into Acme', equals: 'Log in' },
    { elementText: '10', equals: '1' },
    { elementText: 'Online', equals: 'On' },
  ]
  // Act
  const answers = cases.map(({ elementText, equals }) =>
    readTextCondition(elementText, equals),
  )
  // Assert
  for (const answer of answers)
    assert.deepEqual(answer, {
      ready: false,
      failure: { conditionIndex: 0, reason: 'text-mismatch' },
    })
})

// Cycle 0044 (0041-F5): the relation still holds for whole words beside punctuation or other words.
test('a declared text that stands as whole words beside other text or punctuation still reports that relation', () => {
  // Arrange
  const besideWords = { elementText: 'Log in to Acme', equals: 'Log in' }
  const besidePunctuation = { elementText: 'Total: 10 items', equals: '10' }
  // Act
  const wordsAnswer = readTextCondition(
    besideWords.elementText,
    besideWords.equals,
  )
  const punctuationAnswer = readTextCondition(
    besidePunctuation.elementText,
    besidePunctuation.equals,
  )
  // Assert
  const relation = {
    ready: false,
    failure: {
      conditionIndex: 0,
      reason: 'text-mismatch',
      textDifference: 'surrounding-text',
    },
  }
  assert.deepEqual(wordsAnswer, relation)
  assert.deepEqual(punctuationAnswer, relation)
})

// Cycle 0044 (0041-F7): red under a comparison that strips every whitespace character instead of collapsing runs.
test('a text condition whose declared words are run together in the element is a text mismatch', () => {
  // Arrange
  const elementText = 'Login'
  // Act
  const answer = readTextCondition(elementText, 'Log in')
  // Assert
  assert.deepEqual(answer, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'text-mismatch' },
  })
})

// Cycle 0044 (0041-F7): red under an attribute comparison that collapses whitespace like the text comparison.
test('an attribute condition is compared exactly, so a value that differs only in a doubled space is a mismatch', () => {
  // Arrange
  const element = {
    getAttribute: (name: string) => (name === 'data-state' ? 'a  b' : null),
  }
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector === '#target' ? [element] : [],
    },
  }
  const expression = configuredDomExpression([
    {
      kind: 'attribute',
      selector: '#target',
      attribute: 'data-state',
      equals: 'a b',
    },
  ])
  // Act
  const answer = JSON.parse(
    JSON.stringify(runInNewContext(expression, environment)),
  )
  // Assert
  assert.deepEqual(answer, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'attribute-mismatch' },
  })
})

// Cycle 0044 (0042-N11-2): red while a missing click target was reported with no word about the page.
test('a click target that matches no element is reported with counts of the page’s buttons, links and form fields, never their text', () => {
  // Arrange: the page has two buttons, one link and three form fields; the action selector matches none of them.
  const countBySelector: Record<string, number> = {
    'button,[role="button"],input[type="submit"],input[type="button"]': 2,
    'a[href]': 1,
    'input,select,textarea': 3,
  }
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        Array.from({ length: countBySelector[selector] ?? 0 }, () => ({
          textContent: 'Secret label',
        })),
    },
  }
  // Act
  const serialized = JSON.stringify(
    runInNewContext(configuredDomExpression([], '#missing'), environment),
  )
  // Assert
  assert.deepEqual(JSON.parse(serialized), {
    ready: false,
    failure: {
      reason: 'click-target-missing',
      candidates: { button: 2, link: 1, field: 3 },
    },
  })
  assert.equal(serialized.includes('Secret'), false)
})

/**
 * Reads what the owned page answers for one declared text condition whose selector `p` matches elements holding the given texts.
 * @param elementTexts - The textContent of each element the selector matches, in document order.
 * @param equals - The declared literal.
 * @returns The page's serialized answer.
 * @example
 * readTextConditionOnElements(['Email', 'Invalid credentials'], 'Invalid credentials') // => { ready: true, textReadings: [...] }
 */
function readTextConditionOnElements(
  elementTexts: string[],
  equals: string,
): unknown {
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector === 'p'
          ? elementTexts.map((textContent) => ({ textContent }))
          : [],
    },
  }
  return JSON.parse(
    JSON.stringify(
      runInNewContext(
        configuredDomExpression([{ kind: 'text', selector: 'p', equals }]),
        environment,
      ),
    ),
  )
}

// Value: protects=an after condition an agent declares on a selector that matches several elements holding when the element it means reads the text; fails_when=a text condition still needs a unique element, or holds on an element that does not read the text, or the answer carries page text; why_new=Cycle 0045 N14c-14 (DX-1 a): the VS Code agent's first admitted run reached its five stops and failed "Timed out waiting for configured after conditions: condition 1 (text) selector-not-unique." although one paragraph read the expected text; seam=none
test('a text condition whose selector matches several elements holds when one of them reads the expected text, and says how many matched and how many read it', () => {
  // Arrange: three paragraphs, of which the second, written with JSX whitespace, reads the text.
  const oneReads = ['Email', '\n  Invalid credentials\n', 'Password']
  const twoRead = ['Invalid credentials', 'Email', 'Invalid  credentials']
  // Act
  const oneReading = readTextConditionOnElements(
    oneReads,
    'Invalid credentials',
  )
  const twoReading = readTextConditionOnElements(twoRead, 'Invalid credentials')
  // Assert: counts only, never page text.
  assert.deepEqual(oneReading, {
    ready: true,
    textReadings: [
      { conditionIndex: 0, matchedElements: 3, readingElements: 1 },
    ],
  })
  assert.deepEqual(twoReading, {
    ready: true,
    textReadings: [
      { conditionIndex: 0, matchedElements: 3, readingElements: 2 },
    ],
  })
  assert.equal(JSON.stringify(oneReading).includes('Email'), false)
})

// Value: protects=the timeout of a text condition on several elements naming how many matched instead of a uniqueness the rule no longer asks; fails_when=it is reported as selector-not-unique, or without the count; why_new=Cycle 0045 N14c-14 (DX-1 c); seam=none
test('a text condition whose selector matches several elements, none of which reads the expected text, fails as a text mismatch with the number of matched elements', () => {
  // Arrange
  const noneReads = ['Email', 'Password']
  // Act
  const answer = readTextConditionOnElements(noneReads, 'Invalid credentials')
  // Assert
  assert.deepEqual(answer, {
    ready: false,
    failure: {
      conditionIndex: 0,
      reason: 'text-mismatch',
      matchedElements: 2,
    },
  })
})

// Value: protects=a text condition on one element staying exactly as before the rule for several elements; fails_when=one element answers counts, or loses its beside-other-text relation; why_new=Cycle 0045 N14c-14 (the guard of its tolerance); seam=none
test('a text condition whose selector matches one element is judged on that element alone, with no counts in the answer', () => {
  // Arrange
  const onlyElement = ['Invalid credentials']
  const onlyElementBesideOtherText = ['Invalid credentials, try again']
  // Act
  const holds = readTextConditionOnElements(onlyElement, 'Invalid credentials')
  const besideOtherText = readTextConditionOnElements(
    onlyElementBesideOtherText,
    'Invalid credentials',
  )
  // Assert
  assert.deepEqual(holds, { ready: true })
  assert.deepEqual(besideOtherText, {
    ready: false,
    failure: {
      conditionIndex: 0,
      reason: 'text-mismatch',
      textDifference: 'surrounding-text',
    },
  })
})

// Value: protects=visible and attribute conditions and the click target keeping their uniqueness rule beside the new rule for text conditions; fails_when=either condition or the click target accepts one of several elements; why_new=Cycle 0045 N14c-14 (the rule is for text conditions only); seam=none
test('a visible condition, an attribute condition and the click target still refuse a selector that matches several elements', () => {
  // Arrange: two equal visible buttons.
  const button = {
    isConnected: true,
    textContent: 'Log in',
    getAttribute: () => 'submit',
    matches: () => false,
    contains: () => false,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 40, height: 20 }),
  }
  const environment = {
    document: {
      querySelectorAll: (selector: string) =>
        selector === 'button' ? [button, button] : [],
      elementFromPoint: () => button,
    },
    getComputedStyle: () => ({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    }),
  }
  const read = (expression: string) =>
    JSON.parse(JSON.stringify(runInNewContext(expression, environment)))
  // Act
  const visible = read(
    configuredDomExpression([{ kind: 'visible', selector: 'button' }]),
  )
  const attribute = read(
    configuredDomExpression([
      {
        kind: 'attribute',
        selector: 'button',
        attribute: 'type',
        equals: 'submit',
      },
    ]),
  )
  const clickTarget = read(configuredDomExpression([], 'button'))
  // Assert
  assert.deepEqual(visible, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'selector-not-unique' },
  })
  assert.deepEqual(attribute, {
    ready: false,
    failure: { conditionIndex: 0, reason: 'selector-not-unique' },
  })
  assert.deepEqual(clickTarget, {
    ready: false,
    failure: { reason: 'click-target-not-unique' },
  })
})
