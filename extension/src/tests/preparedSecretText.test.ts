import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'
import { assertStudyCheckpoint } from '../utils/assertStudyCheckpoint'
import { captureStudy } from '../utils/captureStudy'
import { preparedInputsOf } from '../utils/preparedInputsOf'

import { configuredRuntimeHarness } from './utils/configuredRuntimeHarness'
import { readEvidenceText } from './utils/readEvidenceText'

const PASSWORD = 'hunter2-prepared-password'
const EMAIL = 'learner@example.invalid'

/** Runs a repository-browser study with a password and an email prepared, on the controlled runtime, until its first stop is committed. */
async function pausedPreparedRun(context: TestContext) {
  let service: StudyService | undefined, books: RepositoryBookStore | undefined
  context.after(async () => {
    await service?.shutdown()
    books?.dispose()
  })
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    initialInputs: [
      { selector: '#email', text: EMAIL },
      { selector: '#password', text: PASSWORD },
    ],
    preparedControls: {
      '#email': { type: 'email', name: 'email' },
      '#password': { type: 'password', name: 'password' },
    },
  })
  const library = new LearningLibrary(
    join(harness.directory, '.learning'),
    '0'.repeat(64),
  )
  books = new RepositoryBookStore(harness.sources, library)
  await books.publish({
    bookId: 'interface',
    expectedRevision: 0,
    key: 'article',
    document: {
      title: 'Interface',
      summary: 'Two citations.',
      nodes: [
        {
          id: 'theme',
          title: 'Theme',
          sections: [{ title: 'Theme', text: 'Source-derived explanation.' }],
          anchors: harness.definition.descriptor.anchors,
          observations: [],
        },
      ],
      edges: [],
    },
  })
  service = new StudyService(
    {
      workspace: harness.directory,
      host: {
        id: 'vscode',
        productVersion: 'test',
        apiVersion: 'test',
        commit: 'test',
      },
      build: {
        revision: 'controlled-runtime',
        dirty: false,
        sourceHash: '0'.repeat(64),
      },
      prerequisites: async () => ({ ready: true, missing: [] }),
      createRuntime: async () => harness.run,
    },
    join(harness.directory, '.service'),
  )
  service.repository = books
  const receipt = service.start({
    instanceId: service.instanceId,
    profile: 'repository-browser',
    key: 'prepared',
    configuration: harness.definition.configuration,
  })
  const record = service.record(receipt)
  await record.preparation
  service.action({ ...receipt, key: 'one', action: 'repository-click' })
  await waitUntil(
    () => harness.run.view().snapshots.length === 1,
    'committed first stop',
  )
  return { service, record, receipt, library, harness }
}

// protects=a prepared password is absent in plain form from the manifest resource, runtime.json, the evidence journal, the run resource and the saved study while the page still receives it; fails_when=any stored or served form keeps the declared password; no_claim=the recording context is derived from the saved study and is not built here; the page, debugger and renderer are the controlled runtime's stand-ins
test('a prepared password is masked in every stored and served form while the page receives it', async (context) => {
  // Arrange
  const { service, record, library, harness } = await pausedPreparedRun(context)
  // Act
  const manifest = await readResource(
    service,
    service.uri(record.id, 'manifest'),
  )
  const archive = await captureStudy(service, record, library.workspaceKey)
  const journal = await readEvidenceText(harness.run.view().artifactDirectory)
  const runResource = JSON.stringify(service.state(record))
  // Assert
  assert.deepEqual(harness.insertedTexts, [EMAIL, PASSWORD])
  assert.ok(archive)
  assert.ok('text' in manifest)
  // The search is meaningful only when the journal holds the run's files.
  assert.ok(journal.length > 0)
  for (const [name, text] of [
    ['manifest resource', manifest.text],
    ['saved study', JSON.stringify(archive)],
    ['evidence journal and runtime.json', journal],
    ['run resource', runResource],
  ] as const)
    assert.equal(text.includes(PASSWORD), false, `${name} holds the password`)
  assert.deepEqual(preparedInputsOf(archive.configuration), [
    { selector: '#email', text: EMAIL },
    { selector: '#password', text: '[masked]' },
  ])
})

// protects=the configuration hash is the existing hash over the canonical redacted configuration, and the start, save, continue, re-save sequence keeps the checkpoint invariants; fails_when=the saved study hashes the declared password, or a later save changes the configuration after the first; no_claim=restart and reopen from disk is the learning library's own test; the runtime is the controlled stand-in
test('the saved study hash covers the redacted configuration and survives continue and a second save', async (context) => {
  // Arrange
  const { service, record, receipt, library, harness } =
    await pausedPreparedRun(context)
  const expectedCanonical = {
    ...harness.definition.configuration,
    initialInputs: [
      { selector: '#email', text: EMAIL },
      { selector: '#password', text: '[masked]' },
    ],
  }
  const first = await captureStudy(service, record, library.workspaceKey)
  assert.ok(first)
  // Act
  await service.continue(
    service.state(record).participants.browser.continueArguments!,
  )
  await service.stop(receipt)
  const second = await captureStudy(service, record, library.workspaceKey)
  // Assert
  assert.ok(second)
  assert.equal(
    first.configurationHash,
    sha256(JSON.stringify(expectedCanonical)),
  )
  assert.equal(second.configurationHash, first.configurationHash)
  assert.equal(service.state(record).configurationHash, first.configurationHash)
  assert.doesNotThrow(() => assertStudyCheckpoint(first, second))
})

// protects=before a prepared text's control is resolved the run resource shows [pending] and never the text, and a secret one is masked as soon as it is resolved; fails_when=the view shows the declared text before apply or stores [pending] in the hashed form; no_claim=the controlled stand-in holds the insert open, so the timing of a real page is not shown
test('a prepared text reads [pending] in the run view until its control is resolved', async (context) => {
  // Arrange
  const harness = await configuredRuntimeHarness(context, undefined, [], {
    initialInputs: [
      { selector: '#password', text: PASSWORD },
      { selector: '#email', text: EMAIL },
    ],
    preparedControls: {
      '#password': { type: 'password' },
      '#email': { type: 'email' },
    },
    holdInputInsert: true,
  })
  // Act
  void harness.run.prepare().catch(() => undefined)
  await waitUntil(
    () => harness.insertedTexts.length === 1,
    'the first prepared text sent',
  )
  const view = harness.run.view()
  // Assert
  assert.deepEqual(preparedInputsOf(view.definition.configuration), [
    { selector: '#password', text: '[masked]' },
    { selector: '#email', text: '[pending]' },
  ])
  assert.equal(JSON.stringify(view).includes(PASSWORD), false)
  assert.equal(JSON.stringify(view).includes(EMAIL), false)
  assert.deepEqual([...(view.preparedTextStates ?? [])], ['secret'])
})

// protects=ENG-3: a checkpoint saved while a prepared text was still unresolved keeps that text masked in every later checkpoint, so the library accepts the later checkpoints and the final save; fails_when=the text is classified plain afterwards and the stored configuration and its hash change, so the library refuses with "Configured study intent changed after acceptance."; no_claim=a real preparation (the run's view reports the unresolved states for the first capture, then the real ones)
test('a checkpoint taken before a prepared text is classified plain keeps the saved configuration unchanged for the final save', async (context) => {
  // Arrange
  const { service, record, receipt, library, harness } =
    await pausedPreparedRun(context)
  const realView = harness.run.view.bind(harness.run)
  let stillPreparing = true
  harness.run.view = () => ({
    ...realView(),
    preparedTextStates: stillPreparing ? [] : realView().preparedTextStates,
  })
  const whilePreparing = await captureStudy(
    service,
    record,
    library.workspaceKey,
  )
  assert.ok(whilePreparing)
  await library.saveStudy(whilePreparing)
  stillPreparing = false
  // Act
  await service.continue(
    service.state(record).participants.browser.continueArguments!,
  )
  await service.stop(receipt)
  const afterClassified = await captureStudy(
    service,
    record,
    library.workspaceKey,
  )
  assert.ok(afterClassified)
  await library.saveStudy(afterClassified)
  // Assert
  assert.deepEqual(preparedInputsOf(afterClassified.configuration), [
    { selector: '#email', text: '[masked]' },
    { selector: '#password', text: '[masked]' },
  ])
  assert.equal(
    afterClassified.configurationHash,
    whilePreparing.configurationHash,
  )
})

/** A version 2 run with one prepared control, on the controlled runtime. */
function preparedControlRun(
  context: TestContext,
  input: { text: string; type: string; name: string },
) {
  return configuredRuntimeHarness(context, undefined, [], {
    capturedValue: input.text,
    initialInputs: [{ selector: '#field', text: input.text }],
    preparedControls: { '#field': { type: input.type, name: input.name } },
  })
}

// protects=ENG-5: a version 2 prepared password arms the frame gate before it is typed, so a page that shows it afterwards (type toggled to text) drops later frames and fails the run with SECRET_BECAME_VISIBLE; fails_when=the gate stays unarmed for prepared text and the frames of a visible password are stored; no_claim=pixels and a real page: the harness stands in for the gate's observer
test('a prepared password that the page shows after it is typed drops later frames and fails the run', async (context) => {
  // Arrange
  const { run, insertedTexts, setSecretVisible } = await preparedControlRun(
    context,
    { text: PASSWORD, type: 'password', name: 'password' },
  )
  // Act
  await run.prepare()
  const armedAfterPrepare = run.secretFrameGate.armed
  setSecretVisible(true)
  const frame = await run.secretFrameGate.admitFrame(Date.now() + 10)
  await waitUntil(() => run.view().status === 'failed', 'the failed run')
  // Assert
  assert.deepEqual(insertedTexts, [PASSWORD])
  assert.equal(armedAfterPrepare, true)
  assert.equal(frame, 'drop')
  assert.match(run.view().failures.join('\n'), /SECRET_BECAME_VISIBLE/)
})

// protects=ENG-5: a version 2 run whose prepared text is plain never arms the frame gate; fails_when=ordinary prepared text arms the gate and drops frames; no_claim=a real page
test('a prepared plain text leaves the frame gate unarmed', async (context) => {
  // Arrange
  const { run, insertedTexts } = await preparedControlRun(context, {
    text: EMAIL,
    type: 'email',
    name: 'email',
  })
  // Act
  await run.prepare()
  // Assert
  assert.deepEqual(insertedTexts, [EMAIL])
  assert.equal(run.secretFrameGate.armed, false)
  assert.equal(await run.secretFrameGate.admitFrame(Date.now()), 'pass')
})

// protects=AC4: a version 2 secret text into a secret-named control the browser draws as typed (type text, name token) runs as in 0.2.70.0: the page receives it, it is masked by state, and the frame gate stays unarmed instead of failing the run; fails_when=the gate arms for a non-password control and the run fails with SECRET_BECAME_VISIBLE, or the text is not sent; no_claim=pixels: the browser draws this text as typed, which help and README state; the harness stands in for the page
test('a prepared secret text into a plain secret-named control is sent and masked without arming the frame gate', async (context) => {
  // Arrange
  const { run, insertedTexts } = await preparedControlRun(context, {
    text: 'token-value-1234',
    type: 'text',
    name: 'token',
  })
  // Act
  await run.prepare()
  // Assert
  assert.deepEqual(insertedTexts, ['token-value-1234'])
  assert.equal(run.secretFrameGate.armed, false)
  assert.equal(run.view().failures.length, 0)
  assert.equal(run.learnerSecrets.has('token-value-1234'), true)
})

// protects=a prepared password too short to tell from page text is refused before it is typed, so no copy of it can reach the recorded frames; fails_when=the short value is typed (armed by control only) or the run does not fail with SECRET_INPUT_VISIBLE or the value shows in the run view; no_claim=a real page: the harness stands in for the insertion and the gate's observer
test('a three-character prepared password is refused before it is typed', async (context) => {
  // Arrange
  const { run, insertedTexts } = await preparedControlRun(context, {
    text: 'abc',
    type: 'password',
    name: 'password',
  })
  // Act
  const refusal = await run.prepare().then(
    () => undefined,
    (error: unknown) => String(error),
  )
  // Assert
  assert.deepEqual(insertedTexts, [])
  assert.match(
    refusal ?? '',
    /SECRET_INPUT_VISIBLE: The prepared text for #field was not sent: a secret shorter than 4 characters cannot be told from page text/,
  )
  assert.equal(JSON.stringify(run.view()).includes('abc'), false)
})

// protects=a four-character prepared password is typed and watched by value, the shortest length the gate can tell from page text; fails_when=the minimum is raised so it is refused, or the value is typed without arming the gate or joining the secret set; no_claim=a real page: the harness stands in for the insertion and the gate's observer
test('a four-character prepared password is typed and watched by value', async (context) => {
  // Arrange
  const { run, insertedTexts } = await preparedControlRun(context, {
    text: 'abcd',
    type: 'password',
    name: 'password',
  })
  // Act
  await run.prepare()
  // Assert
  assert.deepEqual(insertedTexts, ['abcd'])
  assert.equal(run.secretFrameGate.armed, true)
  assert.equal(run.learnerSecrets.has('abcd'), true)
  assert.equal(run.view().failures.length, 0)
})

// protects=ENG-4: a prepared password's copy in an inspection preview reads [masked]; fails_when=the prepared value is missing from the run's secret set; no_claim=a real debugger: the harness's stop local variable holds the copy
test('a prepared password copied into a variable reads [masked] in the run view', async (context) => {
  // Arrange
  const { run } = await preparedControlRun(context, {
    text: PASSWORD,
    type: 'password',
    name: 'password',
  })
  await run.prepare()
  // Act
  run.action('one', 'repository-click')
  const stop = await waitUntil(
    () => run.view().participants.browser.snapshot,
    'the first stop',
  )
  // Assert
  assert.ok(stop)
  assert.equal(run.learnerSecrets.has(PASSWORD), true)
  assert.equal(JSON.stringify(run.view()).includes(PASSWORD), false)
  assert.match(JSON.stringify(run.view()), /\[masked\]/)
})
