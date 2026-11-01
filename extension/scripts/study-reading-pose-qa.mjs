import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { projectStudy } from '../dist/studyModel.js'
import { createConfiguredStudy } from '../dist/tests/utils/createConfiguredStudy.js'
import { studyHtml } from '../dist/ui/studyHtml.js'
import { decodeLearnerProgress } from '../dist/utils/decodeLearnerProgress.js'
import { selectStudy } from '../dist/utils/selectStudy.js'

import { readerDomCommandOptions } from './utils/readerDomCommandOptions.mjs'
import { readerDomFlowText } from './utils/readerDomFlowText.mjs'
import { readerDomSessionName } from './utils/readerDomSessionName.mjs'

// Exercise the reading pose of the compiled Study pane in Chromium: what the pane captures before the host replaces its document, and what it restores in the new one.
const [mode = 'verify', outputPath = 'artifacts/reading-pose-dom'] =
  process.argv.slice(2)
assert.ok(['red', 'verify'].includes(mode))
const output = resolve(outputPath),
  session = readerDomSessionName('reading-pose', mode, output),
  html = studyHtml('context')
await mkdir(output, { recursive: true })
const study = createConfiguredStudy(),
  baseline = {
    text: '',
    hash: '0'.repeat(64),
    line: 1,
    path: '/fixture/unused.mts',
  }
const model = projectStudy({
  study,
  selection: { ...selectStudy(study), tab: 'live' },
  progress: decodeLearnerProgress(
    { version: 4, workspaceKey: study.workspaceKey, decisions: [] },
    study.workspaceKey,
  ),
  baselines: { server: baseline, browser: baseline },
  citationSources: study.descriptor.sources.map((source) => ({
    path: source.path,
    hash: source.hash,
    currentHash: source.hash,
    status: 'current',
  })),
})
model.observation.interpretations = [
  {
    text: 'This is source and explanation context for a reader transfer. '.repeat(
      35,
    ),
  },
]
const message = {
  type: 'study',
  revision: 1,
  model,
  busy: false,
  saving: false,
  loading: false,
  errors: [],
  canClick: false,
  canRun: false,
  profiles: [],
  moments: [],
  studies: [],
  presentation: {
    presentationId: '11111111-1111-4111-8111-111111111111',
    presentationControlRevision: 1,
    mode: 'study-workspace',
    state: 'open',
    layoutConfirmed: true,
    preference: { status: 'default' },
    panes: {},
  },
}

/** Runs the owned Chromium session through the CLI and retains transport failures separately from assertions; {@link readerDomCommandOptions} gives the call labelled `flow` the flow's own limit. @example command(['open', 'about:blank'], 'open') */
async function command(arguments_, label) {
  const result = await new Promise((resolve) =>
    execFile(
      'playwright-cli',
      [`-s=${session}`, ...arguments_],
      readerDomCommandOptions(label),
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    ),
  )
  await writeFile(
    `${output}/${label}.log`,
    result.stdout +
      result.stderr +
      (result.error ? `\n${String(result.error)}\n` : ''),
  )
  assert.equal(result.error, null, String(result.error))
  assert.equal(result.stdout.includes('### Error'), false, result.stdout)
  return result.stdout
}

/** Recreates the actual product DOM and exercises capture, restoration and newer keyboard input; native host messages are simulated. It adds its cases and the page's errors to the lists of `collected`, which {@link runFlowKeepingCases} answers. @example check(page, options, { cases: [], errors: [] }) */
async function check(page, options, collected) {
  const { cases, errors } = collected
  page.on('pageerror', (error) => errors.push(String(error)))
  page.setDefaultTimeout(5_000)
  const publish = (message) =>
    page.evaluate(
      (message) =>
        window.dispatchEvent(new MessageEvent('message', { data: message })),
      message,
    )
  const render = async (message) => {
    await page.goto(options.url)
    await page.evaluate(() => {
      window.sent = []
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState() {},
        postMessage: (message) => window.sent.push(message),
      })
    })
    await page.setContent(options.html)
    await publish(message)
    try {
      await page.waitForFunction(
        () => window.sent.some((message) => message.type === 'rendered'),
        undefined,
        { timeout: 5_000 },
      )
    } catch (error) {
      throw new Error(
        JSON.stringify({
          stage: 'initial product render',
          error: String(error),
          errors,
          sent: await page.evaluate(() => window.sent),
        }),
      )
    }
  }
  const inspect = () =>
    page.evaluate(() => ({
      focus: document.activeElement?.id,
      scrollY: window.scrollY,
      anchorTop: document
        .getElementById('source-version')
        .getBoundingClientRect().top,
      expanded: [...document.querySelectorAll('details[open]')].map(
        (element) => element.id,
      ),
      visited: [
        ...new Set(
          [...document.querySelectorAll('.visited')].map(
            (element) => element.dataset.action,
          ),
        ),
      ],
      understood: document.getElementById('understood').checked,
      invalidated: window.sent.filter(
        (message) => message.type === 'presentation-pose-invalidated',
      ).length,
      restored: window.sent.filter(
        (message) => message.type === 'presentation-pose-restored',
      ).length,
      understandingWrites: window.sent.filter(
        (message) => message.type === 'understanding',
      ).length,
      actionWrites: window.sent.filter((message) => message.type === 'action')
        .length,
      summaryFocused:
        document.activeElement ===
        document.querySelector('#presentation-options > summary'),
      interpretationFocused:
        document.activeElement === document.getElementById('interpretations'),
      duplicateValues: Boolean(
        document.querySelector('.table-scroll, #values'),
      ),
    }))
  const applying = {
    ...options.message,
    presentation: { ...options.message.presentation, state: 'applying' },
  }
  const request = {
    type: 'capture-presentation-pose',
    captureId: '22222222-2222-4222-8222-222222222222',
    presentationId: applying.presentation.presentationId,
    expectedRevision: 1,
    revision: 1,
    itemId: applying.model.selection.itemId,
    sourceHash: applying.model.source.hash,
    studyId: applying.model.selection.studyId,
    observationId: applying.model.observation?.id,
    contentTab: applying.model.selection.tab,
  }
  await page.setViewportSize({ width: 390, height: 640 })
  await render(options.message)
  await page.locator('#reader-options > summary').click()
  await page.locator('#presentation-options > summary').click()
  await page.locator('[data-action="source"]').nth(1).click()
  await page.locator('#understood').focus()
  const before = await inspect()
  await publish(applying)
  await publish(request)
  const captured = await page.evaluate(() =>
    window.sent.findLast((message) => message.type === 'presentation-pose'),
  )
  const replacement = { ...applying }
  await page.screenshot({ path: `${options.output}/before-replacement.png` })
  await page.waitForTimeout(500) // Video reading pause after capture; it does not satisfy a product readiness predicate.
  // A real document replacement deliberately has no old local state or HTMLElement references.
  await render(replacement)
  if (captured?.pose) {
    await publish({ ...captured, type: 'restore-presentation-pose' })
    await page.waitForFunction(() =>
      window.sent.some(
        (message) => message.type === 'presentation-pose-restored',
      ),
    )
  }
  const after = await inspect()
  await page.screenshot({ path: `${options.output}/after-replacement.png` })
  await page.waitForTimeout(500)
  cases.push({
    name: 'replacement preserves reading, disclosure, visited link and focused control',
    before,
    after,
    passed:
      Boolean(captured?.pose) &&
      before.focus === 'understood' &&
      after.focus === 'understood' &&
      Math.abs(after.anchorTop - before.anchorTop) <= 2 &&
      JSON.stringify(after.expanded) === JSON.stringify(before.expanded) &&
      JSON.stringify(after.visited) === JSON.stringify(before.visited) &&
      after.understood === before.understood &&
      after.understandingWrites === 0 &&
      after.restored === 1,
  })
  if (!captured?.pose)
    throw new Error('No serializable reading pose was captured.')
  const restore = { ...captured, type: 'restore-presentation-pose' }
  await render(applying)
  await page.locator('#understood').focus()
  await publish(request)
  await page.keyboard.press('Tab')
  const newer = await inspect()
  await publish(restore)
  await page.waitForFunction(() =>
    window.sent.some(
      (message) => message.type === 'presentation-pose-invalidated',
    ),
  )
  const retained = await inspect()
  await page.waitForTimeout(500)
  cases.push({
    name: 'later keyboard input invalidates the old capture',
    newer,
    retained,
    passed:
      retained.focus === newer.focus &&
      retained.scrollY === newer.scrollY &&
      retained.restored === 0 &&
      retained.invalidated >= 1,
  })
  await render(applying)
  await publish(request)
  // The wheel turns over the pane's title: the explanation below it scrolls within itself, so a wheel over it does not move the page.
  await page.locator('#title').hover()
  await page.mouse.wheel(0, 300)
  await page.waitForFunction(() => window.scrollY > 0)
  // Wait for the wheel's native scroll to settle before comparing the later rejected restore.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  const scrolled = await inspect()
  await publish(restore)
  const scrollRetained = await inspect()
  await page.waitForTimeout(500)
  cases.push({
    name: 'later wheel input preserves its new reading position',
    scrolled,
    scrollRetained,
    passed:
      scrolled.scrollY > 0 &&
      scrollRetained.scrollY === scrolled.scrollY &&
      scrollRetained.restored === 0 &&
      scrollRetained.invalidated >= 1,
  })
  await render(replacement)
  await page.keyboard.press('Tab')
  const freshInput = await inspect()
  await publish(restore)
  await page.waitForFunction(() =>
    window.sent.some(
      (message) => message.type === 'presentation-pose-invalidated',
    ),
  )
  const freshRetained = await inspect()
  await page.waitForTimeout(500)
  cases.push({
    name: 'new renderer input wins over imported state',
    freshInput,
    freshRetained,
    passed:
      freshRetained.focus === freshInput.focus &&
      freshRetained.scrollY === freshInput.scrollY &&
      freshRetained.restored === 0,
  })
  await render(replacement)
  await page.evaluate(() => {
    window.queuedFrames = []
    window.requestAnimationFrame = (callback) => {
      window.queuedFrames.push(callback)
      return window.queuedFrames.length
    }
  })
  await publish(restore)
  await page.keyboard.press('Tab')
  const between = await inspect()
  await page.evaluate(() => {
    for (const callback of window.queuedFrames.splice(0))
      callback(performance.now())
  })
  const afterFrame = await inspect()
  await page.waitForTimeout(500)
  cases.push({
    name: 'keyboard input before the queued restore frame keeps its new focus and scroll',
    between,
    afterFrame,
    passed:
      afterFrame.focus === between.focus &&
      afterFrame.scrollY === between.scrollY &&
      afterFrame.restored === 0 &&
      afterFrame.invalidated >= 1,
  })
  await render({ ...replacement, revision: 2 })
  await publish(restore)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  )
  const stale = await inspect()
  await page.waitForTimeout(500)
  cases.push({
    name: 'a different displayed model cannot acknowledge an old pose',
    stale,
    passed: stale.restored === 0 && stale.scrollY === 0,
  })
  await render({
    ...replacement,
    model: {
      ...replacement.model,
      observation: {
        ...replacement.model.observation,
        id: 'browser-session:999',
      },
    },
  })
  await publish(restore)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  )
  const differentObservation = await inspect()
  await page.waitForTimeout(500)
  cases.push({
    name: 'another observation of the same source cannot inherit the old reading receipt',
    differentObservation,
    passed:
      differentObservation.restored === 0 && differentObservation.scrollY === 0,
  })
  await page.setViewportSize({ width: 330, height: 640 })
  for (const focus of ['summary', 'interpretation']) {
    // Arrange: retain the disclosure or explanation focus without a duplicate value surface.
    await render(options.message)
    await page.locator('#reader-options > summary').click()
    await page.locator('#presentation-options > summary').click()
    await page
      .locator(
        focus === 'summary'
          ? '#presentation-options > summary'
          : '#interpretations',
      )
      .focus()
    const beforeReading = await inspect()
    await publish(applying)
    await publish(request)
    const readingPose = await page.evaluate(() =>
      window.sent.findLast((message) => message.type === 'presentation-pose'),
    )
    await page.screenshot({
      path: `${options.output}/${focus}-before-replacement.png`,
    })
    await page.waitForTimeout(400)
    // Act: replace the real document, then restore only its serialized host receipt.
    await render(replacement)
    await publish({ ...readingPose, type: 'restore-presentation-pose' })
    await page.waitForFunction(() =>
      window.sent.some(
        (message) => message.type === 'presentation-pose-restored',
      ),
    )
    const afterReading = await inspect()
    await page.screenshot({
      path: `${options.output}/${focus}-after-replacement.png`,
    })
    await page.waitForTimeout(400)
    // Assert: explanation reading and keyboard ownership survive without runtime or learning writes.
    cases.push({
      name: `replacement retains explanation reading with ${focus} focus`,
      before: beforeReading,
      after: afterReading,
      passed:
        !beforeReading.duplicateValues &&
        !afterReading.duplicateValues &&
        beforeReading[`${focus}Focused`] &&
        afterReading[`${focus}Focused`] &&
        afterReading.expanded.includes('presentation-options') &&
        afterReading.understood === beforeReading.understood &&
        !afterReading.understood &&
        afterReading.understandingWrites === 0 &&
        afterReading.actionWrites === 0 &&
        afterReading.restored === 1,
    })
  }
  for (const focus of [
    { kind: 'values' },
    { kind: 'id', id: 'presentation-mode' },
  ]) {
    // Arrange: an archived receipt may still name a retired control.
    await render(replacement)
    const legacy = {
      ...restore,
      pose: { ...restore.pose, focus, valuesScrollLeft: 120 },
    }
    // Act: importing the receipt must recover a useful existing reading surface.
    await publish(legacy)
    await page.waitForFunction(() =>
      window.sent.some(
        (message) => message.type === 'presentation-pose-restored',
      ),
    )
    const restored = await inspect()
    // Assert: focus migration cannot recreate values UI or trigger learning/runtime actions.
    cases.push({
      name: `retired ${focus.id ?? focus.kind} focus restores the explanation`,
      restored,
      passed:
        restored.interpretationFocused &&
        !restored.duplicateValues &&
        restored.restored === 1 &&
        restored.understandingWrites === 0 &&
        restored.actionWrites === 0,
    })
  }
  // A saved sequence link must survive a fresh webview, not just an in-place update.
  const replay = {
    ...applying,
    contentTab: 'recording',
    recording: {
      revision: 1,
      mode: 'paused',
      readiness: 'ready',
      presentedMs: 2000,
      range: { startMs: 0, endMs: 8000, endKnown: true },
      recordingStatus: 'finalized',
      learningSummary: {
        explanationId: '44444444-4444-4444-8444-444444444444',
        createdAt: '2026-09-27T00:00:00.000Z',
        content: {
          question: 'What did this source execute?',
          title: 'Recorded selection',
          summary: 'A retained source stop.',
          participants: [{ id: 'source', label: 'Source' }],
          steps: [
            {
              id: 'selected',
              from: 'source',
              to: 'source',
              label: 'Recorded selection',
              explanation: 'Read the captured source.',
              evidence: 'observed',
              reference: {
                snapshotUri: 'codebook://recorded-stop',
                sourceHash: options.message.model.source.hash,
              },
            },
          ],
        },
        positions: [{ stepId: 'selected', elapsedMs: 2000 }],
      },
    },
  }
  await render(replay)
  await page.locator('[data-summary-step="selected"]').focus()
  await publish({ ...request, contentTab: 'recording' })
  const sequencePose = await page.evaluate(() =>
    window.sent.findLast((message) => message.type === 'presentation-pose'),
  )
  await render(replay)
  await publish({ ...sequencePose, type: 'restore-presentation-pose' })
  await page.waitForFunction(() =>
    window.sent.some(
      (message) => message.type === 'presentation-pose-restored',
    ),
  )
  const sequenceFocus = await page.evaluate(() => ({
    stepId: document.activeElement?.dataset.summaryStep,
    top: document.activeElement.getBoundingClientRect().top,
    bottom: document.activeElement.getBoundingClientRect().bottom,
    footerTop: document
      .getElementById('recording-transport')
      .getBoundingClientRect().top,
    writes: window.sent.filter((message) =>
      ['playback', 'action', 'understanding'].includes(message.type),
    ).length,
  }))
  cases.push({
    name: 'replacement restores the saved sequence inspection control without seeking or marking understanding',
    actual: sequenceFocus,
    passed:
      sequencePose?.pose.focus.kind === 'summary-step' &&
      sequenceFocus.stepId === 'selected' &&
      sequenceFocus.writes === 0 &&
      sequenceFocus.top >= 0 &&
      sequenceFocus.bottom <= sequenceFocus.footerTop,
  })
  await page.screenshot({
    path: `${options.output}/sequence-focus-restored.png`,
  })

  // Cycle 0070: the replay's operation row. A host answer to a seek is simulated by publishing the Study message that follows it.
  /** Derives a Study message's revision from the first message's by its distance in the flow, so no case carries a bare revision number of its own. @example revisionAt(1) // the second message's revision */
  const revisionAt = (step) => options.message.revision + step
  const sentPlayback = () =>
    page.evaluate(() =>
      window.sent.filter((message) => message.type === 'playback'),
    )
  const markOf = (index) => page.locator(`[data-operation-mark="${index}"]`)
  const fourMarks = [
    {
      index: 1,
      total: 4,
      kind: 'choose',
      title: 'Customer',
      atMs: 1000,
      state: 'done',
    },
    {
      index: 2,
      total: 4,
      kind: 'text',
      title: 'Amount',
      atMs: 1500,
      state: 'done',
    },
    {
      index: 3,
      total: 4,
      kind: 'click',
      title: 'Pending',
      atMs: 3500,
      state: 'failed',
    },
    {
      index: 4,
      total: 4,
      kind: 'click',
      title: 'Create Invoice',
      atMs: undefined,
      state: 'pending',
    },
  ]
  /** A browser replay message of the Study page with the given operations, presented position and learning summary; `step` is its distance from the first message. */
  const operationReplay = (step, overrides = {}) => ({
    ...options.message,
    revision: revisionAt(step),
    contentTab: 'recording',
    recording: {
      revision: 1,
      mode: 'paused',
      readiness: 'ready',
      presentedMs: 0,
      range: { startMs: 0, endMs: 8000, endKnown: true },
      recordingStatus: 'finalized',
      historyTimeline: {
        status: 'mapped',
        gaps: [{ startMs: 5000, endMs: 5600 }],
        recordedPoints: [2000],
      },
      operations: fourMarks,
      ...overrides,
    },
  })
  const waitUntilRendered = (revision) =>
    page.waitForFunction(
      (awaitedRevision) =>
        window.sent.some(
          (message) =>
            message.type === 'rendered' && message.revision === awaitedRevision,
        ),
      revision,
    )
  /** Reads what the learner sees of the row: the focused mark, the announcement, the caption, the position and whether the row, Play and the 4A text lie inside the viewport. */
  const readRow = () =>
    page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect()
      const visible = (id) => document.getElementById(id).checkVisibility()
      return {
        focusedMark: document.activeElement?.dataset?.operationMark ?? null,
        announcement: document.getElementById('operation-status').textContent,
        caption: visible('operation-caption')
          ? document.getElementById('operation-caption').textContent
          : '',
        playhead: document.getElementById('playhead').value,
        status: document.getElementById('recording-status').textContent,
        currentMark:
          document.querySelector('[data-operation-mark][aria-current=true]')
            ?.dataset.operationMark ?? null,
        rowVisible: visible('operation-row'),
        insideViewport: [
          'operation-row',
          'playback-toggle',
          'playback-position',
          'recording-status',
        ].every((id) => visible(id) && box(id).right <= window.innerWidth + 1),
        previousDisabled:
          document.getElementById('previous-operation').disabled,
        nextDisabled: document.getElementById('next-operation').disabled,
      }
    })
  for (const width of [960, 480]) {
    // Arrange: a replay of four operations, the third failed and the fourth never sent, opened at the start.
    await page.setViewportSize({ width, height: 640 })
    await render(operationReplay(0))
    await markOf(1).focus()
    // Act: Tab to mark 3 and press Enter.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    const afterEnter = await readRow()
    const seeks = await sentPlayback()
    // The host presents the moment: the Study message that follows the seek.
    await publish(operationReplay(1, { presentedMs: 3500 }))
    await waitUntilRendered(revisionAt(1))
    const presented = await readRow()
    // Assert
    cases.push({
      name: `Tab to mark 3 and Enter seeks to its moment, announces it, keeps the focus on the mark and captions the moment at ${width} px`,
      actual: { afterEnter, seeks, presented },
      passed:
        afterEnter.focusedMark === '3' &&
        afterEnter.announcement === 'Moved to operation 3' &&
        seeks.length === 1 &&
        seeks[0].action === 'seek' &&
        seeks[0].positionMs === 3500 &&
        presented.playhead === '3500' &&
        presented.focusedMark === '3' &&
        presented.currentMark === '3' &&
        presented.caption ===
          'Operation 3 · Pending · showing the last frame before it was sent' &&
        presented.insideViewport,
    })
  }
  // Space also seeks, and the mark's accessible name carries its place, kind, title, time and state.
  await page.setViewportSize({ width: 960, height: 640 })
  await render(operationReplay(0))
  await markOf(2).focus()
  await page.keyboard.press(' ')
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('[data-operation-mark]')].map((mark) =>
      mark.getAttribute('aria-label'),
    ),
  )
  const spaceSeeks = await sentPlayback()
  cases.push({
    name: 'Space seeks to the mark and every mark is named with its place, kind, title, time and state',
    actual: { names, spaceSeeks: spaceSeeks.map((seek) => seek.positionMs) },
    passed:
      spaceSeeks.at(-1)?.positionMs === 1500 &&
      names[0] === 'Operation 1 of 4, choose, Customer, at 1.00 s, done' &&
      names[2] === 'Operation 3 of 4, click, Pending, at 3.50 s, failed' &&
      names[3] ===
        'Operation 4 of 4, click, Create Invoice, at not sent, not finished',
  })
  // Done, failed and pending differ by shape and text, not colour alone; a mark that was never sent has no moment to move to.
  const shapes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-operation-mark]')].map(
      (mark) => mark.textContent,
    ),
  )
  await markOf(4).click()
  const notSent = await readRow()
  cases.push({
    name: 'done, failed and pending marks differ by text, and a mark never sent announces that it has no moment',
    actual: { shapes, notSent },
    passed:
      shapes[0] === '1' &&
      shapes[1] === '2' &&
      shapes[2] === '3 ✕ failed' &&
      shapes[3] === '4 ?' &&
      notSent.announcement ===
        'Operation 4 was not sent, so there is no moment to show',
  })
  // Previous and Next operation step between sent operations.
  await render(operationReplay(0, { presentedMs: 2000 }))
  await page.locator('#next-operation').click()
  const nextSeek = (await sentPlayback()).at(-1)
  await render(operationReplay(0, { presentedMs: 2000 }))
  await page.locator('#previous-operation').click()
  const previousSeek = (await sentPlayback()).at(-1)
  cases.push({
    name: 'Previous operation and Next operation seek to the sent operation before and after the position',
    actual: { previous: previousSeek?.positionMs, next: nextSeek?.positionMs },
    passed: previousSeek?.positionMs === 1500 && nextSeek?.positionMs === 3500,
  })
  // Inside an unrecorded interval the transport keeps its own text and the caption is not shown.
  const inGap = [
    { ...fourMarks[0] },
    { ...fourMarks[1], atMs: 5200 },
    { ...fourMarks[2], atMs: 6000 },
    { ...fourMarks[3] },
  ]
  await render(operationReplay(0, { operations: inGap }))
  await markOf(2).click()
  await publish(operationReplay(1, { operations: inGap, presentedMs: 5200 }))
  await waitUntilRendered(revisionAt(1))
  const gap = await readRow()
  cases.push({
    name: 'a seek to an operation inside an unrecorded interval keeps the Not recorded text and shows no caption',
    actual: gap,
    passed:
      gap.status.includes('Not recorded at this moment') &&
      gap.caption === '' &&
      gap.focusedMark === '2',
  })
  // Marks closer than 24 px stack vertically and none overlaps another.
  const crowded = [
    { ...fourMarks[0], atMs: 1000 },
    { ...fourMarks[1], atMs: 1010 },
    { ...fourMarks[2], atMs: 1020 },
    { ...fourMarks[3], atMs: 7000, state: 'done' },
  ]
  await render(operationReplay(0, { operations: crowded }))
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('[data-operation-mark]')].map(
      (mark) => mark.getBoundingClientRect().top,
    ),
  )
  const crowdedLayout = await page.evaluate(() => ({
    rowWidth: document.getElementById('operation-row').getBoundingClientRect()
      .width,
    lefts: [...document.querySelectorAll('[data-operation-mark]')].map(
      (mark) => mark.style.left,
    ),
  }))
  cases.push({
    name: 'operation marks closer than 24 px stack on separate lines',
    actual: { tops, crowdedLayout },
    passed:
      new Set(tops.slice(0, 3)).size === 3 && tops[3] === Math.min(...tops),
  })
  // Below 480 px the labels hide and the numbers stay.
  await page.setViewportSize({ width: 479, height: 640 })
  await render(operationReplay(0))
  const narrow = await page.evaluate(() => ({
    labelDisplays: [...document.querySelectorAll('.operation-mark-label')].map(
      (label) => getComputedStyle(label).display,
    ),
    numbers: [...document.querySelectorAll('[data-operation-mark]')].map(
      (mark) => mark.firstElementChild.textContent,
    ),
  }))
  cases.push({
    name: 'below a 480 px webview the failed label hides and the numbers stay',
    actual: narrow,
    passed:
      narrow.labelDisplays.every((display) => display === 'none') &&
      narrow.numbers.join('|') === '1|2|3 ✕|4 ?',
  })
  // A replay without operations shows no row and no operation buttons.
  await page.setViewportSize({ width: 960, height: 640 })
  await render(operationReplay(0, { operations: [] }))
  const without = await page.evaluate(() => ({
    rowVisible: document.getElementById('operation-row').checkVisibility(),
    marks: document.querySelectorAll('[data-operation-mark]').length,
    groupVisible: document.getElementById('playback-events').checkVisibility(),
  }))
  cases.push({
    name: 'a replay without operations shows no operation row and no operation buttons',
    actual: without,
    passed: !without.rowVisible && without.marks === 0 && !without.groupVisible,
  })
  // Switching in one webview from a replay with operations to one without: the row's width changes to zero when it hides, and the resize observer that follows must not draw the previous replay's marks again.
  await render(operationReplay(0))
  await publish(operationReplay(1, { operations: [] }))
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  const withoutAfterResize = await page.evaluate(() => ({
    rowVisible: document.getElementById('operation-row').checkVisibility(),
    marks: document.querySelectorAll('[data-operation-mark]').length,
    groupVisible: document.getElementById('playback-events').checkVisibility(),
  }))
  cases.push({
    name: 'a replay without operations stays without marks after the hidden row is resized',
    actual: withoutAfterResize,
    passed:
      !withoutAfterResize.rowVisible &&
      withoutAfterResize.marks === 0 &&
      !withoutAfterResize.groupVisible,
  })
  // Switching from a browser replay with operations to a test (or Server or Extension) replay in one webview: the row hides, and the resize observer that follows must neither draw the old marks nor hide Previous and Next event.
  await page.setViewportSize({ width: 960, height: 640 })
  await render(operationReplay(0))
  await publish({
    ...options.message,
    revision: revisionAt(1),
    replayFamily: 'test',
    recording: undefined,
  })
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  const afterTestReplay = await page.evaluate(() => ({
    rowVisible: document.getElementById('operation-row').checkVisibility(),
    marks: document.querySelectorAll('[data-operation-mark]').length,
    previousOperationVisible: document
      .getElementById('previous-operation')
      .checkVisibility(),
    previousEventVisible: document
      .getElementById('previous-event')
      .checkVisibility(),
    nextEventVisible: document.getElementById('next-event').checkVisibility(),
  }))
  cases.push({
    name: 'switching to a test replay leaves no operation marks or buttons and keeps Previous and Next event visible',
    actual: afterTestReplay,
    passed:
      !afterTestReplay.rowVisible &&
      afterTestReplay.marks === 0 &&
      !afterTestReplay.previousOperationVisible &&
      afterTestReplay.previousEventVisible &&
      afterTestReplay.nextEventVisible,
  })
  // A summary step links to its mark when the host names a valid operation, and stays unlinked otherwise.
  const learning = {
    explanationId: '44444444-4444-4444-8444-444444444444',
    createdAt: '2026-09-27T00:00:00.000Z',
    content: {
      question: 'How is an invoice created?',
      title: 'Create invoice',
      summary: 'The form posts.',
      participants: [{ id: 'ui', label: 'UI' }],
      steps: ['amount', 'ghost', 'plain'].map((id) => ({
        id,
        from: 'ui',
        to: 'ui',
        label: id,
        explanation: `The ${id} step.`,
        evidence: 'unknown',
      })),
    },
    positions: [],
    operationLinks: [
      { stepId: 'amount', operationIndex: 2 },
      { stepId: 'ghost', operationIndex: 9 },
    ],
  }
  await render(operationReplay(0, { learningSummary: learning }))
  const links = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#learning-sequence button[data-operation-mark]',
      ),
    ].map((link) => link.textContent),
  )
  await page.locator('#learning-sequence button[data-operation-mark]').click()
  const linkSeek = (await sentPlayback()).at(-1)
  cases.push({
    name: 'a summary step links to the mark of its operation, a step naming an operation the replay lacks stays unlinked',
    actual: { links, linkSeek: linkSeek?.positionMs },
    passed:
      links.length === 1 &&
      links[0] === 'Go to operation 2 · Amount' &&
      linkSeek?.positionMs === 1500,
  })
  await page.screenshot({ path: `${options.output}/operation-row.png` })
}

const report = {
  mode,
  qualification:
    'Compiled product HTML and real Chromium input; simulated host transport, not native acceptance.',
  compiled: 'extension/dist/ui/studyHtml.js',
  compiledSha256: createHash('sha256')
    .update(await readFile(new URL('../dist/ui/studyHtml.js', import.meta.url)))
    .digest('hex'),
  cases: [],
}
// A loopback secure context supplies the real crypto API; never patch the product's focus identity generator.
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Codebook reading pose control</title>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
// The check and its fixtures reach `run-code` as one function in a file it loads itself (`--filename`): handed over as one command argument, the pane's page alone exceeds the size the system allows for one argument, and the script could not start (E2BIG, Cycle 0046 row 333).
const flowPath = `${output}/flow.js`
let recording = false
try {
  await writeFile(
    flowPath,
    readerDomFlowText(check, { html, message, output, url }),
  )
  await command(['open', 'about:blank'], 'open')
  await command(
    [
      'run-code',
      `async page => { await page.setViewportSize({ width: 390, height: 640 }); await page.screencast.start({ path: ${JSON.stringify(`${output}/flow.webm`)}, size: { width: 390, height: 640 } }); }`,
    ],
    'video-start',
  )
  recording = true
  const result = await command(['run-code', `--filename=${flowPath}`], 'flow')
  Object.assign(
    report,
    JSON.parse(result.split('### Result\n')[1].split('\n###')[0]),
  )
  await command(
    ['run-code', 'async page => await page.screencast.stop()'],
    'video-stop',
  )
  recording = false
  assert.deepEqual(report.errors, [])
  assert.equal(
    report.cases.every((entry) => entry.passed),
    mode !== 'red',
    JSON.stringify(report.cases),
  )
} finally {
  // Each owned resource must close even when saving evidence or stopping its recording fails.
  try {
    await writeFile(
      `${output}/result.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    )
  } finally {
    try {
      if (recording)
        await command(
          ['run-code', 'async page => await page.screencast.stop()'],
          'failure-video-stop',
        )
    } finally {
      try {
        await command(['close'], 'close')
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  }
}
console.log(
  JSON.stringify(
    report.cases.map((entry) => ({ name: entry.name, passed: entry.passed })),
  ),
)
