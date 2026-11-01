import assert from 'node:assert/strict'
import { before, test, type TestContext } from 'node:test'

import { ChromeExtensionLearningSave } from '../chromeExtensionLearningSave'
import { describeExtensionLearningSave } from '../utils/describeExtensionLearningSave'
import type { CodebookDiagnostic } from '../utils/formatCodebookDiagnostic'

import { realProcessStart } from './utils/realProcessStart'
import {
  extensionMaterial,
  readExtensionEvents,
  recordTwoStops,
  startRecordedExtensionRun,
} from './utils/startRecordedExtensionRun'

before(async () => {
  await realProcessStart(process.pid)
})

/** A Save over a live recorded extension run, with a host that records every question, notice, open and log entry. */
async function saveOverRun(
  context: TestContext,
  options: {
    answer?: string
    noticeAction?: string
    repositoryOptions?: Parameters<typeof startRecordedExtensionRun>[1]
    /** Replaces the service's stop, to make Save's stop fail. */
    stop?: () => Promise<never>
  } = {},
) {
  const started = await startRecordedExtensionRun(
    context,
    options.repositoryOptions,
  )
  const asked: string[] = []
  const notified: {
    severity: string
    text: string
    actions: readonly string[]
  }[] = []
  const opened: string[] = []
  const logged: CodebookDiagnostic[] = []
  const { service } = started
  const save = new ChromeExtensionLearningSave({
    service: () =>
      options.stop
        ? {
            instanceId: service.instanceId,
            causeRoots: service.causeRoots,
            stop: options.stop,
          }
        : service,
    store: () => started.repository.extensionHistories,
    ask: async (text) => {
      asked.push(text)
      return options.answer ?? 'Save and stop'
    },
    notify: async (severity, text, actions) => {
      notified.push({ severity, text, actions })
      return options.noticeAction
    },
    open: async (studyId) => {
      opened.push(studyId)
    },
    log: (entry) => {
      logged.push(entry)
    },
    changed: () => undefined,
  })
  return { ...started, save, asked, notified, opened, logged }
}

// protects=AC3 item: the item of a live extension run reads Recording explanation with the run's words and offers Save, reads finished after the stop and Open replay after a save; fails_when=a state's words or command change; no_claim=the status bar drawing
test('the Save item of an extension run reads recording, finished and saved with its command', async (context) => {
  // Arrange
  const { save, record, run, service, studyId } = await saveOverRun(context)
  recordTwoStops(run, record)
  const live = save.item(record, 'Waiting for chat')

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const finished = save.item(record, 'Run finished')
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: extensionMaterial(await readExtensionEvents(service, studyId)),
  })
  await save.save(record)
  await new Promise((resolve) => setImmediate(resolve))
  const saved = save.item(record, 'Run finished')

  // Assert
  assert.equal(
    live?.text,
    '$(record) Recording explanation · Waiting for chat · Save learning replay',
  )
  assert.equal(live?.command?.command, 'codebook.saveLearningReplay')
  assert.equal(
    finished?.text,
    '$(save) Recording finished · Save learning replay',
  )
  assert.equal(saved?.command?.command, 'codebook.openLearningReplay')
  assert.equal(saved?.text, '$(warning) Learning partially saved · Open replay')
})

// protects=AC3 Save: Save while the run is live asks with the recorded stop count, stops the run, seals it and tells the learner the Extension replay saved as partial with the first reason and Open replay; fails_when=the question, the stop or the notice change; no_claim=the library row
test('Save while the extension run is live asks, stops it and reports an Extension replay saved as partial', async (context) => {
  // Arrange
  const { save, record, run, notified, asked, opened, studyId } =
    await saveOverRun(context, { noticeAction: 'Open replay' })
  recordTwoStops(run, record)

  // Act
  await save.save(record)
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.equal(asked.length, 1)
  assert.match(
    asked[0] ?? '',
    /^Saving stops the extension run \(\d+ of \d+ stops recorded;/,
  )
  assert.equal(record.stopped, true)
  assert.equal(record.chromeExtension?.history?.status, 'sealed')
  assert.equal(notified.length, 1)
  assert.equal(notified[0]?.severity, 'warning')
  assert.match(
    notified[0]?.text ?? '',
    /^Extension replay saved as partial: .+\.$/,
  )
  assert.deepEqual(notified[0]?.actions, ['Open replay'])
  assert.deepEqual(opened, [studyId])
  assert.equal(
    save.item(record, 'Run finished')?.command?.command,
    'codebook.openLearningReplay',
  )
})

// protects=AC3 Save: cancelling the question leaves the run live and stores nothing; fails_when=the run is stopped after Cancel; no_claim=the modal drawing
test('cancelling the Save question keeps the extension run live', async (context) => {
  // Arrange
  const { save, record, run, notified } = await saveOverRun(context, {
    answer: 'Cancel',
  })
  recordTwoStops(run, record)

  // Act
  await save.save(record)

  // Assert
  assert.equal(record.stopped, false)
  assert.deepEqual(notified, [])
})

// protects=DX-7 Save: Save on a run whose history could not start tells the full-library sentence and stops nothing; fails_when=the run is stopped or the sentence is not the history issue; no_claim=freeing a place
test('Save on an extension run with no history tells why and leaves the run live', async (context) => {
  // Arrange
  const { save, record, notified } = await saveOverRun(context, {
    repositoryOptions: { limit: 0 },
  })

  // Act
  await save.save(record)

  // Assert
  assert.equal(record.stopped, false)
  assert.equal(notified.length, 1)
  assert.match(
    notified[0]?.text ?? '',
    /^Learning replay unavailable: Study library is full\./,
  )
})

// protects=AC3 Output: a failed stop writes one Output entry with the study id, the profile, the sanitized cause and the stack, and Save rejects; fails_when=nothing is logged, the profile is missing or the failure is swallowed; no_claim=the Output channel itself
test('a failed stop during Save is logged once with the study id, the profile and a stack', async (context) => {
  // Arrange
  const { save, record, run, logged, studyId } = await saveOverRun(context, {
    stop: () => Promise.reject(new Error('the stop failed')),
  })
  recordTwoStops(run, record)

  // Act
  const saving = save.save(record)

  // Assert
  await assert.rejects(saving, /the stop failed/)
  assert.equal(logged.length, 1)
  assert.equal(logged[0]?.surface, 'save:stop-rejected')
  assert.equal(logged[0]?.studyId, studyId)
  assert.equal(logged[0]?.profile, 'chrome-extension')
  assert.match(logged[0]?.cause ?? '', /the stop failed/)
  assert.equal(typeof logged[0]?.stack, 'string')
})

// protects=AC3 words: the Save notices are worded for an Extension replay, including the one for an unsaved explanation; fails_when=a sentence says Server or Test replay or drops Open replay; no_claim=when each notice appears
test('the Save notices are worded for an Extension replay', () => {
  // Arrange, Act
  const saved = describeExtensionLearningSave({ kind: 'saved' })
  const missing = describeExtensionLearningSave({ kind: 'explanation-missing' })
  const partial = describeExtensionLearningSave({
    kind: 'partial',
    firstReason: 'The filmstrip is missing.',
    moreCount: 2,
  })

  // Assert
  assert.deepEqual(saved, {
    text: 'Extension replay saved.',
    actions: ['Open replay'],
  })
  assert.deepEqual(missing, {
    text: "Extension replay saved; the chat's explanation is not saved yet.",
    actions: ['Open replay'],
  })
  assert.deepEqual(partial, {
    text: 'Extension replay saved as partial: The filmstrip is missing (+2 more).',
    actions: ['Open replay'],
  })
})
