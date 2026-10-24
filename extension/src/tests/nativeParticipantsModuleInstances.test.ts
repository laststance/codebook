import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readResource } from '../resources'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { StudyService } from '../service'

import { debuggerPausedEvent } from './utils/debuggerPausedEvent'
import { nativeParticipantsHarness } from './utils/nativeParticipantsHarness'

const pauseReady = async (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
) =>
  waitUntil(() => {
    const view = harness.run.view()
    if (view.failures.length) throw new Error(view.failures.join('; '))
    return view.participants.server?.snapshot
  }, 'server committed stop')

/** Reads the details of every journal entry of a type, as plain data. @example journaled(harness, 'stop.instance-refused') */
const journaled = (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
  type: string,
): unknown[] =>
  harness.run
    .view()
    .events.filter((event) => event.type === type)
    .map((event) => JSON.parse(JSON.stringify(event.detail)))

/** The script URL the harness's server module is sealed and announced under. */
const SERVER_MODULE_URL = 'webpack-internal:///(action-browser)/./src/mode.ts'

/**
 * A module as a server action build emits it: the source, a documented function over lines 4 to 8, and one more generated line, a registration call the build appends at the module's end and maps to the function's name at 4:23. The declared stop is on line 3, above the function.
 * Up to the function's end generated line n is source line n + 1; its first statement `return mode` is generated 6:2, source 7:3. Another layer's instance of it starts with one more generated line, so every generated line is one later there.
 */
const APPENDED_REGISTRATION_MODULE = {
  source:
    '/**\n * Authenticates.\n */\nexport async function authenticate(\n  mode,\n) {\n  return mode\n}\n',
  javascript:
    '/**\n * Authenticates.\n */\nexport async function authenticate(\n  mode,\n) {\n  return mode\n}\nregisterServerReference(authenticate)\n',
  mappings: ';;CAEC;OACM,eAAe;EACpB;AACF;EACE;AACF;AAJsB',
}

/** Lets the reads and journal writes that are already settled run, so a test announces the next script only after the run took the last one. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 3; turn++)
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
}

const hasEvent = (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
  type: string,
): boolean => harness.run.view().events.some((event) => event.type === type)

/** Sends the click and waits until the server runs, with the first declared pause held back. */
const startActionWithoutPause = async (
  harness: Awaited<ReturnType<typeof nativeParticipantsHarness>>,
): Promise<void> => {
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
}

// Value: protects=a server stop whose line runs in the module Next parsed for another webpack layer than the sealed one (the (middleware) copy of auth.config.ts) being captured as the stop (F435, native run 2 of cycle 0050); fails_when=a pause is accepted only in the one script that was sealed, so the declared stop times out waiting for a pause that already happened elsewhere; no_claim=that js-debug pauses in every layer's script, or that the real Next layers map this way (native trial)
test('a server stop is captured when its line runs in the module parsed for another webpack layer than the sealed one', async (context) => {
  // Arrange: the sealed module is the (action-browser) one; the (middleware) copy has an extra leading line, so its declared line is generated line 2.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.line, 1)
  assert.equal(server.source.column, 1)
  assert.equal(server.source.scriptId, 'middleware')
  assert.equal(
    server.source.scriptUrl,
    'webpack-internal:///(middleware)/./src/mode.ts',
  )
  assert.equal(harness.run.view().snapshots.length, 1)
})

// Value: protects=the recorded JavaScript and source map of a server stop captured in another webpack layer's instance of its module being that instance's own, so the run's historical source resources (`snapshots/<id>/source/javascript` and `…/map`) answer them and pass their hash check, and the run's evidence keeps the bytes those hashes name; fails_when=`source(item, snapshotId)` serves the sealed module's bundle, whose hashes differ from the snapshot's `javascriptHash` and `mapHash`, so the resource read fails with EvidenceIntegrityError, or the instance's code and map are not written beside the snapshot; why_new=F565 (hosted CodeRabbit on #121); why_changed=F569 (local CodeRabbit CLI): the resources are read as an agent reads them, not through `source()`; seam=a service stand-in for the run's record, with StudyService's own `uri` and `snapshot`; no_claim=that a real Next layer's instance differs from the sealed module in these bytes (native trial)
test('a server stop captured in another webpack layer’s module serves and keeps that module’s own JavaScript and source map', async (context) => {
  // Arrange: the (middleware) copy's text starts with "use strict", so its generated code and map differ from the sealed module's.
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  harness.pauseInScript('server', 'middleware', 1, 0)
  const server = await pauseReady(harness)
  const runId = '00000000-0000-4000-8000-000000000565'
  const record = {
    id: runId,
    profile: 'repository-browser',
    runtime: harness.run,
  }
  const service = {
    instanceId: 'instance',
    record: () => record,
    assertEvidenceReadable: () => {},
    uri: StudyService.prototype.uri,
    snapshot: StudyService.prototype.snapshot,
  } as unknown as StudyService
  const snapshotUri = `codebook://instance/runs/${runId}/snapshots/${encodeURIComponent(server.id)}`
  const textOf = (content: Awaited<ReturnType<typeof readResource>>) =>
    'text' in content ? content.text : ''
  const sha256 = (text: string) =>
    createHash('sha256').update(text).digest('hex')

  // Act
  const javascript = textOf(
    await readResource(service, `${snapshotUri}/source/javascript`),
  )
  const sourceMap = textOf(
    await readResource(service, `${snapshotUri}/source/map`),
  )
  const keptJavaScript = await readFile(
    join(harness.run.view().artifactDirectory, 'snapshot-server-1-module.js'),
    'utf8',
  )
  const keptMap = await readFile(
    join(
      harness.run.view().artifactDirectory,
      'snapshot-server-1-module.map.json',
    ),
    'utf8',
  )

  // Assert
  assert.equal(server.source.scriptId, 'middleware')
  assert.ok(javascript.startsWith('"use strict";\n'))
  assert.equal(sha256(javascript), server.source.javascriptHash)
  assert.equal(sha256(sourceMap), server.source.mapHash)
  assert.equal(keptJavaScript, javascript)
  assert.equal(keptMap, sourceMap)
})

// Value: protects=a stop registered before the executing layer's module loads still being captured when that module is parsed right before the pause, while its text is still being read; fails_when=a pause that arrives before the new script is accepted stays held as a foreign pause and the stop times out; no_claim=how long js-debug takes to pause after it parses a script
test('a server stop is captured when the other layer’s module is parsed in the instant before its pause', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  // Act: the module is parsed and the debugger pauses in it before the run has read its text.
  harness.announceModuleInAnotherLayer('server', 'rsc', 'rsc', ';AAAA')
  harness.pauseInScript('server', 'rsc', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.line, 1)
  assert.equal(server.source.scriptId, 'rsc')
  assert.equal(harness.run.view().snapshots.length, 1)
})

// Value: protects=a pause in another layer's module whose map retains a different original never being taken for the declared stop; fails_when=any script of the same address pattern is accepted without checking that its map maps onto the frozen original; no_claim=that the sealed module's own checks are enough for it
test('a pause in another layer’s module whose map retains another original is never captured as the stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
    'export var mode = "other";\n',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-refused'),
    'the foreign original refused',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
  assert.equal(hasEvent(harness, 'stop.instance-sealed'), false)
})

// Value: protects=a pause in another layer's module at a generated place its own map does not put on the declared line (here the unmapped leading line) being judged as a pause elsewhere and never committed as the stop; fails_when=the stop is accepted by the sealed map's coordinates (generated line 0 is the declared line there) while the pause is in the other script; no_claim=what the run reports for such a pause beyond refusing to commit it
test('a pause at an unmapped place of another layer’s module is never captured as the stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act: generated 0:0 is the leading line of the instance, which sits at the declared place only in the sealed module.
  harness.pauseInScript('server', 'middleware', 0, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
  assert.equal(harness.run.view().finalOutcome, 'not-demonstrated')
})

// Value: protects=a server stop above a function whose binding is judged at a pause in another layer's instance of the module being judged by the break locations of that script and by its own map, not by the sealed script's; fails_when=the pause is compared with the sealed script id and the sealed map (no place on the bound line is known, no break locations are asked of the instance, and the rule built for the sealed script's place stands), so the journal names the sealed generated place 7:3 instead of the instance's 8:3; why_new=F436 (OCR medium: pausedOnLine and the break locations read the sealed script for a pause in an instance); seam=announceScript for the sealed module, announceModuleInAnotherLayer with a map shifted by one generated line, listPossibleBreakLocations per script, announceBreakpointVerified and pauseInScript; no_claim=that js-debug lists break locations in every layer's script this way (native trial)
test('a server stop bound past the function head in another layer’s instance is judged by that instance’s break locations and its own generated places', async (context) => {
  // Arrange: the sealed module and the (middleware) instance are announced; the adapter's news verifies the stop at 7:3 and the runtime pauses at the instance's generated 7:2, one line later than the sealed 6:2.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: APPENDED_REGISTRATION_MODULE.mappings },
    fixture: {
      server: {
        source: APPENDED_REGISTRATION_MODULE.source,
        javascript: APPENDED_REGISTRATION_MODULE.javascript,
        citationEndLine: 8,
        declaredLine: 3,
      },
    },
  })
  harness.listPossibleBreakLocations('server', [
    { lineNumber: 6, columnNumber: 2 },
    { lineNumber: 8, columnNumber: 0 },
  ])
  harness.listPossibleBreakLocations(
    'server',
    [
      { lineNumber: 7, columnNumber: 2 },
      { lineNumber: 9, columnNumber: 0 },
    ],
    'middleware',
  )
  await harness.run.prepare()
  harness.holdFirstPause()
  harness.bindAt('server', 7, 3)
  harness.movePausedFrame(7, 3)
  harness.expireSourceBoundWait()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  harness.announceScript('server', 'server', SERVER_MODULE_URL)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    `;${APPENDED_REGISTRATION_MODULE.mappings}`,
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act
  harness.announceBreakpointVerified('server', 7, 3)
  harness.pauseInScript('server', 'middleware', 7, 2)
  const server = await pauseReady(harness)
  await harness.run.stop()
  // Assert
  assert.deepEqual(
    [server.source.line, server.source.column, server.source.scriptId],
    [7, 3, 'middleware'],
  )
  assert.equal(
    harness.breakLocationRequests.filter(
      (request) => request.start.scriptId === 'middleware',
    ).length,
    1,
  )
  assert.deepEqual(
    journaled(harness, 'breakpoint.rule-from-break-locations').at(-1),
    {
      participant: 'server',
      declared: { line: 3, column: 1 },
      boundLine: 7,
      breakLocationLines: [7],
      generatedPlaces: {
        requested: { line: 4, column: 2 },
        bound: { line: 8, column: 3 },
      },
    },
  )
})

// Value: protects=a changed script text of an accepted instance being refused at the capture, not trusted because the instance was accepted earlier; fails_when=the executed script of a pause in an instance is not compared with the instance's own sealed text, so a module rebuilt between the acceptance and the pause is captured as the stop; why_new=F437 (OCR medium: assertExecutedModuleSealed checks only the sealed script; verify in inspect is the instance's check); seam=announceModuleInAnotherLayer, changeScriptText (the runtime's text for the script changes after the run accepted it) and pauseInScript; no_claim=that a real runtime changes a script's text under one id
test('a pause in an accepted instance whose script text changed after its acceptance is refused at the capture', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  harness.changeScriptText('middleware')
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the capture refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.run.view().failures[0],
    'Error: Executed JavaScript differs from frozen module',
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=the journal of a long session of saves, where Next's HMR announces the module's script again with a new id for every save: the instance entries stay within their cap with the rest counted, only the newest script is the instance, and a pause in it is captured; fails_when=every announcement is journaled (the evidence budget fills and fails a healthy run) or an older script stays an instance; why_new=F438 (OCR medium: stop.module-parsed, stop.instance-sealed and stop.instance-refused had no cap and stop.instances was never pruned); seam=announceModuleInAnotherLayer called 120 times for one layer, scriptSourceReads, pauseInScript; no_claim=the evidence budget's own size
test('120 re-announcements of one layer’s module keep the instance journal within 100 entries and a pause in the newest script is captured', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  // Act: every save announces the module again with a new script id, and the run takes each before the next arrives.
  for (let save = 0; save < 120; save++) {
    harness.announceModuleInAnotherLayer(
      'server',
      `save-${save}`,
      'middleware',
      ';AAAA',
    )
    await waitUntil(
      () =>
        harness.scriptSourceReads.some(
          (read) => read.scriptId === `save-${save}`,
        ),
      `the run read save ${save}`,
    )
    await settle()
  }
  harness.pauseInScript('server', 'save-119', 1, 0)
  const server = await pauseReady(harness)
  await harness.run.stop()
  // Assert
  assert.equal(server.source.scriptId, 'save-119')
  assert.equal(journaled(harness, 'stop.instance-sealed').length, 100)
  assert.deepEqual(journaled(harness, 'stop.module-events-not-journaled'), [
    { count: 20, journalLimit: 100 },
  ])
})

// Value: protects=a script of the module that a newer script of the same address and layer replaced never being taken for the stop; fails_when=superseded scripts stay instances, so a pause in a dead script is captured as the stop; why_new=F438 (a newer script replaces the older instance); seam=announceModuleInAnotherLayer twice for one layer, pauseInScript in the older script; no_claim=that js-debug still pauses in a replaced script
test('a pause in a script that a newer script of the same address replaced is never captured as the stop', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'save-1',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 1,
    'the first script accepted',
  )
  harness.announceModuleInAnotherLayer(
    'server',
    'save-2',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 2,
    'the newer script accepted',
  )
  // Act
  harness.pauseInScript('server', 'save-1', 1, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=the one read of a script's text that every stop of its module shares; fails_when=each stop reads the same script again (two reads, two decodes) so a module with two declared stops costs a read per stop; why_new=F439 (OCR medium: bindParsedScript called adoptInstance once per stop); seam=the harness's scriptSourceReads with two server stops in one module; no_claim=that the two stops are told apart when both are bound at one place (the run refuses that elsewhere)
test('two declared stops in one module read the text of an announced instance once and each journals its acceptance', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server', 'server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 2,
    'both stops accepted the instance',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    harness.scriptSourceReads.filter((read) => read.scriptId === 'middleware')
      .length,
    1,
  )
})

// Value: protects=a run that ended while an instance's text was being read recording nothing and judging no pause afterwards; fails_when=the read's end journals the instance, or re-admits the pause held in it, after the run was cleaned up; why_new=F440 (OCR medium: adoptInstance checked the run only before the read); seam=holdScriptSourceRead (the read in flight), a pause held in the unread script, run.stop and the late release; no_claim=what the runtime does with a read nobody waits for
test('a run that ends while an instance’s text is being read records no instance and judges no pause when the read returns', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  const read = harness.holdScriptSourceRead('server', 'middleware')
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => harness.scriptSourceReads.length > 0,
    'the read is in flight',
  )
  harness.pauseInScript('server', 'middleware', 1, 0)
  // Act
  await harness.run.stop()
  read.release()
  await settle()
  // Assert
  assert.equal(journaled(harness, 'stop.instance-sealed').length, 0)
  assert.equal(journaled(harness, 'stop.instance-refused').length, 0)
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a pause held in a script whose text was not read yet when the wait for the stop's pause ended failing with a sentence that names that script, instead of the bare timeout; fails_when=the failure says only "Timed out waiting for source-bound CDP stop", so the agent cannot tell the line ran in another layer's copy; why_new=F440 (a held pause fails with a sentence naming the unread instance); seam=holdScriptSourceRead never released, pauseInScript, expireSourceBoundWait; no_claim=the sentence's wording beyond naming the script and its address
test('a pause in a script whose text was not read when the wait ended fails naming that script and its address', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.holdScriptSourceRead('server', 'middleware')
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /^Error: Declared stop src\/mode\.ts:1 paused at .* in script middleware \(webpack-internal:\/\/\/\(middleware\)\/\.\/src\/mode\.ts\), another webpack layer's copy of its module that Codebook could not use: its text had not been read yet\. That pause is no observation of this stop; start a new run$/,
  )
})

// Value: protects=a read of an instance's text that the runtime never answers being bounded and reported: the refusal is journaled with the timeout as its reason and a pause held in that script fails naming it; fails_when=the read has no deadline, so the stop waits for its own bound and nothing says that the instance's text was never read; why_new=F440 (the read is bounded, its expiry journaled as a refusal reason); seam=holdScriptSourceRead never released (a 2 s real read bound), holdSourceBoundWait, pauseInScript; no_claim=the length of the read bound
test('a read of an instance’s text that never answers is journaled as refused with the timeout and the held pause fails naming it', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  const wait = harness.holdSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.holdScriptSourceRead('server', 'middleware')
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  harness.pauseInScript('server', 'middleware', 1, 0)
  // Act
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-refused'),
    'the unanswered read refused',
  )
  wait.release()
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.deepEqual(
    journaled(harness, 'stop.instance-refused').map(
      (entry) => (entry as { reason: string }).reason,
    ),
    ['Timed out waiting for the text of script middleware'],
  )
  assert.match(
    harness.run.view().failures[0]!,
    /could not use: Timed out waiting for the text of script middleware\. That pause is no observation of this stop; start a new run$/,
  )
})

// Value: protects=the journal of a refused instance holding the cut, path-free cause and not a raw error; fails_when=the reason is String(error): an absolute path of the learner's home and a long message are journaled whole; why_new=F442 (OCR low, security: stop.instance-refused recorded String(error)); seam=failScriptSourceRead with an error that names a path under the home directory and is 700 characters long; no_claim=the wording of any real runtime's error
test('a refused instance journals its cause without the home directory and cut to 300 characters', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  harness.failScriptSourceRead(
    'server',
    'middleware',
    `Cannot read '${homedir()}/private/notes.txt': ${'x'.repeat(700)}`,
  )
  // Act
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-refused'),
    'the failing read refused',
  )
  await harness.run.stop()
  // Assert
  const [refused] = journaled(harness, 'stop.instance-refused') as {
    reason: string
  }[]
  assert.equal(
    refused!.reason.startsWith("Cannot read '~/private/notes.txt': xxx"),
    true,
  )
  assert.equal(refused!.reason.includes(homedir()), false)
  assert.equal(Array.from(refused!.reason).length, 300)
  assert.equal(refused!.reason.endsWith('… [cut]'), true)
})

// Value: protects=a pause in another layer's instance at a place the instance's own map puts on another line than the declared one never being captured as the stop; fails_when=the pause is judged by the sealed map's coordinates or by line-agnostic rules, so the pause is admitted as the stop on arrival instead of being held until the wait ends; why_new=F445 (a pause in an instance at a mapped but wrong line); seam=announceModuleInAnotherLayer with a map that puts generated line 3 on source line 2, pauseInScript there; no_claim=what the run reports for such a pause beyond refusing to commit it
test('a pause in another layer’s instance at a place its map puts on another line is held and never captured as the stop', async (context) => {
  // Arrange: the instance maps its generated line 2 to source line 1 and its generated line 3 to source line 2.
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA;AACA',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 2, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.equal(harness.run.view().snapshots.length, 0)
  // The pause was held for the wait and taken only when it ended, then refused by the frame check; a pause admitted as the stop on arrival would leave no such entry.
  assert.equal(journaled(harness, 'cdp.held-pause-adopted').length, 1)
  assert.deepEqual(
    [...harness.run.view().failures],
    ['Error: Generated location does not match exact DAP source position'],
  )
})

// Value: protects=a script of another layer whose text names another script address being refused with that reason and never taking a pause; fails_when=the address in the announcement is trusted without the address in the text, so a script that is another module's text becomes an instance; why_new=F445 (an instance whose sourceURL names another address); seam=announceModuleInAnotherLayer with a sourceURL of another module (shape.sourceUrl); no_claim=that the runtime announces mismatched addresses in practice
test('a script of another layer whose text names another address is refused and a pause in it is never captured', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.expireSourceBoundWait()
  await startActionWithoutPause(harness)
  // Act
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
    undefined,
    { sourceUrl: 'webpack-internal:///(middleware)/./src/other.ts' },
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-refused'),
    'the other address refused',
  )
  harness.pauseInScript('server', 'middleware', 1, 0)
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.deepEqual(
    journaled(harness, 'stop.instance-refused').map(
      (entry) => (entry as { reason: string }).reason,
    ),
    ['The script text names another address'],
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=Next's `[module]` placeholder line before the effective sourceURL not preventing an instance from being accepted; fails_when=the instance's text with Next's two sourceURL lines is read as ambiguous and refused, so the layer is never an instance; why_new=F445 (the harness modelled no `[module]` placeholder line); seam=announceModuleInAnotherLayer with shape.modulePlaceholder; no_claim=that every Next version emits this placeholder
test('an instance whose text carries Next’s [module] sourceURL placeholder before the effective address is accepted and its pause captured', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
    undefined,
    { modulePlaceholder: true },
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  // Act
  harness.pauseInScript('server', 'middleware', 1, 0)
  const server = await pauseReady(harness)
  // Assert
  assert.equal(server.source.scriptId, 'middleware')
})

// Value: protects=a pause that arrived in a script before the run read it, when the script is then refused, staying held and failing naming the refusal; fails_when=the held pause is captured although its script was refused, or fails with the bare timeout; why_new=F445 (a pause before an adoption that is then refused); seam=holdScriptSourceRead released after the pause, an instance whose map retains another original, holdSourceBoundWait; no_claim=the sentence's wording beyond naming the refusal
test('a pause held in a script that is then refused as another original stays held and fails naming the refusal', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  const wait = harness.holdSourceBoundWait()
  await startActionWithoutPause(harness)
  const read = harness.holdScriptSourceRead('server', 'middleware')
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
    'export var mode = "other";\n',
  )
  harness.pauseInScript('server', 'middleware', 1, 0)
  // Act
  read.release()
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-refused'),
    'the foreign original refused',
  )
  wait.release()
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the pause refused',
  )
  await harness.run.stop()
  // Assert
  assert.match(
    harness.run.view().failures[0]!,
    /could not use: Map original differs from frozen source\. That pause is no observation of this stop; start a new run$/,
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=a pause that is not the stop's, held before its instance was accepted and judged again at the acceptance, keeping the time since it was first held; fails_when=the pause's hold time restarts at the acceptance, so a pause that outlasted the adapter's bound is taken for one the adapter resumed in time; why_new=F445 (a held pause that is not the stop's keeps its hold time); seam=manualClock advanced while the read is held, holdScriptSourceRead, a pause at a place the instance maps to another line, emitResume; no_claim=the length of the adapter's bound
test('a pause held in an instance that is not the stop’s keeps its hold time through the instance’s acceptance', async (context) => {
  // Arrange: the instance maps generated line 3 to source line 2, which is not the declared line.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    manualClock: true,
  })
  await startActionWithoutPause(harness)
  const read = harness.holdScriptSourceRead('server', 'middleware')
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA;AACA',
  )
  harness.pauseInScript('server', 'middleware', 2, 0)
  // Act: 3.5 s pass while the text is unread, then the instance is accepted and the pause is judged again and resumed.
  harness.advance(3_500)
  read.release()
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  harness.emitResume('server')
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the late resume ended the run',
  )
  await harness.run.stop()
  // Assert
  assert.equal(
    journaled(harness, 'cdp.unannounced-pause-resumed-late').length,
    1,
  )
})

// Value: protects=a stop that is bound at the second statement of its line being judged, for a pause in another layer's instance, at the column that instance's own map gives that statement: the genuine pause is the stop's and a pause on the other statement of the line is not; fails_when=the pause's column is compared with the column the sealed map gave (12), so the genuine pause in the instance (original column 5) is refused as another statement; why_new=F441 (OCR low: isPauseOfStop compared a pause in an instance with stop.bound, a column bound in one script); seam=isPauseOfStop and the stop's bound place read through the run's private members, an instance whose map puts the statement at column 5 where the sealed map puts it at column 12; no_claim=that a server stop's binding is known before its first pause (it is read at the pause)
test('a pause in an instance is the stop’s at the column that instance’s map gives the bound statement and not at the other statement of the line', async (context) => {
  // Arrange: the sealed map puts the statements of line 1 at columns 1 and 12; the instance's puts them at 1 and 5. The stop is bound at 1:12.
  const harness = await nativeParticipantsHarness(context, ['server'], {
    mappings: { server: 'AAAA,WAAW' },
  })
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA,WAAI',
  )
  await waitUntil(
    () => hasEvent(harness, 'stop.instance-sealed'),
    'the other layer accepted as an instance of the module',
  )
  const stop = harness.run['stops'][0]!
  stop.bound = { line: 1, column: 12 }
  const pauseIn = (columnNumber: number) =>
    debuggerPausedEvent({
      callFrameId: 'frame',
      scriptId: 'middleware',
      lineNumber: 1,
      columnNumber,
      hitBreakpoints: ['native'],
    }) as never
  // Act
  const genuine = harness.run['isPauseOfStop'](pauseIn(11), stop)
  const otherStatement = harness.run['isPauseOfStop'](pauseIn(0), stop)
  // Assert
  assert.deepEqual([genuine, otherStatement], [true, false])
})

// Value: protects=a pause held in an accepted instance being judged by that instance's own map and text after a newer script of the same address (HMR) is sealed, until the pause is gone; fails_when=the older instance is deleted at once, so the held pause falls back to the sealed module and the run fails with another sentence (a sealed-map line judgement, "differs from its sealed bundle", or a bare timeout); why_new=F460 (OCR medium of the review of 6bc9eab2..ef03b741: F438's replacement ignores a held pause); seam=announceModuleInAnotherLayer twice for one layer, pauseInScript at a place the first instance maps to another line, holdSourceBoundWait; no_claim=that js-debug pauses in a replaced script after HMR
test('a pause held in an instance is still judged by that instance when a newer script of the same address is sealed', async (context) => {
  // Arrange: the first instance maps its generated line 3 to source line 2, which is not the declared line.
  const harness = await nativeParticipantsHarness(context, ['server'])
  const wait = harness.holdSourceBoundWait()
  await startActionWithoutPause(harness)
  harness.announceModuleInAnotherLayer(
    'server',
    'save-1',
    'middleware',
    ';AAAA;AACA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 1,
    'the first script accepted',
  )
  harness.pauseInScript('server', 'save-1', 2, 0)
  await settle()
  // Act: HMR seals a newer script of the same address while the pause is held, then the wait for the stop's own pause ends.
  harness.announceModuleInAnotherLayer(
    'server',
    'save-2',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 2,
    'the newer script accepted',
  )
  wait.release()
  await waitUntil(
    () => harness.run.view().status === 'failed',
    'the held pause refused',
  )
  await harness.run.stop()
  // Assert: judged by the first instance's own map, as when no HMR happened.
  assert.deepEqual(
    [...harness.run.view().failures],
    ['Error: Generated location does not match exact DAP source position'],
  )
  assert.equal(harness.run.view().snapshots.length, 0)
})

// Value: protects=the first instance sealing of each script address of a stop being journaled although HMR churn of another layer's module used up the cap of stop.instance-sealed entries; fails_when=the cap counts every sealing of the run, so the evidence (the instance's hashes) of a layer first sealed late is left out; why_new=F467 (OCR low of the review of 6bc9eab2..ef03b741: the cap is per event type for the whole run); seam=announceModuleInAnotherLayer 110 times for the middleware layer then once for the rsc layer; no_claim=the evidence budget's own size
test('HMR churn of one layer’s module does not keep the first sealing of another layer out of the journal', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )
  // Act: 110 saves, more than the cap of 100 entries.
  for (let save = 0; save < 110; save++) {
    harness.announceModuleInAnotherLayer(
      'server',
      `save-${save}`,
      'middleware',
      ';AAAA',
    )
    await waitUntil(
      () =>
        harness.scriptSourceReads.some(
          (read) => read.scriptId === `save-${save}`,
        ),
      `the run read save ${save}`,
    )
    await settle()
  }
  harness.announceModuleInAnotherLayer('server', 'first-rsc', 'rsc', ';AAAA')
  await waitUntil(
    () =>
      journaled(harness, 'stop.instance-sealed').filter(
        (entry) => (entry as { scriptId: string }).scriptId === 'first-rsc',
      ).length === 1,
    'the other layer’s first sealing journaled',
  )
  await harness.run.stop()
  // Assert
  assert.equal(journaled(harness, 'stop.instance-sealed').length, 101)
  assert.deepEqual(journaled(harness, 'stop.module-events-not-journaled'), [
    { count: 10, journalLimit: 100 },
  ])
})

// Value: protects=the journal staying bounded when the script address of a module changes with every rebuild (a chunk id or layer per save), whose first entry of each address is always journaled; fails_when=every new address adds one journal entry without a ceiling, so a long session of saves fills the evidence budget; why_new=F473 (OCR low/medium of the review of ef03b741..ccfe301d: F467's first entries are keyed by the address and unbounded); seam=announceModuleInAnotherLayer for 180 different layers, one script each; no_claim=the evidence budget's own size
test('180 different script addresses of one module keep the instance journal at 150 entries with the rest counted', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server'])
  await startActionWithoutPause(harness)
  // Act: every save announces the module under an address of its own, and the run takes each before the next arrives.
  for (let save = 0; save < 180; save++) {
    harness.announceModuleInAnotherLayer(
      'server',
      `save-${save}`,
      `layer${save}`,
      ';AAAA',
    )
    await waitUntil(
      () =>
        harness.scriptSourceReads.some(
          (read) => read.scriptId === `save-${save}`,
        ),
      `the run read save ${save}`,
    )
    await settle()
  }
  await harness.run.stop()
  // Assert: 100 up to the cap, 50 more as first entries of their address, 30 only counted.
  assert.equal(journaled(harness, 'stop.instance-sealed').length, 150)
  assert.deepEqual(journaled(harness, 'stop.module-events-not-journaled'), [
    { count: 30, journalLimit: 100 },
  ])
})

// Value: protects=an older script's read ending after a newer script of the same address was accepted not removing that newer script from the stop's instances; fails_when=the older read's end forgets every script of the address that holds no pause, so the newer accepted script is gone and a later pause in it cannot be judged by its map; why_new=F476 (CodeRabbit CLI minor of the review of ef03b741..ccfe301d: F460 keeps the older script while a pause is held in it); seam=holdScriptSourceRead on the older script, a pause held in it at a place its map puts on another line, a newer script of the same layer accepted first, the stop's instances read through the run's private members; no_claim=what the run does with a pause in the newer script afterwards
test('an older script’s read that ends after a newer script of the same address was accepted keeps the newer script an instance', async (context) => {
  // Arrange: the older script maps its generated line 3 to source line 2, and a pause is held in it while its text is read.
  const harness = await nativeParticipantsHarness(context, ['server'])
  harness.holdSourceBoundWait()
  await startActionWithoutPause(harness)
  const olderRead = harness.holdScriptSourceRead('server', 'save-1')
  harness.announceModuleInAnotherLayer(
    'server',
    'save-1',
    'middleware',
    ';AAAA;AACA',
  )
  harness.pauseInScript('server', 'save-1', 2, 0)
  await settle()
  // Act: the newer script of the address is accepted first, then the older read ends.
  harness.announceModuleInAnotherLayer(
    'server',
    'save-2',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 1,
    'the newer script accepted',
  )
  olderRead.release()
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 2,
    'the older script accepted',
  )
  // Assert
  const instances = [...harness.run['stops'][0]!.instances.keys()].sort()
  assert.deepEqual(instances, ['save-1', 'save-2'])
})

// Value: protects=a script announced once keeping one announcement order however many declared stops share its module, and the orders ending with the run (F483); fails_when=each stop's adoption overwrites the script's order with a newer count, so an older script can look newer than a later one, or the orders stay held after the run was cleaned up; why_new=F483 (CodeRabbit CLI/OCR low of the review of ccfe301d..c9664ea3: F476's orders were overwritten per stop and removed only by a same-address script); seam=two declared stops in one module, announceModuleInAnotherLayer, and the run's private announcement map; no_claim=the orders of scripts of other modules
test('two declared stops in one module keep one announcement order for the script, and the orders end with the run', async (context) => {
  // Arrange
  const harness = await nativeParticipantsHarness(context, ['server', 'server'])
  await harness.run.prepare()
  harness.run.action('once', 'repository-click')
  await waitUntil(
    () => harness.run.view().operation?.inputDispatched,
    'input sent',
  )

  // Act
  harness.announceModuleInAnotherLayer(
    'server',
    'middleware',
    'middleware',
    ';AAAA',
  )
  await waitUntil(
    () => journaled(harness, 'stop.instance-sealed').length === 2,
    'both stops accepted the instance',
  )
  const ordersWhileRunning = [...harness.run['scriptAnnouncements']]
  await harness.run.stop()

  // Assert
  assert.equal(JSON.stringify(ordersWhileRunning), '[["server:middleware",1]]')
  assert.equal(harness.run['scriptAnnouncements'].size, 0)
})
