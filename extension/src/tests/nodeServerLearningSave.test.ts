import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { StudyError } from '../errors'
import { NodeServerLearningSave } from '../nodeServerLearningSave'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createHarness } from './helpers'
import { defer } from './utils/defer'
import { HANDLER_SOURCE_TEXT } from './utils/nodeServerHistoryFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
import { realProcessStart } from './utils/realProcessStart'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

/** A Save over a live fake server run, with a host that records every question, notice and open and answers as the test says. */
async function saveOverRun(
  context: Parameters<typeof startHistoryServerRun>[1],
  options: {
    answer?: () => Promise<string | undefined>
    /** The action the learner clicks on a notice; none by default. */
    noticeAction?: string
    repositoryOptions?: Parameters<typeof startHistoryServerRun>[2]
    /** The bound of Save's own summary read; the production bound by default. */
    summaryReadBoundMs?: number
    /** The chat material revision the host reports; none by default. */
    materialRevision?: number
  } = {},
) {
  const harness = await createHarness()
  context.after(() => harness.close())
  const started = await startHistoryServerRun(
    harness,
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
  const save = new NodeServerLearningSave({
    service: () => started.service,
    store: () => started.repository.serverHistories,
    ask: async (text) => {
      asked.push(text)
      return options.answer ? options.answer() : 'Save and stop'
    },
    notify: async (severity, text, actions) => {
      notified.push({ severity, text, actions })
      return options.noticeAction
    },
    materialRevision: () => options.materialRevision,
    open: async (studyId) => {
      opened.push(studyId)
    },
    log: () => undefined,
    changed: () => undefined,
    ...(options.summaryReadBoundMs === undefined
      ? {}
      : { summaryReadBoundMs: options.summaryReadBoundMs }),
  })
  return { ...started, save, asked, notified, opened }
}

const STOP_SOURCE_HASH = sha256(HANDLER_SOURCE_TEXT)

// protects=the status item of a live server run reads Recording explanation with where the run stands and offers Save, and reads finished after the stop; fails_when=the words, the Save command or the finished text change; no_claim=the status bar drawing
test('the Save item of a server run reads recording while it lives and finished once it ended', async (context) => {
  // Arrange
  const { save, record, run, service } = await saveOverRun(context)
  await run.sendRequest('k1')

  // Act
  const live = save.item(record)
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const finished = save.item(record)

  // Assert
  assert.equal(
    live?.text,
    '$(record) Recording explanation · Listening on :4100 · Save learning replay',
  )
  assert.equal(live?.command?.command, 'codebook.saveLearningReplay')
  assert.equal(
    finished?.text,
    '$(save) Recording finished · Save learning replay',
  )
})

// protects=Save before the request went out says there is nothing to save and leaves the run running; fails_when=the run is stopped or the sentence differs; no_claim=none
test('Save before the request answers nothing to save yet and the run continues', async (context) => {
  // Arrange
  const { save, record, notified, asked } = await saveOverRun(context)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(
    notified.map((notice) => notice.text),
    ['Nothing to save yet: the server run has not sent its request.'],
  )
  assert.deepEqual(asked, [])
  assert.equal(record.stopped, false)
})

// protects=Save while the server runs asks with the recorded stop count and that no response is recorded, then stops the run, seals it and says it saved as partial with the first reason; fails_when=the question text, the stop or the notice change; no_claim=the library row
test('Save while the run waits asks with the stop count, stops and seals, and reports a partial replay', async (context) => {
  // Arrange
  const { save, record, run, notified, asked, service } =
    await saveOverRun(context)
  await run.sendRequest('k1')
  run.pauseAt(0)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(asked, [
    'Saving stops the server run (1 of 2 stops recorded; no response recorded yet, so the response will not be saved). Save now?',
  ])
  assert.equal(record.stopped, true)
  assert.equal(record.nodeServer?.history?.status, 'sealed')
  assert.deepEqual(notified, [
    {
      severity: 'warning',
      text: 'Server replay saved as partial: No response was recorded: the run was stopped before the server answered (+1 more).',
      actions: ['Open replay'],
    },
  ])
  assert.equal(service.state(record).state, 'stopped')
})

// protects=the question says a response is recorded once it is; fails_when=the sentence still says no response; no_claim=none
test('the Save question says the response is recorded once the server answered', async (context) => {
  // Arrange
  const { save, record, run, asked } = await saveOverRun(context)
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(asked, [
    'Saving stops the server run (2 of 2 stops recorded, response recorded). Save now?',
  ])
})

// protects=a request sent with no stop reached asks with 0 of the declared stops and seals partial; fails_when=the count reads another number; no_claim=the reason list
test('Save with the request sent and no stop reached asks 0 of 2 and seals partial', async (context) => {
  // Arrange
  const { save, record, run, asked, notified } = await saveOverRun(context)
  await run.sendRequest('k1')

  // Act
  await save.save(record)

  // Assert
  assert.match(asked[0] ?? '', /\(0 of 2 stops recorded; no response/)
  assert.match(notified[0]?.text ?? '', /saved as partial/)
})

// protects=Cancel keeps the run running and unsaved; fails_when=Cancel stops the run; no_claim=none
test('Cancel at the Save question keeps the server run running', async (context) => {
  // Arrange
  const { save, record, run } = await saveOverRun(context, {
    answer: async () => undefined,
  })
  await run.sendRequest('k1')

  // Act
  await save.save(record)

  // Assert
  assert.equal(record.stopped, false)
  assert.equal(record.nodeServer?.history?.status, 'recording')
})

// protects=a second Save while the question is open joins the one question: one modal, one stop; fails_when=a second question is asked or two saves run; no_claim=focus of the modal (the editor's)
test('a second Save while the question is open asks nothing more and saves once', async (context) => {
  // Arrange
  const answer = defer<string | undefined>()
  const { save, record, run, asked, notified } = await saveOverRun(context, {
    answer: () => answer.promise,
  })
  await run.sendRequest('k1')
  run.pauseAt(0)

  // Act
  const first = save.save(record)
  const second = save.save(record)
  answer.resolve('Save and stop')
  await Promise.all([first, second])

  // Assert
  assert.equal(asked.length, 1)
  assert.equal(notified.length, 1)
})

// protects=when the server ends on its own while the question is open, Save and stop seals the ended run once and Cancel leaves it saveable; fails_when=Save and stop stops a second time or Cancel loses the saveable item; no_claim=the real exit
test('the server ending while the question is open is sealed once by Save and stop and stays saveable after Cancel', async (context) => {
  // Arrange
  const answer = defer<string | undefined>()
  const { save, record, run, service, notified } = await saveOverRun(context, {
    answer: () => answer.promise,
  })
  await run.sendRequest('k1')
  run.pauseAt(0)
  const saving = save.save(record)
  run.record('node-server.closed', { pid: 1, exitCode: 1, signal: null })

  // Act
  run.failRun(new StudyError('SERVER_EXITED', 'exit 1'))
  service.maintain()
  await record.stopPromise
  answer.resolve(undefined)
  await saving

  // Assert
  assert.equal(notified.length, 0)
  assert.equal(
    save.item(record)?.text,
    '$(save) Recording finished · Save learning replay',
  )
})

// protects=Save after the end asks nothing and reports the saved history, naming the missing explanation when the chat saved none; fails_when=a question is asked after the end, or the outcome says saved without an explanation; no_claim=the library row
test('Save after the run ended asks nothing and says the chat explanation is not saved yet', async (context) => {
  // Arrange
  const { save, record, run, asked, notified, service } =
    await saveOverRun(context)
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(asked, [])
  assert.deepEqual(notified, [
    {
      severity: 'warning',
      text: "Server replay saved; the chat's explanation is not saved yet.",
      actions: ['Open replay'],
    },
  ])
})

// protects=a complete capture covered by the chat's explanation reads Server replay saved, and Open replay opens the history; fails_when=complete reads partial, or Open replay opens nothing; no_claim=the replay screen
test('a complete capture with the explanation saved reads Server replay saved and opens the replay', async (context) => {
  // Arrange
  const { save, record, run, notified, opened, service, repository } =
    await saveOverRun(context, { noticeAction: 'Open replay' })
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const studyId = `${service.instanceId}_${record.id}`
  const entries = (await repository.serverHistories.read(studyId)).entries
  const sequenceOf = (type: string, nth = 0): number =>
    entries.filter((entry) => entry.type === type)[nth]!.sequence
  await service.explainNodeHistory({
    studyId,
    expectedRevision: 0,
    content: {
      question: 'How is the health route answered?',
      title: 'Health route',
      summary: 'One request, two stops, a response.',
      participants: [{ id: 'server', label: 'Server' }],
      steps: [
        {
          id: 'request',
          from: 'server',
          to: 'server',
          label: 'Request',
          explanation: 'Codebook sends it.',
          evidence: 'observed',
          reference: { type: 'request', sequence: sequenceOf('request') },
        },
        {
          id: 'stop-1',
          from: 'server',
          to: 'server',
          label: 'Stop 1',
          explanation: 'First stop.',
          evidence: 'observed',
          reference: {
            type: 'stop',
            sequence: sequenceOf('stop', 0),
            sourceHash: STOP_SOURCE_HASH,
          },
        },
        {
          id: 'stop-2',
          from: 'server',
          to: 'server',
          label: 'Stop 2',
          explanation: 'Second stop.',
          evidence: 'observed',
          reference: {
            type: 'stop',
            sequence: sequenceOf('stop', 1),
            sourceHash: STOP_SOURCE_HASH,
          },
        },
        {
          id: 'response',
          from: 'server',
          to: 'server',
          label: 'Response',
          explanation: 'Answered.',
          evidence: 'observed',
          reference: { type: 'response', sequence: sequenceOf('response') },
        },
      ],
    },
  })

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(
    notified.map((notice) => notice.text),
    ['Server replay saved.'],
  )
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
  await waitUntil(
    () => opened.length > 0,
    'the replay is opened',
    READER_RESULT_BOUND_MS,
  )
  assert.deepEqual(opened, [studyId])
})

// protects=storage that could not start the history leaves the run running, the item names the cause and Save answers it; fails_when=Save stops the run or the cause is lost; no_claim=the wording of a full store
test('with no history the item names the cause and Save answers it without stopping the run', async (context) => {
  // Arrange
  const { save, record, notified } = await saveOverRun(context, {
    repositoryOptions: {
      repositoryOptions: { limit: 1, savedStudies: async () => 1 },
    },
  })

  // Act
  await save.save(record)

  // Assert
  assert.match(
    save.item(record)?.text ?? '',
    /^Listening on :4100 · Learning replay unavailable: /,
  )
  assert.match(notified[0]?.text ?? '', /^Learning replay unavailable: /)
  assert.equal(record.stopped, false)
})

// protects=a seal that timed out reads its cause in the item and the stop still finished; fails_when=the item reads saved or the cause is lost; no_claim=real disk stalls
test('a seal that timed out reads Learning replay could not be saved in the item', async (context) => {
  // Arrange
  const { save, record, run, service } = await saveOverRun(context)
  service.nodeServerHistorySealBoundMs = 20
  await run.sendRequest('k1')
  const writer = record.nodeServer?.history?.writer
  assert.ok(writer)
  writer.seal = () => new Promise<never>(() => undefined)

  // Act
  await service.stop({ instanceId: service.instanceId, runId: record.id })

  // Assert
  assert.equal(
    save.item(record)?.text,
    'Stopped · Learning replay could not be saved: timed out after 0.02 s.',
  )
})

// protects=Save after a seal that timed out answers with a notice naming the cause, and a second click answers it again; fails_when=Save stays silent after the history failed; no_claim=the status item text
test('Save after a seal that timed out tells the cause in a notice each time', async (context) => {
  // Arrange
  const { save, record, run, service, notified } = await saveOverRun(context)
  service.nodeServerHistorySealBoundMs = 20
  await run.sendRequest('k1')
  const writer = record.nodeServer?.history?.writer
  assert.ok(writer)
  writer.seal = () => new Promise<never>(() => undefined)

  // Act
  await save.save(record)
  await save.save(record)

  // Assert
  assert.deepEqual(notified, [
    {
      severity: 'warning',
      text: 'Learning replay could not be saved: timed out after 0.02 s.',
      actions: [],
    },
    {
      severity: 'warning',
      text: 'Learning replay could not be saved: timed out after 0.02 s.',
      actions: [],
    },
  ])
})

// protects=Save whose sealed summary cannot be read answers with a notice naming why, not silence; fails_when=the unreadable summary only changes the status text; no_claim=which read error occurs
test('Save whose sealed history summary cannot be read tells that the history is not in the store', async (context) => {
  // Arrange
  const { save, record, run, service, repository, notified } =
    await saveOverRun(context)
  await run.sendRequest('k1')
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const sealed = record.nodeServer?.history?.sealed
  assert.ok(sealed)
  sealed.summary = undefined
  repository.serverHistories.summarize = () =>
    Promise.reject(new Error('EIO: read failed'))

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(notified, [
    {
      severity: 'warning',
      text: 'Learning replay could not be saved: EIO: read failed.',
      actions: [],
    },
  ])
})

// protects=Save of another study while one is saved rejects the returned promise instead of throwing synchronously; fails_when=the call throws out of save(); no_claim=which study is saved first
test('Save of another run while one is open rejects the promise and does not throw', async (context) => {
  // Arrange
  let release: (action: string | undefined) => void = () => undefined
  const { save, record, run } = await saveOverRun(context, {
    answer: () =>
      new Promise<string | undefined>((resolve) => {
        release = resolve
      }),
  })
  await run.sendRequest('k1')
  const first = save.save(record)
  let second: Promise<void> | undefined

  // Act
  assert.doesNotThrow(() => {
    second = save.save({ ...record, id: 'another-run' })
  })
  // The rejection is observed before the first save is released, so it is never unhandled while that save's I/O runs.
  const secondRejection = assert.rejects(
    second!,
    /Another learning session is being saved. Wait for its result./,
  )
  release(undefined)
  await first

  // Assert
  await secondRejection
})

// protects=Save over a sealed history whose summary read never settles answers within its bound and frees the Save for another run; fails_when=Save waits on the stalled read, so it never answers and every later Save of another run is refused as already saving; why_new=Codex and the red team (ship pass 2) found Save still held after the seal's summary bound; seam=summaryReadBoundMs (non-test callers: 1, the production bound by default); no_claim=which file system stalls
test('Save whose sealed summary read never settles answers within its bound and frees Save for another run', async (context) => {
  // Arrange
  const { save, record, run, service, repository, notified } =
    await saveOverRun(context, { summaryReadBoundMs: 50 })
  await run.sendRequest('k1')
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const sealed = record.nodeServer?.history?.sealed
  assert.ok(sealed)
  sealed.summary = undefined
  repository.serverHistories.summarize = () =>
    new Promise<never>(() => undefined)

  // Act
  let guard: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    save.save(record).then(() => 'answered'),
    // gstack-timing-ok: the read's bound is the contract; a Save still pending 3 s after a 50 ms bound waits on the stalled read
    new Promise<string>((resolve) => {
      guard = setTimeout(() => resolve('still saving'), 3_000)
    }),
  ])
  clearTimeout(guard)
  const another = await save.save({ ...record, id: 'another-run' }).then(
    () => undefined,
    (error: unknown) => error,
  )

  // Assert
  assert.equal(outcome, 'answered')
  assert.deepEqual(notified, [
    {
      severity: 'warning',
      text: 'Learning replay could not be saved: The sealed server history could not be read within 0.05 s.',
      actions: [],
    },
  ])
  assert.doesNotMatch(
    String(another),
    /Another learning session is being saved/,
  )
})

// protects=repeated Saves over a sealed history whose summary read stalls share one read instead of stacking one stalled read per click; fails_when=each Save starts its own summarize, so a hung store collects a pending read per click; why_new=last-round red team (ship pass 3); seam=summaryReadBoundMs (non-test callers: 1, the production bound by default); no_claim=which file system stalls
test('two Saves over a stalled sealed summary share one summary read', async (context) => {
  // Arrange
  const { save, record, run, service, repository } = await saveOverRun(
    context,
    { summaryReadBoundMs: 30 },
  )
  await run.sendRequest('k1')
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const sealed = record.nodeServer?.history?.sealed
  assert.ok(sealed)
  sealed.summary = undefined
  let reads = 0
  repository.serverHistories.summarize = () => {
    reads += 1
    return new Promise<never>(() => undefined)
  }

  // Act
  await save.save(record)
  await save.save(record)

  // Assert
  assert.equal(reads, 1)
})

// protects=material the chat saved after the seal counts: Save reads the store, not the seal-time summary, so the notice reads Server replay saved and the item stays saved at that revision; fails_when=Save answers from the seal-time summary and reports the replay without the explanation, or the item falls back to Save learning replay; no_claim=the replay screen
test('Save reports Server replay saved for material the chat saved after the seal', async (context) => {
  // Arrange
  const { save, record, run, notified, service, repository } =
    await saveOverRun(context, { materialRevision: 1 })
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const studyId = `${service.instanceId}_${record.id}`
  const sealed = record.nodeServer?.history?.sealed
  assert.ok(sealed?.summary)
  assert.equal(sealed.summary.learningCoverage, 'none')
  const entries = (await repository.serverHistories.read(studyId)).entries
  const sequenceOf = (type: string, nth = 0): number =>
    entries.filter((entry) => entry.type === type)[nth]!.sequence
  // Another window saves the chat's material straight into the store: the service's seal-time summary never sees it.
  await repository.serverHistories.saveLearningMaterial(studyId, 0, {
    question: 'How is the health route answered?',
    title: 'Health route',
    summary: 'One request, two stops, a response.',
    participants: [{ id: 'server', label: 'Server' }],
    steps: [
      {
        id: 'request',
        from: 'server',
        to: 'server',
        label: 'Request',
        explanation: 'Codebook sends it.',
        evidence: 'observed',
        reference: { type: 'request', sequence: sequenceOf('request') },
      },
      {
        id: 'stop-1',
        from: 'server',
        to: 'server',
        label: 'Stop 1',
        explanation: 'First stop.',
        evidence: 'observed',
        reference: {
          type: 'stop',
          sequence: sequenceOf('stop', 0),
          sourceHash: STOP_SOURCE_HASH,
        },
      },
      {
        id: 'stop-2',
        from: 'server',
        to: 'server',
        label: 'Stop 2',
        explanation: 'Second stop.',
        evidence: 'observed',
        reference: {
          type: 'stop',
          sequence: sequenceOf('stop', 1),
          sourceHash: STOP_SOURCE_HASH,
        },
      },
      {
        id: 'response',
        from: 'server',
        to: 'server',
        label: 'Response',
        explanation: 'Answered.',
        evidence: 'observed',
        reference: { type: 'response', sequence: sequenceOf('response') },
      },
    ],
  })

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(
    notified.map((notice) => notice.text),
    ['Server replay saved.'],
  )
  assert.equal(save.item(record)?.text, '$(check) Learning saved · Open replay')
})

// protects=the status item says at once, with the cause, that the learning replay will be partial once a write failed while the run lives, keeps the Save command, and the service redraws the item; fails_when=the item still reads Recording explanation, the cause is lost, the Save command is dropped, or no redraw is asked; no_claim=the status bar drawing
test('the item says the learning replay will be partial once a write failed while the run lives', async (context) => {
  // Arrange
  const { save, record, run, service } = await saveOverRun(context)
  let redraws = 0
  service.presentationController = {
    publishLearningSave: () => {
      redraws++
    },
  } as unknown as NonNullable<typeof service.presentationController>
  await run.sendRequest('k1')
  const writer = record.nodeServer?.history?.writer
  assert.ok(writer)
  writer.markFailed(new Error('EIO: disk write failed'))

  // Act
  run.pauseAt(0)
  await waitUntil(
    () => redraws > 0,
    'the service redraws the item',
    READER_RESULT_BOUND_MS,
  )
  const item = save.item(record)

  // Assert
  assert.equal(
    item?.text,
    '$(warning) Paused at stop 1 of 2 · Learning replay will be partial: EIO: disk write failed',
  )
  assert.doesNotMatch(item?.text ?? '', /Recording explanation/)
  assert.equal(item?.command?.command, 'codebook.saveLearningReplay')
  assert.equal(redraws, 1)
})

// protects=a history the store no longer holds (deleted by another window after the seal) is never reported as saved from the seal-time summary, and the notice names the missing history; fails_when=Save falls back to the seal-time summary and says Server replay saved though Open replay then fails; no_claim=which window deleted it
test('Save does not report Server replay saved when the store no longer holds the sealed history', async (context) => {
  // Arrange
  const { save, record, run, service, repository, notified } =
    await saveOverRun(context)
  await run.sendRequest('k1')
  run.pauseAt(0)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  assert.equal(
    record.nodeServer?.history?.sealed?.summary?.verification,
    'verified',
  )
  repository.serverHistories.summarize = () => Promise.resolve(undefined)

  // Act
  await save.save(record)

  // Assert
  assert.deepEqual(notified, [
    {
      severity: 'warning',
      text: 'Learning replay could not be saved: The sealed server history is not in the store.',
      actions: [],
    },
  ])
})
