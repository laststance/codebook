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
