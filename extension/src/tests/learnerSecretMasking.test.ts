import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { SecretFrameGate } from '../runtimeSupport/secretFrameGate'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'
import { captureReplayDebugSnapshot } from '../utils/captureReplayDebugSnapshot'
import { maskLearnerSecretData } from '../utils/maskLearnerSecretData'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { configuredServiceHarness } from './utils/configuredServiceHarness'
import { ControlledOperationsRuntime } from './utils/controlledOperationsRuntime'
import { readEvidenceText } from './utils/readEvidenceText'

const OPERATION_ACTION = 'repository-operation'
const SECRET = 'typed-by-learner'

/** The ordered operations of a sign-in: an ask-learner password into a password control. */
const PASSWORD_OPERATIONS = [
  {
    kind: 'text',
    title: 'Password',
    selector: '#password',
    secret: 'ask-learner',
  },
] as const
const PASSWORD_CONTROLS = {
  '#password': { tagName: 'input', type: 'password' },
} as const

// protects=ENG-4: a value the learner typed and the page copied into a variable (inspection value, debugger preview and saved snapshot) is masked in the run resource, the journal and every evidence file, while the page still received it; fails_when=any form of the run keeps the copy, or the typed text did not reach the page; no_claim=a real debugger or page: the harness stands in for the page, with the copied value as the stop's local variable
test('a value copied from the typed secret into a variable is masked in the inspection, the debugger preview, the journal and runtime.json', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    capturedValue: SECRET,
    operations: {
      operations: [...PASSWORD_OPERATIONS],
      stopOperations: [1],
      controls: { ...PASSWORD_CONTROLS },
    },
  })
  const { run, insertedTexts } = harness
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the password operation',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  await run.stop()
  // Assert
  assert.deepEqual(insertedTexts, [SECRET])
  const view = JSON.stringify(run.view())
  assert.doesNotMatch(view, new RegExp(SECRET))
  assert.match(view, /\[masked\]/)
  const files = await readEvidenceText(run.view().artifactDirectory)
  assert.match(files, /runtime\.json|snapshot/)
  assert.doesNotMatch(files, new RegExp(SECRET))
})

// protects=ENG-4/DX-5: an exception message that quotes the typed secret is masked in the run's failures, its journal and its files; fails_when=the failure sentence, the journal or runtime.json keeps the secret; no_claim=a real page: the harness page quotes the secret in the reason of a failed value check
test('an exception message that quotes the typed secret is masked in the failure, the journal and the evidence files', async (context) => {
  // Arrange
  const { run } = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: [...PASSWORD_OPERATIONS],
      stopOperations: [1],
      controls: { ...PASSWORD_CONTROLS },
      failValueCheck: ['#password'],
      failValueCheckReason: `the control shows ${SECRET}`,
    },
  })
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop of the password operation',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'failed', 'the failed run')
  await run.stop()
  // Assert
  const view = run.view()
  assert.match(view.failures.join('\n'), /INPUT_NOT_ACCEPTED/)
  assert.doesNotMatch(JSON.stringify(view), new RegExp(SECRET))
  assert.doesNotMatch(
    await readEvidenceText(view.artifactDirectory),
    new RegExp(SECRET),
  )
})

// protects=ENG-4/DX-5: an Output line for an unexpected failure that quotes the typed secret is masked; fails_when=the line keeps the secret; no_claim=the real Output channel (the lines are collected by the control)
test('an Output line for an unexpected failure that quotes the typed secret is masked', async (context) => {
  // Arrange
  const lines: string[] = []
  const now = Date.now()
  const { run } = await configuredRuntimeHarness(
    context,
    {
      signal: new AbortController().signal,
      deadlineAt: now + 600_000,
      preparationDeadlineAt: now + 90_000,
      runId: 'run-1',
      outputLog: (line) => lines.push(line.text),
    },
    [],
    {
      operations: {
        operations: [...PASSWORD_OPERATIONS],
        stopOperations: [1],
        controls: { ...PASSWORD_CONTROLS },
        selectControlFailsWith: `lookup failed near ${SECRET}`,
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  await waitUntil(() => run.view().status === 'failed', 'the failed run')
  // Assert
  const output = lines.join('\n')
  assert.match(output, /unexpected failure: lookup failed near \[masked\]/)
  assert.doesNotMatch(output, new RegExp(SECRET))
})

// protects=ENG-4: Codebook never writes the parameters of a CDP Input command, so a debug-level run's Output holds neither the typed text nor an Input.insertText line; fails_when=an Output line or journal event carries the text or the command's parameters; no_claim=the real log level of the editor (the control collects every line the run writes at any level)
test('a run writes no CDP Input parameters and no typed text to the Output or the journal', async (context) => {
  // Arrange
  const lines: string[] = []
  const now = Date.now()
  const { run } = await configuredRuntimeHarness(
    context,
    {
      signal: new AbortController().signal,
      deadlineAt: now + 600_000,
      preparationDeadlineAt: now + 90_000,
      runId: 'run-1',
      outputLog: (line) => lines.push(line.text),
    },
    [],
    {
      operations: {
        operations: [...PASSWORD_OPERATIONS],
        stopOperations: [1],
        controls: { ...PASSWORD_CONTROLS },
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the stop',
  )
  await run.continue('browser', stop.pause)
  await waitUntil(() => run.view().status === 'completed', 'the result')
  // Assert
  const written = JSON.stringify({ lines, events: run.view().events })
  assert.doesNotMatch(written, new RegExp(SECRET))
  assert.doesNotMatch(written, /insertText/)
})

// protects=ENG-5: the engine arms the secret frame gate before the secret is typed, and a show-password toggle after the secret fails the run with SECRET_BECAME_VISIBLE and drops every later image; an untoggled run keeps its images; fails_when=the gate is not armed by the operation, a toggled frame passes, or an untoggled frame is dropped; no_claim=pixels and the real screencast (the gate verifies the page's control, the harness stands in for its observer)
test('the engine arms the frame gate for a secret operation: a show-password toggle drops later frames and fails the run, an untoggled run keeps recording', async (context) => {
  // Arrange
  const toggled = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: [...PASSWORD_OPERATIONS],
      stopOperations: [1],
      controls: { ...PASSWORD_CONTROLS },
    },
  })
  const untoggled = await configuredRuntimeHarness(context, undefined, [], {
    operations: {
      operations: [...PASSWORD_OPERATIONS],
      stopOperations: [1],
      controls: { ...PASSWORD_CONTROLS },
    },
  })
  await toggled.run.prepare()
  await untoggled.run.prepare()
  assert.equal(toggled.run.secretFrameGate.armed, false)
  // Act
  toggled.run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  untoggled.run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  await waitUntil(() => toggled.run.secretFrameGate.armed, 'the armed gate')
  await waitUntil(() => untoggled.run.secretFrameGate.armed, 'the armed gate')
  const beforeToggle = await toggled.run.secretFrameGate.admitFrame(Date.now())
  toggled.setSecretVisible(true)
  const afterToggle = await toggled.run.secretFrameGate.admitFrame(
    Date.now() + 10,
  )
  const untoggledFrame = await untoggled.run.secretFrameGate.admitFrame(
    Date.now(),
  )
  // Assert
  assert.equal(beforeToggle, 'pass')
  assert.equal(afterToggle, 'drop')
  assert.equal(untoggledFrame, 'pass')
  await waitUntil(
    () => toggled.run.view().status === 'failed',
    'the failed run after the toggle',
  )
  assert.match(toggled.run.view().failures.join('\n'), /SECRET_BECAME_VISIBLE/)
  assert.notEqual(untoggled.run.view().status, 'failed')
})

// protects=ENG-5: an ask-learner operation into a control that is no password control sends nothing and fails the run with SECRET_BECAME_VISIBLE; fails_when=the secret is typed into a control the browser draws in plain text; no_claim=the earlier classification refusals (engine tests)
test('a secret operation whose control is no password control types nothing when the gate cannot arm', async (context) => {
  // Arrange
  const { run, insertedTexts } = await configuredRuntimeHarness(
    context,
    undefined,
    [],
    {
      operations: {
        operations: [...PASSWORD_OPERATIONS],
        stopOperations: [1],
        // The engine reads a password control; the gate's observer finds a plain text control, as after a script swapped the node.
        controls: {
          '#password': {
            tagName: 'input',
            type: 'password',
            observedType: 'text',
          },
        },
      },
    },
  )
  await run.prepare()
  // Act
  run.action('op-1', OPERATION_ACTION, { learnerSecret: SECRET })
  await waitUntil(() => run.view().status === 'failed', 'the failed run')
  // Assert
  assert.deepEqual(insertedTexts, [])
  assert.match(run.view().failures.join('\n'), /SECRET_BECAME_VISIBLE/)
})

// protects=ENG-4/CEO-S6: the agent never reads a typed secret from an MCP tool answer or a resource read, whichever text carried it; fails_when=a tool result or the run resource quotes the secret; no_claim=the real run's failure (the controlled runtime fails with a sentence that quotes the secret)
test('an MCP tool answer and a run resource read hold no typed secret even when the failure quotes it', async (context) => {
  // Arrange
  const harness = await configuredServiceHarness(
    context,
    undefined,
    (directory, definition) =>
      new ControlledOperationsRuntime(directory, definition),
  )
  const { service, configuration, environment } = harness
  environment.askLearnerSecret = async () => SECRET
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'mask',
    configuration: {
      version: 3,
      adapter: configuration.adapter,
      book: configuration.book,
      source: configuration.source,
      participant: 'browser',
      afterOperation: 1,
      before: configuration.action.before,
      after: configuration.action.after,
      operations: [...PASSWORD_OPERATIONS],
      inspections: configuration.inspections,
    },
  })
  const record = service.record(receipt)
  await record.preparation
  const runtime = harness.runtimes[0]
  assert.ok(runtime instanceof ControlledOperationsRuntime)
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  runtime.failures.push(`Login rejected for ${SECRET}`)
  runtime.status = 'failed'
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'masking-test', version: '1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())
  // Act
  const resource = await client.callTool({
    name: 'codebook_read_resource',
    arguments: { uri: service.uri(record.id) },
  })
  const status = await client.callTool({
    name: 'codebook_status',
    arguments: {},
  })
  // Assert
  const answered = JSON.stringify({ resource, status })
  assert.doesNotMatch(answered, new RegExp(SECRET))
  assert.match(answered, /\[masked\]/)
})

// protects=ENG-4: a typed secret equal to a JSON token (true) leaves every MCP tool answer parseable with ok: true intact; fails_when=the secret is replaced inside the serialized JSON text, so the answer stops parsing or ok becomes [masked]; no_claim=a real run's failure (the controlled runtime holds the run)
test('a typed secret equal to a JSON token leaves tool answers parseable with ok true intact', async (context) => {
  // Arrange
  const harness = await configuredServiceHarness(
    context,
    undefined,
    (directory, definition) =>
      new ControlledOperationsRuntime(directory, definition),
  )
  const { service, configuration, environment } = harness
  environment.askLearnerSecret = async () => 'true'
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'mask-json',
    configuration: {
      version: 3,
      adapter: configuration.adapter,
      book: configuration.book,
      source: configuration.source,
      participant: 'browser',
      afterOperation: 1,
      before: configuration.action.before,
      after: configuration.action.after,
      operations: [...PASSWORD_OPERATIONS],
      inspections: configuration.inspections,
    },
  })
  const record = service.record(receipt)
  await record.preparation
  await service.performAction({
    ...receipt,
    key: 'op-1',
    action: OPERATION_ACTION,
  })
  const endpoint = await startServer(service)
  context.after(() => endpoint.close())
  const client = new Client({ name: 'masking-json-test', version: '1.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.descriptor.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
      },
    }),
  )
  context.after(() => client.close())
  // Act
  const status = await client.callTool({
    name: 'codebook_status',
    arguments: {},
  })
  const resource = await client.callTool({
    name: 'codebook_read_resource',
    arguments: { uri: service.uri(record.id) },
  })
  // Assert
  const texts = [status, resource].flatMap((result) =>
    (result.content as { type: string; text?: string }[])
      .filter((item) => item.type === 'text')
      .map((item) => item.text ?? ''),
  )
  assert.equal(texts.length, 2)
  assert.deepEqual(
    JSON.parse(texts[0] ?? ''),
    (status.structuredContent as { data?: unknown }).data,
  )
  assert.equal((status.structuredContent as { ok?: unknown }).ok, true)
  assert.equal(typeof JSON.parse(texts[1] ?? ''), 'object')
})

// protects=ENG-5 on a sign-in: after the secret was typed the click that logs in loads a new document, whose images pass because the control with the secret is gone, while an observer that is lost in the same document still fails the run; fails_when=a redirect after login fails the run with SECRET_BECAME_VISIBLE, or a lost observer in the same document passes; no_claim=a real navigation (the evaluate function stands in for the page and its document time origin)
test('the gate releases after a full navigation and still fails when the same document loses its observer', async () => {
  // Arrange
  const answerFor =
    (documentOrigin: number) =>
    async (expression: string): Promise<unknown> => {
      if (
        expression.includes('installSecretFrameObserver') ||
        expression.includes('(function')
      )
        return { ok: true, origin: 1 }
      if (expression === 'performance.timeOrigin') return documentOrigin
      return null
    }
  const redirected: string[] = []
  const redirectedGate = new SecretFrameGate({
    evaluate: answerFor(2),
    onFailure: (reason) => void redirected.push(reason),
  })
  const lost: string[] = []
  const lostGate = new SecretFrameGate({
    evaluate: answerFor(1),
    onFailure: (reason) => void lost.push(reason),
  })
  await redirectedGate.arm('#password')
  await lostGate.arm('#password')
  // Act
  // The first frame was captured before the replacement was noticed, so no observer verified it; the second one is captured after the release.
  const beforeRelease = await redirectedGate.admitFrame(Date.now())
  await new Promise((resolve) => setTimeout(resolve, 5))
  const afterRedirect = await redirectedGate.admitFrame(Date.now())
  const afterLoss = await lostGate.admitFrame(Date.now())
  // Assert
  assert.deepEqual(
    [beforeRelease, afterRedirect, redirected, redirectedGate.armed],
    ['drop', 'pass', [], false],
  )
  assert.deepEqual([afterLoss, lost], ['drop', ['observer-unanswered']])
})

// protects=ENG-4 disclosed limit (DX-5): a session token seeded in a signed-in-looking page is masked when its variable has a secret name, and an unknown-format token copied into an ordinarily named variable is not guaranteed masked; fails_when=a secret-named variable shows its value; no_claim=that an ordinary variable stays unmasked: the second half pins today's boundary the help discloses, it is not a goal
test('a secret-named variable holding a session token is masked and an ordinary variable holds the stated limit', async () => {
  // Arrange
  const token = 'plain-session-token-0123456789'
  const source = {
    name: 'src/app.js',
    text: 'const sessionToken = 1',
    hash: sha256('const sessionToken = 1'),
    line: 1,
  }
  // Act
  const snapshot = await captureReplayDebugSnapshot({
    stack: {
      stackFrames: [{ id: 1, name: 'handler', line: 1, column: 1 }],
      totalFrames: 1,
    },
    verifiedSource: source,
    request: async (command) =>
      command === 'scopes'
        ? {
            scopes: [
              {
                name: 'Local',
                presentationHint: 'locals',
                variablesReference: 10,
              },
            ],
          }
        : {
            variables: [
              {
                name: 'sessionToken',
                value: `'${token}'`,
                variablesReference: 0,
              },
              { name: 'ordinary', value: `'${token}'`, variablesReference: 0 },
            ],
          },
    assertCurrent: () => {},
  })
  // Assert
  const values = Object.fromEntries(
    snapshot.variables.map((variable) => [variable.name, variable.value]),
  )
  assert.equal(values.sessionToken, '[masked]')
  assert.equal(values.ordinary, `'${token}'`)
})

// protects=ENG-4: the deep mask hides a secret in strings and keys but leaves a sealed source record (text bound by a hash) whole; fails_when=a hash-bound source is rewritten so its seal breaks, or a secret in a string stays; no_claim=class instances, which the round trip turns into their JSON form
test('the data mask keeps a hash-bound source whole and masks every other string', () => {
  // Arrange
  const value = {
    failure: 'login failed for hunter2',
    source: { text: 'const hunter2 = 1', hash: 'abc' },
  }
  // Act
  const masked = maskLearnerSecretData(value, new Set(['hunter2']))
  // Assert
  assert.deepEqual(masked, {
    failure: 'login failed for [masked]',
    source: { text: 'const hunter2 = 1', hash: 'abc' },
  })
})
